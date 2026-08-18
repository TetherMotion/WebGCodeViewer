#include "tether/web/ReNurbsSerializer.hpp"

#include <cstring>
#include <algorithm>
#include <stdexcept>
#include <span>

namespace tether::web {

using tether::motion::profile_renurbs::ReNURBSProfile;
using tether::motion::profile_renurbs::ReNURBSSegmentProfile;
using tether::motion::profile_renurbs::ReNURBSQuantityCurves;

namespace {

/// Write a value to the byte buffer (little-endian).
template<typename T>
void writeVal(std::vector<uint8_t>& buf, T val) {
    buf.insert(buf.end(),
               reinterpret_cast<const uint8_t*>(&val),
               reinterpret_cast<const uint8_t*>(&val) + sizeof(T));
}

/// Write a float as f32.
void writeF32(std::vector<uint8_t>& buf, float val) {
    writeVal(buf, val);
}

/// Write a u32.
void writeU32(std::vector<uint8_t>& buf, uint32_t val) {
    writeVal(buf, val);
}

/// Write a u16.
void writeU16(std::vector<uint8_t>& buf, uint16_t val) {
    writeVal(buf, val);
}

/// Write a u8.
void writeU8(std::vector<uint8_t>& buf, uint8_t val) {
    buf.push_back(val);
}

/// Write a fixed-size name (32 bytes, null-padded).
void writeName32(std::vector<uint8_t>& buf, const std::string& name) {
    char nameBuf[32] = {};
    std::strncpy(nameBuf, name.c_str(), 31);
    buf.insert(buf.end(), nameBuf, nameBuf + 32);
}

/// Extract curve data from a ReNURBSQuantityCurves.
/// Returns (controlPoints, knots, degree) or empty if no curve.
struct CurveData {
    std::vector<float> controlPoints;  // 1-D (scalar per CP)
    std::vector<float> knots;
    uint32_t degree = 0;
    bool hasCurve = false;
};

CurveData extractCurve(const ReNURBSQuantityCurves& qc) {
    CurveData cd;
    if (!qc.curve) return cd;

    const auto& cps = qc.curve->controlPoints();
    const auto& knots = qc.curve->knots();
    cd.degree = static_cast<uint32_t>(qc.curve->degree());
    cd.hasCurve = true;

    // Control points: 1-D curves, extract scalar value from each RVec
    cd.controlPoints.reserve(cps.size());
    for (const auto& cp : cps) {
        // 1-D curve: cp.dim() should be 1
        cd.controlPoints.push_back(cp.dim() > 0 ? static_cast<float>(cp[0]) : 0.0f);
    }

    // Knots
    cd.knots.reserve(knots.size());
    for (const auto& k : knots) {
        cd.knots.push_back(static_cast<float>(k));
    }

    return cd;
}

} // anonymous namespace

std::vector<uint8_t> serializeReNurbsProfile(
    const ReNURBSProfile& profile,
    float maxVelocity,
    float maxAcceleration,
    float maxJerk,
    float maxTime)
{
    std::vector<uint8_t> buf;

    const uint8_t quantityCount = TRNP_DEFAULT_QUANTITY_COUNT;
    const uint32_t segmentCount = static_cast<uint32_t>(profile.perSegment.size());

    // Quantity names (fixed order: velocity, acceleration, jerk, time)
    const std::vector<std::string> quantityNames = {
        "velocity", "acceleration", "jerk", "time"
    };

    // ── Pass 1: Extract all curve data and compute totals ──
    // Store per-segment per-quantity curve data
    std::vector<std::array<CurveData, 4>> segCurves(segmentCount);

    uint32_t totalControlPoints = 0;
    uint32_t totalKnots = 0;

    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        const auto& seg = profile.perSegment[segIdx];
        segCurves[segIdx][0] = extractCurve(seg.velocity);
        segCurves[segIdx][1] = extractCurve(seg.acceleration);
        segCurves[segIdx][2] = extractCurve(seg.jerk);
        segCurves[segIdx][3] = extractCurve(seg.time);

        for (int q = 0; q < 4; ++q) {
            if (segCurves[segIdx][q].hasCurve) {
                totalControlPoints += static_cast<uint32_t>(segCurves[segIdx][q].controlPoints.size());
                totalKnots += static_cast<uint32_t>(segCurves[segIdx][q].knots.size());
            }
        }
    }

