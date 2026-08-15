#pragma once

/// @file WebServerConfig.hpp
/// @brief Configuration for the Tether web viewer server.

#include <string>
#include <vector>

namespace tether::web {

/// @brief Configuration for the web viewer server.
struct WebServerConfig {
    /// @brief HTTP listen port (default: 8080)
    int port = 8080;

    /// @brief Bind address (default: 0.0.0.0)
    std::string bindAddress = "0.0.0.0";

    /// @brief Root directory for static frontend files.
    /// If empty, static file serving is disabled.
    std::string webRoot;

    /// @brief Maximum number of concurrent processing jobs.
    size_t maxJobs = 16;

    /// @brief Maximum memory for cached results (MB).
    size_t maxMemoryMB = 512;

    /// @brief Job auto-cleanup timeout (seconds).
    size_t jobTimeoutSec = 300;

    /// @brief Enable CORS for all origins.
    bool enableCors = true;

    /// @brief Trusted client IPs (bypass auth).
    std::vector<std::string> trustedClients = {"127.0.0.1", "::1"};

    /// @brief Number of Drogon worker threads (0 = auto).
    int threads = 0;
};

} // namespace tether::web
