/**
 * @file DirectionCubeRenderer.ts
 * @brief WebGPU renderer for CAD-like direction cube buttons.
 *
 * Renders 7 small 3D cubes to a single canvas, each viewed from a
 * different direction. The face pointing toward the viewer is
 * highlighted (full color), all other faces are dimmed.
 * Uses WebGPU viewports to render each cube in its own grid cell.
 */

import { Mat4, mat4LookAt, mat4Ortho, mat4Multiply, Vec3 } from '../core/MathUtils';
import { ViewDirection } from '../ui/NavigationCube';

// Face indices
const FACE_PX = 0; // +X (right)
const FACE_NX = 1; // -X (left)
const FACE_PY = 2; // +Y (back)
const FACE_NY = 3; // -Y (front)
const FACE_PZ = 4; // +Z (top)
const FACE_NZ = 5; // -Z (bottom)

// Which face to highlight for each direction
const HIGHLIGHT_MAP: Record<ViewDirection, number> = {
  iso:    -1,   // no highlight (all faces full color)
  top:    FACE_PZ,
  bottom: FACE_NZ,
  front:  FACE_NY,
  back:   FACE_PY,
  right:  FACE_PX,
  left:   FACE_NX,
};

// View directions for each cube
const VIEW_PARAMS: Record<ViewDirection, { eye: Vec3; up: Vec3 }> = {
  iso:    { eye: { x: 2, y: -2, z: 2 },  up: { x: 0, y: 0, z: 1 } },
  top:    { eye: { x: 0, y: 0, z: 2 },   up: { x: 0, y: 1, z: 0 } },
  bottom: { eye: { x: 0, y: 0, z: -2 },  up: { x: 0, y: 1, z: 0 } },
  front:  { eye: { x: 0, y: -2, z: 0 },  up: { x: 0, y: 0, z: 1 } },
  back:   { eye: { x: 0, y: 2, z: 0 },   up: { x: 0, y: 0, z: 1 } },
  right:  { eye: { x: 2, y: 0, z: 0 },   up: { x: 0, y: 0, z: 1 } },
  left:   { eye: { x: -2, y: 0, z: 0 },  up: { x: 0, y: 0, z: 1 } },
};

const DIRECTIONS: ViewDirection[] = ['iso', 'top', 'front', 'right', 'left', 'back', 'bottom'];

