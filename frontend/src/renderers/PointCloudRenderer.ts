/**
 * @file PointCloudRenderer.ts
 * @brief WebGPU renderer for point cloud visualization (comparison overlays).
 */

import type { TTHRData } from '../core/TthrParser';
import { Mat4 } from '../core/MathUtils';

export class PointCloudRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private pointCount: number = 0;

  visible: boolean = true;
  pointColor: [number, number, number] = [0.2, 0.8, 1.0];
  pointSize: number = 3.0;

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          pointSize: f32,
          _pad: f32,
          color: vec4<f32>,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        @vertex
        fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
          return uniforms.viewProj * vec4<f32>(position, 1.0);
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(uniforms.color.rgb, 0.8);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main', buffers: [{
        arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
      }] },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'point-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  updateData(data: TTHRData): void {
    if (!data.positions) return;
    const n = data.header.sampleCount;
    const axes = data.header.axisCount;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = data.positions[i * axes];
      positions[i * 3 + 1] = data.positions[i * axes + 1];
      positions[i * 3 + 2] = data.positions[i * axes + 2];
    }
    this.pointCount = n;

    if (this.positionBuffer) this.positionBuffer.destroy();
    this.positionBuffer = this.device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.positionBuffer, 0, positions);
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visible || !this.pipeline || !this.positionBuffer || this.pointCount === 0) return;
    const uniformData = new ArrayBuffer(96);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewProj[i];
    view[16] = this.pointSize;
    // view[17] = padding
    view[18] = this.pointColor[0];
    view[19] = this.pointColor[1];
    view[20] = this.pointColor[2];
    view[21] = 1.0; // alpha padding for vec4
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.positionBuffer);
    pass.draw(this.pointCount);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
