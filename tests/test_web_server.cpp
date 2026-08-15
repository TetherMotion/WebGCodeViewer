/// @file test_web_server.cpp
/// @brief Tests for the web viewer server components.
///
/// Tests the JobManager and API logic directly (without starting a
/// full Drogon server) to avoid lifecycle issues in test environments.

#include "tether/web/JobManager.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "tether/web/GCodeProcessor.hpp"
#include "tether/web/WebServerConfig.hpp"

#include <gtest/gtest.h>
#include <chrono>
#include <thread>

using namespace tether::web;

namespace {

const char* SQUARE_GCODE =
    "G21\nG90\nG0 X0 Y0 Z5\n"
    "G1 X100 Y0 Z5 F3000\n"
    "G1 X100 Y100 Z5 F3000\n"
    "G1 X0 Y100 Z5 F3000\n"
    "G1 X0 Y0 Z5 F3000\n"
    "M30\n";

} // anonymous namespace

// ── JobManager tests ─────────────────────────────────────────────────────────

TEST(JobManagerTest, CreateJob) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE, "test.gcode");
    EXPECT_FALSE(id.empty());
    EXPECT_EQ(jm.getJobState(id), JobState::Pending);
    EXPECT_EQ(jm.jobCount(), 1u);
}

TEST(JobManagerTest, ProcessJob) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    EXPECT_TRUE(jm.startProcessing(id));

    // Wait for processing to complete
    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) == JobState::Ready) break;
        if (jm.getJobState(id) == JobState::Failed) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    EXPECT_EQ(jm.getJobState(id), JobState::Ready);
    auto* result = jm.getResult(id);
    ASSERT_NE(result, nullptr);
    EXPECT_TRUE(result->success);
    EXPECT_GT(result->sampleCount, 0u);
}

TEST(JobManagerTest, GetBinary) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    jm.startProcessing(id);

    // Wait for completion
    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) != JobState::Processing) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    auto binary = jm.getBinary(id);
    EXPECT_FALSE(binary.empty());
    // Verify TTHR magic
    EXPECT_EQ(binary[0], 'T');
    EXPECT_EQ(binary[1], 'T');
    EXPECT_EQ(binary[2], 'H');
    EXPECT_EQ(binary[3], 'R');
}

TEST(JobManagerTest, GetBinaryWithFilters) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    jm.startProcessing(id);

    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) != JobState::Processing) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    // Request only positions
    SerializeOptions opts;
    opts.flags = TTHRFlags::Positions;
    opts.axisCount = 3;
    auto binary = jm.getBinary(id, opts);
    EXPECT_FALSE(binary.empty());

    // Parse and verify
    auto parsed = parseTrajectory(binary);
    EXPECT_EQ(parsed.header.flags, TTHRFlags::Positions);
    EXPECT_FALSE(parsed.positions.empty());
    EXPECT_TRUE(parsed.velocities.empty()); // Not requested
}

TEST(JobManagerTest, GetBlocksJson) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    jm.startProcessing(id);

    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) != JobState::Processing) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    std::string json = jm.getBlocksJson(id);
    EXPECT_NE(json.find("blocks"), std::string::npos);
    EXPECT_NE(json.find("gcodeText"), std::string::npos);
}

TEST(JobManagerTest, GetStatisticsJson) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    jm.startProcessing(id);

    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) != JobState::Processing) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    std::string json = jm.getStatisticsJson(id);
    EXPECT_NE(json.find("duration"), std::string::npos);
    EXPECT_NE(json.find("pathLength"), std::string::npos);
}

TEST(JobManagerTest, DeleteJob) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    EXPECT_EQ(jm.jobCount(), 1u);
    EXPECT_TRUE(jm.deleteJob(id));
    EXPECT_EQ(jm.jobCount(), 0u);
    EXPECT_EQ(jm.getJobState(id), JobState::Deleted);
}

TEST(JobManagerTest, ListJobsJson) {
    JobManager jm;
    jm.createJob(SQUARE_GCODE, "file1.gcode");
    jm.createJob(SQUARE_GCODE, "file2.gcode");
    std::string json = jm.listJobsJson();
    EXPECT_NE(json.find("jobs"), std::string::npos);
    EXPECT_NE(json.find("file1.gcode"), std::string::npos);
    EXPECT_NE(json.find("file2.gcode"), std::string::npos);
}

TEST(JobManagerTest, NonexistentJob) {
    JobManager jm;
    EXPECT_EQ(jm.getJobState("nonexistent"), JobState::Deleted);
    EXPECT_EQ(jm.getJobProgress("nonexistent"), 0.0);
    EXPECT_EQ(jm.getResult("nonexistent"), nullptr);
    EXPECT_TRUE(jm.getBinary("nonexistent").empty());
    EXPECT_FALSE(jm.deleteJob("nonexistent"));
}

TEST(JobManagerTest, DoubleProcessFails) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE);
    EXPECT_TRUE(jm.startProcessing(id));
    // Second call should fail (already processing)
    EXPECT_FALSE(jm.startProcessing(id));
}

// ── WebServerConfig tests ────────────────────────────────────────────────────

TEST(WebServerConfigTest, DefaultValues) {
    WebServerConfig cfg;
    EXPECT_EQ(cfg.port, 8080);
    EXPECT_EQ(cfg.bindAddress, "0.0.0.0");
    EXPECT_TRUE(cfg.webRoot.empty());
    EXPECT_TRUE(cfg.enableCors);
}

// ── Full pipeline integration test ───────────────────────────────────────────

TEST(WebServerPipelineTest, FullPipelineEndToEnd) {
    JobManager jm;
    std::string id = jm.createJob(SQUARE_GCODE, "square.gcode");
    ASSERT_TRUE(jm.startProcessing(id));

    // Wait for completion
    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) == JobState::Ready) break;
        if (jm.getJobState(id) == JobState::Failed) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    ASSERT_EQ(jm.getJobState(id), JobState::Ready);

    // Get full binary
    auto binary = jm.getBinary(id);
    ASSERT_FALSE(binary.empty());

    // Parse it back
    auto parsed = parseTrajectory(binary);
    EXPECT_GT(parsed.header.sampleCount, 0u);
    EXPECT_GT(parsed.header.pathLength, 350.0); // ~400mm

    // Verify positions are in expected range
    EXPECT_NEAR(parsed.header.boundsMin[0], 0.0, 1.0);
    EXPECT_NEAR(parsed.header.boundsMax[0], 100.0, 1.0);
    EXPECT_NEAR(parsed.header.boundsMin[1], 0.0, 1.0);
    EXPECT_NEAR(parsed.header.boundsMax[1], 100.0, 1.0);

    // Get statistics
    std::string stats = jm.getStatisticsJson(id);
    EXPECT_NE(stats.find("axisStats"), std::string::npos);

    // Get segments
    std::string segs = jm.getSegmentsJson(id);
    EXPECT_NE(segs.find("segments"), std::string::npos);
}
