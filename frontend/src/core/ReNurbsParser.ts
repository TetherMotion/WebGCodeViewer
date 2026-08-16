/**
 * @file ReNurbsParser.ts
 * @brief Parser for the TRNP (Tether ReNURBS Profile) binary format.
 *
 * TRNP stores per-segment NURBS curves for velocity, acceleration, jerk,
 * and time profiles. Instead of dense sampled arrays (O(samples) × 8 bytes
 * per quantity), it stores O(segments × controlPoints) × 4 bytes — a
 * 25×–100× size reduction.
 *
 * The curves are 1-D B-splines (weights all 1), parameterized by normalized
 * arc length u ∈ [0,1] within each segment. They are evaluated directly in
 * WGSL shaders using De Boor's algorithm.
 *
 * Binary format (little-endian):
 *   Header (64 bytes):
 *     magic[4] = "TRNP"
 *     version (u16)
 *     quantityCount (u8)
 *     reserved[1]
 *     segmentCount (u32)
 *     totalControlPoints (u32)
 *     totalKnots (u32)
 *     totalLength (f32)
 *     maxVelocity (f32)
 *     maxAcceleration (f32)
 *     maxJerk (f32)
 *     maxTime (f32)
 *     reserved[24]
 *   Quantity names (quantityCount × 32 bytes, null-padded)
 *   Segment table (segmentCount × 16 bytes):
 *     sStart (f32), sEnd (f32), quantityMetaOffset (u32), pad (u32)
 *   Quantity metadata (segmentCount × quantityCount × 16 bytes):
 *     cpOffset (u32), cpCount (u32), knotOffset (u32), degree (u32)
 *   Control points (totalControlPoints × 4 bytes, f32)
 *   Knots (totalKnots × 4 bytes, f32)
 */

export const TRNP_MAGIC = 'TRNP';
export const TRNP_VERSION = 1;

export interface TRNPHeader {
  magic: string;
  version: number;
  quantityCount: number;
  segmentCount: number;
  totalControlPoints: number;
  totalKnots: number;
  totalLength: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  maxTime: number;
}

export interface TRNPQuantityCurve {
  controlPoints: Float32Array;  // scalar values, 1-D B-spline
  knots: Float32Array;
  degree: number;
}

export interface TRNPSegment {
  sStart: number;
  sEnd: number;
  quantities: TRNPQuantityCurve[];  // index 0=velocity, 1=accel, 2=jerk, 3=time
}

export interface TRNPData {
  header: TRNPHeader;
  quantityNames: string[];
  segments: TRNPSegment[];
  // Flat buffers for direct GPU upload
  allControlPoints: Float32Array;
  allKnots: Float32Array;
  // Per-segment per-quantity metadata (flattened for GPU storage buffer)
  // Layout: segmentCount × quantityCount × 4 (cpOffset, cpCount, knotOffset, degree)
  quantityMeta: Uint32Array;
}

/**
 * Parse TRNP binary data.
 * @param data Binary TRNP data from the server
 * @returns Parsed TRNP data with flat GPU-ready buffers
 */
