/// @file ViewerWsController.cpp
/// @brief WebSocket controller implementation.

#include "tether/web/ViewerWsController.hpp"
#include "tether/web/ViewerRpcHandler.hpp"

namespace tether::web {

void ViewerWsController::handleNewMessage(
    const drogon::WebSocketConnectionPtr& conn,
    std::string&& message,
    const drogon::WebSocketMessageType& type) {
    if (type == drogon::WebSocketMessageType::Binary && handler_) {
        handler_->handleMessage(conn, std::move(message));
    }
}

void ViewerWsController::handleNewConnection(
    const drogon::HttpRequestPtr& /*req*/,
    const drogon::WebSocketConnectionPtr& conn) {
    if (handler_) {
        handler_->handleNewConnection(conn);
    }
}

void ViewerWsController::handleConnectionClosed(
    const drogon::WebSocketConnectionPtr& conn) {
    if (handler_) {
        handler_->handleConnectionClosed(conn);
    }
}

} // namespace tether::web
