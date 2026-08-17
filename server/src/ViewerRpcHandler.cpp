/// @file ViewerRpcHandler.cpp
/// @brief RPC handler implementation for the Tether viewer WebSocket protocol.

#include "tether/web/ViewerRpcHandler.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "AnalysisSerializer.hpp"
#include "ProcessResultAnalyzer.hpp"

#include "tether_viewer.pb.h"

#include "tether/analysis/AnalysisExposer.hpp"
#include "tether/io/Registry.hpp"

#include <drogon/WebSocketConnection.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <sstream>
#include <thread>

namespace tether::web {

namespace {
    using namespace tether::viewer::v1;

    // RPC status codes (matching Noxeco/gRPC conventions)
    constexpr uint32_t RPC_OK = 0;
    constexpr uint32_t RPC_UNKNOWN = 2;
    constexpr uint32_t RPC_INVALID_ARGUMENT = 3;
    constexpr uint32_t RPC_NOT_FOUND = 5;
    constexpr uint32_t RPC_INTERNAL = 13;
    constexpr uint32_t RPC_UNAVAILABLE = 14;

    // TTHR flags (must match frontend)
    constexpr uint32_t TTHR_ALL = 0x007F;
}

ViewerRpcHandler::ViewerRpcHandler(std::shared_ptr<JobManager> jobManager)
    : jobManager_(std::move(jobManager)) {}

ViewerRpcHandler::~ViewerRpcHandler() = default;

void ViewerRpcHandler::handleNewConnection(const drogon::WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    connections_[conn.get()] = ConnectionState{};
}

void ViewerRpcHandler::handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    connections_.erase(conn.get());
}

void ViewerRpcHandler::handleMessage(const drogon::WebSocketConnectionPtr& conn,
                                     std::string&& message) {
    ConnectionState* state = nullptr;
    {
        std::lock_guard<std::mutex> lock(stateMutex_);
        auto it = connections_.find(conn.get());
        if (it == connections_.end()) return;
        state = &it->second;
    }
    handleEnvelope(conn, message, *state);
}