    // Compute total length from last segment
    float totalLength = 0.0f;
    if (!profile.perSegment.empty()) {
        totalLength = static_cast<float>(profile.perSegment.back().sEnd);
    }

    // ── Write header (64 bytes) ──
    TRNPHeader header;
    header.version = TRNP_VERSION;
    header.quantityCount = quantityCount;
    header.segmentCount = segmentCount;
    header.totalControlPoints = totalControlPoints;
    header.totalKnots = totalKnots;
    header.totalLength = totalLength;
    header.maxVelocity = maxVelocity;
    header.maxAcceleration = maxAcceleration;
    header.maxJerk = maxJerk;
    header.maxTime = maxTime;
    buf.insert(buf.end(),
               reinterpret_cast<const uint8_t*>(&header),
               reinterpret_cast<const uint8_t*>(&header) + sizeof(TRNPHeader));

    // ── Write quantity names (quantityCount × 32 bytes) ──
    for (uint8_t q = 0; q < quantityCount; ++q) {
        writeName32(buf, q < quantityNames.size() ? quantityNames[q] : "");
    }

    // ── Compute offsets for control points and knots ──
    // We assign offsets sequentially as we iterate segments.
    std::vector<std::array<TRNPQuantityMeta, 4>> quantityMeta(segmentCount);
    uint32_t cpCursor = 0;
    uint32_t knotCursor = 0;

    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        for (int q = 0; q < 4; ++q) {
            auto& meta = quantityMeta[segIdx][q];
            if (segCurves[segIdx][q].hasCurve) {
                meta.cpOffset = cpCursor;
                meta.cpCount = static_cast<uint32_t>(segCurves[segIdx][q].controlPoints.size());
                meta.knotOffset = knotCursor;
                meta.degree = segCurves[segIdx][q].degree;
                cpCursor += meta.cpCount;
                knotCursor += static_cast<uint32_t>(segCurves[segIdx][q].knots.size());
            } else {
                meta.cpOffset = 0;
                meta.cpCount = 0;
                meta.knotOffset = 0;
                meta.degree = 0;
            }
        }
    }

    // ── Write segment table (segmentCount × 16 bytes) ──
    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        const auto& seg = profile.perSegment[segIdx];
        TRNPSegmentEntry entry;
        entry.sStart = static_cast<float>(seg.sStart);
        entry.sEnd = static_cast<float>(seg.sEnd);
        entry.quantityMetaOffset = segIdx * quantityCount;  // base index
        entry.pad = 0;
        buf.insert(buf.end(),
                   reinterpret_cast<const uint8_t*>(&entry),
                   reinterpret_cast<const uint8_t*>(&entry) + sizeof(TRNPSegmentEntry));
    }

    // ── Write quantity metadata (segmentCount × quantityCount × 16 bytes) ──
    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        for (int q = 0; q < quantityCount; ++q) {
            const auto& meta = quantityMeta[segIdx][q];
            buf.insert(buf.end(),
                       reinterpret_cast<const uint8_t*>(&meta),
                       reinterpret_cast<const uint8_t*>(&meta) + sizeof(TRNPQuantityMeta));
        }
    }

    // ── Write control points (totalControlPoints × 4 bytes, f32) ──
    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        for (int q = 0; q < quantityCount; ++q) {
            if (segCurves[segIdx][q].hasCurve) {
                for (float cp : segCurves[segIdx][q].controlPoints) {
                    writeF32(buf, cp);
                }
            }
        }
    }

    // ── Write knots (totalKnots × 4 bytes, f32) ──
    for (uint32_t segIdx = 0; segIdx < segmentCount; ++segIdx) {
        for (int q = 0; q < quantityCount; ++q) {
            if (segCurves[segIdx][q].hasCurve) {
                for (float k : segCurves[segIdx][q].knots) {
                    writeF32(buf, k);
                }
            }
        }
    }

    return buf;
}

