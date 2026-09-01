/**
 * @file NurbsRenderer.ts
 * @brief WebGPU renderer for NURBS path data (NBP format) with ReNURBS
 *        velocity/acceleration/jerk curves evaluated in WGSL shaders.
 *
 * Tessellates each NURBS piece on the CPU using De Boor's algorithm
 * and renders the resulting line segments via WebGPU. The tessellation
 * resolution is adaptive: longer pieces get more segments.
 *
 * When ReNURBS profile data (TRNP format) is available, per-vertex
 * velocity/acceleration/jerk values are evaluated directly in the vertex
 * shader using De Boor's algorithm on GPU storage buffers. This provides
 * smooth, accurate kinematic coloring without dense sampled data.
 */

import { Mat4 } from "@tether/viewer-core";
import { NBPData, NBPPiece, tessellatePiece } from "@tether/viewer-core";
import { TRNPData } from "@tether/viewer-core";
import { WssGpuData } from "@tether/viewer-core";
import { PressureAdvanceParamBlock } from "@tether/viewer-core";
import { ColorMap } from "@tether/viewer-core";

export type NurbsColorAttribute = 'pieceIndex' | 'deviation' | 'zHeight' | 'extruderSpeed' | 'motion' | 'solid' | 'feedRate' | 'spindleRpm' | 'toolNumber' | 'coolant' | 'featureType' | 'velocity' | 'acceleration' | 'jerk' | 'time' | 'pressureAdvanceOffset' | 'pressureAdvanceVelocity';

export interface NurbsRenderOptions {
  colorMap: ColorMap;
  colorAttribute: NurbsColorAttribute;
  lineWidth: number;
  visible: boolean;
  showTravels: boolean;       // Feature #1: show/hide travel moves (motionType 0)
  highlightRetractions: boolean; // Feature #3: highlight retraction moves in red
  highlightOverhangs: boolean;   // Highlight overhang regions
  zSeamVisible: boolean;         // Show Z-seam markers
  highlightBridges: boolean;     // Highlight bridge regions
  highlightSupport: boolean;     // Highlight support structure
  volumetricSegments: boolean;   // Render segments as camera-facing quads (thick lines)
}

