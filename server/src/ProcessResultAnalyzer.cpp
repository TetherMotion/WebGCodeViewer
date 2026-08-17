/// @file ProcessResultAnalyzer.cpp
/// @brief ProcessResult-driven material, time, layer, and feature analysis.

#include "ProcessResultAnalyzer.hpp"
#include "proto/tether_viewer.pb.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <format>
#include <limits>
#include <map>
#include <numbers>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace tether::web {

namespace {

using ::tether::viewer::v1::AnalysisMetric;
using ::tether::viewer::v1::AnalysisSection;
using ::tether::viewer::v1::AnalysisEvent;

constexpr double kFilamentDiameterMm = 1.75;
constexpr double kFilamentDensityGPerCm3 = 1.24; // PLA
constexpr double kLayerZSnap = 0.01;              // layer grouping resolution (mm)

struct LayerAggregate {
    double z = 0.0;
    double time = 0.0;
    double extrusion = 0.0;
    double pathLength = 0.0;
    uint32_t count = 0;
};

struct FeatureAggregate {
    std::string name;
    double time = 0.0;
    double extrusion = 0.0;
    double pathLength = 0.0;
    uint32_t count = 0;
};

/// Remove comments and whitespace, leaving just the G-code words for parsing.
std::string stripGcodeComments(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    bool inParen = false;
    for (char c : raw) {
        if (c == '(') {
            inParen = true;
            continue;
        }
        if (c == ')') {
            inParen = false;
            continue;
        }
        if ((c == ';' || c == '%') && !inParen) break;
        if (!inParen) out.push_back(c);
    }
    return out;
}

std::string toUpper(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
    return s;
}

std::string trim(std::string_view s) {
    size_t start = 0;
    while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) ++start;
    size_t end = s.size();
    while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) --end;
    return std::string(s.substr(start, end - start));
}

/// Find the first word starting with `letter` and parse the numeric value.
std::optional<double> findWordValue(const std::string& line, char letter) {
    const char uc = static_cast<char>(std::toupper(static_cast<unsigned char>(letter)));
    for (size_t i = 0; i < line.size(); ++i) {
        if (line[i] != uc) continue;
        size_t j = i + 1;
        while (j < line.size() &&
               (std::isdigit(static_cast<unsigned char>(line[j])) ||
                line[j] == '.' || line[j] == '-' || line[j] == '+')) {
            ++j;
        }
        if (j > i + 1) {
            try {
                return std::stod(line.substr(i + 1, j - i - 1));
            } catch (...) {
                return std::nullopt;
            }
        }
    }
    return std::nullopt;
}

/// Per-line signed E-axis delta (mm). Tracks M82/M83, G90/G91, G92 E, etc.
std::vector<double> computeEdeltas(const std::vector<std::string>& gcodeLines) {
    std::vector<double> deltas(gcodeLines.size(), 0.0);
    double currentE = 0.0;
    bool absoluteE = true; // M82 / G90

    for (size_t i = 0; i < gcodeLines.size(); ++i) {
        const std::string line = stripGcodeComments(gcodeLines[i]);

        // M82/M83 or G90/G91 toggles
        bool sawM82Or83 = false;
        if (auto m = findWordValue(line, 'M')) {
            if (*m == 82.0) { absoluteE = true; sawM82Or83 = true; }
            else if (*m == 83.0) { absoluteE = false; sawM82Or83 = true; }
        }
        if (!sawM82Or83) {
            if (auto g = findWordValue(line, 'G')) {
                if (*g == 90.0) absoluteE = true;
                else if (*g == 91.0) absoluteE = false;
            }
        }

        // G92 E0 (or any E) resets the extruder position without moving.
        if (auto g = findWordValue(line, 'G')) {
            if (*g == 92.0) {
                if (auto e = findWordValue(line, 'E')) {
                    currentE = *e;
                }
            }
        }

        // G0-G3 with an E word produce an extrusion/retraction delta.
        if (auto g = findWordValue(line, 'G')) {
            if (*g >= 0.0 && *g <= 3.0) {
                if (auto e = findWordValue(line, 'E')) {
                    double eDelta = absoluteE ? (*e - currentE) : *e;
                    currentE += eDelta;
                    deltas[i] = eDelta;
                }
            }
        }
    }

    return deltas;
}

/// Extract a slicer feature-type comment value (e.g. ;TYPE:PERIMETER).
std::optional<std::string> extractFeatureTag(std::string_view raw, std::string_view prefix) {
    // Require the line to start with an optional ';' and the prefix.
    std::string_view s = raw;
    size_t i = 0;
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
    if (i < s.size() && s[i] == ';') ++i;
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;

    if (s.compare(i, prefix.size(), prefix) != 0) return std::nullopt;
    i += prefix.size();
    if (i < s.size() && s[i] == ':') ++i;
    return toUpper(trim(s.substr(i)));
}

