/// @file web_viewer.cpp
/// @brief Standalone WebGCodeViewer server example.
///
/// Starts a Drogon-based HTTP + WebSocket server that serves the WebGPU
/// G-code viewer frontend and provides a Protobuf-over-WebSocket RPC API
/// for uploading G-code, processing trajectories, and streaming binary
/// trajectory data to the browser.
///
/// This example links against the Tether submodule for G-code parsing,
/// trajectory analysis, and motion planning. No Klipper or printer
/// connection is required — all processing happens in-memory.
///
/// Usage:
///   web_viewer [--port PORT] [--web-root DIR] [--bind ADDR] [--threads N]
///
/// Example:
///   web_viewer --port 8080
///   # Then open http://localhost:8080 in a WebGPU-compatible browser
///
/// Frontend assets are automatically copied to the build directory by CMake.
/// If --web-root is not specified, the server looks for assets relative to
/// the executable and in the build directory.

#include "tether/web/WebServer.hpp"
#include "tether/web/WebServerConfig.hpp"

#include <atomic>
#include <csignal>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>

static std::atomic<bool> g_running{true};

static void signalHandler(int) {
    g_running = false;
}

static void printUsage(const char* prog) {
    std::cerr << "Usage: " << prog << " [options]\n"
              << "\nOptions:\n"
              << "  --port PORT       HTTP listen port (default: 8080)\n"
              << "  --bind ADDR       Bind address (default: 0.0.0.0)\n"
              << "  --web-root DIR    Frontend static files directory\n"
              << "  --threads N       Number of worker threads (default: auto)\n"
              << "  --help            Show this help\n"
              << "\nExample:\n"
              << "  " << prog << " --port 8080\n"
              << "  # Open http://localhost:8080 in a WebGPU-compatible browser\n";
}

/// @brief Try to locate the frontend assets directory.
static std::string findWebRoot(const char* argv0) {
    namespace fs = std::filesystem;

    // 1. Check relative to executable
    fs::path exeDir = fs::path(argv0).parent_path();
    std::vector<fs::path> candidates = {
        exeDir / "web" / "frontend",
        exeDir / ".." / "web" / "frontend",
        exeDir / ".." / ".." / "web" / "frontend",
        fs::current_path() / "web" / "frontend",
        fs::current_path() / "frontend",
    };

    for (const auto& p : candidates) {
        if (fs::exists(p / "index.html")) {
            return p.string();
        }
    }

    return {};
}

int main(int argc, char* argv[]) {
    tether::web::WebServerConfig config;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "--port" && i + 1 < argc) {
            config.port = std::stoi(argv[++i]);
        } else if (arg == "--bind" && i + 1 < argc) {
            config.bindAddress = argv[++i];
        } else if (arg == "--web-root" && i + 1 < argc) {
            config.webRoot = argv[++i];
        } else if (arg == "--threads" && i + 1 < argc) {
            config.threads = std::stoi(argv[++i]);
        } else {
            std::cerr << "Unknown argument: " << arg << "\n";
            printUsage(argv[0]);
            return 1;
        }
    }

    // Auto-detect web root if not specified
    if (config.webRoot.empty()) {
        config.webRoot = findWebRoot(argv[0]);
    }

    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    std::cout << "╔══════════════════════════════════════════════════════════════╗\n"
              << "║                   WebGCodeViewer Server                      ║\n"
              << "╚══════════════════════════════════════════════════════════════╝\n"
              << "\n"
              << "  Port:     " << config.port << "\n"
              << "  Bind:     " << config.bindAddress << "\n"
              << "  Frontend: " << (config.webRoot.empty() ? "(not found)" : config.webRoot) << "\n"
              << "  Threads:  " << (config.threads > 0 ? std::to_string(config.threads) : "auto") << "\n"
              << "\n"
              << "  Viewer:   http://localhost:" << config.port << "/\n"
              << "  API:      ws://localhost:" << config.port << "/api/ws\n"
              << "\n";

    if (config.webRoot.empty()) {
        std::cerr << "WARNING: Frontend assets not found. The viewer UI will not be available.\n"
                  << "  Use --web-root to specify the frontend directory.\n\n";
    }

    tether::web::WebServer server(config);
    if (!server.start()) {
        std::cerr << "ERROR: Failed to start server\n";
        return 1;
    }

    std::cout << "Server running. Press Ctrl+C to stop.\n\n";

    while (g_running.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    std::cout << "\nShutting down...\n";
    server.stop();
    std::cout << "Done.\n";
    return 0;
}
