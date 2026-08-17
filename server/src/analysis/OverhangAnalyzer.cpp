/// @file OverhangAnalyzer.cpp
/// @brief Overhang, bridge and support detection using layer-by-layer geometry.

#include "OverhangAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"
#include "tether/gcode/motion/InterpolationStrategy.hpp"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <map>
#include <numbers>
#include <vector>

namespace tether::web {

namespace {

using ::tether::viewer::v1::AnalysisEvent;
using ::tether::viewer::v1::AnalysisSection;

constexpr double kOverhangAngleRad = 45.0 * std::numbers::pi / 180.0;
constexpr double kBridgeFactor = 1.5;
constexpr double kMinOverhangMm = 0.1;

struct LayerBox {
    double z = 0.0;
    double minX = 0.0;
    double maxX = 0.0;
    double minY = 0.0;
    double maxY = 0.0;
    std::vector<std::array<double, 4>> extrudingSegs; // x1,y1,x2,y2
};

struct OverhangEvent {
    bool bridge = false;
    double z = 0.0;
    double layerHeight = 0.0;
    double maxDist = 0.0;
    double angle = 0.0;
    int lineNumber = 0;
    double length = 0.0;
    double time = 0.0;
};

double pointToSegmentDistance2D(double px, double py,
                                double x1, double y1,
                                double x2, double y2) {
    const double vx = x2 - x1;
    const double vy = y2 - y1;
    const double wx = px - x1;
    const double wy = py - y1;
    const double c1 = vx * wx + vy * wy;
    if (c1 <= 0.0) {
        const double dx = px - x1;
        const double dy = py - y1;
        return std::sqrt(dx * dx + dy * dy);
    }
    const double c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
        const double dx = px - x2;
        const double dy = py - y2;
        return std::sqrt(dx * dx + dy * dy);
    }
    const double b = c1 / c2;
    const double projX = x1 + b * vx;
    const double projY = y1 + b * vy;
    const double dx = px - projX;
    const double dy = py - projY;
    return std::sqrt(dx * dx + dy * dy);
}

std::pair<double, double> arcMidpoint(const GCode::PlanningSegment& seg) {
    const double startAngle = std::atan2(seg.start.y() - seg.center.y(),
                                         seg.start.x() - seg.center.x());
    const double halfSweep = 0.5 * seg.arcSweep * seg.arcDirection();
    const double midAngle = startAngle + halfSweep;
    return {
        seg.center.x() + seg.arcRadius * std::cos(midAngle),
        seg.center.y() + seg.arcRadius * std::sin(midAngle),
    };
}

} // namespace

void appendOverhangAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request) {

    using ::tether::viewer::v1::ANALYSIS_SEVERITY_HIGH;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_INFO;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_LOW;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_MEDIUM;

    if (!result || !result->success || result->planningSegments.empty() ||
        result->segmentSpeeds.empty()) {
        return;
    }

    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());
    const auto& edeltas = computeEdeltas(gcodeLines);
    const auto& features = computeFeatures(gcodeLines);

    // Group extruding non-rapid segments per layer.
    std::map<int64_t, LayerBox> layerMap;
    std::map<int64_t, std::vector<size_t>> layerSegIndexMap;

    double supportExtrusion = 0.0;
    double supportTime = 0.0;
    double supportPath = 0.0;
    uint32_t supportSegments = 0;

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

        auto& layer = layerMap[zKey];
        layer.z = zKey * kLayerZSnap;
        if (layer.extrudingSegs.empty()) {
            layer.minX = layer.maxX = seg.start.x();
            layer.minY = layer.maxY = seg.start.y();
        }
        layer.minX = std::min(layer.minX, std::min(seg.start.x(), seg.end.x()));
        layer.maxX = std::max(layer.maxX, std::max(seg.start.x(), seg.end.x()));
        layer.minY = std::min(layer.minY, std::min(seg.start.y(), seg.end.y()));
        layer.maxY = std::max(layer.maxY, std::max(seg.start.y(), seg.end.y()));
        layer.extrudingSegs.push_back({seg.start.x(), seg.start.y(),
                                       seg.end.x(), seg.end.y()});

        layerSegIndexMap[zKey].push_back(i);

        if (lineIndex < features.size() && features[lineIndex].find("SUPPORT") != std::string::npos) {
            supportExtrusion += std::max(0.0, eDelta);
            supportTime += ss.duration;
            supportPath += seg.segmentLength;
            ++supportSegments;
        }
    }

    if (layerMap.size() < 2) return;

    // Sorted layers.
    std::vector<LayerBox> layers;
    layers.reserve(layerMap.size());
    for (auto& [_, box] : layerMap) layers.push_back(std::move(box));
    std::sort(layers.begin(), layers.end(),
              [](const LayerBox& a, const LayerBox& b) { return a.z < b.z; });

    std::vector<OverhangEvent> events;

    for (size_t li = 1; li < layers.size(); ++li) {
        const auto& prevLayer = layers[li - 1];
        const auto& currLayer = layers[li];
        const double layerHeight = currLayer.z - prevLayer.z;
        if (layerHeight < 1e-9) continue;

        const double allowedOverhang = layerHeight / std::tan(kOverhangAngleRad) + 0.1;
        const auto itIdx = layerSegIndexMap.find(std::llround(currLayer.z / kLayerZSnap));
        if (itIdx == layerSegIndexMap.end()) continue;

        for (size_t idx : itIdx->second) {
            const auto& seg = result->planningSegments[idx];
            const auto& ss = result->segmentSpeeds[idx];

            const double x1 = seg.start.x(), y1 = seg.start.y();
            const double x2 = seg.end.x(), y2 = seg.end.y();

            auto testPoint = [&](double px, double py) {
                double best = std::numeric_limits<double>::infinity();
                for (const auto& s : prevLayer.extrudingSegs) {
                    double d = pointToSegmentDistance2D(px, py, s[0], s[1], s[2], s[3]);
                    if (d < best) best = d;
                }
                return best;
            };

            const double startDist = testPoint(x1, y1);
            const double endDist = testPoint(x2, y2);

            double midX, midY;
            if (seg.isArc()) {
                std::tie(midX, midY) = arcMidpoint(seg);
            } else {
                midX = 0.5 * (x1 + x2);
                midY = 0.5 * (y1 + y2);
            }
            const double midDist = testPoint(midX, midY);

            const double maxDist = std::max({startDist, endDist, midDist});
            if (maxDist <= std::max(allowedOverhang, kMinOverhangMm)) continue;

            const double angle = std::atan2(maxDist, layerHeight) * 180.0 / std::numbers::pi;

            const bool isBridge = (startDist <= allowedOverhang && endDist <= allowedOverhang &&
                                   midDist > kBridgeFactor * allowedOverhang &&
                                   seg.motionType == GCode::SegmentMotionType::Linear);

            events.push_back({isBridge, currLayer.z, layerHeight, maxDist, angle,
                              ss.lineNumber, seg.segmentLength, ss.duration});
        }
    }

    auto* section = response.add_sections();
    section->set_section_name("overhang_bridge_support");
    section->set_display_name("Overhangs, Bridges & Supports");

    const std::string& detail = request.detail_level();
    const bool summaryOnly = (detail == "summary");
    const bool fullEvents = (detail == "full");
    const size_t topLimit = (request.top_event_limit() > 0)
                                ? static_cast<size_t>(request.top_event_limit())
                                : (fullEvents ? std::numeric_limits<size_t>::max() : 64);

    size_t overhangCount = 0;
    size_t bridgeCount = 0;
    double overhangLength = 0.0;
    double bridgeLength = 0.0;
    double maxAngle = 0.0;
    double angleSum = 0.0;

    for (const auto& ev : events) {
        if (ev.bridge) {
            ++bridgeCount;
            bridgeLength += ev.length;
        } else {
            ++overhangCount;
            overhangLength += ev.length;
        }
        maxAngle = std::max(maxAngle, ev.angle);
        angleSum += ev.angle;
    }

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

    addIntMetric("overhang_count", static_cast<int64_t>(overhangCount));
    addIntMetric("bridge_count", static_cast<int64_t>(bridgeCount));
    addMetric("overhang_length_mm", overhangLength);
    addMetric("bridge_length_mm", bridgeLength);
    addMetric("max_overhang_angle", maxAngle);
    addMetric("avg_overhang_angle", !events.empty() ? angleSum / events.size() : 0.0);
    addMetric("support_extrusion_mm", supportExtrusion);
    addMetric("support_time_s", supportTime);
    addMetric("support_path_length_mm", supportPath);
    addIntMetric("support_segment_count", static_cast<int64_t>(supportSegments));

    double score = 100.0;
    if (maxAngle > 60.0) score -= 25.0;
    else if (maxAngle > 45.0) score -= 15.0;
    score -= static_cast<double>(overhangCount) * 2.0;
    score -= static_cast<double>(bridgeCount) * 5.0;
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(events.size()));
    section->set_has_more_events(events.size() > topLimit);

    if (summaryOnly) return;

    std::sort(events.begin(), events.end(),
              [](const OverhangEvent& a, const OverhangEvent& b) { return a.angle > b.angle; });

    const size_t eventCount = std::min(topLimit, events.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& ev = events[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("{}:z={:.2f}:line{}", ev.bridge ? "bridge" : "overhang", ev.z, ev.lineNumber));
        e->set_event_type(ev.bridge ? "bridge" : "overhang");

        const char* sev = "minor";
        auto sevEnum = ANALYSIS_SEVERITY_LOW;
        if (ev.angle >= 60.0) { sev = "severe"; sevEnum = ANALYSIS_SEVERITY_HIGH; }
        else if (ev.angle >= 45.0) { sev = "moderate"; sevEnum = ANALYSIS_SEVERITY_MEDIUM; }

        e->set_severity(sevEnum);
        e->set_message(std::format("{} at Z={:.2f} mm: {:.1f}° overhang (line {})",
                                   ev.bridge ? "Bridge" : "Overhang",
                                   ev.z, ev.angle, ev.lineNumber));
        e->set_metric_value(ev.angle);
        e->set_details_json(std::format(
            R"({{"z":{:.2f},"layer_height":{:.3f},"overhang_distance":{:.3f},"angle":{:.1f},"length":{:.3f},"time_s":{:.3f},"line":{},"severity":"{}"}})",
            ev.z, ev.layerHeight, ev.maxDist, ev.angle, ev.length, ev.time, ev.lineNumber, sev));
    }
}

} // namespace tether::web
