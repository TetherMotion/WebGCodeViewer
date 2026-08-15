#pragma once

/// @file ViewerWsController.hpp
/// @brief WebSocket controller for the Tether viewer RPC protocol.
///
/// Implements a binary protobuf-over-WebSocket RPC protocol inspired by
/// the Noxeco NoxvisionEnvelope pattern. A single envelope message with
/// a oneof discriminator (auth/request/response/cancel) is sent as raw
/// binary protobuf in WebSocket binary frames.
///
/// The controller delegates to ViewerRpcHandler for request dispatch.

#include "tether/web/JobManager.hpp"
#include "tether/web/WebServerConfig.hpp"

#include <drogon/WebSocketController.h>
#include <drogon/WebSocketConnection.h>

#include <memory>
#include <string>

namespace tether::web {

class ViewerRpcHandler;

/// @brief WebSocket controller for /api/ws endpoint.
class ViewerWsController
    : public drogon::WebSocketController<ViewerWsController, false> {
public:
    static void initPathRouting() {
        // Path registered manually via app().registerWebSocketController()
    }

    ViewerWsController() = default;
    explicit ViewerWsController(std::shared_ptr<ViewerRpcHandler> handler)
        : handler_(std::move(handler)) {}

    void setHandler(std::shared_ptr<ViewerRpcHandler> handler) {
        handler_ = std::move(handler);
    }

    void handleNewMessage(const drogon::WebSocketConnectionPtr& conn,
                          std::string&& message,
                          const drogon::WebSocketMessageType& type) override;

    void handleNewConnection(const drogon::HttpRequestPtr& req,
                             const drogon::WebSocketConnectionPtr& conn) override;

    void handleConnectionClosed(const drogon::WebSocketConnectionPtr& conn) override;

private:
    std::shared_ptr<ViewerRpcHandler> handler_;
};

} // namespace tether::web
