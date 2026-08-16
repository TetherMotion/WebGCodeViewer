#include <gtest/gtest.h>
#include "tether/web/ReNurbsSerializer.hpp"
#include "tether/motion_planner/profile_renurbs/ReNURBSProfile.hpp"
#include "tether/motion_planner/geometry/NurbsCurve.hpp"

#include <cmath>

using namespace tether::web;
using tether::motion::NurbsCurve;
using tether::motion::RVec;
using tether::motion::profile_renurbs::ReNURBSProfile;
using tether::motion::profile_renurbs::ReNURBSSegmentProfile;
using tether::motion::profile_renurbs::ReNURBSQuantityCurves;

namespace {

/// Build a simple ReNURBS profile with 2 segments for testing.
ReNURBSProfile buildTestProfile() {
    ReNURBSProfile profile;

    // Segment 0: s ∈ [0, 10]
    ReNURBSSegmentProfile seg0;
    seg0.sStart = 0.0;
    seg0.sEnd = 10.0;
    // Velocity: constant 50.0 (degree 1, 2 CPs, clamped knots [0,0,1,1])
    seg0.velocity.curve = NurbsCurve(
        std::vector<RVec>{RVec{50.0}, RVec{50.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Acceleration: 0 (constant)
    seg0.acceleration.curve = NurbsCurve(
        std::vector<RVec>{RVec{0.0}, RVec{0.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Jerk: 0
    seg0.jerk.curve = NurbsCurve(
        std::vector<RVec>{RVec{0.0}, RVec{0.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Time: linear 0 → 0.2
    seg0.time.curve = NurbsCurve(
        std::vector<RVec>{RVec{0.0}, RVec{0.2}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    profile.perSegment.push_back(std::move(seg0));

    // Segment 1: s ∈ [10, 20]
    ReNURBSSegmentProfile seg1;
    seg1.sStart = 10.0;
    seg1.sEnd = 20.0;
    // Velocity: ramp 50 → 100
    seg1.velocity.curve = NurbsCurve(
        std::vector<RVec>{RVec{50.0}, RVec{100.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Acceleration: constant 5.0
    seg1.acceleration.curve = NurbsCurve(
        std::vector<RVec>{RVec{5.0}, RVec{5.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Jerk: 0
    seg1.jerk.curve = NurbsCurve(
        std::vector<RVec>{RVec{0.0}, RVec{0.0}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    // Time: linear 0.2 → 0.4
    seg1.time.curve = NurbsCurve(
        std::vector<RVec>{RVec{0.2}, RVec{0.4}},
        std::vector<double>{1.0, 1.0},
        std::vector<double>{0.0, 0.0, 1.0, 1.0},
        1);
    profile.perSegment.push_back(std::move(seg1));

    return profile;
}

} // anonymous namespace

TEST(ReNurbsSerializerTest, RoundTripBasic) {
    auto profile = buildTestProfile();

    auto binary = serializeReNurbsProfile(profile, 100.0f, 5.0f, 0.0f, 0.4f);
    ASSERT_FALSE(binary.empty());

    // Parse it back
    auto parsed = parseReNurbsProfile(binary);

    // Check header
    EXPECT_EQ(parsed.header.version, TRNP_VERSION);
    EXPECT_EQ(parsed.header.quantityCount, 4u);
    EXPECT_EQ(parsed.header.segmentCount, 2u);
    EXPECT_FLOAT_EQ(parsed.header.maxVelocity, 100.0f);
    EXPECT_FLOAT_EQ(parsed.header.maxAcceleration, 5.0f);
    EXPECT_FLOAT_EQ(parsed.header.maxJerk, 0.0f);
    EXPECT_FLOAT_EQ(parsed.header.maxTime, 0.4f);
    EXPECT_FLOAT_EQ(parsed.header.totalLength, 20.0f);

    // Check quantity names
    ASSERT_EQ(parsed.quantityNames.size(), 4u);
    EXPECT_EQ(parsed.quantityNames[0], "velocity");
    EXPECT_EQ(parsed.quantityNames[1], "acceleration");
    EXPECT_EQ(parsed.quantityNames[2], "jerk");
    EXPECT_EQ(parsed.quantityNames[3], "time");

    // Check segments
    ASSERT_EQ(parsed.segments.size(), 2u);
    EXPECT_FLOAT_EQ(parsed.segments[0].sStart, 0.0f);
    EXPECT_FLOAT_EQ(parsed.segments[0].sEnd, 10.0f);
    EXPECT_FLOAT_EQ(parsed.segments[1].sStart, 10.0f);
    EXPECT_FLOAT_EQ(parsed.segments[1].sEnd, 20.0f);

    // Check segment 0 velocity curve
    const auto& seg0Vel = parsed.segments[0].quantities[0];
    ASSERT_EQ(seg0Vel.controlPoints.size(), 2u);
    EXPECT_FLOAT_EQ(seg0Vel.controlPoints[0], 50.0f);
    EXPECT_FLOAT_EQ(seg0Vel.controlPoints[1], 50.0f);
    EXPECT_EQ(seg0Vel.degree, 1u);
    ASSERT_EQ(seg0Vel.knots.size(), 4u);

    // Check segment 1 velocity curve (ramp 50→100)
    const auto& seg1Vel = parsed.segments[1].quantities[0];
    ASSERT_EQ(seg1Vel.controlPoints.size(), 2u);
    EXPECT_FLOAT_EQ(seg1Vel.controlPoints[0], 50.0f);
    EXPECT_FLOAT_EQ(seg1Vel.controlPoints[1], 100.0f);
}

TEST(ReNurbsSerializerTest, EmptyProfile) {
    ReNURBSProfile profile;
    auto binary = serializeReNurbsProfile(profile);
    EXPECT_FALSE(binary.empty());

    auto parsed = parseReNurbsProfile(binary);
    EXPECT_EQ(parsed.header.segmentCount, 0u);
    EXPECT_EQ(parsed.segments.size(), 0u);
}

TEST(ReNurbsSerializerTest, InvalidMagic) {
    std::vector<uint8_t> bad(128, 0);
    bad[0] = 'X';  // Wrong magic
    EXPECT_THROW(parseReNurbsProfile(bad), std::runtime_error);
}

TEST(ReNurbsSerializerTest, SizeReduction) {
    // Verify that TRNP is significantly smaller than dense sampled data.
    // A 2-segment profile with 2 CPs per quantity = 2×4×2 = 16 floats = 64 bytes
    // for control points + 2×4×4 = 32 floats = 128 bytes for knots.
    // Total ~300 bytes vs ~10000 samples × 8 bytes × 4 quantities = 320KB.
    auto profile = buildTestProfile();
    auto binary = serializeReNurbsProfile(profile);

    // TRNP should be well under 1KB for this simple profile
    EXPECT_LT(binary.size(), 1024u);

    // Dense sampling would be at least 10x larger
    size_t denseSize = 10000 * 8 * 4;  // 10K samples × 8 bytes × 4 quantities
    EXPECT_LT(binary.size() * 10, denseSize);
}
