#include "tether/web/WebRouteMount.hpp"
#include "tether/web/TrajectorySerializer.hpp"

#include <drogon/drogon.h>
#include <sstream>
#include <string>

namespace tether::web {

namespace {

/// @brief Escape a string for JSON.
std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

/// @brief Add CORS headers to a response.
void addCorsHeaders(const drogon::HttpResponsePtr& resp) {
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET, POST, PUT, DELETE, OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Content-Type, Authorization");
}

/// @brief Create a JSON error response.
drogon::HttpResponsePtr makeErrorResponse(
    int code, const std::string& message, bool cors = true)
{
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setStatusCode(static_cast<drogon::HttpStatusCode>(code));
    resp->setContentTypeString("application/json");
    std::string body = "{\"error\":{\"code\":" + std::to_string(code) +
                       ",\"message\":\"" + message + "\"}}";
    resp->setBody(body);
    if (cors) addCorsHeaders(resp);
    return resp;
}

/// @brief Create a JSON success response.
drogon::HttpResponsePtr makeJsonResponse(const std::string& json, bool cors = true) {
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setContentTypeString("application/json");
    resp->setBody(json);
    if (cors) addCorsHeaders(resp);
    return resp;
}

/// @brief Parse uint16 query parameter with default.
uint16_t parseFlags(const std::string& fields) {
    uint16_t flags = 0;
    if (fields.empty() || fields == "all") return TTHRFlags::All;
    // Parse comma-separated field names
    std::istringstream ss(fields);
    std::string token;
    while (std::getline(ss, token, ',')) {
        if (token == "pos" || token == "positions") flags |= TTHRFlags::Positions;
        else if (token == "vel" || token == "velocities") flags |= TTHRFlags::Velocities;
        else if (token == "acc" || token == "accelerations") flags |= TTHRFlags::Accelerations;
        else if (token == "jerk" || token == "jerks") flags |= TTHRFlags::Jerks;
        else if (token == "linear") flags |= TTHRFlags::LinearMetrics;
        else if (token == "curve" || token == "curvature") flags |= TTHRFlags::Curvature;
        else if (token == "seg" || token == "segment") flags |= TTHRFlags::SegmentInfo;
    }
    return flags;
}

} // anonymous namespace

void mountWebRoutes(std::shared_ptr<JobManager> jobManager, bool enableCors) {
    auto& app = drogon::app();

    // ── OPTIONS handler for CORS preflight ──
    auto corsHandler = [enableCors](const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        if (enableCors) addCorsHeaders(resp);
        resp->setStatusCode(drogon::HttpStatusCode::k204NoContent);
        cb(resp);
    };

    // ── POST /api/trajectory/upload ──
    // Upload G-code file (multipart or raw text)
    app.registerHandler("/api/trajectory/upload",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
            std::string gcodeText;
            std::string filename;

            // Check content type for multipart
            std::string contentType = req->getHeader("Content-Type");
            if (contentType.find("multipart/form-data") != std::string::npos) {
                // Parse multipart form data manually
                std::string body(req->getBody().data(), req->getBody().size());
                // Find boundary
                auto bpos = contentType.find("boundary=");
                if (bpos != std::string::npos) {
                    std::string boundary = "--" + contentType.substr(bpos + 9);
                    // Find the file part
                    auto partStart = body.find(boundary);
                    while (partStart != std::string::npos) {
                        auto nextPart = body.find(boundary, partStart + boundary.size());
                        if (nextPart == std::string::npos) break;
                        std::string part = body.substr(partStart, nextPart - partStart);
                        // Look for filename
                        auto fnPos = part.find("filename=\"");
                        if (fnPos != std::string::npos) {
                            auto fnEnd = part.find("\"", fnPos + 10);
                            filename = part.substr(fnPos + 10, fnEnd - fnPos - 10);
                        }
                        // Look for content after headers
                        auto hdrEnd = part.find("\r\n\r\n");
                        if (hdrEnd != std::string::npos) {
                            gcodeText = part.substr(hdrEnd + 4);
                            // Remove trailing \r\n
                            while (!gcodeText.empty() &&
                                   (gcodeText.back() == '\r' || gcodeText.back() == '\n')) {
                                gcodeText.pop_back();
                            }
                        }
                        partStart = nextPart;
                    }
                }
            } else {
                // Raw body (text/plain or application/octet-stream)
                std::string_view bodyView = req->getBody();
                gcodeText = std::string(bodyView);
                // Try to get filename from query param
                auto params = req->getParameters();
                auto it = params.find("filename");
                if (it != params.end()) filename = it->second;
            }

            if (gcodeText.empty()) {
                cb(makeErrorResponse(400, "No G-code data provided", enableCors));
                return;
            }

            std::string jobId = jobManager->createJob(gcodeText, filename);
            std::string json = "{\"jobId\":\"" + jobId +
                               "\",\"filename\":\"" + filename +
                               "\",\"state\":\"pending\"}";
            cb(makeJsonResponse(json, enableCors));
        }, {drogon::Post});

