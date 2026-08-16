#pragma once

/// @file ReNurbsSerializer.hpp
/// @brief Binary serialization of ReNURBSProfile to TRNP format.
///
/// TRNP (Tether ReNURBS Profile) is a compact binary format that stores
/// per-segment NURBS curves for velocity, acceleration, jerk, and time
/// profiles. Instead of dense sampled arrays (O(samples) × 8 bytes per
/// quantity), it stores O(segments × controlPoints) × 4 bytes — typically
/// a 25×–100× size reduction.
///
/// The curves are 1-D B-splines with weights all 1, parameterized by
/// normalized arc length u ∈ [0,1] within each segment. The frontend
/// evaluates them directly in WGSL shaders using De Boor's algorithm.
///
/// Format layout (all little-endian, f32 for shader compatibility):
///   Header (64 bytes):
///     magic[4] = "TRNP"
///     version (u16) = 1
///     quantityCount (u8)    — typically 4 (velocity, acceleration, jerk, time)
///     reserved[1]
///     segmentCount (u32)
///     totalControlPoints (u32)
///     totalKnots (u32)
///     totalLength (f32)
///     maxVelocity (f32)     — for frontend normalization
///     maxAcceleration (f32)
///     maxJerk (f32)
///     maxTime (f32)
///     reserved[16]
///
///   Quantity names (quantityCount × 32 bytes, null-padded)
///
///   Segment table (segmentCount × 16 bytes):
///     sStart (f32)          — arc length start
///     sEnd (f32)            — arc length end
///     quantityMetaOffset (u32) — base index into quantity metadata array
///     _pad (u32)
///
///   Quantity metadata (segmentCount × quantityCount × 16 bytes):
///     For each (segment, quantity):
///       cpOffset (u32)      — offset into global control points buffer
///       cpCount (u32)
///       knotOffset (u32)    — offset into global knots buffer
///       degree (u32)
///
///   Control points (totalControlPoints × 4 bytes, f32)
///     All segments, all quantities, contiguous
///
///   Knots (totalKnots × 4 bytes, f32)
///     All segments, all quantities, contiguous