void ViewerRpcHandler::handleEnvelope(const drogon::WebSocketConnectionPtr& conn,
                                       const std::string& message,
                                       ConnectionState& state) {
    TetherViewerEnvelope envelope;
    if (!envelope.ParseFromArray(message.data(), message.size())) {
        return;
    }

    switch (envelope.envelope_case()) {
        case TetherViewerEnvelope::kAuth:
            state.authToken = envelope.auth().token();
            return;
        case TetherViewerEnvelope::kCancel: {
            uint32_t callId = envelope.cancel().call_id();
            auto it = state.activeCalls.find(callId);
            if (it != state.activeCalls.end() && it->second) {
                it->second->store(false);
            }
            return;
        }
        case TetherViewerEnvelope::kRequest:
            break; // Handle below
        default:
            return;
    }

    const auto& req = envelope.request();
    uint32_t callId = req.call_id();
    auto requestCase = req.request_case();
    std::string requestCaseStr;

    // Dispatch based on request case
    std::string responseBytes;
    bool hasResponse = true;
    bool streaming = false;

    try {
        switch (requestCase) {
            case TetherViewerRequest::kPing:
                responseBytes = handlePing("");
                requestCaseStr = "ping";
                break;
            case TetherViewerRequest::kGetVersion:
                responseBytes = handleGetVersion("");
                requestCaseStr = "get_version";
                break;
            case TetherViewerRequest::kUploadGcode:
                responseBytes = handleUploadGcode(req.upload_gcode().SerializeAsString());
                requestCaseStr = "upload_gcode";
                break;
            case TetherViewerRequest::kProcessJob:
                responseBytes = handleProcessJob(req.process_job().SerializeAsString());
                requestCaseStr = "process_job";
                break;
            case TetherViewerRequest::kGetJobStatus:
                responseBytes = handleGetJobStatus(req.get_job_status().SerializeAsString());
                requestCaseStr = "get_job_status";
                break;
            case TetherViewerRequest::kGetBinary:
                responseBytes = handleGetBinary(req.get_binary().SerializeAsString());
                requestCaseStr = "get_binary";
                break;
            case TetherViewerRequest::kGetBlocks:
                responseBytes = handleGetBlocks(req.get_blocks().SerializeAsString());
                requestCaseStr = "get_blocks";
                break;
            case TetherViewerRequest::kGetStatistics:
                responseBytes = handleGetStatistics(req.get_statistics().SerializeAsString());
                requestCaseStr = "get_statistics";
                break;
            case TetherViewerRequest::kGetSegments:
                responseBytes = handleGetSegments(req.get_segments().SerializeAsString());
                requestCaseStr = "get_segments";
                break;
            case TetherViewerRequest::kListJobs:
                responseBytes = handleListJobs(req.list_jobs().SerializeAsString());
                requestCaseStr = "list_jobs";
                break;
            case TetherViewerRequest::kDeleteJob:
                responseBytes = handleDeleteJob(req.delete_job().SerializeAsString());
                requestCaseStr = "delete_job";
                break;
            case TetherViewerRequest::kGetZLayers:
                responseBytes = handleGetZLayers(req.get_z_layers().SerializeAsString());
                requestCaseStr = "get_z_layers";
                break;
            case TetherViewerRequest::kGetZLayerBinary:
                responseBytes = handleGetZLayerBinary(req.get_z_layer_binary().SerializeAsString());
                requestCaseStr = "get_z_layer_binary";
                break;
            case TetherViewerRequest::kGetZLayerRangeBinary:
                responseBytes = handleGetZLayerRangeBinary(req.get_z_layer_range_binary().SerializeAsString());
                requestCaseStr = "get_z_layer_range_binary";
                break;
            case TetherViewerRequest::kGetAnalysis:
                responseBytes = handleGetAnalysis(req.get_analysis().SerializeAsString(), conn, callId, state);
                requestCaseStr = "get_analysis";
                streaming = true;
                break;
            default:
                sendErrorResponse(conn, callId, RPC_NOT_FOUND, "No handler for request case");
                return;
        }
    } catch (const std::exception& e) {
        sendErrorResponse(conn, callId, RPC_INTERNAL, e.what());
        return;
    }

    sendResponse(conn, callId, requestCaseStr, responseBytes, !streaming, hasResponse);
}

void ViewerRpcHandler::sendResponse(const drogon::WebSocketConnectionPtr& conn,
                                     uint32_t callId, const std::string& requestCase,
                                     const std::string& responseBytes, bool done,
                                     bool hasResponse) {
    TetherViewerEnvelope envelope;
    auto* response = envelope.mutable_response();
    response->set_call_id(callId);
    response->set_done(done);

    if (!responseBytes.empty() && hasResponse) {
        // Parse response bytes into the correct oneof field
        bool parsed = false;
        if (requestCase == "upload_gcode") {
            parsed = response->mutable_upload_gcode()->ParseFromString(responseBytes);
        } else if (requestCase == "process_job") {
            parsed = response->mutable_process_job()->ParseFromString(responseBytes);
        } else if (requestCase == "get_job_status") {
            parsed = response->mutable_get_job_status()->ParseFromString(responseBytes);
        } else if (requestCase == "get_binary") {
            parsed = response->mutable_get_binary()->ParseFromString(responseBytes);
        } else if (requestCase == "get_blocks") {
            parsed = response->mutable_get_blocks()->ParseFromString(responseBytes);
        } else if (requestCase == "get_statistics") {
            parsed = response->mutable_get_statistics()->ParseFromString(responseBytes);
        } else if (requestCase == "get_segments") {
            parsed = response->mutable_get_segments()->ParseFromString(responseBytes);
        } else if (requestCase == "list_jobs") {
            parsed = response->mutable_list_jobs()->ParseFromString(responseBytes);
        } else if (requestCase == "delete_job") {
            parsed = response->mutable_delete_job()->ParseFromString(responseBytes);
        } else if (requestCase == "get_z_layers") {
            parsed = response->mutable_get_z_layers()->ParseFromString(responseBytes);
        } else if (requestCase == "get_z_layer_binary") {
            parsed = response->mutable_get_z_layer_binary()->ParseFromString(responseBytes);
        } else if (requestCase == "get_z_layer_range_binary") {
            parsed = response->mutable_get_z_layer_range_binary()->ParseFromString(responseBytes);
        } else if (requestCase == "ping") {
            parsed = response->mutable_ping()->ParseFromString(responseBytes);
        } else if (requestCase == "get_version") {
            parsed = response->mutable_get_version()->ParseFromString(responseBytes);
        } else if (requestCase == "get_analysis") {
            parsed = response->mutable_analysis_result()->ParseFromString(responseBytes);
        }

        if (!parsed) {
            sendErrorResponse(conn, callId, RPC_INTERNAL, "Failed to parse response");
            return;
        }
    }

    std::string serialized = envelope.SerializeAsString();
    conn->send(serialized, drogon::WebSocketMessageType::Binary);
}

