#include <gtest/gtest.h>

#include "tether/web/WssData.hpp"
#include "tether/web/WssSerializer.hpp"

#include <cstdint>
#include <vector>

using namespace tether::web;

TEST(WssSerializer, RoundTrip) {
    WssData data;
    data.totalLength = 123.456;
    data.totalTime = 7.89;
    data.maxVelocity = 100.0f;
    data.maxAcceleration = 200.0f;
    data.maxJerk = 300.0f;
    data.limits.feedRate = 50.0f;
    data.limits.maxPathVelocity = 200.0f;
    data.limits.maxCentripetalAcceleration = 500.0f;
    data.limits.maxAxisVelocityX = 200.0f;
    data.limits.maxAxisVelocityY = 200.0f;
    data.limits.maxAxisVelocityZ = 200.0f;

    // Add a few arcs of each type
    WssArcEntry bangPlus{};
    bangPlus.type = 0.0f; // BANG_PLUS
    bangPlus.s0 = 0.0f;
    bangPlus.s1 = 10.0f;
    bangPlus.t0 = 0.0f;
    bangPlus.v0 = 0.0f;
    bangPlus.a0 = 0.0f;
    bangPlus.eta = 100.0f;
    bangPlus.duration = 1.0f;
    data.arcs.push_back(bangPlus);

    WssArcEntry singular{};
    singular.type = 2.0f; // SINGULAR
    singular.s0 = 10.0f;
    singular.s1 = 50.0f;
    singular.t0 = 1.0f;
    singular.v0 = 50.0f;
    singular.a0 = 0.0f;
    singular.a_star = 100.0f;
    singular.duration = 0.5f;
    data.arcs.push_back(singular);

    WssArcEntry wall{};
    wall.type = 3.0f; // WALL
    wall.s0 = 50.0f;
    wall.s1 = 60.0f;
    wall.t0 = 1.5f;
    wall.v0 = 80.0f;
    wall.duration = 0.125f;
    data.arcs.push_back(wall);

    const auto bytes = serializeWss(data);
    ASSERT_GE(bytes.size(), sizeof(TWSFHeader));

    const auto parsed = parseWss(bytes);
    EXPECT_DOUBLE_EQ(parsed.totalLength, data.totalLength);
    EXPECT_DOUBLE_EQ(parsed.totalTime, data.totalTime);
    EXPECT_FLOAT_EQ(parsed.maxVelocity, data.maxVelocity);
    EXPECT_FLOAT_EQ(parsed.maxAcceleration, data.maxAcceleration);
    EXPECT_FLOAT_EQ(parsed.maxJerk, data.maxJerk);
    EXPECT_FLOAT_EQ(parsed.limits.feedRate, data.limits.feedRate);
    EXPECT_FLOAT_EQ(parsed.limits.maxCentripetalAcceleration,
                    data.limits.maxCentripetalAcceleration);
    ASSERT_EQ(parsed.arcs.size(), data.arcs.size());
    for (size_t i = 0; i < parsed.arcs.size(); ++i) {
        EXPECT_FLOAT_EQ(parsed.arcs[i].s0, data.arcs[i].s0) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].s1, data.arcs[i].s1) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].t0, data.arcs[i].t0) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].v0, data.arcs[i].v0) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].type, data.arcs[i].type) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].eta, data.arcs[i].eta) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].a_star, data.arcs[i].a_star) << "arc " << i;
        EXPECT_FLOAT_EQ(parsed.arcs[i].duration, data.arcs[i].duration) << "arc " << i;
    }
}

TEST(WssSerializer, MagicCheck) {
    std::vector<uint8_t> bad(128, 0);
    EXPECT_THROW(parseWss(bad), std::invalid_argument);
}

TEST(WssSerializer, EmptyArcs) {
    WssData data;
    data.totalLength = 0.0;
    data.totalTime = 0.0;
    const auto bytes = serializeWss(data);
    ASSERT_GE(bytes.size(), sizeof(TWSFHeader));
    const auto parsed = parseWss(bytes);
    EXPECT_TRUE(parsed.arcs.empty());
}
