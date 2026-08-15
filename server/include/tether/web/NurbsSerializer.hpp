#pragma once

/// @file NurbsSerializer.hpp
/// @brief Binary serialization of PiecewiseNurbsPath to NBP format.
///
/// NBP (NURBS Binary Path) is a compact binary format that stores
/// the NURBS control points, weights, knots, and degree for each
/// piece of a PiecewiseNurbsPath. Memory is O(pieces), not O(samples).
///
/// Format layout (all little-endian):
///   Header (80 bytes):
///     magic[4] = "TNBP"
///     version (u16)
///     dim (u8)
///     reserved[3]
///     pieceCount (u32)
///     blockCount (u32)
///     totalControlPoints (u32)
///     totalKnots (u32)
///     totalLength (f64)
///     boundsMin[3] (f64)
///     boundsMax[3] (f64)
///   Piece table (pieceCount × 20 bytes):
///     degree (u8) + reserved[3]
///     cpCount (u32)
///     knotCount (u32)
///     motionType (u8) + reserved[3]
///   Control points (totalControlPoints × dim × f64)
///   Weights (totalControlPoints × f64)
///   Knots (totalKnots × f64)
///   Block metadata (same format as TTHR block section)

#include "tether/motion_planner/geometry/PiecewiseNurbsPath.hpp"
#include "tether/motion_planner/geometry/NurbsCurve.hpp"
#include "tether/web/TrajectorySerializer.hpp" // for BlockMetadata

#include <cstdint>
#include <string>
#include <vector>

namespace tether::web {

/// NBP binary format magic number.
constexpr char NBP_MAGIC[4] = {'T', 'N', 'B', 'P'};
constexpr uint16_t NBP_VERSION = 1;

/// NBP header (82 bytes, little-endian, packed).
#pragma pack(push, 1)
struct NBPHeader {
    char magic[4] = {'T', 'N', 'B', 'P'};
    uint16_t version = NBP_VERSION;
    uint8_t dim = 3;
    uint8_t reserved[3] = {0, 0, 0};
    uint32_t pieceCount = 0;
    uint32_t blockCount = 0;
    uint32_t totalControlPoints = 0;
    uint32_t totalKnots = 0;
    double totalLength = 0.0;
    double boundsMin[3] = {0, 0, 0};
    double boundsMax[3] = {0, 0, 0};
};
#pragma pack(pop)
static_assert(sizeof(NBPHeader) == 82, "NBPHeader must be 82 bytes");

/// Per-piece metadata entry (16 bytes, packed).
#pragma pack(push, 1)
struct NBPPieceEntry {
    uint8_t degree = 1;
    uint8_t reserved[3] = {0, 0, 0};
    uint32_t cpCount = 0;
    uint32_t knotCount = 0;
    uint8_t motionType = 0;
    uint8_t reserved2[3] = {0, 0, 0};
};
#pragma pack(pop)
static_assert(sizeof(NBPPieceEntry) == 16, "NBPPieceEntry must be 16 bytes");

/// Parsed NBP data (for server-side testing).
struct ParsedNBP {
    NBPHeader header;
    struct Piece {
        int degree;
        std::vector<std::vector<double>> controlPoints;
        std::vector<double> weights;
        std::vector<double> knots;
        uint8_t motionType;
    };
    std::vector<Piece> pieces;
    std::vector<BlockMetadata> blocks;
};

/// Serialize a PiecewiseNurbsPath + block metadata to NBP binary format.
/// @param path The piecewise NURBS path
/// @param blocks G-code block metadata (may be empty)
/// @param motionTypes Per-piece motion type (0=rapid, 1=linear, 2=arcCW, 3=arcCCW)
/// @return Binary NBP data
std::vector<uint8_t> serializeNurbsPath(
    const tether::motion::PiecewiseNurbsPath& path,
    const std::vector<BlockMetadata>& blocks = {},
    const std::vector<uint8_t>& motionTypes = {});

/// Parse NBP binary data (for testing).
ParsedNBP parseNurbsPath(std::span<const uint8_t> data);

} // namespace tether::web
