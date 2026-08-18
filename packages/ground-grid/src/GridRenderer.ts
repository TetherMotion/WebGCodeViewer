/**
 * @file GridRenderer.ts
 * @brief WebGPU renderer for a reference grid in the XY plane with border tick marks.
 *
 * Tick marks are placed on the border edges of the grid (not on the axes
 * through the origin), so they don't overlap the toolpath. Labels are
 * rendered by GridLabels on a 2D overlay canvas.
 */

import { Mat4 } from "@tether/viewer-core";

export interface TickInfo {
  /** World-space position where the label should be drawn. */
  position: [number, number, number];
  /** Numeric label value (mm). */
  value: number;
  /** Axis: 0=X (labels along bottom edge), 1=Y (labels along left edge). */
  axis: 0 | 1;
}

export class GridRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private checkerPipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private checkerVertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private checkerBindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;

  visible: boolean = true;
  gridSize: number = 200;
  gridDivisions: number = 20;

  /** Center of the grid in world space. The grid spans [center - size/2, center + size/2]. */
  centerX: number = 100;
  centerY: number = 100;

  /** Tick mark length as a fraction of grid step. */
  tickLength: number = 0.3;

  /** Cached tick info for label rendering. */
  ticks: TickInfo[] = [];

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms { viewProj: mat4x4<f32>, };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) color: vec3<f32>,
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) color: vec3<f32>,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          return vec4<f32>(input.color, 0.7);
        }

        // ── Checkerboard pipeline ──
        struct CheckerVertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) worldPos: vec2<f32>,
        };

        @vertex
        fn vs_checker(@location(0) position: vec3<f32>) -> CheckerVertexOutput {
          var output: CheckerVertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(position, 1.0);
          output.worldPos = position.xy;
          return output;
        }

        @fragment
        fn fs_checker(input: CheckerVertexOutput) -> @location(0) vec4<f32> {
          // Checkerboard: alternate squares based on cell coordinates
          let cellSize = ${this.gridSize.toFixed(1)} / ${this.gridDivisions}.0;
          let cx = floor(input.worldPos.x / cellSize);
          let cy = floor(input.worldPos.y / cellSize);
          let checker = (cx + cy) % 2.0;

          // Two shades of semi-transparent gray for the checkerboard
          let lightSquare = vec3<f32>(0.62, 0.63, 0.67);
          let darkSquare = vec3<f32>(0.52, 0.53, 0.57);
          let color = select(darkSquare, lightSquare, checker > 0.5);

          return vec4<f32>(color, 0.35);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader, entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: shader, entryPoint: 'fs_main',
        targets: [{ format, blend: {
          alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: false,
      },
    });

    // Checkerboard pipeline: renders a single quad, pattern computed in fragment shader
    this.checkerPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader, entryPoint: 'vs_checker',
        buffers: [{
          arrayStride: 12,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: shader, entryPoint: 'fs_checker',
        targets: [{ format, blend: {
          alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: false,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.buildGrid();
    this.buildChecker();

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    // Create a separate bind group for the checkerboard pipeline
    // (each 'auto' layout pipeline gets its own bind group layout)
    this.checkerBindGroup = this.device.createBindGroup({
      layout: this.checkerPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  private buildGrid(): void {
    const size = this.gridSize;
    const step = this.gridSize / this.gridDivisions;
    const tickLen = step * this.tickLength;
    // Grid spans from (cx - size/2) to (cx + size/2) in X, same in Y
    const x0 = this.centerX - size / 2;
    const y0 = this.centerY - size / 2;

    // Darker colors to contrast with the lighter background
    const gridColor: [number, number, number] = [0.25, 0.25, 0.27];
    const axisColor: [number, number, number] = [0.15, 0.15, 0.17]; // darker for axes
    const tickColor: [number, number, number] = [0.20, 0.20, 0.22];

    const lines: number[] = []; // x, y, z, r, g, b per vertex, 2 vertices per line

    const addLine = (
      x1: number, y1: number, z1: number,
      x2: number, y2: number, z2: number,
      color: [number, number, number],
    ) => {
      lines.push(x1, y1, z1, color[0], color[1], color[2]);
      lines.push(x2, y2, z2, color[0], color[1], color[2]);
    };

    // ── Grid lines — centered at (centerX, centerY) ──
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = x0 + i * step;  // X position
      addLine(p, y0, 0, p, y0 + size, 0, gridColor); // vertical (constant X)
      const q = y0 + i * step;  // Y position
      addLine(x0, q, 0, x0 + size, q, 0, gridColor); // horizontal (constant Y)
    }

    // ── Axis lines along the edges of the grid (darker) ──
    addLine(x0, y0, 0, x0 + size, y0, 0, axisColor); // bottom edge (X axis)
    addLine(x0, y0, 0, x0, y0 + size, 0, axisColor); // left edge (Y axis)

    // ── Tick marks on the BORDER edges ──
    // X-axis ticks: along the bottom edge (Y = y0), ticks extend inward (+Y)
    this.ticks = [];
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = x0 + i * step;
      // Tick mark on bottom edge
      addLine(p, y0, 0, p, y0 + tickLen, 0, tickColor);
      // Label position: just inside the tick, at the bottom edge
      this.ticks.push({ position: [p, y0 + tickLen, 0], value: p, axis: 0 });
    }

    // Y-axis ticks: along the left edge (X = x0), ticks extend inward (+X)
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = y0 + i * step;
      // Tick mark on left edge
      addLine(x0, p, 0, x0 + tickLen, p, 0, tickColor);
      // Label position: just inside the tick, at the left edge
      this.ticks.push({ position: [x0 + tickLen, p, 0], value: p, axis: 1 });
    }

    const vertices = new Float32Array(lines);
    this.vertexCount = vertices.length / 6;

    if (this.vertexBuffer) this.vertexBuffer.destroy();
    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  /** Build a single quad covering the grid area for the checkerboard pattern. */
  private buildChecker(): void {
    const s = this.gridSize;
    const x0 = this.centerX - s / 2;
    const y0 = this.centerY - s / 2;
    // Two triangles forming a quad centered at (centerX, centerY)
    const quad = new Float32Array([
      x0,       y0,       0,
      x0 + s,   y0,       0,
      x0 + s,   y0 + s,   0,
      x0,       y0,       0,
      x0 + s,   y0 + s,   0,
      x0,       y0 + s,   0,
    ]);

    if (this.checkerVertexBuffer) this.checkerVertexBuffer.destroy();
    this.checkerVertexBuffer = this.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.checkerVertexBuffer, 0, quad);
  }

  /**
   * Reposition the grid so its center is at (cx, cy).
   * Rebuilds grid geometry and tick positions. Returns the new tick array
   * so callers can update GridLabelRenderer.
   */
  setCenter(cx: number, cy: number): TickInfo[] {
    this.centerX = cx;
    this.centerY = cy;
    this.buildGrid();
    this.buildChecker();
    return this.ticks;
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visible || !this.pipeline || !this.vertexBuffer) return;
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, viewProj as Float32Array<ArrayBuffer>);

    // Draw checkerboard first (so grid lines render on top)
    if (this.checkerPipeline && this.checkerVertexBuffer && this.checkerBindGroup) {
      pass.setPipeline(this.checkerPipeline);
      pass.setBindGroup(0, this.checkerBindGroup);
      pass.setVertexBuffer(0, this.checkerVertexBuffer);
      pass.draw(6);
    }

    // Draw grid lines on top of checkerboard
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.checkerVertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
