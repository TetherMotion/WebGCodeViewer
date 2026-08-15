/// @file NurbsSerializer.cpp
/// @brief Implementation of NBP (NURBS Binary Path) serialization.

#include "tether/web/NurbsSerializer.hpp"

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace tether::web {

namespace {

void writeU8(std::vector<uint8_t>& buf, uint8_t v) {
    buf.push_back(v);
}

void writeU16(std::vector<uint8_t>& buf, uint16_t v) {
    buf.push_back(static_cast<uint8_t>(v & 0xFF));
    buf.push_back(static_cast<uint8_t>(v >> 8));
}

void writeU32(std::vector<uint8_t>& buf, uint32_t v) {
    buf.push_back(static_cast<uint8_t>(v & 0xFF));
    buf.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    buf.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    buf.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
}

void writeF64(std::vector<uint8_t>& buf, double v) {
    uint64_t bits;
    std::memcpy(&bits, &v, 8);
    for (int i = 0; i < 8; ++i) {
        buf.push_back(static_cast<uint8_t>((bits >> (i * 8)) & 0xFF));
    }
}

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

double readF64(const uint8_t*& p) {
    uint64_t bits = 0;
    for (int i = 0; i < 8; ++i)
        bits |= static_cast<uint64_t>(*p++) << (i * 8);
    double v;
    std::memcpy(&v, &bits, 8);
    return v;
}

} // namespace

std::vector<uint8_t> serializeNurbsPath(
    const tether::motion::PiecewiseNurbsPath& path,
    const std::vector<BlockMetadata>& blocks,
    const std::vector<uint8_t>& motionTypes)
{
    const auto& pieces = path.pieces();
    const auto dim = path.dim();
    const uint32_t pieceCount = static_cast<uint32_t>(pieces.size());
    const uint32_t blockCount = static_cast<uint32_t>(blocks.size());

    // Count totals
    uint32_t totalCP = 0, totalKnots = 0;
    for (const auto& curve : pieces) {
        totalCP += static_cast<uint32_t>(curve.numControlPoints());
        totalKnots += static_cast<uint32_t>(curve.knots().size());
    }

    // Compute bounds and total length
    double bMin[3] = {1e18, 1e18, 1e18};
    double bMax[3] = {-1e18, -1e18, -1e18};
    for (const auto& curve : pieces) {
        for (const auto& cp : curve.controlPoints()) {
            for (std::size_t i = 0; i < std::min(static_cast<std::size_t>(3), cp.dim()); ++i) {
                bMin[i] = std::min(bMin[i], cp[i]);
                bMax[i] = std::max(bMax[i], cp[i]);
            }
        }
    }
    double totalLen = path.totalLength();

    // Allocate buffer
    std::vector<uint8_t> buf;
    buf.reserve(80 + pieceCount * 20 + totalCP * dim * 8 + totalCP * 8 + totalKnots * 8);

    // ── Write header ──
    buf.insert(buf.end(), NBP_MAGIC, NBP_MAGIC + 4);
    writeU16(buf, NBP_VERSION);
    writeU8(buf, static_cast<uint8_t>(dim));
    writeU8(buf, 0); writeU8(buf, 0); writeU8(buf, 0); // reserved
    writeU32(buf, pieceCount);
    writeU32(buf, blockCount);
    writeU32(buf, totalCP);
    writeU32(buf, totalKnots);
    writeF64(buf, totalLen);
    for (int i = 0; i < 3; ++i) writeF64(buf, bMin[i]);
    for (int i = 0; i < 3; ++i) writeF64(buf, bMax[i]);

    // ── Write piece table ──
    for (uint32_t i = 0; i < pieceCount; ++i) {
        const auto& curve = pieces[i];
        writeU8(buf, static_cast<uint8_t>(curve.degree()));
        writeU8(buf, 0); writeU8(buf, 0); writeU8(buf, 0); // reserved
        writeU32(buf, static_cast<uint32_t>(curve.numControlPoints()));
        writeU32(buf, static_cast<uint32_t>(curve.knots().size()));
        uint8_t mt = i < motionTypes.size() ? motionTypes[i] : 1;
        writeU8(buf, mt);
        writeU8(buf, 0); writeU8(buf, 0); writeU8(buf, 0); // reserved
    }

    // ── Write control points (all pieces, contiguous) ──
    for (const auto& curve : pieces) {
        for (const auto& cp : curve.controlPoints()) {
            for (std::size_t d = 0; d < dim; ++d) {
                writeF64(buf, d < cp.dim() ? cp[d] : 0.0);
            }
        }
    }

    // ── Write weights (all pieces, contiguous) ──
    for (const auto& curve : pieces) {
        for (double w : curve.weights()) {
            writeF64(buf, w);
        }
    }

    // ── Write knots (all pieces, contiguous) ──
    for (const auto& curve : pieces) {
        for (double k : curve.knots()) {
            writeF64(buf, k);
        }
    }

    // ── Write block metadata (same format as TTHR) ──
    for (const auto& block : blocks) {
        writeU32(buf, 0); // placeholder for blockIndex — we'll use the loop index
    }
    // Actually write proper block metadata
    // Rewind: we already wrote placeholder bytes. Let's redo this section.
    // Remove the placeholder bytes we just wrote:
    buf.resize(buf.size() - blockCount * 4);

    for (uint32_t i = 0; i < blockCount; ++i) {
        const auto& block = blocks[i];
        // blockIndex (i32)
        int32_t bi = block.blockIndex >= 0 ? block.blockIndex : static_cast<int32_t>(i);
        uint32_t biu;
        std::memcpy(&biu, &bi, 4);
        writeU32(buf, biu);
        // lineNumber (i32)
        int32_t ln = block.lineNumber;
        uint32_t lnu;
        std::memcpy(&lnu, &ln, 4);
        writeU32(buf, lnu);
        // motionType (u8)
        writeU8(buf, block.motionType);
        // G-code text length (u32) + text
        writeU32(buf, static_cast<uint32_t>(block.gcodeText.size()));
        buf.insert(buf.end(), block.gcodeText.begin(), block.gcodeText.end());
    }

    return buf;
}

ParsedNBP parseNurbsPath(std::span<const uint8_t> data) {
    ParsedNBP result;
    if (data.size() < 80) return result;

    const uint8_t* p = data.data();

    // Header
    std::memcpy(result.header.magic, p, 4); p += 4;
    if (std::memcmp(result.header.magic, NBP_MAGIC, 4) != 0) return result;
    result.header.version = readU16(p);
    result.header.dim = readU8(p); p += 3;
    result.header.pieceCount = readU32(p);
    result.header.blockCount = readU32(p);
    result.header.totalControlPoints = readU32(p);
    result.header.totalKnots = readU32(p);
    result.header.totalLength = readF64(p);
    for (int i = 0; i < 3; ++i) result.header.boundsMin[i] = readF64(p);
    for (int i = 0; i < 3; ++i) result.header.boundsMax[i] = readF64(p);

    if (result.header.version != NBP_VERSION) return result;

    const auto dim = result.header.dim;

    // Piece table
    result.pieces.resize(result.header.pieceCount);
    for (uint32_t i = 0; i < result.header.pieceCount; ++i) {
        result.pieces[i].degree = readU8(p); p += 3;
        uint32_t cpCount = readU32(p);
        uint32_t knotCount = readU32(p);
        result.pieces[i].motionType = readU8(p); p += 3;
        result.pieces[i].controlPoints.resize(cpCount, std::vector<double>(dim));
        result.pieces[i].weights.resize(cpCount);
        result.pieces[i].knots.resize(knotCount);
    }

    // Control points
    for (uint32_t i = 0; i < result.header.pieceCount; ++i) {
        for (auto& cp : result.pieces[i].controlPoints) {
            for (uint8_t d = 0; d < dim; ++d) cp[d] = readF64(p);
        }
    }

    // Weights
    for (uint32_t i = 0; i < result.header.pieceCount; ++i) {
        for (auto& w : result.pieces[i].weights) w = readF64(p);
    }

    // Knots
    for (uint32_t i = 0; i < result.header.pieceCount; ++i) {
        for (auto& k : result.pieces[i].knots) k = readF64(p);
    }

    // Blocks
    result.blocks.resize(result.header.blockCount);
    for (uint32_t i = 0; i < result.header.blockCount; ++i) {
        uint32_t biu = readU32(p);
        std::memcpy(&result.blocks[i].blockIndex, &biu, 4);
        uint32_t lnu = readU32(p);
        std::memcpy(&result.blocks[i].lineNumber, &lnu, 4);
        result.blocks[i].motionType = readU8(p);
        uint32_t textLen = readU32(p);
        result.blocks[i].gcodeText = std::string(reinterpret_cast<const char*>(p), textLen);
        p += textLen;
    }

    return result;
}

} // namespace tether::web
