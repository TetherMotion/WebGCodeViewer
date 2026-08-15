#include "tether/web/JobManager.hpp"

#include "tether/motion_replanner/TrajectorySampleConverter.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <iomanip>
#include <random>
#include <sstream>

namespace tether::web {

namespace {

/// @brief Generate a hex job ID from a counter + random component.
std::string makeJobId(uint64_t counter) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<uint32_t> dist(0, 0xFFFFFF);

    std::ostringstream ss;
    ss << std::hex << std::setfill('0')
       << std::setw(8) << counter
       << std::setw(6) << dist(gen);
    return ss.str();
}

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

const char* stateToString(JobState s) {
    switch (s) {
        case JobState::Pending:    return "pending";
        case JobState::Processing: return "processing";
        case JobState::Ready:      return "ready";
        case JobState::Failed:     return "failed";
        case JobState::Deleted:    return "deleted";
    }
    return "unknown";
}

} // anonymous namespace

// ── Constructor / Destructor ─────────────────────────────────────────────────

JobManager::JobManager(const JobManagerConfig& config) : config_(config) {}

JobManager::~JobManager() {
    // Wait for all worker threads to finish
    std::vector<std::thread> threads;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (auto& [id, job] : jobs_) {
            if (job->worker.joinable()) {
                threads.push_back(std::move(job->worker));
            }
        }
    }
    for (auto& t : threads) {
        if (t.joinable()) t.join();
    }
}

// ── Job lifecycle ────────────────────────────────────────────────────────────

std::string JobManager::createJob(const std::string& gcodeText,
                                   const std::string& filename) {
    std::lock_guard<std::mutex> lock(mutex_);

    // Evict oldest if at capacity
    if (jobs_.size() >= config_.maxJobs) {
        auto oldest = jobs_.begin();
        for (auto it = jobs_.begin(); it != jobs_.end(); ++it) {
            if (it->second->createdAt < oldest->second->createdAt) {
                oldest = it;
            }
        }
        if (oldest != jobs_.end()) {
            if (oldest->second->worker.joinable())
                oldest->second->worker.detach();
            jobs_.erase(oldest);
        }
    }

    auto job = std::make_shared<Job>();
    job->id = makeJobId(++idCounter_);
    job->gcodeText = gcodeText;
    job->filename = filename;
    job->state = JobState::Pending;
    job->progress = 0.0;
    job->createdAt = std::chrono::steady_clock::now();

    std::string id = job->id;
    jobs_[id] = std::move(job);
    return id;
}

bool JobManager::startProcessing(const std::string& jobId,
                                  const ProcessConfig& config) {
    auto job = getJob(jobId);
    if (!job) return false;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (job->state == JobState::Processing) return false;
        if (job->state == JobState::Deleted) return false;
        job->state = JobState::Processing;
        job->progress = 0.0;
        job->config = config;
    }

    if (stateCallback_) stateCallback_(jobId, JobState::Processing);

    // Start worker thread
    job->worker = std::thread(&JobManager::processWorker, this, job);
    return true;
}

JobState JobManager::getJobState(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job) return JobState::Deleted;
    return job->state;
}

double JobManager::getJobProgress(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job) return 0.0;
    return job->progress;
}

const ProcessResult* JobManager::getResult(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job) return nullptr;
    // Return result for both Ready and Failed states so the client can
    // access the error message when a job fails.
    if (job->state != JobState::Ready && job->state != JobState::Failed) return nullptr;
    return &job->result;
}

std::vector<uint8_t> JobManager::getBinary(
    const std::string& jobId,
    const SerializeOptions& options) const
{
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return {};
    return serializeTrajectory(job->result.samples, job->result.blocks, options);
}

std::vector<uint8_t> JobManager::getNurbsBinary(const std::string& jobId) const
{
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return {};

    try {
        // Use the pre-built NURBS path from ProcessResult (fast path).
        // This was built directly from PlanningSegments during processing —
        // no dense sampling needed.
        if (job->result.nurbsPath && job->result.nurbsPath->numPieces() > 0) {
            const auto& path = *job->result.nurbsPath;

            // Extract motion types from blocks (map block index → motion type)
            std::vector<uint8_t> motionTypes;
            motionTypes.reserve(path.numPieces());
            for (std::size_t i = 0; i < path.numPieces(); ++i) {
                motionTypes.push_back(1); // default linear
            }

            // Per-piece deviations from G64 corner deviation computation
            const auto& deviations = job->result.deviations;
            // Per-piece extruder speeds from E axis computation
            const auto& extruderSpeeds = job->result.extruderSpeeds;

            return serializeNurbsPath(path, job->result.blocks, motionTypes, deviations, extruderSpeeds);
        }

        // Fallback: convert from samples (slow, only if nurbsPath wasn't built)
        if (!job->result.samples.empty()) {
            tether::motion::replanner::SegmentToPieceMap map;
            auto path = tether::motion::replanner::convertTrajectory(
                job->result.samples, map);

            std::vector<uint8_t> motionTypes;
            motionTypes.reserve(path.numPieces());
            for (std::size_t i = 0; i < path.numPieces(); ++i) {
                motionTypes.push_back(1);
            }

            return serializeNurbsPath(path, job->result.blocks, motionTypes);
        }
    } catch (const std::exception& e) {
        // Log and return empty — the REST handler will return 404
        return {};
    }

    return {};
}

