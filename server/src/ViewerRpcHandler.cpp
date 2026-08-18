/// @file ViewerRpcHandler.cpp
/// @brief RPC handler implementation for the Tether viewer WebSocket protocol.

#include "tether/web/ViewerRpcHandler.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "AnalysisSerializer.hpp"
#include "ProcessResultAnalyzer.hpp"
#include "tether/gcode/analysis/GcodeDiffAnalyzer.hpp"

#include "tether_viewer.pb.h"

#include "tether/analysis/AnalysisExposer.hpp"
#include "tether/io/Registry.hpp"

#include <drogon/WebSocketConnection.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <limits>
#include <numbers>
#include <numeric>
#include <set>
#include <sstream>
#include <string_view>
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

    // In-place uppercase conversion for case-insensitive G-code matching.
    std::string toUpper(std::string_view s) {
        std::string out;
        out.reserve(s.size());
        for (char c : s) {
            out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
        }
        return out;
    }

    // Remove inline comments (; and (...)). Returns the cleaned line and leaves
    // it otherwise intact so tokens like G1X10 are still parseable.
    std::string stripInlineComments(std::string_view line) {
        std::string out;
        out.reserve(line.size());
        bool inParen = false;
        for (size_t i = 0; i < line.size(); ++i) {
            char c = line[i];
            if (inParen) {
                if (c == ')') inParen = false;
                continue;
            }
            if (c == ';') break;
            if (c == '(') { inParen = true; continue; }
            out.push_back(c);
        }
        return out;
    }

    // Returns true if the line is empty or all whitespace after comment removal.
    bool isBlank(std::string_view line) {
        for (char c : line) {
            if (!std::isspace(static_cast<unsigned char>(c))) return false;
        }
        return true;
    }

    // Tokenize a G-code line into (word, value) pairs. Handles spaced words
    // ("G1 X10") and unspaced words ("G1X10Y20").
    std::vector<std::pair<char, std::string>> tokenizeGcode(const std::string& line) {
        std::vector<std::pair<char, std::string>> out;
        size_t i = 0;
        while (i < line.size()) {
            char c = line[i];
            if (std::isspace(static_cast<unsigned char>(c)) || c == '\r' || c == '\n') {
                ++i;
                continue;
            }
            if (std::isalpha(static_cast<unsigned char>(c))) {
                char letter = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
                size_t start = i + 1;
                size_t end = start;
                // Allow leading sign for the numeric part
                if (end < line.size() && (line[end] == '+' || line[end] == '-')) ++end;
                bool dotSeen = false;
                while (end < line.size()) {
                    char d = line[end];
                    if (std::isdigit(static_cast<unsigned char>(d))) {
                        ++end;
                    } else if (d == '.' && !dotSeen) {
                        dotSeen = true;
                        ++end;
                    } else {
                        break;
                    }
                }
                if (end > start) {
                    out.emplace_back(letter, line.substr(start, end - start));
                }
                i = end;
            } else {
                ++i;
            }
        }
        return out;
    }

    double parseDoubleOrZero(const std::string& s) {
        if (s.empty()) return 0.0;
        try {
            return std::stod(s);
        } catch (...) {
            return 0.0;
        }
    }

    int32_t parseIntOrZero(const std::string& s) {
        if (s.empty()) return 0;
        try {
            return std::stoi(s);
        } catch (...) {
            return 0;
        }
    }

    // Convert a comment value such as ";STOCK_X:123.4" into a double.
    double parseCommentValue(std::string_view line, std::string_view prefix) {
        auto pos = line.find(prefix);
        if (pos == std::string_view::npos) return std::numeric_limits<double>::quiet_NaN();
        pos += prefix.size();
        while (pos < line.size() && std::isspace(static_cast<unsigned char>(line[pos]))) ++pos;
        size_t end = pos;
        while (end < line.size() && !std::isspace(static_cast<unsigned char>(line[end])) &&
               line[end] != '\r' && line[end] != '\n' && line[end] != ';' && line[end] != '(') {
            ++end;
        }
        if (end <= pos) return std::numeric_limits<double>::quiet_NaN();
        try {
            return std::stod(std::string(line.substr(pos, end - pos)));
        } catch (...) {
            return std::numeric_limits<double>::quiet_NaN();
        }
    }

    // Check whether the tokenized words contain a G/M code value.
    bool hasCode(const std::vector<std::pair<char, std::string>>& words, char letter, double code) {
        for (const auto& [l, v] : words) {
            if (l == letter) {
                double cv = parseDoubleOrZero(v);
                if (std::abs(cv - code) < 1e-6) return true;
            }
        }
        return false;
    }

    // Extract the value for a given word letter, or empty if not present.
    const std::string* wordValue(const std::vector<std::pair<char, std::string>>& words, char letter) {
        for (const auto& [l, v] : words) {
            if (l == letter) return &v;
        }
        return nullptr;
    }
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
            case TetherViewerRequest::kGetGcodeMetadata:
                responseBytes = handleGetGcodeMetadata(req.get_gcode_metadata().SerializeAsString());
                requestCaseStr = "get_gcode_metadata";
                break;
            case TetherViewerRequest::kGetFeatureTypes:
                responseBytes = handleGetFeatureTypes(req.get_feature_types().SerializeAsString());
                requestCaseStr = "get_feature_types";
                break;
            case TetherViewerRequest::kGetProbeEvents:
                responseBytes = handleGetProbeEvents(req.get_probe_events().SerializeAsString());
                requestCaseStr = "get_probe_events";
                break;
            case TetherViewerRequest::kGetDrillingCycles:
                responseBytes = handleGetDrillingCycles(req.get_drilling_cycles().SerializeAsString());
                requestCaseStr = "get_drilling_cycles";
                break;
            case TetherViewerRequest::kGetJobSummary:
                responseBytes = handleGetJobSummary(req.get_job_summary().SerializeAsString());
                requestCaseStr = "get_job_summary";
                break;
            case TetherViewerRequest::kDiffGcode:
                responseBytes = handleDiffGcode(req.diff_gcode().SerializeAsString());
                requestCaseStr = "diff_gcode";
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

    if (hasResponse) {
        // Parse response bytes into the correct oneof field.
        // Empty bytes are valid protobuf (parses to a default-valued message),
        // so we always set the oneof field when hasResponse is true.
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
        } else if (requestCase == "get_gcode_metadata") {
            parsed = response->mutable_get_gcode_metadata()->ParseFromString(responseBytes);
        } else if (requestCase == "get_feature_types") {
            parsed = response->mutable_get_feature_types()->ParseFromString(responseBytes);
        } else if (requestCase == "get_probe_events") {
            parsed = response->mutable_get_probe_events()->ParseFromString(responseBytes);
        } else if (requestCase == "get_drilling_cycles") {
            parsed = response->mutable_get_drilling_cycles()->ParseFromString(responseBytes);
        } else if (requestCase == "get_job_summary") {
            parsed = response->mutable_get_job_summary()->ParseFromString(responseBytes);
        } else if (requestCase == "diff_gcode") {
            parsed = response->mutable_diff_gcode()->ParseFromString(responseBytes);
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

// ── New RPC handlers ─────────────────────────────────────────────────────────

std::string ViewerRpcHandler::handleGetGcodeMetadata(const std::string& requestBytes) {
    using namespace ::tether::viewer::v1;

    GetGcodeMetadataRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetGcodeMetadataRequest");
    }

    std::string gcodeText = jobManager_->getGcodeText(req.job_id());
    if (gcodeText.empty()) {
        throw std::runtime_error("Job not found or has no G-code");
    }

    const auto* result = jobManager_->getResult(req.job_id());
    const auto& blocks = result ? result->gcodeBlocks : std::vector<GCode::BlockMetadata>{};

    GetGcodeMetadataResponse resp;

    int32_t currentTool = 0;
    int32_t pendingTool = -1;
    double currentFeedRate = 0.0;
    double currentSpindleRpm = 0.0;
    std::string currentSpindleDir = "off";
    double currentFanSpeed = 0.0;
    std::string currentCoolantState = "off";

    double maxSpindleRpm = 0.0;
    double maxHotendTemp = 0.0;
    double maxBedTemp = 0.0;
    double maxFanSpeed = 0.0;
    double minFeedRate = std::numeric_limits<double>::max();
    double maxFeedRate = 0.0;

    std::set<int32_t> toolSet;
    size_t blockIdx = 0;

    bool hasStock = false;
    double stockMinX = 0.0, stockMinY = 0.0, stockMinZ = 0.0;
    double stockW = 0.0, stockD = 0.0, stockH = 0.0;

    auto tryStock = [&](std::string_view raw, std::string_view key, double& out) {
        double v = parseCommentValue(raw, key);
        if (!std::isnan(v)) { out = v; hasStock = true; }
    };

    size_t pos = 0;
    for (int32_t lineNum = 0; pos < gcodeText.size(); ++lineNum) {
        size_t nl = gcodeText.find('\n', pos);
        std::string_view rawLine = (nl == std::string::npos)
            ? std::string_view(gcodeText.data() + pos)
            : std::string_view(gcodeText.data() + pos, nl - pos);

        std::string clean = stripInlineComments(rawLine);
        std::string upperRaw = toUpper(std::string(rawLine));

        tryStock(upperRaw, ";STOCK_X:", stockMinX);
        tryStock(upperRaw, ";STOCK_Y:", stockMinY);
        tryStock(upperRaw, ";STOCK_Z:", stockMinZ);
        tryStock(upperRaw, ";STOCK_WIDTH:", stockW);
        tryStock(upperRaw, ";STOCK_DEPTH:", stockD);
        tryStock(upperRaw, ";STOCK_HEIGHT:", stockH);
        tryStock(upperRaw, ";SIZE_X:", stockW);
        tryStock(upperRaw, ";SIZE_Y:", stockD);
        tryStock(upperRaw, ";SIZE_Z:", stockH);

        if (!isBlank(clean)) {
            auto words = tokenizeGcode(clean);
            const std::string* sWord = wordValue(words, 'S');
            const std::string* fWord = wordValue(words, 'F');
            const std::string* tWord = wordValue(words, 'T');

            if (tWord) {
                pendingTool = parseIntOrZero(*tWord);
                toolSet.insert(pendingTool);
            }

            if (fWord) {
                currentFeedRate = parseDoubleOrZero(*fWord);
                auto* e = resp.add_feed_rate_changes();
                e->set_line_number(lineNum);
                e->set_feed_rate(currentFeedRate);
                minFeedRate = std::min(minFeedRate, currentFeedRate);
                maxFeedRate = std::max(maxFeedRate, currentFeedRate);
            }

            // Tool change
            if (hasCode(words, 'M', 6.0)) {
                int32_t toolNum = (pendingTool >= 0) ? pendingTool : currentTool;
                currentTool = toolNum;
                pendingTool = -1;
                auto* e = resp.add_tool_changes();
                e->set_line_number(lineNum);
                e->set_tool_number(toolNum);
            }

            // Spindle
            double sVal = sWord ? parseDoubleOrZero(*sWord) : currentSpindleRpm;
            if (hasCode(words, 'M', 3.0)) {
                currentSpindleDir = "cw";
                currentSpindleRpm = sVal;
                auto* e = resp.add_spindle_events();
                e->set_line_number(lineNum);
                e->set_rpm(currentSpindleRpm);
                e->set_direction(currentSpindleDir);
                maxSpindleRpm = std::max(maxSpindleRpm, currentSpindleRpm);
            } else if (hasCode(words, 'M', 4.0)) {
                currentSpindleDir = "ccw";
                currentSpindleRpm = sVal;
                auto* e = resp.add_spindle_events();
                e->set_line_number(lineNum);
                e->set_rpm(currentSpindleRpm);
                e->set_direction(currentSpindleDir);
                maxSpindleRpm = std::max(maxSpindleRpm, currentSpindleRpm);
            } else if (hasCode(words, 'M', 5.0)) {
                currentSpindleDir = "off";
                currentSpindleRpm = 0.0;
                auto* e = resp.add_spindle_events();
                e->set_line_number(lineNum);
                e->set_rpm(0.0);
                e->set_direction("off");
            }

            // Temperature
            bool setHotend = false, setBed = false, setChamber = false;
            double hotend = 0.0, bed = 0.0, chamber = 0.0;
            if ((hasCode(words, 'M', 104.0) || hasCode(words, 'M', 109.0)) && sWord) {
                hotend = parseDoubleOrZero(*sWord);
                setHotend = true;
                maxHotendTemp = std::max(maxHotendTemp, hotend);
            }
            if ((hasCode(words, 'M', 140.0) || hasCode(words, 'M', 190.0)) && sWord) {
                bed = parseDoubleOrZero(*sWord);
                setBed = true;
                maxBedTemp = std::max(maxBedTemp, bed);
            }
            if ((hasCode(words, 'M', 141.0) || hasCode(words, 'M', 191.0)) && sWord) {
                chamber = parseDoubleOrZero(*sWord);
                setChamber = true;
            }
            if (setHotend || setBed || setChamber) {
                auto* e = resp.add_temperature_events();
                e->set_line_number(lineNum);
                if (setHotend) e->set_hotend(hotend);
                if (setBed) e->set_bed(bed);
                if (setChamber) e->set_chamber(chamber);
            }

            // Fan
            if (hasCode(words, 'M', 106.0)) {
                double speed = sWord ? parseDoubleOrZero(*sWord) : 255.0;
                currentFanSpeed = speed;
                maxFanSpeed = std::max(maxFanSpeed, speed);
                auto* e = resp.add_fan_events();
                e->set_line_number(lineNum);
                e->set_speed(speed);
            } else if (hasCode(words, 'M', 107.0)) {
                currentFanSpeed = 0.0;
                auto* e = resp.add_fan_events();
                e->set_line_number(lineNum);
                e->set_speed(0.0);
            }

            // Coolant
            if (hasCode(words, 'M', 7.0)) {
                currentCoolantState = "mist";
                auto* e = resp.add_coolant_events();
                e->set_line_number(lineNum);
                e->set_state("mist");
            } else if (hasCode(words, 'M', 8.0)) {
                currentCoolantState = "flood";
                auto* e = resp.add_coolant_events();
                e->set_line_number(lineNum);
                e->set_state("flood");
            } else if (hasCode(words, 'M', 9.0)) {
                currentCoolantState = "off";
                auto* e = resp.add_coolant_events();
                e->set_line_number(lineNum);
                e->set_state("off");
            }

            // Work coordinate systems
            static const std::vector<std::pair<double, std::string>> wcCodes = {
                {54.0, "G54"}, {55.0, "G55"}, {56.0, "G56"}, {57.0, "G57"},
                {58.0, "G58"}, {59.0, "G59"},
                {59.1, "G59.1"}, {59.2, "G59.2"}, {59.3, "G59.3"}
            };
            for (const auto& [code, name] : wcCodes) {
                if (hasCode(words, 'G', code)) {
                    auto* e = resp.add_work_coordinate_systems();
                    e->set_line_number(lineNum);
                    e->set_code(name);
                }
            }

            // Record per-block state for any block on this line
            while (blockIdx < blocks.size() &&
                   static_cast<int32_t>(blocks[blockIdx].lineNumber) == lineNum) {
                auto* b = resp.add_block_states();
                b->set_block_index(blocks[blockIdx].blockIndex);
                b->set_feed_rate(currentFeedRate);
                b->set_tool_number(currentTool);
                b->set_spindle_rpm(currentSpindleRpm);
                ++blockIdx;
            }
        }

        pos = (nl == std::string::npos) ? gcodeText.size() : nl + 1;
    }

    for (int32_t t : toolSet) resp.add_tools(t);
    resp.set_max_spindle_rpm(maxSpindleRpm);
    resp.set_max_hotend_temp(maxHotendTemp);
    resp.set_max_bed_temp(maxBedTemp);
    resp.set_max_fan_speed(maxFanSpeed);
    resp.set_min_feed_rate(minFeedRate == std::numeric_limits<double>::max() ? 0.0 : minFeedRate);
    resp.set_max_feed_rate(maxFeedRate);

    if (hasStock) {
        auto* s = resp.mutable_stock_dimensions();
        s->set_min_x(stockMinX);
        s->set_min_y(stockMinY);
        s->set_min_z(stockMinZ);
        s->set_max_x(stockMinX + stockW);
        s->set_max_y(stockMinY + stockD);
        s->set_max_z(stockMinZ + stockH);
    }

    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetFeatureTypes(const std::string& requestBytes) {
    using namespace ::tether::viewer::v1;

    GetFeatureTypesRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetFeatureTypesRequest");
    }

    auto lines = jobManager_->getGcodeLines(req.job_id());
    if (lines.empty()) {
        throw std::runtime_error("Job not found or has no G-code");
    }

    std::string slicer = "unknown";
    for (size_t i = 0; i < std::min<size_t>(lines.size(), 200); ++i) {
        std::string u = toUpper(lines[i]);
        if (u.find("CURA") != std::string::npos) { slicer = "Cura"; break; }
        if (u.find("PRUSASLICER") != std::string::npos) { slicer = "PrusaSlicer"; break; }
        if (u.find("ORCASLICER") != std::string::npos) { slicer = "OrcaSlicer"; break; }
        if (u.find("BAMBUSTUDIO") != std::string::npos) { slicer = "BambuStudio"; break; }
        if (u.find("SIMPLIFY3D") != std::string::npos) { slicer = "Simplify3D"; break; }
    }

    GetFeatureTypesResponse resp;
    std::string activeType = "UNKNOWN";

    auto trimFeature = [](std::string s) -> std::string {
        auto end = s.find_first_of(" \t\r\n;");
        if (end != std::string::npos) s = s.substr(0, end);
        while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
        return s;
    };

    int32_t lastLine = static_cast<int32_t>(lines.size()) - 1;

    for (int32_t i = 0; i < static_cast<int32_t>(lines.size()); ++i) {
        const std::string& rawLine = lines[i];
        std::string upper = toUpper(rawLine);
        std::string_view sv(upper);

        size_t pos = std::string_view::npos;
        std::string newType;
        bool found = false;

        pos = sv.find(";TYPE:");
        if (pos != std::string_view::npos) {
            newType = std::string(sv.substr(pos + 6));
            found = true;
        } else {
            pos = sv.find(";FEATURE:");
            if (pos != std::string_view::npos) {
                newType = std::string(sv.substr(pos + 9));
                found = true;
            } else {
                pos = sv.find(";MESH:");
                if (pos != std::string_view::npos) {
                    newType = std::string(sv.substr(pos + 6));
                    found = true;
                }
            }
        }

        if (found) {
            newType = trimFeature(newType);
            if (newType != activeType) {
                if (resp.segments_size() > 0) {
                    resp.mutable_segments(resp.segments_size() - 1)->set_end_line(i - 1);
                }
                activeType = newType;
                auto* seg = resp.add_segments();
                seg->set_start_line(i);
                seg->set_end_line(lastLine);
                seg->set_feature_type(activeType);
                seg->set_slicer(slicer);
            }
        }
    }

    if (resp.segments_size() == 0) {
        auto* seg = resp.add_segments();
        seg->set_start_line(0);
        seg->set_end_line(lastLine);
        seg->set_feature_type(activeType);
        seg->set_slicer(slicer);
    } else {
        resp.mutable_segments(resp.segments_size() - 1)->set_end_line(lastLine);
    }

    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetProbeEvents(const std::string& requestBytes) {
    using namespace ::tether::viewer::v1;

    GetProbeEventsRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetProbeEventsRequest");
    }

    auto lines = jobManager_->getGcodeLines(req.job_id());
    GetProbeEventsResponse resp;

    for (int32_t i = 0; i < static_cast<int32_t>(lines.size()); ++i) {
        std::string clean = stripInlineComments(lines[i]);
        if (isBlank(clean)) continue;

        auto words = tokenizeGcode(clean);
        bool isProbe = hasCode(words, 'G', 38.2) || hasCode(words, 'G', 38.3) ||
                       hasCode(words, 'G', 38.4) || hasCode(words, 'G', 38.5);
        if (!isProbe) continue;

        auto* e = resp.add_events();
        e->set_line_number(i);
        const std::string* xv = wordValue(words, 'X');
        const std::string* yv = wordValue(words, 'Y');
        const std::string* zv = wordValue(words, 'Z');
        e->set_x(xv ? parseDoubleOrZero(*xv) : 0.0);
        e->set_y(yv ? parseDoubleOrZero(*yv) : 0.0);
        e->set_z(zv ? parseDoubleOrZero(*zv) : 0.0);
    }

    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetDrillingCycles(const std::string& requestBytes) {
    using namespace ::tether::viewer::v1;

    GetDrillingCyclesRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetDrillingCyclesRequest");
    }

    auto lines = jobManager_->getGcodeLines(req.job_id());
    GetDrillingCyclesResponse resp;

    for (int32_t i = 0; i < static_cast<int32_t>(lines.size()); ++i) {
        std::string clean = stripInlineComments(lines[i]);
        if (isBlank(clean)) continue;

        auto words = tokenizeGcode(clean);
        std::string cycleType;
        if (hasCode(words, 'G', 81.0)) cycleType = "G81";
        else if (hasCode(words, 'G', 82.0)) cycleType = "G82";
        else if (hasCode(words, 'G', 83.0)) cycleType = "G83";
        else if (hasCode(words, 'G', 73.0)) cycleType = "G73";
        else if (hasCode(words, 'G', 85.0)) cycleType = "G85";
        else if (hasCode(words, 'G', 86.0)) cycleType = "G86";
        else if (hasCode(words, 'G', 89.0)) cycleType = "G89";
        if (cycleType.empty()) continue;

        auto* e = resp.add_cycles();
        e->set_line_number(i);
        e->set_cycle_type(cycleType);
        const std::string* xv = wordValue(words, 'X');
        const std::string* yv = wordValue(words, 'Y');
        const std::string* zv = wordValue(words, 'Z');
        const std::string* rv = wordValue(words, 'R');
        e->set_x(xv ? parseDoubleOrZero(*xv) : 0.0);
        e->set_y(yv ? parseDoubleOrZero(*yv) : 0.0);
        e->set_z(zv ? parseDoubleOrZero(*zv) : 0.0);
        e->set_r(rv ? parseDoubleOrZero(*rv) : 0.0);
    }

    return resp.SerializeAsString();
}

