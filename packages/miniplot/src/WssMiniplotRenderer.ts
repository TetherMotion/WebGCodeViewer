/**
 * @file WssMiniplotRenderer.ts
 * @brief WebGPU miniplot that evaluates the WSS (Weighted Switching Structure)
 *        analytically in a compute shader — one point per pixel column — and
 *        renders it with the proven plot pipeline from TechOverflow's
 *        "Real-Time 1 kHz WebGPU Oscilloscope" article:
 *
 *          https://techoverflow.net/2026/08/19/real-time-1-khz-webgpu-oscilloscope-with-ring-buffer-auto-scroll/
 *
 *        That pipeline is known-good: MSAA anti-aliased line strips, an
 *        fwidth()-based anti-aliased grid rendered entirely in WebGPU, a
 *        world→clip mapping that honours plot margins, and a 2D canvas
 *        overlay for axis ticks / labels.
 *
 *        Unlike the article (which streams sine-wave samples into a GPU ring
 *        buffer), the data source here is the analytical WSS: a compute
 *        shader evaluates v(t), a(t), j(t) in closed form into a flat
 *        (t, v) point buffer (one point per pixel column). The line pipeline
 *        then reads that buffer directly — no ring buffer / modulo
 *        addressing is needed because the points are regenerated every frame
 *        for the current [tMin, tMax] viewport.
 *
 * The x-axis is time. Given a time t, we binary-search the arcs by t0 to find
 * the containing arc, then τ = t - t0, and:
 *   BANG:   v = v0 + a0·τ + ½·η·τ²,  a = a0 + η·τ,  j = η
 *   SINGULAR: v = v0 + a*·τ,         a = a*,         j = 0
 *   WALL:   v = v0 (approx),          a = 0,          j = 0
 */

import type { WssGpuData, PressureAdvanceParamBlock } from '@tether/viewer-core';

export type WssPlotQuantity =
  | 'velocity'
  | 'acceleration'
  | 'jerk'
  | 'paOffset'
  | 'paExtruderVelocity';

const QUANTITY_LABELS: Record<WssPlotQuantity, string> = {
  velocity: 'Velocity (mm/s)',
  acceleration: 'Acceleration (mm/s²)',
  jerk: 'Jerk (mm/s³)',
  paOffset: 'PA Offset (mm)',
  paExtruderVelocity: 'Extruder Velocity (mm/s)',
};

const QUANTITY_COLORS: Record<WssPlotQuantity, [number, number, number]> = {
  velocity: [0.29, 0.62, 1.0],
  acceleration: [1.0, 0.53, 0.28],
  jerk: [0.91, 0.33, 0.53],
  paOffset: [0.4, 1.0, 0.4],
  paExtruderVelocity: [1.0, 0.8, 0.2],
};

const HIGHLIGHT_COLOR = '#ffcc00';
const EVENT_COLORS: Record<string, string> = {
  tool: '#ffd94d',
  temp: '#ff5c3d',
  fan: '#4d99ff',
  coolant: '#33e6e6',
};

// MSAA sample counts to probe (matches the article).
const MSAA_SAMPLE_COUNTS = [1, 2, 4, 8, 16];

// Plot margins in CSS pixels.
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 8;
const MARGIN_TOP = 8;
const MARGIN_BOTTOM = 22;

interface ViewRange {
  tMin: number;
  tMax: number;
}

interface EventLines {
  toolChangeLines?: number[];
  tempChangeLines?: number[];
  fanChangeLines?: number[];
  coolantChangeLines?: number[];
}

/// Optional time-range selection band drawn over the plot (e.g. the G-code
/// line selection). When set, the view is also zoomed to this range so the
/// user sees the selected quantity (velocity / acceleration / jerk) for just
/// the selected G-code lines.
interface SelectionRange {
  tMin: number;
  tMax: number;
}

// Arc layout: 12 floats per arc (matches WssParser.ts / WssData.hpp)
// [s0, s1, t0, v0, a0, eta, aStar, duration, type, 0, 0, 0]
const ARC_FLOATS = 12;

export class WssMiniplotRenderer {
  private container: HTMLElement;
  private device: GPUDevice;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private wssData: WssGpuData | null = null;
  private eventLines: EventLines = {};
  private quantity: WssPlotQuantity = 'velocity';
  private selectedLine: number = -1;
  private lineToTime: Map<number, number> = new Map();

  private totalRange: ViewRange = { tMin: 0, tMax: 1 };
  private viewRange: ViewRange = { tMin: 0, tMax: 1 };
  private yRange: { min: number; max: number } = { min: 0, max: 1 };

  /// Time-range selection band (G-code line selection). null = no band.
  private selectionRange: SelectionRange | null = null;

  private viewRangeCallback: (() => void) | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartTMin = 0;
  private dragTSpan = 0;

  // GPU resources
  private arcBuffer: GPUBuffer | null = null;
  private pointBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeUniformBuffer: GPUBuffer | null = null;

  // PA-related GPU resources (optional — only used for paOffset / paExtruderVelocity)
  private paParams: PressureAdvanceParamBlock | null = null;
  private extrusionRatioBuffer: GPUBuffer | null = null;
  private paParamBuffer: GPUBuffer | null = null;
  private paMomentsBuffer: GPUBuffer | null = null;
  private paOpVelBuffer: GPUBuffer | null = null;
  private paQGridBuffer: GPUBuffer | null = null;
  private paTempGridBuffer: GPUBuffer | null = null;
  private paPValuesBuffer: GPUBuffer | null = null;

  // Render pipelines (article-style: line + grid, one pair per MSAA count).
  private linePipelines: GPURenderPipeline[] = [];
  private gridPipelines: GPURenderPipeline[] = [];
  private supportedSC: number[] = [];
  private msaaIndex = 0;
  private renderBindGroup: GPUBindGroup | null = null;
  private renderUniformBuffer: GPUBuffer | null = null;
  private renderLayout: GPUBindGroupLayout | null = null;

  // MSAA resolve texture.
  private msaaTexture: GPUTexture | null = null;
  private msaaSC = 0;
  private msaaW = 0;
  private msaaH = 0;

  // Output point buffer sized to canvas pixel width (capped for safety)
  private outputPoints = 1;
  private readonly maxOutputPoints = 4096;

  constructor(container: HTMLElement, device: GPUDevice) {
    this.container = container;
    this.device = device;
  }

