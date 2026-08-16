import { describe, it, expect } from 'vitest';
import { parseTRNP, parseTRNPPa, evalBSpline1D, TRNP_MAGIC, TRNP_VERSION } from '../src/core/ReNurbsParser';
import type { TRNPHeader, TRNPData, TRNPPaData } from '../src/core/ReNurbsParser';

/**
 * Build a minimal TRNP binary for testing.
 * Format: header(64) + qtyNames(4×32) + segTable(2×16) + qtyMeta(2×4×16) + CPs + knots
 */
function buildTestTRNP(): Uint8Array {
  const segmentCount = 2;
  const quantityCount = 4;
  // Each segment has 2 CPs and 4 knots per quantity (degree 1)
  const cpCountPerQty = 2;
  const knotCountPerQty = 4; // cpCount + degree + 1 = 2 + 1 + 1
  const totalCPs = segmentCount * quantityCount * cpCountPerQty; // 16
  const totalKnots = segmentCount * quantityCount * knotCountPerQty; // 32

  const buf = new ArrayBuffer(64 + quantityCount * 32 + segmentCount * 16 + segmentCount * quantityCount * 16 + totalCPs * 4 + totalKnots * 4);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let offset = 0;

  // Header (64 bytes)
  for (let i = 0; i < 4; i++) u8[offset + i] = TRNP_MAGIC.charCodeAt(i);
  offset = 4;
  view.setUint16(offset, TRNP_VERSION, true); offset += 2;
  view.setUint8(offset, quantityCount); offset += 1;
  view.setUint8(offset, 0); offset += 1; // reserved
  view.setUint32(offset, segmentCount, true); offset += 4;
  view.setUint32(offset, totalCPs, true); offset += 4;
  view.setUint32(offset, totalKnots, true); offset += 4;
  view.setFloat32(offset, 20.0, true); offset += 4; // totalLength
  view.setFloat32(offset, 100.0, true); offset += 4; // maxVelocity
  view.setFloat32(offset, 5.0, true); offset += 4; // maxAcceleration
  view.setFloat32(offset, 0.0, true); offset += 4; // maxJerk
  view.setFloat32(offset, 0.4, true); offset += 4; // maxTime
  for (let i = 0; i < 24; i++) { view.setUint8(offset + i, 0); }
  offset += 24;

  // Quantity names (4 × 32 bytes)
  const names = ['velocity', 'acceleration', 'jerk', 'time'];
  for (const name of names) {
    for (let i = 0; i < 32; i++) {
      view.setUint8(offset + i, i < name.length ? name.charCodeAt(i) : 0);
    }
    offset += 32;
  }

  // Segment table (2 × 16 bytes)
  // Segment 0: sStart=0, sEnd=10
  view.setFloat32(offset, 0.0, true); offset += 4;
  view.setFloat32(offset, 10.0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4; // quantityMetaOffset
  view.setUint32(offset, 0, true); offset += 4; // pad
  // Segment 1: sStart=10, sEnd=20
  view.setFloat32(offset, 10.0, true); offset += 4;
  view.setFloat32(offset, 20.0, true); offset += 4;
  view.setUint32(offset, 4, true); offset += 4; // quantityMetaOffset
  view.setUint32(offset, 0, true); offset += 4; // pad

  // Quantity metadata (2 × 4 × 16 bytes)
  // CPs are laid out: seg0(q0,q1,q2,q3), seg1(q0,q1,q2,q3)
  // Each has 2 CPs and 4 knots
  let cpCursor = 0;
  let knotCursor = 0;
  for (let s = 0; s < segmentCount; s++) {
    for (let q = 0; q < quantityCount; q++) {
      view.setUint32(offset, cpCursor, true); offset += 4;  // cpOffset
      view.setUint32(offset, cpCountPerQty, true); offset += 4;  // cpCount
      view.setUint32(offset, knotCursor, true); offset += 4;  // knotOffset
      view.setUint32(offset, 1, true); offset += 4;  // degree
      cpCursor += cpCountPerQty;
      knotCursor += knotCountPerQty;
    }
  }

  // Control points (16 × 4 bytes, f32)
  // Seg0: velocity=[50,50], accel=[0,0], jerk=[0,0], time=[0,0.2]
  // Seg1: velocity=[50,100], accel=[5,5], jerk=[0,0], time=[0.2,0.4]
  const cps = [
    50, 50,  0, 0,  0, 0,  0, 0.2,  // seg 0
    50, 100, 5, 5,  0, 0,  0.2, 0.4, // seg 1
  ];
  for (const cp of cps) {
    view.setFloat32(offset, cp, true); offset += 4;
  }

  // Knots (32 × 4 bytes, f32) — all [0,0,1,1] for degree 1
  for (let i = 0; i < totalKnots; i += 4) {
    view.setFloat32(offset, 0.0, true); offset += 4;
    view.setFloat32(offset, 0.0, true); offset += 4;
    view.setFloat32(offset, 1.0, true); offset += 4;
    view.setFloat32(offset, 1.0, true); offset += 4;
  }

  return u8;
}

describe('ReNurbsParser', () => {
  it('parses a valid TRNP binary', () => {
    const data = buildTestTRNP();
    const parsed = parseTRNP(data);

    expect(parsed.header.magic).toBe(TRNP_MAGIC);
    expect(parsed.header.version).toBe(TRNP_VERSION);
    expect(parsed.header.quantityCount).toBe(4);
    expect(parsed.header.segmentCount).toBe(2);
    expect(parsed.header.totalLength).toBeCloseTo(20.0);
    expect(parsed.header.maxVelocity).toBeCloseTo(100.0);
    expect(parsed.header.maxAcceleration).toBeCloseTo(5.0);
    expect(parsed.header.maxJerk).toBeCloseTo(0.0);
    expect(parsed.header.maxTime).toBeCloseTo(0.4);
  });

  it('parses quantity names correctly', () => {
    const parsed = parseTRNP(buildTestTRNP());
    expect(parsed.quantityNames).toEqual(['velocity', 'acceleration', 'jerk', 'time']);
  });

  it('parses segment boundaries correctly', () => {
    const parsed = parseTRNP(buildTestTRNP());
    expect(parsed.segments.length).toBe(2);
    expect(parsed.segments[0].sStart).toBeCloseTo(0.0);
    expect(parsed.segments[0].sEnd).toBeCloseTo(10.0);
    expect(parsed.segments[1].sStart).toBeCloseTo(10.0);
    expect(parsed.segments[1].sEnd).toBeCloseTo(20.0);
  });

  it('parses control points correctly', () => {
    const parsed = parseTRNP(buildTestTRNP());

    // Segment 0 velocity: [50, 50]
    const seg0Vel = parsed.segments[0].quantities[0];
    expect(seg0Vel.controlPoints.length).toBe(2);
    expect(seg0Vel.controlPoints[0]).toBeCloseTo(50.0);
    expect(seg0Vel.controlPoints[1]).toBeCloseTo(50.0);
    expect(seg0Vel.degree).toBe(1);

    // Segment 1 velocity: [50, 100]
    const seg1Vel = parsed.segments[1].quantities[0];
    expect(seg1Vel.controlPoints.length).toBe(2);
    expect(seg1Vel.controlPoints[0]).toBeCloseTo(50.0);
    expect(seg1Vel.controlPoints[1]).toBeCloseTo(100.0);
  });

  it('provides flat GPU-ready buffers', () => {
    const parsed = parseTRNP(buildTestTRNP());
    expect(parsed.allControlPoints.length).toBe(16);
    expect(parsed.allKnots.length).toBe(32);
    // quantityMeta: 2 segments × 4 quantities × 4 values = 32 u32s
    expect(parsed.quantityMeta.length).toBe(32);
  });

  it('throws on invalid magic', () => {
    const bad = buildTestTRNP();
    bad[0] = 'X'.charCodeAt(0);
    expect(() => parseTRNP(bad)).toThrow(/Invalid TRNP magic/);
  });

  it('throws on unsupported version', () => {
    const bad = buildTestTRNP();
    const view = new DataView(bad.buffer);
    view.setUint16(4, 999, true); // version = 999
    expect(() => parseTRNP(bad)).toThrow(/Unsupported TRNP version/);
  });
});

describe('evalBSpline1D', () => {
  it('evaluates a constant degree-1 curve', () => {
    const cps = new Float32Array([50, 50]);
    const knots = new Float32Array([0, 0, 1, 1]);
    // At u=0, u=0.5, u=1 — all should be 50
    expect(evalBSpline1D(cps, knots, 1, 0.0)).toBeCloseTo(50.0);
    expect(evalBSpline1D(cps, knots, 1, 0.5)).toBeCloseTo(50.0);
    expect(evalBSpline1D(cps, knots, 1, 1.0)).toBeCloseTo(50.0);
  });

  it('evaluates a linear ramp correctly', () => {
    const cps = new Float32Array([0, 100]);
    const knots = new Float32Array([0, 0, 1, 1]);
    expect(evalBSpline1D(cps, knots, 1, 0.0)).toBeCloseTo(0.0);
    expect(evalBSpline1D(cps, knots, 1, 0.5)).toBeCloseTo(50.0);
    expect(evalBSpline1D(cps, knots, 1, 1.0)).toBeCloseTo(100.0);
  });

  it('handles degree 0 (constant)', () => {
    const cps = new Float32Array([42]);
    const knots = new Float32Array([0, 1]);
    expect(evalBSpline1D(cps, knots, 0, 0.5)).toBeCloseTo(42.0);
  });

  it('handles empty control points', () => {
    const cps = new Float32Array(0);
    const knots = new Float32Array(0);
    expect(evalBSpline1D(cps, knots, 1, 0.5)).toBe(0);
  });

  it('clamps u to knot domain', () => {
    const cps = new Float32Array([0, 100]);
    const knots = new Float32Array([0, 0, 1, 1]);
    // u > 1 should clamp to 1 → 100
    expect(evalBSpline1D(cps, knots, 1, 2.0)).toBeCloseTo(100.0);
    // u < 0 should clamp to 0 → 0
    expect(evalBSpline1D(cps, knots, 1, -1.0)).toBeCloseTo(0.0);
  });
});

// ── TRNP-PA parser tests ────────────────────────────────────────────────────

describe('parseTRNPPa', () => {
  /**
   * Build a minimal TRNP-PA binary for testing.
   * Format: header(32) + paTable(paCount×40) + per-PA data
   */
  function buildTestTRNPPa(): Uint8Array {
    const paCount = 2;  // Linear + PowerLaw
    const segCount = 1;
    const qtyCount = 2;  // pressure_offset + extruder_velocity
    const cpCountPerQty = 3;
    const degree = 2;
    const knotCountPerQty = cpCountPerQty + degree + 1; // 6

    // Header: 32 bytes
    // PA table: paCount × 44 bytes (1+3+32+4+4 = 44 per entry)
    // Per PA: segCount(4) + segTable(segCount×16) + qtyMeta(segCount×qtyCount×16) + CPs + knots
    const perPaDataSize = 4 + segCount * 16 + segCount * qtyCount * 16 +
                          segCount * qtyCount * cpCountPerQty * 4 +
                          segCount * qtyCount * knotCountPerQty * 4;
    const totalSize = 32 + paCount * 44 + paCount * perPaDataSize;
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let offset = 0;

    // Header (32 bytes)
    u8[0] = 'T'.charCodeAt(0); u8[1] = 'P'.charCodeAt(0);
    u8[2] = 'A'.charCodeAt(0); u8[3] = 0;
    offset = 4;
    view.setUint16(offset, 1, true); offset += 2; // version
    view.setUint8(offset, paCount); offset += 1;
    view.setUint8(offset, 0); offset += 1; // reserved
    view.setUint32(offset, paCount * segCount, true); offset += 4; // totalSegments
    view.setUint32(offset, paCount * segCount * qtyCount * cpCountPerQty, true); offset += 4; // totalCPs
    view.setUint32(offset, paCount * segCount * qtyCount * knotCountPerQty, true); offset += 4; // totalKnots
    offset += 12; // reserved

    // PA algorithm table (paCount × 40 bytes)
    const names = ['Linear', 'PowerLaw'];
    for (let i = 0; i < paCount; i++) {
      view.setUint8(offset, i); offset += 1; // algorithmId
      offset += 3; // reserved
      // Name (32 bytes, null-padded)
      for (let j = 0; j < 32; j++) {
        u8[offset + j] = j < names[i].length ? names[i].charCodeAt(j) : 0;
      }
      offset += 32;
      view.setFloat32(offset, 0.3, true); offset += 4; // maxOffset
      view.setFloat32(offset, 50.0, true); offset += 4; // maxVelocity
    }

    // Per-PA data
    for (let i = 0; i < paCount; i++) {
      view.setUint32(offset, segCount, true); offset += 4; // segCount

      // Segment table
      view.setFloat32(offset, 0.0, true); offset += 4; // sStart
      view.setFloat32(offset, 0.1, true); offset += 4; // sEnd
      view.setUint32(offset, 0, true); offset += 4; // quantityMetaOffset
      view.setUint32(offset, 0, true); offset += 4; // pad

      // Quantity metadata
      let cpCursor = 0, knotCursor = 0;
      for (let q = 0; q < qtyCount; q++) {
        view.setUint32(offset, cpCursor, true); offset += 4;
        view.setUint32(offset, cpCountPerQty, true); offset += 4;
        view.setUint32(offset, knotCursor, true); offset += 4;
        view.setUint32(offset, degree, true); offset += 4;
        cpCursor += cpCountPerQty;
        knotCursor += knotCountPerQty;
      }

      // Control points
      for (let q = 0; q < qtyCount; q++) {
        for (let c = 0; c < cpCountPerQty; c++) {
          view.setFloat32(offset, c * 0.1 * (i + 1), true); offset += 4;
        }
      }

      // Knots
      for (let q = 0; q < qtyCount; q++) {
        for (let k = 0; k < knotCountPerQty; k++) {
          view.setFloat32(offset, k / (knotCountPerQty - 1), true); offset += 4;
        }
      }
    }

    return u8;
  }

  it('parses valid TRNP-PA data', () => {
    const data = buildTestTRNPPa();
    const parsed = parseTRNPPa(data);
    expect(parsed.paEntries.length).toBe(2);
    expect(parsed.paEntries[0].algorithmId).toBe(0);
    expect(parsed.paEntries[0].algorithmName).toBe('Linear');
    expect(parsed.paEntries[1].algorithmId).toBe(1);
    expect(parsed.paEntries[1].algorithmName).toBe('PowerLaw');
  });

  it('parses max values correctly', () => {
    const data = buildTestTRNPPa();
    const parsed = parseTRNPPa(data);
    expect(parsed.paEntries[0].maxOffset).toBeCloseTo(0.3);
    expect(parsed.paEntries[0].maxVelocity).toBeCloseTo(50.0);
  });

  it('parses segments with correct boundaries', () => {
    const data = buildTestTRNPPa();
    const parsed = parseTRNPPa(data);
    expect(parsed.paEntries[0].segments.length).toBe(1);
    expect(parsed.paEntries[0].segments[0].sStart).toBeCloseTo(0.0);
    expect(parsed.paEntries[0].segments[0].sEnd).toBeCloseTo(0.1);
  });

  it('parses quantities with correct control points', () => {
    const data = buildTestTRNPPa();
    const parsed = parseTRNPPa(data);
    const seg = parsed.paEntries[0].segments[0];
    expect(seg.quantities.length).toBe(2);
    expect(seg.quantities[0].controlPoints.length).toBe(3);
    expect(seg.quantities[0].degree).toBe(2);
    expect(seg.quantities[0].knots.length).toBe(6);
  });

  it('throws on invalid magic', () => {
    const bad = new Uint8Array(32);
    bad[0] = 'X'; bad[1] = 'X'; bad[2] = 'X'; bad[3] = 0;
    expect(() => parseTRNPPa(bad)).toThrow();
  });

  it('throws on too-small data', () => {
    const small = new Uint8Array(10);
    expect(() => parseTRNPPa(small)).toThrow();
  });

  it('handles empty PA entries', () => {
    // Build TRNP-PA with 0 algorithms
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    u8[0] = 0x54; // 'T'
    u8[1] = 0x50; // 'P'
    u8[2] = 0x41; // 'A'
    u8[3] = 0x00;
    view.setUint16(4, 1, true); // version
    view.setUint8(6, 0); // paCount = 0
    const parsed = parseTRNPPa(u8);
    expect(parsed.paEntries.length).toBe(0);
  });
});
