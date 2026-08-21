#include "tether/web/GCodeProcessor.hpp"
#include "tether/gcode/GCodeInterpreter.hpp"
#include "tether/gcode/motion/G64CornerMode.hpp"
#include "tether/motion_planner/PathAdapter.hpp"
#include "tether/motion_planner/analytical/ParetoTimeEnergyOptimalVelocityPlanner.hpp"
#include "tether/motion_planner/analytical/extrusion/AnalyticalExtrusionTypes.hpp"
#include "tether/web/PressureAdvanceProfileBuilder.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <format>
#include <iostream>
#include <string_view>

namespace tether::web {

using GCode::Position;
using GCode::PlanningSegment;
using GCode::SegmentMotionType;
using GCodeExport::TrajectorySample;
using GCodeExport::TrajectoryAnalyzer;
using GCodeExport::AnalysisConfig;
using GCodeExport::TrajectoryStatistics;
using MotionPlanner::analytical::WeightedArcType;

// ── Constructor / Destructor ─────────────────────────────────────────────────

GCodeProcessor::GCodeProcessor() = default;
GCodeProcessor::~GCodeProcessor() = default;

// ── Klipper command pre-filtering ────────────────────────────────────────────

namespace {

/// Check if a line is a Klipper extended G-code command that the Tether
/// parser doesn't understand. These commands start with an uppercase letter
/// followed by more uppercase letters/underscores (e.g. SET_PRESSURE_ADVANCE,
/// TURN_OFF_HEATERS, SET_HEATER_TEMPERATURE) and are not standard G/M/T-words.
///
/// Also detects M-codes with axis words that lack numeric values (e.g.
/// "M84 X Y E" — disable specific axes), which the lexer rejects because
/// it expects every word letter to be followed by a number.
bool isKlipperCommand(std::string_view line) {
    size_t i = 0;
    while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
    if (i >= line.size()) return false;
    if (line[i] == ';' || line[i] == '(') return false;
    char c0 = line[i];
    if (i + 1 < line.size()) {
        char c1 = line[i + 1];
        if (std::isdigit(static_cast<unsigned char>(c1)) ||
            c1 == ' ' || c1 == '\t' || c1 == '\r' || c1 == '\n') return false;
    }
    if (c0 < 'A' || c0 > 'Z') return false;
    size_t cmdEnd = i;
    while (cmdEnd < line.size() && ((line[cmdEnd] >= 'A' && line[cmdEnd] <= 'Z') || line[cmdEnd] == '_')) cmdEnd++;
    if (cmdEnd - i < 2) return false;
    if (cmdEnd < line.size()) {
        char after = line[cmdEnd];
        if (after != ' ' && after != '\t' && after != '\r' && after != '\n' && after != '=') return false;
    }
    return true;
}

/// Check if a line has word letters without numeric values, e.g. "M84 X Y E"
/// or "M117 Printing..." (where "P" is a word letter followed by text, not a
/// number).
/// The Tether lexer expects every word letter to be followed by a number,
/// so any word letter (X/Y/Z/A/B/C/U/V/W/E/F/S/P/R/T) without a numeric value
/// causes a parse error. This is common in:
/// - M84 (disable steppers): "M84 X Y E"
/// - M117 (LCD message): "M117 Hello World" — free-text, not numeric params
/// - G28 (home): "G28 X Y" — axis selection without values
bool hasAxisWordsWithoutValues(std::string_view line) {
    // Strip comments first
    size_t commentPos = line.find_first_of(";(");
    if (commentPos != std::string_view::npos) {
        line = line.substr(0, commentPos);
    }

    // Skip leading whitespace
    size_t i = 0;
    while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
    if (i >= line.size()) return false;

    // Must start with M or G code (single letter + digits)
    if (line[i] != 'M' && line[i] != 'G') return false;
    char codeLetter = line[i];
    i++;
    while (i < line.size() && std::isdigit(static_cast<unsigned char>(line[i]))) i++;

    // Extract the M/G code number for special-case handling
    size_t codeStart = 1;
    size_t codeEnd = i;
    int codeNum = 0;
    if (codeEnd > codeStart) {
        std::string numStr(line.substr(codeStart, codeEnd - codeStart));
        try { codeNum = std::stoi(numStr); } catch (...) {}
    }

    // M117 (LCD message) takes free-text, not numeric parameters.
    // Any text after M117 that contains letters will break the lexer.
    if (codeLetter == 'M' && codeNum == 117) {
        // Check if there's any non-whitespace text after "M117"
        while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
        if (i < line.size()) return true;  // Has free-text message
        return false;  // Bare "M117" is fine
    }

    // All word letters the lexer recognizes (G-code word letters).
    // If any of these appears without a following numeric value, the lexer
    // will reject the line with "Missing value after word letter".
    auto isWordLetter = [](char c) {
        return c == 'X' || c == 'Y' || c == 'Z' || c == 'A' || c == 'B' ||
               c == 'C' || c == 'U' || c == 'V' || c == 'W' ||
               c == 'E' || c == 'F' || c == 'S' || c == 'P' || c == 'R' ||
               c == 'T' || c == 'I' || c == 'J' || c == 'K' || c == 'D' ||
               c == 'H' || c == 'L' || c == 'O' || c == 'N' || c == 'Q';
    };

    // Now scan the rest for word letters without values
    bool foundWordWithoutValue = false;
    while (i < line.size()) {
        // Skip whitespace
        while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
        if (i >= line.size()) break;

        char c = line[i];
        if (isWordLetter(c)) {
            // Check if followed by a number (or sign + number)
            i++;
            if (i < line.size() && (std::isdigit(static_cast<unsigned char>(line[i])) ||
                line[i] == '.' || line[i] == '-' || line[i] == '+')) {
                // Has a value — skip the number
                while (i < line.size() && !std::isspace(static_cast<unsigned char>(line[i])) &&
                       !isWordLetter(line[i])) {
                    i++;
                }
            } else {
                // Word letter without a value
                foundWordWithoutValue = true;
            }
        } else {
            i++;
        }
    }

    return foundWordWithoutValue;
}

/// Pre-process G-code text to comment out Klipper-specific extended commands
/// that the Tether G-code parser doesn't understand. Line numbers are preserved.
std::string filterKlipperCommands(const std::string& gcodeText) {
    std::string result;
    result.reserve(gcodeText.size());
    size_t pos = 0;
    while (pos < gcodeText.size()) {
        size_t lineEnd = gcodeText.find('\n', pos);
        std::string_view line = (lineEnd == std::string::npos)
            ? std::string_view(gcodeText.data() + pos)
            : std::string_view(gcodeText.data() + pos, lineEnd - pos);
        if (isKlipperCommand(line) || hasAxisWordsWithoutValues(line)) {
            result += "; [filtered] ";
            result += line;
        } else {
            result += line;
        }
        if (lineEnd != std::string::npos) { result += '\n'; pos = lineEnd + 1; }
        else break;
    }
    return result;
}

/// Extract the Nth line (1-based) from a string, for error reporting.
std::string extractLine(const std::string& text, uint32_t lineNum) {
    if (lineNum == 0 || lineNum > 1000000) return "";
    size_t pos = 0;
    for (uint32_t i = 1; i < lineNum && pos < text.size(); i++) {
        size_t nl = text.find('\n', pos);
        if (nl == std::string::npos) return "";
        pos = nl + 1;
    }
    size_t end = text.find('\n', pos);
    return text.substr(pos, end - pos);
}

} // anonymous namespace

// ── Main processing entry point ──────────────────────────────────────────────

namespace {
class Timer {
public:
    Timer() : start_(std::chrono::steady_clock::now()) {}
    double elapsedMs() const {
        auto now = std::chrono::steady_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
    double elapsedSec() const { return elapsedMs() / 1000.0; }
private:
    std::chrono::steady_clock::time_point start_;
};

#define WGV_LOG(stage) \
    std::cerr << "[GCodeProcessor] " << stage << std::endl

#define WGV_LOG_TIME(stage, timer) \
    std::cerr << "[GCodeProcessor] " << stage << " — " \
              << std::fixed << std::setprecision(2) << timer.elapsedMs() << " ms" << std::endl
} // anonymous namespace

ProcessResult GCodeProcessor::process(
    const std::string& gcodeText,
    const ProcessConfig& config,
    std::function<void(double)> progress)
{
    ProcessResult result;
    Timer totalTimer;

    WGV_LOG(std::format("process() start — {} bytes, nurbsOnly={}",
        gcodeText.size(), config.nurbsOnly));

    if (progress) progress(0.0);

    // ── Step 0: Pre-filter Klipper extended commands ──
    Timer step0;
    std::string filteredGcode = filterKlipperCommands(gcodeText);
    WGV_LOG_TIME(std::format("Step 0: filterKlipperCommands — {} → {} bytes",
        gcodeText.size(), filteredGcode.size()), step0);

    // ── Step 1: Parse G-code into PlanningSegments + block metadata ──
    // Uses Tether's PlanningSegmentBuilder (GCode::Interpreter under the hood)
    // with emit-arc-segments mode so arcs are preserved as exact segments.
    Timer step1;
    auto parseResult = GCode::PlanningSegmentBuilder::fromText(filteredGcode);

    // If strict parsing fails, retry with stopOnError=false to salvage
    // as many segments as possible. This handles files with minor syntax
    // issues (e.g. M84 X Y E — axis words without values) that shouldn't
    // prevent loading the entire file.
    if (!parseResult.error.ok()) {
        WGV_LOG(std::format("Step 1: strict parse failed ({}), retrying with stopOnError=false",
            parseResult.error.ok() ? "ok" : "error"));
        GCode::InterpreterConfig retryConfig;
        retryConfig.stopOnError = false;
        auto retryResult = GCode::PlanningSegmentBuilder::fromText(filteredGcode, retryConfig);

        if (!retryResult.segments.empty()) {
            // We got segments despite the error — use them and report
            // the parse error as a warning in the status, not a hard failure.
            parseResult = std::move(retryResult);
            // Mark that there was a non-fatal parse warning
            result.warning = std::format(
                "G-code had parse errors ({}), but {} segments were recovered. "
                "Some lines may have been skipped.",
                parseResult.error.ok() ? "recovered" : "see details",
                parseResult.segments.size());
        }
    }
    WGV_LOG_TIME(std::format("Step 1: parse G-code — {} segments, {} blocks",
        parseResult.segments.size(), parseResult.blocks.size()), step1);

    // If we still have a hard parse error (no segments recovered), report it
    if (!parseResult.error.ok() && parseResult.segments.empty()) {
        result.success = false;
        const auto& err = parseResult.error;
        // Build a detailed error message including the error code, line number,
        // message text, and context snippet from the GCode::Error struct.
        // This makes it possible to diagnose parse failures without guessing.
        std::string codeStr = std::to_string(static_cast<uint16_t>(err.code));
        // Map error code to a human-readable name
        const char* codeName = "UNKNOWN";
        switch (err.code) {
            case GCode::ErrorCode::SYNTAX_ERROR:      codeName = "SYNTAX_ERROR"; break;
            case GCode::ErrorCode::UNKNOWN_GCODE:     codeName = "UNKNOWN_GCODE"; break;
            case GCode::ErrorCode::UNKNOWN_MCODE:     codeName = "UNKNOWN_MCODE"; break;
            case GCode::ErrorCode::INVALID_WORD:      codeName = "INVALID_WORD"; break;
            case GCode::ErrorCode::MISSING_VALUE:     codeName = "MISSING_VALUE"; break;
            case GCode::ErrorCode::INVALID_LINE_NUMBER: codeName = "INVALID_LINE_NUMBER"; break;
            case GCode::ErrorCode::EXPRESSION_ERROR:  codeName = "EXPRESSION_ERROR"; break;
            case GCode::ErrorCode::PARAMETER_ERROR:   codeName = "PARAMETER_ERROR"; break;
            case GCode::ErrorCode::MISSING_BRACKET:   codeName = "MISSING_BRACKET"; break;
            case GCode::ErrorCode::INVALID_OCODE:     codeName = "INVALID_OCODE"; break;
            case GCode::ErrorCode::SUBROUTINE_ERROR:  codeName = "SUBROUTINE_ERROR"; break;
            case GCode::ErrorCode::FILE_NOT_FOUND:    codeName = "FILE_NOT_FOUND"; break;
            case GCode::ErrorCode::NESTED_TOO_DEEP:   codeName = "NESTED_TOO_DEEP"; break;
            case GCode::ErrorCode::NO_FEED_RATE:      codeName = "NO_FEED_RATE"; break;
            case GCode::ErrorCode::INVALID_MOTION:    codeName = "INVALID_MOTION"; break;
            case GCode::ErrorCode::ARC_RADIUS_ERROR:  codeName = "ARC_RADIUS_ERROR"; break;
            case GCode::ErrorCode::AXIS_WORD_MISSING: codeName = "AXIS_WORD_MISSING"; break;
            case GCode::ErrorCode::CONFLICTING_WORDS: codeName = "CONFLICTING_WORDS"; break;
            case GCode::ErrorCode::INVALID_PLANE:     codeName = "INVALID_PLANE"; break;
            case GCode::ErrorCode::SPINDLE_NOT_ON:    codeName = "SPINDLE_NOT_ON"; break;
            case GCode::ErrorCode::TOOL_ERROR:        codeName = "TOOL_ERROR"; break;
            case GCode::ErrorCode::PROBE_ERROR:       codeName = "PROBE_ERROR"; break;
            case GCode::ErrorCode::LIMIT_EXCEEDED:    codeName = "LIMIT_EXCEEDED"; break;
            case GCode::ErrorCode::INTERLOCK_ERROR:   codeName = "INTERLOCK_ERROR"; break;
            case GCode::ErrorCode::CUTTER_COMP_ERROR: codeName = "CUTTER_COMP_ERROR"; break;
            case GCode::ErrorCode::QUEUE_FULL:        codeName = "QUEUE_FULL"; break;
            case GCode::ErrorCode::UNDEFINED_SUBROUTINE: codeName = "UNDEFINED_SUBROUTINE"; break;
            case GCode::ErrorCode::RETURN_WITHOUT_CALL: codeName = "RETURN_WITHOUT_CALL"; break;
            case GCode::ErrorCode::BREAK_OUTSIDE_LOOP: codeName = "BREAK_OUTSIDE_LOOP"; break;
            case GCode::ErrorCode::CONTINUE_OUTSIDE_LOOP: codeName = "CONTINUE_OUTSIDE_LOOP"; break;
            case GCode::ErrorCode::ENDIF_WITHOUT_IF:  codeName = "ENDIF_WITHOUT_IF"; break;
            case GCode::ErrorCode::ELSE_WITHOUT_IF:   codeName = "ELSE_WITHOUT_IF"; break;
            case GCode::ErrorCode::ENDWHILE_WITHOUT_WHILE: codeName = "ENDWHILE_WITHOUT_WHILE"; break;
            case GCode::ErrorCode::DUPLICATE_LABEL:   codeName = "DUPLICATE_LABEL"; break;
            case GCode::ErrorCode::MEMORY_ERROR:      codeName = "MEMORY_ERROR"; break;
            case GCode::ErrorCode::HARDWARE_ERROR:    codeName = "HARDWARE_ERROR"; break;
            case GCode::ErrorCode::TIMEOUT:           codeName = "TIMEOUT"; break;
            case GCode::ErrorCode::ESTOP:             codeName = "ESTOP"; break;
            default: break;
        }
        // Extract null-terminated strings from fixed-size char arrays
        std::string msg(err.message.data(), strnlen(err.message.data(), err.message.size()));
        std::string ctx(err.context.data(), strnlen(err.context.data(), err.context.size()));
        // Also extract the actual G-code line at the reported line number
        // from the original (unfiltered) text, so the user can see exactly
        // what line caused the failure.
        std::string sourceLine = extractLine(gcodeText, err.line);
        if (sourceLine.empty() && err.line > 0) {
            // The parser's line counter may be inaccurate (known issue:
            // it sometimes reports line 1 for errors deep in the file).
            // Try the filtered text as a fallback.
            sourceLine = extractLine(filteredGcode, err.line);
        }
        result.errorMessage = std::format("G-code parse error [{} {}] at line {}: {}{}{}{}{}",
            codeStr, codeName, err.line,
            msg.empty() ? "(no message)" : msg,
            ctx.empty() ? "" : " | context: \"",
            ctx.empty() ? "" : ctx + "\"",
            sourceLine.empty() ? "" : " | source line: \"",
            sourceLine.empty() ? "" : sourceLine + "\"");
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
        // Include block count and a hint about what was parsed, so the user
        // can distinguish "empty file" from "only comments/M-codes" from
        // "all moves were zero-length".
        result.errorMessage = std::format(
            "No motion segments found in G-code (parsed {} blocks, 0 motion segments). "
            "Check that the file contains G0/G1/G2/G3 motion commands.",
            blocks.size());
        if (progress) progress(1.0);
        return result;
    }

    if (progress) progress(0.3);

    // ── Step 2: Compute per-segment corner deviation (%) ──
    // Uses Tether's CornerAnalyzer::analyze() which computes the
    // deviationPercentage field (cos(halfAngle) × 100).
    Timer step2;
    computeCornerDeviation(segments);

    // ── Step 2b: Compute per-segment extruder speed (mm/s) from E axis ──
    // This is viewer-specific: the PlanningSegmentBuilder doesn't track
    // extruder E-axis movement, so we compute it from the segment data.
    // Note: exitVelocity is repurposed for E delta storage during parsing.
    // Since PlanningSegmentBuilder doesn't populate E delta, this is a no-op
    // for now — the viewer's extruder speed feature requires E-axis tracking
    // which is not yet available in the Tether pipeline.
    computeExtruderSpeed(segments);
    WGV_LOG_TIME("Step 2: corner deviation + extruder speed", step2);

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
    Timer step3;
    std::vector<double> perPieceFeedRates; // mm/s, used in Step 3b
    try {
        auto nurbsResult = tether::motion::piecewiseNurbsFromSegments(segments);
        result.nurbsPath = std::move(nurbsResult.path);
        result.deviations = std::move(nurbsResult.deviations);
        result.extruderSpeeds = std::move(nurbsResult.extruderSpeeds);
        result.pathLength = result.nurbsPath->totalLength();
        perPieceFeedRates = std::move(nurbsResult.feedRates);
        WGV_LOG_TIME(std::format("Step 3: NURBS path — {} pieces, path length {:.1} mm",
            result.nurbsPath->numPieces(), result.pathLength), step3);
    } catch (const std::exception& e) {
        result.success = false;
        // Sum segment lengths for total path length context
        double totalLen = 0.0;
        for (const auto& seg : segments) totalLen += seg.segmentLength;
        result.errorMessage = std::format(
            "NURBS construction failed: {} ({} segments, total path length: {:.1} mm)",
            e.what(), segments.size(), totalLen);
        WGV_LOG(std::format("Step 3 FAILED: {}", result.errorMessage));
        if (progress) progress(1.0);
        return result;
    }

    if (progress) progress(0.6);

    // ── Step 3b: Extract analytical WSS (Weighted Switching Structure) ──
    // Runs the analytical ParetoTimeEnergyOptimalVelocityPlanner to solve
    // the time-energy optimal control problem. The solution is a list of
    // weighted arcs (BANG/SINGULAR/WALL) — a compact analytical structure
    // that is transferred to the client as-is (NO sampling).
    //
    // The WebGPU shaders evaluate v(s), a(s), j(s), t(s) in closed form at
    // the exact points needed for rendering. For WALL arcs, the shader
    // evaluates v_wall(s) from the NURBS path curvature + kinematic limits.
    //
    // Memory: O(arcs) ≈ O(segments). For a 69K-segment file: ~3.3 MB.
    // Compare: dense sampling at 1ms over a 4-hour print = 14M samples ×
    // 32 bytes = 448 MB. The WSS is ~135× smaller and exactly analytical.
    Timer step3b;
    try {
        if (result.nurbsPath && !result.nurbsPath->pieces().empty()) {
            // Build PathAdapter from the NURBS path
            MotionPlanner::PathAdapter<3, double> pathAdapter(*result.nurbsPath);

            // Set per-segment velocity limits from G-code feed rates.
            // This enables the planner to respect per-segment feed rates
            // and cornering constraints, producing a realistic velocity
            // profile with thousands of arcs instead of just 2-4.
            if (!perPieceFeedRates.empty()) {
                pathAdapter.setSegmentVelocityLimits(perPieceFeedRates);
                // Compute corner velocities using the junction deviation
                // model. junctionDeviation = 0.05 mm is a typical value
                // for 3D printers.
                pathAdapter.computeCornerVelocities(0.05, config.maxAcceleration);
            }

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

            // Run ParetoTimeEnergyOptimalVelocityPlanner to get the WSS.
            // numSamples is only used for the optional SampledVelocityProfile
            // (needed by the PA builder); the WSS itself is analytical.
            MotionPlanner::analytical::ParetoTimeEnergyOptimalVelocityPlanner<3, double> profiler(limits);
            // The planner's feedRate parameter is a global velocity ceiling
            // for the entire path. We use config.maxVelocity — the per-segment
            // feed rates (F-values) are NOT applied here because they vary
            // per segment and the planner handles curvature-based velocity
            // limits via the path adapter. Using the minimum segment feed rate
            // (e.g. 5 mm/s from a priming line) would incorrectly limit the
            // entire path to that speed.
            double feedRate = config.maxVelocity;
            std::size_t numSamples = std::min<std::size_t>(
                20000, std::max<std::size_t>(
                    200, pathAdapter.numSegments() * 20));
            WGV_LOG(std::format("Step 3b: ParetoPlanner — {} segments, feedRate={:.1} mm/s",
                pathAdapter.numSegments(), feedRate));
            Timer toppraTimer;
            WGV_LOG("Step 3b: ParetoPlanner calling computeProfile...");
            auto velocityProfile = profiler.computeProfile(
                pathAdapter, feedRate, 0.0, 0.0, numSamples);
            if (!velocityProfile) {
                throw std::runtime_error("ParetoPlanner returned a null velocity profile");
            }
            WGV_LOG_TIME("Step 3b: ParetoPlanner computeProfile returned (analytical)", toppraTimer);

            // Extract the WSS (analytical trajectory source)
            auto wss = profiler.weightedSource();

            // Build extrusion ratios from segment data (needed for WSS v2
            // and for PA computation)
            std::vector<double> extrusionRatios;
            extrusionRatios.reserve(parseResult.segments.size());
            for (const auto& seg : parseResult.segments) {
                if (seg.isRapid || seg.segmentLength < 1e-12) {
                    extrusionRatios.push_back(0.0);
                } else {
                    extrusionRatios.push_back(seg.exitVelocity > 1e-9 ? 1.0 : 0.0);
                }
            }

            // ── Transfer WSS arcs directly (no sampling) ──
            // Each arc is converted to a WssArcEntry (48 bytes, f32) for
            // direct GPU upload. The shader evaluates v/a/j/t in closed form.
            if (wss && wss->totalTime() > 0.0) {
                Timer wssTimer;
                const auto& arcs = wss->arcs();
                WssData wssData;
                wssData.arcs.reserve(arcs.size());
                wssData.extrusionRatios.reserve(arcs.size());
                wssData.totalLength = wss->totalLength();
                wssData.totalTime = wss->totalTime();

                // Kinematic limits for WALL arc evaluation in the shader
                wssData.limits.feedRate = static_cast<float>(feedRate);
                wssData.limits.maxPathVelocity = static_cast<float>(config.maxVelocity);
                wssData.limits.maxCentripetalAcceleration = static_cast<float>(
                    limits.path.maxCentripetalAcceleration);
                wssData.limits.maxAxisVelocityX = static_cast<float>(config.maxVelocity);
                wssData.limits.maxAxisVelocityY = static_cast<float>(config.maxVelocity);
                wssData.limits.maxAxisVelocityZ = static_cast<float>(config.maxVelocity);

                // Compute max v/a/j by scanning arc endpoints.
                // For BANG arcs, max |a| is at the endpoint; max |v| is at
                // whichever endpoint is larger. For SINGULAR, a is constant.
                // For WALL, v = v_wall(s) ≤ feedRate.
                double maxV = 0.0, maxA = 0.0, maxJ = 0.0;
                double prevVEnd = 0.0;  // ending velocity of previous arc
                for (const auto& arc : arcs) {
                    WssArcEntry entry{};
                    entry.s0 = static_cast<float>(arc.s0);
                    entry.s1 = static_cast<float>(arc.s1);
                    entry.t0 = static_cast<float>(arc.t0);
                    entry.a0 = static_cast<float>(arc.a0);
                    entry.eta = static_cast<float>(arc.eta);
                    entry.a_star = static_cast<float>(arc.a_star);
                    entry.duration = static_cast<float>(arc.duration);

                    using WAT = MotionPlanner::analytical::WeightedArcType;
                    switch (arc.type) {
                        case WAT::BANG_PLUS:  entry.type = 0.0f; break;
                        case WAT::BANG_MINUS: entry.type = 1.0f; break;
                        case WAT::SINGULAR:   entry.type = 2.0f; break;
                        case WAT::WALL:       entry.type = 3.0f; break;
                    }

                    // Compute the ending velocity of this arc.
                    // The Tether library sometimes sets an incorrect v0 for
                    // arcs (e.g. using the initial start velocity instead of
                    // the previous arc's ending velocity). Use prevVEnd when
                    // it's significantly different from the library's v0.
                    double v0 = arc.v0;
                    if (prevVEnd > 1e-6 && std::abs(v0 - prevVEnd) > 1e-3) {
                        v0 = prevVEnd;
                    }
                    double vEnd;
                    if (arc.type == WAT::SINGULAR) {
                        vEnd = v0 + arc.a_star * arc.duration;
                    } else if (arc.type == WAT::WALL) {
                        vEnd = v0;  // WALL: constant velocity
                    } else {
                        // BANG_PLUS or BANG_MINUS
                        vEnd = v0 + arc.a0 * arc.duration
                             + 0.5 * arc.eta * arc.duration * arc.duration;
                    }
                    entry.v0 = static_cast<float>(v0);
                    prevVEnd = vEnd;

                    wssData.arcs.push_back(entry);

                    // Map extrusion ratio to this arc via segment index at midpoint.
                    // Use the PathAdapter directly (O(log N) binary search) instead
                    // of wss->segmentIndex(tMid) which calls locateAndState →
                    // wallTimeToS (80-iteration root finding with Gauss quadrature
                    // per WALL arc), making it O(N_arcs * 640) velocityLimit calls.
                    double sMid = 0.5 * (arc.s0 + arc.s1);
                    auto segIdx = pathAdapter.segmentIndexAtArcLength(sMid);
                    float ratio = (segIdx < extrusionRatios.size())
                        ? static_cast<float>(extrusionRatios[segIdx]) : 0.0f;
                    wssData.extrusionRatios.push_back(ratio);

                    // Track max values for normalization
                    if (arc.type == WAT::SINGULAR) {
                        maxA = std::max(maxA, std::abs(arc.a_star));
                        maxJ = std::max(maxJ, 0.0); // SINGULAR: j = 0
                        maxV = std::max({maxV, std::abs(v0), std::abs(vEnd)});
                    } else if (arc.type == WAT::WALL) {
                        // v ≤ feedRate; a ≈ 0; j = 0
                        maxV = std::max({maxV, std::abs(v0), feedRate});
                    } else {
                        // BANG
                        double aEnd = arc.a0 + arc.eta * arc.duration;
                        maxV = std::max({maxV, std::abs(v0), std::abs(vEnd)});
                        maxA = std::max({maxA, std::abs(arc.a0), std::abs(aEnd)});
                        maxJ = std::max(maxJ, std::abs(arc.eta));
                    }
                }

                wssData.maxVelocity = static_cast<float>(maxV);
                wssData.maxAcceleration = static_cast<float>(maxA);
                wssData.maxJerk = static_cast<float>(maxJ);

                WGV_LOG(std::format("Step 3b: WSS extracted — {} arcs, totalLength={:.1} mm, totalTime={:.2}s",
                    wssData.arcs.size(), wssData.totalLength, wssData.totalTime));
                WGV_LOG_TIME("Step 3b: WSS arc extraction", wssTimer);

                result.wssData = std::move(wssData);
                result.renurbsMaxVelocity = result.wssData->maxVelocity;
                result.renurbsMaxAcceleration = result.wssData->maxAcceleration;
                result.renurbsMaxJerk = result.wssData->maxJerk;
                result.renurbsMaxTime = static_cast<float>(result.wssData->totalTime);
            }

            // ── Step 3c: Compute pressure advance parameters ──
            // Packages PA algorithm parameters for frontend analytical
            // evaluation in WGSL shaders. No sampling, no ReNURBS fitting.
            // The frontend evaluates PA in closed form using WSS arcs +
            // extrusion ratios (from TWSF v2) + these parameters.
            Timer paTimer;
            try {
                PressureAdvanceConfig paConfig;
                paConfig.sampleInterval = 0.001;
                result.pressureAdvanceParams = computeAllPressureAdvanceParams(paConfig);
                WGV_LOG_TIME(std::format("Step 3c: PA params (analytical, no sampling) — {} algorithms",
                    result.pressureAdvanceParams.size()), paTimer);
            } catch (const std::exception& e) {
                WGV_LOG(std::format("Step 3c: PA params FAILED (optional, continuing): {}", e.what()));
            }
        WGV_LOG_TIME("Step 3b total: WSS + PA", step3b);
        }
    } catch (const std::exception& e) {
        WGV_LOG(std::format("Step 3b FAILED (optional, continuing): {}", e.what()));
    }

    if (progress) progress(0.7);

    // ── Step 4 (optional): Dense sampling via TrajectoryAnalyzer ──
    // Only run if explicitly requested (nurbsOnly=false).
    // This is the slow O(samples) step that generates millions of points.
    if (!config.nurbsOnly) {
        WGV_LOG("Step 4: dense sampling (nurbsOnly=false)");
        Timer step4;
        AnalysisConfig analysisConfig;
        analysisConfig.timeStep = config.sampleRate;
        analysisConfig.derivativeOrder = config.derivativeOrder;
        analysisConfig.limits.maxAcceleration = config.maxAcceleration;
        analysisConfig.limits.maxDeceleration = config.maxAcceleration;
        analysisConfig.limits.maxJerk = config.maxJerk;
        analysisConfig.limits.maxVelocityLinear = config.maxVelocity * 60.0;

        TrajectoryAnalyzer analyzer(analysisConfig);
        result.samples = analyzer.analyze(segments, nullptr);
        WGV_LOG_TIME(std::format("Step 4: dense sampling — {} samples", result.samples.size()), step4);

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
    WGV_LOG_TIME(std::format("process() complete — {} samples, duration {:.2}s, path {:.1} mm",
        result.sampleCount, result.duration, result.pathLength), totalTimer);
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
