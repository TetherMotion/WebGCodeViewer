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
import { StateProfileData } from "@tether/viewer-core";
import { ColorMap } from "@tether/viewer-core";

export type NurbsColorAttribute = 'pieceIndex' | 'deviation' | 'zHeight' | 'extruderSpeed' | 'motion' | 'solid' | 'feedRate' | 'spindleRpm' | 'toolNumber' | 'coolant' | 'featureType' | 'velocity' | 'acceleration' | 'jerk' | 'time' | 'paOffset' | 'paVelocity';

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

  // Sampled state profile (group 3) — 1D (t, v, a, j) texture loaded from WSS
  private stateTexture: GPUTexture | null = null;
  private stateBindGroup: GPUBindGroup | null = null;
  private stateData: StateProfileData | null = null;
  private hasStateProfile: boolean = false;

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

  // PA storage buffers (group 2) — for GPU-side PA offset/velocity evaluation
  private paCpBuffer: GPUBuffer | null = null;
  private paKnotBuffer: GPUBuffer | null = null;
  private paMetaBuffer: GPUBuffer | null = null;
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
    colorAttribute: 'pieceIndex',
    lineWidth: 2.0,
    visible: true,
    showTravels: true,
    highlightRetractions: false,
    highlightOverhangs: false,
    zSeamVisible: false,
    highlightBridges: false,
    highlightSupport: false,
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
          useStateTexture: u32,
          _pad: array<f32, 4>,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var colorLUT: texture_1d<f32>;
        @group(0) @binding(2) var colorSampler: sampler;

        // ReNURBS storage buffers (group 1)
        @group(1) @binding(0) var<storage, read> renurbsCPs: array<f32>;
        @group(1) @binding(1) var<storage, read> renurbsKnots: array<f32>;
        @group(1) @binding(2) var<storage, read> renurbsMeta: array<u32>;

        // PA storage buffers (group 2) — same structure as group 1
        @group(2) @binding(0) var<storage, read> paCPs: array<f32>;
        @group(2) @binding(1) var<storage, read> paKnots: array<f32>;
        @group(2) @binding(2) var<storage, read> paMeta: array<u32>;

        // Sampled 1D state profile (group 3) — (time, velocity, acceleration, jerk)
        // Loaded with textureLoad because rgba32float is not filterable.
        @group(3) @binding(0) var stateTexture: texture_1d<f32>;

        const MAX_CP: u32 = 64u;

        /// Evaluate a 1-D B-spline (weights=1) at parameter u using De Boor's algorithm.
        /// @param cpBase  Index into renurbsCPs of the first control point
        /// @param cpCount Number of control points
        /// @param knotBase Index into renurbsKnots of the first knot
        /// @param degree  B-spline degree
        /// @param u       Parameter value in [0,1]
        fn evalBSpline1D(cpBase: u32, cpCount: u32, knotBase: u32, degree: u32, u: f32) -> f32 {
          if (cpCount == 0u) { return 0.0; }
          if (degree == 0u) { return renurbsCPs[cpBase]; }

          // Clamp u to knot domain
          let knotMin = renurbsKnots[knotBase + degree];
          let knotMax = renurbsKnots[knotBase + cpCount];
          let uClamped = clamp(u, knotMin, knotMax);

          // Find knot span k
          var k = degree;
          for (var i = degree; i < cpCount; i = i + 1u) {
            if (renurbsKnots[knotBase + i] <= uClamped && uClamped < renurbsKnots[knotBase + i + 1u]) {
              k = i;
              break;
            }
          }
          if (uClamped >= knotMax) { k = cpCount - 1u; }

          // De Boor recursion (1-D, weights=1)
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

        /// Evaluate a 1-D B-spline from PA storage buffers (same algorithm,
        /// different buffer bindings).
        fn evalPaBSpline(cpBase: u32, cpCount: u32, knotBase: u32, degree: u32, u: f32) -> f32 {
          if (cpCount == 0u) { return 0.0; }
          if (degree == 0u) { return paCPs[cpBase]; }

          let knotMin = paKnots[knotBase + degree];
          let knotMax = paKnots[knotBase + cpCount];
          let uClamped = clamp(u, knotMin, knotMax);

          var k = degree;
          for (var i = degree; i < cpCount; i = i + 1u) {
            if (paKnots[knotBase + i] <= uClamped && uClamped < paKnots[knotBase + i + 1u]) {
              k = i;
              break;
            }
          }
          if (uClamped >= knotMax) { k = cpCount - 1u; }

          var d: array<f32, 64>;
          for (var j = 0u; j <= degree; j = j + 1u) {
            d[j] = paCPs[cpBase + k - degree + j];
          }

          for (var r = 1u; r <= degree; r = r + 1u) {
            for (var j = degree; j >= r; j = j - 1u) {
              let i = k - degree + j;
              let kn0 = paKnots[knotBase + i];
              let b = paKnots[knotBase + j + degree - r + 1u] - kn0;
              let alpha = select(0.0, (uClamped - kn0) / b, b != 0.0);
              d[j] = (1.0 - alpha) * d[j - 1u] + alpha * d[j];
            }
          }

          return d[degree];
        }

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) colorValue: f32,
          @location(2) sampleIdx: f32,
          @location(3) segIndexU: vec2<f32>,  // x=segmentIndex, y=normalized arc length [0,1]
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) colorValue: f32,
          @location(1) dimmed: f32,
          @location(2) localU: f32,
          @location(3) segIndexX: f32,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);

          // Pass through the CPU-computed color value and the per-vertex parameters
          // needed to evaluate the state/ReNURBS/PA color source in the fragment shader.
          output.colorValue = input.colorValue;
          output.localU = input.segIndexU.y;
          output.segIndexX = input.segIndexU.x;

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
          // Determine the color value used to sample the LUT.  For CPU color modes
          // this is the input color value (negative means retraction highlight).
          // For state/ReNURBS/PA color modes it is computed here in the fragment
          // stage so that textureSample (which is not allowed in the vertex stage)
          // can be used for the 1D state profile texture.
          var cv = input.colorValue;

          if (uniforms.colorMode > 0u && uniforms.colorMode <= 4u) {
            var val: f32 = 0.0;
            if (uniforms.useStateTexture != 0u) {
              // rgba32float is not filterable, so we linearly interpolate by hand.
              let width = f32(textureDimensions(stateTexture, 0));
              let u = input.localU * (width - 1.0);
              let x0 = u32(floor(u));
              let x1 = min(x0 + 1u, u32(width) - 1u);
              let frac = u - f32(x0);
              let t0 = textureLoad(stateTexture, i32(x0), 0);
              let t1 = textureLoad(stateTexture, i32(x1), 0);
              let texel = mix(t0, t1, frac);
              // texel = (time, velocity, acceleration, jerk)
              switch (uniforms.colorMode) {
                case 1u: { val = texel.y; }        // velocity
                case 2u: { val = abs(texel.z); }   // acceleration
                case 3u: { val = abs(texel.w); }   // jerk
                case 4u: { val = texel.x; }        // time
                default: { val = 0.0; }
              }
            } else {
              let segIdx = u32(input.segIndexX);
              // Quantity index: colorMode 1=velocity(0), 2=accel(1), 3=jerk(2), 4=time(3)
              let qtyIdx = uniforms.colorMode - 1u;
              // Quantity metadata: 4 u32 per (segment, quantity): cpOffset, cpCount, knotOffset, degree
              let metaBase = segIdx * 4u * 4u + qtyIdx * 4u;
              let cpOffset = renurbsMeta[metaBase + 0u];
              let cpCount = renurbsMeta[metaBase + 1u];
              let knotOffset = renurbsMeta[metaBase + 2u];
              let degree = renurbsMeta[metaBase + 3u];
              val = evalBSpline1D(cpOffset, cpCount, knotOffset, degree, input.localU);
            }
            // Normalize to [0,1] using maxValue
            cv = select(0.0, val / uniforms.maxValue, uniforms.maxValue > 0.0);
          }

          // PA color modes: 5=paOffset, 6=paVelocity
          if (uniforms.colorMode >= 5u && uniforms.colorMode <= 6u) {
            let segIdx = u32(input.segIndexX);
            // PA quantity: 0=pressure_offset (mode 5), 1=extruder_velocity (mode 6)
            let qtyIdx = uniforms.colorMode - 5u;
            // PA has 2 quantities per segment
            let metaBase = segIdx * 2u * 4u + qtyIdx * 4u;
            let cpOffset = paMeta[metaBase + 0u];
            let cpCount = paMeta[metaBase + 1u];
            let knotOffset = paMeta[metaBase + 2u];
            let degree = paMeta[metaBase + 3u];
            if (cpCount > 0u) {
              let val = evalPaBSpline(cpOffset, cpCount, knotOffset, degree, input.localU);
              cv = select(0.0, val / uniforms.maxValue, uniforms.maxValue > 0.0);
            } else {
              cv = 0.0;
            }
          }

          let sampled = textureSample(colorLUT, colorSampler, cv);
          // Feature #3: Retraction highlight — original CPU colorValue < 0 means red
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
            arrayStride: 8,
            attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x2' }],
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
      size: 96,
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

    // Create dummy 1D state profile texture for group 3.
    this.createDummyStateTexture();
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
    const dummyCp = new Float32Array(1);
    const dummyKnot = new Float32Array(1);
    const dummyMeta = new Uint32Array(16);  // enough for a few PA segments/quantities

    this.paCpBuffer = this.device.createBuffer({
      size: NurbsRenderer.DUMMY_CP_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paCpBuffer, 0, dummyCp);

    this.paKnotBuffer = this.device.createBuffer({
      size: NurbsRenderer.DUMMY_KNOT_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paKnotBuffer, 0, dummyKnot);

    this.paMetaBuffer = this.device.createBuffer({
      size: NurbsRenderer.DUMMY_META_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paMetaBuffer, 0, dummyMeta);

    try {
      const paLayout = this.pipeline!.getBindGroupLayout(2);
      this.paBindGroup = this.device.createBindGroup({
        layout: paLayout,
        entries: [
          { binding: 0, resource: { buffer: this.paCpBuffer } },
          { binding: 1, resource: { buffer: this.paKnotBuffer } },
          { binding: 2, resource: { buffer: this.paMetaBuffer } },
        ],
      });
    } catch {
      // Pipeline does not require group 2 (should not happen with the current shader)
      this.paBindGroup = null;
    }
    this.hasPaData = false;
  }

  /**
   * Create a minimal 1x1 state profile texture for group 3. The pipeline auto
   * layout exposes @group(3), so a bind group must always be available.
   */
  private createDummyStateTexture(): void {
    this.stateTexture = this.device.createTexture({
      size: [1],
      dimension: '1d',
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const dummy = new Float32Array([0, 0, 0, 0]);
    this.device.queue.writeTexture(
      { texture: this.stateTexture },
      dummy,
      { bytesPerRow: 16 },
      { width: 1 },
    );

    try {
      const stateLayout = this.pipeline!.getBindGroupLayout(3);
      this.stateBindGroup = this.device.createBindGroup({
        layout: stateLayout,
        entries: [
          { binding: 0, resource: this.stateTexture.createView() },
        ],
      });
    } catch {
      this.stateBindGroup = null;
    }
    this.hasStateProfile = false;
    this.stateData = null;
  }

  /**
   * Update the 1D state profile texture from TSSP data. This replaces the
   * ReNURBS profile for velocity/acceleration/jerk/time color mapping.
   */
  updateStateProfile(data: StateProfileData): void {
    if (data.texels.length === 0 || data.sampleCount === 0) {
      this.createDummyStateTexture();
      return;
    }

    if (this.stateTexture && (this.stateTexture.width < data.sampleCount || this.stateTexture.format !== 'rgba32float')) {
      this.deferDestroy(this.stateTexture);
      this.stateTexture = null;
    }

    const sampleCount = data.sampleCount;
    if (!this.stateTexture) {
      this.stateTexture = this.device.createTexture({
        size: [sampleCount],
        dimension: '1d',
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }

    const texels = new Float32Array(data.texels);
    this.device.queue.writeTexture(
      { texture: this.stateTexture },
      texels,
      { bytesPerRow: texels.byteLength },
      { width: sampleCount },
    );

    try {
      const stateLayout = this.pipeline!.getBindGroupLayout(3);
      this.stateBindGroup = this.device.createBindGroup({
        layout: stateLayout,
        entries: [
          { binding: 0, resource: this.stateTexture.createView() },
        ],
      });
    } catch {
      this.stateBindGroup = null;
    }

    this.stateData = data;
    this.hasStateProfile = true;
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

    // Precompute max extruder speed for normalization
    let maxExtruderSpeed = 0;
    for (const p of pieces) {
      if (p.extruderSpeed > maxExtruderSpeed) maxExtruderSpeed = p.extruderSpeed;
    }

    const totalLength = data.header.totalLength || 0.0;
    let vertexOffset = 0;
    let totalSegments = 0;
    let pieceStartS = 0.0;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];

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

      for (let j = 0; j <= segments; j++) {
        allPositions.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
        allColors.push(colorValue);
        allSampleIndices.push(vertexOffset + j);
        // Per-vertex segment index + normalized arc length for state profile sampling.
        // y = global arc length / total path length, used to sample the 1D state texture.
        const sNorm = totalLength > 0.0 ? (pieceStartS + pieceDists[j]) / totalLength : 0.0;
        allSegIndexU.push(i, sNorm);
      }

      // Line indices: connect consecutive vertices within this piece
      for (let j = 0; j < segments; j++) {
        allIndices.push(vertexOffset + j, vertexOffset + j + 1);
      }

      pieceStartS += pieceDists[segments];
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
      return;
    }

    // Upload to GPU
    const posData = new Float32Array(allPositions);
    const colData = new Float32Array(allColors);
    const idxData = new Uint32Array(allIndices);
    const sampleIdxData = new Float32Array(allSampleIndices);
    const segIdxUData = new Float32Array(allSegIndexU);

    this.deferDestroy(this.positionBuffer);
    this.positionBuffer = this.device.createBuffer({
      label: 'NurbsRenderer.positionBuffer',
      size: posData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.positionBuffer, 0, posData);

    this.deferDestroy(this.colorBuffer);
    this.colorBuffer = this.device.createBuffer({
      size: colData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, colData);

    // Sample index buffer (for progress cutoff)
    this.deferDestroy(this.sampleIdxBuffer);
    this.sampleIdxBuffer = this.device.createBuffer({
      size: sampleIdxData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.sampleIdxBuffer, 0, sampleIdxData);

    // Segment index + normalized arc length buffer (for ReNURBS shader evaluation)
    this.deferDestroy(this.segIndexUBuffer);
    this.segIndexUBuffer = this.device.createBuffer({
      size: segIdxUData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.segIndexUBuffer, 0, segIdxUData);

    this.deferDestroy(this.indexBuffer);
    this.indexBuffer = this.device.createBuffer({
      size: idxData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, idxData);

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
   * Update PA (Pressure Advance) data for GPU-side PA coloring.
   * Uses the first PA algorithm (Linear) by default. The selected algorithm
   * can be changed via setPaAlgorithm().
   */
  updatePaData(paEntry: { allControlPoints: Float32Array; allKnots: Float32Array; quantityMeta: Uint32Array; maxOffset: number; maxVelocity: number }): void {
    if (!this.pipeline) return;

    this.hasPaData = paEntry.allControlPoints.length > 0;
    this.paMaxOffset = paEntry.maxOffset || 1.0;
    this.paMaxVelocity = paEntry.maxVelocity || 1.0;

    if (!this.hasPaData) return;

    // Create new storage buffers first, then swap. This keeps the previous
    // (possibly dummy) bind group valid until the replacement is ready, and
    // prevents a transient "no bind group at group 2" state during updates.
    const cpSize = Math.max(NurbsRenderer.DUMMY_CP_SIZE, paEntry.allControlPoints.byteLength);
    const knotSize = Math.max(NurbsRenderer.DUMMY_KNOT_SIZE, paEntry.allKnots.byteLength);
    const metaSize = Math.max(NurbsRenderer.DUMMY_META_SIZE, paEntry.quantityMeta.byteLength);

    const newCpBuffer = this.device.createBuffer({
      size: cpSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Pass the typed array (not .buffer) so writeBuffer only uploads the
    // view's byteLength, never the full underlying ArrayBuffer.
    this.device.queue.writeBuffer(newCpBuffer, 0, paEntry.allControlPoints as Float32Array<ArrayBuffer>);

    const newKnotBuffer = this.device.createBuffer({
      size: knotSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(newKnotBuffer, 0, paEntry.allKnots as Float32Array<ArrayBuffer>);

    const newMetaBuffer = this.device.createBuffer({
      size: metaSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(newMetaBuffer, 0, paEntry.quantityMeta as Uint32Array<ArrayBuffer>);

    try {
      const paLayout = this.pipeline.getBindGroupLayout(2);
      const newBindGroup = this.device.createBindGroup({
        layout: paLayout,
        entries: [
          { binding: 0, resource: { buffer: newCpBuffer } },
          { binding: 1, resource: { buffer: newKnotBuffer } },
          { binding: 2, resource: { buffer: newMetaBuffer } },
        ],
      });

      // Swap in the new buffers and bind group, then queue the old ones for destruction.
      this.deferDestroy(this.paCpBuffer);
      this.deferDestroy(this.paKnotBuffer);
      this.deferDestroy(this.paMetaBuffer);

      this.paCpBuffer = newCpBuffer;
      this.paKnotBuffer = newKnotBuffer;
      this.paMetaBuffer = newMetaBuffer;
      this.paBindGroup = newBindGroup;
    } catch {
      // Bind group creation failed (unexpected with the current shader); keep
      // the previous bind group so group 2 remains bound and destroy the new
      // buffers that won't be used.
      newCpBuffer.destroy();
      newKnotBuffer.destroy();
      newMetaBuffer.destroy();
      this.hasPaData = false;
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
   * Get the max value from the sampled state profile for the current color
   * attribute.
   */
  private getStateMaxValue(): number {
    if (!this.stateData) return 1.0;
    switch (this.options.colorAttribute) {
      case 'velocity': return this.stateData.maxVelocity || 1.0;
      case 'acceleration': return this.stateData.maxAcceleration || 1.0;
      case 'jerk': return this.stateData.maxJerk || 1.0;
      case 'time': return this.stateData.totalTime || 1.0;
      default: return 1.0;
    }
  }

  /**
   * Map color attribute to shader colorMode constant.
   * 0=cpuColorValue, 1=velocity, 2=accel, 3=jerk, 4=time
   * 5=paOffset, 6=paVelocity
   */
  private getColorMode(): number {
    switch (this.options.colorAttribute) {
      case 'velocity': return 1;
      case 'acceleration': return 2;
      case 'jerk': return 3;
      case 'time': return 4;
      case 'paOffset': return 5;
      case 'paVelocity': return 6;
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

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.options.visible || !this.pipeline || !this.positionBuffer || this.indexCount < 2) return;
    if (!this.uniformBuffer || !this.bindGroup || !this.colorBuffer || !this.sampleIdxBuffer || !this.indexBuffer) return;
    if (!this.segIndexUBuffer || !this.renurbsBindGroup || !this.stateBindGroup) return;

    // Destroy resources replaced during previous data updates.  This is done
    // after the previous frame's queue.submit() has finished using them.
    this.flushStaleResources();

    // Uniforms: viewProj(16 floats) + progress(1) + colorMode(u32) + maxValue(1)
    //           + useStateTexture(u32) + pad(4 floats) = 96 bytes
    const cm = this.getColorMode();
    const isPaMode = cm === 5 || cm === 6;
    const isKinematicMode = cm >= 1 && cm <= 4;
    const hasState = this.hasStateProfile && isKinematicMode;
    const colorMode = isKinematicMode
      ? (hasState ? cm : 0)
      : (isPaMode ? (this.hasPaData ? cm : 0) : cm);
    const maxValue = isPaMode
      ? (cm === 5 ? this.paMaxOffset : this.paMaxVelocity)
      : (hasState ? this.getStateMaxValue() : (this.hasReNurbs ? this.getReNurbsMaxValue() : 1.0));

    const uniformData = new ArrayBuffer(96);
    const view = new DataView(uniformData);
    for (let i = 0; i < 16; i++) view.setFloat32(i * 4, viewProj[i], true);
    view.setFloat32(64, this.progress, true);
    view.setUint32(68, colorMode, true);
    view.setFloat32(72, maxValue, true);
    view.setUint32(76, hasState ? 1 : 0, true);
    for (let i = 0; i < 4; i++) view.setFloat32(80 + i * 4, 0, true); // pad
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setBindGroup(1, this.renurbsBindGroup);
    // Group 2 is always bound: it points to real PA data after updatePaData() or
    // to the dummy buffers created in init() before PA data is loaded.
    if (this.paBindGroup) {
      pass.setBindGroup(2, this.paBindGroup);
    }
    // Group 3: 1D state profile texture (real or dummy).
    pass.setBindGroup(3, this.stateBindGroup);
    pass.setVertexBuffer(0, this.positionBuffer);
    pass.setVertexBuffer(1, this.colorBuffer);
    pass.setVertexBuffer(2, this.sampleIdxBuffer);
    pass.setVertexBuffer(3, this.segIndexUBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.colorBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.colorLUTTexture?.destroy();
    this.stateTexture?.destroy();
    this.sampleIdxBuffer?.destroy();
    this.segIndexUBuffer?.destroy();
    this.renurbsCpBuffer?.destroy();
    this.renurbsKnotBuffer?.destroy();
    this.renurbsMetaBuffer?.destroy();
    for (const r of this.staleResources) r.destroy();
    this.staleResources = [];
    this.cachedPositions = null;
  }
}
