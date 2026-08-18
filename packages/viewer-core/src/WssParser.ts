/**
 * @file WssParser.ts
 * @brief Parse TWSF (Tether Weighted Structure Format) binary data.
 *
 * TWSF contains the analytical Weighted Switching Structure (WSS) — the
 * Pareto-optimal velocity plan as a list of analytically integrable arcs.
 * This is NOT a sampled texture. The WebGPU shaders evaluate v(s), a(s),
 * j(s), t(s) in closed form at the exact points needed for rendering.
 *
 * Arc types:
 *   0 = BANG_PLUS  (η = +η_max): a(τ) = a0 + η·τ
 *   1 = BANG_MINUS (η = -η_max): same formulas with negative η
 *   2 = SINGULAR   (η = 0):      a(τ) = a*, v(τ) = v0 + a*·τ
 *   3 = WALL       (v = v_wall): velocity limited by path curvature
 *
 * For BANG arcs, inverting s(τ) to get τ requires solving a cubic.
 * For SINGULAR arcs, it's a quadratic: τ = (-v0 + √(v0² + 2·a*·Δs)) / a*
 * For WALL arcs, v = v_wall(s) is evaluated from NURBS curvature + limits.
 */

/// Arc type enum (matches C++ WssArcType).
export enum WssArcType {
  BangPlus = 0,
  BangMinus = 1,
  Singular = 2,
  Wall = 3,
}

/// A single WSS arc (48 bytes = 3 × vec4, f32 for direct GPU upload).
export interface WssArc {
  s0: number;        ///< Arc-length at arc start
  s1: number;        ///< Arc-length at arc end
  t0: number;        ///< Absolute time at arc start
  v0: number;        ///< Velocity at arc start
  a0: number;        ///< Acceleration at arc start
  eta: number;       ///< BANG: constant jerk. SINGULAR/WALL: unused.
  aStar: number;     ///< SINGULAR: constant acceleration. BANG/WALL: unused.
  duration: number;  ///< Arc duration (time span)
  type: WssArcType;  ///< Arc type
}

/// Kinematic limits for WALL arc evaluation.
export interface WssLimits {
  feedRate: number;
  maxPathVelocity: number;
  maxCentripetalAcceleration: number;
  maxAxisVelocityX: number;
  maxAxisVelocityY: number;
  maxAxisVelocityZ: number;
}

/// Complete WSS data — the analytical velocity profile.
export interface WssData {
  arcs: WssArc[];
  totalLength: number;
  totalTime: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  limits: WssLimits;
}

/// Flat arc data as Float32Array for direct GPU upload.
/// Each arc is 12 floats (48 bytes = 3 × vec4):
///   [s0, s1, t0, v0, a0, eta, aStar, duration, type, 0, 0, 0]
export interface WssGpuData extends WssData {
  /// Flat arc data ready for GPU storage buffer upload.
  arcBuffer: Float32Array;
}