export class DirectionCubeRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private depthTexture: GPUTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private cols = 4;
  private rows = 2;
  private cellSize = 36; // CSS pixels per cell

  // Uniform buffer slot size must be 256-byte aligned for dynamic offsets
  private static readonly UNIFORM_SLOT_SIZE = 256;
  private static readonly NUM_CUBES = 7;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    this.context = this.canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          highlightedFace: f32,
          _pad0: f32,
          _pad1: f32,
          _pad2: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) normal: vec3<f32>,
          @location(2) faceIdx: f32,
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) normal: vec3<f32>,
          @location(1) faceIdx: f32,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.normal = input.normal;
          output.faceIdx = input.faceIdx;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let faceIdx = i32(input.faceIdx);
          let highlighted = i32(uniforms.highlightedFace);

          // Base face colors: X=red, Y=green, Z=blue
          var color: vec3<f32>;
          if (faceIdx == 0 || faceIdx == 1) {
            color = vec3<f32>(0.85, 0.25, 0.25); // red
          } else if (faceIdx == 2 || faceIdx == 3) {
            color = vec3<f32>(0.25, 0.75, 0.25); // green
          } else {
            color = vec3<f32>(0.25, 0.45, 0.9);  // blue
          }

          // Dim non-highlighted faces
          if (highlighted >= 0 && faceIdx != highlighted) {
            color = color * 0.25;
          }

          // Simple directional lighting
          let lightDir = normalize(vec3<f32>(0.4, -0.4, 0.8));
          let ndotl = max(dot(normalize(input.normal), lightDir), 0.0);
          let lit = color * (0.45 + 0.55 * ndotl);

          return vec4<f32>(lit, 1.0);
        }
      `,
    });

    // Explicit bind group layout with dynamic offset for per-cube uniforms
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      }],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 28, // 3 pos + 3 normal + 1 faceIdx = 7 floats
          attributes: [
            { shaderLocation: 0, offset: 0,  format: 'float32x3' }, // position
            { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
            { shaderLocation: 2, offset: 24, format: 'float32' },   // faceIdx
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    // Build cube geometry: 6 faces × 4 vertices = 24 vertices
    const S = 0.5; // half-size
    const vertices = new Float32Array([
      // +X face (right) - faceIdx 0
      S, -S, -S,  1, 0, 0,  0,
      S,  S, -S,  1, 0, 0,  0,
      S,  S,  S,  1, 0, 0,  0,
      S, -S,  S,  1, 0, 0,  0,
      // -X face (left) - faceIdx 1
      -S, -S,  S,  -1, 0, 0,  1,
      -S,  S,  S,  -1, 0, 0,  1,
      -S,  S, -S,  -1, 0, 0,  1,
      -S, -S, -S,  -1, 0, 0,  1,
      // +Y face (back) - faceIdx 2
      -S,  S, -S,  0, 1, 0,  2,
      -S,  S,  S,  0, 1, 0,  2,
       S,  S,  S,  0, 1, 0,  2,
       S,  S, -S,  0, 1, 0,  2,
      // -Y face (front) - faceIdx 3
      -S, -S,  S,  0, -1, 0,  3,
       S, -S,  S,  0, -1, 0,  3,
       S, -S, -S,  0, -1, 0,  3,
      -S, -S, -S,  0, -1, 0,  3,
      // +Z face (top) - faceIdx 4
      -S, -S,  S,  0, 0, 1,  4,
      -S,  S,  S,  0, 0, 1,  4,
       S,  S,  S,  0, 0, 1,  4,
       S, -S,  S,  0, 0, 1,  4,
      // -Z face (bottom) - faceIdx 5
       S, -S, -S,  0, 0, -1,  5,
       S,  S, -S,  0, 0, -1,  5,
      -S,  S, -S,  0, 0, -1,  5,
      -S, -S, -S,  0, 0, -1,  5,
    ]);

    // 6 faces × 6 indices = 36 indices
    const indices = new Uint32Array([
      0, 1, 2,  0, 2, 3,       // +X
      4, 5, 6,  4, 6, 7,       // -X
      8, 9, 10, 8, 10, 11,     // +Y
      12, 13, 14, 12, 14, 15,  // -Y
      16, 17, 18, 16, 18, 19,  // +Z
      20, 21, 22, 20, 22, 23,  // -Z
    ]);

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

    this.uniformBuffer = this.device.createBuffer({
      size: DirectionCubeRenderer.UNIFORM_SLOT_SIZE * DirectionCubeRenderer.NUM_CUBES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group once — dynamic offset is set per-draw.
    // Must specify size: without it, the binding defaults to the full
    // buffer, and offset + fullSize overflows when hasDynamicOffset=true.
    const slotSize = DirectionCubeRenderer.UNIFORM_SLOT_SIZE;
    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.uniformBuffer,
          offset: 0,
          size: slotSize,
        },
      }],
    });

    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, this.canvas.clientWidth * dpr);
    const h = Math.max(1, this.canvas.clientHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [w, h],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Determine which direction cube was clicked based on canvas coordinates.
   * Returns null if the click is outside any cube cell.
   */
  hitTest(clientX: number, clientY: number): ViewDirection | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cellW = rect.width / this.cols;
    const cellH = rect.height / this.rows;
    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH);
    const idx = row * this.cols + col;
    if (idx < 0 || idx >= DIRECTIONS.length) return null;
    return DIRECTIONS[idx];
  }

  render(): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup) return;
    if (!this.vertexBuffer || !this.indexBuffer || !this.uniformBuffer || !this.depthTexture) return;

    const dpr = window.devicePixelRatio || 1;
    const cellW = Math.max(1, this.canvas.clientWidth * dpr / this.cols);
    const cellH = Math.max(1, this.canvas.clientHeight * dpr / this.rows);

    // ── Write all per-cube uniform data BEFORE recording the render pass ──
    // Each cube gets its own 256-byte slot in the uniform buffer.
    // We write all 7 slots now, then use dynamic offsets in setBindGroup.
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const dir = DIRECTIONS[i];
      const params = VIEW_PARAMS[dir];
      const view = mat4LookAt(params.eye, { x: 0, y: 0, z: 0 }, params.up);
      const proj = mat4Ortho(-0.8, 0.8, -0.8, 0.8, 0.1, 10);
      const viewProj = mat4Multiply(proj, view);

      const slotSize = DirectionCubeRenderer.UNIFORM_SLOT_SIZE;
      const uniformData = new ArrayBuffer(slotSize);
      const viewArr = new Float32Array(uniformData);
      for (let j = 0; j < 16; j++) viewArr[j] = viewProj[j];
      viewArr[16] = HIGHLIGHT_MAP[dir]; // highlightedFace
      this.device.queue.writeBuffer(
        this.uniformBuffer, i * slotSize, uniformData, 0, 80,
      );
    }

    // ── Record render pass ──
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');

    const slotSize = DirectionCubeRenderer.UNIFORM_SLOT_SIZE;

    for (let i = 0; i < DIRECTIONS.length; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);

      // Set viewport to this cell
      pass.setViewport(
        col * cellW, row * cellH,
        cellW, cellH,
        0, 1,
      );
      pass.setScissorRect(
        col * cellW, row * cellH,
        cellW, cellH,
      );

      // Bind uniform with dynamic offset for this cube's slot
      pass.setBindGroup(0, this.bindGroup, [i * slotSize]);
      pass.drawIndexed(36);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
  }
}
