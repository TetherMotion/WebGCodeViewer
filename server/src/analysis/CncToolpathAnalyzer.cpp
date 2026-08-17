/// @file CncToolpathAnalyzer.cpp
/// @brief Basic CNC toolpath, chip-load and MRR analysis.

#include "CncToolpathAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <map>
#include <string>
#include <vector>

namespace tether::web {

namespace {

struct ChipRange {
    double min = 0.0;
    double max = 0.0;
};

const std::map<std::string, ChipRange>& materialChipRanges() {
    static const std::map<std::string, ChipRange> ranges = {
        {"aluminum", {0.05, 0.15}},
        {"steel", {0.03, 0.08}},
        {"stainless", {0.02, 0.06}},
        {"wood", {0.10, 0.30}},
        {"plastic", {0.10, 0.25}},
        {"brass", {0.05, 0.12}},
    };
    return ranges;
}

ChipRange getRange(const std::string& material) {
    auto it = materialChipRanges().find(material);
    if (it != materialChipRanges().end()) return it->second;
    return materialChipRanges().at("aluminum");
}

} // namespace

void appendCncToolpathAnalysis(
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

    // Defaults; may be overridden by comments.
    int toolNumber = 1;
    double toolDiameter = 6.0;
    int flutes = 2;
    double axialDepth = 2.0;
    double radialDepth = toolDiameter * 0.5;
    std::string material = "aluminum";

    // Per-line state.
    std::vector<int> rpmByLine(gcodeLines.size(), 0);
    int currentRpm = 0;
    bool anySpindle = false;
    bool anyTool = false;

    for (size_t i = 0; i < gcodeLines.size(); ++i) {
        const std::string line = stripGcodeComments(gcodeLines[i]);
        if (auto v = findWordValue(line, 'M')) {
            if (*v == 3.0 || *v == 4.0) {
                if (auto s = findWordValue(line, 'S')) {
                    currentRpm = static_cast<int>(std::round(std::max(0.0, *s)));
                    anySpindle = true;
                }
            } else if (*v == 5.0) {
                currentRpm = 0;
            }
        }
        if (auto t = findWordValue(line, 'T')) {
            if (*t > 0) {
                toolNumber = static_cast<int>(*t);
                anyTool = true;
            }
        }

        // Try to parse slicer/CAM comments for tooling.
        if (auto f = extractFeatureTag(gcodeLines[i], "MATERIAL")) material = toUpper(*f);
        if (auto f = extractFeatureTag(gcodeLines[i], "TOOL_DIA")) {
            try { toolDiameter = std::stod(*f); } catch (...) {}
        }
        if (auto f = extractFeatureTag(gcodeLines[i], "FLUTES")) {
            try { flutes = std::stoi(*f); } catch (...) {}
            if (flutes < 1) flutes = 2;
        }
        if (auto f = extractFeatureTag(gcodeLines[i], "AXIAL_DEPTH")) {
            try { axialDepth = std::stod(*f); } catch (...) {}
        }
        if (auto f = extractFeatureTag(gcodeLines[i], "RADIAL_DEPTH")) {
            try { radialDepth = std::stod(*f); } catch (...) {}
        }

        rpmByLine[i] = currentRpm;
    }

    if (!anySpindle && !anyTool) {
        // Heuristic: if no spindle or tool change commands are present, this is likely a 3DP file.
        // Still emit a lightweight section but skip chip-load analysis because no RPM data exists.
        // The section will be mostly empty, which is acceptable for a mixed backend.
    }

    const ChipRange range = getRange(material);

    double cuttingTime = 0.0;
    double rapidTime = 0.0;
    double cuttingPath = 0.0;
    double rapidPath = 0.0;
    double feedRateSum = 0.0;
    double rpmSum = 0.0;
    size_t cuttingMoves = 0;
    size_t rapidMoves = 0;
    size_t inRange = 0;
    size_t outOfRange = 0;
    double chipLoadSum = 0.0;
    double maxChipLoad = 0.0;
    double maxMrr = 0.0;
    double mrrSum = 0.0;
    size_t mrrCount = 0;

    // Events: tool/spindle changes and chip-load warnings.
    std::vector<int> toolChanges;
    std::vector<std::pair<int, int>> rpmChanges; // line, rpm
    struct ChipEvent {
        int line;
        double chipLoad;
        bool inRange;
        double feed;
        int rpm;
        double mrr;
    };
    std::vector<ChipEvent> chipEvents;

    int prevRpm = -1;
    int prevTool = -1;

    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];
        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const int rpm = (lineIndex < rpmByLine.size()) ? rpmByLine[lineIndex] : 0;

