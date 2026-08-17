#include "tether/web/StateProfileSerializer.hpp"

#include <cstring>
#include <stdexcept>
#include <span>

namespace tether::web {

namespace {

constexpr char kMagic[4] = {'T', 'S', 'S', 'P'};
constexpr uint32_t kVersion = 1;

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

std::vector<uint8_t> serializeStateProfile(const StateProfile& profile) {
    std::vector<uint8_t> buf;
    buf.reserve(4 + 7 * 4 + profile.texels.size() * 4);

    buf.insert(buf.end(), kMagic, kMagic + 4);
    writeVal(buf, kVersion);

    if (profile.texels.size() % 4 != 0) {
        throw std::invalid_argument("StateProfile texels size must be a multiple of 4");
    }
    const uint32_t sampleCount = static_cast<uint32_t>(profile.texels.size() / 4);

    writeVal(buf, sampleCount);
    writeVal(buf, profile.totalLength);
    writeVal(buf, profile.totalTime);
    writeVal(buf, profile.maxVelocity);
    writeVal(buf, profile.maxAcceleration);
    writeVal(buf, profile.maxJerk);

    const auto* texelBytes = reinterpret_cast<const uint8_t*>(profile.texels.data());
    buf.insert(buf.end(), texelBytes,
               texelBytes + profile.texels.size() * sizeof(float));

    return buf;
}

StateProfile parseStateProfile(std::span<const uint8_t> data) {
    const uint8_t* p = data.data();
    const uint8_t* end = p + data.size();

    if (data.size() < 4 + 4 + 4 + 8 + 8 + 4 + 4 + 4) {
        throw std::invalid_argument("StateProfile data too short");
    }

    char magic[4];
    std::memcpy(magic, p, 4);
    p += 4;
    if (std::memcmp(magic, kMagic, 4) != 0) {
        throw std::invalid_argument("Invalid StateProfile magic");
    }

    const uint32_t version = readVal<uint32_t>(p);
    if (version != kVersion) {
        throw std::invalid_argument("Unsupported StateProfile version");
    }

    const uint32_t sampleCount = readVal<uint32_t>(p);
    StateProfile profile;
    profile.totalLength = readVal<double>(p);
    profile.totalTime = readVal<double>(p);
    profile.maxVelocity = readVal<float>(p);
    profile.maxAcceleration = readVal<float>(p);
    profile.maxJerk = readVal<float>(p);

    const size_t expectedTexelBytes = static_cast<size_t>(sampleCount) * 4 * sizeof(float);
    if (static_cast<size_t>(end - p) < expectedTexelBytes) {
        throw std::invalid_argument("StateProfile texel data too short");
    }

    profile.texels.resize(sampleCount * 4);
    std::memcpy(profile.texels.data(), p, expectedTexelBytes);

    return profile;
}

} // namespace tether::web
