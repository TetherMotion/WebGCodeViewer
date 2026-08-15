#pragma once

/// @file WebServer.hpp
/// @brief Standalone Drogon-based web viewer server.
///
/// Serves the WebGPU frontend and provides REST API endpoints for
/// G-code upload, processing, and binary trajectory data retrieval.

#include "tether/web/WebServerConfig.hpp"
#include "tether/web/JobManager.hpp"

#include <drogon/drogon.h>
#include <atomic>
#include <memory>
#include <thread>

namespace tether::web {

class ViewerRpcHandler;

/// @brief Standalone web viewer server.
class WebServer {
public:
    explicit WebServer(const WebServerConfig& config = {});
    ~WebServer();

    /// @brief Start the server (non-blocking, runs Drogon in background thread).
    /// @return true if started successfully
    bool start();

    /// @brief Stop the server.
    void stop();

    /// @brief Check if the server is running.
    bool isRunning() const { return running_.load(); }

    /// @brief Get the job manager.
    std::shared_ptr<JobManager> jobManager() { return jobManager_; }

    /// @brief Get the configuration.
    const WebServerConfig& config() const { return config_; }

private:
    void registerStaticAssets();

    WebServerConfig config_;
    std::shared_ptr<JobManager> jobManager_;
    std::shared_ptr<ViewerRpcHandler> rpcHandler_;
    std::atomic<bool> running_{false};
    std::thread cleanupThread_;
    std::atomic<bool> cleanupRunning_{false};
};

} // namespace tether::web
