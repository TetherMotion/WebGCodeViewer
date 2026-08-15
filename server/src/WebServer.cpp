#include "tether/web/WebServer.hpp"
#include "tether/web/WebRouteMount.hpp"
#include "tether/web/ViewerWsController.hpp"
#include "tether/web/ViewerRpcHandler.hpp"

#include <drogon/drogon.h>
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
            std::this_thread::sleep_for(std::chrono::seconds(30));
            jobManager_->cleanupExpired();
        }
    });

    // Start Drogon in background thread
    running_ = true;
    drogonThread_ = std::thread([this]() {
        auto& app = drogon::app();
        app.setLogLevel(trantor::Logger::kWarn);
        std::string addr = config_.bindAddress.empty() ? "0.0.0.0" : config_.bindAddress;
        app.addListener(addr, config_.port);
        if (config_.threads > 0) app.setThreadNum(config_.threads);
        app.run();
    });

    return true;
}

void WebServer::stop() {
    if (!running_.load()) return;
    running_ = false;

    cleanupRunning_ = false;
    drogon::app().quit();

    if (cleanupThread_.joinable()) cleanupThread_.join();
    if (drogonThread_.joinable()) drogonThread_.join();
}

void WebServer::registerStaticAssets() {
    if (config_.webRoot.empty()) return;

    auto& app = drogon::app();
    app.setDocumentRoot(config_.webRoot);
    app.setHomePage("index.html");

    // SPA fallback: serve index.html for unmatched GET routes
    app.registerHandler("/",
        [this](const drogon::HttpRequestPtr& req,
               std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
            auto resp = drogon::HttpResponse::newFileResponse(
                config_.webRoot + "/index.html");
            if (config_.enableCors) {
                resp->addHeader("Access-Control-Allow-Origin", "*");
            }
            cb(resp);
        }, {drogon::Get});
}

} // namespace tether::web