    // ── POST /api/trajectory/{jobId}/process ──
    // Start processing a job
    app.registerHandler("/api/trajectory/{jobId}/process",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobId.empty()) {
                cb(makeErrorResponse(400, "Missing jobId", enableCors));
                return;
            }

            ProcessConfig config;
            // Parse optional config from query params or JSON body
            auto params = req->getParameters();
            auto getParam = [&](const std::string& key) -> std::string {
                auto it = params.find(key);
                return it != params.end() ? it->second : "";
            };

            try {
                std::string sr = getParam("sampleRate");
                if (!sr.empty()) config.sampleRate = std::stod(sr);
                std::string mv = getParam("maxVelocity");
                if (!mv.empty()) config.maxVelocity = std::stod(mv);
                std::string ma = getParam("maxAcceleration");
                if (!ma.empty()) config.maxAcceleration = std::stod(ma);
                std::string mj = getParam("maxJerk");
                if (!mj.empty()) config.maxJerk = std::stod(mj);
            } catch (const std::exception& e) {
                cb(makeErrorResponse(400, std::string("Invalid numeric parameter: ") + e.what(), enableCors));
                return;
            }
            std::string strat = getParam("strategy");
            if (!strat.empty()) config.strategy = strat;

            // Also check JSON body
            std::string_view bodyView = req->getBody();
            std::string body(bodyView);
            if (!body.empty() && body[0] == '{') {
                // Simple JSON parsing for config overrides
                auto extractVal = [&body](const std::string& key) -> std::string {
                    std::string search = "\"" + key + "\":";
                    auto pos = body.find(search);
                    if (pos == std::string::npos) return "";
                    pos += search.size();
                    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '"')) ++pos;
                    size_t end = pos;
                    while (end < body.size() && body[end] != ',' && body[end] != '}' &&
                           body[end] != '"') ++end;
                    return body.substr(pos, end - pos);
                };
                try {
                    std::string bsr = extractVal("sampleRate");
                    if (!bsr.empty()) config.sampleRate = std::stod(bsr);
                    std::string bmv = extractVal("maxVelocity");
                    if (!bmv.empty()) config.maxVelocity = std::stod(bmv);
                } catch (const std::exception& e) {
                    cb(makeErrorResponse(400, std::string("Invalid JSON parameter: ") + e.what(), enableCors));
                    return;
                }
            }

            if (!jobManager->startProcessing(jobId, config)) {
                cb(makeErrorResponse(409, "Job not found or already processing", enableCors));
                return;
            }

            std::string json = "{\"jobId\":\"" + jobId + "\",\"state\":\"processing\"}";
            cb(makeJsonResponse(json, enableCors));
        }, {drogon::Post});

    // ── GET /api/trajectory/{jobId}/status ──
    // Get job status and progress
    app.registerHandler("/api/trajectory/{jobId}/status",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            auto state = jobManager->getJobState(jobId);
            double progress = jobManager->getJobProgress(jobId);

            const char* stateStr = "unknown";
            switch (state) {
                case JobState::Pending:    stateStr = "pending"; break;
                case JobState::Processing: stateStr = "processing"; break;
                case JobState::Ready:      stateStr = "ready"; break;
                case JobState::Failed:     stateStr = "failed"; break;
                case JobState::Deleted:    stateStr = "deleted"; break;
            }

            std::string json = "{\"jobId\":\"" + jobId +
                               "\",\"state\":\"" + stateStr +
                               "\",\"progress\":" + std::to_string(progress);

            // Include error message for failed jobs
            if (state == JobState::Failed) {
                const auto* result = jobManager->getResult(jobId);
                if (result && !result->errorMessage.empty()) {
                    json += ",\"errorMessage\":\"" + jsonEscape(result->errorMessage) + "\"";
                }
            }

            json += "}";
            cb(makeJsonResponse(json, enableCors));
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/binary ──
    // Get binary TTHR data (raw HTTP, bypasses protobuf 2GB limit)
    app.registerHandler("/api/trajectory/{jobId}/binary",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }

            SerializeOptions opts;
            opts.flags = parseFlags(req->getParameter("fields"));

            try {
                std::string axesStr = req->getParameter("axes");
                opts.axisCount = axesStr.empty() ? 3 : static_cast<uint8_t>(std::stoi(axesStr));

                std::string startStr = req->getParameter("start");
                if (!startStr.empty()) opts.timeStart = std::stod(startStr);
                std::string endStr = req->getParameter("end");
                if (!endStr.empty()) opts.timeEnd = std::stod(endStr);
                std::string segStartStr = req->getParameter("segStart");
                if (!segStartStr.empty()) opts.segStart = std::stoi(segStartStr);
                std::string segEndStr = req->getParameter("segEnd");
                if (!segEndStr.empty()) opts.segEnd = std::stoi(segEndStr);
                std::string dsStr = req->getParameter("downsample");
                if (!dsStr.empty()) opts.downsample = static_cast<uint32_t>(std::stoi(dsStr));
            } catch (const std::exception& e) {
                cb(makeErrorResponse(400, std::string("Invalid parameter: ") + e.what(), enableCors));
                return;
            }

            auto binary = jobManager->getBinary(jobId, opts);
            if (binary.empty()) {
                cb(makeErrorResponse(404, "No data available", enableCors));
                return;
            }

            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setContentTypeString("application/octet-stream");
            resp->addHeader("Content-Disposition",
                            "attachment; filename=\"trajectory.tthr\"");
            // No-cache so clients always get fresh data
            resp->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            resp->setBody(std::string(reinterpret_cast<const char*>(binary.data()),
                                       binary.size()));
            if (enableCors) addCorsHeaders(resp);
            cb(resp);
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/nurbs ──
    // Get NURBS binary data (NBP format) — compact curve representation
    app.registerHandler("/api/trajectory/{jobId}/nurbs",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }

            auto binary = jobManager->getNurbsBinary(jobId);
            if (binary.empty()) {
                cb(makeErrorResponse(404, "No NURBS data available", enableCors));
                return;
            }

            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->setContentTypeString("application/octet-stream");
            resp->addHeader("Content-Disposition",
                            "attachment; filename=\"trajectory.nbp\"");
            resp->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            resp->setBody(std::string(reinterpret_cast<const char*>(binary.data()),
                                       binary.size()));
            if (enableCors) addCorsHeaders(resp);
            cb(resp);
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/blocks ──
    app.registerHandler("/api/trajectory/{jobId}/blocks",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }
            cb(makeJsonResponse(jobManager->getBlocksJson(jobId), enableCors));
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/statistics ──
    app.registerHandler("/api/trajectory/{jobId}/statistics",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }
            cb(makeJsonResponse(jobManager->getStatisticsJson(jobId), enableCors));
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/segments ──
    app.registerHandler("/api/trajectory/{jobId}/segments",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }
            cb(makeJsonResponse(jobManager->getSegmentsJson(jobId), enableCors));
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/speeds ──
    app.registerHandler("/api/trajectory/{jobId}/speeds",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }
            cb(makeJsonResponse(jobManager->getSpeedsJson(jobId), enableCors));
        }, {drogon::Get});

    // ── GET /api/trajectory/{jobId}/zlayers ──
    app.registerHandler("/api/trajectory/{jobId}/zlayers",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->getJobState(jobId) != JobState::Ready) {
                cb(makeErrorResponse(404, "Job not ready", enableCors));
                return;
            }
            // Optional zTolerance query param
            double zTol = 0.01;
            auto tolParam = req->getParameter("zTolerance");
            if (!tolParam.empty()) {
                try { zTol = std::stod(tolParam); } catch (...) {}
            }
            cb(makeJsonResponse(jobManager->getZLayersJson(jobId, zTol), enableCors));
        }, {drogon::Get});

    // ── DELETE /api/trajectory/{jobId} ──
    app.registerHandler("/api/trajectory/{jobId}",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb,
           const std::string& jobId) {
            if (jobManager->deleteJob(jobId)) {
                cb(makeJsonResponse("{\"deleted\":true}", enableCors));
            } else {
                cb(makeErrorResponse(404, "Job not found", enableCors));
            }
        }, {drogon::Delete});

    // ── GET /api/trajectory/jobs ──
    app.registerHandler("/api/trajectory/jobs",
        [jobManager, enableCors](const drogon::HttpRequestPtr& req,
           std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
            cb(makeJsonResponse(jobManager->listJobsJson(), enableCors));
        }, {drogon::Get});

    // ── Register CORS preflight for all /api/trajectory/* paths ──
    app.registerHandler("/api/trajectory/.*",
        corsHandler, {drogon::Options});
}

} // namespace tether::web
