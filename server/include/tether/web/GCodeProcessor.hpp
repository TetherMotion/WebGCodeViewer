#pragma once

/// @file GCodeProcessor.hpp
/// @brief Processes G-code text into trajectory data for visualization.
///
/// Primary pipeline: G-code text → PlanningSegmentBuilder → PlanningSegment[]
/// → piecewiseNurbsFromSegments() → PiecewiseNurbsPath
/// (fast, O(segments) — used for NBP/NURBS rendering)
///
/// Fallback pipeline: G-code text → PlanningSegmentBuilder → PlanningSegment[]
/// → TrajectoryAnalyzer → TrajectorySample[]
/// (slow, O(samples) — only used when TTHR sampled data is explicitly requested)
///
/// G-code parsing, segment-time computation, corner-deviation analysis, and
/// NURBS path construction are delegated to Tether libraries (tether_gcode
/// and tether_motion_planner). This class retains only viewer-specific
/// orchestration: extruder-speed computation, per-segment miniplot data,
/// and optional dense sampling via TrajectoryAnalyzer.

#include "tether/export/TrajectoryAnalyzer.hpp"
#include "tether/gcode/motion/InterpolationStrategy.hpp"
#include "tether/gcode/PlanningSegmentBuilder.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "tether/motion_planner/geometry/PiecewiseNurbsPath.hpp"
#include "tether/motion_planner/geometry/PlanningSegmentConverter.hpp"
#include "tether/motion_planner/profile_renurbs/ReNURBSProfile.hpp"
#include "tether/web/PaProfileBuilder.hpp"

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
    /// Non-fatal warning message (e.g. parse errors with recovered segments).
    /// Shown to the user but doesn't prevent loading.
    std::string warning;

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

    /// Parsed PlanningSegments — retained for G-code analysis queries.
    /// Populated during process() from PlanningSegmentBuilder output.
    std::vector<GCode::PlanningSegment> planningSegments;

    /// G-code block metadata from PlanningSegmentBuilder (original GCode namespace).
    std::vector<GCode::BlockMetadata> gcodeBlocks;

    /// ReNURBS profile — per-segment NURBS curves for v(s), a(s), j(s), t(s).
    /// Built from the velocity profile (BasicTOPPRA) fitted to NURBS curves.
    /// WAY smaller than dense samples: O(segments × controlPoints) vs O(samples).
    /// Used for shader-based velocity/acceleration/jerk visualization.
    std::optional<tether::motion::profile_renurbs::ReNURBSProfile> renurbsProfile;

    /// Maximum velocity/acceleration/jerk values across all segments.
    /// Used for normalization in the frontend color mapping.
    float renurbsMaxVelocity = 0.0f;
    float renurbsMaxAcceleration = 0.0f;
    float renurbsMaxJerk = 0.0f;
    float renurbsMaxTime = 0.0f;

    /// Pressure advance profiles — one per algorithm (Linear, PowerLaw,
    /// CrossWLF, LTI-Deconv, LPV-Deconv). Each contains pre-PA velocity
    /// and post-PA offset as ReNURBS curves. Selectable in the UI.
    std::vector<PaProfileResult> paProfiles;
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
    /// @brief Compute per-segment extruder speed (mm/s) from E axis movement.
    /// Converts E delta (stored in seg.exitVelocity) to mm/s using segment time.
    void computeExtruderSpeed(std::vector<GCode::PlanningSegment>& segments);

    /// @brief Compute per-segment corner deviation (%) using Tether's
    /// CornerAnalyzer. Stores deviation in seg.entryVelocity.
    void computeCornerDeviation(std::vector<GCode::PlanningSegment>& segments);
};

} // namespace tether::web
