#include "tether/web/GCodeProcessor.hpp"

#include "tether/motion_planner/geometry/NurbsCurve.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <sstream>
#include <charconv>

namespace tether::web {

using GCode::Position;
using GCode::PlanningSegment;
using GCode::SegmentMotionType;
using GCode::InterpolationPlane;
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
    std::vector<PlanningSegment> segments;
    std::vector<BlockMetadata> blocks;
    parseGCode(gcodeText, segments, blocks);

    if (segments.empty()) {
        result.success = false;
        result.errorMessage = "No motion segments found in G-code";
        if (progress) progress(1.0);
        return result;
    }

    if (progress) progress(0.3);

    // ── Step 2: Compute segment times from feed rates ──
    computeSegmentTimes(segments);

    if (progress) progress(0.4);

    // ── Step 3: Build NURBS path directly from segments (FAST) ──
    // This is O(segments) — typically milliseconds, not minutes.
    result.nurbsPath = buildNurbsFromSegments(segments);
    result.pathLength = result.nurbsPath->totalLength();

    if (progress) progress(0.6);

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
    result.success = true;

    if (progress) progress(1.0);
    return result;
}

// ── G-code parsing ───────────────────────────────────────────────────────────

namespace {

/// @brief Parse a number from a G-code word value (e.g. "X10.5" → 10.5)
double parseValue(std::string_view sv) {
    double val = 0.0;
    auto [ptr, ec] = std::from_chars(sv.data(), sv.data() + sv.size(), val);
    (void)ptr; (void)ec;
    return val;
}

/// @brief Extract all word-value pairs from a G-code line.
struct WordValue {
    char letter;
    double value;
    bool hasValue;
};

std::vector<WordValue> parseWords(const std::string& line) {
    std::vector<WordValue> words;
    size_t i = 0;
    // Skip line number if present (N123)
    while (i < line.size() && std::isspace(static_cast<unsigned char>(line[i]))) ++i;
    if (i < line.size() && (line[i] == 'N' || line[i] == 'n')) {
        size_t j = i + 1;
        while (j < line.size() && (std::isdigit(static_cast<unsigned char>(line[j])) ||
               line[j] == '.' || line[j] == '-')) ++j;
        i = j;
    }

    while (i < line.size()) {
        char c = line[i];
        if (std::isalpha(static_cast<unsigned char>(c))) {
            char letter = std::toupper(c);
            ++i;
            // Skip whitespace
            while (i < line.size() && std::isspace(static_cast<unsigned char>(line[i]))) ++i;
            // Parse number
            size_t numStart = i;
            if (i < line.size() && (line[i] == '+' || line[i] == '-')) ++i;
            while (i < line.size() && (std::isdigit(static_cast<unsigned char>(line[i])) ||
                   line[i] == '.')) ++i;
            if (i > numStart) {
                double val = parseValue(std::string_view(line.data() + numStart, i - numStart));
                words.push_back({letter, val, true});
            } else {
                words.push_back({letter, 0.0, false});
            }
        } else {
            ++i;
        }
    }
    return words;
}

/// @brief Strip comment from G-code line
std::string stripComment(const std::string& line) {
    // Comments start with ; or () or %
    std::string result;
    bool inParen = false;
    for (size_t i = 0; i < line.size(); ++i) {
        if (line[i] == '(') { inParen = true; continue; }
        if (line[i] == ')') { inParen = false; continue; }
        if (line[i] == ';' || line[i] == '%') break;
        if (!inParen) result += line[i];
    }
    return result;
}

/// @brief Check if a line is blank or comment-only
bool isBlankOrComment(const std::string& line) {
    std::string stripped = stripComment(line);
    // Check if only whitespace remains
    for (char c : stripped) {
        if (!std::isspace(static_cast<unsigned char>(c))) return false;
    }
    return true;
}

} // anonymous namespace

