/// @file test_pressure_advance_serializer.cpp
/// @brief Unit tests for TWPA (Pressure Advance parameters) serialization.
///
/// Tests the serializePressureAdvanceParams / parsePressureAdvanceParams
/// round-trip with synthetic PA parameter data covering all 5 algorithms.

#include "tether/web/PressureAdvanceSerializer.hpp"
#include "tether/web/PressureAdvanceProfileBuilder.hpp"

#include <gtest/gtest.h>
#include <vector>
#include <cmath>

using namespace tether::web;

namespace {

/// Create synthetic PA parameter blocks for all 5 algorithms.
std::vector<PressureAdvanceParamBlock> makeSyntheticParams() {
    std::vector<PressureAdvanceParamBlock> params;

    // Linear
    PressureAdvanceParamBlock linear;
    linear.algorithm = PressureAdvanceAlgorithm::Linear;
    linear.algorithmName = "Linear";
    linear.maxOffset = 0.3f;
    linear.maxVelocity = 100.0f;
    linear.pressureAdvance = 0.045f;
    linear.smoothTime = 0.040f;
    linear.maxCompensation = 0.5f;
    params.push_back(linear);

    // PowerLaw
    PressureAdvanceParamBlock powerLaw;
    powerLaw.algorithm = PressureAdvanceAlgorithm::PowerLaw;
    powerLaw.algorithmName = "PowerLaw";
    powerLaw.maxOffset = 0.3f;
    powerLaw.maxVelocity = 100.0f;
    powerLaw.powerLawBaseGain = 0.02f;
    powerLaw.flowIndex = 0.8f;
    powerLaw.filamentDiameter = 1.75f;
    powerLaw.smoothTime = 0.040f;
    powerLaw.maxCompensation = 0.5f;
    params.push_back(powerLaw);

    // CrossWLF
    PressureAdvanceParamBlock crossWlf;
    crossWlf.algorithm = PressureAdvanceAlgorithm::CrossWlf;
    crossWlf.algorithmName = "CrossWLF";
    crossWlf.maxOffset = 0.3f;
    crossWlf.maxVelocity = 100.0f;
    crossWlf.crossWlfCompressibility = 1e-5f;
    crossWlf.filamentDiameter = 1.75f;
    crossWlf.smoothTime = 0.040f;
    crossWlf.maxCompensation = 0.5f;
    crossWlf.meltTempC = 210.0f;
    crossWlf.qGrid = {1.0f, 2.0f, 4.0f, 8.0f};
    crossWlf.tempGrid = {200.0f, 220.0f, 240.0f};
    crossWlf.pValues = std::vector<float>(12, 1000.0f); // 4×3=12
    params.push_back(crossWlf);

    // LTI
    PressureAdvanceParamBlock lti;
    lti.algorithm = PressureAdvanceAlgorithm::LtiDeconv;
    lti.algorithmName = "LTI-Deconv";
    lti.maxOffset = 0.3f;
    lti.maxVelocity = 100.0f;
    lti.groupDelay = 0.020f;
    lti.maxCompensation = 0.5f;
    lti.moments = {0.1f, 0.01f, 0.001f, 0.0001f};
    params.push_back(lti);

    // LPV
    PressureAdvanceParamBlock lpv;
    lpv.algorithm = PressureAdvanceAlgorithm::LpvDeconv;
    lpv.algorithmName = "LPV-Deconv";
    lpv.maxOffset = 0.3f;
    lpv.maxVelocity = 200.0f;
    lpv.groupDelay = 0.020f;
    lpv.maxCompensation = 0.5f;
    lpv.opPointVelocities = {10.0f, 40.0f, 70.0f, 100.0f, 130.0f, 160.0f, 190.0f};
    lpv.moments = std::vector<float>(7 * 4, 0.05f); // 7 op points × 4 moments
    params.push_back(lpv);

    return params;
}

} // anonymous namespace

TEST(PressureAdvanceSerializerTest, RoundTripAllAlgorithms) {
    auto params = makeSyntheticParams();
    ASSERT_EQ(params.size(), 5u);

    // Serialize
    auto binary = serializePressureAdvanceParams(params);
    EXPECT_FALSE(binary.empty());

    // Parse
    auto parsed = parsePressureAdvanceParams(binary);
    EXPECT_EQ(parsed.size(), 5u);

    // Verify each algorithm
    for (size_t i = 0; i < params.size(); ++i) {
        const auto& orig = params[i];
        const auto& p = parsed[i];
        EXPECT_EQ(static_cast<int>(p.algorithm), static_cast<int>(orig.algorithm));
        EXPECT_EQ(p.algorithmName, orig.algorithmName);
        EXPECT_FLOAT_EQ(p.maxOffset, orig.maxOffset);
        EXPECT_FLOAT_EQ(p.maxVelocity, orig.maxVelocity);
    }
}

