/**
 * @file GridRenderer.ts
 * @brief WebGPU renderer for a reference grid in the XY plane.
 */

import { Mat4 } from '../core/MathUtils';

export class GridRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;

  visible: boolean = true;
  gridSize: number = 200;
  gridDivisions: number = 20;

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms { viewProj: mat4x4<f32>, };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        @vertex
        fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
          return uniforms.viewProj * vec4<f32>(position, 1.0);
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(0.4, 0.4, 0.4, 0.5);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main', buffers: [{
        arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
      }] },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format, blend: {
        alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'line-list' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.buildGrid();
  }

  private buildGrid(): void {
    const half = this.gridSize / 2;
    const step = this.gridSize / this.gridDivisions;
    const lines: number[] = [];
    for (let i = 0; i <= this.gridDivisions; i++) {
      const p = -half + i * step;
      lines.push(p, -half, 0, p, half, 0);
      lines.push(-half, p, 0, half, p, 0);
    }
    const vertices = new Float32Array(lines);
    this.vertexCount = vertices.length / 3;

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
    if (!this.bindGroup) {
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer! } }],
      });
    }
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