export function parseTRNP(data: Uint8Array | ArrayBuffer): TRNPData {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;

  // ── Header (64 bytes) ──
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== TRNP_MAGIC) {
    throw new Error(`Invalid TRNP magic: expected "${TRNP_MAGIC}", got "${magic}"`);
  }
  offset = 4;

  const version = view.getUint16(offset, true); offset += 2;
  if (version !== TRNP_VERSION) {
    throw new Error(`Unsupported TRNP version: ${version}`);
  }

  const quantityCount = view.getUint8(offset); offset += 1;
  offset += 1; // reserved

  const segmentCount = view.getUint32(offset, true); offset += 4;
  const totalControlPoints = view.getUint32(offset, true); offset += 4;
  const totalKnots = view.getUint32(offset, true); offset += 4;
  const totalLength = view.getFloat32(offset, true); offset += 4;
  const maxVelocity = view.getFloat32(offset, true); offset += 4;
  const maxAcceleration = view.getFloat32(offset, true); offset += 4;
  const maxJerk = view.getFloat32(offset, true); offset += 4;
  const maxTime = view.getFloat32(offset, true); offset += 4;
  offset += 24; // reserved

  const header: TRNPHeader = {
    magic, version, quantityCount, segmentCount,
    totalControlPoints, totalKnots,
    totalLength, maxVelocity, maxAcceleration, maxJerk, maxTime,
  };

  // ── Quantity names (quantityCount × 32 bytes) ──
  const quantityNames: string[] = [];
  for (let q = 0; q < quantityCount; q++) {
    let name = '';
    for (let i = 0; i < 32; i++) {
      const ch = view.getUint8(offset + i);
      if (ch === 0) break;
      name += String.fromCharCode(ch);
    }
    offset += 32;
    quantityNames.push(name);
  }

  // ── Segment table (segmentCount × 16 bytes) ──
  const segSStart: number[] = new Array(segmentCount);
  const segSEnd: number[] = new Array(segmentCount);
  const segMetaOffset: number[] = new Array(segmentCount);
  for (let s = 0; s < segmentCount; s++) {
    segSStart[s] = view.getFloat32(offset, true); offset += 4;
    segSEnd[s] = view.getFloat32(offset, true); offset += 4;
    segMetaOffset[s] = view.getUint32(offset, true); offset += 4;
    offset += 4; // pad
  }

  // ── Quantity metadata (segmentCount × quantityCount × 16 bytes) ──
  // Stored as flat Uint32Array for GPU upload: [cpOffset, cpCount, knotOffset, degree] per (seg, qty)
  const quantityMeta = new Uint32Array(segmentCount * quantityCount * 4);
  for (let s = 0; s < segmentCount; s++) {
    for (let q = 0; q < quantityCount; q++) {
      const idx = (s * quantityCount + q) * 4;
      quantityMeta[idx + 0] = view.getUint32(offset, true); offset += 4; // cpOffset
      quantityMeta[idx + 1] = view.getUint32(offset, true); offset += 4; // cpCount
      quantityMeta[idx + 2] = view.getUint32(offset, true); offset += 4; // knotOffset
      quantityMeta[idx + 3] = view.getUint32(offset, true); offset += 4; // degree
    }
  }

  // ── Control points (totalControlPoints × 4 bytes, f32) ──
  const allControlPoints = new Float32Array(totalControlPoints);
  for (let i = 0; i < totalControlPoints; i++) {
    allControlPoints[i] = view.getFloat32(offset, true); offset += 4;
  }

  // ── Knots (totalKnots × 4 bytes, f32) ──
  const allKnots = new Float32Array(totalKnots);
  for (let i = 0; i < totalKnots; i++) {
    allKnots[i] = view.getFloat32(offset, true); offset += 4;
  }

  // ── Build per-segment view objects ──
  const segments: TRNPSegment[] = [];
  for (let s = 0; s < segmentCount; s++) {
    const quantities: TRNPQuantityCurve[] = [];
    for (let q = 0; q < quantityCount; q++) {
      const idx = (s * quantityCount + q) * 4;
      const cpOffset = quantityMeta[idx + 0];
      const cpCount = quantityMeta[idx + 1];
      const knotOffset = quantityMeta[idx + 2];
      const degree = quantityMeta[idx + 3];

      if (cpCount > 0) {
        const knotCount = cpCount + degree + 1;
        quantities.push({
          controlPoints: allControlPoints.subarray(cpOffset, cpOffset + cpCount),
          knots: allKnots.subarray(knotOffset, knotOffset + knotCount),
          degree,
        });
      } else {
        quantities.push({
          controlPoints: new Float32Array(0),
          knots: new Float32Array(0),
          degree: 0,
        });
      }
    }
    segments.push({
      sStart: segSStart[s],
      sEnd: segSEnd[s],
      quantities,
    });
  }

  return {
    header,
    quantityNames,
    segments,
    allControlPoints,
    allKnots,
    quantityMeta,
  };
}

/**
 * Evaluate a 1-D B-spline at parameter u using De Boor's algorithm.
 * (CPU-side evaluation — for testing and miniplot rendering)
 *
 * @param controlPoints Scalar control point values
 * @param knots Knot vector
 * @param degree B-spline degree
 * @param u Parameter value
 * @returns Evaluated value
 */
export function evalBSpline1D(
  controlPoints: Float32Array | number[],
  knots: Float32Array | number[],
  degree: number,
  u: number,
): number {
  const cpCount = controlPoints.length;
  if (cpCount === 0) return 0;
  if (degree === 0) return controlPoints[0];

  // Clamp u to knot domain
  const knotMin = knots[degree];
  const knotMax = knots[cpCount]; // n+1 = cpCount, knot at index cpCount
  const uClamped = Math.max(knotMin, Math.min(knotMax, u));

  // Find knot span k
  let k = degree;
  for (let i = degree; i < cpCount; i++) {
    if (knots[i] <= uClamped && uClamped < knots[i + 1]) {
      k = i;
      break;
    }
  }
  if (uClamped >= knotMax) k = cpCount - 1;

  // De Boor recursion (1-D, weights=1)
  const d = new Float64Array(degree + 1);
  for (let j = 0; j <= degree; j++) {
    d[j] = controlPoints[k - degree + j];
  }

  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const a = knots[j] - knots[i];
      const b = knots[j + degree - r + 1] - knots[i];
      const alpha = b === 0 ? 0 : (uClamped - knots[i]) / b;
      d[j] = (1 - alpha) * d[j - 1] + alpha * d[j];
    }
  }

  return d[degree];
}