TEST(PressureAdvanceSerializerTest, LinearParams) {
    auto params = makeSyntheticParams();
    auto binary = serializePressureAdvanceParams(params);
    auto parsed = parsePressureAdvanceParams(binary);

    const auto& linear = parsed[0];
    EXPECT_FLOAT_EQ(linear.pressureAdvance, 0.045f);
    EXPECT_FLOAT_EQ(linear.smoothTime, 0.040f);
    EXPECT_FLOAT_EQ(linear.maxCompensation, 0.5f);
}

TEST(PressureAdvanceSerializerTest, CrossWlfLut) {
    auto params = makeSyntheticParams();
    auto binary = serializePressureAdvanceParams(params);
    auto parsed = parsePressureAdvanceParams(binary);

    const auto& crossWlf = parsed[2];
    EXPECT_EQ(crossWlf.qGrid.size(), 4u);
    EXPECT_EQ(crossWlf.tempGrid.size(), 3u);
    EXPECT_EQ(crossWlf.pValues.size(), 12u);
    EXPECT_FLOAT_EQ(crossWlf.qGrid[0], 1.0f);
    EXPECT_FLOAT_EQ(crossWlf.qGrid[3], 8.0f);
    EXPECT_FLOAT_EQ(crossWlf.tempGrid[0], 200.0f);
    EXPECT_FLOAT_EQ(crossWlf.tempGrid[2], 240.0f);
}

TEST(PressureAdvanceSerializerTest, LtiMoments) {
    auto params = makeSyntheticParams();
    auto binary = serializePressureAdvanceParams(params);
    auto parsed = parsePressureAdvanceParams(binary);

    const auto& lti = parsed[3];
    EXPECT_EQ(lti.moments.size(), 4u);
    EXPECT_FLOAT_EQ(lti.moments[0], 0.1f);
    EXPECT_FLOAT_EQ(lti.moments[3], 0.0001f);
    EXPECT_FLOAT_EQ(lti.groupDelay, 0.020f);
}

TEST(PressureAdvanceSerializerTest, LpvOpPoints) {
    auto params = makeSyntheticParams();
    auto binary = serializePressureAdvanceParams(params);
    auto parsed = parsePressureAdvanceParams(binary);

    const auto& lpv = parsed[4];
    EXPECT_EQ(lpv.opPointVelocities.size(), 7u);
    EXPECT_EQ(lpv.moments.size(), 28u); // 7 × 4
    EXPECT_FLOAT_EQ(lpv.opPointVelocities[0], 10.0f);
    EXPECT_FLOAT_EQ(lpv.opPointVelocities[6], 190.0f);
}

TEST(PressureAdvanceSerializerTest, EmptyParams) {
    std::vector<PressureAdvanceParamBlock> empty;
    auto binary = serializePressureAdvanceParams(empty);
    EXPECT_FALSE(binary.empty());

    auto parsed = parsePressureAdvanceParams(binary);
    EXPECT_EQ(parsed.size(), 0u);
}

TEST(PressureAdvanceSerializerTest, InvalidMagic) {
    std::vector<uint8_t> bad = {'X', 'X', 'X', 'X', 0, 0, 0, 0};
    EXPECT_THROW(parsePressureAdvanceParams(bad), std::runtime_error);
}

TEST(PressureAdvanceSerializerTest, AlgorithmNames) {
    EXPECT_EQ(pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm::Linear), "Linear");
    EXPECT_EQ(pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm::PowerLaw), "PowerLaw");
    EXPECT_EQ(pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm::CrossWlf), "CrossWLF");
    EXPECT_EQ(pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm::LtiDeconv), "LTI-Deconv");
    EXPECT_EQ(pressureAdvanceAlgorithmName(PressureAdvanceAlgorithm::LpvDeconv), "LPV-Deconv");
}

TEST(PressureAdvanceSerializerTest, ComputeAllParams) {
    PressureAdvanceConfig config;
    auto params = computeAllPressureAdvanceParams(config);
    EXPECT_EQ(params.size(), 5u);

    // Verify all algorithms are present
    EXPECT_EQ(params[0].algorithmName, "Linear");
    EXPECT_EQ(params[1].algorithmName, "PowerLaw");
    EXPECT_EQ(params[2].algorithmName, "CrossWLF");
    EXPECT_EQ(params[3].algorithmName, "LTI-Deconv");
    EXPECT_EQ(params[4].algorithmName, "LPV-Deconv");

    // Verify Linear has correct parameters
    EXPECT_FLOAT_EQ(params[0].pressureAdvance, static_cast<float>(config.pressureAdvance));

    // Verify CrossWLF has LUT data
    EXPECT_FALSE(params[2].qGrid.empty());
    EXPECT_FALSE(params[2].tempGrid.empty());
    EXPECT_FALSE(params[2].pValues.empty());

    // Verify LTI has moments
    EXPECT_EQ(params[3].moments.size(), 4u);

    // Verify LPV has operating points
    EXPECT_FALSE(params[4].opPointVelocities.empty());
    EXPECT_EQ(params[4].moments.size(), params[4].opPointVelocities.size() * 4);
}