std::string JobManager::getBlocksJson(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return "{\"error\":\"job not ready\"}";

    std::ostringstream ss;
    ss << "{\"blocks\":[";
    for (size_t i = 0; i < job->result.blocks.size(); ++i) {
        const auto& blk = job->result.blocks[i];
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"blockIndex\":" << blk.blockIndex << ",";
        ss << "\"lineNumber\":" << blk.lineNumber << ",";
        ss << "\"motionType\":" << static_cast<int>(blk.motionType) << ",";
        ss << "\"gcodeText\":\"" << jsonEscape(blk.gcodeText) << "\"";
        ss << "}";
    }
    ss << "]}";
    return ss.str();
}

std::string JobManager::getStatisticsJson(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return "{\"error\":\"job not ready\"}";
    return statisticsToJson(job->result.statistics);
}

std::string JobManager::getSegmentsJson(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return "{\"error\":\"job not ready\"}";

    // Find segment boundaries from samples
    std::vector<std::pair<int32_t, double>> boundaries;
    int32_t lastSeg = -1;
    for (const auto& s : job->result.samples) {
        if (s.segmentIndex != lastSeg) {
            boundaries.emplace_back(s.segmentIndex, s.time);
            lastSeg = s.segmentIndex;
        }
    }

    std::ostringstream ss;
    ss << "{\"segments\":[";
    for (size_t i = 0; i < boundaries.size(); ++i) {
        if (i > 0) ss << ",";
        ss << "{\"segmentIndex\":" << boundaries[i].first
           << ",\"startTime\":" << boundaries[i].second << "}";
    }
    ss << "]}";
    return ss.str();
}

std::string JobManager::getSpeedsJson(const std::string& jobId) const {
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return "{\"error\":\"job not ready\"}";

    const auto& speeds = job->result.segmentSpeeds;
    double totalTime = 0.0;
    if (!speeds.empty()) totalTime = speeds.back().timeStart + speeds.back().duration;

    std::ostringstream ss;
    ss << "{\"totalTime\":" << totalTime
       << ",\"totalSegments\":" << speeds.size()
       << ",\"segments\":[";
    for (size_t i = 0; i < speeds.size(); ++i) {
        if (i > 0) ss << ",";
        const auto& s = speeds[i];
        ss << "{";
        ss << "\"timeStart\":" << s.timeStart << ",";
        ss << "\"duration\":" << s.duration << ",";
        ss << "\"blockIndex\":" << s.blockIndex << ",";
        ss << "\"lineNumber\":" << s.lineNumber << ",";
        ss << "\"speedX\":" << s.speedX << ",";
        ss << "\"speedY\":" << s.speedY << ",";
        ss << "\"speedZ\":" << s.speedZ << ",";
        ss << "\"speedE\":" << s.speedE << ",";
        ss << "\"speedLinear\":" << s.speedLinear;
        ss << "}";
    }
    ss << "]}";
    return ss.str();
}

