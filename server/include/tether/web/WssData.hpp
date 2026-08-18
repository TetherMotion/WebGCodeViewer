#pragma once

/// @file WssData.hpp
/// @brief Analytical Weighted Switching Structure (WSS) data for the WebGPU UI.
///
/// The WSS is the analytical solution of the Pareto-optimal time-energy
/// velocity planning problem. It is a list of weighted arcs, each of which
/// is analytically integrable in the time domain:
///
/// - BANG_PLUS  (η = +η_max): a(t) = a0 + η·τ,  v(t) = v0 + a0·τ + ½η·τ²
/// - BANG_MINUS (η = -η_max): same formulas with negative η
/// - SINGULAR   (η = 0):      a(t) = a*,         v(t) = v0 + a*·τ
/// - WALL       (v = v_wall): velocity limited by path curvature
///
/// The WSS is transferred to the client as-is (no sampling). The WebGPU
/// shaders evaluate v(s), a(s), j(s), t(s) in closed form at the exact
/// points needed for rendering. For WALL arcs, the shader evaluates
/// v_wall(s) from the NURBS path curvature + transferred kinematic limits.
///
/// This replaces the former StateProfile (TSSP) sampled texture approach,
/// which used a fixed 1024×4 float grid — inadequate for large prints and
/// fundamentally at odds with the all-analytical pipeline design.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace tether::web {

/// @brief Arc type in the weighted switching structure.
/// Values match the Tether WeightedArcType enum for consistency.
enum class WssArcType : uint8_t {
    BangPlus  = 0,  ///< η = +η_max (raising acceleration toward a*)
    BangMinus = 1,  ///< η = -η_max (lowering acceleration toward a*)
    Singular  = 2,  ///< η = 0, a = a* (constant acceleration cruising)
    Wall      = 3,  ///< v = v_wall(s); acceleration slaved to geometry
};

/// @brief A single WSS arc, stored as f32 for direct GPU upload.
///
/// Each arc is 48 bytes (3 × vec4) for shader-friendly alignment:
///   vec4 A: (s0, s1, t0, v0)
///   vec4 B: (a0, eta, a_star, duration)
///   vec4 C: (type, 0, 0, 0)
///
/// For BANG arcs (type 0 or 1):
///   a(τ) = a0 + eta·τ
///   v(τ) = v0 + a0·τ + ½·eta·τ²
///   Δs(τ) = v0·τ + ½·a0·τ² + (1/6)·eta·τ³
///
/// For SINGULAR arcs (type 2):
///   a(τ) = a_star
///   v(τ) = v0 + a_star·τ
///   Δs(τ) = v0·τ + ½·a_star·τ²
///
/// For WALL arcs (type 3):
///   v(s) = v_wall(s) — evaluated by the shader from NURBS curvature
///   a(s) = v · dv_wall/ds
///   j(s) = 0
#pragma pack(push, 1)
struct WssArcEntry {
    float s0;         ///< Arc-length at arc start
    float s1;         ///< Arc-length at arc end
    float t0;         ///< Absolute time at arc start
    float v0;         ///< Velocity at arc start
    float a0;         ///< Acceleration at arc start
    float eta;        ///< BANG: constant jerk. SINGULAR/WALL: unused.
    float a_star;     ///< SINGULAR: constant acceleration. BANG/WALL: unused.
    float duration;   ///< Arc duration (time span)
    float type;       ///< WssArcType as float (for shader convenience)
    float pad1;       ///< Padding for vec4 alignment
    float pad2;
    float pad3;
};
#pragma pack(pop)
static_assert(sizeof(WssArcEntry) == 48, "WssArcEntry must be 48 bytes (3 × vec4)");

/// @brief Kinematic limits needed by the shader to evaluate WALL arcs.
///
/// These are transferred in the TWSF header so the shader can compute
/// v_wall(s) = min(feedRate, maxPathVelocity, sqrt(maxCentripetalAccel / κ(s)),
///                  maxAxisVelocityForDirection(tangent))
#pragma pack(push, 1)
struct WssKinematicLimits {
    float feedRate = 0.0f;                  ///< Feed rate (mm/s)
    float maxPathVelocity = 0.0f;           ///< Path-level max velocity (mm/s)
    float maxCentripetalAcceleration = 0.0f; ///< Max centripetal accel (mm/s²)
    float maxAxisVelocityX = 0.0f;          ///< Max X-axis velocity (mm/s)
    float maxAxisVelocityY = 0.0f;          ///< Max Y-axis velocity (mm/s)
    float maxAxisVelocityZ = 0.0f;          ///< Max Z-axis velocity (mm/s)
    float pad1 = 0.0f;
    float pad2 = 0.0f;
};
#pragma pack(pop)
static_assert(sizeof(WssKinematicLimits) == 32, "WssKinematicLimits must be 32 bytes");

/// @brief Complete WSS data — the analytical velocity profile.
struct WssData {
    /// All arcs, in order of increasing s0.
    std::vector<WssArcEntry> arcs;

    /// Total path arc length (mm).
    double totalLength = 0.0;

    /// Total traversal time (s).
    double totalTime = 0.0;

    /// Maximum absolute values for UI normalization.
    float maxVelocity = 0.0f;
    float maxAcceleration = 0.0f;
    float maxJerk = 0.0f;

    /// Kinematic limits for WALL arc evaluation.
    WssKinematicLimits limits;

    /// Per-arc extrusion ratios (E_delta / path_length), one per arc.
    /// 0 for non-extruding travel moves. Used by the frontend for analytical
    /// pressure advance evaluation in WGSL shaders.
    /// Empty for TWSF v1 data (defaults to 0 in the shader).
    std::vector<float> extrusionRatios;
};

} // namespace tether::web
