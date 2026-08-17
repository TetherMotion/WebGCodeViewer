#pragma once

/// @file StateProfile.hpp
/// @brief A uniformly sampled 1D state profile for the WebGPU UI.
///
/// Replaces the ReNURBS profile for velocity/acceleration/jerk/time
/// visualization. It stores the Pareto analytical velocity profile as a
/// 1D RGBA32F texture data source: each texel contains (time, velocity,
/// acceleration, jerk) at arc length s = i * totalLength / (sampleCount - 1).

#include <cstddef>
#include <cstdint>
#include <vector>

namespace tether::web {

struct StateProfile {
    /// Texture data as a flat array: 4 floats per sample (time, velocity,
    /// acceleration, jerk), all in f32.
    std::vector<float> texels;

    /// Total path arc length (mm).
    double totalLength = 0.0;

    /// Total traversal time (s).
    double totalTime = 0.0;

    /// Maximum absolute values for UI normalization.
    float maxVelocity = 0.0f;
    float maxAcceleration = 0.0f;
    float maxJerk = 0.0f;
};

} // namespace tether::web
