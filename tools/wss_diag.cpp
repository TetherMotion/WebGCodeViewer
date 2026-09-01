/// Minimal diagnostic tool: G-code → segments → NURBS → ParetoPlanner → WSS arcs
/// Usage: wss_diag <gcode-file> [maxVelocity] [maxAcceleration] [maxJerk]

#include "tether/gcode/PlanningSegmentBuilder.hpp"
#include "tether/gcode/GCodeInterpreter.hpp"
#include "tether/motion_planner/geometry/PiecewiseNurbsPath.hpp"
#include "tether/motion_planner/geometry/PlanningSegmentConverter.hpp"
#include "tether/motion_planner/PathAdapter.hpp"
#include "tether/motion_planner/analytical/ParetoTimeEnergyOptimalVelocityPlanner.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using GCode::PlanningSegment;
using MotionPlanner::analytical::WeightedArcType;

namespace {

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

bool hasAxisWordsWithoutValues(std::string_view line) {
    size_t commentPos = line.find_first_of(";(");
    if (commentPos != std::string_view::npos)
        line = line.substr(0, commentPos);
    size_t i = 0;
    while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
    if (i >= line.size()) return false;
    if (line[i] != 'M' && line[i] != 'G') return false;
    i++;
    while (i < line.size() && std::isdigit(static_cast<unsigned char>(line[i]))) i++;
    bool foundWordWithoutValue = false;
    while (i < line.size()) {
        char c = line[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
            if (c == 'E' || c == 'X' || c == 'Y' || c == 'Z' || c == 'F' || c == 'S' || c == 'P' || c == 'R' || c == 'T') {
                i++;
                if (i < line.size() && (std::isdigit(static_cast<unsigned char>(line[i])) || line[i] == '.' || line[i] == '-' || line[i] == '+')) {
                    while (i < line.size() && (std::isdigit(static_cast<unsigned char>(line[i])) || line[i] == '.' || line[i] == '-' || line[i] == '+' || line[i] == 'e' || line[i] == 'E')) i++;
                } else {
                    foundWordWithoutValue = true;
                }
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    return foundWordWithoutValue;
}

/// Compute end velocity of an arc
double arcEndV(const MotionPlanner::analytical::WeightedArc& a) {
    if (a.type == WeightedArcType::DWELL) return 0.0;
    if (a.type == WeightedArcType::SINGULAR) return a.v0 + a.a_star * a.duration;
    if (a.type == WeightedArcType::WALL) return a.v0;
    return a.v0 + a.a0 * a.duration + 0.5 * a.eta * a.duration * a.duration;
}

/// Compute end acceleration of an arc
double arcEndA(const MotionPlanner::analytical::WeightedArc& a) {
    if (a.type == WeightedArcType::DWELL) return 0.0;
    if (a.type == WeightedArcType::SINGULAR) return a.a_star;
    if (a.type == WeightedArcType::WALL) return 0.0;
    return a.a0 + a.eta * a.duration;
}

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

class Timer {
public:
    Timer() : start_(std::chrono::steady_clock::now()) {}
    double elapsedMs() const {
        auto now = std::chrono::steady_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
private:
    std::chrono::steady_clock::time_point start_;
};

const char* arcTypeName(WeightedArcType t) {
    switch (t) {
        case WeightedArcType::SNAP_PLUS:  return "SNAP_PLUS";
        case WeightedArcType::SNAP_MINUS: return "SNAP_MINUS";
        case WeightedArcType::SINGULAR:   return "SINGULAR";
        case WeightedArcType::WALL:       return "WALL";
        default: return "UNKNOWN";
    }
}

} // anonymous namespace

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <gcode-file> [maxVelocity] [maxAcceleration] [maxJerk]\n";
        return 1;
    }

    double maxVelocity = 200.0;
    double maxAcceleration = 2000.0;
    double maxJerk = 20000.0;
    if (argc > 2) maxVelocity = std::stod(argv[2]);
    if (argc > 3) maxAcceleration = std::stod(argv[3]);
    if (argc > 4) maxJerk = std::stod(argv[4]);

    // Read G-code file
    std::ifstream file(argv[1]);
    if (!file) {
        std::cerr << "ERROR: Cannot open " << argv[1] << "\n";
        return 1;
    }
    std::stringstream ss;
    ss << file.rdbuf();
    std::string gcodeText = ss.str();
    std::cout << "G-code file: " << argv[1] << " (" << gcodeText.size() << " bytes)\n";
    std::cout << "Limits: v=" << maxVelocity << " a=" << maxAcceleration << " j=" << maxJerk << "\n\n";

    // Step 0: Filter Klipper commands
    Timer t0;
    std::string filtered = filterKlipperCommands(gcodeText);
    std::cout << "Step 0: filterKlipperCommands — " << gcodeText.size() << " → " << filtered.size()
              << " bytes (" << t0.elapsedMs() << " ms)\n";

    // Step 1: Parse G-code
    Timer t1;
    auto parseResult = GCode::PlanningSegmentBuilder::fromText(filtered);
    if (!parseResult.error.ok()) {
        std::cout << "Step 1: strict parse failed, retrying with stopOnError=false\n";
        GCode::InterpreterConfig retryConfig;
        retryConfig.stopOnError = false;
        auto retryResult = GCode::PlanningSegmentBuilder::fromText(filtered, retryConfig);
        if (!retryResult.segments.empty()) {
            parseResult = std::move(retryResult);
        }
    }
    auto& segments = parseResult.segments;
    std::cout << "Step 1: parse G-code — " << segments.size() << " segments, "
              << parseResult.blocks.size() << " blocks (" << t1.elapsedMs() << " ms)\n";

    if (segments.empty()) {
        std::cerr << "ERROR: No segments parsed.\n";
        return 1;
    }

    // Print segment statistics
    double totalSegLen = 0;
    int rapidCount = 0, extrudeCount = 0;
    double minLen = 1e18, maxLen = 0;
    std::vector<double> feedRates;
    for (const auto& seg : segments) {
        totalSegLen += seg.segmentLength;
        if (seg.segmentLength < minLen) minLen = seg.segmentLength;
        if (seg.segmentLength > maxLen) maxLen = seg.segmentLength;
        if (seg.isRapid) rapidCount++; else extrudeCount++;
        if (seg.feedRate > 0) feedRates.push_back(seg.feedRate / 60.0);
    }
    std::cout << "  Total seg length: " << totalSegLen << " mm\n";
    std::cout << "  Seg length range: [" << minLen << ", " << maxLen << "] mm\n";
    std::cout << "  Rapid: " << rapidCount << ", Extrude: " << extrudeCount << "\n";
    if (!feedRates.empty()) {
        double minF = *std::min_element(feedRates.begin(), feedRates.end());
        double maxF = *std::max_element(feedRates.begin(), feedRates.end());
        std::cout << "  Feed rate range: [" << minF << ", " << maxF << "] mm/s\n";
    }

    // Print first 10 segments
    std::cout << "\n  First 10 segments:\n";
    for (size_t i = 0; i < std::min<size_t>(10, segments.size()); i++) {
        const auto& s = segments[i];
        std::cout << "    seg[" << i << "]: start=(" << s.start[0] << "," << s.start[1] << "," << s.start[2]
                  << ") end=(" << s.end[0] << "," << s.end[1] << "," << s.end[2]
                  << ") len=" << s.segmentLength << " feed=" << s.feedRate
                  << " rapid=" << s.isRapid << " time=" << s.segmentTime << "\n";
    }

    // Step 2: Build NURBS path
    Timer t2;
    auto nurbsResult = tether::motion::piecewiseNurbsFromSegments(segments);
    std::cout << "\nStep 2: NURBS path — " << nurbsResult.path.numPieces() << " pieces"
              << ", path length " << nurbsResult.path.totalLength() << " mm"
              << " (" << t2.elapsedMs() << " ms)\n";

    // Step 3: Build PathAdapter and run ParetoPlanner
    MotionPlanner::PathAdapter<3, double> pathAdapter(nurbsResult.path);

    // Set per-segment velocity limits from G-code feed rates.
    // The converter returns per-piece feed rates (mm/s), aligned with the
    // NURBS pieces (zero-length segments are skipped).
    if (!nurbsResult.feedRates.empty()) {
        pathAdapter.setSegmentVelocityLimits(nurbsResult.feedRates);

        // Compute corner velocities using the junction deviation model.
        // junctionDeviation = 0.05 mm is a typical value for 3D printers.
        // maxCentripetalAccel matches the planner's acceleration limit.
        pathAdapter.computeCornerVelocities(0.05, maxAcceleration);

        // Print per-segment velocity statistics
        const auto& segVel = pathAdapter.segmentMaxVelocities();
        const auto& cornerVel = pathAdapter.cornerVelocities();
        int finiteSeg = 0, finiteCorner = 0;
        double minSeg = 1e18, maxSeg = 0;
        double minCorner = 1e18, maxCorner = 0;
        for (double v : segVel) {
            if (std::isfinite(v)) {
                finiteSeg++;
                if (v < minSeg) minSeg = v;
                if (v > maxSeg) maxSeg = v;
            }
        }
        for (double v : cornerVel) {
            if (std::isfinite(v)) {
                finiteCorner++;
                if (v < minCorner) minCorner = v;
                if (v > maxCorner) maxCorner = v;
            }
        }
        std::cout << "  Per-segment feed rates: " << finiteSeg << " finite, range ["
                  << (finiteSeg ? minSeg : 0) << ", " << (finiteSeg ? maxSeg : 0)
                  << "] mm/s\n";
        std::cout << "  Corner velocities: " << finiteCorner << " finite, range ["
                  << (finiteCorner ? minCorner : 0) << ", " << (finiteCorner ? maxCorner : 0)
                  << "] mm/s\n";
    }

    // Set dwell points (G4 commands) on the path adapter.
    if (!nurbsResult.dwellPoints.empty()) {
        std::vector<std::pair<double, double>> dwells;
        dwells.reserve(nurbsResult.dwellPoints.size());
        for (const auto& dp : nurbsResult.dwellPoints) {
            dwells.push_back({dp.arcLength, dp.duration});
        }
        pathAdapter.setDwellPoints(dwells);
        std::cout << "  Dwell points: " << dwells.size()
                  << " (total dwell time: "
                  << [&]{ double t=0; for (auto& d : dwells) t+=d.second; return t; }()
                  << " s)\n";
    }

    MotionPlanner::KinematicLimits<3, double> limits;
    limits.path.maxPathVelocity = maxVelocity;
    limits.path.maxPathAcceleration = maxAcceleration;
    limits.path.maxPathJerk = maxJerk;
    limits.path.jerkLimitEnabled = (maxJerk > 0.0);
    for (int i = 0; i < 3; ++i) {
        limits.axis.maxVelocity[i] = maxVelocity;
        limits.axis.maxAcceleration[i] = maxAcceleration;
        limits.axis.maxJerk[i] = maxJerk;
    }
    limits.axis.jerkLimitEnabled = limits.path.jerkLimitEnabled;

    double feedRate = maxVelocity;
    std::size_t numSamples = std::min<std::size_t>(
        20000, std::max<std::size_t>(200, pathAdapter.numSegments() * 20));

    std::cout << "\nStep 3: ParetoPlanner — " << pathAdapter.numSegments()
              << " adapter segments, feedRate=" << feedRate
              << ", numSamples=" << numSamples << "\n";

    MotionPlanner::analytical::ParetoTimeEnergyOptimalVelocityPlanner<3, double> profiler(limits);
    Timer t3;
    auto velocityProfile = profiler.computeProfile(pathAdapter, feedRate, 0.0, 0.0, numSamples);
    std::cout << "  computeProfile — " << (velocityProfile ? "OK" : "NULL")
              << " (" << t3.elapsedMs() << " ms)\n";

    if (!velocityProfile) {
        std::cerr << "ERROR: ParetoPlanner returned null velocity profile.\n";
        return 1;
    }

    // Step 4: Extract WSS
    auto wss = profiler.weightedSource();
    if (!wss) {
        std::cerr << "ERROR: weightedSource() returned null.\n";
        return 1;
    }

    const auto& arcs = wss->arcs();
    std::cout << "\nStep 4: WSS — " << arcs.size() << " arcs"
              << ", totalLength=" << wss->totalLength()
              << ", totalTime=" << wss->totalTime() << "\n\n";

    // Print all arcs (or first 50 if too many)
    size_t printCount = std::min<size_t>(50, arcs.size());
    for (size_t i = 0; i < printCount; i++) {
        const auto& a = arcs[i];
        std::cout << "  arc[" << i << "]: type=" << arcTypeName(a.type)
                  << " s0=" << a.s0 << " s1=" << a.s1
                  << " t0=" << a.t0 << " v0=" << a.v0
                  << " a0=" << a.a0 << " eta=" << a.eta
                  << " aStar=" << a.a_star << " dur=" << a.duration << "\n";
    }
    if (arcs.size() > printCount) {
        std::cout << "  ... (" << (arcs.size() - printCount) << " more arcs)\n";
    }

    // Count arc types
    int bangP = 0, bangM = 0, sing = 0, wall = 0, dwell = 0;
    for (const auto& a : arcs) {
        switch (a.type) {
            case WeightedArcType::SNAP_PLUS:  bangP++; break;
            case WeightedArcType::SNAP_MINUS: bangM++; break;
            case WeightedArcType::SINGULAR:   sing++; break;
            case WeightedArcType::WALL:       wall++; break;
            case WeightedArcType::DWELL:      dwell++; break;
        }
    }
    std::cout << "\n  Arc type counts: BANG_PLUS=" << bangP
              << " BANG_MINUS=" << bangM
              << " SINGULAR=" << sing
              << " WALL=" << wall
              << " DWELL=" << dwell << "\n";

    // Check velocity continuity between arcs
    std::cout << "\n  Velocity continuity check:\n";

    // Print arcs around known GAP locations for debugging
    auto printArcRange = [&](size_t center, int before, int after) {
        size_t lo = (center > before) ? center - before : 0;
        size_t hi = std::min(center + after + 1, arcs.size());
        for (size_t i = lo; i < hi; i++) {
            const auto& a = arcs[i];
            double vEnd;
            if (a.type == WeightedArcType::SINGULAR) {
                vEnd = a.v0 + a.a_star * a.duration;
            } else if (a.type == WeightedArcType::WALL) {
                vEnd = a.v0;
            } else {
                vEnd = a.v0 + a.a0 * a.duration + 0.5 * a.eta * a.duration * a.duration;
            }
            std::cout << "    arc[" << i << "]: type=" << arcTypeName(a.type)
                      << " s0=" << a.s0 << " s1=" << a.s1
                      << " v0=" << a.v0 << " vEnd=" << vEnd
                      << " a0=" << a.a0 << " eta=" << a.eta
                      << " dur=" << a.duration << "\n";
        }
    };

    for (size_t i = 1; i < arcs.size(); i++) {
        const auto& prev = arcs[i - 1];
        const auto& curr = arcs[i];
        double prevVEnd;
        if (prev.type == WeightedArcType::SINGULAR) {
            prevVEnd = prev.v0 + prev.a_star * prev.duration;
        } else if (prev.type == WeightedArcType::WALL) {
            prevVEnd = prev.v0;
        } else {
            prevVEnd = prev.v0 + prev.a0 * prev.duration + 0.5 * prev.eta * prev.duration * prev.duration;
        }
        double gap = std::abs(curr.v0 - prevVEnd);
        if (gap > 1.0) {
            std::cout << "    GAP at arc[" << i << "]: prevVEnd=" << prevVEnd
                      << " currV0=" << curr.v0 << " gap=" << gap
                      << " prev[type=" << arcTypeName(prev.type)
                      << " s0=" << prev.s0 << " s1=" << prev.s1
                      << " v0=" << prev.v0 << " a0=" << prev.a0
                      << " eta=" << prev.eta << " dur=" << prev.duration << "]"
                      << " curr[type=" << arcTypeName(curr.type)
                      << " s0=" << curr.s0 << " s1=" << curr.s1
                      << " v0=" << curr.v0 << " a0=" << curr.a0
                      << " eta=" << curr.eta << " dur=" << curr.duration << "]"
                      << "\n";
            printArcRange(i, 3, 2);
        }
    }

    // Print velocity limit at several points along the path
    std::cout << "\n  Velocity limit at sampled points:\n";
    double sTotal = pathAdapter.totalLength();
    for (int i = 0; i <= 10; i++) {
        double s = sTotal * i / 10.0;
        auto eval = pathAdapter.evaluateAtArcLength(s);
        double kappa = eval.curvature;
        std::cout << "    s=" << s << " kappa=" << kappa << " tangent=("
                  << eval.tangent[0] << "," << eval.tangent[1] << "," << eval.tangent[2] << ")\n";
    }

    // Check if the NURBS path pieces are all linear (curvature = 0)
    int nonzeroKappa = 0;
    int sampleCount = 1000;
    for (int i = 0; i < sampleCount; i++) {
        double s = sTotal * i / sampleCount;
        auto eval = pathAdapter.evaluateAtArcLength(s);
        if (std::abs(eval.curvature) > 1e-9) nonzeroKappa++;
    }
    std::cout << "\n  Curvature check: " << nonzeroKappa << "/" << sampleCount
              << " sampled points have non-zero curvature\n";

    // ====================================================================
    // Comprehensive WSS validation
    // ====================================================================
    std::cout << "\n  === WSS Validation ===\n";

    int violations = 0;
    int warnings = 0;

    // 1. Arc length continuity: s1[i] == s0[i+1]
    int sContViol = 0;
    for (size_t i = 1; i < arcs.size(); i++) {
        double gap = std::abs(arcs[i].s0 - arcs[i-1].s1);
        if (gap > 1e-6) sContViol++;
    }
    if (sContViol > 0) {
        std::cout << "  [FAIL] Arc length continuity: " << sContViol
                  << " discontinuities\n";
        violations++;
    } else {
        std::cout << "  [OK]   Arc length continuity (s1[i]==s0[i+1])\n";
    }

    // 2. Time continuity: t0[i] + dur[i] == t0[i+1]
    int tContViol = 0;
    for (size_t i = 1; i < arcs.size(); i++) {
        double tEndPrev = arcs[i-1].t0 + arcs[i-1].duration;
        double gap = std::abs(arcs[i].t0 - tEndPrev);
        if (gap > 1e-6) tContViol++;
    }
    if (tContViol > 0) {
        std::cout << "  [FAIL] Time continuity: " << tContViol
                  << " discontinuities\n";
        violations++;
    } else {
        std::cout << "  [OK]   Time continuity (t0[i]+dur[i]==t0[i+1])\n";
    }

    // 3. Velocity continuity: v_end[i] == v0[i+1]
    int vContViol = 0;
    double maxVGap = 0;
    for (size_t i = 1; i < arcs.size(); i++) {
        double prevVEnd;
        if (arcs[i-1].type == WeightedArcType::SINGULAR) {
            prevVEnd = arcs[i-1].v0 + arcs[i-1].a_star * arcs[i-1].duration;
        } else if (arcs[i-1].type == WeightedArcType::WALL) {
            prevVEnd = arcs[i-1].v0;
        } else {
            prevVEnd = arcs[i-1].v0 + arcs[i-1].a0 * arcs[i-1].duration
                     + 0.5 * arcs[i-1].eta * arcs[i-1].duration * arcs[i-1].duration;
        }
        double gap = std::abs(arcs[i].v0 - prevVEnd);
        if (gap > 1.0) vContViol++;
        if (gap > maxVGap) maxVGap = gap;
    }
    if (vContViol > 0) {
        std::cout << "  [FAIL] Velocity continuity: " << vContViol
                  << " GAPs (max gap=" << maxVGap << ")\n";
        violations++;
    } else {
        std::cout << "  [OK]   Velocity continuity (max gap=" << maxVGap << ")\n";
    }

    // 4. Acceleration continuity: a_end[i] == a0[i+1]
    int aContViol = 0;
    double maxAGap = 0;
    for (size_t i = 1; i < arcs.size(); i++) {
        double prevAEnd;
        if (arcs[i-1].type == WeightedArcType::SINGULAR) {
            prevAEnd = arcs[i-1].a_star;
        } else if (arcs[i-1].type == WeightedArcType::WALL) {
            prevAEnd = 0.0;
        } else {
            prevAEnd = arcs[i-1].a0 + arcs[i-1].eta * arcs[i-1].duration;
        }
        double gap = std::abs(arcs[i].a0 - prevAEnd);
        if (gap > 1.0) aContViol++;
        if (gap > maxAGap) maxAGap = gap;
    }
    if (aContViol > 0) {
        std::cout << "  [WARN] Acceleration continuity: " << aContViol
                  << " discontinuities (max gap=" << maxAGap << ")"
                  << " — expected at BANG/SINGULAR transitions\n";
        warnings++;
    } else {
        std::cout << "  [OK]   Acceleration continuity (max gap=" << maxAGap << ")\n";
    }

    // 5. Non-negative velocity
    int negVel = 0;
    for (size_t i = 0; i < arcs.size(); i++) {
        if (arcs[i].v0 < -1e-6) negVel++;
        // Check end velocity too
        double vEnd;
        if (arcs[i].type == WeightedArcType::SINGULAR) {
            vEnd = arcs[i].v0 + arcs[i].a_star * arcs[i].duration;
        } else if (arcs[i].type == WeightedArcType::WALL) {
            vEnd = arcs[i].v0;
        } else {
            vEnd = arcs[i].v0 + arcs[i].a0 * arcs[i].duration
                 + 0.5 * arcs[i].eta * arcs[i].duration * arcs[i].duration;
        }
        if (vEnd < -1e-6) negVel++;
    }
    if (negVel > 0) {
        std::cout << "  [FAIL] Non-negative velocity: " << negVel
                  << " arcs with v < 0\n";
        violations++;
    } else {
        std::cout << "  [OK]   Non-negative velocity\n";
    }

    // 6. Jerk limit: |eta| <= maxJerk
    int jerkViol = 0;
    double maxJerkSeen = 0;
    for (const auto& a : arcs) {
        if (a.type == WeightedArcType::WALL || a.type == WeightedArcType::SINGULAR) {
            continue;  // eta = 0 for these
        }
        if (std::abs(a.eta) > maxJerk + 1e-6) jerkViol++;
        if (std::abs(a.eta) > maxJerkSeen) maxJerkSeen = std::abs(a.eta);
    }
    if (jerkViol > 0) {
        std::cout << "  [FAIL] Jerk limit: " << jerkViol
                  << " arcs with |eta| > " << maxJerk
                  << " (max seen=" << maxJerkSeen << ")\n";
        violations++;
    } else {
        std::cout << "  [OK]   Jerk limit (max |eta|=" << maxJerkSeen << ")\n";
    }

    // 7. Acceleration limit: |a| <= maxAccel (check a0 and a_end of each arc)
    int accelViol = 0;
    double maxAccelSeen = 0;
    for (const auto& a : arcs) {
        double aEnd;
        if (a.type == WeightedArcType::SINGULAR) {
            aEnd = a.a_star;
        } else if (a.type == WeightedArcType::WALL) {
            aEnd = 0.0;
        } else {
            aEnd = a.a0 + a.eta * a.duration;
        }
        if (std::abs(a.a0) > maxAcceleration + 1e-6) accelViol++;
        if (std::abs(aEnd) > maxAcceleration + 1e-6) accelViol++;
        if (std::abs(a.a0) > maxAccelSeen) maxAccelSeen = std::abs(a.a0);
        if (std::abs(aEnd) > maxAccelSeen) maxAccelSeen = std::abs(aEnd);
    }
    if (accelViol > 0) {
        std::cout << "  [FAIL] Acceleration limit: " << accelViol
                  << " arcs with |a| > " << maxAcceleration
                  << " (max seen=" << maxAccelSeen << ")\n";
        // Print violating arcs
        for (size_t i = 0; i < arcs.size(); i++) {
            const auto& a = arcs[i];
            double aEnd;
            if (a.type == WeightedArcType::SINGULAR) {
                aEnd = a.a_star;
            } else if (a.type == WeightedArcType::WALL) {
                aEnd = 0.0;
            } else {
                aEnd = a.a0 + a.eta * a.duration;
            }
            if (std::abs(a.a0) > maxAcceleration + 1e-6 ||
                std::abs(aEnd) > maxAcceleration + 1e-6) {
                std::cout << "    arc[" << i << "]: type=" << arcTypeName(a.type)
                          << " s0=" << a.s0 << " s1=" << a.s1
                          << " a0=" << a.a0 << " aEnd=" << aEnd
                          << " eta=" << a.eta << " dur=" << a.duration
                          << " v0=" << a.v0 << "\n";
            }
        }
        violations++;
    } else {
        std::cout << "  [OK]   Acceleration limit (max |a|=" << maxAccelSeen << ")\n";
    }

    // 8. Start/end conditions: v=0 at start and end
    double vStart = arcs.front().v0;
    double vEnd;
    const auto& lastArc = arcs.back();
    if (lastArc.type == WeightedArcType::SINGULAR) {
        vEnd = lastArc.v0 + lastArc.a_star * lastArc.duration;
    } else if (lastArc.type == WeightedArcType::WALL) {
        vEnd = lastArc.v0;
    } else {
        vEnd = lastArc.v0 + lastArc.a0 * lastArc.duration
             + 0.5 * lastArc.eta * lastArc.duration * lastArc.duration;
    }
    if (std::abs(vStart) > 1.0) {
        std::cout << "  [FAIL] Start velocity = " << vStart << " (expected ~0)\n";
        violations++;
    } else {
        std::cout << "  [OK]   Start velocity = " << vStart << "\n";
    }
    if (std::abs(vEnd) > 1.0) {
        std::cout << "  [FAIL] End velocity = " << vEnd << " (expected ~0)\n";
        violations++;
    } else {
        std::cout << "  [OK]   End velocity = " << vEnd << "\n";
    }

    // 9. Total arc length matches path length
    double arcLenSum = 0;
    for (const auto& a : arcs) {
        arcLenSum += (a.s1 - a.s0);
    }
    double lenErr = std::abs(arcLenSum - pathAdapter.totalLength());
    if (lenErr > 1e-3) {
        std::cout << "  [FAIL] Total arc length = " << arcLenSum
                  << " vs path length = " << pathAdapter.totalLength()
                  << " (error=" << lenErr << ")\n";
        violations++;
    } else {
        std::cout << "  [OK]   Total arc length matches path (error=" << lenErr << ")\n";
    }

    // 10. Velocity limit satisfaction via WSS sampling
    // Sample the WSS at 10000 points and check v <= vLim
    int vLimViol = 0;
    double maxVLimExcess = 0;
    double T = wss->totalTime();
    int nSamples = 10000;
    int firstViolPrinted = 0;
    for (int i = 0; i <= nSamples; i++) {
        double t = T * i / nSamples;
        double s = wss->arcLength(t);
        double v = wss->pathVelocity(t);
        // Get velocity limit at this position from the path
        double vLim = pathAdapter.maxVelocityAtArcLength(s);
        if (vLim < std::numeric_limits<double>::infinity() && v > vLim + 2.0) {
            vLimViol++;
            double excess = v - vLim;
            if (excess > maxVLimExcess) maxVLimExcess = excess;
            // Print first 20 violations for diagnosis
            if (firstViolPrinted < 20) {
                // Find which segment this s belongs to
                size_t segIdx = 0;
                for (size_t j = 0; j < pathAdapter.numSegments(); ++j) {
                    if (s >= pathAdapter.segments()[j].cumulativeArcLength &&
                        s < pathAdapter.segments()[j].cumulativeArcLength +
                            pathAdapter.segments()[j].arcLength) {
                        segIdx = j;
                        break;
                    }
                }
                double segFeed = pathAdapter.segments()[segIdx].maxVelocity;
                double segEntry = pathAdapter.segments()[segIdx].entryCornerVelocity;
                double segExit = pathAdapter.segments()[segIdx].exitCornerVelocity;
                std::cout << "    VLIM viol #" << (firstViolPrinted+1)
                          << ": t=" << t << " s=" << s
                          << " v=" << v << " vLim=" << vLim
                          << " excess=" << excess
                          << " seg[" << segIdx << "] feed=" << segFeed
                          << " entry=" << segEntry << " exit=" << segExit
                          << "\n";
                firstViolPrinted++;
            }
        }
    }
    if (vLimViol > 0) {
        std::cout << "  [FAIL] Velocity limit: " << vLimViol << "/" << nSamples
                  << " samples exceed vLim (max excess=" << maxVLimExcess << ")\n";
        violations++;
    } else {
        std::cout << "  [OK]   Velocity limit satisfied at all sampled points\n";
    }

    // 11. Zero-length arcs (degenerate, excluding DWELL which is zero-length by design)
    int zeroLen = 0;
    for (const auto& a : arcs) {
        if (a.type == WeightedArcType::DWELL) continue;  // expected
        if (a.s1 - a.s0 < 1e-12) zeroLen++;
    }
    if (zeroLen > 0) {
        std::cout << "  [WARN] Zero-length arcs: " << zeroLen << "\n";
        warnings++;
    } else {
        std::cout << "  [OK]   No zero-length arcs\n";
    }

    // Summary
    std::cout << "\n  === Summary: " << violations << " FAIL, "
              << warnings << " WARN ===\n";
    if (violations == 0) {
        std::cout << "  WSS is physically valid.\n";
    } else {
        std::cout << "  WSS has violations that need fixing.\n";
    }

    std::cout << "\nDone.\n";
    return violations > 0 ? 1 : 0;
}
