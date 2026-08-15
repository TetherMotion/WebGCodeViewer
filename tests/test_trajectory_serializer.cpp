/// @file test_trajectory_serializer.cpp
/// @brief Tests for TTHR binary serialization round-trip.

#include "tether/web/TrajectorySerializer.hpp"

#include <gtest/gtest.h>
#include <cmath>
#include <random>

using namespace tether::web;
using GCodeExport::TrajectorySample;

namespace {

std::vector<TrajectorySample> makeTestSamples(int count) {
    std::vector<TrajectorySample> samples(count);
    std::mt19937 rng(42);
    std::uniform_real_distribution<double> dist(-100.0, 100.0);
    for (int i = 0; i < count; ++i) {
        auto& s = samples[i];
        s.time = i * 0.001;
        s.pathPosition = i * 0.1;
        for (int ax = 0; ax < 9; ++ax) {
            s.position[ax] = dist(rng);
            s.velocity[ax] = dist(rng);
            s.acceleration[ax] = dist(rng);
            s.jerk[ax] = dist(rng);
        }
        s.linearVelocity = std::abs(dist(rng));
        s.linearAcceleration = std::abs(dist(rng));
        s.linearJerk = std::abs(dist(rng));
        s.curvature = std::abs(dist(rng)) * 0.01;
        s.centripetalAccel = std::abs(dist(rng));
        s.segmentIndex = i / 10;
        s.blockIndex = i / 10;
        s.motionType = (i % 4 == 0) ? 0 : 1; // rapid or linear
    }
    return samples;
}

std::vector<BlockMetadata> makeTestBlocks(int count) {
    std::vector<BlockMetadata> blocks(count);
    for (int i = 0; i < count; ++i) {
        blocks[i].blockIndex = i;
        blocks[i].lineNumber = i * 10;
        blocks[i].motionType = (i % 4 == 0) ? 0 : 1;
        blocks[i].gcodeText = "G1 X" + std::to_string(i) + " Y" + std::to_string(i * 2);
    }
    return blocks;
}

} // anonymous namespace

// ── Header tests ─────────────────────────────────────────────────────────────

TEST(TrajectorySerializer, HeaderSize) {
    // Header is 92 bytes when serialized (no padding in binary format):
    // 4 (magic) + 2 (version) + 2 (flags) + 1 (axisCount) + 3 (reserved)
    // + 4 (sampleCount) + 4 (blockCount) + 8*3 (times) + 24*2 (bounds) = 92
    EXPECT_EQ(sizeof(TTHRHeader), 96); // struct has padding
}

TEST(TrajectorySerializer, EmptySamples) {
    std::vector<TrajectorySample> samples;
    std::vector<BlockMetadata> blocks;
    auto bin = serializeTrajectory(samples, blocks);
    // Binary header is 92 bytes (no struct padding)
    EXPECT_GE(bin.size(), 92u);

    auto parsed = parseTrajectory(bin);
    EXPECT_EQ(parsed.header.version, TTHR_VERSION);
    EXPECT_EQ(parsed.header.sampleCount, 0u);
    EXPECT_EQ(parsed.header.blockCount, 0u);
}

// ── Round-trip tests ─────────────────────────────────────────────────────────