        if (seg.isRapid) {
            rapidTime += ss.duration;
            rapidPath += seg.segmentLength;
            ++rapidMoves;
        } else {
            cuttingTime += ss.duration;
            cuttingPath += seg.segmentLength;
            ++cuttingMoves;
            feedRateSum += seg.feedRate;
            if (rpm > 0) rpmSum += rpm;

            // Track tool/spindle changes based on the active values at this segment.
            if (anyTool && toolNumber != prevTool) {
                toolChanges.push_back(ss.lineNumber);
                prevTool = toolNumber;
            }
            if (anySpindle && rpm != prevRpm) {
                rpmChanges.push_back({ss.lineNumber, rpm});
                prevRpm = rpm;
            }

            if (rpm > 0 && flutes > 0) {
                const double chipLoad = seg.feedRate / (static_cast<double>(rpm) * flutes);
                const bool ok = chipLoad >= range.min && chipLoad <= range.max;
                if (ok) ++inRange;
                else ++outOfRange;
                chipLoadSum += chipLoad;
                maxChipLoad = std::max(maxChipLoad, chipLoad);
                chipEvents.push_back({ss.lineNumber, chipLoad, ok, seg.feedRate, rpm, 0.0});

                // Approximate MRR (mm³/min) = feedRate * axialDepth * radialDepth.
                const double mrr = seg.feedRate * axialDepth * radialDepth;
                mrrSum += mrr;
                maxMrr = std::max(maxMrr, mrr);
                ++mrrCount;
                chipEvents.back().mrr = mrr;
            }
        }
    }

    // Only skip the whole section if there is no cutting data and no spindle/tool state.
    if (cuttingMoves == 0 && !anySpindle && !anyTool) return;

    auto* section = response.add_sections();
    section->set_section_name("cnc_toolpath");
    section->set_display_name("CNC Toolpath");

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

    addIntMetric("tool_number", static_cast<int64_t>(toolNumber));
    addMetric("tool_diameter_mm", toolDiameter);
    addIntMetric("flutes", static_cast<int64_t>(flutes));
    addMetric("axial_depth_mm", axialDepth);
    addMetric("radial_depth_mm", radialDepth);
    addMetric("cutting_time_s", cuttingTime);
    addMetric("rapid_time_s", rapidTime);
    addMetric("cutting_path_mm", cuttingPath);
    addMetric("rapid_path_mm", rapidPath);
    addMetric("avg_feed_rate_mm_min", cuttingMoves > 0 ? feedRateSum / cuttingMoves : 0.0);
    addMetric("avg_spindle_rpm", cuttingMoves > 0 ? rpmSum / cuttingMoves : 0.0);
    addMetric("max_chip_load", maxChipLoad);
    addMetric("avg_chip_load", chipEvents.empty() ? 0.0 : chipLoadSum / chipEvents.size());
    addMetric("max_mrr_mm3_min", maxMrr);
    addMetric("avg_mrr_mm3_min", mrrCount > 0 ? mrrSum / mrrCount : 0.0);
    addIntMetric("tool_changes", static_cast<int64_t>(toolChanges.size()));
    addIntMetric("spindle_changes", static_cast<int64_t>(rpmChanges.size()));
    addIntMetric("chip_load_samples", static_cast<int64_t>(chipEvents.size()));
    addIntMetric("in_range_samples", static_cast<int64_t>(inRange));
    addIntMetric("out_of_range_samples", static_cast<int64_t>(outOfRange));
    addMetric("in_range_percentage", chipEvents.empty() ? 0.0
                                                        : 100.0 * inRange / chipEvents.size());

    double score = 100.0;
    if (chipEvents.empty()) {
        if (cuttingMoves > 0 && rapidTime > cuttingTime) score -= 20.0;
    } else {
        const double pct = 100.0 * inRange / chipEvents.size();
        score = pct;
        if (maxChipLoad > range.max * 1.5) score -= 10.0;
        if (rapidTime > cuttingTime) score -= 10.0;
    }
    section->set_score(std::clamp(score, 0.0, 100.0));

    std::vector<std::string> eventIds;
    auto addEvent = [&](const std::string& id, const std::string& type,
                        ::tether::viewer::v1::AnalysisSeverity sev,
                        const std::string& msg, double metric, const std::string& details) {
        if (eventIds.size() >= topLimit) return;
        if (std::find(eventIds.begin(), eventIds.end(), id) != eventIds.end()) return;
        eventIds.push_back(id);
        auto* e = section->add_top_events();
        e->set_id(id);
        e->set_event_type(type);
        e->set_severity(sev);
        e->set_message(msg);
        e->set_metric_value(metric);
        e->set_details_json(details);
    };

    for (int line : toolChanges) {
        addEvent(std::format("cnc:tool_change:line{}", line), "tool_change",
                 ANALYSIS_SEVERITY_INFO,
                 std::format("Tool change at line {}", line),
                 static_cast<double>(toolNumber),
                 std::format(R"({{"line":{},"tool_number":{}}})" , line, toolNumber));
    }

    for (const auto& [line, rpm] : rpmChanges) {
        addEvent(std::format("cnc:spindle:line{}:rpm{}", line, rpm), "spindle_change",
                 ANALYSIS_SEVERITY_INFO,
                 std::format("Spindle set to {} RPM at line {}", rpm, line),
                 static_cast<double>(rpm),
                 std::format(R"({{"line":{},"rpm":{}}})" , line, rpm));
    }

    if (!summaryOnly) {
        std::sort(chipEvents.begin(), chipEvents.end(),
                  [](const ChipEvent& a, const ChipEvent& b) {
                      return a.chipLoad > b.chipLoad;
                  });

        for (const auto& ev : chipEvents) {
            const bool tooHigh = ev.chipLoad > range.max;
            const bool tooLow = ev.chipLoad < range.min;
            auto sev = ANALYSIS_SEVERITY_INFO;
            std::string note;
            if (tooHigh) {
                sev = ANALYSIS_SEVERITY_HIGH;
                note = std::format(
                    "Chip load {:.3f} mm/tooth exceeds recommended max {:.3f} for {}",
                    ev.chipLoad, range.max, material);
            } else if (tooLow) {
                sev = ANALYSIS_SEVERITY_LOW;
                note = std::format(
                    "Chip load {:.3f} mm/tooth below recommended min {:.3f} for {}",
                    ev.chipLoad, range.min, material);
            } else {
                note = std::format("Chip load {:.3f} mm/tooth in range for {}",
                                   ev.chipLoad, material);
            }

            addEvent(std::format("cnc:chip:line{}:{:.4f}", ev.line, ev.chipLoad), "chip_load",
                     sev, std::format("Line {}: {}", ev.line, note), ev.chipLoad,
                     std::format(
                         R"({{"line":{},"chip_load_mm_tooth":{:.4f},"feed_rate_mm_min":{:.1f},"rpm":{},"flutes":{},"mrr_mm3_min":{:.1f},"material":"{}","in_range":{}}})" ,
                         ev.line, ev.chipLoad, ev.feed, ev.rpm, flutes, ev.mrr, material, ev.inRange));
            if (eventIds.size() >= topLimit) break;
        }
    }

    section->set_total_event_count(static_cast<uint32_t>(eventIds.size()));
    section->set_has_more_events(eventIds.size() > topLimit);
}

} // namespace tether::web
