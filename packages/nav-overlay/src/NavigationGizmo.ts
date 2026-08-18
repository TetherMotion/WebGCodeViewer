/**
 * @file NavigationGizmo.ts
 * @brief WebGPU renderer for the CAD-like navigation axis gizmo.
 *
 * Draws three colored axis arrows (X=red, Y=green, Z=blue) that rotate
 * with the camera orientation. Rendered to a small separate canvas
 * overlaid on the main viewer.
 */

import type { Mat4 } from "@tether/viewer-core";

const AXIS_LENGTH = 0.7;
const AXIS_HEAD_SIZE = 0.15;

// Axis colors (RGB 0-1)
const COLORS = {
  X: [0.9, 0.2, 0.2] as [number, number, number], // red
  Y: [0.2, 0.8, 0.2] as [number, number, number], // green
  Z: [0.2, 0.4, 0.9] as [number, number, number], // blue
};

export class NavigationGizmo {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private depthTexture: GPUTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private axisBuffer: GPUBuffer | null = null;
  private lineBuffer: GPUBuffer | null = null;
  private colorBuffer: GPUBuffer | null = null;
  private lineColorBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private lineIndexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private lineBindGroup: GPUBindGroup | null = null;
  private sampleCount = 6; // 6 axis line vertices

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
          viewRot: mat4x4<f32>,
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
          // Apply only the camera's rotation (no translation), then
          // place in NDC directly. Set z=0.5 (middle of WebGPU's [0,1]
          // depth range) so axes are never clipped by the near/far planes
          // regardless of rotation direction.
          let rotated = uniforms.viewRot * vec4<f32>(input.position, 1.0);
          output.clipPosition = vec4<f32>(rotated.x, rotated.y, 0.5, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          return vec4<f32>(input.color, 1.0);
        }
      `,
    });

    // Triangle pipeline for arrow heads (no depth test — always visible)
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
            arrayStride: 12,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'always',
        depthWriteEnabled: false,
      },
    });

    // Line pipeline for axis shafts (no depth test — always visible)
    this.linePipeline = this.device.createRenderPipeline({
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
            arrayStride: 12,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'always',
        depthWriteEnabled: false,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind groups once during init (not lazily during render)
    this.lineBindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.buildGeometry();
    this.resize();
  }

  private buildGeometry(): void {
    // Build axis line segments (origin → tip) for each axis
    const lineVertices = new Float32Array([
      // X axis
      0, 0, 0,
      AXIS_LENGTH, 0, 0,
      // Y axis
      0, 0, 0,
      0, AXIS_LENGTH, 0,
      // Z axis
      0, 0, 0,
      0, 0, AXIS_LENGTH,
    ]);

    const lineColors = new Float32Array([
      ...COLORS.X, ...COLORS.X,
      ...COLORS.Y, ...COLORS.Y,
      ...COLORS.Z, ...COLORS.Z,
    ]);

    const lineIndices = new Uint32Array([0, 1, 2, 3, 4, 5]);

    this.lineBuffer = this.device.createBuffer({
      size: lineVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lineBuffer, 0, lineVertices);

    this.lineColorBuffer = this.device.createBuffer({
      size: lineColors.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lineColorBuffer, 0, lineColors);

    this.lineIndexBuffer = this.device.createBuffer({
      size: lineIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lineIndexBuffer, 0, lineIndices);

    // Build arrow heads (cones) for each axis
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    // X axis arrow head
    this.addArrowHead(positions, colors, indices, vertexOffset,
      [AXIS_LENGTH, 0, 0], [1, 0, 0], COLORS.X);
    // Each arrow head = 1 tip + 12 ring vertices = 13 vertices, 36 indices (12 triangles)
    vertexOffset += 13;

    this.addArrowHead(positions, colors, indices, vertexOffset,
      [0, AXIS_LENGTH, 0], [0, 1, 0], COLORS.Y);
    vertexOffset += 13;

    this.addArrowHead(positions, colors, indices, vertexOffset,
      [0, 0, AXIS_LENGTH], [0, 0, 1], COLORS.Z);

    const posArray = new Float32Array(positions);
    const colArray = new Float32Array(colors);
    const idxArray = new Uint32Array(indices);

    this.axisBuffer = this.device.createBuffer({
      size: posArray.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.axisBuffer, 0, posArray);

    this.colorBuffer = this.device.createBuffer({
      size: colArray.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, colArray);

    this.indexBuffer = this.device.createBuffer({
      size: idxArray.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, idxArray);
  }

  /**
   * Add a cone arrow head at the given tip position, pointing along the axis direction.
   * Generates 12 triangles (12 segments around the cone).
   */
  private addArrowHead(
    positions: number[], colors: number[], indices: number[],
    vertexOffset: number,
    tip: [number, number, number],
    dir: [number, number, number],
    color: [number, number, number],
  ): void {
    const segments = 12;
    const headLen = AXIS_HEAD_SIZE;
    const headRad = AXIS_HEAD_SIZE * 0.4;

    // Tip vertex
    positions.push(tip[0], tip[1], tip[2]);
    colors.push(...color);

    // Base center
    const baseX = tip[0] - dir[0] * headLen;
    const baseY = tip[1] - dir[1] * headLen;
    const baseZ = tip[2] - dir[2] * headLen;

    // Find two perpendicular vectors to dir
    let perp1: [number, number, number];
    let perp2: [number, number, number];
    if (Math.abs(dir[2]) < 0.9) {
      perp1 = [-dir[1], dir[0], 0];
    } else {
      perp1 = [0, -dir[2], dir[1]];
    }
    const p1len = Math.sqrt(perp1[0] ** 2 + perp1[1] ** 2 + perp1[2] ** 2);
    perp1 = [perp1[0] / p1len, perp1[1] / p1len, perp1[2] / p1len];
    // perp2 = dir × perp1
    perp2 = [
      dir[1] * perp1[2] - dir[2] * perp1[1],
      dir[2] * perp1[0] - dir[0] * perp1[2],
      dir[0] * perp1[1] - dir[1] * perp1[0],
    ];

    // Ring vertices
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      positions.push(
        baseX + (perp1[0] * c + perp2[0] * s) * headRad,
        baseY + (perp1[1] * c + perp2[1] * s) * headRad,
        baseZ + (perp1[2] * c + perp2[2] * s) * headRad,
      );
      colors.push(...color);
    }

    // Triangles: tip → ring[i] → ring[(i+1) % segments]
    for (let i = 0; i < segments; i++) {
      indices.push(
        vertexOffset,           // tip
        vertexOffset + 1 + i,   // ring[i]
        vertexOffset + 1 + ((i + 1) % segments), // ring[i+1]
      );
    }
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

  render(viewRot: Mat4): void {
    if (!this.device || !this.context || !this.pipeline || !this.linePipeline) return;
    if (!this.depthTexture || !this.uniformBuffer || !this.lineBindGroup || !this.bindGroup) return;

    // Update uniform (view rotation matrix)
    const uniformData = new ArrayBuffer(64);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewRot[i];
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

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

    // Draw axis lines
    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, this.lineBindGroup);
    pass.setVertexBuffer(0, this.lineBuffer!);
    pass.setVertexBuffer(1, this.lineColorBuffer!);
    pass.setIndexBuffer(this.lineIndexBuffer!, 'uint32');
    pass.drawIndexed(6);

    // Draw arrow heads
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.axisBuffer!);
    pass.setVertexBuffer(1, this.colorBuffer!);
    pass.setIndexBuffer(this.indexBuffer!, 'uint32');
    pass.drawIndexed(108); // 3 axes × 12 triangles × 3 indices

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.axisBuffer?.destroy();
    this.lineBuffer?.destroy();
    this.colorBuffer?.destroy();
    this.lineColorBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.lineIndexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
  }
}
