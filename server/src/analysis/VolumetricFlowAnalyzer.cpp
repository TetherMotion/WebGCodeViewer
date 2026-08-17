/// @file VolumetricFlowAnalyzer.cpp
/// @brief Volumetric flow rate and extrusion consistency analysis.

#include "VolumetricFlowAnalyzer.hpp"
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

struct FlowSample {
    int lineNumber = 0;
    double flowRate = 0.0; // mm³/s
    double duration = 0.0;
    double pathLength = 0.0;
    double extrusion = 0.0;
    double linearSpeed = 0.0;
    double deviation = 0.0;
};

} // namespace

void appendVolumetricFlowAnalysis(
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

    const double radius = kFilamentDiameterMm / 2.0;
    const double crossArea = std::numbers::pi * radius * radius;

    std::vector<FlowSample> samples;
    samples.reserve(n);

    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        if (seg.isRapid) continue;

        const auto& ss = result->segmentSpeeds[i];
        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        if (eDelta <= 1e-9) continue;

        const double duration = ss.duration;
        if (duration < 1e-9) continue;

        const double flowRate = (eDelta / duration) * crossArea; // mm³/s
        const double pathLength = seg.segmentLength;
        const double linearSpeed = pathLength > 1e-9 ? pathLength / duration : 0.0;

        samples.push_back({ss.lineNumber, flowRate, duration, pathLength, eDelta,
                           linearSpeed, 0.0});
    }

    if (samples.empty()) return;

    double minFlow = std::numeric_limits<double>::infinity();
    double maxFlow = -std::numeric_limits<double>::infinity();
    double sumFlow = 0.0;
    for (const auto& s : samples) {
        minFlow = std::min(minFlow, s.flowRate);
        maxFlow = std::max(maxFlow, s.flowRate);
        sumFlow += s.flowRate;
    }
    const double meanFlow = sumFlow / samples.size();

    double sumSq = 0.0;
    for (auto& s : samples) {
        s.deviation = s.flowRate - meanFlow;
        sumSq += s.deviation * s.deviation;
    }
    const double variance = sumSq / samples.size();
    const double stdDev = std::sqrt(variance);

    auto* section = response.add_sections();
    section->set_section_name("volumetric_flow");
    section->set_display_name("Volumetric Flow");

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

    addIntMetric("sample_count", static_cast<int64_t>(samples.size()));
    addMetric("min_flow_mm3_s", minFlow);
    addMetric("max_flow_mm3_s", maxFlow);
    addMetric("mean_flow_mm3_s", meanFlow);
    addMetric("stddev_flow_mm3_s", stdDev);
    addMetric("coefficient_of_variation", meanFlow > 1e-9 ? stdDev / meanFlow : 0.0);

    // Score: lower consistency -> lower score.
    double score = 100.0;
    if (meanFlow > 1e-9) {
        const double cv = stdDev / meanFlow;
        if (cv > 0.5) score -= 25.0;
        else if (cv > 0.3) score -= 15.0;
        else if (cv > 0.15) score -= 5.0;
    }
    if (maxFlow > meanFlow * 3.0) score -= 5.0;
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(samples.size()));
    section->set_has_more_events(samples.size() > topLimit);

    if (summaryOnly) return;

    std::vector<FlowSample> sorted = samples;
    std::sort(sorted.begin(), sorted.end(),
              [](const FlowSample& a, const FlowSample& b) {
                  return std::abs(a.deviation) > std::abs(b.deviation);
              });

    const size_t eventCount = std::min(topLimit, sorted.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& s = sorted[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("flow:line{}", s.lineNumber));
        e->set_event_type("flow_sample");

        auto sev = ANALYSIS_SEVERITY_INFO;
        if (std::abs(s.deviation) > 2.0 * stdDev) sev = ANALYSIS_SEVERITY_HIGH;
        else if (std::abs(s.deviation) > stdDev) sev = ANALYSIS_SEVERITY_LOW;

        e->set_severity(sev);
        e->set_message(std::format(
            "Flow {:.2f} mm³/s at line {} ({}{:.2f} from mean)",
            s.flowRate, s.lineNumber,
            s.deviation > 0.0 ? "+" : "", s.deviation));
        e->set_metric_value(s.flowRate);
        e->set_details_json(std::format(
            R"({{"line":{},"flow_rate_mm3_s":{:.3f},"mean_flow_mm3_s":{:.3f},"deviation_mm3_s":{:.3f},"duration_s":{:.3f},"extrusion_mm":{:.3f},"path_length_mm":{:.3f},"linear_speed_mm_s":{:.3f}}})" ,
            s.lineNumber, s.flowRate, meanFlow, s.deviation, s.duration, s.extrusion,
            s.pathLength, s.linearSpeed));
    }
}

} // namespace tether::web
