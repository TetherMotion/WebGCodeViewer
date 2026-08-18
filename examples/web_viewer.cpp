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
///   web_viewer [-p PORT] [-b ADDR] [-w DIR] [-j N]
///
/// Example:
///   web_viewer -p 8080
///   # Then open http://localhost:8080 in a WebGPU-compatible browser
///
/// Frontend assets are automatically copied to the build directory by CMake.
/// If --web-root is not specified, the server looks for assets relative to
/// the executable and in the build directory.

#include "tether/web/WebServer.hpp"
#include "tether/web/WebServerConfig.hpp"

#include <argparse/argparse.hpp>

#include <filesystem>
#include <iostream>
#include <string>

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

    argparse::ArgumentParser program("web_viewer");
    program.add_argument("-p", "--port")
        .scan<'i', int>()
        .default_value(config.port)
        .help("HTTP listen port (default: 8080)");
    program.add_argument("-b", "--bind")
        .default_value(config.bindAddress)
        .help("Bind address (default: 0.0.0.0)");
    program.add_argument("-w", "--web-root")
        .default_value(std::string{})
        .help("Frontend static files directory (auto-detected if omitted)");
    program.add_argument("-j", "--threads")
        .scan<'i', int>()
        .default_value(config.threads)
        .help("Number of worker threads (default: auto)");

    try {
        program.parse_args(argc, argv);
    } catch (const std::runtime_error& err) {
        std::cerr << err.what() << '\n' << program;
        return 1;
    }

    config.port = program.get<int>("--port");
    config.bindAddress = program.get<std::string>("--bind");
    config.webRoot = program.get<std::string>("--web-root");
    config.threads = program.get<int>("--threads");

    // Auto-detect web root if not specified
    if (config.webRoot.empty()) {
        config.webRoot = findWebRoot(argv[0]);
    }

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

    std::cout << "Server running. Press Ctrl+C to stop.\n\n";

    // start() blocks — runs Drogon's event loop in this thread.
    // Ctrl+C triggers Drogon's signal handler → quit() → start() returns.
    server.start();

    std::cout << "\nShutting down...\n";
    server.stop();
    std::cout << "Done.\n";
    return 0;
}
