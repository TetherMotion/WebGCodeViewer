/// @file test_gcode_processor.cpp
/// @brief Tests for G-code → trajectory sample pipeline.

#include "tether/web/GCodeProcessor.hpp"

#include <gtest/gtest.h>
#include <cmath>

using namespace tether::web;

namespace {

// A simple square toolpath: rapid to start, then 4 linear moves
const char* SQUARE_GCODE =
    "G21\n"           // mm units
    "G90\n"           // absolute positioning
    "G0 X0 Y0 Z5\n"   // rapid to start
    "G1 X100 Y0 Z5 F3000\n"
    "G1 X100 Y100 Z5 F3000\n"
    "G1 X0 Y100 Z5 F3000\n"
    "G1 X0 Y0 Z5 F3000\n"
    "M30\n";

// G-code with an arc
const char* ARC_GCODE =
    "G21\n"
    "G90\n"
    "G17\n"           // XY plane
    "G0 X0 Y0 Z5\n"
    "G2 X50 Y0 I25 J0 F1500\n"  // CW arc, radius 25
    "M30\n";

// Empty / comment-only G-code
const char* EMPTY_GCODE =
    "; just a comment\n"
    "\n"
    "  \n";

} // anonymous namespace

// ── Basic parsing tests ──────────────────────────────────────────────────────

TEST(GCodeProcessor, ParsesSquareToolpath) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success) << result.errorMessage;
    EXPECT_GT(result.sampleCount, 0u);
    EXPECT_GT(result.duration, 0.0);
    EXPECT_GT(result.pathLength, 350.0); // 4 × 100mm = 400mm
}

TEST(GCodeProcessor, EmptyGcodeReturnsError) {
    GCodeProcessor processor;
    auto result = processor.process(EMPTY_GCODE);

    EXPECT_FALSE(result.success);
    EXPECT_NE(result.errorMessage.find("No motion segments"), std::string::npos);
}

TEST(GCodeProcessor, ExtractsBlockMetadata) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    // Should have blocks for: G21, G90, G0, G1, G1, G1, G1, M30
    // (non-motion blocks + motion blocks)
    EXPECT_GE(result.blocks.size(), 6u);

    // Check that motion blocks have correct motionType
    int motionBlocks = 0;
    for (const auto& blk : result.blocks) {
        if (blk.motionType <= 3) ++motionBlocks;
    }
    EXPECT_GE(motionBlocks, 5); // G0 + 4×G1
}

TEST(GCodeProcessor, BlockMetadataContainsGcodeText) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    bool foundG1 = false;
    for (const auto& blk : result.blocks) {
        if (blk.gcodeText.find("G1") != std::string::npos) {
            foundG1 = true;
            break;
        }
    }
    EXPECT_TRUE(foundG1);
}

// ── Trajectory correctness tests ─────────────────────────────────────────────

TEST(GCodeProcessor, SquareToolpathBounds) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    // Find min/max X and Y across all samples
    double minX = 1e9, maxX = -1e9;
    double minY = 1e9, maxY = -1e9;
    for (const auto& s : result.samples) {
        minX = std::min(minX, s.position[0]);
        maxX = std::max(maxX, s.position[0]);
        minY = std::min(minY, s.position[1]);
        maxY = std::max(maxY, s.position[1]);
    }

    EXPECT_NEAR(minX, 0.0, 0.1);
    EXPECT_NEAR(maxX, 100.0, 0.1);
    EXPECT_NEAR(minY, 0.0, 0.1);
    EXPECT_NEAR(maxY, 100.0, 0.1);
}

TEST(GCodeProcessor, SamplesHaveCorrectTimeOrdering) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    for (size_t i = 1; i < result.samples.size(); ++i) {
        EXPECT_GE(result.samples[i].time, result.samples[i-1].time);
    }
}

TEST(GCodeProcessor, SamplesHaveSegmentIndices) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    // Should have multiple segments (5 motion segments: G0 + 4×G1)
    int maxSegIdx = 0;
    for (const auto& s : result.samples) {
        maxSegIdx = std::max(maxSegIdx, static_cast<int>(s.segmentIndex));
    }
    EXPECT_GE(maxSegIdx, 4); // At least 5 segments (0-4)
}

// ── Arc tests ────────────────────────────────────────────────────────────────