void GCodeProcessor::parseGCode(
    const std::string& gcodeText,
    std::vector<PlanningSegment>& segments,
    std::vector<BlockMetadata>& blocks)
{
    Position currentPos{};

    std::istringstream stream(gcodeText);
    std::string line;
    int32_t blockIndex = 0;
    int lineNumber = 0;

    // Modal state
    bool absoluteMode = true; // G90
    bool unitsMm = true;      // G21
    InterpolationPlane plane = InterpolationPlane::XY;
    double currentFeedRate = 1000.0; // mm/min default

    while (std::getline(stream, line)) {
        ++lineNumber;

        if (isBlankOrComment(line)) continue;

        std::string code = stripComment(line);
        if (code.empty()) continue;

        auto words = parseWords(code);

        // Track G and M codes
        std::string gcodeStr;
        std::string mcodeStr;
        double feedRate = -1;
        bool hasFeed = false;
        Position target = currentPos;
        bool hasAnyPos = false;
        double iVal = 0, jVal = 0, kVal = 0, rVal = 0;
        bool hasI = false, hasJ = false, hasK = false, hasR = false;
        int motionCode = -1; // 0, 1, 2, 3

        for (const auto& w : words) {
            switch (w.letter) {
                case 'G':
                    if (w.hasValue) {
                        int gval = static_cast<int>(w.value);
                        // Handle G0-G3 (motion)
                        if (gval == 0 || gval == 1 || gval == 2 || gval == 3) {
                            motionCode = gval;
                            gcodeStr = "G" + std::to_string(gval);
                        } else if (gval == 90) {
                            absoluteMode = true;
                        } else if (gval == 91) {
                            absoluteMode = false;
                        } else if (gval == 20) {
                            unitsMm = false; // inches
                        } else if (gval == 21) {
                            unitsMm = true; // mm
                        } else if (gval == 17) {
                            plane = InterpolationPlane::XY;
                        } else if (gval == 18) {
                            plane = InterpolationPlane::XZ;
                        } else if (gval == 19) {
                            plane = InterpolationPlane::YZ;
                        }
                    }
                    break;
                case 'M':
                    if (w.hasValue) {
                        mcodeStr = "M" + std::to_string(static_cast<int>(w.value));
                    }
                    break;
                case 'X':
                    target[0] = absoluteMode ? w.value : currentPos[0] + w.value;
                    hasAnyPos = true;
                    break;
                case 'Y':
                    target[1] = absoluteMode ? w.value : currentPos[1] + w.value;
                    hasAnyPos = true;
                    break;
                case 'Z':
                    target[2] = absoluteMode ? w.value : currentPos[2] + w.value;
                    hasAnyPos = true;
                    break;
                case 'A':
                    target[3] = absoluteMode ? w.value : currentPos[3] + w.value;
                    hasAnyPos = true;
                    break;
                case 'B':
                    target[4] = absoluteMode ? w.value : currentPos[4] + w.value;
                    hasAnyPos = true;
                    break;
                case 'C':
                    target[5] = absoluteMode ? w.value : currentPos[5] + w.value;
                    hasAnyPos = true;
                    break;
                case 'U':
                    target[6] = absoluteMode ? w.value : currentPos[6] + w.value;
                    hasAnyPos = true;
                    break;
                case 'V':
                    target[7] = absoluteMode ? w.value : currentPos[7] + w.value;
                    hasAnyPos = true;
                    break;
                case 'W':
                    target[8] = absoluteMode ? w.value : currentPos[8] + w.value;
                    hasAnyPos = true;
                    break;
                case 'F':
                    feedRate = w.value;
                    hasFeed = true;
                    currentFeedRate = w.value;
                    break;
                case 'I':
                    iVal = w.value; hasI = true; break;
                case 'J':
                    jVal = w.value; hasJ = true; break;
                case 'K':
                    kVal = w.value; hasK = true; break;
                case 'R':
                    rVal = w.value; hasR = true; break;
                default:
                    break;
            }
        }

        // Update feed rate if specified (even without motion)
        if (hasFeed && motionCode < 0) {
            // Block metadata for F-only lines
            BlockMetadata blk;
            blk.blockIndex = blockIndex++;
            blk.lineNumber = lineNumber;
            blk.motionType = 255; // non-motion
            std::string text = code;
            // Trim whitespace
            size_t start = text.find_first_not_of(" \t");
            if (start != std::string::npos)
                text = text.substr(start);
            blk.gcodeText = text;
            blocks.push_back(std::move(blk));
            continue;
        }

        // Only create a segment if there's a motion command
        if (motionCode < 0 || !hasAnyPos) {
            // Non-motion line — still record block metadata
            BlockMetadata blk;
            blk.blockIndex = blockIndex++;
            blk.lineNumber = lineNumber;
            blk.motionType = 255;
            std::string text = code;
            size_t start = text.find_first_not_of(" \t");
            if (start != std::string::npos)
                text = text.substr(start);
            blk.gcodeText = text;
            blocks.push_back(std::move(blk));
            continue;
        }

        // Convert inches to mm if needed
        if (!unitsMm) {
            for (int ax = 0; ax < 9; ++ax) {
                target[ax] *= 25.4;
            }
        }

        // Create PlanningSegment
        PlanningSegment seg;
        seg.start = currentPos;
        seg.end = target;
        seg.plane = plane;
        seg.blockIndex = blockIndex;
        seg.feedRate = currentFeedRate;
        seg.isRapid = (motionCode == 0);

        switch (motionCode) {
            case 0:
                seg.motionType = SegmentMotionType::Rapid;
                break;
            case 1:
                seg.motionType = SegmentMotionType::Linear;
                break;
            case 2:
                seg.motionType = SegmentMotionType::ArcCW;
                break;
            case 3:
                seg.motionType = SegmentMotionType::ArcCCW;
                break;
        }

        // Arc parameters
        if (motionCode == 2 || motionCode == 3) {
            if (hasI || hasJ || hasK) {
                // IJK format: arc center is relative to start
                Position center = currentPos;
                if (hasI) center[0] += iVal;
                if (hasJ) center[1] += jVal;
                if (hasK) center[2] += kVal;
                seg.center = center;
                // Compute radius from start to center
                double dx = center[0] - currentPos[0];
                double dy = center[1] - currentPos[1];
                double dz = center[2] - currentPos[2];
                seg.arcRadius = std::sqrt(dx*dx + dy*dy + dz*dz);
            } else if (hasR) {
                seg.arcRadius = rVal;
                // Compute center from radius — approximate
                // For R format, center is at midpoint perpendicular
                double mx = (currentPos[0] + target[0]) * 0.5;
                double my = (currentPos[1] + target[1]) * 0.5;
                double dx = target[0] - currentPos[0];
                double dy = target[1] - currentPos[1];
                double chordLen = std::sqrt(dx*dx + dy*dy);
                if (chordLen > 0 && seg.arcRadius > chordLen * 0.5) {
                    double h = std::sqrt(seg.arcRadius * seg.arcRadius - (chordLen * 0.5) * (chordLen * 0.5));
                    // Perpendicular direction
                    double px = -dy / chordLen;
                    double py = dx / chordLen;
                    // Direction depends on CW/CCW
                    int dir = (motionCode == 2) ? -1 : 1;
                    Position center;
                    center[0] = mx + dir * px * h;
                    center[1] = my + dir * py * h;
                    center[2] = currentPos[2];
                    seg.center = center;
                }
            }

            // Compute arc sweep angle
            if (seg.arcRadius > 1e-9) {
                double startAngle = std::atan2(
                    currentPos[1] - seg.center[1],
                    currentPos[0] - seg.center[0]);
                double endAngle = std::atan2(
                    target[1] - seg.center[1],
                    target[0] - seg.center[0]);
                double sweep = endAngle - startAngle;
                if (motionCode == 2) { // CW: sweep should be negative
                    if (sweep > 0) sweep -= 2.0 * M_PI;
                } else { // CCW: sweep should be positive
                    if (sweep < 0) sweep += 2.0 * M_PI;
                }
                seg.arcSweep = sweep;
            }
        }

        // Compute segment length
        if (seg.isArc() && seg.arcRadius > 1e-9) {
            seg.segmentLength = std::abs(seg.arcSweep) * seg.arcRadius;
        } else {
            seg.segmentLength = currentPos.linearDistance(target);
        }

        // Record block metadata
        BlockMetadata blk;
        blk.blockIndex = blockIndex;
        blk.lineNumber = lineNumber;
        blk.motionType = static_cast<uint8_t>(seg.motionType);
        std::string text = code;
        size_t start = text.find_first_not_of(" \t");
        if (start != std::string::npos)
            text = text.substr(start);
        blk.gcodeText = text;
        blocks.push_back(blk);

        segments.push_back(seg);
        currentPos = target;
        ++blockIndex;
    }
}

