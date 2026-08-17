#include <gtest/gtest.h>

#include "tether/web/StateProfile.hpp"
#include "tether/web/StateProfileSerializer.hpp"

#include <cstdint>
#include <vector>

using namespace tether::web;

TEST(StateProfileSerializer, RoundTrip) {
    StateProfile profile;
    profile.totalLength = 123.456;
    profile.totalTime = 7.89;
    profile.maxVelocity = 100.0f;
    profile.maxAcceleration = 200.0f;
    profile.maxJerk = 300.0f;
    profile.texels = {
        0.0f, 1.0f, 2.0f, 3.0f,
        4.0f, 5.0f, 6.0f, 7.0f,
    };

    const auto bytes = serializeStateProfile(profile);
    ASSERT_GE(bytes.size(), 4u + 4u + 4u + 8u + 8u + 4u * 3u);

    const auto parsed = parseStateProfile(bytes);
    EXPECT_FLOAT_EQ(parsed.totalLength, profile.totalLength);
    EXPECT_FLOAT_EQ(parsed.totalTime, profile.totalTime);
    EXPECT_FLOAT_EQ(parsed.maxVelocity, profile.maxVelocity);
    EXPECT_FLOAT_EQ(parsed.maxAcceleration, profile.maxAcceleration);
    EXPECT_FLOAT_EQ(parsed.maxJerk, profile.maxJerk);
    ASSERT_EQ(parsed.texels.size(), profile.texels.size());
    for (size_t i = 0; i < parsed.texels.size(); ++i) {
        EXPECT_FLOAT_EQ(parsed.texels[i], profile.texels[i]) << "texel " << i;
    }
}

TEST(StateProfileSerializer, MagicCheck) {
    std::vector<uint8_t> bad(64, 0);
    EXPECT_THROW(parseStateProfile(bad), std::invalid_argument);
}