  async init(): Promise<void> {
    // Use the existing #miniplot-canvas element from the DOM (the HTML
    // already provides <canvas id="miniplot-canvas"> inside the container).
    // Add the wss-miniplot-canvas class so WebGPU-specific E2E tests can
    // locate it, and make sure it is shown.
    let canvas = this.container.querySelector<HTMLCanvasElement>('canvas#miniplot-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'miniplot-canvas';
      this.container.appendChild(canvas);
    }
    canvas.classList.add('wss-miniplot-canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.canvas = canvas;

    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('WebGPU canvas context not available');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    // Create 2D overlay canvas for axis ticks / labels / event markers.
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'wss-miniplot-overlay';
    this.overlayCanvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    this.container.style.position = 'relative';
    this.container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.resizeCanvas();

    // ── Compute shader: one (t, v) point per pixel column ──
    // Evaluates motion quantities (velocity, acceleration, jerk) from WSS arcs,
    // and PA quantities (extruder velocity, PA offset) using extrusion ratios
    // + PA algorithm parameters.
    const computeShader = this.device.createShaderModule({
      code: `
        struct WssArc {
          s0: f32, s1: f32, t0: f32, v0: f32,
          a0: f32, eta: f32, aStar: f32, duration: f32,
          kind: f32, _pad0: f32, _pad1: f32, _pad2: f32,
        };

        struct ComputeUniforms {
          tMin: f32,
          tMax: f32,
          outputPoints: u32,
          quantity: u32,     // 0=velocity, 1=acceleration, 2=jerk,
                             // 3=paExtruderVelocity, 4=paOffset
          arcCount: u32,
          algorithmId: u32,  // 0=Linear, 1=PowerLaw, 2=CrossWLF, 3=LTI, 4=LPV
        };

        // PA parameters (algorithm-specific, packed into a uniform).
        // Matches PressureAdvancePlotRenderer's PaParams struct.
        struct PaParams {
          maxCompensation: f32,
          smoothTime: f32,
          filamentDiameter: f32,
          pressureAdvance: f32,
          powerLawBaseGain: f32,
          flowIndex: f32,
          crossWlfCompressibility: f32,
          meltTempC: f32,
          qGridCount: u32,
          tempGridCount: u32,
          groupDelay: f32,
          momentCount: u32,
          opPointCount: u32,
          _pad1: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: ComputeUniforms;
        @group(0) @binding(1) var<storage, read> arcs: array<WssArc>;
        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;
        @group(0) @binding(3) var<storage, read> extrusionRatios: array<f32>;
        @group(0) @binding(4) var<uniform> paParams: PaParams;
        @group(0) @binding(5) var<storage, read> paMoments: array<f32>;
        @group(0) @binding(6) var<storage, read> paOpVelocities: array<f32>;
        @group(0) @binding(7) var<storage, read> paQGrid: array<f32>;
        @group(0) @binding(8) var<storage, read> paTempGrid: array<f32>;
        @group(0) @binding(9) var<storage, read> paPValues: array<f32>;

        /// Binary search for the arc whose time range contains t.
        /// Arcs are sorted by t0.
        fn findArcByTime(t: f32) -> u32 {
          let n = uniforms.arcCount;
          if (n == 0u) { return 0u; }
          var lo: u32 = 0u;
          var hi: u32 = n;
          while (lo < hi) {
            let mid = (lo + hi) / 2u;
            let arcT0 = arcs[mid].t0;
            if (arcT0 <= t) {
              lo = mid + 1u;
            } else {
              hi = mid;
            }
          }
          // lo is now the first arc with t0 > t, so the containing arc is lo-1
          if (lo == 0u) { return 0u; }
          return min(lo - 1u, n - 1u);
        }

        /// Evaluate path velocity at time t from the WSS arc.
        fn evalPathVelocity(t: f32) -> f32 {
          if (uniforms.arcCount == 0u) { return 0.0; }
          let idx = findArcByTime(t);
          let arc = arcs[idx];
          let tau = max(t - arc.t0, 0.0);
          let arcKind = arc.kind;

          if (arcKind < 2.5) {
            // BANG_PLUS (0) or BANG_MINUS (1)
            return arc.v0 + arc.a0 * tau + 0.5 * arc.eta * tau * tau;
          } else if (arcKind < 3.5) {
            // SINGULAR (2)
            return arc.v0 + arc.aStar * tau;
          } else {
            // WALL (3)
            return arc.v0;
          }
        }

        /// Evaluate acceleration at time t.
        fn evalAcceleration(t: f32) -> f32 {
          if (uniforms.arcCount == 0u) { return 0.0; }
          let idx = findArcByTime(t);
          let arc = arcs[idx];
          let tau = max(t - arc.t0, 0.0);
          let arcKind = arc.kind;

          if (arcKind < 2.5) {
            return arc.a0 + arc.eta * tau;
          } else if (arcKind < 3.5) {
            return arc.aStar;
          } else {
            return 0.0;
          }
        }

        /// Evaluate jerk at time t.
        fn evalJerk(t: f32) -> f32 {
          if (uniforms.arcCount == 0u) { return 0.0; }
          let idx = findArcByTime(t);
          let arc = arcs[idx];
          let arcKind = arc.kind;

          if (arcKind < 2.5) {
            return arc.eta;
          } else {
            return 0.0;
          }
        }

        /// Evaluate extruder velocity at time t.
        fn evalExtruderVelocity(t: f32) -> f32 {
          let idx = findArcByTime(t);
          let ratio = extrusionRatios[idx];
          let vPath = evalPathVelocity(t);
          return vPath * ratio;
        }

        /// Bilinear interpolation of the CrossWLF pressure LUT.
        fn bilinearInterpLut(q: f32, temp: f32) -> f32 {
          let qCount = paParams.qGridCount;
          let tCount = paParams.tempGridCount;
          if (qCount == 0u || tCount == 0u) { return 0.0; }

          var qIdx: u32 = 0u;
          for (var i: u32 = 0u; i < qCount; i++) {
            if (paQGrid[i] <= q) { qIdx = i; } else { break; }
          }
          qIdx = min(qIdx, qCount - 1u);
          let qIdxHi = min(qIdx + 1u, qCount - 1u);
          let qFrac = select(0.0,
                             (q - paQGrid[qIdx]) / (paQGrid[qIdxHi] - paQGrid[qIdx]),
                             qIdxHi > qIdx);

          var tIdx: u32 = 0u;
          for (var i: u32 = 0u; i < tCount; i++) {
            if (paTempGrid[i] <= temp) { tIdx = i; } else { break; }
          }
          tIdx = min(tIdx, tCount - 1u);
          let tIdxHi = min(tIdx + 1u, tCount - 1u);
          let tFrac = select(0.0,
                             (temp - paTempGrid[tIdx]) / (paTempGrid[tIdxHi] - paTempGrid[tIdx]),
                             tIdxHi > tIdx);

          let p00 = paPValues[tIdx * qCount + qIdx];
          let p10 = paPValues[tIdx * qCount + qIdxHi];
          let p01 = paPValues[tIdxHi * qCount + qIdx];
          let p11 = paPValues[tIdxHi * qCount + qIdxHi];
          let p0 = mix(p00, p10, qFrac);
          let p1 = mix(p01, p11, qFrac);
          return mix(p0, p1, tFrac);
        }

        /// Linear interpolation for LPV operating points.
        fn lerpMoments(v: f32, opIdx: u32, opIdxHi: u32) -> array<f32, 4> {
          let mc = paParams.momentCount;
          if (opIdx == opIdxHi || opIdxHi >= paParams.opPointCount) {
            return array<f32, 4>(
              paMoments[opIdx * mc + 0u],
              paMoments[opIdx * mc + 1u],
              paMoments[opIdx * mc + 2u],
              paMoments[opIdx * mc + 3u],
            );
          }
          let vLo = paOpVelocities[opIdx];
          let vHi = paOpVelocities[opIdxHi];
          let frac = (v - vLo) / max(vHi - vLo, 0.001);
          var result: array<f32, 4>;
          for (var k: u32 = 0u; k < 4u && k < mc; k++) {
            let mLo = paMoments[opIdx * mc + k];
            let mHi = paMoments[opIdxHi * mc + k];
            result[k] = mix(mLo, mHi, clamp(frac, 0.0, 1.0));
          }
          return result;
        }

        /// Evaluate PA offset at time t.
        fn evalPaOffset(t: f32) -> f32 {
          let vExt = evalExtruderVelocity(t);
          let algo = uniforms.algorithmId;

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
            // LTI Deconv: first-order approximation
            if (paParams.momentCount > 0u) {
              offset = vExt * paMoments[0u];
            }
          } else if (algo == 4u) {
            // LPV Deconv: interpolate moments by velocity
            if (paParams.opPointCount > 0u && paParams.momentCount > 0u) {
              var opIdx: u32 = 0u;
              for (var i: u32 = 0u; i < paParams.opPointCount; i++) {
                if (paOpVelocities[i] <= vExt) { opIdx = i; } else { break; }
              }
              opIdx = min(opIdx, paParams.opPointCount - 1u);
              let opIdxHi = min(opIdx + 1u, paParams.opPointCount - 1u);
              let moments = lerpMoments(vExt, opIdx, opIdxHi);
              offset = vExt * moments[0];
            }
          }

          let maxComp = paParams.maxCompensation;
          offset = clamp(offset, -maxComp, maxComp);
          return offset;
        }

        @compute @workgroup_size(64)
        fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
          let idx = global_id.x;
          if (idx >= uniforms.outputPoints) { return; }

          let n = uniforms.outputPoints;
          let t = select(uniforms.tMin,
                         uniforms.tMin + (uniforms.tMax - uniforms.tMin) * (f32(idx) / f32(n - 1u)),
                         n > 1u);

          var v: f32;
          switch (uniforms.quantity) {
            case 0u: { v = evalPathVelocity(t); }
            case 1u: { v = evalAcceleration(t); }
            case 2u: { v = evalJerk(t); }
            case 3u: { v = evalExtruderVelocity(t); }
            case 4u: { v = evalPaOffset(t); }
            default: { v = evalPathVelocity(t); }
          }

          points[idx] = vec2<f32>(t, v);
        }
      `,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeShader, entryPoint: 'cs_main' },
    });

    this.computeUniformBuffer = this.device.createBuffer({
      size: 32, // 2 × f32 + 4 × u32 = 24 bytes, padded to 32 for uniform alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create dummy PA buffers so the bind group can be created before PA
    // data is set. These are replaced when setPaData() is called.
    this.extrusionRatioBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.extrusionRatioBuffer, 0, new Float32Array([0]) as Float32Array<ArrayBuffer>);

    this.paParamBuffer = this.device.createBuffer({
      size: 64, // PaParams struct (14 floats + 1 pad = 60 bytes, round to 64)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const dummyMoments = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(dummyMoments, 0, new Float32Array([0,0,0,0]) as Float32Array<ArrayBuffer>);
    this.paMomentsBuffer = dummyMoments;

    this.paOpVelBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.paQGridBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.paTempGridBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.paPValuesBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    this.pointBuffer = this.device.createBuffer({
      size: this.maxOutputPoints * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Dummy arc buffer so bind group can be created before data is set.
    this.arcBuffer = this.device.createBuffer({
      size: ARC_FLOATS * 4, // one arc
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.arcBuffer, 0, new Float32Array(ARC_FLOATS) as Float32Array<ArrayBuffer>);

    // ── Render shader (article-style line + grid pipelines) ──
    // The line pipeline reads (t, v) points from the compute output buffer
    // and maps them to clip space honouring the plot margins. The grid
    // pipeline renders a full-screen quad with fwidth()-based anti-aliased
    // grid lines and a distinct margin / plot background colour.
    const renderShader = this.device.createShaderModule({
      code: `
        struct RenderUniforms {
          tMin          : f32,
          tMax          : f32,
          yMin          : f32,
          yMax          : f32,
          plotX         : f32,
          plotY         : f32,
          plotW         : f32,
          plotH         : f32,
          canvasW       : f32,
          canvasH       : f32,
          xMajorStep    : f32,
          yMajorStep    : f32,
          colorR        : f32,
          colorG        : f32,
          colorB        : f32,
          pointCount    : u32,
        };

        @group(0) @binding(0) var<uniform> ru : RenderUniforms;
        @group(0) @binding(1) var<storage, read> points : array<vec2<f32>>;

        // World → clip space, honouring plot margins (device pixels).
        fn worldToClip(t : f32, v : f32) -> vec4<f32> {
          let plotPx = (t - ru.tMin) / (ru.tMax - ru.tMin) * ru.plotW;
          let plotPy = (ru.yMax - v) / (ru.yMax - ru.yMin) * ru.plotH;
          let canvasPx = ru.plotX + plotPx;
          let canvasPy = ru.plotY + plotPy;
          return vec4<f32>(
            (canvasPx / ru.canvasW) * 2.0 - 1.0,
            1.0 - (canvasPy / ru.canvasH) * 2.0,
            0.0, 1.0
          );
        }

        // ── Line strip pipeline ─────────────────────────────────────────
        struct LineVSOut {
          @builtin(position) clipPos : vec4<f32>,
          @location(0)       color   : vec3<f32>,
        };

        @vertex
        fn vs_line(@builtin(vertex_index) vi : u32) -> LineVSOut {
          var out : LineVSOut;
          if (vi < ru.pointCount) {
            let p = points[vi];
            out.clipPos = worldToClip(p.x, p.y);
          } else {
            // Degenerate vertex far off-screen.
            out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
          }
          out.color = vec3<f32>(ru.colorR, ru.colorG, ru.colorB);
          return out;
        }

        @fragment
        fn fs_line(in : LineVSOut) -> @location(0) vec4<f32> {
          return vec4<f32>(in.color, 1.0);
        }

        // ── Grid pipeline ───────────────────────────────────────────────
        struct GridVSOut {
          @builtin(position) clipPos : vec4<f32>,
          @location(0)       canvasPx : vec2<f32>,
        };

        @vertex
        fn vs_grid(@builtin(vertex_index) vi : u32) -> GridVSOut {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>( 1.0,  1.0),
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0,  1.0),
            vec2<f32>(-1.0,  1.0),
          );
          var out : GridVSOut;
          out.clipPos = vec4<f32>(pos[vi], 0.0, 1.0);
          out.canvasPx = vec2<f32>(
            (pos[vi].x * 0.5 + 0.5) * ru.canvasW,
            (1.0 - pos[vi].y * 0.5 - 0.5) * ru.canvasH,
          );
          return out;
        }

        // Distance (in pixels) from coord to the nearest grid line at
        // multiples of step. pxPerWorld converts world units to pixels.
        fn gridLineDistPx(coord : f32, step : f32, pxPerWorld : f32) -> f32 {
          let p = coord / step;
          let frac_p = fract(p);
          let dWorld = min(frac_p, 1.0 - frac_p);
          return dWorld * pxPerWorld;
        }

        // Grid line intensity from a pixel distance: 1.0 on the line,
        // anti-aliased to 0 over ~1px. width is the line half-width in px.
        fn gridLineIntensity(distPx : f32, width : f32) -> f32 {
          return 1.0 - smoothstep(0.0, max(width, 0.0001), distPx);
        }

        @fragment
        fn fs_grid(in : GridVSOut) -> @location(0) vec4<f32> {
          // Dark theme to match the viewer.
          let marginColor = vec3<f32>(0.10, 0.10, 0.12);
          let plotBg = vec3<f32>(0.13, 0.13, 0.16);

          let px = in.canvasPx.x;
          let py = in.canvasPx.y;
          let inside = px >= ru.plotX && px < ru.plotX + ru.plotW
                    && py >= ru.plotY && py < ru.plotY + ru.plotH;

          if (!inside) {
            return vec4<f32>(marginColor, 1.0);
          }

          let worldX = ru.tMin + (px - ru.plotX) / ru.plotW * (ru.tMax - ru.tMin);
          let worldY = ru.yMax - (py - ru.plotY) / ru.plotH * (ru.yMax - ru.yMin);

          let pxPerWorldX = ru.plotW / (ru.tMax - ru.tMin);
          let pxPerWorldY = ru.plotH / (ru.yMax - ru.yMin);

          let minorD = min(gridLineDistPx(worldX, ru.xMajorStep * 0.5, pxPerWorldX),
                           gridLineDistPx(worldY, ru.yMajorStep * 0.5, pxPerWorldY));
          let majorD = min(gridLineDistPx(worldX, ru.xMajorStep, pxPerWorldX),
                           gridLineDistPx(worldY, ru.yMajorStep, pxPerWorldY));

          let xMinor = gridLineIntensity(minorD, 1.0);
          let xMajor = gridLineIntensity(majorD, 1.0);

          let minorColor = vec3<f32>(0.20, 0.20, 0.24);
          let majorColor = vec3<f32>(0.32, 0.32, 0.38);

          var color = plotBg;
          color = mix(color, minorColor, xMinor * 0.5);
          color = mix(color, majorColor, xMajor * 0.7);

          return vec4<f32>(color, 1.0);
        }
      `,
    });

    // Shared bind group layout: uniforms + points storage.
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.renderLayout],
    });

    // Probe each MSAA sample count via createRenderPipelineAsync (rejects on
    // unsupported sample count). The WebGPU spec only guarantees 1× and 4×.
    for (const sc of MSAA_SAMPLE_COUNTS) {
      try {
        const [linePipe, gridPipe] = await Promise.all([
          this.device.createRenderPipelineAsync({
            layout: renderPipelineLayout,
            vertex: { module: renderShader, entryPoint: 'vs_line' },
            fragment: { module: renderShader, entryPoint: 'fs_line', targets: [{ format }] },
            primitive: { topology: 'line-strip' },
            multisample: { count: sc },
          }),
          this.device.createRenderPipelineAsync({
            layout: renderPipelineLayout,
            vertex: { module: renderShader, entryPoint: 'vs_grid' },
            fragment: { module: renderShader, entryPoint: 'fs_grid', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
            multisample: { count: sc },
          }),
        ]);
        this.supportedSC.push(sc);
        this.linePipelines.push(linePipe);
        this.gridPipelines.push(gridPipe);
      } catch {
        // Unsupported sample count — skip.
      }
    }
    if (this.supportedSC.length === 0) {
      // Should never happen (1× is always supported), but stay safe.
      this.supportedSC.push(1);
      this.linePipelines.push(this.device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module: renderShader, entryPoint: 'vs_line' },
        fragment: { module: renderShader, entryPoint: 'fs_line', targets: [{ format }] },
        primitive: { topology: 'line-strip' },
        multisample: { count: 1 },
      }));
      this.gridPipelines.push(this.device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module: renderShader, entryPoint: 'vs_grid' },
        fragment: { module: renderShader, entryPoint: 'fs_grid', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        multisample: { count: 1 },
      }));
    }
    // Prefer 4× MSAA if available, otherwise the highest supported count.
    const TARGET_SC = 4;
    const targetIdx = this.supportedSC.indexOf(TARGET_SC);
    this.msaaIndex = targetIdx !== -1 ? targetIdx : this.supportedSC.length - 1;