// ── Parser (for testing) ─────────────────────────────────────────────────────

namespace {

template<typename T>
T readVal(const uint8_t*& ptr) {
    T val;
    std::memcpy(&val, ptr, sizeof(T));
    ptr += sizeof(T);
    return val;
}

} // anonymous namespace

ParsedTRNP parseReNurbsProfile(std::span<const uint8_t> data) {
    ParsedTRNP result;
    if (data.size() < sizeof(TRNPHeader)) {
        throw std::runtime_error("TRNP data too small for header");
    }

    const uint8_t* ptr = data.data();

    // Read header
    std::memcpy(&result.header, ptr, sizeof(TRNPHeader));
    ptr += sizeof(TRNPHeader);

    if (std::memcmp(result.header.magic, TRNP_MAGIC, 4) != 0) {
        throw std::runtime_error("Invalid TRNP magic");
    }

    uint8_t qCount = result.header.quantityCount;
    uint32_t segCount = result.header.segmentCount;

    // Read quantity names
    result.quantityNames.resize(qCount);
    for (uint8_t q = 0; q < qCount; ++q) {
        char nameBuf[33] = {};
        std::memcpy(nameBuf, ptr, 32);
        ptr += 32;
        result.quantityNames[q] = std::string(nameBuf);
    }

    // Read segment table
    result.segments.resize(segCount);
    for (uint32_t s = 0; s < segCount; ++s) {
        TRNPSegmentEntry entry;
        std::memcpy(&entry, ptr, sizeof(TRNPSegmentEntry));
        ptr += sizeof(TRNPSegmentEntry);
        result.segments[s].sStart = entry.sStart;
        result.segments[s].sEnd = entry.sEnd;
        result.segments[s].quantities.resize(qCount);
    }

    // Read quantity metadata
    std::vector<std::vector<TRNPQuantityMeta>> meta(segCount,
        std::vector<TRNPQuantityMeta>(qCount));
    for (uint32_t s = 0; s < segCount; ++s) {
        for (uint8_t q = 0; q < qCount; ++q) {
            std::memcpy(&meta[s][q], ptr, sizeof(TRNPQuantityMeta));
            ptr += sizeof(TRNPQuantityMeta);
        }
    }

    // Read control points
    for (uint32_t s = 0; s < segCount; ++s) {
        for (uint8_t q = 0; q < qCount; ++q) {
            if (meta[s][q].cpCount > 0) {
                result.segments[s].quantities[q].cpOffset = meta[s][q].cpOffset;
                result.segments[s].quantities[q].cpCount = meta[s][q].cpCount;
                result.segments[s].quantities[q].degree = meta[s][q].degree;
                // Will fill in actual values after all metadata is read
            }
        }
    }

    // Read all control points into a flat buffer first
    std::vector<float> allCPs(result.header.totalControlPoints);
    for (uint32_t i = 0; i < result.header.totalControlPoints; ++i) {
        allCPs[i] = readVal<float>(ptr);
    }

    // Read all knots into a flat buffer
    std::vector<float> allKnots(result.header.totalKnots);
    for (uint32_t i = 0; i < result.header.totalKnots; ++i) {
        allKnots[i] = readVal<float>(ptr);
    }

    // Distribute CPs and knots to segments
    for (uint32_t s = 0; s < segCount; ++s) {
        for (uint8_t q = 0; q < qCount; ++q) {
            auto& qty = result.segments[s].quantities[q];
            if (meta[s][q].cpCount > 0) {
                qty.controlPoints.assign(
                    allCPs.begin() + meta[s][q].cpOffset,
                    allCPs.begin() + meta[s][q].cpOffset + meta[s][q].cpCount);
                qty.knots.assign(
                    allKnots.begin() + meta[s][q].knotOffset,
                    allKnots.begin() + meta[s][q].knotOffset +
                    (meta[s][q].cpCount + meta[s][q].degree + 1));
                qty.knotOffset = meta[s][q].knotOffset;
            }
        }
    }

    return result;
}

} // namespace tether::web
