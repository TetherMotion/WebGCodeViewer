/// @file SelfIntersectionAnalyzer.cpp
/// @brief Detect self-intersections and crossing toolpaths.

#include "SelfIntersectionAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"
#include "tether/gcode/motion/InterpolationStrategy.hpp"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <map>
#include <vector>

namespace tether::web {

namespace {

struct Segment2D {
    double x1 = 0.0, y1 = 0.0, x2 = 0.0, y2 = 0.0;
    double z = 0.0;
    bool isRapid = false;
    int lineNumber = 0;
    size_t index = 0;
};

struct IntersectionEvent {
    double x = 0.0, y = 0.0, z = 0.0;
    int line1 = 0;
    int line2 = 0;
    bool isRapid = false;
    double distanceToStart = 0.0;
};

std::optional<std::pair<double, double>> lineIntersection(
    const Segment2D& a, const Segment2D& b) {
    const double x1 = a.x1, y1 = a.y1, x2 = a.x2, y2 = a.y2;
    const double x3 = b.x1, y3 = b.y1, x4 = b.x2, y4 = b.y2;

    const double denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (std::abs(denom) < 1e-10) return std::nullopt; // parallel or collinear

    const double t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const double u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;

    if (t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0) {
        const double px = x1 + t * (x2 - x1);
        const double py = y1 + t * (y2 - y1);
        return std::make_optional(std::make_pair(px, py));
    }
    return std::nullopt;
}

} // namespace

void appendSelfIntersectionAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request) {

    using ::tether::viewer::v1::ANALYSIS_SEVERITY_HIGH;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_INFO;
    using ::tether::viewer::v1::ANALYSIS_SEVERITY_MEDIUM;

    if (!result || !result->success || result->planningSegments.empty() ||
        result->segmentSpeeds.empty()) {
        return;
    }

    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());
    const auto& edeltas = computeEdeltas(gcodeLines);

    constexpr double kZThreshold = 0.5; // mm
    constexpr size_t kMaxPerLayer = 500;

    // Group 2D segments by layer Z key.
    std::map<int64_t, std::vector<Segment2D>> layerSegs;
    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];

        const double eDelta = (static_cast<size_t>(ss.lineNumber) <= gcodeLines.size())
                                  ? edeltas[ss.lineNumber - 1]
                                  : 0.0;
        // Include all non-trivial motion. For 3DP include both extruding and
        // non-extruding moves; for CNC include rapids and cuts.
        const double path = seg.segmentLength;
        if (path < 1e-1) continue;

        const int64_t zKey = std::llround(seg.start.z() / kLayerZSnap);
        Segment2D s;
        s.x1 = seg.start.x();
        s.y1 = seg.start.y();
        s.x2 = seg.end.x();
        s.y2 = seg.end.y();
        s.z = seg.start.z();
        s.isRapid = seg.isRapid;
        s.lineNumber = ss.lineNumber;
        s.index = i;
        layerSegs[zKey].push_back(s);
    }

    std::vector<IntersectionEvent> intersections;

    for (auto& [_, segs] : layerSegs) {
        // Limit per layer to keep runtime bounded (O(n²)).
        if (segs.size() > kMaxPerLayer) {
            segs.resize(kMaxPerLayer);
        }

        for (size_t i = 0; i < segs.size(); ++i) {
            for (size_t j = i + 2; j < segs.size(); ++j) {
                // Arcs are approximated by their chord for the intersection test.
                if (auto point = lineIntersection(segs[i], segs[j])) {
                    const double dist = std::sqrt(
                        (point->first - segs[i].x1) * (point->first - segs[i].x1) +
                        (point->second - segs[i].y1) * (point->second - segs[i].y1));
                    intersections.push_back({point->first, point->second, segs[i].z,
                                             segs[i].lineNumber, segs[j].lineNumber,
                                             segs[i].isRapid || segs[j].isRapid, dist});
                }
            }
        }
    }

    auto* section = response.add_sections();
    section->set_section_name("path_intersections");
    section->set_display_name("Path Intersections");

    const std::string& detail = request.detail_level();
    const bool summaryOnly = (detail == "summary");
    const bool fullEvents = (detail == "full");
    const size_t topLimit = (request.top_event_limit() > 0)
                                ? static_cast<size_t>(request.top_event_limit())
                                : (fullEvents ? std::numeric_limits<size_t>::max() : 64);

    size_t cuttingCount = 0;
    size_t rapidCount = 0;
    for (const auto& ev : intersections) {
        if (ev.isRapid) ++rapidCount;
        else ++cuttingCount;
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

    addIntMetric("intersection_count", static_cast<int64_t>(intersections.size()));
    addIntMetric("cutting_intersections", static_cast<int64_t>(cuttingCount));
    addIntMetric("rapid_intersections", static_cast<int64_t>(rapidCount));
    addIntMetric("layers_checked", static_cast<int64_t>(layerSegs.size()));

    double score = 100.0;
    score -= static_cast<double>(cuttingCount) * 10.0;
    score -= static_cast<double>(rapidCount) * 2.0;
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(intersections.size()));
    section->set_has_more_events(intersections.size() > topLimit);

    if (summaryOnly) return;

    std::sort(intersections.begin(), intersections.end(),
              [](const IntersectionEvent& a, const IntersectionEvent& b) {
                  if (a.isRapid != b.isRapid) return !a.isRapid; // cutting first
                  return a.distanceToStart > b.distanceToStart;
              });

    const size_t eventCount = std::min(topLimit, intersections.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& ev = intersections[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("intersection:z={:.2f}:l{}:l{}", ev.z, ev.line1, ev.line2));
        e->set_event_type("intersection");

        const auto sev = ev.isRapid ? ANALYSIS_SEVERITY_MEDIUM : ANALYSIS_SEVERITY_HIGH;
        e->set_severity(sev);
        e->set_message(std::format(
            "{} intersection at Z={:.2f} mm between lines {} and {} ({:.1f}, {:.1f})",
            ev.isRapid ? "Rapid" : "Cutting",
            ev.z, ev.line1, ev.line2, ev.x, ev.y));
        e->set_metric_value(ev.distanceToStart);
        e->set_details_json(std::format(
            R"({{"x":{:.3f},"y":{:.3f},"z":{:.2f},"line1":{},"line2":{},"is_rapid":{},"type":"{}"}})",
            ev.x, ev.y, ev.z, ev.line1, ev.line2, ev.isRapid,
            ev.isRapid ? "rapid" : "cutting"));
    }
}

} // namespace tether::web
