/**
 * @file OverlayRenderer.ts
 * @brief WebGPU renderer for overlay annotations (measurements, axis gizmo).
 */

import { Mat4, Vec3 } from "@tether/viewer-core";

export interface OverlayLine {
  start: Vec3;
  end: Vec3;
  color: [number, number, number];
}

export class OverlayRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;
  private lines: OverlayLine[] = [];

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
          return vec4<f32>(input.color, 1.0);
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
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  setLines(lines: OverlayLine[]): void {
    this.lines = lines;
    this.updateBuffer();
  }

  private updateBuffer(): void {
    const vertices = new Float32Array(this.lines.length * 6 * 2);
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      vertices[i * 12] = line.start.x;
      vertices[i * 12 + 1] = line.start.y;
      vertices[i * 12 + 2] = line.start.z;
      vertices[i * 12 + 3] = line.color[0];
      vertices[i * 12 + 4] = line.color[1];
      vertices[i * 12 + 5] = line.color[2];
      vertices[i * 12 + 6] = line.end.x;
      vertices[i * 12 + 7] = line.end.y;
      vertices[i * 12 + 8] = line.end.z;
      vertices[i * 12 + 9] = line.color[0];
      vertices[i * 12 + 10] = line.color[1];
      vertices[i * 12 + 11] = line.color[2];
    }
    this.vertexCount = this.lines.length * 2;

    if (this.vertexBuffer) this.vertexBuffer.destroy();
    this.vertexBuffer = null;

    if (vertices.byteLength === 0) return;

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  visible: boolean = true;

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visible || !this.pipeline || !this.vertexBuffer || this.vertexCount === 0) return;
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, viewProj as Float32Array<ArrayBuffer>);
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
