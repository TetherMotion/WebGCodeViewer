/// @file AnalysisSerializer.cpp
/// @brief Convert Tether IO analysis signals into AnalysisResultResponse protobuf.

#include "AnalysisSerializer.hpp"

#include "tether/io/Protocol.hpp"
#include "tether/io/Registry.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <map>
#include <span>
#include <string>

namespace tether::web {

namespace {

using namespace ::tether::viewer::v1;
using ::tether::io::EntryView;
using ::tether::io::Registry;
using ::tether::io::ValueType;

struct SectionInfo {
    std::string id;
    std::string display;
};

const SectionInfo& sectionForPrefix(const std::string& prefix) {
    static const std::map<std::string, SectionInfo> kMap = {
        {"ml",    {"machine_limit",      "Machine Limits"}},
        {"curv",  {"curvature",          "Curvature"}},
        {"arc",   {"arc",                "Arcs"}},
        {"modal", {"modal",              "Modal State"}},
        {"topo",  {"path_topology",      "Path Topology"}},
        {"eff",   {"toolpath_efficiency", "Toolpath Efficiency"}},
        {"ret",   {"retraction",         "Retraction"}},
        {"accel", {"acceleration_profile", "Acceleration Profile"}},
        {"coord", {"coordinate_system",  "Coordinate System"}},
        {"cont",  {"path_continuity",    "Path Continuity"}},
    };
    static const SectionInfo kFallback = {"other", "Other"};
    auto it = kMap.find(prefix);
    return (it != kMap.end()) ? it->second : kFallback;
}

void setMetric(AnalysisMetric* metric, const EntryView& entry) {
    ValueType vt = entry.valueType();
    if (::tether::io::isVariableLength(vt)) {
        if (vt == ValueType::String) {
            std::string buf(entry.maxValueSize(), '\0');
            size_t len = entry.readVar(buf.data(), buf.size());
            metric->set_string_value(buf.substr(0, len));
        }
        // Binary and Struct are not used by the analysis exposer; skip.
        return;
    }

    // Fixed-size scalar.
    switch (vt) {
        case ValueType::F64: {
            double v = 0;
            entry.read(&v);
            metric->set_double_value(v);
            break;
        }
        case ValueType::F32: {
            float v = 0;
            entry.read(&v);
            metric->set_double_value(static_cast<double>(v));
            break;
        }
        case ValueType::U8: {
            uint8_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::U16: {
            uint16_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::U32: {
            uint32_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::U64: {
            uint64_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::I8: {
            int8_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::I16: {
            int16_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::I32: {
            int32_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        case ValueType::I64: {
            int64_t v = 0;
            entry.read(&v);
            metric->set_int64_value(v);
            break;
        }
        case ValueType::Bool: {
            uint8_t v = 0;
            entry.read(&v);
            metric->set_bool_value(v != 0);
            break;
        }
        case ValueType::Enum: {
            uint32_t v = 0;
            entry.read(&v);
            metric->set_int64_value(static_cast<int64_t>(v));
            break;
        }
        default:
            break;
    }
}

} // namespace

::tether::viewer::v1::AnalysisResultResponse buildAnalysisResponse(const ::tether::io::Registry& registry) {
    using ::tether::viewer::v1::AnalysisMetric;
    using ::tether::viewer::v1::AnalysisSection;

    ::tether::viewer::v1::AnalysisResultResponse response;
    response.set_complete(true);

    std::map<std::string, AnalysisSection*> sections;

    const uint32_t totalSignals = registry.signalCount();
    constexpr uint32_t kPageSize = 128;

    for (uint32_t offset = 0; offset < totalSignals; offset += kPageSize) {
        uint32_t pageLen = std::min(kPageSize, totalSignals - offset);
        auto page = registry.signalPage(offset, pageLen);
        for (const auto& entry : page) {
            std::string name(entry.name());
            size_t dot = name.find('.');
            std::string prefix = (dot == std::string::npos) ? name : name.substr(0, dot);
            std::string metricKey = (dot == std::string::npos) ? name : name.substr(dot + 1);

            const auto& info = sectionForPrefix(prefix);

            AnalysisSection* section = nullptr;
            auto it = sections.find(info.id);
            if (it == sections.end()) {
                section = response.add_sections();
                section->set_section_name(info.id);
                section->set_display_name(info.display);
                section->set_score(100.0);
                section->set_total_event_count(0);
                section->set_has_more_events(false);
                sections.emplace(info.id, section);
            } else {
                section = it->second;
            }

            AnalysisMetric* metric = section->add_metrics();
            metric->set_key(metricKey);
            setMetric(metric, entry);

            // Derive the section score from a metric named "score" or ending in "_score".
            if (metricKey == "score" || (metricKey.size() > 6 && metricKey.substr(metricKey.size() - 6) == "_score")) {
                if (metric->has_double_value()) {
                    section->set_score(metric->double_value());
                } else if (metric->has_int64_value()) {
                    section->set_score(static_cast<double>(metric->int64_value()));
                }
            }

            // Derive a total event count from a metric named "count" or ending in "_count".
            if (metricKey == "count" || (metricKey.size() > 6 && metricKey.substr(metricKey.size() - 6) == "_count")) {
                uint32_t count = 0;
                if (metric->has_double_value()) {
                    count = static_cast<uint32_t>(metric->double_value());
                } else if (metric->has_int64_value()) {
                    count = static_cast<uint32_t>(metric->int64_value());
                } else if (metric->has_bool_value()) {
                    count = metric->bool_value() ? 1 : 0;
                }
                if (count > 0) {
                    section->set_total_event_count(section->total_event_count() + count);
                }
            }
        }
    }

    return response;
}

} // namespace tether::web
