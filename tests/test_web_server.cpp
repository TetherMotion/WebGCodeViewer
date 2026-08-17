/// @file test_web_server.cpp
/// @brief Tests for the web viewer server components.
///
/// Tests the JobManager and API logic directly (without starting a
/// full Drogon server) to avoid lifecycle issues in test environments.

#include "tether/web/JobManager.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "tether/web/GCodeProcessor.hpp"
#include "tether/web/WebServerConfig.hpp"
#include "ProcessResultAnalyzer.hpp"
#include "tether_viewer.pb.h"

#include <gtest/gtest.h>
#include <chrono>
#include <set>
#include <thread>

using namespace tether::web;

namespace {

/// Config that generates dense samples (for tests that need TTHR sample data).
ProcessConfig sampleConfig() {
    ProcessConfig cfg;
    cfg.nurbsOnly = false;
    return cfg;
}

const char* SQUARE_GCODE =
    "G21\nG90\nG0 X0 Y0 Z5\n"
    "G1 X100 Y0 Z5 F3000\n"
    "G1 X100 Y100 Z5 F3000\n"
    "G1 X0 Y100 Z5 F3000\n"
    "G1 X0 Y0 Z5 F3000\n"
    "M30\n";

const char* LAYERED_FEATURE_GCODE =
    "G21\nG90\nM82\n"
    ";TYPE:SKIRT\n"
    "G0 X0 Y0 Z0.2\n"
    "G1 X50 Y0 Z0.2 E1 F1500\n"
    "G1 X50 Y50 Z0.2 E2 F1500\n"
    "G1 X0 Y50 Z0.2 E3 F1500\n"
    ";TYPE:WALL-INNER\n"
    "G0 X10 Y10 Z0.2\n"
    "G1 X40 Y10 Z0.2 E4 F1500\n"
    "G1 X40 Y40 Z0.2 E5 F1500\n"
    ";TYPE:FILL\n"
    "G0 X0 Y0 Z0.4\n"
    "G1 X50 Y0 Z0.4 E6 F1500\n"
    "G1 X50 Y50 Z0.4 E7 F1500\n"
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
    jm.startProcessing(id, sampleConfig());

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
    ASSERT_TRUE(jm.startProcessing(id, sampleConfig()));

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

// ── ProcessResult-driven analysis tests ──────────────────────────────────────

TEST(ProcessResultAnalyzerTest, MaterialLayerAndFeatureSections) {
    using ::tether::viewer::v1::GetAnalysisRequest;
    using ::tether::viewer::v1::AnalysisResultResponse;

    JobManager jm;
    std::string id = jm.createJob(LAYERED_FEATURE_GCODE, "layered.gcode");
    ASSERT_TRUE(jm.startProcessing(id));

    for (int i = 0; i < 100; ++i) {
        if (jm.getJobState(id) == JobState::Ready) break;
        if (jm.getJobState(id) == JobState::Failed) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    ASSERT_EQ(jm.getJobState(id), JobState::Ready);

    GetAnalysisRequest request;
    request.set_detail_level("standard");
    request.set_top_event_limit(50);

    AnalysisResultResponse response;
    appendProcessResultAnalysis(response, jm.getResult(id), jm.getGcodeLines(id), request);

    ASSERT_GE(response.sections_size(), 5);
    EXPECT_EQ(response.sections(0).section_name(), "material_time");
    EXPECT_EQ(response.sections(1).section_name(), "layer_summary");
    EXPECT_EQ(response.sections(2).section_name(), "feature_summary");
    EXPECT_EQ(response.sections(3).section_name(), "overhang_bridge_support");
    EXPECT_EQ(response.sections(4).section_name(), "z_seam");
    EXPECT_EQ(response.sections(5).section_name(), "path_intersections");
    EXPECT_EQ(response.sections(6).section_name(), "volumetric_flow");
    EXPECT_EQ(response.sections(7).section_name(), "first_layer");

    const auto& material = response.sections(0);
    EXPECT_GT(material.metrics_size(), 0);

    bool foundExtrusion = false;
    for (const auto& m : material.metrics()) {
        if (m.key() == "total_extrusion_mm") {
            foundExtrusion = true;
            EXPECT_GT(m.double_value(), 0.0);
        }
    }
    EXPECT_TRUE(foundExtrusion);

    const auto& layers = response.sections(1);
    EXPECT_GT(layers.top_events_size(), 0);
    EXPECT_EQ(layers.top_events(0).event_type(), "layer");

    const auto& features = response.sections(2);
    EXPECT_GT(features.top_events_size(), 0);

    // Should see at least two different feature types (SKIRT, WALL-INNER, FILL).
    std::set<std::string> featureNames;
    for (const auto& e : features.top_events()) {
        featureNames.insert(e.event_type());
    }
    EXPECT_GE(featureNames.size(), 2u);
}