class BinaryReader {
  private view: DataView;
  private offset: number = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readU8(): number { return this.view.getUint8(this.offset++); }
  readU16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  readU32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  readF32(): number { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  readF64(): number { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  skip(n: number): void { this.offset += n; }

  get remaining(): number { return this.view.byteLength - this.offset; }
}

const TWSF_MAGIC = 'TWSF';
const TWSF_VERSION = 1;
const TWSF_HEADER_SIZE = 80;
const TWSF_ARC_SIZE = 48; // 12 × f32

/**
 * Parse TWSF binary data into a WssGpuData structure.
 * The arcBuffer field is a Float32Array ready for GPU upload.
 */
export function parseTWSF(data: Uint8Array | ArrayBuffer): WssGpuData {
  const reader = new BinaryReader(data);

  // Header
  const magic = String.fromCharCode(reader.readU8(), reader.readU8(), reader.readU8(), reader.readU8());
  if (magic !== TWSF_MAGIC) {
    throw new Error(`Invalid TWSF magic: "${magic}"`);
  }

  const version = reader.readU16();
  if (version !== TWSF_VERSION) {
    throw new Error(`Unsupported TWSF version: ${version}`);
  }

  reader.readU8(); // reserved1
  reader.readU8(); // reserved2
  const arcCount = reader.readU32();
  const totalLength = reader.readF64();
  const totalTime = reader.readF64();
  const maxVelocity = reader.readF32();
  const maxAcceleration = reader.readF32();
  const maxJerk = reader.readF32();

  // Kinematic limits (32 bytes = 8 × f32)
  const feedRate = reader.readF32();
  const maxPathVelocity = reader.readF32();
  const maxCentripetalAcceleration = reader.readF32();
  const maxAxisVelocityX = reader.readF32();
  const maxAxisVelocityY = reader.readF32();
  const maxAxisVelocityZ = reader.readF32();
  reader.readF32(); // pad1
  reader.readF32(); // pad2

  // Reserved[8]
  reader.skip(8);

  // Arc array — read as Float32Array directly for GPU upload
  const expectedBytes = arcCount * TWSF_ARC_SIZE;
  if (reader.remaining < expectedBytes) {
    throw new Error(`TWSF arc data too short: expected ${expectedBytes} bytes, got ${reader.remaining}`);
  }

  // Create a Float32Array view over the arc data
  const arcBuffer = new Float32Array(arcCount * 12);
  for (let i = 0; i < arcCount; i++) {
    for (let j = 0; j < 12; j++) {
      arcBuffer[i * 12 + j] = reader.readF32();
    }
  }

  // Build typed arc list for CPU-side use
  const arcs: WssArc[] = [];
  for (let i = 0; i < arcCount; i++) {
    const base = i * 12;
    arcs.push({
      s0: arcBuffer[base + 0],
      s1: arcBuffer[base + 1],
      t0: arcBuffer[base + 2],
      v0: arcBuffer[base + 3],
      a0: arcBuffer[base + 4],
      eta: arcBuffer[base + 5],
      aStar: arcBuffer[base + 6],
      duration: arcBuffer[base + 7],
      type: Math.round(arcBuffer[base + 8]) as WssArcType,
    });
  }

  return {
    arcs,
    totalLength,
    totalTime,
    maxVelocity,
    maxAcceleration,
    maxJerk,
    limits: {
      feedRate,
      maxPathVelocity,
      maxCentripetalAcceleration,
      maxAxisVelocityX,
      maxAxisVelocityY,
      maxAxisVelocityZ,
    },
    arcBuffer,
  };
}

// ── CPU-side WSS evaluation (for testing / miniplot) ─────────────────────

/**
 * Solve for τ given Δs in a BANG arc using Newton's method.
 * Cubic: (η/6)τ³ + (a0/2)τ² + v0·τ − ds = 0
 */
function bangTauForDs(v0: number, a0: number, eta: number, ds: number): number {
  if (ds <= 0) return 0;
  // Initial guess: assume constant velocity
  let tau = ds / Math.max(v0, 1e-6);
  for (let iter = 0; iter < 20; iter++) {
    const f = v0 * tau + 0.5 * a0 * tau * tau + (1.0 / 6.0) * eta * tau * tau * tau - ds;
    const fp = v0 + a0 * tau + 0.5 * eta * tau * tau;
    if (Math.abs(fp) < 1e-15) break;
    const dtau = f / fp;
    tau -= dtau;
    if (Math.abs(dtau) < 1e-12) break;
  }
  return Math.max(tau, 0);
}

/**
 * Solve for τ given Δs in a SINGULAR arc.
 * Quadratic: v0·τ + ½·a*·τ² = ds → τ = (-v0 + √(v0² + 2·a*·ds)) / a*
 */
function singularTauForDs(v0: number, aStar: number, ds: number): number {
  if (ds <= 0) return 0;
  if (Math.abs(aStar) < 1e-14) return ds / Math.max(v0, 1e-6);
  const disc = v0 * v0 + 2 * aStar * ds;
  return (-v0 + Math.sqrt(Math.max(disc, 0))) / aStar;
}

/**
 * Evaluate the WSS at arc-length s, returning [time, velocity, acceleration, jerk].
 * For WALL arcs, v_wall(s) cannot be computed without the NURBS path —
 * this CPU-side function returns v = v0 (approximate). The GPU shader
 * evaluates WALL arcs exactly from the NURBS curvature.
 */
export function sampleWssAtS(data: WssData, s: number): [number, number, number, number] {
  const arcs = data.arcs;
  if (arcs.length === 0) return [0, 0, 0, 0];

  // Binary search for the arc containing s
  let lo = 0, hi = arcs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid].s1 < s) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.min(lo, arcs.length - 1);
  const arc = arcs[idx];

  const dsLocal = Math.max(0, s - arc.s0);
  let tau: number;

