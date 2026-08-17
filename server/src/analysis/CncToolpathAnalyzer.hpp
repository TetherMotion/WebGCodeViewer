/// @file CncToolpathAnalyzer.hpp
/// @brief Basic CNC toolpath, chip-load and MRR analysis.

#pragma once

#include "tether/web/GCodeProcessor.hpp"

#include <string>
#include <vector>

namespace tether::viewer::v1 {
class AnalysisResultResponse;
class GetAnalysisRequest;
} // namespace tether::viewer::v1

namespace tether::web {

void appendCncToolpathAnalysis(
    ::tether::viewer::v1::AnalysisResultResponse& response,
    const ProcessResult* result,
    const std::vector<std::string>& gcodeLines,
    const ::tether::viewer::v1::GetAnalysisRequest& request);

} // namespace tether::web
