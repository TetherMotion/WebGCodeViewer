#pragma once

/// @file JobManager.hpp
/// @brief Manages async G-code processing jobs with caching.
///
/// Jobs are created when a G-code file is uploaded, processed asynchronously,
/// and cached in memory. Multiple clients can query the same job.

#include "tether/web/GCodeProcessor.hpp"
#include "tether/web/TrajectorySerializer.hpp"

#include <atomic>
#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace tether::web {

/// @brief Job state.
enum class JobState {
    Pending,      ///< Uploaded but not yet processed
    Processing,   ///< Currently being processed
    Ready,        ///< Processing complete, data available
    Failed,       ///< Processing failed
    Deleted       ///< Job has been deleted
};

/// @brief A processing job.
struct Job {
    std::string id;
    std::string gcodeText;
    std::string filename;
    ProcessConfig config;
    ProcessResult result;
    JobState state = JobState::Pending;
    double progress = 0.0;
    std::chrono::steady_clock::time_point createdAt;
    std::chrono::steady_clock::time_point completedAt;
    std::thread worker;
};

/// @brief Configuration for the job manager.
struct JobManagerConfig {
    size_t maxJobs = 16;             ///< Maximum concurrent jobs
    size_t maxMemoryMB = 512;        ///< Max total memory for cached results
    size_t jobTimeoutSec = 300;      ///< Auto-delete jobs after N seconds
};

/// @brief Manages processing jobs with thread-safe lifecycle.
class JobManager {
public:
    explicit JobManager(const JobManagerConfig& config = JobManagerConfig{});
    ~JobManager();

    /// @brief Create a new job from uploaded G-code.
    /// @param gcodeText Raw G-code text
    /// @param filename Original filename
    /// @return Job ID
    std::string createJob(const std::string& gcodeText,
                          const std::string& filename = "");

    /// @brief Start processing a job asynchronously.
    /// @param jobId Job ID from createJob
    /// @param config Processing configuration
    /// @return true if processing started, false if job not found or already processing
    bool startProcessing(const std::string& jobId,
                         const ProcessConfig& config = {});

    /// @brief Get job state.
    /// @return JobState, or Deleted if not found
    JobState getJobState(const std::string& jobId) const;

    /// @brief Get job progress (0.0 to 1.0).
    double getJobProgress(const std::string& jobId) const;

    /// @brief Get processing result (only valid if state is Ready).
    /// @return Pointer to result, or nullptr if not ready/not found
    const ProcessResult* getResult(const std::string& jobId) const;

    /// @brief Get serialized binary data for a job.
    /// @param jobId Job ID
    /// @param options Serialization options (field filtering, range, downsample)
    /// @return Binary TTHR data, or empty if job not ready
    std::vector<uint8_t> getBinary(
        const std::string& jobId,
        const SerializeOptions& options = {}) const;

    /// @brief Get block metadata for a job as JSON.
    std::string getBlocksJson(const std::string& jobId) const;

    /// @brief Get statistics for a job as JSON.
    std::string getStatisticsJson(const std::string& jobId) const;

    /// @brief Get segment boundaries for a job as JSON.
    std::string getSegmentsJson(const std::string& jobId) const;

    /// @brief Delete a job and free its memory.
    /// @return true if job was deleted, false if not found
    bool deleteJob(const std::string& jobId);

    /// @brief List all active jobs as JSON.
    std::string listJobsJson() const;

    /// @brief Set a callback to be called when a job's state changes.
    void setStateChangeCallback(std::function<void(const std::string& jobId, JobState)> callback);

    /// @brief Cleanup expired jobs (called periodically).
    void cleanupExpired();

    /// @brief Get number of active jobs.
    size_t jobCount() const;

private:
    /// @brief Generate a unique job ID.
    std::string generateId() const;

    /// @brief Get job by ID (thread-safe).
    std::shared_ptr<Job> getJob(const std::string& jobId) const;

    /// @brief Worker thread function for processing.
    void processWorker(std::shared_ptr<Job> job);

    JobManagerConfig config_;
    mutable std::mutex mutex_;
    std::map<std::string, std::shared_ptr<Job>> jobs_;
    std::atomic<uint64_t> idCounter_{0};
    std::function<void(const std::string&, JobState)> stateCallback_;
};

} // namespace tether::web
