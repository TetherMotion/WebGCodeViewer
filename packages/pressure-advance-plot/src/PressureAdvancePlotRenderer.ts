/**
 * @file PressureAdvancePlotRenderer.ts
 * @brief WebGPU renderer that evaluates Pressure Advance analytically in a
 *        compute shader — one point per pixel column.
 *
 * Mirrors WssMiniplotRenderer but evaluates PA quantities (offset, extruder
 * velocity) instead of motion quantities (v, a, j). The renderer takes:
 *   - WSS arcs (from TWSF v2) — analytical path velocity profiles
 *   - Per-arc extrusion ratios (from TWSF v2) — maps path velocity to
 *     extruder velocity
 *   - PA parameters (from TWPA) — algorithm-specific parameters
 *
 * The compute shader binary-searches the arcs by t0, evaluates v_path(t)
 * from the arc's polynomial, multiplies by extrusionRatio to get
 * v_extruder(t), then applies the PA algorithm to compute offset(t).
 *
 * Supported algorithms:
 *   Linear:    offset = PA * v_extruder
 *   PowerLaw:  offset = baseGain * v_extruder^flowIndex
 *   CrossWLF:  offset = compressibility * P(Q, T) * area (bilinear LUT interp)
 *   LTI:       offset = Σ c_k(t) * M_k (moment-based deconvolution)
 *   LPV:       like LTI but interpolate moments by velocity
 */

import type { WssGpuData, PressureAdvanceParamBlock } from '@tether/viewer-core';

export type PressureAdvancePlotQuantity = 'offset' | 'extruderVelocity';

const QUANTITY_LABELS: Record<PressureAdvancePlotQuantity, string> = {
  offset: 'PA Offset (mm)',
  extruderVelocity: 'Extruder Velocity (mm/s)',
};

const QUANTITY_COLORS: Record<PressureAdvancePlotQuantity, [number, number, number]> = {
  offset: [0.4, 1.0, 0.4],
  extruderVelocity: [1.0, 0.8, 0.2],
};

// Arc layout: 12 floats per arc (matches WssParser.ts / WssData.hpp)
const ARC_FLOATS = 12;

interface ViewRange {
  tMin: number;
  tMax: number;
}