TEST(TrajectorySerializer, RoundTripAllFields) {
    auto samples = makeTestSamples(100);
    auto blocks = makeTestBlocks(10);
    SerializeOptions opts;
    opts.flags = TTHRFlags::All;
    opts.axisCount = 9;

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_EQ(parsed.header.sampleCount, 100u);
    EXPECT_EQ(parsed.header.blockCount, 10u);
    EXPECT_EQ(parsed.header.axisCount, 9u);
    EXPECT_EQ(parsed.header.flags, TTHRFlags::All);

    // Check time and pathPosition
    ASSERT_EQ(parsed.time.size(), 100u);
    ASSERT_EQ(parsed.pathPosition.size(), 100u);
    for (size_t i = 0; i < 100; ++i) {
        EXPECT_DOUBLE_EQ(parsed.time[i], samples[i].time);
        EXPECT_DOUBLE_EQ(parsed.pathPosition[i], samples[i].pathPosition);
    }

    // Check positions
    ASSERT_EQ(parsed.positions.size(), 100u * 9);
    for (size_t i = 0; i < 100; ++i) {
        for (int ax = 0; ax < 9; ++ax) {
            EXPECT_DOUBLE_EQ(parsed.positions[i * 9 + ax], samples[i].position[ax]);
        }
    }

    // Check velocities
    ASSERT_EQ(parsed.velocities.size(), 100u * 9);
    for (size_t i = 0; i < 100; ++i) {
        for (int ax = 0; ax < 9; ++ax) {
            EXPECT_DOUBLE_EQ(parsed.velocities[i * 9 + ax], samples[i].velocity[ax]);
        }
    }

    // Check linear metrics
    ASSERT_EQ(parsed.linearVelocity.size(), 100u);
    ASSERT_EQ(parsed.linearAcceleration.size(), 100u);
    ASSERT_EQ(parsed.linearJerk.size(), 100u);
    for (size_t i = 0; i < 100; ++i) {
        EXPECT_DOUBLE_EQ(parsed.linearVelocity[i], samples[i].linearVelocity);
        EXPECT_DOUBLE_EQ(parsed.linearAcceleration[i], samples[i].linearAcceleration);
        EXPECT_DOUBLE_EQ(parsed.linearJerk[i], samples[i].linearJerk);
    }

    // Check curvature
    ASSERT_EQ(parsed.curvature.size(), 100u);
    ASSERT_EQ(parsed.centripetalAccel.size(), 100u);
    for (size_t i = 0; i < 100; ++i) {
        EXPECT_DOUBLE_EQ(parsed.curvature[i], samples[i].curvature);
        EXPECT_DOUBLE_EQ(parsed.centripetalAccel[i], samples[i].centripetalAccel);
    }

    // Check segment info
    ASSERT_EQ(parsed.segmentIndex.size(), 100u);
    ASSERT_EQ(parsed.blockIndex.size(), 100u);
    ASSERT_EQ(parsed.motionType.size(), 100u);
    for (size_t i = 0; i < 100; ++i) {
        EXPECT_EQ(parsed.segmentIndex[i], samples[i].segmentIndex);
        EXPECT_EQ(parsed.blockIndex[i], samples[i].blockIndex);
        EXPECT_EQ(parsed.motionType[i], samples[i].motionType);
    }

    // Check block metadata
    ASSERT_EQ(parsed.blocks.size(), 10u);
    for (size_t i = 0; i < 10; ++i) {
        EXPECT_EQ(parsed.blocks[i].blockIndex, blocks[i].blockIndex);
        EXPECT_EQ(parsed.blocks[i].lineNumber, blocks[i].lineNumber);
        EXPECT_EQ(parsed.blocks[i].motionType, blocks[i].motionType);
        EXPECT_EQ(parsed.blocks[i].gcodeText, blocks[i].gcodeText);
    }
}

TEST(TrajectorySerializer, RoundTripPartialFields) {
    auto samples = makeTestSamples(50);
    auto blocks = makeTestBlocks(5);
    SerializeOptions opts;
    opts.flags = TTHRFlags::Positions | TTHRFlags::LinearMetrics;
    opts.axisCount = 3;

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_EQ(parsed.header.sampleCount, 50u);
    EXPECT_EQ(parsed.header.flags, opts.flags);
    EXPECT_EQ(parsed.header.axisCount, 3u);

    // Positions present
    ASSERT_EQ(parsed.positions.size(), 50u * 3);
    // Velocities absent
    EXPECT_TRUE(parsed.velocities.empty());
    // Accelerations absent
    EXPECT_TRUE(parsed.accelerations.empty());
    // Linear metrics present
    ASSERT_EQ(parsed.linearVelocity.size(), 50u);
    // Curvature absent
    EXPECT_TRUE(parsed.curvature.empty());
    // Segment info absent
    EXPECT_TRUE(parsed.segmentIndex.empty());
}

TEST(TrajectorySerializer, RoundTripXYZOnly) {
    auto samples = makeTestSamples(20);
    auto blocks = makeTestBlocks(2);
    SerializeOptions opts;
    opts.flags = TTHRFlags::All;
    opts.axisCount = 3; // Only XYZ

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_EQ(parsed.header.axisCount, 3u);
    ASSERT_EQ(parsed.positions.size(), 20u * 3);
    // Verify XYZ values match first 3 axes
    for (size_t i = 0; i < 20; ++i) {
        for (int ax = 0; ax < 3; ++ax) {
            EXPECT_DOUBLE_EQ(parsed.positions[i * 3 + ax], samples[i].position[ax]);
        }
    }
}

// ── Filtering tests ──────────────────────────────────────────────────────────

TEST(TrajectorySerializer, TimeRangeFilter) {
    auto samples = makeTestSamples(100);
    std::vector<BlockMetadata> blocks;
    SerializeOptions opts;
    opts.flags = TTHRFlags::All;
    opts.timeStart = 0.01;  // Skip first 10 samples
    opts.timeEnd = 0.05;    // Take samples 10-49

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_EQ(parsed.header.sampleCount, 40u);
    EXPECT_DOUBLE_EQ(parsed.time[0], 0.01);
    EXPECT_DOUBLE_EQ(parsed.time[39], 0.049);
}

TEST(TrajectorySerializer, DownsampleFilter) {
    auto samples = makeTestSamples(100);
    std::vector<BlockMetadata> blocks;
    SerializeOptions opts;
    opts.flags = TTHRFlags::All;
    opts.downsample = 5;  // Take every 5th sample

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_EQ(parsed.header.sampleCount, 20u);
    EXPECT_DOUBLE_EQ(parsed.time[0], 0.0);
    EXPECT_DOUBLE_EQ(parsed.time[1], 0.005);
}

