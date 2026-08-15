/**
 * @file NurbsRenderer.ts
 * @brief WebGPU renderer for NURBS path data (NBP format).
 *
 * Tessellates each NURBS piece on the CPU using De Boor's algorithm
 * and renders the resulting line segments via WebGPU. The tessellation
 * resolution is adaptive: longer pieces get more segments.
 *
 * Future: GPU tessellation via compute shader or vertex shader
 * evaluation for fully adaptive resolution based on zoom level.
 */

import { Mat4 } from '../core/MathUtils';
import { NBPData, NBPPiece, tessellatePiece } from '../core/NurbsParser';
import { ColorMap } from '../core/ColorMap';

export type NurbsColorAttribute = 'pieceIndex' | 'deviation' | 'zHeight' | 'motion' | 'solid';

export interface NurbsRenderOptions {
  colorMap: ColorMap;
  colorAttribute: NurbsColorAttribute;
  lineWidth: number;
  visible: boolean;
}

export class NurbsRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private colorBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private indexCount: number = 0;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private colorLUTTexture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private sampleIdxBuffer: GPUBuffer | null = null;
  private sampleCount: number = 0;
  private progress: number = 1.0;

  options: NurbsRenderOptions = {
    colorMap: new ColorMap('viridis'),
    colorAttribute: 'pieceIndex',
    lineWidth: 2.0,
    visible: true,
  };

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          progress: f32,
          _pad0: f32,
          _pad1: f32,
          _pad2: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var colorLUT: texture_1d<f32>;
        @group(0) @binding(2) var colorSampler: sampler;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) colorValue: f32,
          @location(2) sampleIdx: f32,
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) colorValue: f32,
          @location(1) dimmed: f32,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.colorValue = input.colorValue;
          let cutoff = uniforms.progress * f32(1000000.0);
          if (input.sampleIdx > cutoff) {
            output.dimmed = 1.0;
          } else {
            output.dimmed = 0.0;
          }
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let color = textureSample(colorLUT, colorSampler, input.colorValue);
          let finalColor = color.rgb * (1.0 - input.dimmed * 0.8);
          return vec4<f32>(finalColor, 1.0);
        }
      `,
    });

    // Color LUT texture (1D, RGBA — shader declares texture_1d<f32>)
    this.colorLUTTexture = this.device.createTexture({
      size: [256],
      dimension: '1d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

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
            arrayStride: 4,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32' }],
          },
          {
            arrayStride: 4,
            attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind group once during init (not lazily during render)
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.colorLUTTexture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Update the renderer with NURBS path data.
   * Tessellates each piece on CPU and uploads to GPU.
   */
  updateData(data: NBPData): void {
    const dim = data.header.dim;
    const pieces = data.pieces;
    if (pieces.length === 0) return;

    // Tessellate each piece and build combined vertex/index arrays
    const allPositions: number[] = [];
    const allColors: number[] = [];
    const allSampleIndices: number[] = [];
    const allIndices: number[] = [];

    let vertexOffset = 0;
    let totalSegments = 0;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      // Adaptive tessellation: more segments for higher-degree curves
      // and longer pieces
      const cpCount = piece.controlPoints.length / dim;
      let segments: number;
      if (piece.degree === 1) {
        // Linear — just 1 segment (2 vertices)
        segments = 1;
      } else {
        // Curved — adaptive based on degree and control point count
        segments = Math.max(8, Math.min(64, cpCount * piece.degree * 4));
      }

      const positions = tessellatePiece(piece, dim, segments);

      // Color value depends on the selected color attribute
      let colorValue: number;
      switch (this.options.colorAttribute) {
        case 'deviation': {
          // Deviation is 0-100, normalize to 0-1
          colorValue = piece.deviation / 100.0;
          break;
        }
        case 'zHeight': {
          // Color by Z position of the piece's first control point
          // Normalized using the header's Z bounds
          const zMin = data.header.boundsMin[2];
          const zMax = data.header.boundsMax[2];
          const zRange = zMax - zMin > 1e-12 ? zMax - zMin : 1;
          const z = piece.controlPoints.length >= dim ? piece.controlPoints[2] : 0;
          colorValue = (z - zMin) / zRange;
          break;
        }
        case 'motion': {
          // Map motion type to discrete colors (0=rapid, 1=linear, 2=arcCW, 3=arcCCW)
          colorValue = piece.motionType / 7.0;
          break;
        }
        case 'solid': {
          colorValue = 0.5;
          break;
        }
        case 'pieceIndex':
        default: {
          // Map piece index to 0..1 across all pieces
          colorValue = pieces.length > 1 ? i / (pieces.length - 1) : 0.5;
          break;
        }
      }

      for (let j = 0; j <= segments; j++) {
        allPositions.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
        allColors.push(colorValue);
        allSampleIndices.push(vertexOffset + j);
      }

      // Line indices: connect consecutive vertices within this piece
      for (let j = 0; j < segments; j++) {
        allIndices.push(vertexOffset + j, vertexOffset + j + 1);
      }

      vertexOffset += segments + 1;
      totalSegments += segments;
    }

    this.sampleCount = vertexOffset;
    this.indexCount = allIndices.length;

    // Upload to GPU
    const posData = new Float32Array(allPositions);
    const colData = new Float32Array(allColors);
    const idxData = new Uint32Array(allIndices);
    const sampleIdxData = new Float32Array(allSampleIndices);

    if (this.positionBuffer) this.positionBuffer.destroy();
    this.positionBuffer = this.device.createBuffer({
      size: posData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.positionBuffer, 0, posData);

    if (this.colorBuffer) this.colorBuffer.destroy();
    this.colorBuffer = this.device.createBuffer({
      size: colData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, colData);

    // Sample index buffer (for progress cutoff)
    const sampleIdxBuffer = this.device.createBuffer({
      size: sampleIdxData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(sampleIdxBuffer, 0, sampleIdxData);
    // Store on this for rendering
    this.sampleIdxBuffer = sampleIdxBuffer;

    if (this.indexBuffer) this.indexBuffer.destroy();
    this.indexBuffer = this.device.createBuffer({
      size: idxData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, idxData);

    // Update color LUT
    this.updateColorLUT();

    console.info(`NurbsRenderer: ${pieces.length} pieces → ${totalSegments} segments, ${this.indexCount} indices`);
  }

  private updateColorLUT(): void {
    if (!this.colorLUTTexture) return;
    const lut = this.options.colorMap.generateLUT(256); // RGB: 256×3 = 768 bytes
    // Convert RGB → RGBA for rgba8unorm texture (256×4 = 1024 bytes)
    const rgba = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      rgba[i * 4] = lut[i * 3];
      rgba[i * 4 + 1] = lut[i * 3 + 1];
      rgba[i * 4 + 2] = lut[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    this.device.queue.writeTexture(
      { texture: this.colorLUTTexture },
      rgba,
      { bytesPerRow: 256 * 4 },
      { width: 256 },
    );
  }

  setColorMap(map: ColorMap): void {
    this.options.colorMap = map;
    this.updateColorLUT();
  }

  setProgress(frac: number): void {
    this.progress = Math.max(0, Math.min(1, frac));
  }

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.options.visible || !this.pipeline || !this.positionBuffer || this.indexCount < 2) return;
    if (!this.uniformBuffer || !this.bindGroup || !this.colorBuffer || !this.sampleIdxBuffer || !this.indexBuffer) return;

    const uniformData = new ArrayBuffer(80);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewProj[i];
    view[16] = this.progress;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.positionBuffer);
    pass.setVertexBuffer(1, this.colorBuffer);
    pass.setVertexBuffer(2, this.sampleIdxBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.colorBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.colorLUTTexture?.destroy();
    this.sampleIdxBuffer?.destroy();
  }
}