export class PressureAdvancePlotRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;

  private wssData: WssGpuData | null = null;
  private paParams: PressureAdvanceParamBlock | null = null;
  private quantity: PressureAdvancePlotQuantity = 'offset';

  private totalRange: ViewRange = { tMin: 0, tMax: 1 };
  private viewRange: ViewRange = { tMin: 0, tMax: 1 };
  private yRange: { min: number; max: number } = { min: 0, max: 1 };

  // GPU resources
  private arcBuffer: GPUBuffer | null = null;
  private extrusionRatioBuffer: GPUBuffer | null = null;
  private paParamBuffer: GPUBuffer | null = null;
  private pointBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeUniformBuffer: GPUBuffer | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private lineBindGroup: GPUBindGroup | null = null;
  private lineUniformBuffer: GPUBuffer | null = null;

  private outputPoints = 1;
  private readonly maxOutputPoints = 4096;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu')!;
  }

  async init(format: GPUTextureFormat): Promise<void> {
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    // ── Compute shader: analytical PA evaluation ──
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
          quantity: u32,      // 0=offset, 1=extruderVelocity
          arcCount: u32,
          algorithmId: u32,   // 0=Linear, 1=PowerLaw, 2=CrossWLF, 3=LTI, 4=LPV
          _pad: f32,
        };

        // PA parameters (algorithm-specific, packed into a uniform)
        // We use a fixed-size struct that covers all algorithms.
        struct PaParams {
          // Common
          maxCompensation: f32,
          smoothTime: f32,
          filamentDiameter: f32,
          // Linear
          pressureAdvance: f32,
          // PowerLaw
          powerLawBaseGain: f32,
          flowIndex: f32,
          // CrossWLF
          crossWlfCompressibility: f32,
          meltTempC: f32,
          qGridCount: u32,
          tempGridCount: u32,
          // LTI/LPV
          groupDelay: f32,
          momentCount: u32,
          opPointCount: u32,
          _pad1: f32,
          // Moments (LTI: 4, LPV: 4*opPointCount) — stored in a storage buffer
        };

        @group(0) @binding(0) var<uniform> uniforms: ComputeUniforms;
        @group(0) @binding(1) var<storage, read> arcs: array<WssArc>;
        @group(0) @binding(2) var<storage, read> extrusionRatios: array<f32>;
        @group(0) @binding(3) var<uniform> paParams: PaParams;
        @group(0) @binding(4) var<storage, read> paMoments: array<f32>;
        @group(0) @binding(5) var<storage, read> paOpVelocities: array<f32>;
        @group(0) @binding(6) var<storage, read> paQGrid: array<f32>;
        @group(0) @binding(7) var<storage, read> paTempGrid: array<f32>;
        @group(0) @binding(8) var<storage, read> paPValues: array<f32>;
        @group(0) @binding(9) var<storage, read_write> points: array<vec2<f32>>;

        /// Binary search for the arc whose time range contains t.
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

          // Clamp Q
          var qIdx: u32 = 0u;
          for (var i: u32 = 0u; i < qCount; i++) {
            if (paQGrid[i] <= q) { qIdx = i; } else { break; }
          }
          qIdx = min(qIdx, qCount - 1u);
          let qIdxHi = min(qIdx + 1u, qCount - 1u);
          let qFrac = select(0.0,
                             (q - paQGrid[qIdx]) / (paQGrid[qIdxHi] - paQGrid[qIdx]),
                             qIdxHi > qIdx);

          // Clamp T
          var tIdx: u32 = 0u;
          for (var i: u32 = 0u; i < tCount; i++) {
            if (paTempGrid[i] <= temp) { tIdx = i; } else { break; }
          }
          tIdx = min(tIdx, tCount - 1u);
          let tIdxHi = min(tIdx + 1u, tCount - 1u);
          let tFrac = select(0.0,
                             (temp - paTempGrid[tIdx]) / (paTempGrid[tIdxHi] - paTempGrid[tIdx]),
                             tIdxHi > tIdx);

          // Bilinear interpolation (LUT is temp-major: index = tIdx * qCount + qIdx)
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
            let Q = vExt * filamentArea;  // flow rate mm³/s
            let P = bilinearInterpLut(Q, paParams.meltTempC);
            offset = paParams.crossWlfCompressibility * P * filamentArea;
          } else if (algo == 3u) {
            // LTI Deconv: offset = Σ c_k(t) * M_k
            // For velocity mode: c_0 = α*(c0 + c1*t + c2*t²), c_1 = -α*(c1+2*c2*t), c_2 = α*c2
            // Simplified: use extruder velocity as the driving signal
            // offset ≈ v_extruder * M_0 (first-order approximation)
            if (paParams.momentCount > 0u) {
              offset = vExt * paMoments[0u];
            }
          } else if (algo == 4u) {
            // LPV Deconv: like LTI but interpolate moments by velocity
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

          // Clamp to max compensation
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

          var value: f32;
          if (uniforms.quantity == 0u) {
            value = evalPaOffset(t);
          } else {
            value = evalExtruderVelocity(t);
          }
          points[idx] = vec2<f32>(t, value);
        }
      `,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeShader, entryPoint: 'cs_main' },
    });

    this.computeUniformBuffer = this.device.createBuffer({
      size: 32, // 2 × f32 + 4 × u32 + 2 × f32 pad = 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pointBuffer = this.device.createBuffer({
      size: this.maxOutputPoints * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Dummy arc buffer
    this.arcBuffer = this.device.createBuffer({
      size: ARC_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.arcBuffer, 0, new Float32Array(ARC_FLOATS) as Float32Array<ArrayBuffer>);

    // Dummy extrusion ratio buffer
    this.extrusionRatioBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.extrusionRatioBuffer, 0, new Float32Array([0]) as Float32Array<ArrayBuffer>);

    // PA parameter uniform buffer
    this.paParamBuffer = this.device.createBuffer({
      size: 64, // PaParams struct (14 floats + 1 pad = 60 bytes, round to 64)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Dummy PA storage buffers
    this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    // ── Line render pipeline ──
    const renderShader = this.device.createShaderModule({
      code: `
        struct LineUniforms {
          tMin: f32,
          tMax: f32,
          yMin: f32,
          yMax: f32,
          color: vec3<f32>,
          pointCount: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: LineUniforms;

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
        };

        @vertex
        fn vs_main(@location(0) point: vec2<f32>) -> VertexOutput {
          var out: VertexOutput;
          let nx = (point.x - uniforms.tMin) / (uniforms.tMax - uniforms.tMin);
          let ny = select(0.0,
                          (point.y - uniforms.yMin) / (uniforms.yMax - uniforms.yMin),
                          uniforms.yMax > uniforms.yMin);
          out.position = vec4<f32>(2.0 * nx - 1.0, 2.0 * ny - 1.0, 0.0, 1.0);
          return out;
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(uniforms.color, 1.0);
        }
      `,
    });

    this.linePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        }],
      },
      fragment: {
        module: renderShader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-strip' },
    });

    this.lineUniformBuffer = this.device.createBuffer({
      size: 32, // 8 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lineBindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.lineUniformBuffer } },
      ],
    });

    // Create dummy storage buffers for PA data (moments, op velocities, LUT)
    const dummyMoments = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(dummyMoments, 0, new Float32Array([0,0,0,0]) as Float32Array<ArrayBuffer>);

    const dummyOpVel = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const dummyQGrid = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const dummyTempGrid = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const dummyPValues = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Store dummy buffers for later replacement
    this.paMomentsBuffer = dummyMoments;
    this.paOpVelBuffer = dummyOpVel;
    this.paQGridBuffer = dummyQGrid;
    this.paTempGridBuffer = dummyTempGrid;
    this.paPValuesBuffer = dummyPValues;

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.arcBuffer } },
        { binding: 2, resource: { buffer: this.extrusionRatioBuffer } },
        { binding: 3, resource: { buffer: this.paParamBuffer } },
        { binding: 4, resource: { buffer: this.paMomentsBuffer } },
        { binding: 5, resource: { buffer: this.paOpVelBuffer } },
        { binding: 6, resource: { buffer: this.paQGridBuffer } },
        { binding: 7, resource: { buffer: this.paTempGridBuffer } },
        { binding: 8, resource: { buffer: this.paPValuesBuffer } },
        { binding: 9, resource: { buffer: this.pointBuffer } },
      ],
    });
  }

  // Storage buffers for PA data (created in init, replaced in setPaParams)
  private paMomentsBuffer: GPUBuffer | null = null;
  private paOpVelBuffer: GPUBuffer | null = null;
  private paQGridBuffer: GPUBuffer | null = null;
  private paTempGridBuffer: GPUBuffer | null = null;
  private paPValuesBuffer: GPUBuffer | null = null;

  /**
   * Set the WSS data (arcs + extrusion ratios).
   */
  setWssData(data: WssGpuData): void {
    this.wssData = data;
    this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
    this.viewRange = { ...this.totalRange };
    this.uploadArcs(data);
  }

  /**
   * Set the PA parameters for the selected algorithm.
   */
  setPaParams(params: PressureAdvanceParamBlock): void {
    this.paParams = params;
    this.uploadPaParams(params);
    this.computeYRange();
  }

  /**
   * Set the quantity to plot (offset or extruder velocity).
   */
  setQuantity(q: PressureAdvancePlotQuantity): void {
    this.quantity = q;
    this.computeYRange();
  }

  private computeYRange(): void {
    if (!this.paParams) {
      this.yRange = { min: 0, max: 1 };
      return;
    }
    let minV: number, maxV: number;
    switch (this.quantity) {
      case 'offset':
        minV = -this.paParams.maxOffset * 1.1;
        maxV = this.paParams.maxOffset * 1.1;
        break;
      case 'extruderVelocity':
        minV = 0;
        maxV = this.paParams.maxVelocity * 1.05;
        break;
    }
    if (!isFinite(minV) || !isFinite(maxV) || minV >= maxV) {
      minV = 0;
      maxV = 1;
    }
    this.yRange = { min: minV, max: maxV };
  }

  private uploadArcs(data: WssGpuData): void {
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

    // Upload extrusion ratios
    const ratios = data.extrusionRatios;
    if (ratios && ratios.length > 0) {
      const ratioArr = new Float32Array(ratios);
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
    // 52..63 = padding
    this.device.queue.writeBuffer(this.paParamBuffer!, 0, new Uint8Array(paUniform));

    // Upload moments
    if (params.moments.length > 0) {
      const momentsArr = new Float32Array(params.moments);
      if (this.paMomentsBuffer && this.paMomentsBuffer.size >= momentsArr.byteLength) {
        this.device.queue.writeBuffer(this.paMomentsBuffer, 0, momentsArr as Float32Array<ArrayBuffer>);
      } else {
        this.paMomentsBuffer?.destroy();
        this.paMomentsBuffer = this.device.createBuffer({
          size: Math.max(16, momentsArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paMomentsBuffer, 0, momentsArr as Float32Array<ArrayBuffer>);
      }
    }

    // Upload operating point velocities
    if (params.opPointVelocities.length > 0) {
      const opVelArr = new Float32Array(params.opPointVelocities);
      if (this.paOpVelBuffer && this.paOpVelBuffer.size >= opVelArr.byteLength) {
        this.device.queue.writeBuffer(this.paOpVelBuffer, 0, opVelArr as Float32Array<ArrayBuffer>);
      } else {
        this.paOpVelBuffer?.destroy();
        this.paOpVelBuffer = this.device.createBuffer({
          size: Math.max(16, opVelArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paOpVelBuffer, 0, opVelArr as Float32Array<ArrayBuffer>);
      }
    }

    // Upload CrossWLF LUT
    if (params.qGrid.length > 0) {
      const qArr = new Float32Array(params.qGrid);
      if (this.paQGridBuffer && this.paQGridBuffer.size >= qArr.byteLength) {
        this.device.queue.writeBuffer(this.paQGridBuffer, 0, qArr as Float32Array<ArrayBuffer>);
      } else {
        this.paQGridBuffer?.destroy();
        this.paQGridBuffer = this.device.createBuffer({
          size: Math.max(16, qArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paQGridBuffer, 0, qArr as Float32Array<ArrayBuffer>);
      }
    }

    if (params.tempGrid.length > 0) {
      const tArr = new Float32Array(params.tempGrid);
      if (this.paTempGridBuffer && this.paTempGridBuffer.size >= tArr.byteLength) {
        this.device.queue.writeBuffer(this.paTempGridBuffer, 0, tArr as Float32Array<ArrayBuffer>);
      } else {
        this.paTempGridBuffer?.destroy();
        this.paTempGridBuffer = this.device.createBuffer({
          size: Math.max(16, tArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paTempGridBuffer, 0, tArr as Float32Array<ArrayBuffer>);
      }
    }

    if (params.pValues.length > 0) {
      const pArr = new Float32Array(params.pValues);
      if (this.paPValuesBuffer && this.paPValuesBuffer.size >= pArr.byteLength) {
        this.device.queue.writeBuffer(this.paPValuesBuffer, 0, pArr as Float32Array<ArrayBuffer>);
      } else {
        this.paPValuesBuffer?.destroy();
        this.paPValuesBuffer = this.device.createBuffer({
          size: Math.max(16, pArr.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.paPValuesBuffer, 0, pArr as Float32Array<ArrayBuffer>);
      }
    }

    this.recreateComputeBindGroup();
  }

  private recreateComputeBindGroup(): void {
    if (!this.computePipeline) return;
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
        { binding: 1, resource: { buffer: this.arcBuffer! } },
        { binding: 2, resource: { buffer: this.extrusionRatioBuffer! } },
        { binding: 3, resource: { buffer: this.paParamBuffer! } },
        { binding: 4, resource: { buffer: this.paMomentsBuffer! } },
        { binding: 5, resource: { buffer: this.paOpVelBuffer! } },
        { binding: 6, resource: { buffer: this.paQGridBuffer! } },
        { binding: 7, resource: { buffer: this.paTempGridBuffer! } },
        { binding: 8, resource: { buffer: this.paPValuesBuffer! } },
        { binding: 9, resource: { buffer: this.pointBuffer! } },
      ],
    });
  }

  getViewRange(): ViewRange {
    return { ...this.viewRange };
  }

  getAxisLabel(): string {
    return QUANTITY_LABELS[this.quantity];
  }

  resetZoom(): void {
    this.viewRange = { ...this.totalRange };
  }

  render(): void {
    if (!this.context || !this.computePipeline || !this.linePipeline) return;
    if (!this.wssData || !this.paParams) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const canvasWidth = Math.max(1, Math.floor(rect.width * dpr));
    this.outputPoints = Math.min(this.maxOutputPoints, canvasWidth);

    // Update compute uniforms
    const cu = new ArrayBuffer(32);
    const cv = new DataView(cu);
    cv.setFloat32(0, this.viewRange.tMin, true);
    cv.setFloat32(4, this.viewRange.tMax, true);
    cv.setUint32(8, this.outputPoints, true);
    cv.setUint32(12, this.quantity === 'offset' ? 0 : 1, true);
    cv.setUint32(16, this.wssData.arcs.length, true);
    cv.setUint32(20, this.paParams.algorithmId, true);
    // 24..31 = padding
    this.device.queue.writeBuffer(this.computeUniformBuffer!, 0, new Uint8Array(cu));

    // Update line uniforms
    const color = QUANTITY_COLORS[this.quantity];
    const lu = new Float32Array(8);
    lu[0] = this.viewRange.tMin;
    lu[1] = this.viewRange.tMax;
    lu[2] = this.yRange.min;
    lu[3] = this.yRange.max;
    lu[4] = color[0];
    lu[5] = color[1];
    lu[6] = color[2];
    lu[7] = this.outputPoints;
    this.device.queue.writeBuffer(this.lineUniformBuffer!, 0, lu as Float32Array<ArrayBuffer>);

    // Compute pass
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup!);
    computePass.dispatchWorkgroups(Math.ceil(this.outputPoints / 64));
    computePass.end();

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: [0.08, 0.08, 0.10, 1.0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.linePipeline);
    renderPass.setBindGroup(0, this.lineBindGroup!);
    renderPass.setVertexBuffer(0, this.pointBuffer!);
    renderPass.draw(this.outputPoints);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.arcBuffer?.destroy();
    this.extrusionRatioBuffer?.destroy();
    this.paParamBuffer?.destroy();
    this.paMomentsBuffer?.destroy();
    this.paOpVelBuffer?.destroy();
    this.paQGridBuffer?.destroy();
    this.paTempGridBuffer?.destroy();
    this.paPValuesBuffer?.destroy();
    this.pointBuffer?.destroy();
    this.computeUniformBuffer?.destroy();
    this.lineUniformBuffer?.destroy();
  }
}