    // Render uniforms: 15 × f32 + 1 × u32 = 64 bytes.
    this.renderUniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.pointBuffer } },
      ],
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.arcBuffer } },
        { binding: 2, resource: { buffer: this.pointBuffer } },
        { binding: 3, resource: { buffer: this.extrusionRatioBuffer! } },
        { binding: 4, resource: { buffer: this.paParamBuffer! } },
        { binding: 5, resource: { buffer: this.paMomentsBuffer! } },
        { binding: 6, resource: { buffer: this.paOpVelBuffer! } },
        { binding: 7, resource: { buffer: this.paQGridBuffer! } },
        { binding: 8, resource: { buffer: this.paTempGridBuffer! } },
        { binding: 9, resource: { buffer: this.paPValuesBuffer! } },
      ],
    });

    // Event handlers
    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('dblclick', () => this.resetZoom());
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.context || !this.overlayCanvas) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    // Overlay canvas matches device pixels; the 2D context is scaled by dpr
    // so all overlay drawing can use CSS pixel coordinates (crisp text).
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
  }

  /**
   * Set the WSS data and reset view to show everything.
   */
  setWssData(data: WssGpuData): void {
    this.wssData = data;
    this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
    this.viewRange = { ...this.totalRange };
    this.computeYRange();
    this.uploadArcs(data);
  }

  /**
   * Set event line numbers for annotation overlays.
   */
  setEventLines(events: EventLines): void {
    this.eventLines = events;
  }

  /**
   * Set the line-number → time map for selected-line highlight.
   */
  setLineToTimeMap(map: Map<number, number>): void {
    this.lineToTime = map;
  }

  private computeYRange(): void {
    if (!this.wssData) {
      this.yRange = { min: 0, max: 1 };
      return;
    }
    let minV: number, maxV: number;
    switch (this.quantity) {
      case 'velocity':
        minV = 0;
        maxV = this.wssData.maxVelocity * 1.05;
        break;
      case 'acceleration':
        minV = -this.wssData.maxAcceleration * 1.05;
        maxV = this.wssData.maxAcceleration * 1.05;
        break;
      case 'jerk':
        minV = -this.wssData.maxJerk * 1.05;
        maxV = this.wssData.maxJerk * 1.05;
        break;
      case 'paOffset':
        if (this.paParams) {
          minV = -this.paParams.maxOffset * 1.1;
          maxV = this.paParams.maxOffset * 1.1;
        } else {
          minV = -0.1;
          maxV = 0.1;
        }
        break;
      case 'paExtruderVelocity':
        if (this.paParams) {
          minV = 0;
          maxV = this.paParams.maxVelocity * 1.05;
        } else {
          minV = 0;
          maxV = this.wssData.maxVelocity * 1.05;
        }
        break;
    }
    if (!isFinite(minV) || !isFinite(maxV) || minV >= maxV) {
      minV = 0;
      maxV = 1;
    }
    this.yRange = { min: minV, max: maxV };
  }

  private uploadArcs(data: WssGpuData): void {
    if (!this.device) return;
    const arr = data.arcBuffer as Float32Array<ArrayBuffer>;
    if (arr.byteLength === 0) return;

    if (this.arcBuffer && this.arcBuffer.size >= arr.byteLength) {
      this.device.queue.writeBuffer(this.arcBuffer, 0, arr);
    } else {
      this.arcBuffer?.destroy();
      this.arcBuffer = this.device.createBuffer({
        size: arr.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.arcBuffer, 0, arr);
    }

    // Upload extrusion ratios if present.
    if (data.extrusionRatios && data.extrusionRatios.length > 0) {
      const ratioArr = new Float32Array(data.extrusionRatios);
      if (this.extrusionRatioBuffer && this.extrusionRatioBuffer.size >= ratioArr.byteLength) {
        this.device.queue.writeBuffer(this.extrusionRatioBuffer, 0, ratioArr as Float32Array<ArrayBuffer>);
      } else {
        this.extrusionRatioBuffer?.destroy();
        this.extrusionRatioBuffer = this.device.createBuffer({
          size: Math.max(4, ratioArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.extrusionRatioBuffer, 0, ratioArr as Float32Array<ArrayBuffer>);
      }
    }

    this.recreateComputeBindGroup();
  }

  setQuantity(q: WssPlotQuantity): void {
    this.quantity = q;
    this.computeYRange();
  }

  /**
   * Set PA parameters for PA quantity evaluation (paOffset / paExtruderVelocity).
   * Must be called before selecting a PA quantity; the extrusion ratios are
   * already uploaded via setWssData() if present in the WSS data.
   */
  setPaData(params: PressureAdvanceParamBlock): void {
    this.paParams = params;
    this.uploadPaParams(params);
    this.computeYRange();
  }

  private recreateComputeBindGroup(): void {
    if (!this.computePipeline) return;
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
        { binding: 1, resource: { buffer: this.arcBuffer! } },
        { binding: 2, resource: { buffer: this.pointBuffer! } },
        { binding: 3, resource: { buffer: this.extrusionRatioBuffer! } },
        { binding: 4, resource: { buffer: this.paParamBuffer! } },
        { binding: 5, resource: { buffer: this.paMomentsBuffer! } },
        { binding: 6, resource: { buffer: this.paOpVelBuffer! } },
        { binding: 7, resource: { buffer: this.paQGridBuffer! } },
        { binding: 8, resource: { buffer: this.paTempGridBuffer! } },
        { binding: 9, resource: { buffer: this.paPValuesBuffer! } },
      ],
    });
  }

  private uploadPaParams(params: PressureAdvanceParamBlock): void {
    // Pack PaParams uniform (14 floats + 1 pad = 60 bytes, round to 64)
    const paUniform = new ArrayBuffer(64);
    const view = new DataView(paUniform);
    view.setFloat32(0, params.maxCompensation, true);
    view.setFloat32(4, params.smoothTime, true);
    view.setFloat32(8, params.filamentDiameter, true);
    view.setFloat32(12, params.pressureAdvance, true);
    view.setFloat32(16, params.powerLawBaseGain, true);
    view.setFloat32(20, params.flowIndex, true);
    view.setFloat32(24, params.crossWlfCompressibility, true);
    view.setFloat32(28, params.meltTempC, true);
    view.setUint32(32, params.qGrid.length, true);
    view.setUint32(36, params.tempGrid.length, true);
    view.setFloat32(40, params.groupDelay, true);
    view.setUint32(44, params.moments.length, true);
    view.setUint32(48, params.opPointVelocities.length, true);
    this.device.queue.writeBuffer(this.paParamBuffer!, 0, new Uint8Array(paUniform));

    // Upload moments
    if (params.moments.length > 0) {
      const arr = new Float32Array(params.moments);
      if (this.paMomentsBuffer && this.paMomentsBuffer.size >= arr.byteLength) {
        this.device.queue.writeBuffer(this.paMomentsBuffer, 0, arr as Float32Array<ArrayBuffer>);
      } else {
        this.paMomentsBuffer?.destroy();
        this.paMomentsBuffer = this.device.createBuffer({
          size: Math.max(16, arr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paMomentsBuffer, 0, arr as Float32Array<ArrayBuffer>);
      }
    }

    // Upload operating point velocities
    if (params.opPointVelocities.length > 0) {
      const arr = new Float32Array(params.opPointVelocities);
      if (this.paOpVelBuffer && this.paOpVelBuffer.size >= arr.byteLength) {
        this.device.queue.writeBuffer(this.paOpVelBuffer, 0, arr as Float32Array<ArrayBuffer>);
      } else {
        this.paOpVelBuffer?.destroy();
        this.paOpVelBuffer = this.device.createBuffer({
          size: Math.max(16, arr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paOpVelBuffer, 0, arr as Float32Array<ArrayBuffer>);
      }
    }

    // Upload CrossWLF LUT grids
    // Upload Q grid
    if (params.qGrid.length > 0) {
      const arr = new Float32Array(params.qGrid);
      if (this.paQGridBuffer && this.paQGridBuffer.size >= arr.byteLength) {
        this.device.queue.writeBuffer(this.paQGridBuffer, 0, arr as Float32Array<ArrayBuffer>);
      } else {
        this.paQGridBuffer?.destroy();
        this.paQGridBuffer = this.device.createBuffer({
          size: Math.max(16, arr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paQGridBuffer, 0, arr as Float32Array<ArrayBuffer>);
      }
    }
    // Upload temp grid
    if (params.tempGrid.length > 0) {
      const arr = new Float32Array(params.tempGrid);
      if (this.paTempGridBuffer && this.paTempGridBuffer.size >= arr.byteLength) {
        this.device.queue.writeBuffer(this.paTempGridBuffer, 0, arr as Float32Array<ArrayBuffer>);
      } else {
        this.paTempGridBuffer?.destroy();
        this.paTempGridBuffer = this.device.createBuffer({
          size: Math.max(16, arr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paTempGridBuffer, 0, arr as Float32Array<ArrayBuffer>);
      }
    }
    // Upload P values
    if (params.pValues.length > 0) {
      const arr = new Float32Array(params.pValues);
      if (this.paPValuesBuffer && this.paPValuesBuffer.size >= arr.byteLength) {
        this.device.queue.writeBuffer(this.paPValuesBuffer, 0, arr as Float32Array<ArrayBuffer>);
      } else {
        this.paPValuesBuffer?.destroy();
        this.paPValuesBuffer = this.device.createBuffer({
          size: Math.max(16, arr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paPValuesBuffer, 0, arr as Float32Array<ArrayBuffer>);
      }
    }

    this.recreateComputeBindGroup();
  }

  setSelectedLine(lineNumber: number): void {
    this.selectedLine = lineNumber;
  }

  resetZoom(): void {
    this.viewRange = { ...this.totalRange };
    this.viewRangeCallback?.();
  }

  /**
   * Set the visible time range directly (clamped to the total range).
   * Used to zoom the miniplot to a G-code line selection.
   */
  setViewRange(tMin: number, tMax: number): void {
    if (!isFinite(tMin) || !isFinite(tMax) || tMax <= tMin) return;
    this.viewRange = this.clampRange({ tMin, tMax });
    this.viewRangeCallback?.();
  }

  /**
   * Set (or clear) the time-range selection band. When set, the view is
   * zoomed to the band (with a small margin) so the user sees the selected
   * quantity for just the selected G-code lines. Pass null to clear the
   * band and reset the view to the full range.
   */
  setSelectionRange(tMin: number | null, tMax: number | null): void {
    if (tMin === null || tMax === null) {
      this.selectionRange = null;
      this.resetZoom();
      return;
    }
    if (!isFinite(tMin) || !isFinite(tMax) || tMax <= tMin) return;
    this.selectionRange = { tMin, tMax };
    // Zoom to the selection with a ~10% margin on each side.
    const span = tMax - tMin;
    const margin = span * 0.1;
    this.setViewRange(tMin - margin, tMax + margin);
  }

  getAxisLabel(): string {
    return QUANTITY_LABELS[this.quantity];
  }

  getViewRange(): ViewRange {
    return { ...this.viewRange };
  }

  onViewRangeChange(callback: () => void): void {
    this.viewRangeCallback = callback;
  }

  handleWheel(_deltaY: number, _mouseX: number): boolean {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = _mouseX - rect.left;
    const t = this.viewRange.tMin + (mouseX / rect.width) * (this.viewRange.tMax - this.viewRange.tMin);
    const factor = _deltaY > 0 ? 1.1 : 0.9;
    const newSpan = (this.viewRange.tMax - this.viewRange.tMin) * factor;
    const newMin = t - (t - this.viewRange.tMin) * factor;
    const newMax = newMin + newSpan;
    this.viewRange = this.clampRange({ tMin: newMin, tMax: newMax });
    this.viewRangeCallback?.();
    return true;
  }

  startDrag(mouseX: number): void {
    this.isDragging = true;
    this.dragStartX = mouseX;
    this.dragStartTMin = this.viewRange.tMin;
    this.dragTSpan = this.viewRange.tMax - this.viewRange.tMin;
  }

  updateDrag(mouseX: number): void {
    if (!this.isDragging || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dx = mouseX - this.dragStartX;
    const dt = -(dx / rect.width) * this.dragTSpan;
    this.viewRange = this.clampRange({
      tMin: this.dragStartTMin + dt,
      tMax: this.dragStartTMin + this.dragTSpan + dt,
    });
    this.viewRangeCallback?.();
  }

  endDrag(): void {
    this.isDragging = false;
  }

  get dragging(): boolean {
    return this.isDragging;
  }

  private clampRange(range: ViewRange): ViewRange {
    const span = range.tMax - range.tMin;
    const totalSpan = this.totalRange.tMax - this.totalRange.tMin;
    if (span > totalSpan) {
      return { ...this.totalRange };
    }
    let tMin = range.tMin;
    if (tMin < this.totalRange.tMin) tMin = this.totalRange.tMin;
    let tMax = tMin + span;
    if (tMax > this.totalRange.tMax) {
      tMax = this.totalRange.tMax;
      tMin = tMax - span;
      if (tMin < this.totalRange.tMin) tMin = this.totalRange.tMin;
    }
    return { tMin, tMax };
  }

  resize(): void {
    this.resizeCanvas();
  }

  private ensureMsaa(w: number, h: number, sc: number): void {
    if (sc === 1) {
      if (this.msaaTexture) {
        this.msaaTexture.destroy();
        this.msaaTexture = null;
      }
      this.msaaSC = 1;
      this.msaaW = w;
      this.msaaH = h;
      return;
    }
    if (this.msaaTexture && this.msaaSC === sc && this.msaaW === w && this.msaaH === h) return;
    if (this.msaaTexture) this.msaaTexture.destroy();
    this.msaaTexture = this.device.createTexture({
      size: [w, h, 1],
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: sc,
    });
    this.msaaSC = sc;
    this.msaaW = w;
    this.msaaH = h;
  }

  render(): void {
    if (!this.context || !this.canvas || !this.computePipeline || !this.renderBindGroup) return;
    if (!this.wssData || this.wssData.arcs.length === 0 || !this.arcBuffer) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.container.getBoundingClientRect();
    const cw = Math.max(1, Math.floor(rect.width * dpr));
    const ch = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    // Plot rect in device pixels (margins scaled by DPR).
    const ml = MARGIN_LEFT * dpr;
    const mr = MARGIN_RIGHT * dpr;
    const mt = MARGIN_TOP * dpr;
    const mb = MARGIN_BOTTOM * dpr;
    const plotX = ml;
    const plotY = mt;
    const plotW = Math.max(1, cw - ml - mr);
    const plotH = Math.max(1, ch - mt - mb);

    this.outputPoints = Math.min(this.maxOutputPoints, Math.max(2, Math.floor(plotW)));

    // Update compute uniforms (24 bytes used, buffer is 32 for alignment)
    const cu = new ArrayBuffer(32);
    const cv = new DataView(cu);
    cv.setFloat32(0, this.viewRange.tMin, true);
    cv.setFloat32(4, this.viewRange.tMax, true);
    cv.setUint32(8, this.outputPoints, true);
    cv.setUint32(12, this.quantityToIndex(this.quantity), true);
    cv.setUint32(16, this.wssData.arcs.length, true);
    cv.setUint32(20, this.paParams?.algorithmId ?? 0, true);
    this.device.queue.writeBuffer(this.computeUniformBuffer!, 0, cu);

    // Render uniforms (15 × f32 + 1 × u32 = 64 bytes).
    const color = QUANTITY_COLORS[this.quantity];
    const xMajorStep = this.niceStep(this.viewRange.tMax - this.viewRange.tMin, 8);
    const yMajorStep = this.niceStep(this.yRange.max - this.yRange.min, 6);
    const ruData = new Float32Array(15);
    ruData[0] = this.viewRange.tMin;
    ruData[1] = this.viewRange.tMax;
    ruData[2] = this.yRange.min;
    ruData[3] = this.yRange.max;
    ruData[4] = plotX;
    ruData[5] = plotY;
    ruData[6] = plotW;
    ruData[7] = plotH;
    ruData[8] = cw;
    ruData[9] = ch;
    ruData[10] = xMajorStep;
    ruData[11] = yMajorStep;
    ruData[12] = color[0];
    ruData[13] = color[1];
    ruData[14] = color[2];
    this.device.queue.writeBuffer(this.renderUniformBuffer!, 0, ruData);
    const pointCountU32 = new Uint32Array([this.outputPoints]);
    this.device.queue.writeBuffer(this.renderUniformBuffer!, 60, pointCountU32);

    const sc = this.supportedSC[this.msaaIndex];
    this.ensureMsaa(cw, ch, sc);

    const encoder = this.device.createCommandEncoder();

    // 1) Compute pass — fill the point buffer.
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup!);
    computePass.dispatchWorkgroups(Math.ceil(this.outputPoints / 64));
    computePass.end();

    // 2) Render pass — grid + line strip.
    const canvasView = this.context.getCurrentTexture().createView();
    const colorAttachment: GPURenderPassColorAttachment = sc > 1
      ? {
          view: this.msaaTexture!.createView(),
          resolveTarget: canvasView,
          clearValue: { r: 0.10, g: 0.10, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'discard',
        }
      : {
          view: canvasView,
          clearValue: { r: 0.10, g: 0.10, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        };

    const renderPass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });

    // Grid (background).
    renderPass.setPipeline(this.gridPipelines[this.msaaIndex]);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(6);

    // Line strip — one vertex per pixel column.
    renderPass.setPipeline(this.linePipelines[this.msaaIndex]);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.draw(this.outputPoints);

    renderPass.end();

    this.device.queue.submit([encoder.finish()]);

    // 3) 2D overlay — axis ticks / labels / event markers / selected line.
    this.drawOverlay(rect.width, rect.height, dpr);
  }

  private quantityToIndex(q: WssPlotQuantity): number {
    switch (q) {
      case 'velocity': return 0;
      case 'acceleration': return 1;
      case 'jerk': return 2;
      case 'paExtruderVelocity': return 3;
      case 'paOffset': return 4;
    }
  }

  /// Nice tick step (matches the article's niceStep).
  private niceStep(range: number, targetCount: number): number {
    if (range <= 0) return 1;
    const raw = range / targetCount;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step: number;
    if (norm <= 1.5) step = 1;
    else if (norm <= 3) step = 2;
    else if (norm <= 7) step = 5;
    else step = 10;
    return step * mag;
  }

  private formatTick(v: number): string {
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1000 || abs < 1e-3) return v.toExponential(1);
    let s = v.toFixed(3);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  private formatTime(t: number): string {
    if (Math.abs(t) < 1) return t.toFixed(3);
    if (Math.abs(t) < 100) return t.toFixed(2);
    return t.toFixed(1);
  }

  private drawOverlay(cssW: number, cssH: number, dpr: number): void {
    const ctx = this.overlayCtx;
    if (!ctx || !this.overlayCanvas) return;
    const cw = this.overlayCanvas.width;
    const ch = this.overlayCanvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(dpr, dpr);

    const ml = MARGIN_LEFT, mr = MARGIN_RIGHT, mt = MARGIN_TOP, mb = MARGIN_BOTTOM;
    const px = ml, py = mt;
    const pw = cssW - ml - mr, ph = cssH - mt - mb;

    // ggplot-style axes: only left + bottom, with small outward tick marks.
    ctx.strokeStyle = 'rgba(180, 180, 190, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + ph);
    ctx.lineTo(px + pw, py + ph);
    ctx.stroke();

    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(200, 200, 210, 0.9)';

    // X axis ticks + labels (absolute time).
    const xStep = this.niceStep(this.viewRange.tMax - this.viewRange.tMin, 8);
    const xStart = Math.ceil(this.viewRange.tMin / xStep) * xStep;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = xStart; x <= this.viewRange.tMax + xStep * 0.001; x += xStep) {
      const sx = px + (x - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * pw;
      if (sx < px - 1 || sx > px + pw + 1) continue;
      ctx.beginPath();
      ctx.moveTo(sx, py + ph);
      ctx.lineTo(sx, py + ph + 4);
      ctx.stroke();
      ctx.fillText(this.formatTime(x), sx, py + ph + 6);
    }

    // Y axis ticks + labels.
    const yStep = this.niceStep(this.yRange.max - this.yRange.min, 6);
    const yStart = Math.ceil(this.yRange.min / yStep) * yStep;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = yStart; y <= this.yRange.max + yStep * 0.001; y += yStep) {
      const sy = py + (this.yRange.max - y) / (this.yRange.max - this.yRange.min) * ph;
      if (sy < py - 1 || sy > py + ph + 1) continue;
      ctx.beginPath();
      ctx.moveTo(px, sy);
      ctx.lineTo(px - 4, sy);
      ctx.stroke();
      ctx.fillText(this.formatTick(y), px - 6, sy);
    }

    // Y axis title (quantity label).
    ctx.save();
    ctx.translate(10, py + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(200, 200, 210, 0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(QUANTITY_LABELS[this.quantity], 0, 0);
    ctx.restore();

    // Event markers
    this.drawEventMarkers(ctx, py, py + ph, px, pw);

    // Selection range band (G-code line selection).
    if (this.selectionRange) {
      const sxMin = px + (this.selectionRange.tMin - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * pw;
      const sxMax = px + (this.selectionRange.tMax - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * pw;
      // Clamp to plot area for drawing.
      const x0 = Math.max(px, Math.min(px + pw, sxMin));
      const x1 = Math.max(px, Math.min(px + pw, sxMax));
      if (x1 > x0) {
        ctx.fillStyle = 'rgba(255, 204, 0, 0.12)';
        ctx.fillRect(x0, py, x1 - x0, ph);
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        if (sxMin >= px && sxMin <= px + pw) {
          ctx.beginPath();
          ctx.moveTo(sxMin, py);
          ctx.lineTo(sxMin, py + ph);
          ctx.stroke();
        }
        if (sxMax >= px && sxMax <= px + pw) {
          ctx.beginPath();
          ctx.moveTo(sxMax, py);
          ctx.lineTo(sxMax, py + ph);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // Selected line highlight
    if (this.selectedLine >= 0) {
      const t = this.lineToTime.get(this.selectedLine);
      if (t !== undefined && t >= this.viewRange.tMin && t <= this.viewRange.tMax) {
        const sx = px + (t - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * pw;
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, py);
        ctx.lineTo(sx, py + ph);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawEventMarkers(
    ctx: CanvasRenderingContext2D,
    plotTop: number,
    plotBottom: number,
    plotLeft: number,
    plotW: number,
  ): void {
    const drawLines = (lines: number[] | undefined, color: string) => {
      if (!lines) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const ln of lines) {
        const t = this.lineToTime.get(ln);
        if (t === undefined) continue;
        if (t < this.viewRange.tMin || t > this.viewRange.tMax) continue;
        const sx = plotLeft + (t - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * plotW;
        ctx.beginPath();
        ctx.moveTo(sx, plotTop);
        ctx.lineTo(sx, plotBottom);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    drawLines(this.eventLines.toolChangeLines, EVENT_COLORS.tool);
    drawLines(this.eventLines.tempChangeLines, EVENT_COLORS.temp);
    drawLines(this.eventLines.fanChangeLines, EVENT_COLORS.fan);
    drawLines(this.eventLines.coolantChangeLines, EVENT_COLORS.coolant);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.handleWheel(e.deltaY, e.clientX);
  }

  private onMouseDown(e: MouseEvent): void {
    this.startDrag(e.clientX);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isDragging) this.updateDrag(e.clientX);
  }

  private onMouseUp(): void {
    this.endDrag();
  }

  destroy(): void {
    this.canvas?.classList.remove('wss-miniplot-canvas');
    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.canvas = null;
    this.arcBuffer?.destroy();
    this.pointBuffer?.destroy();
    this.computeUniformBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
    this.msaaTexture?.destroy();
    this.msaaTexture = null;
    // PA buffers
    this.extrusionRatioBuffer?.destroy();
    this.paParamBuffer?.destroy();
    this.paMomentsBuffer?.destroy();
    this.paOpVelBuffer?.destroy();
    this.paQGridBuffer?.destroy();
    this.paTempGridBuffer?.destroy();
    this.paPValuesBuffer?.destroy();
  }
}
