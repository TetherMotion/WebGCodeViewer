/// @file StockCollisionAnalyzer.cpp
/// @brief Stock, fixture and build-plate collision/clearance analysis.

#include "StockCollisionAnalyzer.hpp"
#include "AnalysisUtil.hpp"

#include "tether_viewer.pb.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <format>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace tether::web {

namespace {

struct Bounds3D {
    double minX = 0.0, maxX = 0.0, minY = 0.0, maxY = 0.0, minZ = 0.0, maxZ = 0.0;
    bool valid = false;
    bool circularBed = false;
};

struct Violation {
    std::string type;
    ::tether::viewer::v1::AnalysisSeverity severity;
    std::string message;
    int lineNumber = 0;
    double x = 0.0, y = 0.0, z = 0.0;
};

std::optional<double> parseCommentValue(const std::string& line,
                                        const std::string& prefix,
                                        char delimiter) {
    const std::string raw = stripGcodeComments(line);
    if (raw.empty()) return std::nullopt;

    // Case 1: prefix immediately after ;
    size_t pos = line.find(prefix);
    if (pos == std::string::npos) return std::nullopt;
    pos += prefix.size();
    if (pos < line.size() && (line[pos] == ':' || line[pos] == ',' || line[pos] == '=')) {
        ++pos;
        while (pos < line.size() && std::isspace(static_cast<unsigned char>(line[pos]))) ++pos;
        size_t end = pos;
        while (end < line.size() && (std::isdigit(static_cast<unsigned char>(line[end])) ||
                                     line[end] == '.' || line[end] == '-' || line[end] == '+')) {
            ++end;
        }
        if (end > pos) {
            try { return std::stod(line.substr(pos, end - pos)); } catch (...) {}
        }
    }
    return std::nullopt;
}

Bounds3D parseStockOrBed(const std::vector<std::string>& gcodeLines) {
    Bounds3D b;
    b.valid = false;
    b.circularBed = false;

    double stockX = 0.0, stockY = 0.0, stockZ = 0.0;
    double bedX = 0.0, bedY = 0.0;
    double minX = 0.0, maxX = 0.0, minY = 0.0, maxY = 0.0;
    bool hasStock = false, hasBed = false, hasBounds = false;

    for (size_t i = 0; i < std::min<size_t>(gcodeLines.size(), 500); ++i) {
        const std::string& line = gcodeLines[i];

        if (auto v = parseCommentValue(line, "STOCK_X", ':')) { stockX = *v; hasStock = true; }
        if (auto v = parseCommentValue(line, "STOCK_Y", ':')) { stockY = *v; hasStock = true; }
        if (auto v = parseCommentValue(line, "STOCK_Z", ':')) { stockZ = *v; hasStock = true; }
        if (auto v = parseCommentValue(line, "BED_X", ':')) { bedX = *v; hasBed = true; }
        if (auto v = parseCommentValue(line, "BED_Y", ':')) { bedY = *v; hasBed = true; }

        if (auto v = parseCommentValue(line, "print_area_min_x", ':')) { minX = *v; hasBounds = true; }
        if (auto v = parseCommentValue(line, "print_area_max_x", ':')) { maxX = *v; hasBounds = true; }
        if (auto v = parseCommentValue(line, "print_area_min_y", ':')) { minY = *v; hasBounds = true; }
        if (auto v = parseCommentValue(line, "print_area_max_y", ':')) { maxY = *v; hasBounds = true; }

        if (auto v = parseCommentValue(line, "bed_shape", '=')) {
            std::string s = toUpper(std::string(line));
            if (s.find("CIRCLE") != std::string::npos || s.find("CIRCULAR") != std::string::npos) {
                b.circularBed = true;
            } else if (s.find("0X0") != std::string::npos) {
                // PrusaSlicer bed_shape = 0x0,200x0,200x200,0x200
                // We just treat the bed as a rectangle aligned with origin; parse from comment is non-trivial.
                hasBounds = true;
            }
        }
    }

    if (hasStock) {
        b.minX = -stockX * 0.5;
        b.maxX = stockX * 0.5;
        b.minY = -stockY * 0.5;
        b.maxY = stockY * 0.5;
        b.minZ = 0.0;
        b.maxZ = stockZ;
        b.valid = true;
    } else if (hasBounds) {
        b.minX = minX;
        b.maxX = maxX;
        b.minY = minY;
        b.maxY = maxY;
        b.minZ = 0.0;
        b.maxZ = 1e6;
        b.valid = true;
    } else if (hasBed) {
        b.minX = -bedX * 0.5;
        b.maxX = bedX * 0.5;
        b.minY = -bedY * 0.5;
        b.maxY = bedY * 0.5;
        b.minZ = 0.0;
        b.maxZ = 1e6;
        b.valid = true;
    }

    return b;
}

bool insideBox(const Bounds3D& b, double x, double y, double z) {
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

bool insideCircle(const Bounds3D& b, double x, double y) {
    const double cx = 0.5 * (b.minX + b.maxX);
    const double cy = 0.5 * (b.minY + b.maxY);
    const double rx = 0.5 * (b.maxX - b.minX);
    const double ry = 0.5 * (b.maxY - b.minY);
    const double r = std::min(rx, ry);
    return ((x - cx) * (x - cx) + (y - cy) * (y - cy)) <= r * r;
}

} // namespace

void appendStockCollisionAnalysis(
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

    const Bounds3D bounds = parseStockOrBed(gcodeLines);
    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());