export class NurbsRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private colorBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private indexCount: number = 0;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private colorLUTTexture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private sampleIdxBuffer: GPUBuffer | null = null;
  private sampleCount: number = 0;
  private progress: number = 1.0;

  // CPU-side cache of tessellated positions for getPositionAt() lookups.
  // Stored as a flat Float32Array of XYZ triples, matching the GPU vertex buffer.
  private cachedPositions: Float32Array | null = null;

  // Per-piece vertex ranges: [startVertex, vertexCount] for each piece.
  // Used to build thick-line highlight instances for selected pieces.
  private pieceVertexRanges: { start: number; count: number }[] = [];

  // Thick-line highlight (cylinder rendering for selected pieces)
  private highlightPieces: Set<number> = new Set();
  private thickPipeline: GPURenderPipeline | null = null;
  private thickUniformBuffer: GPUBuffer | null = null;
  private thickBindGroup: GPUBindGroup | null = null;
  private thickInstanceBuffer: GPUBuffer | null = null;
  private thickInstanceCount: number = 0;
  private highlightThickness: number = 0.4; // mm

  // Volumetric segments: instanced camera-facing quads for thick line rendering.
  // Reuses the same position/color/segIndex vertex buffers as the line pipeline.
  // Each instance = one line segment (pair of consecutive vertices) → 6 verts (2 tris).
  private volPipeline: GPURenderPipeline | null = null;
  private volUniformBuffer: GPUBuffer | null = null;
  private volInstanceBuffer: GPUBuffer | null = null;
  private volInstanceCount: number = 0;
  private volWssBindGroup: GPUBindGroup | null = null;

  // Per-piece feed rates (mm/min), set externally for feedRate color attribute
  private pieceFeedRates: Float32Array | null = null;
  private maxFeedRate: number = 0;

  // Per-piece spindle RPM, set externally for spindleRpm color attribute
  private pieceSpindleRpm: Float32Array | null = null;
  private maxSpindleRpm: number = 0;

  // Per-piece tool numbers, set externally for toolNumber color attribute
  private pieceToolNumbers: Float32Array | null = null;
  private maxToolNumber: number = 0;

  // Per-piece coolant states (0=off, 1=mist, 2=flood, 3=mist+flood)
  private pieceCoolantStates: Float32Array | null = null;

  // Per-piece feature type indices for slicer feature type coloring
  private pieceFeatureTypes: Float32Array | null = null;
  private maxFeatureType: number = 0;

  // Analytical WSS (group 3) — arcs evaluated in closed form in the shader.
  private wssArcBuffer: GPUBuffer | null = null;
  private wssBindGroup: GPUBindGroup | null = null;
  private wssData: WssGpuData | null = null;
  private hasWss: boolean = false;

  // Resources destroyed during data updates are queued here and flushed at the
  // start of render().  This avoids "used in submit while destroyed" warnings
  // when the current render pass still references the old resources.
  private staleResources: (GPUBuffer | GPUTexture)[] = [];

  // ReNURBS storage buffers (group 1) — for GPU-side velocity/accel/jerk evaluation
  private renurbsCpBuffer: GPUBuffer | null = null;       // all control points (f32)
  private renurbsKnotBuffer: GPUBuffer | null = null;      // all knots (f32)
  private renurbsMetaBuffer: GPUBuffer | null = null;      // quantity metadata (u32)
  private renurbsBindGroup: GPUBindGroup | null = null;     // group 1 bind group
  private renurbsData: TRNPData | null = null;
  private hasReNurbs: boolean = false;

  // PA analytical parameter buffers (group 2) — for GPU-side PA evaluation
  // All PA storage data (moments, opVelocities, qGrid, tempGrid, pValues) is
  // packed into a single buffer to stay within maxStorageBuffersPerShaderStage.
  private paParamBuffer: GPUBuffer | null = null;
  private paExtrusionRatioBuffer: GPUBuffer | null = null;
  private paDataBuffer: GPUBuffer | null = null;
  private paBindGroup: GPUBindGroup | null = null;
  private hasPaData: boolean = false;
  private paMaxOffset: number = 1.0;
  private paMaxVelocity: number = 1.0;

  // Dummy buffer minimum sizes for group 1/2 bind groups when real data is absent.
  // The meta buffer must be at least 16 u32s = 64 bytes so the shader can read
  // metadata for a few segments/quantities without out-of-bounds access.
  private static readonly DUMMY_CP_SIZE = 4;
  private static readonly DUMMY_KNOT_SIZE = 4;
  private static readonly DUMMY_META_SIZE = 64;

  // Per-vertex segment index + normalized arc length (for ReNURBS shader evaluation)
  private segIndexUBuffer: GPUBuffer | null = null;

  options: NurbsRenderOptions = {
    colorMap: new ColorMap('viridis'),
    colorAttribute: 'velocity',
    lineWidth: 2.0,
    visible: true,
    showTravels: true,
    highlightRetractions: false,
    highlightOverhangs: false,
    zSeamVisible: false,
    highlightBridges: false,
    highlightSupport: false,
    volumetricSegments: true,  // default: thick segments
  };

  constructor(private device: GPUDevice) {}

  /** Queue a GPU resource for destruction at the next render() boundary. */
  private deferDestroy(resource: GPUBuffer | GPUTexture | null): void {
    if (resource) this.staleResources.push(resource);
  }

  /** Destroy any resources that were replaced during data updates.
   *  We wait until all work submitted before this point has finished so we
   *  do not destroy a resource that is still referenced by a pending frame.
   */
  private flushStaleResources(): void {
    const stale = this.staleResources;
    this.staleResources = [];
    if (stale.length === 0) return;
    this.device.queue.onSubmittedWorkDone().then(() => {
      for (const r of stale) r.destroy();
    });
  }

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          progress: f32,
          colorMode: u32,     // 0=cpuColorValue, 1=velocity, 2=accel, 3=jerk, 4=time
          maxValue: f32,      // for normalization
          useWss: u32,        // 1 if WSS data is available, 0 otherwise
          totalLength: f32,   // total path arc length (for s = localU * totalLength)
          wssArcCount: u32,   // number of WSS arcs
          _pad0: u32,
          // Kinematic limits for WALL arc evaluation
          feedRate: f32,
          maxPathVelocity: f32,
          maxCentripetalAccel: f32,
          maxAxisVelX: f32,
          maxAxisVelY: f32,
          maxAxisVelZ: f32,
          _pad1: f32,
          _pad2: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var colorLUT: texture_1d<f32>;
        @group(0) @binding(2) var colorSampler: sampler;

        // ReNURBS storage buffers (group 1)
        @group(1) @binding(0) var<storage, read> renurbsCPs: array<f32>;
        @group(1) @binding(1) var<storage, read> renurbsKnots: array<f32>;
        @group(1) @binding(2) var<storage, read> renurbsMeta: array<u32>;

        // PA analytical parameters (group 2) — replaces old NURBS PA buffers.
        // The frontend evaluates PA in closed form using WSS arcs (group 3) +
        // extrusion ratios + these parameters.
        // All PA storage data (moments, opVelocities, qGrid, tempGrid, pValues)
        // is packed into a single storage buffer to stay within the
        // maxStorageBuffersPerShaderStage limit (8).
        struct PaParams {
          maxCompensation: f32,
          smoothTime: f32,
          filamentDiameter: f32,
          pressureAdvance: f32,     // Linear
          powerLawBaseGain: f32,    // PowerLaw
          flowIndex: f32,           // PowerLaw
          crossWlfCompressibility: f32, // CrossWLF
          meltTempC: f32,           // CrossWLF
          groupDelay: f32,          // LTI/LPV
          algorithmId: u32,
          qGridCount: u32,
          tempGridCount: u32,
          momentCount: u32,         // total floats in paData for moments
          opPointCount: u32,
          momentsOffset: u32,       // offset into paData for moments
          opVelOffset: u32,         // offset into paData for op velocities
          qGridOffset: u32,         // offset into paData for qGrid
          tempGridOffset: u32,      // offset into paData for tempGrid
          pValuesOffset: u32,       // offset into paData for pValues
          _pad0: u32,
          _pad1: u32,
        };
        @group(2) @binding(0) var<uniform> paParams: PaParams;
        @group(2) @binding(1) var<storage, read> paExtrusionRatios: array<f32>;
        @group(2) @binding(2) var<storage, read> paData: array<f32>;

        // Analytical WSS arcs (group 3) — each arc is 12 floats (48 bytes):
        //   [s0, s1, t0, v0, a0, eta, a_star, duration, type, 0, 0, 0]
        @group(3) @binding(0) var<storage, read> wssArcs: array<f32>;

        const MAX_CP: u32 = 64u;

        /// Evaluate a 1-D B-spline (weights=1) at parameter u using De Boor's algorithm.
        fn evalBSpline1D(cpBase: u32, cpCount: u32, knotBase: u32, degree: u32, u: f32) -> f32 {
          if (cpCount == 0u) { return 0.0; }
          if (degree == 0u) { return renurbsCPs[cpBase]; }

          let knotMin = renurbsKnots[knotBase + degree];
          let knotMax = renurbsKnots[knotBase + cpCount];
          let uClamped = clamp(u, knotMin, knotMax);

          var k = degree;
          for (var i = degree; i < cpCount; i = i + 1u) {
            if (renurbsKnots[knotBase + i] <= uClamped && uClamped < renurbsKnots[knotBase + i + 1u]) {
              k = i;
              break;
            }
          }
          if (uClamped >= knotMax) { k = cpCount - 1u; }

          var d: array<f32, 64>;
          for (var j = 0u; j <= degree; j = j + 1u) {
            d[j] = renurbsCPs[cpBase + k - degree + j];
          }

          for (var r = 1u; r <= degree; r = r + 1u) {
            for (var j = degree; j >= r; j = j - 1u) {
              let i = k - degree + j;
              let kn0 = renurbsKnots[knotBase + i];
              let b = renurbsKnots[knotBase + j + degree - r + 1u] - kn0;
              let alpha = select(0.0, (uClamped - kn0) / b, b != 0.0);
              d[j] = (1.0 - alpha) * d[j - 1u] + alpha * d[j];
            }
          }

          return d[degree];
        }

        // ── Analytical PA evaluation ───────────────────────────────────────

        /// Evaluate extruder velocity at arc-length s.
        /// Uses the WSS arc + per-arc extrusion ratio.
        fn evalExtruderVelocity(s: f32) -> f32 {
          if (uniforms.wssArcCount == 0u) { return 0.0; }
          let idx = findWssArc(s);
          let arc = readWssArc(idx);
          let arcS0 = arc[0];
          let arcT0 = arc[2];
          let arcV0 = arc[3];
          let arcA0 = arc[4];
          let arcEta = arc[5];
          let arcAStar = arc[6];
          let arcType = arc[8];
          let dsLocal = max(s - arcS0, 0.0);

          var vPath: f32 = 0.0;
          if (arcType < 2.5) {
            let tau = bangTauForDs(arcV0, arcA0, arcEta, dsLocal);
            vPath = arcV0 + arcA0 * tau + 0.5 * arcEta * tau * tau;
          } else if (arcType < 3.5) {
            let tau = singularTauForDs(arcV0, arcAStar, dsLocal);
            vPath = arcV0 + arcAStar * tau;
          } else {
            vPath = arcV0;
          }

          let ratio = paExtrusionRatios[idx];
          return vPath * ratio;
        }

        /// Bilinear interpolation of the CrossWLF pressure LUT.
        /// All LUT data is packed into paData at offsets given by paParams.
        fn bilinearInterpLut(q: f32, temp: f32) -> f32 {
          let qCount = paParams.qGridCount;
          let tCount = paParams.tempGridCount;
          if (qCount == 0u || tCount == 0u) { return 0.0; }

          let qOff = paParams.qGridOffset;
          let tOff = paParams.tempGridOffset;
          let pOff = paParams.pValuesOffset;

          var qIdx: u32 = 0u;
          for (var i: u32 = 0u; i < qCount; i = i + 1u) {
            if (paData[qOff + i] <= q) { qIdx = i; } else { break; }
          }
          qIdx = min(qIdx, qCount - 1u);
          let qIdxHi = min(qIdx + 1u, qCount - 1u);
          let qFrac = select(0.0,
                             (q - paData[qOff + qIdx]) / (paData[qOff + qIdxHi] - paData[qOff + qIdx]),
                             qIdxHi > qIdx);

          var tIdx: u32 = 0u;
          for (var i: u32 = 0u; i < tCount; i = i + 1u) {
            if (paData[tOff + i] <= temp) { tIdx = i; } else { break; }
          }
          tIdx = min(tIdx, tCount - 1u);
          let tIdxHi = min(tIdx + 1u, tCount - 1u);
          let tFrac = select(0.0,
                             (temp - paData[tOff + tIdx]) / (paData[tOff + tIdxHi] - paData[tOff + tIdx]),
                             tIdxHi > tIdx);

          let p00 = paData[pOff + tIdx * qCount + qIdx];
          let p10 = paData[pOff + tIdx * qCount + qIdxHi];
          let p01 = paData[pOff + tIdxHi * qCount + qIdx];
          let p11 = paData[pOff + tIdxHi * qCount + qIdxHi];
          let p0 = mix(p00, p10, qFrac);
          let p1 = mix(p01, p11, qFrac);
          return mix(p0, p1, tFrac);
        }

        /// Evaluate PA offset at arc-length s.
        fn evalPaOffset(s: f32) -> f32 {
          let vExt = evalExtruderVelocity(s);
          let algo = paParams.algorithmId;

          var offset: f32 = 0.0;

          if (algo == 0u) {
            // Linear: offset = PA * v_extruder
            offset = paParams.pressureAdvance * vExt;
          } else if (algo == 1u) {
            // PowerLaw: offset = baseGain * v^flowIndex
            if (vExt > 0.0) {
              offset = paParams.powerLawBaseGain * pow(max(vExt, 0.001), paParams.flowIndex);
            }
          } else if (algo == 2u) {
            // CrossWLF: offset = compressibility * P(Q, T) * area
            let filamentArea = 3.14159265 * (paParams.filamentDiameter * 0.5) * (paParams.filamentDiameter * 0.5);
            let Q = vExt * filamentArea;
            let P = bilinearInterpLut(Q, paParams.meltTempC);
            offset = paParams.crossWlfCompressibility * P * filamentArea;
          } else if (algo == 3u) {
            // LTI Deconv: offset ≈ v_extruder * M_0 (first-order)
            if (paParams.momentCount > 0u) {
              offset = vExt * paData[paParams.momentsOffset];
            }
          } else if (algo == 4u) {
            // LPV Deconv: interpolate moments by velocity
            if (paParams.opPointCount > 0u && paParams.momentCount > 0u) {
              var opIdx: u32 = 0u;
              let opOff = paParams.opVelOffset;
              for (var i: u32 = 0u; i < paParams.opPointCount; i = i + 1u) {
                if (paData[opOff + i] <= vExt) { opIdx = i; } else { break; }
              }
              opIdx = min(opIdx, paParams.opPointCount - 1u);
              let mc = paParams.momentCount / max(paParams.opPointCount, 1u);
              offset = vExt * paData[paParams.momentsOffset + opIdx * mc];
            }
          }

          let maxComp = paParams.maxCompensation;
          return clamp(offset, -maxComp, maxComp);
        }

        // ── WSS analytical evaluation ──────────────────────────────────────

        /// Read a WSS arc by index. Returns 12 floats packed as 3 vec4s.
        fn readWssArc(idx: u32) -> array<f32, 12> {
          let base = idx * 12u;
          var a: array<f32, 12>;
          for (var i = 0u; i < 12u; i = i + 1u) {
            a[i] = wssArcs[base + i];
          }
          return a;
        }

        /// Binary search for the WSS arc containing arc-length s.
        /// Returns the arc index. Arcs are sorted by s0.
        fn findWssArc(s: f32) -> u32 {
          let n = uniforms.wssArcCount;
          if (n == 0u) { return 0u; }
          var lo: u32 = 0u;
          var hi: u32 = n;
          while (lo < hi) {
            let mid = (lo + hi) / 2u;
            let arcS1 = wssArcs[mid * 12u + 1u];
            if (arcS1 < s) {
              lo = mid + 1u;
            } else {
              hi = mid;
            }
          }
          return min(lo, n - 1u);
        }

        /// Solve for τ in a BANG arc given Δs.
        /// Cubic: (η/6)τ³ + (a0/2)τ² + v0·τ − ds = 0
        /// Newton's method with constant-velocity initial guess.
        fn bangTauForDs(v0: f32, a0: f32, eta: f32, ds: f32) -> f32 {
          if (ds <= 0.0) { return 0.0; }
          var tau = ds / max(v0, 1e-6);
          for (var iter = 0; iter < 12; iter = iter + 1) {
            let f = v0 * tau + 0.5 * a0 * tau * tau
                  + (1.0 / 6.0) * eta * tau * tau * tau - ds;
            let fp = v0 + a0 * tau + 0.5 * eta * tau * tau;
            if (abs(fp) < 1e-15) { break; }
            let dtau = f / fp;
            tau = tau - dtau;
            if (abs(dtau) < 1e-10) { break; }
          }
          return max(tau, 0.0);
        }

        /// Solve for τ in a SINGULAR arc given Δs.
        /// Quadratic: v0·τ + ½·a*·τ² = ds
        fn singularTauForDs(v0: f32, aStar: f32, ds: f32) -> f32 {
          if (ds <= 0.0) { return 0.0; }
          if (abs(aStar) < 1e-14) { return ds / max(v0, 1e-6); }
          let disc = v0 * v0 + 2.0 * aStar * ds;
          return (-v0 + sqrt(max(disc, 0.0))) / aStar;
        }

        /// Evaluate the WSS at arc-length s.
        /// Returns vec4(time, velocity, acceleration, jerk).
        /// For WALL arcs, v_wall is computed from the vertex curvature
        /// (passed as the curvature parameter) and kinematic limits.
        fn evalWssAtS(s: f32, curvature: f32) -> vec4<f32> {
          if (uniforms.wssArcCount == 0u) {
            return vec4<f32>(0.0, 0.0, 0.0, 0.0);
          }

          let idx = findWssArc(s);
          let arc = readWssArc(idx);
          let arcS0 = arc[0];
          let arcT0 = arc[2];
          let arcV0 = arc[3];
          let arcA0 = arc[4];
          let arcEta = arc[5];
          let arcAStar = arc[6];
          let arcDuration = arc[7];
          let arcType = arc[8];

          let dsLocal = max(s - arcS0, 0.0);

          if (arcType < 2.5) {
            // BANG_PLUS (0) or BANG_MINUS (1)
            let tau = bangTauForDs(arcV0, arcA0, arcEta, dsLocal);
            let a = arcA0 + arcEta * tau;
            let v = arcV0 + arcA0 * tau + 0.5 * arcEta * tau * tau;
            let j = arcEta;
            let t = arcT0 + tau;
            return vec4<f32>(t, v, a, j);
          } else if (arcType < 3.5) {
            // SINGULAR (2)
            let tau = singularTauForDs(arcV0, arcAStar, dsLocal);
            let v = arcV0 + arcAStar * tau;
            let a = arcAStar;
            let j = 0.0;
            let t = arcT0 + tau;
            return vec4<f32>(t, v, a, j);
          } else {
            // WALL (3): v = arc.v0 (Pareto planner already computed the
            // correct wall velocity from per-segment feed rates + curvature).
            // Do NOT re-evaluate from global feedRate — that ignores
            // per-segment feed rate limits and causes velocity spikes.
            let vCurv = select(arcV0,
                               sqrt(uniforms.maxCentripetalAccel / max(curvature, 1e-10)),
                               curvature > 1e-8);
            let v = min(arcV0, vCurv);
            // WALL arcs have a ≈ 0, j = 0
            // Time is approximated as t0 + dsLocal / v
            let tau = select(arcDuration, dsLocal / max(v, 1e-6), v > 1e-6);
            let t = arcT0 + tau;
            return vec4<f32>(t, v, 0.0, 0.0);
          }
        }

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) colorValue: f32,
          @location(2) sampleIdx: f32,
          @location(3) segIndexUC: vec3<f32>,  // x=segmentIndex, y=normalized arc length, z=curvature
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) colorValue: f32,
          @location(1) dimmed: f32,
          @location(2) localU: f32,
          @location(3) segIndexX: f32,
          @location(4) curvature: f32,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);

          output.colorValue = input.colorValue;
          output.localU = input.segIndexUC.y;
          output.segIndexX = input.segIndexUC.x;
          output.curvature = input.segIndexUC.z;

          let cutoff = uniforms.progress * f32(1000000.0);
          if (input.sampleIdx > cutoff) {
            output.dimmed = 1.0;
          } else {
            output.dimmed = 0.0;
          }
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          var cv = input.colorValue;

          if (uniforms.colorMode > 0u && uniforms.colorMode <= 4u) {
            var val: f32 = 0.0;
            if (uniforms.useWss != 0u) {
              // Analytical WSS evaluation: compute s from normalized arc length,
              // then evaluate the WSS arc in closed form.
              let s = input.localU * uniforms.totalLength;
              let state = evalWssAtS(s, input.curvature);
              switch (uniforms.colorMode) {
                case 1u: { val = state.y; }        // velocity
                case 2u: { val = abs(state.z); }   // acceleration
                case 3u: { val = abs(state.w); }   // jerk
                case 4u: { val = state.x; }        // time
                default: { val = 0.0; }
              }
            } else {
              // Fallback: ReNURBS B-spline evaluation (legacy path)
              let segIdx = u32(input.segIndexX);
              let qtyIdx = uniforms.colorMode - 1u;
              let metaBase = segIdx * 4u * 4u + qtyIdx * 4u;
              let cpOffset = renurbsMeta[metaBase + 0u];
              let cpCount = renurbsMeta[metaBase + 1u];
              let knotOffset = renurbsMeta[metaBase + 2u];
              let degree = renurbsMeta[metaBase + 3u];
              val = evalBSpline1D(cpOffset, cpCount, knotOffset, degree, input.localU);
            }
            cv = select(0.0, val / uniforms.maxValue, uniforms.maxValue > 0.0);
          }

          // PA color modes: 5=pressureAdvanceOffset, 6=pressureAdvanceVelocity
          // Analytical evaluation using WSS arcs + extrusion ratios + PA params
          if (uniforms.colorMode >= 5u && uniforms.colorMode <= 6u) {
            let s = input.localU * uniforms.totalLength;
            var val: f32 = 0.0;
            if (uniforms.colorMode == 5u) {
              val = evalPaOffset(s);
            } else {
              val = evalExtruderVelocity(s);
            }
            cv = select(0.0, val / uniforms.maxValue, uniforms.maxValue > 0.0);
          }

          let sampled = textureSample(colorLUT, colorSampler, cv);
          let retractionColor = vec3<f32>(1.0, 0.2, 0.1);
          let baseColor = mix(sampled.rgb, retractionColor,
                              select(0.0, 1.0, input.colorValue < 0.0));
          let finalColor = baseColor * (1.0 - input.dimmed * 0.8);
          return vec4<f32>(finalColor, 1.0);
        }
      `,
    });

    // Color LUT texture (1D, RGBA — shader declares texture_1d<f32>)
    this.colorLUTTexture = this.device.createTexture({
      size: [256],
      dimension: '1d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
          {
            arrayStride: 4,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32' }],
          },
          {
            arrayStride: 4,
            attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }],
          },
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.uniformBuffer',
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group 0 once during init (not lazily during render)
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.colorLUTTexture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });

    // Create dummy ReNURBS storage buffers (1 byte each, will be replaced
    // when updateReNurbsData is called). These are needed because the
    // pipeline layout requires group 1 bindings.
    this.createDummyReNurbsBuffers();

    // Create dummy PA storage buffers for group 2. The pipeline auto layout
    // always contains group 2 because the shader declares @group(2), so a
    // bind group must always be available at render time even when no PA data
    // has been loaded yet.
    this.createDummyPaBuffers();

    // Create dummy WSS arc buffer for group 3.
    this.createDummyWssBuffer();

    // ── Thick-line cylinder pipeline for highlighted pieces ──
    const thickShader = this.device.createShaderModule({
      code: `
        struct ThickUniforms {
          viewProj: mat4x4<f32>,
          cameraEye: vec3<f32>,
          thickness: f32,
        };
        @group(0) @binding(0) var<uniform> u: ThickUniforms;
        @group(0) @binding(1) var<storage, read> instances: array<vec4<f32>>;

        struct VertexOutput {
          @builtin(position) clipPos: vec4<f32>,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOutput {
          let cornerId = vi % 6u;
          let d0 = instances[ii * 2u];
          let d1 = instances[ii * 2u + 1u];
          let p0 = d0.xyz;
          let p1 = vec3<f32>(d0.w, d1.x, d1.y);

          let dir = normalize(p1 - p0 + vec3<f32>(0.0001, 0.0001, 0.0001));
          let toCam = normalize(u.cameraEye - p0);
          let perp = normalize(cross(dir, toCam));
          let halfThick = u.thickness * 0.5;

          var pos: vec3<f32>;
          switch (cornerId) {
            case 0u: { pos = p0 - perp * halfThick; }
            case 1u: { pos = p0 + perp * halfThick; }
            case 2u: { pos = p1 - perp * halfThick; }
            case 3u: { pos = p0 + perp * halfThick; }
            case 4u: { pos = p1 + perp * halfThick; }
            case 5u: { pos = p1 - perp * halfThick; }
            default: { pos = p0; }
          }

          let nudge = normalize(u.cameraEye - pos) * 0.01;
          pos = pos + nudge;

          var output: VertexOutput;
          output.clipPos = u.viewProj * vec4<f32>(pos, 1.0);
          return output;
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(1.0, 0.95, 0.3, 1.0);
        }
      `,
    });

    this.thickPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: thickShader, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: thickShader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less-equal',
        depthWriteEnabled: true,
      },
    });

    this.thickUniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Dummy instance buffer (replaced when setHighlightPieces is called)
    this.thickInstanceBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.thickBindGroup = this.device.createBindGroup({
      layout: this.thickPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.thickUniformBuffer } },
        { binding: 1, resource: { buffer: this.thickInstanceBuffer } },
      ],
    });

    // ── Volumetric segments pipeline ──
    // Renders every line segment as a camera-facing quad (billboard).
    // Uses instancing: 6 vertices per instance (2 triangles), one instance
    // per line segment. The instance buffer stores the two endpoint indices
    // into the shared position/color/segIndex vertex buffers.
    //
    // The fragment shader evaluates WSS velocity/acceleration/jerk in closed
    // form (same as the line pipeline) so coloring is identical.
    //
    // Thickness is in pixels (screen-space), converted to world-space using
    // the camera distance so it appears constant on screen.
    const volShader = this.device.createShaderModule({
      code: `
        struct VolUniforms {
          viewProj: mat4x4<f32>,    // 64 bytes
          progress: f32,            // 4   (offset 64)
          colorMode: u32,           // 4   (offset 68)
          maxValue: f32,            // 4   (offset 72)
          useWss: u32,              // 4   (offset 76)
          totalLength: f32,         // 4   (offset 80)
          wssArcCount: u32,         // 4   (offset 84)
          _pad0: u32,               // 4   (offset 88)
          feedRate: f32,            // 4   (offset 92)
          maxPathVelocity: f32,     // 4   (offset 96)
          maxCentripetalAccel: f32, // 4   (offset 100)
          maxAxisVelX: f32,         // 4   (offset 104)
          maxAxisVelY: f32,         // 4   (offset 108)
          maxAxisVelZ: f32,         // 4   (offset 112)
          cameraEyeX: f32,          // 4   (offset 116)
          cameraEyeY: f32,          // 4   (offset 120)
          cameraEyeZ: f32,          // 4   (offset 124)
          thickness: f32,           // 4   (offset 128)
          viewportHeight: f32,      // 4   (offset 132)
        };
        @group(0) @binding(0) var<uniform> u: VolUniforms;
        @group(0) @binding(1) var<storage, read> segIndices: array<vec2<u32>>;
        @group(0) @binding(2) var<storage, read> positions: array<f32>;
        @group(0) @binding(3) var<storage, read> colors: array<f32>;
        @group(0) @binding(4) var<storage, read> segIndexU: array<f32>;
        @group(0) @binding(5) var<storage, read> sampleIndices: array<f32>;

        @group(1) @binding(0) var<storage, read> wssArcs: array<f32>;
        @group(2) @binding(0) var colorLUT: texture_1d<f32>;
        @group(2) @binding(1) var colorSampler: sampler;

        fn readWssArc(idx: u32) -> array<f32, 12> {
          let base = idx * 12u;
          var a: array<f32, 12>;
          for (var i = 0u; i < 12u; i = i + 1u) { a[i] = wssArcs[base + i]; }
          return a;
        }

        fn findWssArc(s: f32) -> u32 {
          let n = u.wssArcCount;
          if (n == 0u) { return 0u; }
          var lo: u32 = 0u;
          var hi: u32 = n;
          while (lo < hi) {
            let mid = (lo + hi) / 2u;
            let arcS1 = wssArcs[mid * 12u + 1u];
            if (arcS1 < s) { lo = mid + 1u; } else { hi = mid; }
          }
          return min(lo, n - 1u);
        }

        fn bangTauForDs(v0: f32, a0: f32, eta: f32, ds: f32) -> f32 {
          if (ds <= 0.0) { return 0.0; }
          var tau = ds / max(v0, 1e-6);
          for (var iter = 0u; iter < 12u; iter = iter + 1u) {
            let f = v0 * tau + 0.5 * a0 * tau * tau + (1.0/6.0) * eta * tau * tau * tau - ds;
            let fp = v0 + a0 * tau + 0.5 * eta * tau * tau;
            if (abs(fp) < 1e-15) { break; }
            let dtau = f / fp;
            tau = tau - dtau;
            if (abs(dtau) < 1e-10) { break; }
          }
          return max(tau, 0.0);
        }

        fn singularTauForDs(v0: f32, aStar: f32, ds: f32) -> f32 {
          if (ds <= 0.0) { return 0.0; }
          if (abs(aStar) < 1e-14) { return ds / max(v0, 1e-6); }
          let disc = v0 * v0 + 2.0 * aStar * ds;
          return (-v0 + sqrt(max(disc, 0.0))) / aStar;
        }

        fn evalWssAtS(s: f32, curvature: f32) -> vec4<f32> {
          if (u.wssArcCount == 0u) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
          let idx = findWssArc(s);
          let arc = readWssArc(idx);
          let arcS0 = arc[0]; let arcT0 = arc[2]; let arcV0 = arc[3];
          let arcA0 = arc[4]; let arcEta = arc[5]; let arcAStar = arc[6];
          let arcDuration = arc[7]; let arcType = arc[8];
          let dsLocal = max(s - arcS0, 0.0);
          if (arcType < 2.5) {
            let tau = bangTauForDs(arcV0, arcA0, arcEta, dsLocal);
            let a = arcA0 + arcEta * tau;
            let v = arcV0 + arcA0 * tau + 0.5 * arcEta * tau * tau;
            return vec4<f32>(arcT0 + tau, v, a, arcEta);
          } else if (arcType < 3.5) {
            let tau = singularTauForDs(arcV0, arcAStar, dsLocal);
            let v = arcV0 + arcAStar * tau;
            return vec4<f32>(arcT0 + tau, v, arcAStar, 0.0);
          } else {
            let vCurv = select(arcV0, sqrt(u.maxCentripetalAccel / max(curvature, 1e-10)), curvature > 1e-8);
            let v = min(arcV0, vCurv);
            let tau = select(arcDuration, dsLocal / max(v, 1e-6), v > 1e-6);
            return vec4<f32>(arcT0 + tau, v, 0.0, 0.0);
          }
        }

        struct VertexOutput {
          @builtin(position) clipPos: vec4<f32>,
          @location(0) colorValue: f32,
          @location(1) dimmed: f32,
          @location(2) localU: f32,
          @location(3) segIndexX: f32,
          @location(4) curvature: f32,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOutput {
          let cornerId = vi % 6u;
          let idxs = segIndices[ii];
          let i0 = idxs.x;
          let i1 = idxs.y;

          let p0 = vec3<f32>(positions[i0 * 3u], positions[i0 * 3u + 1u], positions[i0 * 3u + 2u]);
          let p1 = vec3<f32>(positions[i1 * 3u], positions[i1 * 3u + 1u], positions[i1 * 3u + 2u]);

          // Transform both endpoints to clip space.
          let clip0 = u.viewProj * vec4<f32>(p0, 1.0);
          let clip1 = u.viewProj * vec4<f32>(p1, 1.0);

          // Convert to NDC (perspective divide).
          let ndc0 = clip0.xy / clip0.w;
          let ndc1 = clip1.xy / clip1.w;

          // Screen-space segment direction and perpendicular (rotate 90°).
          let screenDir = ndc1 - ndc0;
          let screenLen = length(screenDir);
          // Perpendicular in NDC: rotate 90°. Normalize to unit length.
          let screenPerp = vec2<f32>(-screenDir.y, screenDir.x) / max(screenLen, 1e-6);

          // Half-thickness in NDC: convert pixel width to NDC.
          // NDC range is [-1, 1] = 2 units = viewportHeight pixels.
          let halfThickNdc = u.thickness / max(u.viewportHeight, 1.0);

          // Offset each corner perpendicular to the segment in screen space.
          let offset = screenPerp * halfThickNdc;

          // Pick the endpoint for this corner.
          // Corners 0,1,3 → p0;  2,4,5 → p1.
          let useP1 = (cornerId == 2u || cornerId == 4u || cornerId == 5u);
          let baseNdc = select(ndc0, ndc1, useP1);
          let baseClip = select(clip0, clip1, useP1);

          // Apply perpendicular offset: +offset or -offset depending on corner.
          var side: f32;
          switch (cornerId) {
            case 0u: { side = -1.0; }
            case 1u: { side =  1.0; }
            case 2u: { side = -1.0; }
            case 3u: { side =  1.0; }
            case 4u: { side =  1.0; }
            case 5u: { side = -1.0; }
            default: { side = 0.0; }
          }
          let ndcPos = baseNdc + offset * side;

          // Reconstruct clip-space position: keep depth and w from the
          // endpoint, apply the NDC offset scaled by w.
          // Add a tiny per-instance depth bias to prevent Z-fighting between
          // overlapping billboards at the same Z height (common in 3D printing
          // where all segments in a layer share the same Z).
          var output: VertexOutput;
          let depthBias = f32(ii % 4096u) * 1e-7 * baseClip.w;
          output.clipPos = vec4<f32>(ndcPos * baseClip.w, baseClip.z - depthBias, baseClip.w);

          // Per-vertex attributes from the endpoint.
          let vIdx = select(i0, i1, useP1);
          output.colorValue = colors[vIdx];
          output.localU = segIndexU[vIdx * 3u + 1u];
          output.segIndexX = segIndexU[vIdx * 3u];
          output.curvature = segIndexU[vIdx * 3u + 2u];

          // Progress cutoff: dim segments past the progress point.
          let sampleIdx = sampleIndices[vIdx];
          let cutoff = u.progress * 1000000.0;
          output.dimmed = select(0.0, 1.0, sampleIdx > cutoff);

          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          var cv = input.colorValue;

          if (u.colorMode > 0u && u.colorMode <= 4u) {
            var val: f32 = 0.0;
            if (u.useWss != 0u) {
              let s = input.localU * u.totalLength;
              let state = evalWssAtS(s, input.curvature);
              switch (u.colorMode) {
                case 1u: { val = state.y; }
                case 2u: { val = abs(state.z); }
                case 3u: { val = abs(state.w); }
                case 4u: { val = state.x; }
                default: { val = 0.0; }
              }
            }
            cv = select(0.0, val / u.maxValue, u.maxValue > 0.0);
          }

          let sampled = textureSample(colorLUT, colorSampler, cv);
          let retractionColor = vec3<f32>(1.0, 0.2, 0.1);
          let baseColor = mix(sampled.rgb, retractionColor,
                              select(0.0, 1.0, input.colorValue < 0.0));
          let finalColor = baseColor * (1.0 - input.dimmed * 0.8);
          return vec4<f32>(finalColor, 1.0);
        }
      `,
    });

    this.volPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: volShader, entryPoint: 'vs_main', buffers: [] },
      fragment: { module: volShader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    // Volumetric uniforms buffer (144 bytes — viewProj + scalars + cameraEye + thickness + viewportHeight).
    this.volUniformBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.volUniformBuffer',
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Dummy instance buffer (replaced in updateData)
    this.volInstanceBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.volInstanceBuffer',
      size: 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Create minimal dummy ReNURBS buffers so the pipeline can be bound
   * even before real ReNURBS data is loaded.
   */
  private createDummyReNurbsBuffers(): void {
    const dummyCp = new Float32Array(1);
    const dummyKnot = new Float32Array(1);
    const dummyMeta = new Uint32Array(16);  // 4 quantities × 4 values

    this.renurbsCpBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.renurbsCpBuffer',
      size: NurbsRenderer.DUMMY_CP_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.renurbsCpBuffer, 0, dummyCp);

    this.renurbsKnotBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.renurbsKnotBuffer',
      size: NurbsRenderer.DUMMY_KNOT_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.renurbsKnotBuffer, 0, dummyKnot);

    this.renurbsMetaBuffer = this.device.createBuffer({
      size: NurbsRenderer.DUMMY_META_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.renurbsMetaBuffer, 0, dummyMeta);

    this.renurbsBindGroup = this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.renurbsCpBuffer } },
        { binding: 1, resource: { buffer: this.renurbsKnotBuffer } },
        { binding: 2, resource: { buffer: this.renurbsMetaBuffer } },
      ],
    });
  }

  /**
   * Create minimal dummy PA buffers for group 2. The pipeline auto layout
   * always exposes group 2 because the shader declares @group(2), so we must
   * always have a bind group bound for it even before real PA data arrives.
   */
  private createDummyPaBuffers(): void {
    // PaParams uniform (22 floats/u32s = 88 bytes, round to 96)
    this.paParamBuffer = this.device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paParamBuffer, 0, new Uint8Array(96));

    // Dummy extrusion ratios buffer
    const dummy4 = new Float32Array([0, 0, 0, 0]);
    this.paExtrusionRatioBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paExtrusionRatioBuffer, 0, dummy4 as Float32Array<ArrayBuffer>);

    // Dummy packed PA data buffer
    this.paDataBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paDataBuffer, 0, dummy4 as Float32Array<ArrayBuffer>);

    try {
      const paLayout = this.pipeline!.getBindGroupLayout(2);
      this.paBindGroup = this.device.createBindGroup({
        layout: paLayout,
        entries: [
          { binding: 0, resource: { buffer: this.paParamBuffer } },
          { binding: 1, resource: { buffer: this.paExtrusionRatioBuffer } },
          { binding: 2, resource: { buffer: this.paDataBuffer } },
        ],
      });
    } catch {
      this.paBindGroup = null;
    }
    this.hasPaData = false;
  }

  /**
   * Create a minimal 1-float WSS arc buffer for group 3. The pipeline auto
   * layout exposes @group(3), so a bind group must always be available.
   */
  private createDummyWssBuffer(): void {
    const dummySize = 48; // 1 arc × 12 floats × 4 bytes
    this.wssArcBuffer = this.device.createBuffer({
      size: dummySize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.wssArcBuffer, 0, new Float32Array(12));

    try {
      const wssLayout = this.pipeline!.getBindGroupLayout(3);
      this.wssBindGroup = this.device.createBindGroup({
        layout: wssLayout,
        entries: [
          { binding: 0, resource: { buffer: this.wssArcBuffer } },
        ],
      });
    } catch {
      this.wssBindGroup = null;
    }
    // Volumetric pipeline's WSS bind group (group 1, different auto layout)
    try {
      const volWssLayout = this.volPipeline!.getBindGroupLayout(1);
      this.volWssBindGroup = this.device.createBindGroup({
        layout: volWssLayout,
        entries: [
          { binding: 0, resource: { buffer: this.wssArcBuffer } },
        ],
      });
    } catch {
      this.volWssBindGroup = null;
    }
    this.hasWss = false;
    this.wssData = null;
  }

  /**
   * Update the WSS arc storage buffer from parsed TWSF data.
   * The arcs are uploaded as a flat Float32Array for direct shader evaluation.
   */
  updateWss(data: WssGpuData): void {
    if (data.arcBuffer.length === 0 || data.arcs.length === 0) {
      this.createDummyWssBuffer();
      return;
    }

    if (this.wssArcBuffer) {
      this.deferDestroy(this.wssArcBuffer);
      this.wssArcBuffer = null;
    }

    const byteSize = data.arcBuffer.byteLength;
    // WebGPU requires buffer sizes to be multiples of 4
    const paddedSize = Math.ceil(byteSize / 4) * 4;
    this.wssArcBuffer = this.device.createBuffer({
      size: paddedSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.wssArcBuffer, 0, data.arcBuffer as Float32Array<ArrayBuffer>);

    try {
      const wssLayout = this.pipeline!.getBindGroupLayout(3);
      this.wssBindGroup = this.device.createBindGroup({
        layout: wssLayout,
        entries: [
          { binding: 0, resource: { buffer: this.wssArcBuffer } },
        ],
      });
    } catch {
      this.wssBindGroup = null;
    }
    // Volumetric pipeline's WSS bind group (group 1, different auto layout)
    try {
      const volWssLayout = this.volPipeline!.getBindGroupLayout(1);
      this.volWssBindGroup = this.device.createBindGroup({
        layout: volWssLayout,
        entries: [
          { binding: 0, resource: { buffer: this.wssArcBuffer } },
        ],
      });
    } catch {
      this.volWssBindGroup = null;
    }

    this.wssData = data;
    this.hasWss = true;
  }

  /**
   * Update the renderer with NURBS path data.
   * Tessellates each piece on CPU and uploads to GPU.
   * Also computes per-vertex segment index and normalized arc length
   * for ReNURBS shader evaluation.
   */
  updateData(data: NBPData): void {
    const dim = data.header.dim;
    const pieces = data.pieces;
    if (pieces.length === 0) return;

    // Tessellate each piece and build combined vertex/index arrays
    const allPositions: number[] = [];
    const allColors: number[] = [];
    const allSampleIndices: number[] = [];
    const allSegIndexU: number[] = [];  // [segIdx, localU] per vertex
    const allIndices: number[] = [];
    const allVolInstances: number[] = [];  // pairs of vertex indices for volumetric instancing

    // Precompute max extruder speed for normalization
    let maxExtruderSpeed = 0;
    for (const p of pieces) {
      if (p.extruderSpeed > maxExtruderSpeed) maxExtruderSpeed = p.extruderSpeed;
    }

    const totalLength = data.header.totalLength || 0.0;
    let vertexOffset = 0;
    let totalSegments = 0;
    let pieceStartS = 0.0;
    this.pieceVertexRanges = [];

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const pieceStartVertex = vertexOffset;

      // Adaptive tessellation: more segments for higher-degree curves
      // and longer pieces
      const cpCount = piece.controlPoints.length / dim;
      let segments: number;
      if (piece.degree === 1) {
        // Linear — just 1 segment (2 vertices)
        segments = 1;
      } else {
        // Curved — adaptive based on degree and control point count
        segments = Math.max(8, Math.min(64, cpCount * piece.degree * 4));
      }

      const positions = tessellatePiece(piece, dim, segments);

      // Cumulative arc length along this piece (approximate from tessellation).
      const pieceDists = new Float64Array(segments + 1);
      for (let k = 1; k <= segments; k++) {
        const dx = positions[k * 3] - positions[(k - 1) * 3];
        const dy = positions[k * 3 + 1] - positions[(k - 1) * 3 + 1];
        const dz = positions[k * 3 + 2] - positions[(k - 1) * 3 + 2];
        pieceDists[k] = pieceDists[k - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // Feature #1: Skip travel moves (motionType 0) when showTravels is false,
      // but still track their arc length so the global s coordinate stays correct.
      if (!this.options.showTravels && piece.motionType === 0) {
        pieceStartS += pieceDists[segments];
        continue;
      }

      // Color value depends on the selected color attribute
      let colorValue: number;
      switch (this.options.colorAttribute) {
        case 'deviation': {
          // Deviation is 0-100, normalize to 0-1
          colorValue = piece.deviation / 100.0;
          break;
        }
        case 'zHeight': {
          // Color by Z position of the piece's first control point
          // Normalized using the header's Z bounds
          const zMin = data.header.boundsMin[2];
          const zMax = data.header.boundsMax[2];
          const zRange = zMax - zMin > 1e-12 ? zMax - zMin : 1;
          const z = piece.controlPoints.length >= dim ? piece.controlPoints[2] : 0;
          colorValue = (z - zMin) / zRange;
          break;
        }
        case 'extruderSpeed': {
          // Color by extruder speed (mm/s), normalized to 0-1
          colorValue = maxExtruderSpeed > 1e-6 ? piece.extruderSpeed / maxExtruderSpeed : 0;
          break;
        }
        case 'motion': {
          // Map motion type to discrete colors (0=rapid, 1=linear, 2=arcCW, 3=arcCCW)
          colorValue = piece.motionType / 7.0;
          break;
        }
        case 'solid': {
          colorValue = 0.5;
          break;
        }
        case 'feedRate': {
          // Color by feed rate (mm/min), normalized to 0-1
          const fr = this.pieceFeedRates && i < this.pieceFeedRates.length
            ? this.pieceFeedRates[i] : 0;
          colorValue = this.maxFeedRate > 1e-6 ? fr / this.maxFeedRate : 0;
          break;
        }
        case 'spindleRpm': {
          // Color by spindle RPM, normalized to 0-1
          const rpm = this.pieceSpindleRpm && i < this.pieceSpindleRpm.length
            ? this.pieceSpindleRpm[i] : 0;
          colorValue = this.maxSpindleRpm > 1e-6 ? rpm / this.maxSpindleRpm : 0;
          break;
        }
        case 'toolNumber': {
          // Color by tool number, normalized to 0-1
          const tn = this.pieceToolNumbers && i < this.pieceToolNumbers.length
            ? this.pieceToolNumbers[i] : 0;
          colorValue = this.maxToolNumber > 0 ? tn / this.maxToolNumber : 0;
          break;
        }
        case 'coolant': {
          // Color by coolant state: 0=off, 0.33=mist, 0.67=flood, 1=mist+flood
          const cs = this.pieceCoolantStates && i < this.pieceCoolantStates.length
            ? this.pieceCoolantStates[i] : 0;
          colorValue = cs / 3.0;
          break;
        }
        case 'featureType': {
          // Color by slicer feature type index, normalized to 0-1
          const ft = this.pieceFeatureTypes && i < this.pieceFeatureTypes.length
            ? this.pieceFeatureTypes[i] : 0;
          colorValue = this.maxFeatureType > 0 ? ft / this.maxFeatureType : 0;
          break;
        }
        case 'pieceIndex':
        default: {
          // Map piece index to 0..1 across all pieces
          colorValue = pieces.length > 1 ? i / (pieces.length - 1) : 0.5;
          break;
        }
      }

      // Feature #3: Highlight retraction moves (negative extruder speed) in red
      if (this.options.highlightRetractions && piece.extruderSpeed < -0.001) {
        colorValue = -1.0;  // sentinel value → shader renders red
      }

      // Compute per-vertex curvature for WALL arc v_wall(s) evaluation.
      // Uses the Menger curvature formula: κ = 4*Area / (|a||b||c|)
      // where a, b, c are the side lengths of the triangle formed by three
      // consecutive points. For endpoints, use the nearest interior triangle.
      const curvatures = new Float32Array(segments + 1);
      if (segments >= 2) {
        for (let j = 0; j <= segments; j++) {
          const j0 = Math.max(0, j - 1);
          const j1 = j;
          const j2 = Math.min(segments, j + 1);
          const p0x = positions[j0 * 3], p0y = positions[j0 * 3 + 1], p0z = positions[j0 * 3 + 2];
          const p1x = positions[j1 * 3], p1y = positions[j1 * 3 + 1], p1z = positions[j1 * 3 + 2];
          const p2x = positions[j2 * 3], p2y = positions[j2 * 3 + 1], p2z = positions[j2 * 3 + 2];
          // Side lengths
          const a = Math.hypot(p1x - p0x, p1y - p0y, p1z - p0z);
          const b = Math.hypot(p2x - p1x, p2y - p1y, p2z - p1z);
          const c = Math.hypot(p2x - p0x, p2y - p0y, p2z - p0z);
          if (a < 1e-12 || b < 1e-12 || c < 1e-12) {
            curvatures[j] = 0;
          } else {
            // Triangle area via cross product
            const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z;
            const vx = p2x - p0x, vy = p2y - p0y, vz = p2z - p0z;
            const cx = uy * vz - uz * vy;
            const cy = uz * vx - ux * vz;
            const cz = ux * vy - uy * vx;
            const area = 0.5 * Math.hypot(cx, cy, cz);
            curvatures[j] = (4 * area) / (a * b * c);
          }
        }
      }

      for (let j = 0; j <= segments; j++) {
        allPositions.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
        allColors.push(colorValue);
        allSampleIndices.push(vertexOffset + j);
        // Per-vertex: segment index, normalized arc length, curvature.
        // y = global arc length / total path length, used to evaluate the WSS.
        // z = curvature κ (1/mm), used for WALL arc v_wall(s) computation.
        const sNorm = totalLength > 0.0 ? (pieceStartS + pieceDists[j]) / totalLength : 0.0;
        allSegIndexU.push(i, sNorm, curvatures[j]);
      }

      // Line indices: connect consecutive vertices within this piece
      for (let j = 0; j < segments; j++) {
        allIndices.push(vertexOffset + j, vertexOffset + j + 1);
        // Volumetric instance: pair of endpoint indices for this segment
        allVolInstances.push(vertexOffset + j, vertexOffset + j + 1);
      }

      pieceStartS += pieceDists[segments];
      this.pieceVertexRanges.push({ start: pieceStartVertex, count: segments + 1 });
      vertexOffset += segments + 1;
      totalSegments += segments;
    }

    this.sampleCount = vertexOffset;
    this.indexCount = allIndices.length;

    // Cache positions for CPU-side getPositionAt() lookups
    this.cachedPositions = new Float32Array(allPositions);

    // BUG 4 FIX: If all pieces were filtered out (e.g. showTravels=false and
    // all pieces are travel moves), the arrays are empty. Creating a WebGPU
    // buffer with size 0 throws a validation error. Return early instead.
    if (allPositions.length === 0) {
      // Clear existing buffers so render() doesn't try to draw stale data
      this.deferDestroy(this.positionBuffer); this.positionBuffer = null;
      this.deferDestroy(this.colorBuffer); this.colorBuffer = null;
      this.deferDestroy(this.indexBuffer); this.indexBuffer = null;
      this.deferDestroy(this.sampleIdxBuffer); this.sampleIdxBuffer = null;
      this.deferDestroy(this.segIndexUBuffer); this.segIndexUBuffer = null;
      this.deferDestroy(this.volInstanceBuffer); this.volInstanceBuffer = null;
      this.volInstanceCount = 0;
      return;
    }

    // Upload to GPU
    const posData = new Float32Array(allPositions);
    const colData = new Float32Array(allColors);
    const idxData = new Uint32Array(allIndices);
    const sampleIdxData = new Float32Array(allSampleIndices);
    const segIdxUData = new Float32Array(allSegIndexU);
    const volInstData = new Uint32Array(allVolInstances);

    this.deferDestroy(this.positionBuffer);
    this.positionBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.positionBuffer',
      size: posData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.positionBuffer, 0, posData);

    this.deferDestroy(this.colorBuffer);
    this.colorBuffer = this.device.createBuffer({
      size: colData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, colData);

    // Sample index buffer (for progress cutoff)
    this.deferDestroy(this.sampleIdxBuffer);
    this.sampleIdxBuffer = this.device.createBuffer({
      size: sampleIdxData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.sampleIdxBuffer, 0, sampleIdxData);

    // Segment index + normalized arc length buffer (for ReNURBS shader evaluation)
    this.deferDestroy(this.segIndexUBuffer);
    this.segIndexUBuffer = this.device.createBuffer({
      size: segIdxUData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segIndexUBuffer, 0, segIdxUData);

    this.deferDestroy(this.indexBuffer);
    this.indexBuffer = this.device.createBuffer({
      size: idxData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, idxData);

    // Volumetric instance buffer: pairs of vertex indices (u32 × 2 per segment)
    this.volInstanceCount = volInstData.length / 2;
    this.deferDestroy(this.volInstanceBuffer);
    this.volInstanceBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.volInstanceBuffer',
      size: volInstData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.volInstanceBuffer, 0, volInstData);

    // Update color LUT
    this.updateColorLUT();

    console.info(`NurbsRenderer: ${pieces.length} pieces → ${totalSegments} segments, ${this.indexCount} indices`);
  }

  private updateColorLUT(): void {
    if (!this.colorLUTTexture) return;
    const lut = this.options.colorMap.generateLUT(256); // RGB: 256×3 = 768 bytes
    // Convert RGB → RGBA for rgba8unorm texture (256×4 = 1024 bytes)
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = lut[i * 3];
      rgba[i * 4 + 1] = lut[i * 3 + 1];
      rgba[i * 4 + 2] = lut[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    this.device.queue.writeTexture(
      { texture: this.colorLUTTexture },
      rgba,
      { bytesPerRow: 256 * 4 },
      { width: 256 },
    );
  }

  /**
   * Update ReNURBS profile data (TRNP format).
   * Uploads control points, knots, and quantity metadata to GPU storage
   * buffers for shader-side De Boor evaluation.
   */
  updateReNurbsData(data: TRNPData): void {
    this.renurbsData = data;
    this.hasReNurbs = data.segments.length > 0;

    if (!this.hasReNurbs) return;

    // Create new storage buffers with real data first, then swap.
    // Passing the typed arrays (not .buffer) to writeBuffer writes exactly
    // data.byteLength bytes, avoiding overwrites if the source is a view into a
    // larger ArrayBuffer.
    const cpSize = Math.max(NurbsRenderer.DUMMY_CP_SIZE, data.allControlPoints.byteLength);
    const knotSize = Math.max(NurbsRenderer.DUMMY_KNOT_SIZE, data.allKnots.byteLength);
    const metaSize = Math.max(NurbsRenderer.DUMMY_META_SIZE, data.quantityMeta.byteLength);

    const newCpBuffer = this.device.createBuffer({
      size: cpSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(newCpBuffer, 0, data.allControlPoints as Float32Array<ArrayBuffer>);

    const newKnotBuffer = this.device.createBuffer({
      size: knotSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(newKnotBuffer, 0, data.allKnots as Float32Array<ArrayBuffer>);

    const newMetaBuffer = this.device.createBuffer({
      size: metaSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(newMetaBuffer, 0, data.quantityMeta as Uint32Array<ArrayBuffer>);

    // Recreate bind group 1 with real buffers
    const newBindGroup = this.device.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: newCpBuffer } },
        { binding: 1, resource: { buffer: newKnotBuffer } },
        { binding: 2, resource: { buffer: newMetaBuffer } },
      ],
    });

    // Swap in the new buffers and queue the old ones for destruction.
    this.deferDestroy(this.renurbsCpBuffer);
    this.deferDestroy(this.renurbsKnotBuffer);
    this.deferDestroy(this.renurbsMetaBuffer);

    this.renurbsCpBuffer = newCpBuffer;
    this.renurbsKnotBuffer = newKnotBuffer;
    this.renurbsMetaBuffer = newMetaBuffer;
    this.renurbsBindGroup = newBindGroup;

    console.info(`ReNURBS: ${data.segments.length} segments, ` +
      `${data.header.totalControlPoints} CPs, ${data.header.totalKnots} knots, ` +
      `maxV=${data.header.maxVelocity.toFixed(1)}, ` +
      `maxA=${data.header.maxAcceleration.toFixed(1)}, ` +
      `maxJ=${data.header.maxJerk.toFixed(1)}`);
  }

  /**
   * Update PA data for GPU-side analytical PA coloring.
   * Takes PA parameters + WSS extrusion ratios and uploads them to the GPU.
   * The shader evaluates PA in closed form using WSS arcs (group 3) +
   * extrusion ratios + these parameters.
   */
  updatePressureAdvanceData(paParams: PressureAdvanceParamBlock, extrusionRatios?: Float32Array): void {
    if (!this.pipeline) return;

    this.hasPaData = true;
    this.paMaxOffset = paParams.maxOffset || 1.0;
    this.paMaxVelocity = paParams.maxVelocity || 1.0;

    // Pack all PA storage data (moments, opVelocities, qGrid, tempGrid, pValues)
    // into a single buffer with computed offsets.
    const moments = paParams.moments;
    const opVelocities = paParams.opPointVelocities;
    const qGrid = paParams.qGrid;
    const tempGrid = paParams.tempGrid;
    const pValues = paParams.pValues;

    const momentsOffset = 0;
    const opVelOffset = momentsOffset + moments.length;
    const qGridOffset = opVelOffset + opVelocities.length;
    const tempGridOffset = qGridOffset + qGrid.length;
    const pValuesOffset = tempGridOffset + tempGrid.length;
    const totalDataFloats = pValuesOffset + pValues.length;

    // Pack PaParams uniform (9 floats + 13 u32s = 88 bytes, round to 96)
    const paUniform = new ArrayBuffer(96);
    const view = new DataView(paUniform);
    view.setFloat32(0, paParams.maxCompensation, true);
    view.setFloat32(4, paParams.smoothTime, true);
    view.setFloat32(8, paParams.filamentDiameter, true);
    view.setFloat32(12, paParams.pressureAdvance, true);
    view.setFloat32(16, paParams.powerLawBaseGain, true);
    view.setFloat32(20, paParams.flowIndex, true);
    view.setFloat32(24, paParams.crossWlfCompressibility, true);
    view.setFloat32(28, paParams.meltTempC, true);
    view.setFloat32(32, paParams.groupDelay, true);
    view.setUint32(36, paParams.algorithmId, true);
    view.setUint32(40, paParams.qGrid.length, true);
    view.setUint32(44, paParams.tempGrid.length, true);
    view.setUint32(48, paParams.moments.length, true);
    view.setUint32(52, paParams.opPointVelocities.length, true);
    view.setUint32(56, momentsOffset, true);
    view.setUint32(60, opVelOffset, true);
    view.setUint32(64, qGridOffset, true);
    view.setUint32(68, tempGridOffset, true);
    view.setUint32(72, pValuesOffset, true);
    // 76..95 = padding
    this.device.queue.writeBuffer(this.paParamBuffer!, 0, new Uint8Array(paUniform));

    // Upload extrusion ratios
    if (extrusionRatios && extrusionRatios.length > 0) {
      const ratioArr = new Float32Array(extrusionRatios);
      if (this.paExtrusionRatioBuffer && this.paExtrusionRatioBuffer.size >= ratioArr.byteLength) {
        this.device.queue.writeBuffer(this.paExtrusionRatioBuffer, 0, ratioArr as Float32Array<ArrayBuffer>);
      } else {
        this.paExtrusionRatioBuffer?.destroy();
        this.paExtrusionRatioBuffer = this.device.createBuffer({
          size: Math.max(16, ratioArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paExtrusionRatioBuffer, 0, ratioArr as Float32Array<ArrayBuffer>);
      }
    }

    // Pack and upload all PA data into a single buffer
    if (totalDataFloats > 0) {
      const dataArr = new Float32Array(totalDataFloats);
      dataArr.set(moments, momentsOffset);
      dataArr.set(opVelocities, opVelOffset);
      dataArr.set(qGrid, qGridOffset);
      dataArr.set(tempGrid, tempGridOffset);
      dataArr.set(pValues, pValuesOffset);

      if (this.paDataBuffer && this.paDataBuffer.size >= dataArr.byteLength) {
        this.device.queue.writeBuffer(this.paDataBuffer, 0, dataArr as Float32Array<ArrayBuffer>);
      } else {
        this.paDataBuffer?.destroy();
        this.paDataBuffer = this.device.createBuffer({
          size: Math.max(16, dataArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paDataBuffer, 0, dataArr as Float32Array<ArrayBuffer>);
      }
    }

    // Recreate bind group with potentially new buffers
    try {
      const paLayout = this.pipeline.getBindGroupLayout(2);
      this.paBindGroup = this.device.createBindGroup({
        layout: paLayout,
        entries: [
          { binding: 0, resource: { buffer: this.paParamBuffer! } },
          { binding: 1, resource: { buffer: this.paExtrusionRatioBuffer! } },
          { binding: 2, resource: { buffer: this.paDataBuffer! } },
        ],
      });
    } catch {
      // Keep previous bind group
    }
  }

  /**
   * Check if ReNURBS data is available for GPU-side velocity/accel/jerk coloring.
   */
  hasReNurbsData(): boolean {
    return this.hasReNurbs;
  }

  /**
   * Get the max value for the current color attribute (for normalization).
   */
  private getReNurbsMaxValue(): number {
    if (!this.renurbsData) return 1.0;
    switch (this.options.colorAttribute) {
      case 'velocity': return this.renurbsData.header.maxVelocity || 1.0;
      case 'acceleration': return this.renurbsData.header.maxAcceleration || 1.0;
      case 'jerk': return this.renurbsData.header.maxJerk || 1.0;
      default: return 1.0;
    }
  }

  /**
   * Get the max value from the analytical WSS for the current color attribute.
   */
  private getWssMaxValue(): number {
    if (!this.wssData) return 1.0;
    switch (this.options.colorAttribute) {
      case 'velocity': return this.wssData.maxVelocity || 1.0;
      case 'acceleration': return this.wssData.maxAcceleration || 1.0;
      case 'jerk': return this.wssData.maxJerk || 1.0;
      case 'time': return this.wssData.totalTime || 1.0;
      default: return 1.0;
    }
  }

  /**
   * Map color attribute to shader colorMode constant.
   * 0=cpuColorValue, 1=velocity, 2=accel, 3=jerk, 4=time
   * 5=pressureAdvanceOffset, 6=pressureAdvanceVelocity
   */
  private getColorMode(): number {
    switch (this.options.colorAttribute) {
      case 'velocity': return 1;
      case 'acceleration': return 2;
      case 'jerk': return 3;
      case 'time': return 4;
      case 'pressureAdvanceOffset': return 5;
      case 'pressureAdvanceVelocity': return 6;
      default: return 0;
    }
  }

  setColorMap(map: ColorMap): void {
    this.options.colorMap = map;
    this.updateColorLUT();
  }

  setProgress(frac: number): void {
    this.progress = Math.max(0, Math.min(1, frac));
  }

  /** Toggle overhang highlighting */
  setHighlightOverhangs(enabled: boolean): void {
    this.options.highlightOverhangs = enabled;
  }

  /** Toggle Z-seam marker visibility */
  setZSeamVisible(visible: boolean): void {
    this.options.zSeamVisible = visible;
  }

  /** Toggle bridge highlighting */
  setHighlightBridges(enabled: boolean): void {
    this.options.highlightBridges = enabled;
  }

  /** Toggle support structure highlighting */
  setHighlightSupport(enabled: boolean): void {
    this.options.highlightSupport = enabled;
  }

  /**
   * Set per-piece feed rates for the 'feedRate' color attribute.
   * @param feedRates Array of feed rates in mm/min, one per piece.
   */
  setFeedRates(feedRates: number[]): void {
    this.pieceFeedRates = new Float32Array(feedRates);
    this.maxFeedRate = 0;
    for (const f of feedRates) {
      if (f > this.maxFeedRate) this.maxFeedRate = f;
    }
  }

  /**
   * Set per-piece spindle RPM for the 'spindleRpm' color attribute.
   */
  setSpindleRpms(rpms: number[]): void {
    this.pieceSpindleRpm = new Float32Array(rpms);
    this.maxSpindleRpm = 0;
    for (const r of rpms) {
      if (r > this.maxSpindleRpm) this.maxSpindleRpm = r;
    }
  }

  /**
   * Set per-piece tool numbers for the 'toolNumber' color attribute.
   */
  setToolNumbers(tools: number[]): void {
    this.pieceToolNumbers = new Float32Array(tools);
    this.maxToolNumber = 0;
    for (const t of tools) {
      if (t > this.maxToolNumber) this.maxToolNumber = t;
    }
  }

  /**
   * Set per-piece coolant states for the 'coolant' color attribute.
   * Values: 0=off, 1=mist, 2=flood, 3=mist+flood
   */
  setCoolantStates(states: number[]): void {
    this.pieceCoolantStates = new Float32Array(states);
  }

  /**
   * Set per-piece feature type indices for the 'featureType' color attribute.
   * Each unique feature type gets a sequential index.
   */
  setFeatureTypes(types: number[]): void {
    this.pieceFeatureTypes = new Float32Array(types);
    this.maxFeatureType = 0;
    for (const t of types) {
      if (t > this.maxFeatureType) this.maxFeatureType = t;
    }
  }

  /**
   * Get the 3D position at a given progress fraction (0..1) along the
   * tessellated path. Interpolates linearly between the two nearest
   * tessellated vertices.
   */
  getPositionAt(frac: number): [number, number, number] | null {
    if (!this.cachedPositions || this.sampleCount === 0) return null;
    const f = Math.max(0, Math.min(1, frac));
    const idx = f * (this.sampleCount - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, this.sampleCount - 1);
    const t = idx - i0;
    const p = this.cachedPositions;
    return [
      p[i0 * 3] * (1 - t) + p[i1 * 3] * t,
      p[i0 * 3 + 1] * (1 - t) + p[i1 * 3 + 1] * t,
      p[i0 * 3 + 2] * (1 - t) + p[i1 * 3 + 2] * t,
    ];
  }

  /**
   * Get the tessellated positions and per-piece vertex ranges for CPU-side
   * raycasting. Returns null if no data is loaded.
   */
  getTessellatedPositions(): { positions: Float32Array; pieceRanges: { start: number; count: number }[] } | null {
    if (!this.cachedPositions || this.sampleCount === 0) return null;
    return { positions: this.cachedPositions, pieceRanges: this.pieceVertexRanges };
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.options.visible || !this.pipeline || !this.positionBuffer || this.indexCount < 2) return;
    if (!this.uniformBuffer || !this.bindGroup || !this.colorBuffer || !this.sampleIdxBuffer || !this.indexBuffer) return;
    if (!this.segIndexUBuffer || !this.renurbsBindGroup || !this.wssBindGroup) return;

    // Destroy resources replaced during previous data updates.  This is done
    // after the previous frame's queue.submit() has finished using them.
    this.flushStaleResources();

    // Uniforms: viewProj(64) + progress(4) + colorMode(4) + maxValue(4)
    //           + useWss(4) + totalLength(4) + wssArcCount(4) + _pad0(4)
    //           + feedRate(4) + maxPathVelocity(4) + maxCentripetalAccel(4)
    //           + maxAxisVelX(4) + maxAxisVelY(4) + maxAxisVelZ(4)
    //           + _pad1(4) + _pad2(4) = 120 bytes (buffer is 128)
    const cm = this.getColorMode();
    const isPaMode = cm === 5 || cm === 6;
    const isKinematicMode = cm >= 1 && cm <= 4;
    const hasWss = this.hasWss && isKinematicMode;
    const colorMode = isKinematicMode
      ? (hasWss ? cm : 0)
      : (isPaMode ? (this.hasPaData ? cm : 0) : cm);
    const maxValue = isPaMode
      ? (cm === 5 ? this.paMaxOffset : this.paMaxVelocity)
      : (hasWss ? this.getWssMaxValue() : (this.hasReNurbs ? this.getReNurbsMaxValue() : 1.0));

    const uniformData = new ArrayBuffer(128);
    const view = new DataView(uniformData);
    for (let i = 0; i < 16; i++) view.setFloat32(i * 4, viewProj[i], true);
    view.setFloat32(64, this.progress, true);
    view.setUint32(68, colorMode, true);
    view.setFloat32(72, maxValue, true);
    view.setUint32(76, hasWss ? 1 : 0, true);
    view.setFloat32(80, this.wssData?.totalLength ?? 0, true);
    view.setUint32(84, this.wssData?.arcs.length ?? 0, true);
    view.setUint32(88, 0, true); // _pad0
    // Kinematic limits
    view.setFloat32(92, this.wssData?.limits.feedRate ?? 0, true);
    view.setFloat32(96, this.wssData?.limits.maxPathVelocity ?? 0, true);
    view.setFloat32(100, this.wssData?.limits.maxCentripetalAcceleration ?? 0, true);
    view.setFloat32(104, this.wssData?.limits.maxAxisVelocityX ?? 0, true);
    view.setFloat32(108, this.wssData?.limits.maxAxisVelocityY ?? 0, true);
    view.setFloat32(112, this.wssData?.limits.maxAxisVelocityZ ?? 0, true);
    view.setFloat32(116, 0, true); // _pad1
    view.setFloat32(120, 0, true); // _pad2
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Volumetric segments: render as camera-facing quads (thick lines).
    // Falls back to the line-list pipeline when disabled or when the vol
    // pipeline/instance buffer is not available.
    const useVolumetric = this.options.volumetricSegments
      && this.volPipeline !== null
      && this.volInstanceBuffer !== null
      && this.volInstanceCount > 0
      && this.volUniformBuffer !== null;

    if (useVolumetric) {
      // Volumetric uniforms: same scalar fields as line uniforms (offsets 0..115)
      // + cameraEyeX/Y/Z at 116/120/124 + thickness at 128 + viewportHeight at 132.
      const volUniformData = new ArrayBuffer(144);
      const vView = new DataView(volUniformData);
      for (let i = 0; i < 16; i++) vView.setFloat32(i * 4, viewProj[i], true);
      vView.setFloat32(64, this.progress, true);
      vView.setUint32(68, colorMode, true);
      vView.setFloat32(72, maxValue, true);
      vView.setUint32(76, hasWss ? 1 : 0, true);
      vView.setFloat32(80, this.wssData?.totalLength ?? 0, true);
      vView.setUint32(84, this.wssData?.arcs.length ?? 0, true);
      vView.setUint32(88, 0, true); // _pad0
      vView.setFloat32(92, this.wssData?.limits.feedRate ?? 0, true);
      vView.setFloat32(96, this.wssData?.limits.maxPathVelocity ?? 0, true);
      vView.setFloat32(100, this.wssData?.limits.maxCentripetalAcceleration ?? 0, true);
      vView.setFloat32(104, this.wssData?.limits.maxAxisVelocityX ?? 0, true);
      vView.setFloat32(108, this.wssData?.limits.maxAxisVelocityY ?? 0, true);
      vView.setFloat32(112, this.wssData?.limits.maxAxisVelocityZ ?? 0, true);
      vView.setFloat32(116, this.cameraEye[0], true);
      vView.setFloat32(120, this.cameraEye[1], true);
      vView.setFloat32(124, this.cameraEye[2], true);
      // Thickness in pixels (lineWidth slider value, 1-8)
      vView.setFloat32(128, this.options.lineWidth, true);
      // Viewport height in pixels (for converting pixel thickness to NDC)
      vView.setFloat32(132, this.viewportHeight, true);
      this.device.queue.writeBuffer(this.volUniformBuffer!, 0, volUniformData);

      // Create per-frame bind groups (vertex buffers may change via updateData).
      const volBindGroup = this.device.createBindGroup({
        layout: this.volPipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.volUniformBuffer! } },
          { binding: 1, resource: { buffer: this.volInstanceBuffer! } },
          { binding: 2, resource: { buffer: this.positionBuffer! } },
          { binding: 3, resource: { buffer: this.colorBuffer! } },
          { binding: 4, resource: { buffer: this.segIndexUBuffer! } },
          { binding: 5, resource: { buffer: this.sampleIdxBuffer! } },
        ],
      });
      const volColorBindGroup = this.device.createBindGroup({
        layout: this.volPipeline!.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: this.colorLUTTexture!.createView() },
          { binding: 1, resource: this.sampler! },
        ],
      });

      pass.setPipeline(this.volPipeline!);
      pass.setBindGroup(0, volBindGroup);
      pass.setBindGroup(1, this.volWssBindGroup);
      pass.setBindGroup(2, volColorBindGroup);
      pass.draw(6, this.volInstanceCount);
    } else {
      // Line-list pipeline (thin lines)
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setBindGroup(1, this.renurbsBindGroup);
      if (this.paBindGroup) {
        pass.setBindGroup(2, this.paBindGroup);
      }
      // Group 3: WSS arc storage buffer (real or dummy).
      pass.setBindGroup(3, this.wssBindGroup);
      pass.setVertexBuffer(0, this.positionBuffer);
      pass.setVertexBuffer(1, this.colorBuffer);
      pass.setVertexBuffer(2, this.sampleIdxBuffer);
      pass.setVertexBuffer(3, this.segIndexUBuffer);
      pass.setIndexBuffer(this.indexBuffer, 'uint32');
      pass.drawIndexed(this.indexCount);
    }

    // Draw thick cylinder segments for highlighted pieces
    if (this.highlightPieces.size > 0 && this.thickPipeline && this.thickBindGroup && this.thickInstanceCount > 0) {
      const thickData = new Float32Array(20);
      for (let i = 0; i < 16; i++) thickData[i] = viewProj[i];
      // cameraEye will be set by the caller via setCameraEye()
      thickData[16] = this.cameraEye[0];
      thickData[17] = this.cameraEye[1];
      thickData[18] = this.cameraEye[2];
      thickData[19] = this.highlightThickness;
      this.device.queue.writeBuffer(this.thickUniformBuffer!, 0, thickData as Float32Array<ArrayBuffer>);

      pass.setPipeline(this.thickPipeline);
      pass.setBindGroup(0, this.thickBindGroup);
      pass.draw(6, this.thickInstanceCount);
    }
  }

  /** Set the camera eye position for thick-line billboarding. */
  private cameraEye: [number, number, number] = [0, 0, 1000];
  private viewportHeight: number = 1080;
  setCameraEye(eye: { x: number; y: number; z: number }): void {
    this.cameraEye = [eye.x, eye.y, eye.z];
  }
  setViewportHeight(h: number): void {
    this.viewportHeight = h;
  }

  /**
   * Highlight specific pieces by index. Builds a thick-line instance buffer
   * from the tessellated positions of the selected pieces.
   */
  setHighlightPieces(pieceIndices: Set<number> | null): void {
    this.highlightPieces = pieceIndices ?? new Set();
    this.buildThickInstances();
  }

  private buildThickInstances(): void {
    if (!this.cachedPositions || this.highlightPieces.size === 0) {
      this.thickInstanceCount = 0;
      return;
    }

    const instances: number[] = [];
    for (const pi of this.highlightPieces) {
      if (pi < 0 || pi >= this.pieceVertexRanges.length) continue;
      const range = this.pieceVertexRanges[pi];
      // Build a thick-line instance for each tessellated segment in this piece
      for (let v = range.start; v < range.start + range.count - 1; v++) {
        const p0x = this.cachedPositions[v * 3];
        const p0y = this.cachedPositions[v * 3 + 1];
        const p0z = this.cachedPositions[v * 3 + 2];
        const p1x = this.cachedPositions[(v + 1) * 3];
        const p1y = this.cachedPositions[(v + 1) * 3 + 1];
        const p1z = this.cachedPositions[(v + 1) * 3 + 2];
        instances.push(p0x, p0y, p0z, p1x);
        instances.push(p1y, p1z, 1.0, 0.0);
      }
    }

    this.thickInstanceCount = instances.length / 8;
    if (this.thickInstanceCount === 0) return;

    const arr = new Float32Array(instances);
    this.thickInstanceBuffer?.destroy();
    this.thickInstanceBuffer = this.device.createBuffer({
      size: arr.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.thickInstanceBuffer, 0, arr as Float32Array<ArrayBuffer>);

    if (this.thickPipeline) {
      this.thickBindGroup = this.device.createBindGroup({
        layout: this.thickPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.thickUniformBuffer! } },
          { binding: 1, resource: { buffer: this.thickInstanceBuffer } },
        ],
      });
    }
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.colorBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.colorLUTTexture?.destroy();
    this.wssArcBuffer?.destroy();
    this.sampleIdxBuffer?.destroy();
    this.segIndexUBuffer?.destroy();
    this.renurbsCpBuffer?.destroy();
    this.renurbsKnotBuffer?.destroy();
    this.renurbsMetaBuffer?.destroy();
    this.paParamBuffer?.destroy();
    this.paExtrusionRatioBuffer?.destroy();
    this.paDataBuffer?.destroy();
    this.thickUniformBuffer?.destroy();
    this.thickInstanceBuffer?.destroy();
    for (const r of this.staleResources) r.destroy();
    this.staleResources = [];
    this.cachedPositions = null;
  }
}
