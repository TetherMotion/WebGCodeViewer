#include "tether/web/TrajectorySerializer.hpp"

#include <algorithm>
#include <cstring>
#include <cmath>
#include <sstream>
#include <limits>

namespace tether::web {

namespace {

// ── Little-endian write helpers ──────────────────────────────────────────────

void writeU8(std::vector<uint8_t>& buf, uint8_t v) {
    buf.push_back(v);
}

void writeU16(std::vector<uint8_t>& buf, uint16_t v) {
    buf.push_back(static_cast<uint8_t>(v & 0xFF));
    buf.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
}

void writeU32(std::vector<uint8_t>& buf, uint32_t v) {
    for (int i = 0; i < 4; ++i)
        buf.push_back(static_cast<uint8_t>((v >> (i * 8)) & 0xFF));
}

void writeI32(std::vector<uint8_t>& buf, int32_t v) {
    writeU32(buf, static_cast<uint32_t>(v));
}

void writeF64(std::vector<uint8_t>& buf, double v) {
    uint64_t bits;
    std::memcpy(&bits, &v, sizeof(bits));
    for (int i = 0; i < 8; ++i)
        buf.push_back(static_cast<uint8_t>((bits >> (i * 8)) & 0xFF));
}

void writeStr16(std::vector<uint8_t>& buf, const std::string& s) {
    uint16_t len = static_cast<uint16_t>(std::min<size_t>(s.size(), 65535));
    writeU16(buf, len);
    buf.insert(buf.end(), s.begin(), s.begin() + len);
}

// ── Little-endian read helpers ───────────────────────────────────────────────

uint8_t readU8(const uint8_t*& p) { return *p++; }

uint16_t readU16(const uint8_t*& p) {
    uint16_t v = 0;
    v |= static_cast<uint16_t>(*p++);
    v |= static_cast<uint16_t>(*p++) << 8;
    return v;
}

uint32_t readU32(const uint8_t*& p) {
    uint32_t v = 0;
    for (int i = 0; i < 4; ++i)
        v |= static_cast<uint32_t>(*p++) << (i * 8);
    return v;
}

int32_t readI32(const uint8_t*& p) {
    return static_cast<int32_t>(readU32(p));
}

double readF64(const uint8_t*& p) {
    uint64_t bits = 0;
    for (int i = 0; i < 8; ++i)
        bits |= static_cast<uint64_t>(*p++) << (i * 8);
    double v;
    std::memcpy(&v, &bits, sizeof(v));
    return v;
}

std::string readStr16(const uint8_t*& p) {
    uint16_t len = readU16(p);
    std::string s(reinterpret_cast<const char*>(p), len);
    p += len;
    return s;
}

} // anonymous namespace

// ── Serialize ────────────────────────────────────────────────────────────────

std::vector<uint8_t> serializeTrajectory(
    const std::vector<GCodeExport::TrajectorySample>& samples,
    const std::vector<BlockMetadata>& blocks,
    const SerializeOptions& options)
{
    // ── Filter samples ──
    std::vector<const GCodeExport::TrajectorySample*> filtered;
    filtered.reserve(samples.size());
    for (size_t i = 0; i < samples.size(); ++i) {
        const auto& s = samples[i];
        // Time range filter
        if (options.timeEnd > 0 && s.time >= options.timeEnd) continue;
        if (s.time < options.timeStart) continue;
        // Segment range filter
        if (options.segStart >= 0 && s.segmentIndex < options.segStart) continue;
        if (options.segEnd >= 0 && s.segmentIndex >= options.segEnd) continue;
        // Downsample
        if (options.downsample > 1 && (i % options.downsample) != 0) continue;
        filtered.push_back(&s);
    }

    const uint32_t sampleCount = static_cast<uint32_t>(filtered.size());
    const uint32_t blockCount = static_cast<uint32_t>(blocks.size());
    const uint16_t flags = options.flags;
    const uint8_t axisCount = options.axisCount;

    // ── Compute bounds ──
    double bMin[3] = {std::numeric_limits<double>::max(),
                       std::numeric_limits<double>::max(),
                       std::numeric_limits<double>::max()};
    double bMax[3] = {std::numeric_limits<double>::lowest(),
                       std::numeric_limits<double>::lowest(),
                       std::numeric_limits<double>::lowest()};
    double tStart = filtered.empty() ? 0.0 : filtered.front()->time;
    double tEnd = filtered.empty() ? 0.0 : filtered.back()->time;
    double pathLen = filtered.empty() ? 0.0 : filtered.back()->pathPosition;

    for (const auto* s : filtered) {
        for (int ax = 0; ax < 3 && ax < axisCount; ++ax) {
            bMin[ax] = std::min(bMin[ax], s->position[ax]);
            bMax[ax] = std::max(bMax[ax], s->position[ax]);
        }
    }
    if (filtered.empty()) {
        std::fill(bMin, bMin + 3, 0.0);
        std::fill(bMax, bMax + 3, 0.0);
    }

    // ── Allocate buffer ──
    std::vector<uint8_t> buf;
    buf.reserve(sizeof(TTHRHeader) + computeBlockSize(blocks) +
                computeDataSize(sampleCount, flags, axisCount));

    // ── Write header ──
    // magic
    buf.insert(buf.end(), TTHR_MAGIC, TTHR_MAGIC + 4);
    writeU16(buf, TTHR_VERSION);
    writeU16(buf, flags);
    writeU8(buf, axisCount);
    writeU8(buf, 0); writeU8(buf, 0); writeU8(buf, 0); // reserved
    writeU32(buf, sampleCount);
    writeU32(buf, blockCount);
    writeF64(buf, tStart);
    writeF64(buf, tEnd);
    writeF64(buf, pathLen);
    for (int i = 0; i < 3; ++i) writeF64(buf, bMin[i]);
    for (int i = 0; i < 3; ++i) writeF64(buf, bMax[i]);

    // ── Write block metadata ──
    for (const auto& blk : blocks) {
        writeI32(buf, blk.blockIndex);
        writeI32(buf, blk.lineNumber);
        writeU8(buf, blk.motionType);
        writeStr16(buf, blk.gcodeText);
    }

    // ── Write data section (SoA) ──
    // Always present: time, pathPosition
    for (const auto* s : filtered) writeF64(buf, s->time);
    for (const auto* s : filtered) writeF64(buf, s->pathPosition);

    if (flags & TTHRFlags::Positions) {
        for (const auto* s : filtered)
            for (uint8_t ax = 0; ax < axisCount; ++ax)
                writeF64(buf, s->position[ax]);
    }
    if (flags & TTHRFlags::Velocities) {
        for (const auto* s : filtered)
            for (uint8_t ax = 0; ax < axisCount; ++ax)
                writeF64(buf, s->velocity[ax]);
    }
    if (flags & TTHRFlags::Accelerations) {
        for (const auto* s : filtered)
            for (uint8_t ax = 0; ax < axisCount; ++ax)
                writeF64(buf, s->acceleration[ax]);
    }
    if (flags & TTHRFlags::Jerks) {
        for (const auto* s : filtered)
            for (uint8_t ax = 0; ax < axisCount; ++ax)
                writeF64(buf, s->jerk[ax]);
    }
    if (flags & TTHRFlags::LinearMetrics) {
        for (const auto* s : filtered) writeF64(buf, s->linearVelocity);
        for (const auto* s : filtered) writeF64(buf, s->linearAcceleration);
        for (const auto* s : filtered) writeF64(buf, s->linearJerk);
    }
    if (flags & TTHRFlags::Curvature) {
        for (const auto* s : filtered) writeF64(buf, s->curvature);
        for (const auto* s : filtered) writeF64(buf, s->centripetalAccel);
    }
    if (flags & TTHRFlags::SegmentInfo) {
        for (const auto* s : filtered) writeI32(buf, s->segmentIndex);
        for (const auto* s : filtered) writeI32(buf, s->blockIndex);
        for (const auto* s : filtered) writeU8(buf, s->motionType);
    }
    if (flags & TTHRFlags::Deviation) {
        for (const auto* s : filtered) writeF64(buf, s->deviation);
    }

    return buf;
}

// ── Parse ────────────────────────────────────────────────────────────────────

ParsedTTHR parseTrajectory(std::span<const uint8_t> data) {
    ParsedTTHR result;
    // Binary header is 92 bytes (no struct padding)
    if (data.size() < 92) return result;

    const uint8_t* p = data.data();
    const uint8_t* end = p + data.size();

    // ── Read header ──
    std::memcpy(result.header.magic, p, 4); p += 4;
    if (std::memcmp(result.header.magic, TTHR_MAGIC, 4) != 0) return result;
    result.header.version = readU16(p);
    result.header.flags = readU16(p);
    result.header.axisCount = readU8(p);
    p += 3; // reserved
    result.header.sampleCount = readU32(p);
    result.header.blockCount = readU32(p);
    result.header.timeStart = readF64(p);
    result.header.timeEnd = readF64(p);
    result.header.pathLength = readF64(p);
    for (int i = 0; i < 3; ++i) result.header.boundsMin[i] = readF64(p);
    for (int i = 0; i < 3; ++i) result.header.boundsMax[i] = readF64(p);

    if (result.header.version != TTHR_VERSION) return result;

    const uint32_t n = result.header.sampleCount;
    const uint16_t flags = result.header.flags;
    const uint8_t axes = result.header.axisCount;

    // ── Read block metadata ──
    result.blocks.reserve(result.header.blockCount);
    for (uint32_t i = 0; i < result.header.blockCount && p < end; ++i) {
        BlockMetadata blk;
        blk.blockIndex = readI32(p);
        blk.lineNumber = readI32(p);
        blk.motionType = readU8(p);
        blk.gcodeText = readStr16(p);
        result.blocks.push_back(std::move(blk));
    }

    // ── Read data section ──
    auto readDoubles = [&](size_t count) -> std::vector<double> {
        std::vector<double> v(count);
        for (size_t i = 0; i < count && p + 8 <= end; ++i)
            v[i] = readF64(p);
        return v;
    };
    auto readI32s = [&](size_t count) -> std::vector<int32_t> {
        std::vector<int32_t> v(count);
        for (size_t i = 0; i < count && p + 4 <= end; ++i)
            v[i] = readI32(p);
        return v;
    };
    auto readU8s = [&](size_t count) -> std::vector<uint8_t> {
        std::vector<uint8_t> v(count);
        for (size_t i = 0; i < count && p < end; ++i)
            v[i] = readU8(p);
        return v;
    };

    result.time = readDoubles(n);
    result.pathPosition = readDoubles(n);

    if (flags & TTHRFlags::Positions)
        result.positions = readDoubles(static_cast<size_t>(n) * axes);
    if (flags & TTHRFlags::Velocities)
        result.velocities = readDoubles(static_cast<size_t>(n) * axes);
    if (flags & TTHRFlags::Accelerations)
        result.accelerations = readDoubles(static_cast<size_t>(n) * axes);
    if (flags & TTHRFlags::Jerks)
        result.jerks = readDoubles(static_cast<size_t>(n) * axes);
    if (flags & TTHRFlags::LinearMetrics) {
        result.linearVelocity = readDoubles(n);
        result.linearAcceleration = readDoubles(n);
        result.linearJerk = readDoubles(n);
    }
    if (flags & TTHRFlags::Curvature) {
        result.curvature = readDoubles(n);
        result.centripetalAccel = readDoubles(n);
    }
    if (flags & TTHRFlags::SegmentInfo) {
        result.segmentIndex = readI32s(n);
        result.blockIndex = readI32s(n);
        result.motionType = readU8s(n);
    }
    if (flags & TTHRFlags::Deviation) {
        result.deviation = readDoubles(n);
    }

    return result;
}

// ── Size computation ─────────────────────────────────────────────────────────

size_t computeDataSize(uint32_t sampleCount, uint16_t flags, uint8_t axisCount) {
    size_t size = 0;
    // Always: time + pathPosition
    size += static_cast<size_t>(sampleCount) * 2 * sizeof(double);
    if (flags & TTHRFlags::Positions)
        size += static_cast<size_t>(sampleCount) * axisCount * sizeof(double);
    if (flags & TTHRFlags::Velocities)
        size += static_cast<size_t>(sampleCount) * axisCount * sizeof(double);
    if (flags & TTHRFlags::Accelerations)
        size += static_cast<size_t>(sampleCount) * axisCount * sizeof(double);
    if (flags & TTHRFlags::Jerks)
        size += static_cast<size_t>(sampleCount) * axisCount * sizeof(double);
    if (flags & TTHRFlags::LinearMetrics)
        size += static_cast<size_t>(sampleCount) * 3 * sizeof(double);
    if (flags & TTHRFlags::Curvature)
        size += static_cast<size_t>(sampleCount) * 2 * sizeof(double);
    if (flags & TTHRFlags::SegmentInfo)
        size += static_cast<size_t>(sampleCount) * (2 * sizeof(int32_t) + sizeof(uint8_t));
    if (flags & TTHRFlags::Deviation)
        size += static_cast<size_t>(sampleCount) * sizeof(double);
    return size;
}

size_t computeBlockSize(const std::vector<BlockMetadata>& blocks) {
    size_t size = 0;
    for (const auto& blk : blocks) {
        size += 2 * sizeof(int32_t);  // blockIndex, lineNumber
        size += sizeof(uint8_t);      // motionType
        size += sizeof(uint16_t);     // gcodeLength
        size += blk.gcodeText.size(); // gcodeText
    }
    return size;
}

// ── Statistics to JSON ───────────────────────────────────────────────────────

std::string statisticsToJson(const GCodeExport::TrajectoryStatistics& stats) {
    std::ostringstream ss;
    ss << std::fixed;
    ss << "{";
    ss << "\"duration\":" << stats.duration << ",";
    ss << "\"pathLength\":" << stats.pathLength << ",";
    ss << "\"sampleCount\":" << stats.sampleCount << ",";
    ss << "\"maxLinearVelocity\":" << stats.maxLinearVelocity << ",";
    ss << "\"maxLinearAcceleration\":" << stats.maxLinearAcceleration << ",";
    ss << "\"maxLinearJerk\":" << stats.maxLinearJerk << ",";
    ss << "\"maxCurvature\":" << stats.maxCurvature << ",";
    ss << "\"maxCentripetalAccel\":" << stats.maxCentripetalAccel << ",";
    ss << "\"totalCornerError\":" << stats.totalCornerError << ",";
    ss << "\"maxCornerError\":" << stats.maxCornerError << ",";
    ss << "\"meetsLimits\":" << (stats.meetsLimits ? "true" : "false") << ",";

    // Per-axis stats
    ss << "\"axisStats\":[";
    for (size_t i = 0; i < 9; ++i) {
        const auto& a = stats.axisStats[i];
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"minPosition\":" << a.minPosition << ",";
        ss << "\"maxPosition\":" << a.maxPosition << ",";
        ss << "\"minVelocity\":" << a.minVelocity << ",";
        ss << "\"maxVelocity\":" << a.maxVelocity << ",";
        ss << "\"minAcceleration\":" << a.minAcceleration << ",";
        ss << "\"maxAcceleration\":" << a.maxAcceleration << ",";
        ss << "\"avgVelocity\":" << a.avgVelocity << ",";
        ss << "\"avgAcceleration\":" << a.avgAcceleration;
        ss << "}";
    }
    ss << "],";

    // Corner errors
    ss << "\"cornerErrors\":[";
    for (size_t i = 0; i < stats.cornerErrors.size(); ++i) {
        const auto& ce = stats.cornerErrors[i];
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"cornerIndex\":" << ce.cornerIndex << ",";
        ss << "\"maxDeviation\":" << ce.maxDeviation << ",";
        ss << "\"cornerAngle\":" << ce.cornerAngle << ",";
        ss << "\"entryVelocity\":" << ce.entryVelocity << ",";
        ss << "\"exitVelocity\":" << ce.exitVelocity << ",";
        ss << "\"minVelocity\":" << ce.minVelocity;
        ss << "}";
    }
    ss << "],";

    // Violations
    ss << "\"violations\":[";
    for (size_t i = 0; i < stats.violations.size(); ++i) {
        const auto& v = stats.violations[i];
        if (i > 0) ss << ",";
        ss << "{";
        ss << "\"time\":" << v.time << ",";
        ss << "\"axis\":" << v.axis << ",";
        ss << "\"limitType\":\"" << v.limitType << "\",";
        ss << "\"value\":" << v.value << ",";
        ss << "\"limit\":" << v.limit << ",";
        ss << "\"overshoot\":" << v.overshoot;
        ss << "}";
    }
    ss << "]";

    ss << "}";
    return ss.str();
}

} // namespace tether::web
