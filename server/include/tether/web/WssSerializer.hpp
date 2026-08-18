#pragma once

/// @file WssSerializer.hpp
/// @brief Binary serialization of WssData to TWSF format.
///
/// TWSF (Tether Weighted Structure Format) is a compact binary format that
/// stores the analytical Weighted Switching Structure (WSS) — the Pareto-
/// optimal velocity plan — as a list of arcs, NOT as a sampled texture.
///
/// The arcs are evaluated in closed form by the WebGPU shaders at the exact
/// points needed for rendering. There is NO fixed dense sampling. This
/// keeps memory usage proportional to the number of arcs (O(segments)),
/// not to the path length or print duration.
///
/// Format layout (all little-endian):
///   Header (80 bytes):
///     magic[4] = "TWSF"
///     version (u16) = 1
///     reserved[2]
///     arcCount (u32)
///     totalLength (f64)
///     totalTime (f64)
///     maxVelocity (f32)
///     maxAcceleration (f32)
///     maxJerk (f32)
///     Kinematic limits (32 bytes):
///       feedRate (f32)
///       maxPathVelocity (f32)
///       maxCentripetalAcceleration (f32)
///       maxAxisVelocity[3] (f32 × 3)
///       pad[2] (f32 × 2)
///     reserved[8]
///
///   Arc array (arcCount × 48 bytes):
///     Each arc is a WssArcEntry (3 × vec4):
///       vec4 A: (s0, s1, t0, v0)
///       vec4 B: (a0, eta, a_star, duration)
///       vec4 C: (type, 0, 0, 0)

#include "tether/web/WssData.hpp"

#include <cstdint>
#include <span>
#include <vector>

namespace tether::web {

/// TWSF binary format magic number.
constexpr char TWSF_MAGIC[4] = {'T', 'W', 'S', 'F'};
constexpr uint16_t TWSF_VERSION = 1;

/// TWSF header (80 bytes, little-endian, packed).
#pragma pack(push, 1)
struct TWSFHeader {
    char magic[4] = {'T', 'W', 'S', 'F'};
    uint16_t version = TWSF_VERSION;
    uint8_t reserved1 = 0;
    uint8_t reserved2 = 0;
    uint32_t arcCount = 0;
    double totalLength = 0.0;
    double totalTime = 0.0;
    float maxVelocity = 0.0f;
    float maxAcceleration = 0.0f;
    float maxJerk = 0.0f;
    WssKinematicLimits limits;
    char reserved[8] = {};
};
#pragma pack(pop)
static_assert(sizeof(TWSFHeader) == 80, "TWSFHeader must be 80 bytes");

/// Serialize WssData to TWSF binary format.
/// @param data The WSS data with arcs and limits
/// @return Binary TWSF data
std::vector<uint8_t> serializeWss(const WssData& data);

/// Parse TWSF binary data (for testing).
/// @param data Binary TWSF data
/// @return Parsed WssData
WssData parseWss(std::span<const uint8_t> data);

} // namespace tether::web
