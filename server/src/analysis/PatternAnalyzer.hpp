/// @file PatternAnalyzer.hpp
/// @brief Detect recurring toolpath patterns (spirals, concentric contours,
///        zigzags, arcs and linear moves) from a parsed G-code job.

#pragma once

#include "tether/web/GCodeProcessor.hpp"

#include <string>
#include <vector>

namespace tether::viewer::v1 {
class AnalysisResultResponse;
class GetAnalysisRequest;
} // namespace tether::viewer::v1

namespace tether::web {

/// @brief Append a pattern-analysis section to the given AnalysisResultResponse
/// using the already computed ProcessResult.
///
/// Detects spiral, concentric-contour, and zigzag toolpath patterns, and emits
/// summary metrics plus top events depending on the requested detail level.
///
/// @param response AnalysisResultResponse to append a section to.
/// @param result Pointer to the ProcessResult for the job, or nullptr if not ready.
/// @param gcodeLines Original G-code text split into lines (used for line mapping).
/// @param request The GetAnalysisRequest controlling detail level and event caps.
void appendPatternAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request);

} // namespace tether::web
