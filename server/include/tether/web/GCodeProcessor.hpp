#pragma once

/// @file GCodeProcessor.hpp
/// @brief Processes G-code text into trajectory data for visualization.
///
/// Primary pipeline: G-code text → PlanningSegment[] → NurbsCurve[] → PiecewiseNurbsPath
/// (fast, O(segments) — used for NBP/NURBS rendering)
///
/// Fallback pipeline: G-code text → PlanningSegment[] → TrajectoryAnalyzer → TrajectorySample[]
/// (slow, O(samples) — only used when TTHR sampled data is explicitly requested)

#include "tether/export/TrajectoryAnalyzer.hpp"
#include "tether/gcode/motion/InterpolationStrategy.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "tether/motion_planner/geometry/PiecewiseNurbsPath.hpp"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>
#include <atomic>
#include <functional>

namespace tether::web {

/// @brief Per-segment speed data for miniplot visualization.
struct SegmentSpeed {
    double timeStart = 0.0;      ///< Time at start of segment (seconds)
    double duration = 0.0;       ///< Segment duration (seconds)
    int32_t blockIndex = -1;     ///< G-code block index
    int32_t lineNumber = 0;      ///< G-code line number
    double speedX = 0.0;        ///< X axis speed (mm/s)
    double speedY = 0.0;        ///< Y axis speed (mm/s)
    double speedZ = 0.0;        ///< Z axis speed (mm/s)
    double speedE = 0.0;        ///< Extruder speed (mm/s)
    double speedLinear = 0.0;   ///< Linear velocity magnitude (mm/s)
};

/// @brief Configuration for G-code processing.
struct ProcessConfig {
    double sampleRate = 0.001;       ///< Sample time step (seconds)
    int derivativeOrder = 4;         ///< Central difference order (2, 4, 6)
    double maxVelocity = 200.0;      ///< mm/s velocity limit
    double maxAcceleration = 2000.0; ///< mm/s² acceleration limit
    double maxJerk = 20000.0;       ///< mm/s³ jerk limit
    std::string strategy = "FixedTime"; ///< Approximation strategy name
    /// If true, skip dense sampling (TrajectoryAnalyzer) and only build
    /// the NURBS path. Samples will be empty. Default true since the
    /// viewer uses NURBS rendering.
    bool nurbsOnly = true;
};

/// @brief Result of G-code processing.
struct ProcessResult {
    /// NURBS path — built directly from segments (fast, always available).
    std::optional<tether::motion::PiecewiseNurbsPath> nurbsPath;

    /// Dense sampled trajectory — only populated if nurbsOnly=false.
    /// Can be very large (millions of samples) for big G-code files.
    std::vector<GCodeExport::TrajectorySample> samples;

    std::vector<BlockMetadata> blocks;
    GCodeExport::TrajectoryStatistics statistics;
    double duration = 0.0;
    double pathLength = 0.0;
    size_t sampleCount = 0;
    bool success = false;
    std::string errorMessage;

    /// Per-piece G64 corner deviation % (0-100). One entry per NURBS piece.
    /// Populated by computeCornerDeviation() during processing.
    std::vector<float> deviations;

    /// Per-piece extruder speed in mm/s. One entry per NURBS piece.
    /// Populated by computeExtruderSpeed() during processing.
    /// 0 for non-extruding moves (G0, or G1 without E).
    std::vector<float> extruderSpeeds;

    /// Per-segment speed data for miniplot visualization.
    /// One entry per segment (before NURBS piece filtering).
    std::vector<SegmentSpeed> segmentSpeeds;
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

    /// @brief Compute per-segment corner deviation (%) from G64 tolerance.
    /// Stores deviation in seg.entryVelocity (repurposed for visualization).
    void computeCornerDeviation(std::vector<GCode::PlanningSegment>& segments);

    /// @brief Compute per-segment extruder speed (mm/s) from E axis movement.
    /// Converts E delta (stored in seg.exitVelocity) to mm/s using segment time.
    void computeExtruderSpeed(std::vector<GCode::PlanningSegment>& segments);

    /// @brief Build a PiecewiseNurbsPath directly from PlanningSegments.
    /// Uses NurbsCurve::fromLine for linear/rapid segments and
    /// NurbsCurve::fromArc for arc segments. O(segments) — fast.
    /// @return {path, {per-piece deviations, per-piece extruder speeds}}
    std::pair<tether::motion::PiecewiseNurbsPath, std::pair<std::vector<float>, std::vector<float>>>
    buildNurbsFromSegments(
        const std::vector<GCode::PlanningSegment>& segments);

    /// @brief Compute statistics from samples.
    GCodeExport::TrajectoryStatistics computeStats(
        const std::vector<GCodeExport::TrajectorySample>& samples);
};

} // namespace tether::web
