/// @file test_pa_serializer.cpp
/// @brief Unit tests for TRNP-PA (Pressure Advance) serialization.
///
/// Tests the serializePaProfiles / parsePaProfiles round-trip with
/// synthetic PA profile data covering all 5 algorithms.

#include "tether/web/ReNurbsSerializer.hpp"
#include "tether/web/PaProfileBuilder.hpp"
#include "tether/motion_planner/profile_renurbs/GenericReNURBSProfile.hpp"
#include "tether/motion_planner/profile_renurbs/PressureAdvanceReNURBSAdapter.hpp"

#include <gtest/gtest.h>
#include <vector>
#include <cmath>

using namespace tether::web;
using namespace tether::motion::profile_renurbs;

namespace {

/// Create a synthetic PA profile result with a simple NURBS curve.
PaProfileResult makeSyntheticPa(PaAlgorithm algo, int numPoints = 50) {
    PaProfileResult result;
    result.algorithm = algo;
    result.algorithmName = paAlgorithmName(algo);
    result.maxOffset = 0.3f;
    result.maxVelocity = 50.0f;

    // Generate synthetic offset + velocity data
    std::vector<double> offsets(numPoints), velocities(numPoints);
    double dt = 0.001;
    for (int i = 0; i < numPoints; ++i) {
        double t = i * dt;
        velocities[i] = 50.0 * std::sin(M_PI * t / 0.05);
        offsets[i] = 0.045 * velocities[i];  // Linear PA
    }

    try {
        PressureAdvanceReNURBSConfig config;
        config.certify = false;
        config.degree = 3;
        config.maxControlPointsPerSegment = 16;
        result.profile = buildPressureAdvanceReNURBS(
            offsets, velocities, dt, 0.5, config);
    } catch (const std::exception&) {
        // If building fails, leave profile empty
    }

    return result;
}

} // anonymous namespace

TEST(PaSerializerTest, RoundTripAllAlgorithms) {
    // Create PA profiles for all 5 algorithms
    std::vector<PaProfileResult> paProfiles;
    for (auto algo : {PaAlgorithm::Linear, PaAlgorithm::PowerLaw,
                      PaAlgorithm::CrossWlf, PaAlgorithm::LtiDeconv,
                      PaAlgorithm::LpvDeconv}) {
        paProfiles.push_back(makeSyntheticPa(algo));
    }

    // Serialize
    auto binary = serializePaProfiles(paProfiles);
    EXPECT_FALSE(binary.empty());

    // Parse
    auto parsed = parsePaProfiles(binary);
    EXPECT_EQ(parsed.paEntries.size(), 5u);

    // Verify each algorithm
    for (size_t i = 0; i < paProfiles.size(); ++i) {
        const auto& orig = paProfiles[i];
        const auto& parsed_entry = parsed.paEntries[i];
        EXPECT_EQ(static_cast<int>(parsed_entry.algorithmId),
                  static_cast<int>(orig.algorithm));
        EXPECT_EQ(parsed_entry.algorithmName, orig.algorithmName);
        EXPECT_FLOAT_EQ(parsed_entry.maxOffset, orig.maxOffset);
        EXPECT_FLOAT_EQ(parsed_entry.maxVelocity, orig.maxVelocity);
    }
}

TEST(PaSerializerTest, EmptyProfiles) {
    std::vector<PaProfileResult> empty;
    auto binary = serializePaProfiles(empty);
    EXPECT_FALSE(binary.empty());

    auto parsed = parsePaProfiles(binary);
    EXPECT_EQ(parsed.paEntries.size(), 0u);
}

TEST(PaSerializerTest, InvalidMagic) {
    std::vector<uint8_t> bad = {'X', 'X', 'X', 'X', 0, 0, 0, 0};
    EXPECT_THROW(parsePaProfiles(bad), std::runtime_error);
}

TEST(PaSerializerTest, AlgorithmNames) {
    EXPECT_EQ(paAlgorithmName(PaAlgorithm::Linear), "Linear");
    EXPECT_EQ(paAlgorithmName(PaAlgorithm::PowerLaw), "PowerLaw");
    EXPECT_EQ(paAlgorithmName(PaAlgorithm::CrossWlf), "CrossWLF");
    EXPECT_EQ(paAlgorithmName(PaAlgorithm::LtiDeconv), "LTI-Deconv");
    EXPECT_EQ(paAlgorithmName(PaAlgorithm::LpvDeconv), "LPV-Deconv");
}

TEST(PaSerializerTest, ProfileWithoutCurve) {
    // PA result with no profile (algorithm failed)
    PaProfileResult empty;
    empty.algorithm = PaAlgorithm::Linear;
    empty.algorithmName = "Linear";
    empty.maxOffset = 0.0f;
    empty.maxVelocity = 0.0f;

    std::vector<PaProfileResult> profiles = {empty};
    auto binary = serializePaProfiles(profiles);
    EXPECT_FALSE(binary.empty());

    auto parsed = parsePaProfiles(binary);
    EXPECT_EQ(parsed.paEntries.size(), 1u);
    EXPECT_EQ(parsed.paEntries[0].algorithmName, "Linear");
    EXPECT_EQ(parsed.paEntries[0].segments.size(), 0u);
}
