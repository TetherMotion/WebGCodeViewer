#pragma once

/// @file PressureAdvanceProfileBuilder.hpp
/// @brief Computes pressure advance parameters for multiple algorithms
///        (Linear, PowerLaw, CrossWLF, LTI deconvolution, LPV deconvolution).
///
/// Parameters are packaged into PressureAdvanceParamBlock structs and sent
/// to the frontend, which evaluates PA analytically in WGSL shaders using
/// the WSS arcs (from TWSF v2) and per-arc extrusion ratios.
///
/// No sampling, no ReNURBS fitting — O(1) in trajectory length.

#include "tether/motion_planner/VelocityProfile.hpp"

#include <string>
#include <vector>

namespace tether::web {

/// PA algorithm identifiers (selectable in the UI).
enum class PressureAdvanceAlgorithm : uint8_t {
    Linear      = 0,  ///< Classic Klipper: δe = PA · v_e
    PowerLaw    = 1,  ///< Non-Newtonian: δe = K_base · (v_e · A_f)^n
    CrossWlf    = 2,  ///< Temperature-dependent Cross-WLF
    LtiDeconv   = 3,  ///< LTI frequency-domain deconvolution
    LpvDeconv   = 4,  ///< LPV gain-scheduled overlap-add deconvolution
};

/// Configuration for PA computation.
struct PressureAdvanceConfig {
    /// PA algorithm to use.
    PressureAdvanceAlgorithm algorithm = PressureAdvanceAlgorithm::Linear;

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

/// Get the algorithm name as a string.
std::string pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm algo);

// ============================================================================
// Analytical parameter-based API (no sampling, no ReNURBS fitting)
// ============================================================================

/// Per-algorithm parameter block (variable size, see PressureAdvanceSerializer).
/// Contains raw PA parameters that the frontend evaluates analytically in
/// WGSL shaders using the WSS arcs (from TWSF v2) and extrusion ratios.
struct PressureAdvanceParamBlock {
    PressureAdvanceAlgorithm algorithm = PressureAdvanceAlgorithm::Linear;
    std::string algorithmName;
    float maxOffset = 0.0f;
    float maxVelocity = 0.0f;

    // Linear parameters
    float pressureAdvance = 0.0f;
    float smoothTime = 0.0f;
    float maxCompensation = 0.0f;

    // PowerLaw parameters
    float powerLawBaseGain = 0.0f;
    float flowIndex = 1.0f;
    float filamentDiameter = 1.75f;

    // CrossWLF parameters
    float crossWlfCompressibility = 1e-5f;
    float meltTempC = 210.0f;
    std::vector<float> qGrid;        // Flow rate grid [mm³/s]
    std::vector<float> tempGrid;     // Temperature grid [°C]
    std::vector<float> pValues;      // Pressure LUT [qGridCount × tempGridCount]

    // LTI/LPV parameters
    float groupDelay = 0.0f;
    std::vector<float> moments;      // LTI: 4 moments. LPV: 4 per op point.

    // LPV parameters
    std::vector<float> opPointVelocities;  // Operating point velocities
    // For LPV, moments is opPointCount × 4, flattened
};

/// Compute PA parameters for ALL algorithms (no sampling, no ReNURBS fitting).
/// Returns compact parameter blocks that the frontend evaluates analytically
/// in WGSL shaders using the WSS arcs.
/// @param config PA configuration
/// @return Vector of PA parameter blocks, one per algorithm
std::vector<PressureAdvanceParamBlock> computeAllPressureAdvanceParams(
    const PressureAdvanceConfig& config = {});

} // namespace tether::web
