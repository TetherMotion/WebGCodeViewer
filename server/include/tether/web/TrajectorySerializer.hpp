#pragma once

/// @file TrajectorySerializer.hpp
/// @brief Binary serialization of TrajectorySample[] to TTHR format.
///
/// TTHR (Tether Trajectory) is a compact binary format that mirrors the
/// internal TrajectorySample struct in Struct-of-Arrays (SoA) layout using
/// full double precision (float64). It supports field-level filtering so
/// clients can request only the attributes they need.

#include "tether/export/TrajectoryAnalyzer.hpp"
#include "tether/motion_replanner/GCodeGenerator.hpp"

#include <cstdint>
#include <string>
#include <vector>
#include <span>

namespace tether::web {

/// @brief TTHR binary format magic number.
constexpr char TTHR_MAGIC[4] = {'T', 'T', 'H', 'R'};

/// @brief TTHR binary format version.
constexpr uint16_t TTHR_VERSION = 1;

/// @brief Flag bits for TTHR header — which attribute groups are present.
namespace TTHRFlags {
    constexpr uint16_t Positions    = 0x0001; ///< position[9] per sample
    constexpr uint16_t Velocities   = 0x0002; ///< velocity[9] per sample
    constexpr uint16_t Accelerations= 0x0004; ///< acceleration[9] per sample
    constexpr uint16_t Jerks        = 0x0008; ///< jerk[9] per sample
    constexpr uint16_t LinearMetrics= 0x0010; ///< linearVelocity/Accel/Jerk
    constexpr uint16_t Curvature    = 0x0020; ///< curvature, centripetalAccel
    constexpr uint16_t SegmentInfo  = 0x0040; ///< segmentIndex, blockIndex, motionType
    constexpr uint16_t All          = 0x007F; ///< All attribute groups
} // namespace TTHRFlags

/// @brief A G-code block metadata entry for the THDR block section.
struct BlockMetadata {
    int32_t blockIndex = -1;
    int32_t lineNumber = -1;
    uint8_t motionType = 0;  ///< 0=rapid, 1=linear, 2=arcCW, 3=arcCCW
    std::string gcodeText;   ///< G-code line text
};

/// @brief TTHR header (96 bytes, little-endian).
struct TTHRHeader {
    char magic[4] = {'T', 'T', 'H', 'R'};
    uint16_t version = TTHR_VERSION;
    uint16_t flags = 0;
    uint8_t axisCount = 3;
    uint8_t reserved[3] = {0, 0, 0};
    uint32_t sampleCount = 0;
    uint32_t blockCount = 0;
    double timeStart = 0.0;
    double timeEnd = 0.0;
    double pathLength = 0.0;
    double boundsMin[3] = {0, 0, 0};  ///< XYZ min
    double boundsMax[3] = {0, 0, 0};  ///< XYZ max
};
static_assert(sizeof(TTHRHeader) == 96, "TTHRHeader must be 96 bytes");

/// @brief Options for serializing trajectory data.
struct SerializeOptions {
    uint16_t flags = TTHRFlags::All;
    uint8_t axisCount = 3;       ///< Number of axes to include (3=XYZ, 9=all)
    double timeStart = 0.0;      ///< Filter: start time (inclusive)
    double timeEnd = -1.0;       ///< Filter: end time (exclusive, -1 = all)
    int32_t segStart = -1;       ///< Filter: start segment index (inclusive, -1 = all)
    int32_t segEnd = -1;         ///< Filter: end segment index (exclusive, -1 = all)
    uint32_t downsample = 1;     ///< Stride: take every Nth sample
};

/// @brief Parsed TTHR data (deserialized from binary).
struct ParsedTTHR {
    TTHRHeader header;
    std::vector<BlockMetadata> blocks;
    // SoA data arrays
    std::vector<double> time;
    std::vector<double> pathPosition;
    std::vector<double> positions;   ///< Flattened: [sampleCount * axisCount]
    std::vector<double> velocities;
    std::vector<double> accelerations;
    std::vector<double> jerks;
    std::vector<double> linearVelocity;
    std::vector<double> linearAcceleration;
    std::vector<double> linearJerk;
    std::vector<double> curvature;
    std::vector<double> centripetalAccel;
    std::vector<int32_t> segmentIndex;
    std::vector<int32_t> blockIndex;
    std::vector<uint8_t> motionType;
};

/// @brief Serialize trajectory samples + block metadata to TTHR binary format.
/// @param samples Trajectory samples from TrajectoryAnalyzer
/// @param blocks G-code block metadata
/// @param options Serialization options (filtering, field selection)
/// @return Binary data (little-endian)
std::vector<uint8_t> serializeTrajectory(
    const std::vector<GCodeExport::TrajectorySample>& samples,
    const std::vector<BlockMetadata>& blocks,
    const SerializeOptions& options = {});

/// @brief Parse TTHR binary data back into structured form.
/// @param data Binary TTHR data
/// @return Parsed trajectory data, or empty if invalid
ParsedTTHR parseTrajectory(std::span<const uint8_t> data);

/// @brief Compute the byte size of the data section for given options.
/// @param sampleCount Number of samples
/// @param flags Which attribute groups are present
/// @param axisCount Number of axes per sample
/// @return Data section size in bytes
size_t computeDataSize(uint32_t sampleCount, uint16_t flags, uint8_t axisCount);

/// @brief Compute block metadata section size.
/// @param blocks Block metadata entries
/// @return Block section size in bytes
size_t computeBlockSize(const std::vector<BlockMetadata>& blocks);

/// @brief Convert TrajectoryStatistics to JSON string.
std::string statisticsToJson(const GCodeExport::TrajectoryStatistics& stats);

} // namespace tether::web