TEST(TrajectorySerializer, SegmentRangeFilter) {
    auto samples = makeTestSamples(100);
    std::vector<BlockMetadata> blocks;
    SerializeOptions opts;
    opts.flags = TTHRFlags::All;
    opts.segStart = 2;   // Only segment 2+
    opts.segEnd = 5;     // Up to segment 4

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    // Samples with segmentIndex 2,3,4 → indices 20-49
    EXPECT_EQ(parsed.header.sampleCount, 30u);
    for (size_t i = 0; i < parsed.segmentIndex.size(); ++i) {
        EXPECT_GE(parsed.segmentIndex[i], 2);
        EXPECT_LT(parsed.segmentIndex[i], 5);
    }
}

// ── Bounds computation tests ─────────────────────────────────────────────────

TEST(TrajectorySerializer, BoundsComputation) {
    std::vector<TrajectorySample> samples(10);
    for (int i = 0; i < 10; ++i) {
        samples[i].time = i * 0.1;
        samples[i].position[0] = i * 10.0;        // X: 0-90
        samples[i].position[1] = (9 - i) * 5.0;   // Y: 45-0
        samples[i].position[2] = -i * 2.0;        // Z: 0 to -18
    }
    std::vector<BlockMetadata> blocks;
    SerializeOptions opts;
    opts.flags = TTHRFlags::Positions;
    opts.axisCount = 3;

    auto bin = serializeTrajectory(samples, blocks, opts);
    auto parsed = parseTrajectory(bin);

    EXPECT_DOUBLE_EQ(parsed.header.boundsMin[0], 0.0);
    EXPECT_DOUBLE_EQ(parsed.header.boundsMax[0], 90.0);
    EXPECT_DOUBLE_EQ(parsed.header.boundsMin[1], 0.0);
    EXPECT_DOUBLE_EQ(parsed.header.boundsMax[1], 45.0);
    EXPECT_DOUBLE_EQ(parsed.header.boundsMin[2], -18.0);
    EXPECT_DOUBLE_EQ(parsed.header.boundsMax[2], 0.0);
}

// ── Size computation tests ───────────────────────────────────────────────────

TEST(TrajectorySerializer, DataSizeComputation) {
    uint32_t n = 1000;
    uint8_t axes = 3;
    // All fields
    size_t allSize = computeDataSize(n, TTHRFlags::All, axes);
    // time + pathPos: 1000*2*8 = 16000
    // pos: 1000*3*8 = 24000
    // vel: 1000*3*8 = 24000
    // acc: 1000*3*8 = 24000
    // jerk: 1000*3*8 = 24000
    // linear: 1000*3*8 = 24000
    // curve: 1000*2*8 = 16000
    // seg: 1000*(4+4+1) = 9000
    // deviation: 1000*1*8 = 8000
    // Total = 16000 + 24000*4 + 24000 + 16000 + 9000 + 8000 = 169000
    EXPECT_EQ(allSize, 169000u);

    // Only positions
    size_t posOnly = computeDataSize(n, TTHRFlags::Positions, axes);
    EXPECT_EQ(posOnly, 16000u + 24000u); // time+pathPos + positions
}

TEST(TrajectorySerializer, BlockSizeComputation) {
    std::vector<BlockMetadata> blocks(3);
    blocks[0].gcodeText = "G1 X10";       // 6 chars
    blocks[1].gcodeText = "G0 X0 Y0 Z0";  // 11 chars
    blocks[2].gcodeText = "M30";          // 3 chars

    size_t size = computeBlockSize(blocks);
    // Per block: 4+4+1+2 + textLen = 11 + textLen
    // Total: (11+6) + (11+11) + (11+3) = 17 + 22 + 14 = 53
    EXPECT_EQ(size, 53u);
}

// ── Invalid data tests ───────────────────────────────────────────────────────

TEST(TrajectorySerializer, InvalidMagic) {
    std::vector<uint8_t> bad(92, 0);
    auto parsed = parseTrajectory(bad);
    EXPECT_EQ(parsed.header.sampleCount, 0u);
}

TEST(TrajectorySerializer, TooSmallData) {
    std::vector<uint8_t> small(10, 0);
    auto parsed = parseTrajectory(small);
    EXPECT_EQ(parsed.header.sampleCount, 0u);
}

// ── Statistics JSON tests ────────────────────────────────────────────────────

TEST(TrajectorySerializer, StatisticsToJson) {
    GCodeExport::TrajectoryStatistics stats;
    stats.duration = 10.5;
    stats.pathLength = 250.0;
    stats.sampleCount = 10000;
    stats.maxLinearVelocity = 80.0;
    stats.maxLinearAcceleration = 500.0;
    stats.meetsLimits = true;

    std::string json = statisticsToJson(stats);
    EXPECT_NE(json.find("\"duration\":10."), std::string::npos);
    EXPECT_NE(json.find("\"pathLength\":250."), std::string::npos);
    EXPECT_NE(json.find("\"sampleCount\":10000"), std::string::npos);
    EXPECT_NE(json.find("\"meetsLimits\":true"), std::string::npos);
    EXPECT_NE(json.find("\"axisStats\":"), std::string::npos);
}
