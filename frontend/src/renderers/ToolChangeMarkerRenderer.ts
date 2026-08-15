/**
 * @file ToolChangeMarker.ts
 * @brief WebGPU renderer for tool change markers on the toolpath.
 *
 * Renders small diamond-shaped markers at 3D positions where tool changes
 * (M6) occur. Each marker is colored by tool number using a simple hash.
 */

import { Mat4 } from '../core/MathUtils';

export class ToolChangeMarkerRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;
  private visibleFlag = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) { this.visibleFlag = v; }

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
        };
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
          return vec4<f32>(input.color, 0.9);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 24, // 3 pos + 3 color
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
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
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  /**
   * Update marker positions. Each marker is a diamond shape at the given position.
   * @param markers Array of {position: [x,y,z], toolNumber: number}
   */
  updateMarkers(markers: { position: [number, number, number]; toolNumber: number }[]): void {
    const verts: number[] = [];
    const size = 3; // marker half-size in mm

    for (const m of markers) {
      // Color by tool number (hash to RGB)
      const t = m.toolNumber;
      const r = ((t * 73) % 100) / 100;
      const g = ((t * 127) % 100) / 100;
      const b = ((t * 191) % 100) / 100;
      const color = [0.4 + r * 0.6, 0.4 + g * 0.6, 0.4 + b * 0.6];

      const [x, y, z] = m.position;
      // Diamond shape: 4 lines forming a diamond in XY plane at z
      // Top, right, bottom, left points
      const top = [x, y + size, z];
      const right = [x + size, y, z];
      const bottom = [x, y - size, z];
      const left = [x - size, y, z];

      // 4 edges of the diamond
      for (const [a, b] of [[top, right], [right, bottom], [bottom, left], [left, top]] as number[][][]) {
        verts.push(a[0], a[1], a[2], color[0], color[1], color[2]);
        verts.push(b[0], b[1], b[2], color[0], color[1], color[2]);
      }

      // Vertical line through the diamond for visibility
      verts.push(x, y, z - size, color[0], color[1], color[2]);
      verts.push(x, y, z + size, color[0], color[1], color[2]);
    }

    this.vertexCount = verts.length / 6;
    this.vertexBuffer?.destroy();
    if (verts.length > 0) {
      const data = new Float32Array(verts);
      this.vertexBuffer = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.vertexBuffer, 0, data);
    } else {
      this.vertexBuffer = null;
    }
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.visibleFlag || !this.pipeline || !this.vertexBuffer || this.vertexCount === 0) return;
    if (!this.uniformBuffer || !this.bindGroup) return;

    const data = new Float32Array(16);
    for (let i = 0; i < 16; i++) data[i] = viewProj[i];
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

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
