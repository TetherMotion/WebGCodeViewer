#pragma once

/// @file GCodeProcessor.hpp
/// @brief Processes G-code text into TrajectorySample[] for visualization.
///
/// Pipeline: G-code text → PlanningSegment[] → TrajectoryAnalyzer → TrajectorySample[]
/// Also extracts G-code block metadata for the TTHR block section.

#include "tether/export/TrajectoryAnalyzer.hpp"
#include "tether/gcode/motion/InterpolationStrategy.hpp"
#include "tether/web/TrajectorySerializer.hpp"

#include <memory>
#include <string>
#include <vector>
#include <atomic>
#include <functional>

namespace tether::web {

/// @brief Configuration for G-code processing.
struct ProcessConfig {
    double sampleRate = 0.001;       ///< Sample time step (seconds)
    int derivativeOrder = 4;         ///< Central difference order (2, 4, 6)
    double maxVelocity = 200.0;      ///< mm/s velocity limit
    double maxAcceleration = 2000.0; ///< mm/s² acceleration limit
    double maxJerk = 20000.0;       ///< mm/s³ jerk limit
    std::string strategy = "FixedTime"; ///< Approximation strategy name
};

/// @brief Result of G-code processing.
struct ProcessResult {
    std::vector<GCodeExport::TrajectorySample> samples;
    std::vector<BlockMetadata> blocks;
    GCodeExport::TrajectoryStatistics statistics;
    double duration = 0.0;
    double pathLength = 0.0;
    size_t sampleCount = 0;
    bool success = false;
    std::string errorMessage;
};

/// @brief Processes G-code text into trajectory samples.
///
/// Parses G-code text to extract motion commands (G0/G1/G2/G3), converts
/// them to PlanningSegments, and feeds them through TrajectoryAnalyzer to
/// compute per-sample position, velocity, acceleration, jerk, and curvature.
class GCodeProcessor {
public:
    GCodeProcessor();
    ~GCodeProcessor();

    /// @brief Process G-code text synchronously.
    /// @param gcodeText Raw G-code text
    /// @param config Processing configuration
    /// @param progress Optional progress callback (0.0 to 1.0)
    /// @return Processing result with samples and statistics
    ProcessResult process(
        const std::string& gcodeText,
        const ProcessConfig& config = {},
        std::function<void(double)> progress = {});

    /// @brief Get the list of available approximation strategies.
    static std::vector<std::string> availableStrategies();

private:
    /// @brief Parse G-code text into PlanningSegments and block metadata.
    void parseGCode(
        const std::string& gcodeText,
        std::vector<GCode::PlanningSegment>& segments,
        std::vector<BlockMetadata>& blocks);

    /// @brief Compute segment time from feed rate and distance.
    void computeSegmentTimes(std::vector<GCode::PlanningSegment>& segments);

    /// @brief Compute statistics from samples.
    GCodeExport::TrajectoryStatistics computeStats(
        const std::vector<GCodeExport::TrajectorySample>& samples);
};

} // namespace tether::web
