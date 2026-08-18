#include "tether/web/PressureAdvanceSerializer.hpp"

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

void writeString32(std::vector<uint8_t>& buf, const std::string& s) {
    char name[32] = {};
    std::strncpy(name, s.c_str(), 31);
    buf.insert(buf.end(), name, name + 32);
}

std::string readString32(const uint8_t*& p) {
    std::string s(reinterpret_cast<const char*>(p), 32);
    p += 32;
    // Trim at first null
    auto nul = s.find('\0');
    if (nul != std::string::npos) s.resize(nul);
    return s;
}

void writeFloatArray(std::vector<uint8_t>& buf, const std::vector<float>& arr) {
    for (float v : arr) writeVal<float>(buf, v);
}

void readFloatArray(const uint8_t*& p, std::vector<float>& arr, size_t count) {
    arr.resize(count);
    for (size_t i = 0; i < count; ++i) arr[i] = readVal<float>(p);
}

} // anonymous namespace

std::vector<uint8_t> serializePressureAdvanceParams(
    const std::vector<PressureAdvanceParamBlock>& params)
{
    std::vector<uint8_t> buf;

    // Header
    TWPAHeader header;
    header.algorithmCount = static_cast<uint8_t>(params.size());
    buf.insert(buf.end(), reinterpret_cast<const uint8_t*>(&header),
               reinterpret_cast<const uint8_t*>(&header) + sizeof(header));

    for (const auto& pa : params) {
        // Algorithm ID + reserved
        writeVal<uint8_t>(buf, static_cast<uint8_t>(pa.algorithm));
        writeVal<uint8_t>(buf, 0);
        writeVal<uint8_t>(buf, 0);
        writeVal<uint8_t>(buf, 0);

        // Algorithm name (32 bytes)
        writeString32(buf, pa.algorithmName);

        // Normalization
        writeVal<float>(buf, pa.maxOffset);
        writeVal<float>(buf, pa.maxVelocity);

        // Build params block
        std::vector<uint8_t> paramBuf;
        switch (pa.algorithm) {
            case PressureAdvanceAlgorithm::Linear:
                writeVal<float>(paramBuf, pa.pressureAdvance);
                writeVal<float>(paramBuf, pa.smoothTime);
                writeVal<float>(paramBuf, pa.maxCompensation);
                break;
            case PressureAdvanceAlgorithm::PowerLaw:
                writeVal<float>(paramBuf, pa.powerLawBaseGain);
                writeVal<float>(paramBuf, pa.flowIndex);
                writeVal<float>(paramBuf, pa.filamentDiameter);
                writeVal<float>(paramBuf, pa.smoothTime);
                writeVal<float>(paramBuf, pa.maxCompensation);
                break;
            case PressureAdvanceAlgorithm::CrossWlf: {
                writeVal<float>(paramBuf, pa.crossWlfCompressibility);
                writeVal<float>(paramBuf, pa.filamentDiameter);
                writeVal<float>(paramBuf, pa.smoothTime);
                writeVal<float>(paramBuf, pa.maxCompensation);
                writeVal<float>(paramBuf, pa.meltTempC);
                writeVal<uint32_t>(paramBuf, static_cast<uint32_t>(pa.qGrid.size()));
                writeVal<uint32_t>(paramBuf, static_cast<uint32_t>(pa.tempGrid.size()));
                writeFloatArray(paramBuf, pa.qGrid);
                writeFloatArray(paramBuf, pa.tempGrid);
                writeFloatArray(paramBuf, pa.pValues);
                break;
            }
            case PressureAdvanceAlgorithm::LtiDeconv: {
                writeVal<float>(paramBuf, pa.groupDelay);
                writeVal<float>(paramBuf, pa.maxCompensation);
                uint32_t momentCount = static_cast<uint32_t>(pa.moments.size());
                writeVal<uint32_t>(paramBuf, momentCount);
                for (float m : pa.moments) writeVal<float>(paramBuf, m);
                break;
            }
            case PressureAdvanceAlgorithm::LpvDeconv: {
                writeVal<float>(paramBuf, pa.groupDelay);
                writeVal<float>(paramBuf, pa.maxCompensation);
                uint32_t opCount = static_cast<uint32_t>(pa.opPointVelocities.size());
                uint32_t momentCount = 4;
                writeVal<uint32_t>(paramBuf, opCount);
                writeVal<uint32_t>(paramBuf, momentCount);
                for (size_t i = 0; i < opCount; ++i) {
                    writeVal<float>(paramBuf, pa.opPointVelocities[i]);
                    for (size_t k = 0; k < momentCount; ++k) {
                        size_t idx = i * momentCount + k;
                        writeVal<float>(paramBuf, idx < pa.moments.size() ? pa.moments[idx] : 0.0f);
                    }
                }
                break;
            }
        }

        // Param size + params
        writeVal<uint32_t>(buf, static_cast<uint32_t>(paramBuf.size()));
        buf.insert(buf.end(), paramBuf.begin(), paramBuf.end());
    }

    return buf;
}

