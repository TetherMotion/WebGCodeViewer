#include "tether/web/WssSerializer.hpp"

#include <cstring>
#include <stdexcept>

namespace tether::web {

namespace {

template<typename T>
void writeVal(std::vector<uint8_t>& buf, T val) {
    const auto* p = reinterpret_cast<const uint8_t*>(&val);
    buf.insert(buf.end(), p, p + sizeof(T));
}

template<typename T>
T readVal(const uint8_t*& p) {
    T val;
    std::memcpy(&val, p, sizeof(T));
    p += sizeof(T);
    return val;
}

} // anonymous namespace

std::vector<uint8_t> serializeWss(const WssData& data) {
    std::vector<uint8_t> buf;
    buf.reserve(sizeof(TWSFHeader) + data.arcs.size() * sizeof(WssArcEntry)
                + data.extrusionRatios.size() * sizeof(float));

    // Header
    TWSFHeader header;
    header.arcCount = static_cast<uint32_t>(data.arcs.size());
    header.totalLength = data.totalLength;
    header.totalTime = data.totalTime;
    header.maxVelocity = data.maxVelocity;
    header.maxAcceleration = data.maxAcceleration;
    header.maxJerk = data.maxJerk;
    header.limits = data.limits;

    buf.insert(buf.end(), reinterpret_cast<const uint8_t*>(&header),
               reinterpret_cast<const uint8_t*>(&header) + sizeof(header));

    // Arc array
    const auto* arcBytes = reinterpret_cast<const uint8_t*>(data.arcs.data());
    buf.insert(buf.end(), arcBytes,
               arcBytes + data.arcs.size() * sizeof(WssArcEntry));

    // Extrusion ratios (v2) — one f32 per arc
    if (!data.extrusionRatios.empty()) {
        const auto* ratioBytes = reinterpret_cast<const uint8_t*>(data.extrusionRatios.data());
        const size_t ratioCount = std::min(data.extrusionRatios.size(), data.arcs.size());
        buf.insert(buf.end(), ratioBytes, ratioBytes + ratioCount * sizeof(float));
    }

    return buf;
}

WssData parseWss(std::span<const uint8_t> data) {
    const auto* p = data.data();
    const auto* end = p + data.size();

    if (static_cast<size_t>(end - p) < sizeof(TWSFHeader)) {
        throw std::invalid_argument("TWSF data too short for header");
    }

    TWSFHeader header;
    std::memcpy(&header, p, sizeof(header));
    p += sizeof(header);

    if (std::memcmp(header.magic, TWSF_MAGIC, 4) != 0) {
        throw std::invalid_argument("Invalid TWSF magic");
    }
    if (header.version != TWSF_VERSION && header.version != 1) {
        throw std::invalid_argument("Unsupported TWSF version");
    }

    WssData result;
    result.totalLength = header.totalLength;
    result.totalTime = header.totalTime;
    result.maxVelocity = header.maxVelocity;
    result.maxAcceleration = header.maxAcceleration;
    result.maxJerk = header.maxJerk;
    result.limits = header.limits;

    const size_t arcBytes = static_cast<size_t>(header.arcCount) * sizeof(WssArcEntry);
    if (static_cast<size_t>(end - p) < arcBytes) {
        throw std::invalid_argument("TWSF arc data too short");
    }

    result.arcs.resize(header.arcCount);
    std::memcpy(result.arcs.data(), p, arcBytes);
    p += arcBytes;

    // Extrusion ratios (v2 only) — one f32 per arc
    if (header.version >= 2) {
        const size_t ratioBytes = static_cast<size_t>(header.arcCount) * sizeof(float);
        if (static_cast<size_t>(end - p) >= ratioBytes) {
            result.extrusionRatios.resize(header.arcCount);
            std::memcpy(result.extrusionRatios.data(), p, ratioBytes);
        }
    }

    return result;
}

} // namespace tether::web
