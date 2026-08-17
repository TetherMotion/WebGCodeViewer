/// @file ThermalCoolingAnalyzer.cpp
/// @brief Per-layer thermal and cooling analysis.

#include "ThermalCoolingAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <map>
#include <vector>

namespace tether::web {

namespace {

struct LayerCooling {
    double z = 0.0;
    double time = 0.0;
    double extrusion = 0.0;
    double path = 0.0;
    int firstLine = std::numeric_limits<int>::max();
    int lastLine = 0;
    double fanTime = 0.0;
    double fanSum = 0.0;
    double maxFan = 0.0;
};

} // namespace

void appendThermalCoolingAnalysis(
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

    // Current fan speed for each gcode line.
    std::vector<int> fanByLine(gcodeLines.size(), 0);
    int currentFan = 0;
    for (size_t i = 0; i < gcodeLines.size(); ++i) {
        const std::string line = stripGcodeComments(gcodeLines[i]);
        if (auto m = findWordValue(line, 'M')) {
            if (*m == 106.0) {
                if (auto s = findWordValue(line, 'S')) {
                    currentFan = static_cast<int>(std::round(std::clamp(*s, 0.0, 255.0)));
                }
            } else if (*m == 107.0) {
                currentFan = 0;
            }
        }
        fanByLine[i] = currentFan;
    }

    // Aggregate per layer.
    std::map<int64_t, LayerCooling> layers;
    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];
        if (seg.isRapid) continue;

        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        if (eDelta <= 1e-9) continue;

        const int64_t zKey = std::llround(seg.start.z() / kLayerZSnap);
        auto& layer = layers[zKey];
        layer.z = zKey * kLayerZSnap;
        layer.time += ss.duration;
        layer.extrusion += eDelta;
        layer.path += seg.segmentLength;
        layer.firstLine = std::min(layer.firstLine, ss.lineNumber);
        layer.lastLine = std::max(layer.lastLine, ss.lineNumber);

        const int fan = (lineIndex < fanByLine.size()) ? fanByLine[lineIndex] : 0;
        if (ss.duration > 0) {
            layer.fanTime += ss.duration;
            layer.fanSum += fan * ss.duration;
            layer.maxFan = std::max(layer.maxFan, static_cast<double>(fan));
        }
    }

    if (layers.empty()) return;

    constexpr double kFastLayerTime = 5.0;  // seconds
    constexpr double kSlowLayerTime = 60.0; // seconds
    constexpr double kAdequateFan = 50.0;   // /255

    // Build events for layers with concerning thermal/cooling behavior.
    std::vector<std::pair<const int64_t, LayerCooling>*> sortedLayers;
    for (auto& it : layers) sortedLayers.push_back(&it);

    double totalLayerTime = 0.0;
    double totalExtrusion = 0.0;
    size_t fastLayers = 0;
    size_t slowLayers = 0;
    size_t underCooled = 0;
    double maxFan = 0.0;
    double fanTimeWeighted = 0.0;

    for (const auto& it : sortedLayers) {
        const auto& l = it->second;
        totalLayerTime += l.time;
        totalExtrusion += l.extrusion;
        if (l.time < kFastLayerTime) ++fastLayers;
        if (l.time > kSlowLayerTime) ++slowLayers;
        const double avgFan = l.fanTime > 0.0 ? l.fanSum / l.fanTime : 0.0;
        if (l.time < kFastLayerTime && avgFan < kAdequateFan) ++underCooled;
        maxFan = std::max(maxFan, l.maxFan);
        fanTimeWeighted += l.fanSum;
    }

    auto* section = response.add_sections();
    section->set_section_name("thermal_cooling");
    section->set_display_name("Thermal & Cooling");

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

    // Min/max/avg layer time.
    std::vector<double> times;
    times.reserve(sortedLayers.size());
    for (const auto& it : sortedLayers) times.push_back(it->second.time);
    std::sort(times.begin(), times.end());

    addMetric("min_layer_time_s", times.front());
    addMetric("max_layer_time_s", times.back());
    addMetric("avg_layer_time_s", totalLayerTime / sortedLayers.size());
    addMetric("total_layer_time_s", totalLayerTime);
    addMetric("total_extrusion_mm", totalExtrusion);
    addIntMetric("layer_count", static_cast<int64_t>(sortedLayers.size()));
    addIntMetric("fast_layers_count", static_cast<int64_t>(fastLayers));
    addIntMetric("slow_layers_count", static_cast<int64_t>(slowLayers));
    addIntMetric("undercooled_layers", static_cast<int64_t>(underCooled));
    addMetric("max_fan_speed", maxFan);
    addMetric("avg_fan_speed", totalLayerTime > 0.0 ? fanTimeWeighted / totalLayerTime : 0.0);

    double score = 100.0;
    if (underCooled > 0) score -= std::min(30.0, static_cast<double>(underCooled) * 5.0);
    if (fastLayers > 0) score -= std::min(20.0, static_cast<double>(fastLayers) * 3.0);
    if (slowLayers > 0) score -= std::min(10.0, static_cast<double>(slowLayers) * 2.0);
    section->set_score(std::clamp(score, 0.0, 100.0));

    // Sort layers by time ascending for top events (shortest = most concerning).
    std::sort(sortedLayers.begin(), sortedLayers.end(),
              [](const auto* a, const auto* b) {
                  if (a->second.time != b->second.time) return a->second.time < b->second.time;
                  return a->first < b->first;
              });

    section->set_total_event_count(static_cast<uint32_t>(sortedLayers.size()));
    section->set_has_more_events(sortedLayers.size() > topLimit);

    if (summaryOnly) return;

    const size_t eventCount = std::min(topLimit, sortedLayers.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& l = sortedLayers[i]->second;
        const double avgFan = l.fanTime > 0.0 ? l.fanSum / l.fanTime : 0.0;
        const bool under = l.time < kFastLayerTime && avgFan < kAdequateFan;

        auto sev = ANALYSIS_SEVERITY_INFO;
        if (under) sev = ANALYSIS_SEVERITY_HIGH;
        else if (l.time < kFastLayerTime) sev = ANALYSIS_SEVERITY_LOW;

        auto* e = section->add_top_events();
        e->set_id(std::format("thermal:z={:.2f}:line{}", l.z, l.firstLine));
        e->set_event_type("layer_cooling");
        e->set_severity(sev);
        e->set_message(std::format(
            "Layer Z={:.2f} mm: time {:.1f} s, fan {:.0f}/255{}{}",
            l.z, l.time, avgFan,
            under ? " — under-cooled" : "",
            l.time > kSlowLayerTime ? " — slow layer" : ""));
        e->set_metric_value(l.time);
        e->set_details_json(std::format(
            R"({{"z":{:.2f},"time_s":{:.3f},"extrusion_mm":{:.3f},"path_mm":{:.3f},"avg_fan":{:.0f},"max_fan":{:.0f},"first_line":{},"undercooled":{}}})" ,
            l.z, l.time, l.extrusion, l.path, avgFan, l.maxFan, l.firstLine, under));
    }
}

} // namespace tether::web
