#pragma once

/// @file JobManager.hpp
/// @brief Manages async G-code processing jobs with caching.
///
/// Jobs are created when a G-code file is uploaded, processed asynchronously,
/// and cached in memory. Multiple clients can query the same job.

#include "tether/web/GCodeProcessor.hpp"
#include "tether/web/TrajectorySerializer.hpp"
#include "tether/web/NurbsSerializer.hpp"
#include "tether/web/StateProfileSerializer.hpp"

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
    std::atomic<JobState> state{JobState::Pending};
    std::atomic<double> progress{0.0};
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

    /// @brief Get serialized NURBS binary data (NBP format) for a job.
    /// Converts the trajectory samples to a PiecewiseNurbsPath via
    /// TrajectorySampleConverter, then serializes to NBP format.
    /// @param jobId Job ID
    /// @return Binary NBP data, or empty if job not ready
    std::vector<uint8_t> getNurbsBinary(const std::string& jobId) const;

    /// @brief Get serialized ReNURBS profile binary data (TRNP format).
    /// Returns per-segment NURBS curves for velocity, acceleration, jerk,
    /// and time — a WAY smaller representation than dense sampled data.
    /// @param jobId Job ID
    /// @return Binary TRNP data, or empty if not available
    std::vector<uint8_t> getReNurbsBinary(const std::string& jobId) const;

    /// @brief Get serialized PA profiles binary data (TRNP-PA format).
    /// Returns per-algorithm NURBS curves for pressure advance pre/post
    /// (Linear, PowerLaw, CrossWLF, LTI-Deconv, LPV-Deconv).
    /// @param jobId Job ID
    /// @return Binary TRNP-PA data, or empty if not available
    std::vector<uint8_t> getPaBinary(const std::string& jobId) const;

    /// @brief Get the sampled analytical state profile (TSSP format).
    /// Returns a 1D RGBA32F texture data source (time, velocity, acceleration,
    /// jerk) sampled from the Pareto analytical velocity profile.
    /// @param jobId Job ID
    /// @return Binary TSSP data, or empty if not available
    std::vector<uint8_t> getStateProfileBinary(const std::string& jobId) const;

    /// @brief Get block metadata for a job as JSON.
    std::string getBlocksJson(const std::string& jobId) const;

    /// @brief Get statistics for a job as JSON.
    std::string getStatisticsJson(const std::string& jobId) const;

    /// @brief Get segment boundaries for a job as JSON.
    std::string getSegmentsJson(const std::string& jobId) const;

    /// @brief Get per-segment speed data for miniplot as JSON.
    std::string getSpeedsJson(const std::string& jobId) const;

    /// @brief Get Z-layers for a job as JSON.
    /// Computes layers from NURBS path pieces or dense samples.
    /// @param jobId Job ID
    /// @param zTolerance Z height tolerance for grouping (mm)
    std::string getZLayersJson(const std::string& jobId, double zTolerance = 0.01) const;

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

    /// @brief Get the original G-code text split into lines.
    /// @return Empty vector if job not found or gcode is empty.
    std::vector<std::string> getGcodeLines(const std::string& jobId) const;

    /// @brief Get the original G-code text as a single string.
    /// @return Empty string if job not found.
    std::string getGcodeText(const std::string& jobId) const;

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