  switch (arc.type) {
    case WssArcType.Singular:
      tau = singularTauForDs(arc.v0, arc.aStar, dsLocal);
      {
        const v = arc.v0 + arc.aStar * tau;
        const a = arc.aStar;
        const j = 0;
        const t = arc.t0 + tau;
        return [t, v, a, j];
      }

    case WssArcType.Wall:
      // CPU-side approximation: constant velocity = (s1-s0)/duration
      tau = arc.duration > 0 ? dsLocal * arc.duration / (arc.s1 - arc.s0) : 0;
      {
        const v = arc.v0;
        const a = 0;
        const j = 0;
        const t = arc.t0 + tau;
        return [t, v, a, j];
      }

    default: { // BANG_PLUS or BANG_MINUS
      tau = bangTauForDs(arc.v0, arc.a0, arc.eta, dsLocal);
      const a = arc.a0 + arc.eta * tau;
      const v = arc.v0 + arc.a0 * tau + 0.5 * arc.eta * tau * tau;
      const j = arc.eta;
      const t = arc.t0 + tau;
      return [t, v, a, j];
    }
  }
}

// ── WSS → TRNP conversion (temporary, for the existing miniplot) ──────────

/**
 * Sample the WSS analytically and produce a TRNP-like structure so it can
 * be fed to the existing GpuPlot miniplot. Each quantity (time, velocity,
 * acceleration, jerk) becomes a degree-1 linear B-spline over the arc-length
 * domain [0, totalLength].
 *
 * This is a temporary bridge — Phase 7 will replace the miniplot with a
 * custom WebGPU renderer that samples the WSS analytically in a compute
 * shader, with infinite zoom and no fixed sample count.
 *
 * @param data The parsed WSS data
 * @param numSamples Number of samples to take (default 2048)
 */
export function wssToTrnp(data: WssData, numSamples: number = 2048) {
  const n = Math.max(2, Math.min(numSamples, 8192));
  const qCount = 4; // time, velocity, acceleration, jerk
  const L = data.totalLength;

  // Sample the WSS at uniform arc-length intervals
  const texels = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = L * i / (n - 1);
    const [t, v, a, j] = sampleWssAtS(data, s);
    texels[i * 4 + 0] = t;
    texels[i * 4 + 1] = v;
    texels[i * 4 + 2] = a;
    texels[i * 4 + 3] = j;
  }

  // Build a degree-1 (linear) B-spline over [0, 1] parameter domain
  const knots = new Float32Array(n + 2);
  knots[0] = 0;
  knots[1] = 0;
  for (let i = 0; i < n; i++) {
    knots[i + 1] = i / Math.max(1, n - 1);
  }
  knots[n] = 1;
  knots[n + 1] = 1;

  const quantities: import('./ReNurbsParser').TRNPQuantityCurve[] = [];
  for (let q = 0; q < qCount; q++) {
    const cp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      cp[i] = texels[i * 4 + q];
    }
    quantities.push({ controlPoints: cp, knots, degree: 1 });
  }

  const segment = {
    sStart: 0,
    sEnd: data.totalTime,
    quantities,
  };

  return {
    header: {
      magic: 'TRNP',
      version: 1,
      quantityCount: qCount,
      segmentCount: 1,
      totalControlPoints: n * qCount,
      totalKnots: knots.length * qCount,
      totalLength: data.totalLength,
      maxVelocity: data.maxVelocity,
      maxAcceleration: data.maxAcceleration,
      maxJerk: data.maxJerk,
      maxTime: data.totalTime,
    },
    quantityNames: ['time', 'velocity', 'acceleration', 'jerk'],
    segments: [segment],
    allControlPoints: (() => {
      const out = new Float32Array(n * qCount);
      for (let q = 0; q < qCount; q++) {
        for (let i = 0; i < n; i++) {
          out[q * n + i] = texels[i * 4 + q];
        }
      }
      return out;
    })(),
    allKnots: (() => {
      const out = new Float32Array(knots.length * qCount);
      for (let q = 0; q < qCount; q++) {
        out.set(knots, q * knots.length);
      }
      return out;
    })(),
    quantityMeta: (() => {
      const out = new Uint32Array(qCount * 4);
      for (let q = 0; q < qCount; q++) {
        out[q * 4 + 0] = q * n;
        out[q * 4 + 1] = n;
        out[q * 4 + 2] = q * knots.length;
        out[q * 4 + 3] = 1;
      }
      return out;
    })(),
  };
}