std::string ViewerRpcHandler::handleGetJobSummary(const std::string& requestBytes) {
    using namespace ::tether::viewer::v1;

    GetJobSummaryRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse GetJobSummaryRequest");
    }

    const auto* result = jobManager_->getResult(req.job_id());
    if (!result) {
        throw std::runtime_error("Job not ready or not found");
    }

    GetJobSummaryResponse resp;

    // Material usage
    double extrusionLength = 0.0;
    if (result->extruderSpeeds.size() == result->segmentSpeeds.size()) {
        for (size_t i = 0; i < result->extruderSpeeds.size(); ++i) {
            extrusionLength += std::max(0.0, static_cast<double>(result->extruderSpeeds[i])) *
                               result->segmentSpeeds[i].duration;
        }
    } else {
        extrusionLength = result->pathLength;
    }

    double radius = 1.75 / 2.0;
    double volume = extrusionLength * std::numbers::pi * radius * radius;
    double weight = volume / 1000.0 * 1.24;
    auto* mu = resp.mutable_material_usage();
    mu->set_extrusion_length(extrusionLength);
    mu->set_volume(volume);
    mu->set_weight(weight);

    // Speed stats
    std::vector<double> speeds;
    speeds.reserve(result->segmentSpeeds.size());
    for (const auto& s : result->segmentSpeeds) {
        if (s.speedLinear > 0.0) speeds.push_back(s.speedLinear);
    }
    if (!speeds.empty()) {
        double minS = *std::min_element(speeds.begin(), speeds.end());
        double maxS = *std::max_element(speeds.begin(), speeds.end());
        double mean = std::accumulate(speeds.begin(), speeds.end(), 0.0) / static_cast<double>(speeds.size());
        std::sort(speeds.begin(), speeds.end());
        double median = (speeds.size() % 2 == 1)
            ? speeds[speeds.size() / 2]
            : (speeds[speeds.size() / 2 - 1] + speeds[speeds.size() / 2]) / 2.0;
        auto* ss = resp.mutable_speed_stats();
        ss->set_min_speed(minS);
        ss->set_max_speed(maxS);
        ss->set_mean_speed(mean);
        ss->set_median_speed(median);
    }

    // Layer times
    auto layers = computeZLayers(req.job_id(), 0.01);
    for (const auto& layer : layers) {
        double time = 0.0;
        if (!result->segmentSpeeds.empty() && layer.sampleStart < result->segmentSpeeds.size()) {
            uint32_t end = std::min<uint32_t>(
                layer.sampleEnd,
                static_cast<uint32_t>(result->segmentSpeeds.size()) - 1);
            for (uint32_t i = layer.sampleStart; i <= end; ++i) {
                time += result->segmentSpeeds[i].duration;
            }
        }
        auto* lt = resp.add_layer_times();
        lt->set_layer_index(layer.layerIndex);
        lt->set_z_height(layer.zHeight);
        lt->set_time_seconds(time);
    }

    // Print time estimate
    auto* te = resp.mutable_print_time_estimate();
    te->set_estimated_time(result->duration);
    te->set_move_count(static_cast<uint32_t>(result->segmentSpeeds.size()));
    te->set_method("analytical");

    return resp.SerializeAsString();
}