// ── Segment time computation ─────────────────────────────────────────────────

void GCodeProcessor::computeSegmentTimes(
    std::vector<PlanningSegment>& segments)
{
    for (auto& seg : segments) {
        if (seg.segmentLength <= 0) {
            seg.segmentTime = 0.001; // Minimum 1ms for zero-length segments
            continue;
        }
        // Feed rate is in mm/min, convert to mm/s
        double feedMmPerSec = seg.feedRate / 60.0;
        if (feedMmPerSec < 1e-6) feedMmPerSec = 1.0; // Avoid division by zero
        // For rapid moves, use a high effective speed
        if (seg.isRapid) {
            feedMmPerSec = std::max(feedMmPerSec, 200.0); // 200 mm/s minimum for rapids
        }
        seg.segmentTime = seg.segmentLength / feedMmPerSec;
        // Ensure minimum time for sampling
        seg.segmentTime = std::max(seg.segmentTime, 0.001);
    }
}

// ── NURBS path construction from segments ────────────────────────────────────

using tether::motion::NurbsCurve;
using tether::motion::PiecewiseNurbsPath;
using tether::motion::RVec;

tether::motion::PiecewiseNurbsPath GCodeProcessor::buildNurbsFromSegments(
    const std::vector<PlanningSegment>& segments)
{
    std::vector<NurbsCurve> curves;
    curves.reserve(segments.size());

    for (const auto& seg : segments) {
        // Extract 3D start/end positions (XYZ only for now)
        RVec start{seg.start[0], seg.start[1], seg.start[2]};
        RVec end{seg.end[0], seg.end[1], seg.end[2]};

        // Skip zero-length segments
        double dx = end[0] - start[0];
        double dy = end[1] - start[1];
        double dz = end[2] - start[2];
        double len = std::sqrt(dx*dx + dy*dy + dz*dz);
        if (len < 1e-9) continue;

        if (seg.isArc() && seg.arcRadius > 1e-9) {
            // Build arc NURBS
            // Extract center in 3D
            RVec center{seg.center[0], seg.center[1], seg.center[2]};

            // Determine arc plane axes
            RVec axis1, axis2;
            double startAngle, sweepAngle;

            switch (seg.plane) {
                case InterpolationPlane::XZ:
                    axis1 = RVec{1.0, 0.0, 0.0};
                    axis2 = RVec{0.0, 0.0, 1.0};
                    break;
                case InterpolationPlane::YZ:
                    axis1 = RVec{0.0, 1.0, 0.0};
                    axis2 = RVec{0.0, 0.0, 1.0};
                    break;
                case InterpolationPlane::XY:
                default:
                    axis1 = RVec{1.0, 0.0, 0.0};
                    axis2 = RVec{0.0, 1.0, 0.0};
                    break;
            }

            startAngle = std::atan2(
                (start[1] - center[1]) * 1.0, // project onto plane
                (start[0] - center[0]) * 1.0
            );
            sweepAngle = seg.arcSweep;

            try {
                auto curve = NurbsCurve::fromArc(
                    center, seg.arcRadius, axis1, axis2,
                    startAngle, sweepAngle);
                curves.push_back(std::move(curve));
            } catch (...) {
                // Fall back to line if arc construction fails
                try {
                    curves.push_back(NurbsCurve::fromLine(start, end));
                } catch (...) {}
            }
        } else {
            // Linear or rapid — build line NURBS
            try {
                curves.push_back(NurbsCurve::fromLine(start, end));
            } catch (...) {
                // Skip degenerate segments
            }
        }
    }

    return PiecewiseNurbsPath(std::move(curves));
}

