/// @file ProcessResultAnalyzer.hpp
/// @brief Derive material/time/layer/feature analysis from an already parsed G-code job.

#pragma once

#include "tether/web/GCodeProcessor.hpp"

#include <string>
#include <vector>

// Forward declarations of the generated protobuf types so this public header
// does not pull in the private proto include path.
namespace tether::viewer::v1 {
class AnalysisResultResponse;
class GetAnalysisRequest;
} // namespace tether::viewer::v1

namespace tether::web {

/// @brief Append material, time, per-layer and per-feature analysis sections to
/// the given AnalysisResultResponse using the already computed ProcessResult.
///
/// This avoids re-parsing the G-code text for geometry; it reuses the
/// PlanningSegments, per-segment timing, and raw G-code lines kept by the
/// server-side JobManager.
///
/// @param response AnalysisResultResponse to append sections to.
/// @param result Pointer to the ProcessResult for the job, or nullptr if not ready.
/// @param gcodeLines Original G-code text split into lines.
/// @param request The GetAnalysisRequest controlling detail level and event caps.
void appendProcessResultAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request);

} // namespace tether::web
