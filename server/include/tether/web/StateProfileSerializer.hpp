#pragma once

/// @file StateProfileSerializer.hpp
/// @brief Binary serializer for the StateProfile texture data.
///
/// Format (little-endian, TSSP):
///   magic[4]              'TSSP'
///   version u32           1
///   sampleCount u32
///   totalLength f64
///   totalTime f64
///   maxVelocity f32
///   maxAcceleration f32
///   maxJerk f32
///   texels[sampleCount*4] f32 (time, velocity, acceleration, jerk)

#include "tether/web/StateProfile.hpp"

#include <span>
#include <vector>
#include <cstdint>

namespace tether::web {

/// Serialize a StateProfile to TSSP bytes.
std::vector<uint8_t> serializeStateProfile(const StateProfile& profile);

/// Parse TSSP bytes back into a StateProfile.
/// Throws std::invalid_argument if the header/magic is invalid.
StateProfile parseStateProfile(std::span<const uint8_t> data);

} // namespace tether::web