void ViewerRpcHandler::sendErrorResponse(const drogon::WebSocketConnectionPtr& conn,
                                          uint32_t callId, uint32_t errorCode,
                                          const std::string& message) {
    TetherViewerEnvelope envelope;
    auto* response = envelope.mutable_response();
    response->set_call_id(callId);
    response->set_done(true);
    response->set_error_message(message);
    response->set_error_code(errorCode);

    std::string serialized = envelope.SerializeAsString();
    conn->send(serialized, drogon::WebSocketMessageType::Binary);
}

// ── Individual RPC handlers ──────────────────────────────────────────────────

std::string ViewerRpcHandler::handleUploadGcode(const std::string& requestBytes) {
    UploadGcodeRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse UploadGcodeRequest");
    }

    std::string jobId = jobManager_->createJob(req.gcode_text(), req.filename());

    UploadGcodeResponse resp;
    resp.set_job_id(jobId);
    resp.set_filename(req.filename());
    resp.set_state("pending");
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleProcessJob(const std::string& requestBytes) {
    ProcessJobRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse ProcessJobRequest");
    }

    ProcessConfig config;
    if (req.sample_rate() > 0) config.sampleRate = req.sample_rate();
    if (req.max_velocity() > 0) config.maxVelocity = req.max_velocity();
    if (req.max_acceleration() > 0) config.maxAcceleration = req.max_acceleration();
    if (req.max_jerk() > 0) config.maxJerk = req.max_jerk();
    if (!req.strategy().empty()) config.strategy = req.strategy();

    if (!jobManager_->startProcessing(req.job_id(), config)) {
        throw std::runtime_error("Failed to start processing (job may already be processing)");
    }

    ProcessJobResponse resp;
    resp.set_job_id(req.job_id());
    resp.set_state("processing");
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetJobStatus(const std::string& requestBytes) {
    GetJobStatusRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetJobStatusRequest");
    }

    auto jobState = jobManager_->getJobState(req.job_id());
    double progress = jobManager_->getJobProgress(req.job_id());
    auto* result = jobManager_->getResult(req.job_id());

    const char* stateStr = "unknown";
    switch (jobState) {
        case JobState::Pending:    stateStr = "pending"; break;
        case JobState::Processing: stateStr = "processing"; break;
        case JobState::Ready:      stateStr = "ready"; break;
        case JobState::Failed:     stateStr = "failed"; break;
        case JobState::Deleted:    stateStr = "deleted"; break;
    }

    GetJobStatusResponse resp;
    resp.set_job_id(req.job_id());
    resp.set_state(stateStr);
    resp.set_progress(progress);
    if (result) {
        resp.set_sample_count(static_cast<uint32_t>(result->sampleCount));
        resp.set_duration(result->duration);
        resp.set_path_length(result->pathLength);
        if (!result->success) {
            resp.set_error_message(result->errorMessage);
        }
        if (!result->warning.empty()) {
            resp.set_warning(result->warning);
        }
    }
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetBinary(const std::string& requestBytes) {
    GetBinaryRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetBinaryRequest");
    }

    SerializeOptions opts;
    opts.flags = req.fields() > 0 ? req.fields() : TTHR_ALL;
    opts.axisCount = req.axes() > 0 ? req.axes() : 3;
    if (req.start_time() > 0 || req.end_time() > 0) {
        opts.timeStart = req.start_time();
        opts.timeEnd = req.end_time();
    }
    if (req.seg_start() >= 0 || req.seg_end() >= 0) {
        opts.segStart = req.seg_start();
        opts.segEnd = req.seg_end();
    }
    opts.downsample = req.downsample() > 0 ? req.downsample() : 1;

    auto binary = jobManager_->getBinary(req.job_id(), opts);
    if (binary.empty()) {
        throw std::runtime_error("Job not ready or not found");
    }

    BinaryDataResponse resp;
    resp.set_data(binary.data(), binary.size());
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetBlocks(const std::string& requestBytes) {
    GetBlocksRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetBlocksRequest");
    }

    GetBlocksResponse resp;
    auto* result = jobManager_->getResult(req.job_id());
    if (result) {
        for (const auto& blk : result->blocks) {
            auto* b = resp.add_blocks();
            b->set_block_index(blk.blockIndex);
            b->set_line_number(blk.lineNumber);
            b->set_motion_type(blk.motionType);
            b->set_gcode_text(blk.gcodeText);
        }
    }
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetStatistics(const std::string& requestBytes) {
    GetStatisticsRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetStatisticsRequest");
    }

    auto* result = jobManager_->getResult(req.job_id());
    if (!result) {
        throw std::runtime_error("Job not ready or not found");
    }

    const auto& stats = result->statistics;
    GetStatisticsResponse resp;
    resp.set_duration(stats.duration);
    resp.set_path_length(stats.pathLength);
    resp.set_sample_count(static_cast<uint32_t>(stats.sampleCount));
    resp.set_max_linear_velocity(stats.maxLinearVelocity);
    resp.set_max_linear_acceleration(stats.maxLinearAcceleration);
    resp.set_max_linear_jerk(stats.maxLinearJerk);
    resp.set_max_curvature(stats.maxCurvature);
    resp.set_max_centripetal_accel(stats.maxCentripetalAccel);
    resp.set_total_corner_error(stats.totalCornerError);
    resp.set_max_corner_error(stats.maxCornerError);
    resp.set_meets_limits(stats.meetsLimits);

    for (int i = 0; i < 3; i++) {
        const auto& axis = stats.axisStats[i];
        auto* a = resp.add_axis_stats();
        a->set_min_position(axis.minPosition);
        a->set_max_position(axis.maxPosition);
        a->set_max_velocity(axis.maxVelocity);
        a->set_max_acceleration(axis.maxAcceleration);
        a->set_max_jerk(axis.maxJerk);
    }
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetSegments(const std::string& requestBytes) {
    GetSegmentsRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetSegmentsRequest");
    }

    auto* result = jobManager_->getResult(req.job_id());
    if (!result) {
        throw std::runtime_error("Job not ready or not found");
    }

    GetSegmentsResponse resp;
    // Create one segment per motion block
    int32_t segIdx = 0;
    for (const auto& blk : result->blocks) {
        if (blk.motionType > 3) continue;
        auto* s = resp.add_segments();
        s->set_segment_index(segIdx++);
        s->set_motion_type(blk.motionType);
    }
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleListJobs(const std::string& requestBytes) {
    ListJobsRequest req;
    (void)req; // No fields to parse

    ListJobsResponse resp;
    // JobManager doesn't expose a structured list; use JSON as fallback
    // In production, add a structured listJobs() method
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleDeleteJob(const std::string& requestBytes) {
    DeleteJobRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse DeleteJobRequest");
    }

    bool deleted = jobManager_->deleteJob(req.job_id());

    DeleteJobResponse resp;
    resp.set_deleted(deleted);
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetZLayers(const std::string& requestBytes) {
    GetZLayersRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetZLayersRequest");
    }

    double zTol = req.z_tolerance() > 0 ? req.z_tolerance() : 0.01;
    auto layers = computeZLayers(req.job_id(), zTol);

    GetZLayersResponse resp;
    double minZ = layers.empty() ? 0 : layers[0].zHeight;
    double maxZ = layers.empty() ? 0 : layers[0].zHeight;
    for (const auto& layer : layers) {
        auto* l = resp.add_layers();
        l->set_layer_index(layer.layerIndex);
        l->set_z_height(layer.zHeight);
        l->set_sample_start(layer.sampleStart);
        l->set_sample_end(layer.sampleEnd);
        l->set_sample_count(layer.sampleCount);
        l->set_path_length(layer.pathLength);
        minZ = std::min(minZ, layer.zHeight);
        maxZ = std::max(maxZ, layer.zHeight);
    }
    resp.set_total_layers(static_cast<uint32_t>(layers.size()));
    resp.set_min_z(minZ);
    resp.set_max_z(maxZ);
    if (layers.size() > 1) {
        resp.set_layer_height((maxZ - minZ) / (layers.size() - 1));
    }
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetZLayerBinary(const std::string& requestBytes) {
    GetZLayerBinaryRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetZLayerBinaryRequest");
    }

    // For now, return full binary; frontend can filter by Z
    // In production, add sample-range filtering to SerializeOptions
    SerializeOptions opts;
    opts.flags = req.fields() > 0 ? req.fields() : TTHR_ALL;
    opts.axisCount = req.axes() > 0 ? req.axes() : 3;

    auto binary = jobManager_->getBinary(req.job_id(), opts);
    if (binary.empty()) {
        throw std::runtime_error("Failed to get binary data");
    }

    BinaryDataResponse resp;
    resp.set_data(binary.data(), binary.size());
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetZLayerRangeBinary(const std::string& requestBytes) {
    GetZLayerRangeBinaryRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetZLayerRangeBinaryRequest");
    }

    SerializeOptions opts;
    opts.flags = req.fields() > 0 ? req.fields() : TTHR_ALL;
    opts.axisCount = req.axes() > 0 ? req.axes() : 3;

    auto binary = jobManager_->getBinary(req.job_id(), opts);
    if (binary.empty()) {
        throw std::runtime_error("Failed to get binary data");
    }

    BinaryDataResponse resp;
    resp.set_data(binary.data(), binary.size());
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handlePing(const std::string& /*requestBytes*/) {
    PingResponse resp;
    auto now = std::chrono::duration<double>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    resp.set_timestamp(now);
    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetVersion(const std::string& /*requestBytes*/) {
    VersionResponse resp;
    resp.set_version("1.0.0");
    resp.set_protocol_version("v1");
    return resp.SerializeAsString();
}

// ── Analysis helpers ─────────────────────────────────────────────────────────

void ViewerRpcHandler::sendAnalysisResult(const drogon::WebSocketConnectionPtr& conn,
                                          uint32_t callId,
                                          const ::tether::viewer::v1::AnalysisResultResponse& result,
                                          bool done) {
    TetherViewerEnvelope envelope;
    auto* response = envelope.mutable_response();
    response->set_call_id(callId);
    response->set_done(done);
    *response->mutable_analysis_result() = result;

    std::string serialized = envelope.SerializeAsString();
    conn->send(serialized, drogon::WebSocketMessageType::Binary);
}

std::string ViewerRpcHandler::handleGetAnalysis(const std::string& requestBytes,
                                                const drogon::WebSocketConnectionPtr& conn,
                                                uint32_t callId,
                                                ConnectionState& state) {
    using namespace ::tether::viewer::v1;

    GetAnalysisRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetAnalysisRequest");
    }

    if (jobManager_->getGcodeLines(req.job_id()).empty()) {
        throw std::runtime_error("Job not found or has no G-code");
    }

    // Cancellation token for this call; also stored in per-connection state.
    auto cancelToken = std::make_shared<std::atomic<bool>>(true);
    state.activeCalls[callId] = cancelToken;

    // Send an immediate progress message so the client knows the analysis started.
    AnalysisResultResponse startProgress;
    startProgress.set_complete(false);
    auto* progress = startProgress.mutable_progress();
    progress->set_status("starting");
    progress->set_progress_percent(0);

    // Start the heavy lifting on a background thread. The initial progress is
    // returned to handleEnvelope and sent with done=false, which keeps the
    // WebSocket call open for the worker to stream the final result.
    std::thread worker([this, conn, callId, cancelToken, req = std::move(req)]() mutable {
        try {
            auto gcodeLines = jobManager_->getGcodeLines(req.job_id());
            if (gcodeLines.empty()) {
                AnalysisResultResponse err;
                err.set_complete(true);
                err.set_error_message("Job not found or has no G-code");
                sendAnalysisResult(conn, callId, err, true);
                return;
            }

            tether::analysis::AnalysisExposer exposer;
            tether::io::Registry registry;
            exposer.expose(registry, tether::analysis::ModuleIdAnalysis);

            if (!cancelToken->load()) {
                AnalysisResultResponse err;
                err.set_complete(true);
                err.set_error_message("Cancelled");
                sendAnalysisResult(conn, callId, err, true);
                return;
            }

            exposer.analyze(gcodeLines);

            if (!cancelToken->load()) {
                AnalysisResultResponse err;
                err.set_complete(true);
                err.set_error_message("Cancelled");
                sendAnalysisResult(conn, callId, err, true);
                return;
            }

            auto response = buildAnalysisResponse(registry);

            // Augment the Tether text-based analysis with material/time/layer/feature
            // metrics derived from the already parsed ProcessResult. This avoids
            // re-parsing the G-code and lets the server expose geometry-heavy stats.
            const auto* procResult = jobManager_->getResult(req.job_id());
            appendProcessResultAnalysis(response, procResult, gcodeLines, req);

            // Final progress + sections. The `complete` flag tells the client this
            // is the last message in the stream.
            auto* finalProgress = response.mutable_progress();
            finalProgress->set_status("complete");
            finalProgress->set_progress_percent(100);
            response.set_complete(true);

            sendAnalysisResult(conn, callId, response, true);
        } catch (const std::exception& e) {
            AnalysisResultResponse err;
            err.set_complete(true);
            err.set_error_message(std::string("Analysis failed: ") + e.what());
            sendAnalysisResult(conn, callId, err, true);
        }
    });
    worker.detach();

    return startProgress.SerializeAsString();
}

// ── Z-layer computation ──────────────────────────────────────────────────────

std::vector<ViewerRpcHandler::ZLayer>
ViewerRpcHandler::computeZLayers(const std::string& jobId, double zTolerance) {
    auto* result = jobManager_->getResult(jobId);
    if (!result || !result->success) {
        return {};
    }

    // Path 1: Use dense samples if available (nurbsOnly=false)
    if (!result->samples.empty()) {
        const auto& samples = result->samples;
        const uint32_t n = static_cast<uint32_t>(samples.size());

        std::vector<ZLayer> layers;
        if (n == 0) return layers;

        double currentZ = samples[0].position[2];
        uint32_t layerStart = 0;

        for (uint32_t i = 1; i < n; i++) {
            double z = samples[i].position[2];
            if (std::abs(z - currentZ) > zTolerance) {
                ZLayer layer;
                layer.layerIndex = static_cast<uint32_t>(layers.size());
                layer.zHeight = currentZ;
                layer.sampleStart = layerStart;
                layer.sampleEnd = i - 1;
                layer.sampleCount = i - layerStart;
                double pathLen = 0;
                for (uint32_t j = layerStart; j + 1 < i; j++) {
                    double dx = samples[j+1].position[0] - samples[j].position[0];
                    double dy = samples[j+1].position[1] - samples[j].position[1];
                    double dz = samples[j+1].position[2] - samples[j].position[2];
                    pathLen += std::sqrt(dx*dx + dy*dy + dz*dz);
                }
                layer.pathLength = pathLen;
                layers.push_back(layer);

                currentZ = z;
                layerStart = i;
            }
        }

        if (layerStart < n) {
            ZLayer layer;
            layer.layerIndex = static_cast<uint32_t>(layers.size());
            layer.zHeight = currentZ;
            layer.sampleStart = layerStart;
            layer.sampleEnd = n - 1;
            layer.sampleCount = n - layerStart;
            double pathLen = 0;
            for (uint32_t j = layerStart; j + 1 < n; j++) {
                double dx = samples[j+1].position[0] - samples[j].position[0];
                double dy = samples[j+1].position[1] - samples[j].position[1];
                double dz = samples[j+1].position[2] - samples[j].position[2];
                pathLen += std::sqrt(dx*dx + dy*dy + dz*dz);
            }
            layer.pathLength = pathLen;
            layers.push_back(layer);
        }

        return layers;
    }

    // Path 2: Compute from NURBS path pieces (nurbsOnly=true, default)
    if (result->nurbsPath && result->nurbsPath->numPieces() > 0) {
        const auto& path = *result->nurbsPath;
        const auto& pieces = path.pieces();
        const uint32_t pieceCount = static_cast<uint32_t>(pieces.size());

        std::vector<ZLayer> layers;
        if (pieceCount == 0) return layers;

        // Extract Z values from each piece's first and last control points
        // For linear pieces (degree 1), these are the start/end Z.
        // For arcs, they're approximate but sufficient for layer grouping.
        auto pieceStartZ = [&](uint32_t i) -> double {
            const auto& cps = pieces[i].controlPoints();
            if (cps.empty()) return 0.0;
            return cps.front()[2]; // Z is index 2
        };
        auto pieceEndZ = [&](uint32_t i) -> double {
            const auto& cps = pieces[i].controlPoints();
            if (cps.empty()) return 0.0;
            return cps.back()[2];
        };

        double currentZ = pieceStartZ(0);
        uint32_t layerStart = 0;

        for (uint32_t i = 1; i < pieceCount; i++) {
            double z = pieceStartZ(i);
            if (std::abs(z - currentZ) > zTolerance) {
                ZLayer layer;
                layer.layerIndex = static_cast<uint32_t>(layers.size());
                layer.zHeight = currentZ;
                layer.sampleStart = layerStart;
                layer.sampleEnd = i - 1;
                layer.sampleCount = i - layerStart;
                // Approximate path length from piece lengths
                double pathLen = 0;
                for (uint32_t j = layerStart; j < i; j++) {
                    // Use piece's contribution to total length
                    const auto& cps = pieces[j].controlPoints();
                    if (cps.size() >= 2) {
                        double dx = cps.back()[0] - cps.front()[0];
                        double dy = cps.back()[1] - cps.front()[1];
                        double dz = cps.back()[2] - cps.front()[2];
                        pathLen += std::sqrt(dx*dx + dy*dy + dz*dz);
                    }
                }
                layer.pathLength = pathLen;
                layers.push_back(layer);

                currentZ = z;
                layerStart = i;
            }
        }

        if (layerStart < pieceCount) {
            ZLayer layer;
            layer.layerIndex = static_cast<uint32_t>(layers.size());
            layer.zHeight = currentZ;
            layer.sampleStart = layerStart;
            layer.sampleEnd = pieceCount - 1;
            layer.sampleCount = pieceCount - layerStart;
            double pathLen = 0;
            for (uint32_t j = layerStart; j < pieceCount; j++) {
                const auto& cps = pieces[j].controlPoints();
                if (cps.size() >= 2) {
                    double dx = cps.back()[0] - cps.front()[0];
                    double dy = cps.back()[1] - cps.front()[1];
                    double dz = cps.back()[2] - cps.front()[2];
                    pathLen += std::sqrt(dx*dx + dy*dy + dz*dz);
                }
            }
            layer.pathLength = pathLen;
            layers.push_back(layer);
        }

        return layers;
    }

    return {};
}

} // namespace tether::web
