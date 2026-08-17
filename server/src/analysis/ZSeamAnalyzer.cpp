/// @file ZSeamAnalyzer.cpp
/// @brief Z-seam detection and consistency scoring.

#include "ZSeamAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"

#include <algorithm>
#include <cmath>
#include <format>
#include <limits>
#include <map>
#include <numbers>
#include <vector>

namespace tether::web {

namespace {

struct SeamPoint {
    double z = 0.0;
    double x = 0.0;
    double y = 0.0;
    int lineNumber = 0;
    bool aligned = false;
    double distanceToPrevious = 0.0;
};

} // namespace

void appendZSeamAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request) {

    using ::tether::viewer::v1::ANALYSIS_SEVERITY_INFO;

    if (!result || !result->success || result->planningSegments.empty() ||
        result->segmentSpeeds.empty()) {
        return;
    }

    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());
    const auto& edeltas = computeEdeltas(gcodeLines);

    // Find the first extruding segment per layer.
    std::map<int64_t, SeamPoint> seamMap;
    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        if (seg.isRapid) continue;

        const auto& ss = result->segmentSpeeds[i];
        const size_t lineIndex = (ss.lineNumber >= 1)
                                     ? static_cast<size_t>(ss.lineNumber - 1)
                                     : std::numeric_limits<size_t>::max();
        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        if (eDelta <= 1e-9) continue;

        const int64_t zKey = std::llround(seg.start.z() / kLayerZSnap);
        if (seamMap.find(zKey) != seamMap.end()) continue; // first seam wins

        seamMap[zKey] = {seg.start.z(), seg.start.x(), seg.start.y(), ss.lineNumber, false, 0.0};
    }

    if (seamMap.size() < 2) return;

    std::vector<SeamPoint> seams;
    seams.reserve(seamMap.size());
    for (auto& [_, p] : seamMap) seams.push_back(std::move(p));
    std::sort(seams.begin(), seams.end(),
              [](const SeamPoint& a, const SeamPoint& b) { return a.z < b.z; });

    constexpr double kAlignedToleranceMm = 2.0;

    double totalDist = 0.0;
    double maxDist = 0.0;
    double distSum = 0.0;
    double distSumSq = 0.0;
    size_t alignedCount = 0;

    for (size_t i = 1; i < seams.size(); ++i) {
        const double dx = seams[i].x - seams[i - 1].x;
        const double dy = seams[i].y - seams[i - 1].y;
        const double dist = std::sqrt(dx * dx + dy * dy);
        seams[i].distanceToPrevious = dist;
        seams[i].aligned = dist < kAlignedToleranceMm;
        if (seams[i].aligned) ++alignedCount;
        totalDist += dist;
        maxDist = std::max(maxDist, dist);
        distSum += dist;
        distSumSq += dist * dist;
    }

    const size_t pairCount = seams.size() - 1;
    const double avgDist = pairCount > 0 ? distSum / pairCount : 0.0;
    const double variance = pairCount > 0 ? (distSumSq / pairCount) - (avgDist * avgDist) : 0.0;

    // Centroid and max dispersion.
    double cx = 0.0, cy = 0.0;
    for (const auto& s : seams) { cx += s.x; cy += s.y; }
    cx /= seams.size();
    cy /= seams.size();
    double maxDispersion = 0.0;
    for (const auto& s : seams) {
        const double d = std::sqrt((s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy));
        maxDispersion = std::max(maxDispersion, d);
    }

    auto* section = response.add_sections();
    section->set_section_name("z_seam");
    section->set_display_name("Z-Seam Analysis");

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

    addIntMetric("seam_count", static_cast<int64_t>(seams.size()));
    addIntMetric("aligned_count", static_cast<int64_t>(alignedCount));
    addMetric("alignment_score", pairCount > 0 ? static_cast<double>(alignedCount) / pairCount : 1.0);
    addMetric("average_seam_distance_mm", avgDist);
    addMetric("max_seam_distance_mm", maxDist);
    addMetric("seam_variance_mm", std::max(0.0, variance));
    addMetric("seam_dispersion_mm", maxDispersion);

    const double alignmentScore = pairCount > 0 ? static_cast<double>(alignedCount) / pairCount : 1.0;
    double score = 100.0 * alignmentScore;
    if (maxDist > 10.0) score -= 10.0;
    if (maxDispersion > 10.0) score -= 10.0;
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(seams.size()));
    section->set_has_more_events(seams.size() > topLimit);

    if (summaryOnly) return;

    std::vector<SeamPoint> sorted = seams;
    std::sort(sorted.begin(), sorted.end(),
              [](const SeamPoint& a, const SeamPoint& b) {
                  return a.distanceToPrevious > b.distanceToPrevious;
              });

    const size_t eventCount = std::min(topLimit, sorted.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& s = sorted[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("z_seam:z={:.2f}:line{}", s.z, s.lineNumber));
        e->set_event_type("z_seam");
        e->set_severity(ANALYSIS_SEVERITY_INFO);
        e->set_message(std::format(
            "Layer Z={:.2f} mm: seam at ({:.1f}, {:.1f}){}{}",
            s.z, s.x, s.y,
            s.aligned ? ", aligned" : ", misaligned",
            s.distanceToPrevious > 1e-9
                ? std::format(" (distance to previous: {:.2f} mm)", s.distanceToPrevious)
                : ""));
        e->set_metric_value(s.distanceToPrevious);
        e->set_details_json(std::format(
            R"({{"x":{:.3f},"y":{:.3f},"z":{:.2f},"line":{},"aligned":{},"distance_to_previous_mm":{:.3f}}})" ,
            s.x, s.y, s.z, s.lineNumber, s.aligned, s.distanceToPrevious));
    }
}

} // namespace tether::web
