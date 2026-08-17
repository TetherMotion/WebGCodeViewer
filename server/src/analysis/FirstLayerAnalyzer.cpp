/// @file FirstLayerAnalyzer.cpp
/// @brief First-layer quality analysis.

#include "FirstLayerAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <numbers>
#include <vector>

namespace tether::web {

namespace {

struct Issue {
    std::string type;
    std::string description;
    ::tether::viewer::v1::AnalysisSeverity severity;
};

double parseTemperature(const std::string& raw, double code) {
    std::string line = stripGcodeComments(raw);
    line = toUpper(line);
    // Search for S word following the M code.
    size_t pos = line.find(std::format("M{:.0f}", code));
    if (pos == std::string::npos) return -1.0;
    if (auto s = findWordValue(line.substr(pos), 'S')) return *s;
    return -1.0;
}

} // namespace

void appendFirstLayerAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request) {

    using ::tether::viewer::v1::ANALYSIS_SEVERITY_HIGH;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_INFO;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_LOW;

    if (!result || !result->success || result->planningSegments.empty() ||
        result->segmentSpeeds.empty()) {
        return;
    }

    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());
    const auto& edeltas = computeEdeltas(gcodeLines);

    // Identify the lowest extruding layer.
    double firstZ = std::numeric_limits<double>::infinity();
    int firstLayerEndLine = 0;
    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        if (seg.isRapid) continue;
        const auto& ss = result->segmentSpeeds[i];
        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        if (eDelta <= 1e-9) continue;

        if (seg.start.z() < firstZ) firstZ = seg.start.z();
        if (ss.lineNumber > firstLayerEndLine) firstLayerEndLine = ss.lineNumber;
    }

    if (!std::isfinite(firstZ)) return;

    const double zTol = 0.05;
    double totalExtrusion = 0.0;
    double extrudingPath = 0.0;
    double totalPath = 0.0;
    double travelPath = 0.0;
    double firstLayerTime = 0.0;
    uint32_t moveCount = 0;
    uint32_t extrudingMoves = 0;
    double feedRateSum = 0.0;
    double maxFeed = 0.0;

    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];
        if (std::abs(seg.start.z() - firstZ) > zTol) continue;

        totalPath += seg.segmentLength;
        firstLayerTime += ss.duration;
        ++moveCount;
        feedRateSum += seg.feedRate;
        maxFeed = std::max(maxFeed, seg.feedRate);

        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        if (eDelta > 1e-9) {
            totalExtrusion += eDelta;
            extrudingPath += seg.segmentLength;
            ++extrudingMoves;
        } else if (seg.isRapid) {
            travelPath += seg.segmentLength;
        }
    }

    // Parse first-layer temperatures and fan from gcode comments/commands.
    int bedTemp = 0;
    int hotendTemp = 0;
    int fanSpeed = 0;
    for (int i = 0; i < firstLayerEndLine && i < static_cast<int>(gcodeLines.size()); ++i) {
        const std::string line = stripGcodeComments(gcodeLines[i]);

        if (auto v = findWordValue(line, 'M')) {
            if ((*v == 140.0 || *v == 190.0)) {
                if (auto s = findWordValue(line, 'S')) bedTemp = static_cast<int>(std::round(*s));
            } else if (*v == 104.0 || *v == 109.0) {
                if (auto s = findWordValue(line, 'S')) hotendTemp = static_cast<int>(std::round(*s));
            } else if (*v == 106.0) {
                if (auto s = findWordValue(line, 'S')) fanSpeed = static_cast<int>(std::round(*s));
            } else if (*v == 107.0) {
                fanSpeed = 0;
            }
        }
    }

    std::vector<Issue> issues;

    if (bedTemp > 0 && bedTemp < 50) {
        issues.push_back({"bed_temp",
                          std::format("Bed temperature {}°C is low for reliable first-layer adhesion", bedTemp),
                          ANALYSIS_SEVERITY_LOW});
    }
    if (hotendTemp > 0 && hotendTemp < 180) {
        issues.push_back({"hotend_temp",
                          std::format("Hotend temperature {}°C is low for proper filament flow", hotendTemp),
                          ANALYSIS_SEVERITY_LOW});
    }
    if (fanSpeed > 50) {
        issues.push_back({"fan_speed",
                          std::format("First-layer fan speed {}/255 may reduce adhesion", fanSpeed),
                          ANALYSIS_SEVERITY_LOW});
    }
    if (maxFeed > 3000.0) {
        issues.push_back({"feed_rate",
                          std::format("First-layer feed rate {:.0f} mm/min is high for adhesion", maxFeed),
                          ANALYSIS_SEVERITY_LOW});
    }
    if (extrudingMoves == 0) {
        issues.push_back({"no_extrusion", "No extrusion detected in the first layer",
                          ANALYSIS_SEVERITY_HIGH});
    }

    auto* section = response.add_sections();
    section->set_section_name("first_layer");
    section->set_display_name("First Layer Quality");

    const std::string& detail = request.detail_level();
    const bool summaryOnly = (detail == "summary");
    const bool fullEvents = (detail == "full");
    const size_t topLimit = (request.top_event_limit() > 0)
                                ? static_cast<size_t>(request.top_event_limit())
                                : (fullEvents ? std::numeric_limits<size_t>::max() : 64);

    auto addMetric = [&](const std::string& key, double value) {
        auto* m = section->add_metrics();
        m->set_key(key);
        m->set_double_value(value);
    };
    auto addIntMetric = [&](const std::string& key, int64_t value) {
        auto* m = section->add_metrics();
        m->set_key(key);
        m->set_int64_value(value);
    };

    addMetric("first_layer_z", firstZ);
    addIntMetric("bed_temp_c", static_cast<int64_t>(bedTemp));
    addIntMetric("hotend_temp_c", static_cast<int64_t>(hotendTemp));
    addIntMetric("fan_speed", static_cast<int64_t>(fanSpeed));
    addMetric("total_extrusion_mm", totalExtrusion);
    addMetric("extruding_path_mm", extrudingPath);
    addMetric("travel_path_mm", travelPath);
    addMetric("total_path_mm", totalPath);
    addMetric("first_layer_time_s", firstLayerTime);
    addIntMetric("move_count", static_cast<int64_t>(moveCount));
    addIntMetric("extruding_move_count", static_cast<int64_t>(extrudingMoves));
    addMetric("max_feed_rate_mm_min", maxFeed);
    addMetric("avg_feed_rate_mm_min", moveCount > 0 ? feedRateSum / moveCount : 0.0);

    double score = 100.0;
    for (const auto& issue : issues) {
        if (issue.severity == ANALYSIS_SEVERITY_HIGH) score -= 30.0;
        else score -= 12.0;
    }
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(issues.size()));
    section->set_has_more_events(issues.size() > topLimit);

    if (summaryOnly) return;

    for (size_t i = 0; i < std::min(topLimit, issues.size()); ++i) {
        const auto& issue = issues[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("first_layer:{}", issue.type));
        e->set_event_type(issue.type);
        e->set_severity(issue.severity);
        e->set_message(issue.description);
        e->set_metric_value(0.0);
        e->set_details_json(std::format(
            R"({{"type":"{}","first_layer_z":{:.2f},"bed_temp":{},"hotend_temp":{},"fan_speed":{},"max_feed_rate":{:.0f}}})" ,
            issue.type, firstZ, bedTemp, hotendTemp, fanSpeed, maxFeed));
    }
}

} // namespace tether::web