std::string JobManager::getZLayersJson(const std::string& jobId, double zTolerance) const {
    auto job = getJob(jobId);
    if (!job || job->state != JobState::Ready) return "{\"error\":\"job not ready\"}";

    const auto& result = job->result;
    std::ostringstream ss;
    ss << "{\"layers\":[";

    // Path 1: dense samples
    if (!result.samples.empty()) {
        const auto& samples = result.samples;
        const uint32_t n = static_cast<uint32_t>(samples.size());
        double currentZ = samples[0].position[2];
        uint32_t layerStart = 0;
        size_t layerIdx = 0;

        for (uint32_t i = 1; i < n; i++) {
            double z = samples[i].position[2];
            if (std::abs(z - currentZ) > zTolerance) {
                if (layerIdx > 0) ss << ",";
                ss << "{\"layerIndex\":" << layerIdx
                   << ",\"zHeight\":" << currentZ
                   << ",\"pieceStart\":" << layerStart
                   << ",\"pieceEnd\":" << (i - 1)
                   << ",\"pieceCount\":" << (i - layerStart)
                   << "}";
                layerIdx++;
                currentZ = z;
                layerStart = i;
            }
        }
        if (layerStart < n) {
            if (layerIdx > 0) ss << ",";
            ss << "{\"layerIndex\":" << layerIdx
               << ",\"zHeight\":" << currentZ
               << ",\"pieceStart\":" << layerStart
               << ",\"pieceEnd\":" << (n - 1)
               << ",\"pieceCount\":" << (n - layerStart)
               << "}";
            layerIdx++;
        }
        ss << "],\"totalLayers\":" << layerIdx << "}";
        return ss.str();
    }

    // Path 2: NURBS path pieces
    if (result.nurbsPath && result.nurbsPath->numPieces() > 0) {
        const auto& pieces = result.nurbsPath->pieces();
        const uint32_t pieceCount = static_cast<uint32_t>(pieces.size());

        auto pieceStartZ = [&](uint32_t i) -> double {
            const auto& cps = pieces[i].controlPoints();
            if (cps.empty()) return 0.0;
            return cps.front()[2];
        };

        double currentZ = pieceStartZ(0);
        uint32_t layerStart = 0;
        size_t layerIdx = 0;

        for (uint32_t i = 1; i < pieceCount; i++) {
            double z = pieceStartZ(i);
            if (std::abs(z - currentZ) > zTolerance) {
                if (layerIdx > 0) ss << ",";
                ss << "{\"layerIndex\":" << layerIdx
                   << ",\"zHeight\":" << currentZ
                   << ",\"pieceStart\":" << layerStart
                   << ",\"pieceEnd\":" << (i - 1)
                   << ",\"pieceCount\":" << (i - layerStart)
                   << "}";
                layerIdx++;
                currentZ = z;
                layerStart = i;
            }
        }
        if (layerStart < pieceCount) {
            if (layerIdx > 0) ss << ",";
            ss << "{\"layerIndex\":" << layerIdx
               << ",\"zHeight\":" << currentZ
               << ",\"pieceStart\":" << layerStart
               << ",\"pieceEnd\":" << (pieceCount - 1)
               << ",\"pieceCount\":" << (pieceCount - layerStart)
               << "}";
            layerIdx++;
        }
        ss << "],\"totalLayers\":" << layerIdx << "}";
        return ss.str();
    }

    ss << "],\"totalLayers\":0}";
    return ss.str();
}

bool JobManager::deleteJob(const std::string& jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(jobId);
    if (it == jobs_.end()) return false;
    if (it->second->worker.joinable())
        it->second->worker.detach();
    jobs_.erase(it);
    if (stateCallback_) stateCallback_(jobId, JobState::Deleted);
    return true;
}

std::string JobManager::listJobsJson() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::ostringstream ss;
    ss << "{\"jobs\":[";
    bool first = true;
    for (const auto& [id, job] : jobs_) {
        if (!first) ss << ",";
        first = false;
        ss << "{";
        ss << "\"id\":\"" << id << "\",";
        ss << "\"filename\":\"" << jsonEscape(job->filename) << "\",";
        ss << "\"state\":\"" << stateToString(job->state) << "\",";
        ss << "\"progress\":" << job->progress << ",";
        ss << "\"sampleCount\":" << job->result.sampleCount << ",";
        ss << "\"duration\":" << job->result.duration << ",";
        ss << "\"pathLength\":" << job->result.pathLength;
        ss << "}";
    }
    ss << "]}";
    return ss.str();
}

void JobManager::setStateChangeCallback(
    std::function<void(const std::string&, JobState)> callback) {
    std::lock_guard<std::mutex> lock(mutex_);
    stateCallback_ = std::move(callback);
}

void JobManager::cleanupExpired() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto now = std::chrono::steady_clock::now();
    auto timeout = std::chrono::seconds(config_.jobTimeoutSec);
    for (auto it = jobs_.begin(); it != jobs_.end(); ) {
        if (it->second->state == JobState::Ready &&
            (now - it->second->completedAt) > timeout) {
            if (it->second->worker.joinable())
                it->second->worker.detach();
            it = jobs_.erase(it);
        } else {
            ++it;
        }
    }
}

size_t JobManager::jobCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return jobs_.size();
}

// ── Private methods ──────────────────────────────────────────────────────────

std::shared_ptr<Job> JobManager::getJob(const std::string& jobId) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = jobs_.find(jobId);
    if (it == jobs_.end()) return nullptr;
    return it->second;
}

void JobManager::processWorker(std::shared_ptr<Job> job) {
    GCodeProcessor processor;
    ProcessResult result;

    try {
        result = processor.process(
            job->gcodeText, job->config,
            [job](double p) { job->progress = p; }
        );
    } catch (const std::exception& e) {
        result.success = false;
        result.errorMessage = std::string("Processing exception: ") + e.what();
    } catch (...) {
        result.success = false;
        result.errorMessage = "Processing exception: unknown error";
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        job->result = std::move(result);
        job->state = job->result.success ? JobState::Ready : JobState::Failed;
        job->progress = 1.0;
        job->completedAt = std::chrono::steady_clock::now();
    }

    if (stateCallback_) {
        JobState finalState = job->result.success ? JobState::Ready : JobState::Failed;
        stateCallback_(job->id, finalState);
    }
}

} // namespace tether::web