// ── Statistics computation ───────────────────────────────────────────────────

TrajectoryStatistics GCodeProcessor::computeStats(
    const std::vector<TrajectorySample>& samples)
{
    TrajectoryStatistics stats{};
    if (samples.empty()) return stats;

    stats.sampleCount = samples.size();
    stats.duration = samples.back().time;
    stats.pathLength = samples.back().pathPosition;

    for (const auto& s : samples) {
        stats.maxLinearVelocity = std::max(stats.maxLinearVelocity, s.linearVelocity);
        stats.maxLinearAcceleration = std::max(stats.maxLinearAcceleration, s.linearAcceleration);
        stats.maxLinearJerk = std::max(stats.maxLinearJerk, s.linearJerk);
        stats.maxCurvature = std::max(stats.maxCurvature, s.curvature);
        stats.maxCentripetalAccel = std::max(stats.maxCentripetalAccel, s.centripetalAccel);

        for (int ax = 0; ax < 9; ++ax) {
            auto& a = stats.axisStats[ax];
            a.minPosition = std::min(a.minPosition, s.position[ax]);
            a.maxPosition = std::max(a.maxPosition, s.position[ax]);
            a.minVelocity = std::min(a.minVelocity, s.velocity[ax]);
            a.maxVelocity = std::max(a.maxVelocity, s.velocity[ax]);
            a.minAcceleration = std::min(a.minAcceleration, s.acceleration[ax]);
            a.maxAcceleration = std::max(a.maxAcceleration, s.acceleration[ax]);
        }
    }

    return stats;
}

// ── Available strategies ─────────────────────────────────────────────────────

std::vector<std::string> GCodeProcessor::availableStrategies() {
    return {"FixedTime", "FixedDeviation", "Adaptive"};
}

} // namespace tether::web
