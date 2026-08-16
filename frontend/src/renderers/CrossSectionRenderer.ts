/**
 * @file CrossSectionRenderer.ts
 * @brief WebGPU renderer for cross-section visualization.
 * Clips the toolpath at a Z-plane and renders the intersection.
 */

import type { TTHRData } from '../core/TthrParser';
import type { NBPData, NBPPiece } from '../core/NurbsParser';
import { tessellatePiece } from '../core/NurbsParser';
import { Mat4, Vec3 } from '../core/MathUtils';

export class CrossSectionRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;

  visible: boolean = false;
  planeZ: number = 0;
  planeTolerance: number = 0.1;

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
          return vec4<f32>(1.0, 0.5, 0.0, 1.0);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main', buffers: [{
        arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
      }] },
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

  updateData(data: TTHRData): void {
    if (!data.positions) return;
    const n = data.header.sampleCount;
    const axes = data.header.axisCount;
    const vertices: number[] = [];

    for (let i = 0; i < n - 1; i++) {
      const z0 = data.positions[i * axes + 2];
      const z1 = data.positions[(i + 1) * axes + 2];
      // Check if segment crosses the plane
      if ((z0 - this.planeZ) * (z1 - this.planeZ) < 0) {
        // Linear interpolation to find intersection
        const t = (this.planeZ - z0) / (z1 - z0);
        const x = data.positions[i * axes] + t * (data.positions[(i + 1) * axes] - data.positions[i * axes]);
        const y = data.positions[i * axes + 1] + t * (data.positions[(i + 1) * axes + 1] - data.positions[i * axes + 1]);
        vertices.push(x, y, this.planeZ);
      }
    }

    this.uploadVertices(vertices);
  }

  /**
   * Update cross-section from NURBS data.
   * Tessellates each piece and finds Z-plane intersections.
   */
  updateFromNurbs(data: NBPData): void {
    const dim = data.header.dim;
    const pieces = data.pieces;
    const vertices: number[] = [];

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const cpCount = piece.controlPoints.length / dim;
      // Adaptive tessellation — same logic as NurbsRenderer
      let segments: number;
      if (piece.degree === 1) {
        segments = 1;
      } else {
        segments = Math.max(8, Math.min(64, cpCount * piece.degree * 4));
      }

      const positions = tessellatePiece(piece, dim, segments);

      // Find Z-plane crossings in the tessellated line
      for (let j = 0; j < segments; j++) {
        const z0 = positions[j * 3 + 2];
        const z1 = positions[(j + 1) * 3 + 2];
        if ((z0 - this.planeZ) * (z1 - this.planeZ) < 0) {
          const t = (this.planeZ - z0) / (z1 - z0);
          const x = positions[j * 3] + t * (positions[(j + 1) * 3] - positions[j * 3]);
          const y = positions[j * 3 + 1] + t * (positions[(j + 1) * 3 + 1] - positions[j * 3 + 1]);
          vertices.push(x, y, this.planeZ);
        }
      }
    }

    this.uploadVertices(vertices);
  }

  private uploadVertices(vertices: number[]): void {
    const verts = new Float32Array(vertices);
    this.vertexCount = verts.length / 3;

    if (this.vertexBuffer) this.vertexBuffer.destroy();
    this.vertexBuffer = null;

    if (verts.byteLength === 0) return;

    this.vertexBuffer = this.device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, verts);
  }

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
