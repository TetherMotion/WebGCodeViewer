#pragma once

/// @file ViewerRpcHandler.hpp
/// @brief RPC handler for the Tether viewer WebSocket protocol.
///
/// Dispatches protobuf-encoded requests to registered handlers and sends
/// protobuf-encoded responses back over the WebSocket connection. Supports
/// unary and server-streaming RPC patterns with call_id correlation.

#include "tether/web/JobManager.hpp"
#include "tether/web/WebServerConfig.hpp"
#include "tether/web/GCodeProcessor.hpp"

#include <drogon/WebSocketConnection.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace tether::web {

/// @brief RPC handler for viewer WebSocket requests.
class ViewerRpcHandler {
public:
    explicit ViewerRpcHandler(std::shared_ptr<JobManager> jobManager);
    ~ViewerRpcHandler();

    /// @brief Handle a binary protobuf message from a WebSocket client.
    void handleMessage(const drogon::WebSocketConnectionPtr& conn,
                       std::string&& message);

    /// @brief Called when a new WebSocket connection is established.
    void handleNewConnection(const drogon::WebSocketConnectionPtr& conn);

    /// @brief Called when a WebSocket connection is closed.
    void handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn);

private:
    std::shared_ptr<JobManager> jobManager_;

    // Per-connection state
    struct ConnectionState {
        std::string authToken;
        std::map<uint32_t, std::atomic<bool>> activeCalls;
    };

    std::mutex stateMutex_;
    std::map<void*, ConnectionState> connections_;

    // Handler implementations
    void handleEnvelope(const drogon::WebSocketConnectionPtr& conn,
                        const std::string& message,
                        ConnectionState& state);

    void sendResponse(const drogon::WebSocketConnectionPtr& conn,
                      uint32_t callId, const std::string& requestCase,
                      const std::string& responseBytes, bool done,
                      bool hasResponse = true);

    void sendErrorResponse(const drogon::WebSocketConnectionPtr& conn,
                           uint32_t callId, uint32_t errorCode,
                           const std::string& message);

    // Individual RPC handlers
    std::string handleUploadGcode(const std::string& requestBytes);
    std::string handleProcessJob(const std::string& requestBytes);
    std::string handleGetJobStatus(const std::string& requestBytes);
    std::string handleGetBinary(const std::string& requestBytes);
    std::string handleGetBlocks(const std::string& requestBytes);
    std::string handleGetStatistics(const std::string& requestBytes);
    std::string handleGetSegments(const std::string& requestBytes);
    std::string handleListJobs(const std::string& requestBytes);
    std::string handleDeleteJob(const std::string& requestBytes);
    std::string handleGetZLayers(const std::string& requestBytes);
    std::string handleGetZLayerBinary(const std::string& requestBytes);
    std::string handleGetZLayerRangeBinary(const std::string& requestBytes);
    std::string handlePing(const std::string& requestBytes);
    std::string handleGetVersion(const std::string& requestBytes);

    // Z-layer computation
    struct ZLayer {
        uint32_t layerIndex;
        double zHeight;
        uint32_t sampleStart;
        uint32_t sampleEnd;
        uint32_t sampleCount;
        double pathLength;
    };

    std::vector<ZLayer> computeZLayers(const std::string& jobId, double zTolerance);
};

} // namespace tether::web
