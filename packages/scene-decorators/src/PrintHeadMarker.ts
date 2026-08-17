/**
 * @file PrintHeadMarker.ts
 * @brief WebGPU renderer for a print head marker — a bright sphere
 * shown at the current playback position along the toolpath.
 */

import type { Mat4 } from "@tether/viewer-core";

export class PrintHeadMarker {
  private pipeline: GPURenderPipeline | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private visibleFlag = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) { this.visibleFlag = v; }

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          pointSize: f32,
          _pad: f32,
          _pad2: f32,
          _pad3: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec3<f32>,
        };

        @vertex
        fn vs_main(input: VertexInput) -> @builtin(position) vec4<f32> {
          let clip = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          // Scale point size by distance (closer = bigger)
          let size = uniforms.pointSize / clip.w * 100.0;
          // Output point size via builtin not available in WGSL directly,
          // so we use a fixed large size
          return clip;
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          // Bright cyan-white marker
          return vec4<f32>(0.3, 0.9, 1.0, 1.0);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'point-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.positionBuffer = this.device.createBuffer({
      size: 12,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 80, // 64 (viewProj) + 4 (pointSize) + 12 (padding)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  /**
   * Set the marker position in 3D world space.
   */
  setPosition(x: number, y: number, z: number): void {
    const data = new Float32Array([x, y, z]);
    this.device.queue.writeBuffer(this.positionBuffer!, 0, data);
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visibleFlag || !this.pipeline) return;

    const uniformData = new ArrayBuffer(80);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewProj[i];
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.positionBuffer!);
    pass.draw(1);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
