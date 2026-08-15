/**
 * @file GridRenderer.ts
 * @brief WebGPU renderer for a reference grid in the XY plane with border tick marks.
 *
 * Tick marks are placed on the border edges of the grid (not on the axes
 * through the origin), so they don't overlap the toolpath. Labels are
 * rendered by GridLabels on a 2D overlay canvas.
 */

import { Mat4 } from '../core/MathUtils';

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
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;

  visible: boolean = true;
  gridSize: number = 200;
  gridDivisions: number = 20;

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

    this.uniformBuffer = this.device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.buildGrid();

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  private buildGrid(): void {
    const size = this.gridSize;
    const step = this.gridSize / this.gridDivisions;
    const tickLen = step * this.tickLength;

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

    // ── Grid lines — grid starts at (0,0) as its corner, extends to (size, size) ──
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = i * step;
      addLine(p, 0, 0, p, size, 0, gridColor); // vertical (constant X)
      addLine(0, p, 0, size, p, 0, gridColor); // horizontal (constant Y)
    }

    // ── Axis lines along the edges of the grid (darker) ──
    addLine(0, 0, 0, size, 0, 0, axisColor); // bottom edge (X axis)
    addLine(0, 0, 0, 0, size, 0, axisColor); // left edge (Y axis)

    // ── Tick marks on the BORDER edges ──
    // X-axis ticks: along the bottom edge (Y = 0), ticks extend inward (+Y)
    this.ticks = [];
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = i * step;
      // Tick mark on bottom edge
      addLine(p, 0, 0, p, tickLen, 0, tickColor);
      // Label position: just inside the tick, at the bottom edge
      this.ticks.push({ position: [p, tickLen, 0], value: p, axis: 0 });
    }

    // Y-axis ticks: along the left edge (X = 0), ticks extend inward (+X)
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = i * step;
      // Tick mark on left edge
      addLine(0, p, 0, tickLen, p, 0, tickColor);
      // Label position: just inside the tick, at the left edge
      this.ticks.push({ position: [tickLen, p, 0], value: p, axis: 1 });
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

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visible || !this.pipeline || !this.vertexBuffer) return;
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, viewProj.buffer as ArrayBuffer);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