namespace {
    std::vector<std::string> splitLines(const std::string& text) {
        std::vector<std::string> lines;
        if (text.empty()) {
            lines.emplace_back("");
            return lines;
        }
        size_t start = 0;
        for (size_t i = 0; i < text.size(); ++i) {
            if (text[i] == '\n') {
                lines.emplace_back(text.substr(start, i - start));
                start = i + 1;
            }
        }
        lines.emplace_back(text.substr(start));
        return lines;
    }
}

std::string ViewerRpcHandler::handleDiffGcode(const std::string& requestBytes) {
    DiffGcodeRequest req;
    if (!req.ParseFromString(requestBytes)) {
        throw std::runtime_error("Failed to parse DiffGcodeRequest");
    }

    const auto oldLines = splitLines(req.old_text());
    const auto newLines = splitLines(req.new_text());
    const auto result = tether::gcode::analysis::GcodeDiffAnalyzer::diff(oldLines, newLines);

    DiffGcodeResponse resp;
    for (const auto& a : result.added) {
        auto* line = resp.add_added();
        line->set_line_number(a.lineNumber);
        line->set_content(a.content);
    }
    for (const auto& r : result.removed) {
        auto* line = resp.add_removed();
        line->set_line_number(r.lineNumber);
        line->set_content(r.content);
    }
    for (const auto& m : result.modified) {
        auto* mod = resp.add_modified();
        mod->set_old_line_number(m.oldLineNumber);
        mod->set_new_line_number(m.newLineNumber);
        mod->set_old_content(m.oldContent);
        mod->set_new_content(m.newContent);
    }
    resp.set_unchanged(result.unchanged);
    auto* summary = resp.mutable_summary();
    summary->set_total_added(result.summary.totalAdded);
    summary->set_total_removed(result.summary.totalRemoved);
    summary->set_total_modified(result.summary.totalModified);
    summary->set_total_unchanged(result.summary.totalUnchanged);
    summary->set_similarity_score(result.summary.similarityScore);
    for (const auto& w : result.wordChanges) {
        auto* wc = resp.add_word_changes();
        wc->set_line_number(w.lineNumber);
        wc->set_word(w.word);
        wc->set_old_value(w.oldValue);
        wc->set_new_value(w.newValue);
    }
    return resp.SerializeAsString();
}

} // namespace tether::web