std::vector<PressureAdvanceParamBlock> parsePressureAdvanceParams(
    std::span<const uint8_t> data)
{
    const auto* p = data.data();
    const auto* end = p + data.size();

    if (static_cast<size_t>(end - p) < sizeof(TWPAHeader)) {
        throw std::runtime_error("TWPA data too short for header");
    }

    TWPAHeader header;
    std::memcpy(&header, p, sizeof(header));
    p += sizeof(header);

    if (std::memcmp(header.magic, TWPA_MAGIC, 4) != 0) {
        throw std::runtime_error("Invalid TWPA magic");
    }
    if (header.version != TWPA_VERSION) {
        throw std::runtime_error("Unsupported TWPA version");
    }

    std::vector<PressureAdvanceParamBlock> result;
    result.reserve(header.algorithmCount);

    for (uint8_t i = 0; i < header.algorithmCount; ++i) {
        PressureAdvanceParamBlock pa;
        pa.algorithm = static_cast<PressureAdvanceAlgorithm>(readVal<uint8_t>(p));
        p += 3; // reserved
        pa.algorithmName = readString32(p);
        pa.maxOffset = readVal<float>(p);
        pa.maxVelocity = readVal<float>(p);
        uint32_t paramSize = readVal<uint32_t>(p);

        if (static_cast<size_t>(end - p) < paramSize) {
            throw std::runtime_error("TWPA param block too short");
        }

        const auto* paramEnd = p + paramSize;
        switch (pa.algorithm) {
            case PressureAdvanceAlgorithm::Linear:
                pa.pressureAdvance = readVal<float>(p);
                pa.smoothTime = readVal<float>(p);
                pa.maxCompensation = readVal<float>(p);
                break;
            case PressureAdvanceAlgorithm::PowerLaw:
                pa.powerLawBaseGain = readVal<float>(p);
                pa.flowIndex = readVal<float>(p);
                pa.filamentDiameter = readVal<float>(p);
                pa.smoothTime = readVal<float>(p);
                pa.maxCompensation = readVal<float>(p);
                break;
            case PressureAdvanceAlgorithm::CrossWlf: {
                pa.crossWlfCompressibility = readVal<float>(p);
                pa.filamentDiameter = readVal<float>(p);
                pa.smoothTime = readVal<float>(p);
                pa.maxCompensation = readVal<float>(p);
                pa.meltTempC = readVal<float>(p);
                uint32_t qCount = readVal<uint32_t>(p);
                uint32_t tCount = readVal<uint32_t>(p);
                readFloatArray(p, pa.qGrid, qCount);
                readFloatArray(p, pa.tempGrid, tCount);
                readFloatArray(p, pa.pValues, static_cast<size_t>(qCount) * tCount);
                break;
            }
            case PressureAdvanceAlgorithm::LtiDeconv: {
                pa.groupDelay = readVal<float>(p);
                pa.maxCompensation = readVal<float>(p);
                uint32_t momentCount = readVal<uint32_t>(p);
                readFloatArray(p, pa.moments, momentCount);
                break;
            }
            case PressureAdvanceAlgorithm::LpvDeconv: {
                pa.groupDelay = readVal<float>(p);
                pa.maxCompensation = readVal<float>(p);
                uint32_t opCount = readVal<uint32_t>(p);
                uint32_t momentCount = readVal<uint32_t>(p);
                pa.opPointVelocities.resize(opCount);
                pa.moments.resize(static_cast<size_t>(opCount) * momentCount);
                for (uint32_t j = 0; j < opCount; ++j) {
                    pa.opPointVelocities[j] = readVal<float>(p);
                    for (uint32_t k = 0; k < momentCount; ++k) {
                        pa.moments[j * momentCount + k] = readVal<float>(p);
                    }
                }
                break;
            }
        }

        // Skip any remaining bytes in the param block
        p = paramEnd;
        result.push_back(std::move(pa));
    }

    return result;
}

} // namespace tether::web
