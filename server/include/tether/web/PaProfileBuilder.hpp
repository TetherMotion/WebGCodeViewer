#pragma once

/// @file PaProfileBuilder.hpp
/// @brief Computes pressure advance profiles using multiple algorithms
///        (Linear, PowerLaw, CrossWLF, LTI deconvolution, LPV deconvolution)
///        and fits each to ReNURBS curves for compact representation.
///
/// For each PA algorithm, two quantities are computed:
/// - "pre":  Raw extruder velocity (before PA compensation)
/// - "post": Compensated position offset (the PA offset δe)
///
/// Both are fitted to NURBS curves via buildPressureAdvanceReNURBS() and
/// serialized in the extended TRNP format for GPU-side evaluation.

#include "tether/motion_planner/VelocityProfile.hpp"
#include "tether/motion_planner/profile_renurbs/GenericReNURBSProfile.hpp"
#include "tether/motion_planner/profile_renurbs/GenericReNURBSBuilder.hpp"
#include "tether/motion_planner/analytical/extrusion/AnalyticalExtrusionTypes.hpp"

#include <string>
#include <vector>
#include <optional>

namespace tether::web {

/// PA algorithm identifiers (selectable in the UI).
enum class PaAlgorithm : uint8_t {
    Linear      = 0,  ///< Classic Klipper: δe = PA · v_e
    PowerLaw    = 1,  ///< Non-Newtonian: δe = K_base · (v_e · A_f)^n
    CrossWlf    = 2,  ///< Temperature-dependent Cross-WLF
    LtiDeconv   = 3,  ///< LTI frequency-domain deconvolution
    LpvDeconv   = 4,  ///< LPV gain-scheduled overlap-add deconvolution
};

/// Configuration for PA computation.
struct PaConfig {
    /// PA algorithm to use.
    PaAlgorithm algorithm = PaAlgorithm::Linear;

    /// Linear PA amount in seconds (for Linear algorithm).
    double pressureAdvance = 0.045;

    /// Smoothing window in seconds.
    double smoothTime = 0.040;

    /// Maximum absolute compensation [mm] (safety clamp).
    double maxCompensation = 0.5;

    /// Filament diameter [mm].
    double filamentDiameter = 1.75;

    // PowerLaw parameters
    double powerLawBaseGain = 0.0;     ///< K_base [filament-mm / (mm³/s)^n]
    double flowIndex = 1.0;            ///< Flow index n (1 = Newtonian)

    // CrossWLF parameters
    double crossWlfCompressibility = 1e-5;  ///< βV_m/A_f [mm/Pa]
    double meltTempC = 210.0;               ///< Melt temperature [°C]

    // LTI/LPV deconvolution parameters
    double ltiLambda = 1e-6;           ///< Tikhonov regularization λ
    int lpvBlockSize = 256;            ///< LPV block size
    double lpvOverlapRatio = 0.5;      ///< LPV overlap ratio

    /// Sample interval for PA computation [s].
    double sampleInterval = 0.001;
};

/// A single PA profile result (one algorithm).
struct PaProfileResult {
    PaAlgorithm algorithm;
    std::string algorithmName;
    /// ReNURBS profile with 2 quantities: "pressure_offset" and "extruder_velocity"
    std::optional<tether::motion::profile_renurbs::GenericReNURBSProfile> profile;
    float maxOffset = 0.0f;     ///< Max |offset| for normalization
    float maxVelocity = 0.0f;   ///< Max extruder velocity for normalization
};

/// Compute PA profiles for ALL algorithms and fit each to ReNURBS curves.
/// @param velocityProfile The velocity profile from the motion planner
/// @param extrusionRatio E_delta / path_length per segment (0 for non-extruding moves)
/// @param config PA configuration
/// @param trajectory Optional ExtrusionTrajectory (from WSS) for analytical PA.
///                   If provided, analytical PA algorithms are used instead of
///                   control-level sampled-space classes.
/// @return Vector of PA profile results, one per algorithm
std::vector<PaProfileResult> computeAllPaProfiles(
    const MotionPlanner::VelocityProfile<double>& velocityProfile,
    const std::vector<double>& extrusionRatios,
    const PaConfig& config = {},
    const MotionPlanner::analytical::extrusion::ExtrusionTrajectory<3, double>* trajectory = nullptr);

/// Compute a single PA profile for the specified algorithm.
/// @param velocityProfile The velocity profile from the motion planner
/// @param extrusionRatio E_delta / path_length per segment (0 for non-extruding moves)
/// @param config PA configuration (algorithm field selects which to compute)
/// @param trajectory Optional ExtrusionTrajectory (from WSS) for analytical PA.
/// @return PA profile result
PaProfileResult computePaProfile(
    const MotionPlanner::VelocityProfile<double>& velocityProfile,
    const std::vector<double>& extrusionRatios,
    const PaConfig& config,
    const MotionPlanner::analytical::extrusion::ExtrusionTrajectory<3, double>* trajectory = nullptr);

/// Get the algorithm name as a string.
std::string paAlgorithmName(PaAlgorithm algo);

} // namespace tether::web
