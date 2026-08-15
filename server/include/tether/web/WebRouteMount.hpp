#pragma once

/// @file WebRouteMount.hpp
/// @brief Mounts trajectory viewer API routes onto a Drogon app instance.
///
/// This allows the trajectory viewer routes to be integrated into an
/// existing Drogon server (e.g. KlippyHttpServer) or used standalone
/// via WebServer.

#include "tether/web/JobManager.hpp"

#include <drogon/drogon.h>
#include <memory>
#include <string>

namespace tether::web {

/// @brief Mount trajectory viewer API routes onto a Drogon app.
/// @param jobManager Shared job manager instance
/// @param enableCors Whether to add CORS headers
void mountWebRoutes(std::shared_ptr<JobManager> jobManager,
                    bool enableCors = true);

} // namespace tether::web