/// Per-line active slicer feature type, derived from TYPE/MESH/FEATURE comments.
std::vector<std::string> computeFeatures(const std::vector<std::string>& gcodeLines) {
    std::vector<std::string> features(gcodeLines.size(), "UNKNOWN");
    std::string current = "UNKNOWN";

    for (size_t i = 0; i < gcodeLines.size(); ++i) {
        if (auto f = extractFeatureTag(gcodeLines[i], "TYPE")) {
            current = *f;
        } else if (auto m = extractFeatureTag(gcodeLines[i], "MESH")) {
            current = "MESH:" + *m;
        } else if (auto f = extractFeatureTag(gcodeLines[i], "FEATURE")) {
            current = *f;
        }
        features[i] = current;
    }

    return features;
}

AnalysisMetric* addDoubleMetric(AnalysisSection* section, const std::string& key, double value) {
    auto* m = section->add_metrics();
    m->set_key(key);
    m->set_double_value(value);
    return m;
}

AnalysisMetric* addIntMetric(AnalysisSection* section, const std::string& key, int64_t value) {
    auto* m = section->add_metrics();
    m->set_key(key);
    m->set_int64_value(value);
    return m;
}

} // namespace

void appendProcessResultAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request) {

    using ::tether::viewer::v1::ANALYSIS_SEVERITY_INFO;

    auto* materialSection = response.add_sections();
    materialSection->set_section_name("material_time");
    materialSection->set_display_name("Material & Time");
    materialSection->set_score(100.0);
    materialSection->set_total_event_count(0);
    materialSection->set_has_more_events(false);

    if (!result || !result->success || result->planningSegments.empty() || result->segmentSpeeds.empty()) {
        auto* m = materialSection->add_metrics();
        m->set_key("status");
        m->set_string_value("process_result_unavailable");
        return;
    }

    const size_t n = std::min(result->planningSegments.size(), result->segmentSpeeds.size());
    const auto& edeltas = computeEdeltas(gcodeLines);
    const auto& features = computeFeatures(gcodeLines);

    double totalTime = 0.0;
    double totalPath = 0.0;
    double totalExtrusion = 0.0;
    double cutTime = 0.0;
    double cutPath = 0.0;
    double rapidTime = 0.0;
    double rapidPath = 0.0;

    std::map<int64_t, LayerAggregate> layerMap;
    std::unordered_map<std::string, FeatureAggregate> featureMap;

    for (size_t i = 0; i < n; ++i) {
        const auto& seg = result->planningSegments[i];
        const auto& ss = result->segmentSpeeds[i];

        const int lineNumber = ss.lineNumber; // 1-based
        const size_t lineIndex = (lineNumber >= 1) ? static_cast<size_t>(lineNumber - 1) : std::numeric_limits<size_t>::max();

        const double eDelta = (lineIndex < gcodeLines.size()) ? edeltas[lineIndex] : 0.0;
        const double extrusion = std::max(0.0, eDelta);
        const double duration = ss.duration;
        const double path = seg.segmentLength;

        totalTime += duration;
        totalPath += path;
        totalExtrusion += extrusion;

        if (seg.isRapid) {
            rapidTime += duration;
            rapidPath += path;
        } else {
            cutTime += duration;
            cutPath += path;
        }

        int64_t zKey = std::llround(seg.start.z() / kLayerZSnap);
        LayerAggregate& layer = layerMap[zKey];
        layer.z = zKey * kLayerZSnap;
        layer.time += duration;
        layer.extrusion += extrusion;
        layer.pathLength += path;
        ++layer.count;

        std::string feature = (lineIndex < gcodeLines.size()) ? features[lineIndex] : "UNKNOWN";
        FeatureAggregate& feat = featureMap[feature];
        feat.name = std::move(feature);
        feat.time += duration;
        feat.extrusion += extrusion;
        feat.pathLength += path;
        ++feat.count;
    }

    const double radius = kFilamentDiameterMm / 2.0;
    const double volume = totalExtrusion * std::numbers::pi * radius * radius;
    const double weight = (volume / 1000.0) * kFilamentDensityGPerCm3;

    addDoubleMetric(materialSection, "total_duration_s", totalTime);
    addDoubleMetric(materialSection, "total_path_length_mm", totalPath);
    addDoubleMetric(materialSection, "total_extrusion_mm", totalExtrusion);
    addDoubleMetric(materialSection, "total_volume_mm3", volume);
    addDoubleMetric(materialSection, "total_weight_g", weight);
    addDoubleMetric(materialSection, "cutting_time_s", cutTime);
    addDoubleMetric(materialSection, "travel_time_s", rapidTime);
    addDoubleMetric(materialSection, "cutting_distance_mm", cutPath);
    addDoubleMetric(materialSection, "travel_distance_mm", rapidPath);
    addDoubleMetric(materialSection, "average_speed_mm_s", totalTime > 1e-9 ? totalPath / totalTime : 0.0);
    addDoubleMetric(materialSection, "average_cutting_speed_mm_s", cutTime > 1e-9 ? cutPath / cutTime : 0.0);
    addIntMetric(materialSection, "layer_count", static_cast<int64_t>(layerMap.size()));
    addIntMetric(materialSection, "feature_count", static_cast<int64_t>(featureMap.size()));

    const std::string& detail = request.detail_level();
    const bool summaryOnly = (detail == "summary");
    const bool fullEvents = (detail == "full");
    const size_t topLimit = (request.top_event_limit() > 0)
                                ? static_cast<size_t>(request.top_event_limit())
                                : (fullEvents ? std::numeric_limits<size_t>::max() : 50);

    if (summaryOnly) return;

    // ── Layer summary ──────────────────────────────────────────────────────────
    if (!layerMap.empty()) {
        auto* layerSection = response.add_sections();
        layerSection->set_section_name("layer_summary");
        layerSection->set_display_name("Per-Layer Summary");
        layerSection->set_score(100.0);
        layerSection->set_total_event_count(static_cast<uint32_t>(layerMap.size()));
        layerSection->set_has_more_events(layerMap.size() > topLimit);

        addIntMetric(layerSection, "layer_count", static_cast<int64_t>(layerMap.size()));
        addDoubleMetric(layerSection, "total_extrusion_mm", totalExtrusion);
        addDoubleMetric(layerSection, "total_time_s", totalTime);

        std::vector<LayerAggregate> layers;
        layers.reserve(layerMap.size());
        for (const auto& [key, agg] : layerMap) layers.push_back(agg);

        const size_t eventCount = std::min(topLimit, layers.size());
        for (size_t i = 0; i < eventCount; ++i) {
            const auto& l = layers[i];
            auto* ev = layerSection->add_top_events();
            ev->set_id(std::format("layer:{:.2f}", l.z));
            ev->set_event_type("layer");
            ev->set_severity(ANALYSIS_SEVERITY_INFO);
            ev->set_message(std::format("Layer Z={:.2f} mm", l.z));
            ev->set_metric_value(l.extrusion);
            ev->set_details_json(std::format(
                R"({{"z":{:.2f},"time_s":{:.3f},"extrusion_mm":{:.2f},"path_length_mm":{:.2f},"segment_count":{}}})",
                l.z, l.time, l.extrusion, l.pathLength, l.count));
        }
    }

    // ── Feature summary ────────────────────────────────────────────────────────
    if (!featureMap.empty()) {
        auto* featureSection = response.add_sections();
        featureSection->set_section_name("feature_summary");
        featureSection->set_display_name("Per-Feature Summary");
        featureSection->set_score(100.0);
        featureSection->set_total_event_count(static_cast<uint32_t>(featureMap.size()));
        featureSection->set_has_more_events(featureMap.size() > topLimit);

        addIntMetric(featureSection, "feature_count", static_cast<int64_t>(featureMap.size()));
        addDoubleMetric(featureSection, "total_extrusion_mm", totalExtrusion);
        addDoubleMetric(featureSection, "total_time_s", totalTime);

        std::vector<FeatureAggregate> feats;
        feats.reserve(featureMap.size());
        for (auto& [name, agg] : featureMap) feats.push_back(std::move(agg));
        std::sort(feats.begin(), feats.end(),
                  [](const FeatureAggregate& a, const FeatureAggregate& b) {
                      return a.extrusion > b.extrusion;
                  });

        const size_t eventCount = std::min(topLimit, feats.size());
        for (size_t i = 0; i < eventCount; ++i) {
            const auto& f = feats[i];
            auto* ev = featureSection->add_top_events();
            ev->set_id(std::format("feature:{}", f.name));
            ev->set_event_type(f.name);
            ev->set_severity(ANALYSIS_SEVERITY_INFO);
            ev->set_message(std::format("{}: {:.1f} mm, {}", f.name, f.extrusion,
                                        std::format("{:.3f} s", f.time)));
            ev->set_metric_value(f.extrusion);
            ev->set_details_json(std::format(
                R"({{"time_s":{:.3f},"extrusion_mm":{:.2f},"path_length_mm":{:.2f},"segment_count":{}}})",
                f.time, f.extrusion, f.pathLength, f.count));
        }
    }
}

} // namespace tether::web