    std::vector<Violation> violations;

    // Auto-detect a safe Z: either 10 mm above stock max or, if no stock, 1 mm above max path Z.
    double maxPathZ = 0.0;
    for (const auto& seg : result->planningSegments) {
        maxPathZ = std::max(maxPathZ, std::max(seg.start.z(), seg.end.z()));
    }
    const double safeZ = bounds.valid ? (bounds.maxZ + 10.0) : (maxPathZ + 1.0);

    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];
        const int lineNumber = ss.lineNumber;

        // Check both ends of the segment.
        auto check = [&](double x, double y, double z) {
            if (!bounds.valid) return;

            if (seg.isRapid) {
                if (insideBox(bounds, x, y, z) ||
                    (bounds.circularBed && z < bounds.maxZ && insideCircle(bounds, x, y))) {
                    violations.push_back({"rapid_collision", ANALYSIS_SEVERITY_HIGH,
                                          std::format("Rapid move into stock at line {} (Z={:.2f})", lineNumber, z),
                                          lineNumber, x, y, z});
                }
            } else {
                // Cutting move outside stock/bed
                bool inside = bounds.circularBed ? insideCircle(bounds, x, y)
                                                 : (x >= bounds.minX && x <= bounds.maxX &&
                                                    y >= bounds.minY && y <= bounds.maxY);
                if (!inside) {
                    violations.push_back({"out_of_bounds", ANALYSIS_SEVERITY_HIGH,
                                          std::format("Move outside build area at line {} (X={:.1f},Y={:.1f})",
                                                      lineNumber, x, y),
                                          lineNumber, x, y, z});
                }
                if (z < bounds.minZ) {
                    violations.push_back({"cut_below_stock", ANALYSIS_SEVERITY_HIGH,
                                          std::format("Cut below stock bottom at line {} (Z={:.2f})", lineNumber, z),
                                          lineNumber, x, y, z});
                }
            }

            // Rapid clearance check for CNC-like motion: rapids below safe Z.
            if (seg.isRapid && z < safeZ && z > 0.0) {
                violations.push_back({"clearance_violation", ANALYSIS_SEVERITY_MEDIUM,
                                      std::format("Rapid below safe Z ({:.2f} < {:.2f}) at line {}", z, safeZ, lineNumber),
                                      lineNumber, x, y, z});
            }
        };

        check(seg.start.x(), seg.start.y(), seg.start.z());
        check(seg.end.x(), seg.end.y(), seg.end.z());
    }

    auto* section = response.add_sections();
    section->set_section_name("stock_collision");
    section->set_display_name("Stock & Fixture Clearance");

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

    size_t rapidCollisions = 0;
    size_t clearance = 0;
    size_t outOfBounds = 0;
    size_t belowStock = 0;
    for (const auto& v : violations) {
        if (v.type == "rapid_collision") ++rapidCollisions;
        else if (v.type == "clearance_violation") ++clearance;
        else if (v.type == "out_of_bounds") ++outOfBounds;
        else if (v.type == "cut_below_stock") ++belowStock;
    }

    addMetric("stock_min_x", bounds.minX);
    addMetric("stock_max_x", bounds.maxX);
    addMetric("stock_min_y", bounds.minY);
    addMetric("stock_max_y", bounds.maxY);
    addMetric("stock_min_z", bounds.minZ);
    addMetric("stock_max_z", bounds.maxZ);
    addMetric("safe_z", safeZ);
    addIntMetric("rapid_collision_count", static_cast<int64_t>(rapidCollisions));
    addIntMetric("clearance_violation_count", static_cast<int64_t>(clearance));
    addIntMetric("out_of_bounds_count", static_cast<int64_t>(outOfBounds));
    addIntMetric("cut_below_stock_count", static_cast<int64_t>(belowStock));
    addIntMetric("total_violations", static_cast<int64_t>(violations.size()));

    double score = 100.0;
    score -= static_cast<double>(rapidCollisions) * 20.0;
    score -= static_cast<double>(belowStock) * 20.0;
    score -= static_cast<double>(outOfBounds) * 15.0;
    score -= static_cast<double>(clearance) * 10.0;
    section->set_score(std::clamp(score, 0.0, 100.0));
    section->set_total_event_count(static_cast<uint32_t>(violations.size()));
    section->set_has_more_events(violations.size() > topLimit);

    if (summaryOnly) return;

    std::sort(violations.begin(), violations.end(),
              [](const Violation& a, const Violation& b) {
                  return static_cast<int>(a.severity) > static_cast<int>(b.severity);
              });

    const size_t eventCount = std::min(topLimit, violations.size());
    for (size_t i = 0; i < eventCount; ++i) {
        const auto& v = violations[i];
        auto* e = section->add_top_events();
        e->set_id(std::format("{}:line{}:z{:.2f}", v.type, v.lineNumber, v.z));
        e->set_event_type(v.type);
        e->set_severity(v.severity);
        e->set_message(v.message);
        e->set_metric_value(0.0);
        e->set_details_json(std::format(
            R"({{"line":{},"x":{:.3f},"y":{:.3f},"z":{:.3f},"type":"{}","safe_z":{:.2f}}})" ,
            v.lineNumber, v.x, v.y, v.z, v.type, safeZ));
    }
}

} // namespace tether::web
