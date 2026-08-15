/**
 * @file ToolpathRenderer.ts
 * @brief WebGPU renderer for G-code toolpath line strips with color mapping.
 */

import type { TTHRData } from '../core/TthrParser';
import { ColorMap } from '../core/ColorMap';
import { Mat4 } from '../core/MathUtils';

export type ColorAttribute = 'velocity' | 'acceleration' | 'jerk' | 'curvature' | 'deviation' | 'motion' | 'segment' | 'solid';

export interface ToolpathRenderOptions {
  colorAttribute: ColorAttribute;
  colorMap: ColorMap;
  lineWidth: number;
  visible: boolean;
}

export class ToolpathRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private positionBuffer: GPUBuffer | null = null;
  private colorBuffer: GPUBuffer | null = null;
  private highlightBuffer: GPUBuffer | null = null;
  private sampleIndexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private indexCount: number = 0;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private sampleCount: number = 0;
  private hasHighlight = false;
  private progress: number = 1.0; // 0..1 fraction of path to show

  options: ToolpathRenderOptions = {
    colorAttribute: 'velocity',
    colorMap: new ColorMap('viridis'),
    lineWidth: 2.0,
    visible: true,
  };

  constructor(private device: GPUDevice) {}

  private colorLUTTexture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;

  async init(format: GPUTextureFormat): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          progress: f32,    // 0..1 fraction of path to show
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
          @location(2) highlight: f32,
          @location(3) sampleIdx: f32,
        };

        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) colorValue: f32,
          @location(1) highlight: f32,
          @location(2) dimmed: f32,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.colorValue = input.colorValue;
          output.highlight = input.highlight;
          // Dim samples beyond the progress cutoff
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
          // Blend toward bright white-yellow when highlighted
          let highlightColor = vec3<f32>(1.0, 0.95, 0.3);
          let blended = mix(color.rgb, highlightColor, input.highlight * 0.8);
          // Dim untraced portion to 20% brightness
          let finalColor = blended * (1.0 - input.dimmed * 0.8);
          return vec4<f32>(finalColor, 1.0);
        }
      `,
    });

    const lutTexture = this.device.createTexture({
      size: [256],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      dimension: '1d',
    });
    this.colorLUTTexture = lutTexture;

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
          {
            arrayStride: 4,
            attributes: [{ shaderLocation: 3, offset: 0, format: 'float32' }],
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
      size: 80, // 64 (viewProj) + 4 (progress) + 12 (padding)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.colorLUTTexture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  updateData(data: TTHRData): void {
    if (!data.positions) return;
    const n = data.header.sampleCount;
    const axes = data.header.axisCount;
    this.sampleCount = n;

    // Build line strip indices (pairs of consecutive points)
    const indices = new Uint32Array((n - 1) * 2);
    for (let i = 0; i < n - 1; i++) {
      indices[i * 2] = i;
      indices[i * 2 + 1] = i + 1;
    }
    this.indexCount = indices.length;

    // Position buffer
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = data.positions[i * axes];
      positions[i * 3 + 1] = data.positions[i * axes + 1];
      positions[i * 3 + 2] = data.positions[i * axes + 2];
    }

    if (this.positionBuffer) this.positionBuffer.destroy();
    this.positionBuffer = this.device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.positionBuffer, 0, positions);

    // Color value buffer (normalized 0-1)
    const colorValues = new Float32Array(n);
    let min = Infinity, max = -Infinity;
    let sourceArray: Float32Array | undefined;
    switch (this.options.colorAttribute) {
      case 'velocity': sourceArray = data.linearVelocity; break;
      case 'acceleration': sourceArray = data.linearAcceleration; break;
      case 'jerk': sourceArray = data.linearJerk; break;
      case 'curvature': sourceArray = data.curvature; break;
      case 'deviation': sourceArray = data.deviation; break;
      case 'motion': sourceArray = undefined; break;
      default: sourceArray = undefined;
    }
    if (sourceArray) {
      for (let i = 0; i < n; i++) {
        min = Math.min(min, sourceArray[i]);
        max = Math.max(max, sourceArray[i]);
      }
      const range = max - min > 1e-12 ? max - min : 1;
      for (let i = 0; i < n; i++) {
        colorValues[i] = (sourceArray[i] - min) / range;
      }
    } else {
      colorValues.fill(0.5);
    }

    if (this.colorBuffer) this.colorBuffer.destroy();
    this.colorBuffer = this.device.createBuffer({
      size: colorValues.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.colorBuffer, 0, colorValues);

    // Index buffer
    if (this.indexBuffer) this.indexBuffer.destroy();
    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

    // Highlight buffer (all zeros initially — no highlight)
    if (this.highlightBuffer) this.highlightBuffer.destroy();
    this.highlightBuffer = this.device.createBuffer({
      size: n * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.highlightBuffer, 0, new Float32Array(n));
    this.hasHighlight = false;

    // Sample index buffer (0, 1, 2, ... n-1) for progress cutoff
    const sampleIndices = new Float32Array(n);
    for (let i = 0; i < n; i++) sampleIndices[i] = i;
    if (this.sampleIndexBuffer) this.sampleIndexBuffer.destroy();
    this.sampleIndexBuffer = this.device.createBuffer({
      size: sampleIndices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.sampleIndexBuffer, 0, sampleIndices);

    // Update color LUT
    this.updateColorLUT();
  }

  /**
   * Highlight samples belonging to specific block indices.
   * Pass null or empty set to clear highlight.
   */
  setHighlight(blockIndices: Set<number> | null, data?: TTHRData): void {
    if (!this.highlightBuffer || !this.sampleCount) return;
    const n = this.sampleCount;
    const highlightValues = new Float32Array(n);

    if (blockIndices && blockIndices.size > 0 && data?.blockIndex) {
      for (let i = 0; i < n; i++) {
        if (blockIndices.has(data.blockIndex[i])) {
          highlightValues[i] = 1.0;
        }
      }
      this.hasHighlight = true;
    } else {
      this.hasHighlight = false;
    }

    this.device.queue.writeBuffer(this.highlightBuffer, 0, highlightValues);
  }

  clearHighlight(): void {
    if (!this.highlightBuffer || !this.sampleCount) return;
    this.device.queue.writeBuffer(this.highlightBuffer, 0, new Float32Array(this.sampleCount));
    this.hasHighlight = false;
  }

  /**
   * Set the progress fraction (0..1) for time-based playback.
   * Samples beyond this fraction are dimmed.
   */
  setProgress(frac: number): void {
    this.progress = Math.max(0, Math.min(1, frac));
  }

  /**
   * Get the position at a given progress fraction (0..1).
   * Returns null if no data is loaded.
   */
  getPositionAt(frac: number, data: TTHRData): [number, number, number] | null {
    if (!data.positions) return null;
    const n = data.header.sampleCount;
    const axes = data.header.axisCount;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(frac * (n - 1))));
    return [
      data.positions[idx * axes],
      data.positions[idx * axes + 1],
      data.positions[idx * axes + 2],
    ];
  }

  private updateColorLUT(): void {
    if (!this.colorLUTTexture) return;
    const lut = this.options.colorMap.generateLUT(256);
    // Convert RGB to RGBA
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

  render(pass: GPURenderPassEncoder, viewProj: Mat4): void {
    if (!this.options.visible || !this.pipeline || !this.positionBuffer || this.sampleCount < 2) return;

    // Update uniforms (viewProj + progress)
    const uniformData = new ArrayBuffer(80);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewProj[i];
    view[16] = this.progress; // progress at offset 64 bytes (index 16)
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.positionBuffer);
    pass.setVertexBuffer(1, this.colorBuffer!);
    pass.setVertexBuffer(2, this.highlightBuffer!);
    pass.setVertexBuffer(3, this.sampleIndexBuffer!);
    pass.setIndexBuffer(this.indexBuffer!, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  destroy(): void {
    this.positionBuffer?.destroy();
    this.colorBuffer?.destroy();
    this.highlightBuffer?.destroy();
    this.sampleIndexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.colorLUTTexture?.destroy();
  }
}
