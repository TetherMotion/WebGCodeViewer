/// @file AnalysisSerializer.hpp
/// @brief Convert Tether analysis exposer signals into viewer protobuf messages.

#pragma once

#include "proto/tether_viewer.pb.h"

#include <cstdint>
#include <string>

namespace tether::io {
class Registry;
}

namespace tether::web {

/// @brief Build an AnalysisResultResponse from a populated Tether IO Registry.
///
/// The AnalysisExposer registers one signal per scalar metric, with names like
/// "ml.violation_count" or "curv.max_curvature". This function groups signals
/// by their prefix, normalises the prefix to a stable section id, and emits
/// one AnalysisSection per analyzer. New analyzers can be added to the C++ side
/// without any changes here as long as they follow the same dotted naming
/// convention.
::tether::viewer::v1::AnalysisResultResponse buildAnalysisResponse(const tether::io::Registry& registry);

} // namespace tether::web