#include "tether/motion_planner/profile_renurbs/ReNURBSProfile.hpp"
#include "tether/motion_planner/profile_renurbs/GenericReNURBSProfile.hpp"
#include "tether/motion_planner/geometry/NurbsCurve.hpp"
#include "tether/web/PaProfileBuilder.hpp"

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace tether::web {

/// TRNP binary format magic number.
constexpr char TRNP_MAGIC[4] = {'T', 'R', 'N', 'P'};
constexpr uint16_t TRNP_VERSION = 1;

/// Number of quantities in a velocity ReNURBS profile (v, a, j, t).
constexpr uint8_t TRNP_DEFAULT_QUANTITY_COUNT = 4;

/// TRNP header (64 bytes, little-endian, packed).
#pragma pack(push, 1)
struct TRNPHeader {
    char magic[4] = {'T', 'R', 'N', 'P'};
    uint16_t version = TRNP_VERSION;
    uint8_t quantityCount = TRNP_DEFAULT_QUANTITY_COUNT;
    uint8_t reserved1 = 0;
    uint32_t segmentCount = 0;
    uint32_t totalControlPoints = 0;
    uint32_t totalKnots = 0;
    float totalLength = 0.0f;
    float maxVelocity = 0.0f;
    float maxAcceleration = 0.0f;
    float maxJerk = 0.0f;
    float maxTime = 0.0f;
    char reserved2[24] = {};
};
#pragma pack(pop)
static_assert(sizeof(TRNPHeader) == 64, "TRNPHeader must be 64 bytes");

/// Per-segment entry in the segment table (16 bytes, packed).
#pragma pack(push, 1)
struct TRNPSegmentEntry {
    float sStart = 0.0f;
    float sEnd = 0.0f;
    uint32_t quantityMetaOffset = 0;  ///< Base index into quantity metadata
    uint32_t pad = 0;
};
#pragma pack(pop)
static_assert(sizeof(TRNPSegmentEntry) == 16, "TRNPSegmentEntry must be 16 bytes");

/// Per-quantity metadata entry (16 bytes, packed).
#pragma pack(push, 1)
struct TRNPQuantityMeta {
    uint32_t cpOffset = 0;    ///< Offset into global control points buffer
    uint32_t cpCount = 0;
    uint32_t knotOffset = 0;  ///< Offset into global knots buffer
    uint32_t degree = 0;
};
#pragma pack(pop)
static_assert(sizeof(TRNPQuantityMeta) == 16, "TRNPQuantityMeta must be 16 bytes");

/// Parsed TRNP data (for testing).
struct ParsedTRNP {
    TRNPHeader header;
    std::vector<std::string> quantityNames;
    struct Segment {
        float sStart, sEnd;
        struct Quantity {
            uint32_t cpOffset, cpCount, knotOffset, degree;
            std::vector<float> controlPoints;
            std::vector<float> knots;
        };
        std::vector<Quantity> quantities;
    };
    std::vector<Segment> segments;
};

/// Serialize a ReNURBSProfile to TRNP binary format.
/// @param profile The ReNURBS profile with per-segment NURBS curves
/// @param maxVelocity Max velocity for normalization (from ProcessResult)
/// @param maxAcceleration Max acceleration for normalization
/// @param maxJerk Max jerk for normalization
/// @param maxTime Max time for normalization
/// @return Binary TRNP data
std::vector<uint8_t> serializeReNurbsProfile(
    const tether::motion::profile_renurbs::ReNURBSProfile& profile,
    float maxVelocity = 0.0f,
    float maxAcceleration = 0.0f,
    float maxJerk = 0.0f,
    float maxTime = 0.0f);

/// Parse TRNP binary data (for testing).
ParsedTRNP parseReNurbsProfile(std::span<const uint8_t> data);

// ── PA (Pressure Advance) TRNP extension ─────────────────────────────────────

/// Serialize PA profiles to a TRNP-PA binary format.
/// Each PA algorithm produces a GenericReNURBSProfile with 2 quantities:
/// "pressure_offset" and "extruder_velocity".
///
/// Format (TRNP-PA):
///   Header (32 bytes):
///     magic[4] = "TPA\0"
///     version (u16) = 1
///     paCount (u8)         — number of PA algorithms
///     reserved[1]
///     totalSegments (u32)  — total segments across all PA profiles
///     totalControlPoints (u32)
///     totalKnots (u32)
///     reserved[12]
///
///   PA algorithm table (paCount × 44 bytes):
///     algorithmId (u8)     — PaAlgorithm enum value
///     reserved[3]
///     algorithmName[32]    — null-padded name
///     maxOffset (f32)
///     maxVelocity (f32)
///
///   Per-PA segment table + quantity metadata + CPs + knots
///   (same layout as TRNP, repeated per PA algorithm)
///
/// @param paProfiles Vector of PA profile results (one per algorithm)
/// @return Binary TRNP-PA data
std::vector<uint8_t> serializePaProfiles(
    const std::vector<PaProfileResult>& paProfiles);

/// Parsed TRNP-PA data (for testing).
struct ParsedTRNPPa {
    struct PaEntry {
        uint8_t algorithmId;
        std::string algorithmName;
        float maxOffset;
        float maxVelocity;
        // Per-segment per-quantity curves (same as ParsedTRNP::Segment)
        struct Segment {
            float sStart, sEnd;
            struct Quantity {
                std::vector<float> controlPoints;
                std::vector<float> knots;
                uint32_t degree;
            };
            std::vector<Quantity> quantities;
        };
        std::vector<Segment> segments;
    };
    std::vector<PaEntry> paEntries;
};

/// Parse TRNP-PA binary data (for testing).
ParsedTRNPPa parsePaProfiles(std::span<const uint8_t> data);

} // namespace tether::web
