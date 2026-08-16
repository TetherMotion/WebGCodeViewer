#include "tether/web/GCodeProcessor.hpp"
#include "tether/gcode/motion/G64CornerMode.hpp"
#include "tether/motion_planner/PathAdapter.hpp"
#include "tether/motion_planner/BasicTOPPRA.hpp"
#include "tether/motion_planner/profile_renurbs/ReNURBSProfileBuilder.hpp"
#include "tether/web/PaProfileBuilder.hpp"

#include <algorithm>
#include <cmath>

namespace tether::web {

using GCode::Position;
using GCode::PlanningSegment;
using GCode::SegmentMotionType;
using GCodeExport::TrajectorySample;
using GCodeExport::TrajectoryAnalyzer;
using GCodeExport::AnalysisConfig;
using GCodeExport::TrajectoryStatistics;

// ── Constructor / Destructor ─────────────────────────────────────────────────

GCodeProcessor::GCodeProcessor() = default;
GCodeProcessor::~GCodeProcessor() = default;

// ── Main processing entry point ──────────────────────────────────────────────

ProcessResult GCodeProcessor::process(
    const std::string& gcodeText,
    const ProcessConfig& config,
    std::function<void(double)> progress)
{
    ProcessResult result;

    if (progress) progress(0.0);

    // ── Step 1: Parse G-code into PlanningSegments + block metadata ──
    // Uses Tether's PlanningSegmentBuilder (GCode::Interpreter under the hood)
    // with emit-arc-segments mode so arcs are preserved as exact segments.
    auto parseResult = GCode::PlanningSegmentBuilder::fromText(gcodeText);

    if (!parseResult.error.ok()) {
        result.success = false;
        result.errorMessage = "G-code parse error";
        if (progress) progress(1.0);
        return result;
    }

    auto& segments = parseResult.segments;

    // Convert GCode::BlockMetadata → tether::web::BlockMetadata
    // (same fields, different namespaces)
    std::vector<BlockMetadata> blocks;
    blocks.reserve(parseResult.blocks.size());
    for (const auto& blk : parseResult.blocks) {
        BlockMetadata b;
        b.blockIndex = blk.blockIndex;
        b.lineNumber = blk.lineNumber;
        b.motionType = blk.motionType;
        b.gcodeText = blk.gcodeText;
        blocks.push_back(std::move(b));
    }

    if (segments.empty()) {
        result.success = false;
        result.errorMessage = "No motion segments found in G-code";
        if (progress) progress(1.0);
        return result;
    }

    if (progress) progress(0.3);

    // ── Step 2: Compute per-segment corner deviation (%) ──
    // Uses Tether's CornerAnalyzer::analyze() which computes the
    // deviationPercentage field (cos(halfAngle) × 100).
    computeCornerDeviation(segments);

    // ── Step 2b: Compute per-segment extruder speed (mm/s) from E axis ──
    // This is viewer-specific: the PlanningSegmentBuilder doesn't track
    // extruder E-axis movement, so we compute it from the segment data.
    // Note: exitVelocity is repurposed for E delta storage during parsing.
    // Since PlanningSegmentBuilder doesn't populate E delta, this is a no-op
    // for now — the viewer's extruder speed feature requires E-axis tracking
    // which is not yet available in the Tether pipeline.
    computeExtruderSpeed(segments);

    // ── Step 2c: Build per-segment speed data for miniplot ──
    {
        double currentTime = 0.0;
        for (const auto& seg : segments) {
            SegmentSpeed ss;
            ss.timeStart = currentTime;
            ss.duration = seg.segmentTime;
            ss.blockIndex = seg.blockIndex;
            // Find line number from blocks
            if (ss.blockIndex >= 0 && ss.blockIndex < static_cast<int32_t>(blocks.size())) {
                ss.lineNumber = blocks[ss.blockIndex].lineNumber;
            }
            // Per-axis speeds: |delta| / time
            double dt = seg.segmentTime > 1e-9 ? seg.segmentTime : 1e-9;
            ss.speedX = std::abs(seg.end[0] - seg.start[0]) / dt;
            ss.speedY = std::abs(seg.end[1] - seg.start[1]) / dt;
            ss.speedZ = std::abs(seg.end[2] - seg.start[2]) / dt;
            ss.speedE = seg.exitVelocity; // already computed as mm/s
            ss.speedLinear = seg.segmentLength / dt;
            result.segmentSpeeds.push_back(ss);
            currentTime += seg.segmentTime;
        }
    }

    if (progress) progress(0.4);

    // ── Step 3: Build NURBS path from segments (FAST) ──
    // Uses Tether's tether::motion::piecewiseNurbsFromSegments().
    // This is O(segments) — typically milliseconds, not minutes.
    try {
        auto nurbsResult = tether::motion::piecewiseNurbsFromSegments(segments);
        result.nurbsPath = std::move(nurbsResult.path);
        result.deviations = std::move(nurbsResult.deviations);
        result.extruderSpeeds = std::move(nurbsResult.extruderSpeeds);
        result.pathLength = result.nurbsPath->totalLength();
    } catch (const std::exception& e) {
        result.success = false;
        result.errorMessage = std::string("NURBS construction failed: ") + e.what();
        if (progress) progress(1.0);
        return result;
    }

    if (progress) progress(0.6);

    // ── Step 3b: Build ReNURBS profile (velocity/accel/jerk as NURBS curves) ──
    // Constructs a PathAdapter from the PiecewiseNurbsPath, runs BasicTOPPRA
    // to get a sampled VelocityProfile, then fits per-segment NURBS curves
    // via buildReNURBSProfile(). This produces a WAY smaller representation
    // than dense sampling: O(segments × controlPoints) vs O(samples).
    // The resulting curves are evaluated in the frontend shader directly.
    try {
        if (result.nurbsPath && !result.nurbsPath->pieces().empty()) {
            // Build PathAdapter from the NURBS path
            MotionPlanner::PathAdapter<3, double> pathAdapter(*result.nurbsPath);

            // Configure kinematic limits from ProcessConfig
            MotionPlanner::KinematicLimits<3, double> limits;
            limits.path.maxPathVelocity = config.maxVelocity;
            limits.path.maxPathAcceleration = config.maxAcceleration;
            limits.path.maxPathJerk = config.maxJerk;
            limits.path.jerkLimitEnabled = (config.maxJerk > 0.0);
            for (int i = 0; i < 3; ++i) {
                limits.axis.maxVelocity[i] = config.maxVelocity;
                limits.axis.maxAcceleration[i] = config.maxAcceleration;
                limits.axis.maxJerk[i] = config.maxJerk;
            }
            limits.axis.jerkLimitEnabled = limits.path.jerkLimitEnabled;

            // Run BasicTOPPRA to get a sampled velocity profile
            MotionPlanner::BasicTOPPRA<3, double> profiler(limits);
            // Use the first segment's feed rate as the global feed rate.
            // Feed rate in G-code is mm/min; convert to mm/s.
            // For a more accurate profile, per-segment feed rates would be
            // used, but BasicTOPPRA takes a single feed rate.
            double feedRate = config.maxVelocity;
            for (const auto& seg : parseResult.segments) {
                if (seg.feedRate > 0.0) {
                    feedRate = std::min(feedRate, seg.feedRate / 60.0);
                    break;
                }
            }
            // Number of samples for the velocity profile — enough resolution
            // for the ReNURBS fitter to capture the profile shape.
            std::size_t numSamples = std::max<std::size_t>(
                200, pathAdapter.numSegments() * 20);
            auto velocityProfile = profiler.computeProfile(
                pathAdapter, feedRate, 0.0, 0.0, numSamples);

            // Build ReNURBS profile from the velocity profile
            tether::motion::profile_renurbs::ReNURBSConfig renurbsConfig;
            renurbsConfig.enabled = true;
            renurbsConfig.certify = false;  // skip certification for speed
            renurbsConfig.certifyThrowOnFailure = false;
            // Use default tolerances and degrees

            auto renurbsProfile = tether::motion::profile_renurbs::buildReNURBSProfile(
                velocityProfile, pathAdapter, limits, renurbsConfig);

            // Compute max values for normalization from control point convex hull
            float maxVel = 0.0f, maxAccel = 0.0f, maxJerk = 0.0f, maxTime = 0.0f;
            for (const auto& seg : renurbsProfile.perSegment) {
                if (seg.velocity.curve) {
                    for (const auto& cp : seg.velocity.curve->controlPoints()) {
                        if (cp.dim() > 0) maxVel = std::max(maxVel, static_cast<float>(cp[0]));
                    }
                }
                if (seg.acceleration.curve) {
                    for (const auto& cp : seg.acceleration.curve->controlPoints()) {
                        if (cp.dim() > 0) maxAccel = std::max(maxAccel, static_cast<float>(std::abs(cp[0])));
                    }
                }
                if (seg.jerk.curve) {
                    for (const auto& cp : seg.jerk.curve->controlPoints()) {
                        if (cp.dim() > 0) maxJerk = std::max(maxJerk, static_cast<float>(std::abs(cp[0])));
                    }
                }
                maxTime = std::max(maxTime, static_cast<float>(seg.sEnd));
            }

            result.renurbsProfile = std::move(renurbsProfile);
            result.renurbsMaxVelocity = maxVel;
            result.renurbsMaxAcceleration = maxAccel;
            result.renurbsMaxJerk = maxJerk;
            result.renurbsMaxTime = maxTime;

            // ── Step 3c: Compute pressure advance profiles ──
            // For each PA algorithm (Linear, PowerLaw, CrossWLF, LTI, LPV),
            // compute pre-PA velocity and post-PA offset, fitted to ReNURBS.
            // Selectable in the UI for visualization in the plot and color modes.
            try {
                // Build extrusion ratios from segment data
                // ratio = |E_delta| / segmentLength (0 for non-extruding moves)
                std::vector<double> extrusionRatios;
                extrusionRatios.reserve(parseResult.segments.size());
                for (const auto& seg : parseResult.segments) {
                    if (seg.isRapid || seg.segmentLength < 1e-12) {
                        extrusionRatios.push_back(0.0);
                    } else {
                        // exitVelocity was repurposed for extruder speed (mm/s)
                        // ratio = extruderSpeed * time / segmentLength
                        // = extruderSpeed / (segmentLength / segmentTime)
                        // = extruderSpeed / pathVelocity
                        // But we don't have pathVelocity here directly.
                        // Use a simpler approximation: if extruderSpeed > 0,
                        // ratio = 1.0 (full extrusion), else 0.0
                        extrusionRatios.push_back(seg.exitVelocity > 1e-9 ? 1.0 : 0.0);
                    }
                }

                PaConfig paConfig;
                paConfig.sampleInterval = 0.001;  // 1ms sampling
                result.paProfiles = computeAllPaProfiles(
                    velocityProfile, extrusionRatios, paConfig);
            } catch (const std::exception& e) {
                // PA is optional — if it fails, continue without it.
            }
        }
    } catch (const std::exception& e) {
        // ReNURBS is optional — if it fails, continue without it.
        // The viewer will fall back to piece-level coloring.
    }

    if (progress) progress(0.7);

    // ── Step 4 (optional): Dense sampling via TrajectoryAnalyzer ──
    // Only run if explicitly requested (nurbsOnly=false).
    // This is the slow O(samples) step that generates millions of points.
    if (!config.nurbsOnly) {
        AnalysisConfig analysisConfig;
        analysisConfig.timeStep = config.sampleRate;
        analysisConfig.derivativeOrder = config.derivativeOrder;
        analysisConfig.limits.maxAcceleration = config.maxAcceleration;
        analysisConfig.limits.maxDeceleration = config.maxAcceleration;
        analysisConfig.limits.maxJerk = config.maxJerk;
        analysisConfig.limits.maxVelocityLinear = config.maxVelocity * 60.0;

        TrajectoryAnalyzer analyzer(analysisConfig);
        result.samples = analyzer.analyze(segments, nullptr);

        if (progress) progress(0.9);

        result.statistics = analyzer.computeStatistics(result.samples);
        result.sampleCount = result.samples.size();
        result.duration = result.samples.empty() ? 0.0 : result.samples.back().time;
    } else {
        // Compute basic statistics from segments (fast)
        result.sampleCount = segments.size();
        result.duration = 0.0;
        for (const auto& seg : segments) result.duration += seg.segmentTime;
    }

    result.blocks = std::move(blocks);
    // Retain PlanningSegments and GCode block metadata for analysis queries
    result.planningSegments = std::move(segments);
    result.gcodeBlocks = std::move(parseResult.blocks);
    result.success = true;

    if (progress) progress(1.0);
    return result;
}

// ── Corner deviation computation ──────────────────────────────────────────────

void GCodeProcessor::computeCornerDeviation(
    std::vector<PlanningSegment>& segments)
{
    // Use Tether's CornerAnalyzer to compute the deviation percentage
    // for each segment based on the turn angle at the corner between
    // the previous segment and this one.
    //
    // The deviationPercentage field (cos(halfAngle) × 100) is stored in
    // seg.entryVelocity (repurposed for visualization — it's 0.0 by
    // default and not used by the motion planner).
    //
    // For segments with blendTolerance = 0 (G61 exact stop), deviation = 0.
    // The deviation is stored on the *outgoing* segment.

    for (size_t i = 0; i < segments.size(); ++i) {
        auto& seg = segments[i];
        if (seg.blendTolerance <= 0.0) {
            seg.entryVelocity = 0.0;
            continue;
        }

        // Need previous segment to compute the corner
        if (i == 0) {
            seg.entryVelocity = 0.0;
            continue;
        }

        const auto& prev = segments[i - 1];
        auto analysis = GCode::CornerAnalyzer::analyze(prev, seg);
        seg.entryVelocity = analysis.deviationPercentage;
    }
}

// ── Extruder speed computation ───────────────────────────────────────────────

void GCodeProcessor::computeExtruderSpeed(
    std::vector<PlanningSegment>& segments)
{
    // Convert E delta (stored in exitVelocity) to extruder speed in mm/s.
    // extruderSpeed = |deltaE| / segmentTime
    // For non-extruding moves (G0, or G1 without E), speed = 0.
    // The result is stored back in exitVelocity as mm/s.
    //
    // Note: PlanningSegmentBuilder does not currently populate exitVelocity
    // with E delta, so this is effectively a no-op until E-axis tracking
    // is added to the Tether pipeline. The viewer's extruder speed feature
    // will work once that is implemented.
    for (auto& seg : segments) {
        double eDelta = seg.exitVelocity; // temporary E delta storage
        if (seg.isRapid || std::abs(eDelta) < 1e-12 || seg.segmentTime < 1e-9) {
            seg.exitVelocity = 0.0;
            continue;
        }
        seg.exitVelocity = std::abs(eDelta) / seg.segmentTime; // mm/s
    }
}

// ── Available strategies ─────────────────────────────────────────────────────

std::vector<std::string> GCodeProcessor::availableStrategies() {
    return {"FixedTime", "FixedDeviation", "Adaptive"};
}

} // namespace tether::web