TEST(GCodeProcessor, ParsesArcToolpath) {
    GCodeProcessor processor;
    auto result = processor.process(ARC_GCODE);

    EXPECT_TRUE(result.success) << result.errorMessage;
    EXPECT_GT(result.sampleCount, 0u);

    // Arc radius should be ~25mm, sweep ~2π (full circle back to Y=0, X=50)
    // Actually G2 X50 Y0 I25 J0: center at (25, 0), start (0,0), end (50,0)
    // This is a semicircle (sweep = π)
    // Path length = π * 25 ≈ 78.5mm
    EXPECT_GT(result.pathLength, 70.0);
    EXPECT_LT(result.pathLength, 90.0);
}

TEST(GCodeProcessor, ArcSamplesFollowCircularPath) {
    GCodeProcessor processor;
    auto result = processor.process(ARC_GCODE);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    // Check that samples follow a circular arc centered at (25, 0)
    // with radius 25
    for (const auto& s : result.samples) {
        double dx = s.position[0] - 25.0;
        double dy = s.position[1] - 0.0;
        double r = std::sqrt(dx*dx + dy*dy);
        EXPECT_NEAR(r, 25.0, 1.0); // Within 1mm tolerance
    }
}

// ── Configuration tests ──────────────────────────────────────────────────────

TEST(GCodeProcessor, DifferentSampleRates) {
    GCodeProcessor processor;

    ProcessConfig cfg1;
    cfg1.sampleRate = 0.01;  // 10ms
    auto result1 = processor.process(SQUARE_GCODE, cfg1);

    ProcessConfig cfg2;
    cfg2.sampleRate = 0.001; // 1ms
    auto result2 = processor.process(SQUARE_GCODE, cfg2);

    EXPECT_TRUE(result1.success);
    EXPECT_TRUE(result2.success);
    // Finer sample rate should produce more samples
    EXPECT_GT(result2.sampleCount, result1.sampleCount);
}

TEST(GCodeProcessor, ProgressCallback) {
    GCodeProcessor processor;
    std::vector<double> progressValues;

    auto result = processor.process(SQUARE_GCODE, {}, [&progressValues](double p) {
        progressValues.push_back(p);
    });

    EXPECT_TRUE(result.success);
    EXPECT_FALSE(progressValues.empty());
    EXPECT_DOUBLE_EQ(progressValues.front(), 0.0);
    EXPECT_DOUBLE_EQ(progressValues.back(), 1.0);

    // Progress should be monotonically non-decreasing
    for (size_t i = 1; i < progressValues.size(); ++i) {
        EXPECT_GE(progressValues[i], progressValues[i-1]);
    }
}

// ── Statistics tests ─────────────────────────────────────────────────────────

TEST(GCodeProcessor, ComputesStatistics) {
    GCodeProcessor processor;
    auto result = processor.process(SQUARE_GCODE);

    EXPECT_TRUE(result.success);
    EXPECT_GT(result.statistics.duration, 0.0);
    EXPECT_GT(result.statistics.pathLength, 0.0);
    EXPECT_EQ(result.statistics.sampleCount, result.sampleCount);
}

TEST(GCodeProcessor, AvailableStrategies) {
    auto strategies = GCodeProcessor::availableStrategies();
    EXPECT_FALSE(strategies.empty());
    // Should contain FixedTime
    bool found = false;
    for (const auto& s : strategies) {
        if (s == "FixedTime") found = true;
    }
    EXPECT_TRUE(found);
}

// ── Incremental positioning (G91) tests ──────────────────────────────────────

TEST(GCodeProcessor, IncrementalPositioning) {
    const char* gcode =
        "G21\n"
        "G91\n"           // incremental
        "G0 X0 Y0 Z5\n"
        "G1 X50 Y0 F3000\n"   // move +50 X
        "G1 X50 Y0 F3000\n"   // move +50 X (total 100)
        "M30\n";

    GCodeProcessor processor;
    auto result = processor.process(gcode);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    // Final X should be 100
    double finalX = result.samples.back().position[0];
    EXPECT_NEAR(finalX, 100.0, 0.5);
}

// ── Inch units (G20) tests ───────────────────────────────────────────────────

TEST(GCodeProcessor, InchUnitsConversion) {
    const char* gcode =
        "G20\n"           // inches
        "G90\n"
        "G0 X0 Y0 Z1\n"   // 1 inch = 25.4mm
        "G1 X1 Y0 F100\n"  // 1 inch move
        "M30\n";

    GCodeProcessor processor;
    auto result = processor.process(gcode);

    EXPECT_TRUE(result.success);
    ASSERT_FALSE(result.samples.empty());

    // Final X should be 1 inch = 25.4mm
    double finalX = result.samples.back().position[0];
    EXPECT_NEAR(finalX, 25.4, 0.5);
}
