#include "tether/web/WebServer.hpp"
#include "tether/web/WebRouteMount.hpp"
#include "tether/web/ViewerWsController.hpp"
#include "tether/web/ViewerRpcHandler.hpp"

#include <drogon/drogon.h>
#include <csignal>
#include <iostream>

namespace tether::web {

WebServer::WebServer(const WebServerConfig& config)
    : config_(config)
{
    JobManagerConfig jmConfig;
    jmConfig.maxJobs = config.maxJobs;
    jmConfig.maxMemoryMB = config.maxMemoryMB;
    jmConfig.jobTimeoutSec = config.jobTimeoutSec;
    jobManager_ = std::make_shared<JobManager>(jmConfig);

    // Create RPC handler for WebSocket
    rpcHandler_ = std::make_shared<ViewerRpcHandler>(jobManager_);
}

WebServer::~WebServer() {
    stop();
}

bool WebServer::start() {
    if (running_.load()) return true;

    // Reset SIGINT/SIGTERM to default. Shells set SIGINT to SIG_IGN
    // for background processes (using &), which prevents signal handlers
    // from working. Resetting to SIG_DFL allows Drogon's handler to install.
    // When run in the foreground (normal case), this is a no-op.
    std::signal(SIGINT, SIG_DFL);
    std::signal(SIGTERM, SIG_DFL);

    // Mount API routes
    mountWebRoutes(jobManager_, config_.enableCors);

    // Register WebSocket controller for RPC protocol
    auto wsController = std::make_shared<ViewerWsController>(rpcHandler_);
    drogon::app().registerWebSocketController("/api/ws",
        "tether::web::ViewerWsController", {});
    drogon::DrClassMap::setSingleInstance(
        std::static_pointer_cast<drogon::DrObjectBase>(wsController));

    // Register static assets
    registerStaticAssets();

    // Start cleanup thread
    cleanupRunning_ = true;
    cleanupThread_ = std::thread([this]() {
        while (cleanupRunning_.load()) {
            for (int i = 0; i < 60 && cleanupRunning_.load(); ++i) {
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
            if (cleanupRunning_.load()) {
                jobManager_->cleanupExpired();
            }
        }
    });

    running_ = true;

    // Configure Drogon
    auto& app = drogon::app();
    app.setLogLevel(trantor::Logger::kWarn);
    // Set signal handlers that call quit() on Ctrl+C / SIGTERM.
    app.setIntSignalHandler([]() { drogon::app().quit(); });
    app.setTermSignalHandler([]() { drogon::app().quit(); });
    std::string addr = config_.bindAddress.empty() ? "0.0.0.0" : config_.bindAddress;
    app.addListener(addr, config_.port);
    if (config_.threads > 0) app.setThreadNum(config_.threads);

    // Allow large G-code file uploads (default Drogon limit is 1MB).
    // G-code files can be 100MB+, so set a generous limit.
    app.setClientMaxBodySize(512 * 1024 * 1024); // 512MB

    // Run Drogon in the main thread — blocks until quit() is called.
    // Ctrl+C sends SIGINT → Drogon's handler calls quit() → app.run() returns.
    app.run();
    running_ = false;

    return true;
}

void WebServer::stop() {
    running_ = false;
    cleanupRunning_ = false;
    drogon::app().quit();

    if (cleanupThread_.joinable()) cleanupThread_.join();
}

void WebServer::registerStaticAssets() {
    if (config_.webRoot.empty()) return;

    auto& app = drogon::app();
    app.setDocumentRoot(config_.webRoot);
    app.setHomePage("index.html");

    // Serve a minimal favicon to avoid 404 noise
    app.registerHandler("/favicon.ico",
        [this](const drogon::HttpRequestPtr& req,
               std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
            // Try to serve from web root first
            std::string favPath = config_.webRoot + "/favicon.ico";
            auto resp = drogon::HttpResponse::newFileResponse(favPath);
            // If file doesn't exist, Drogon returns 404 — that's fine,
            // but we can also serve an inline 1x1 PNG to suppress the error
            if (resp->getStatusCode() == drogon::HttpStatusCode::k404NotFound) {
                // Minimal 1x1 transparent PNG
                static const unsigned char png[] = {
                    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,
                    0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
                    0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,
                    0x0D,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,
                    0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,
                    0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
                };
                resp = drogon::HttpResponse::newHttpResponse();
                resp->setContentTypeCode(drogon::CT_IMAGE_PNG);
                resp->setBody(std::string(reinterpret_cast<const char*>(png), sizeof(png)));
                resp->addHeader("Cache-Control", "max-age=86400");
            }
            cb(resp);
        }, {drogon::Get});

    // SPA fallback: serve index.html for unmatched GET routes
    app.registerHandler("/",
        [this](const drogon::HttpRequestPtr& req,
               std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
            auto resp = drogon::HttpResponse::newFileResponse(
                config_.webRoot + "/index.html");
            // Prevent caching of the HTML entry point so new JS versions
            // are picked up immediately
            resp->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            resp->addHeader("Pragma", "no-cache");
            resp->addHeader("Expires", "0");
            if (config_.enableCors) {
                resp->addHeader("Access-Control-Allow-Origin", "*");
            }
            cb(resp);
        }, {drogon::Get});
}

} // namespace tether::web
