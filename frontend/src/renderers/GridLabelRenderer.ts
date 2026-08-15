/**
 * @file GridLabelRenderer.ts
 * @brief WebGPU renderer for numeric grid labels rendered as 3D text quads
 * coplanar with the grid plane (z=0).
 *
 * Generates a bitmap glyph atlas for digits 0-9, '.', '-' on a 2D canvas at
 * init time, uploads it as a WebGPU texture, then renders textured quads in
 * world space for each tick label. The quads lie flat on the XY plane (z=0),
 * matching the grid plane. Text color matches the grid line color.
 *
 * This replaces the previous 2D canvas overlay (GridLabels.ts) with true
 * 3D WebGPU text that is part of the scene, not a screen-space overlay.
 */

import { Mat4 } from '../core/MathUtils';
import { TickInfo } from './GridRenderer';

// Grid line color (must match GridRenderer's gridColor)
const LABEL_COLOR: [number, number, number] = [0.25, 0.25, 0.27];

// Characters supported by the glyph atlas
const GLYPHS = '0123456789.-';
const NUM_GLYPHS = GLYPHS.length;

// Atlas dimensions
const GLYPH_CELL = 32; // pixels per glyph cell (square)
const ATLAS_COLS = 4;
const ATLAS_ROWS = Math.ceil(NUM_GLYPHS / ATLAS_COLS);
const ATLAS_W = ATLAS_COLS * GLYPH_CELL;
const ATLAS_H = ATLAS_ROWS * GLYPH_CELL;

// World-space character dimensions (mm) — 3x enlarged for readability
const CHAR_HEIGHT = 7.5;
const CHAR_WIDTH = 4.5;
const CHAR_GAP = 0.9;

// Label thinning: show every Nth tick to avoid clutter
const TICK_STRIDE = 2;

export class GridLabelRenderer {
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private atlasTexture: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private vertexCount: number = 0;

  private visibleFlag: boolean = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) { this.visibleFlag = v; }

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    // ── Generate glyph atlas on a 2D canvas ──
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_W;
    atlasCanvas.height = ATLAS_H;
    const ctx = atlasCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.floor(GLYPH_CELL * 0.75)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < NUM_GLYPHS; i++) {
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      const cx = col * GLYPH_CELL + GLYPH_CELL / 2;
      const cy = row * GLYPH_CELL + GLYPH_CELL / 2;
      ctx.fillText(GLYPHS[i], cx, cy);
    }

    // Upload atlas as WebGPU texture
    this.atlasTexture = this.device.createTexture({
      size: [ATLAS_W, ATLAS_H],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlasCanvas },
      { texture: this.atlasTexture },
      [ATLAS_W, ATLAS_H],
    );

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // ── Shader ──
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          viewProj: mat4x4<f32>,
          color: vec3<f32>,
          _pad: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var atlas: texture_2d<f32>;
        @group(0) @binding(2) var atlasSampler: sampler;

        struct VertexInput {
          @location(0) position: vec3<f32>,
          @location(1) uv: vec2<f32>,
        };
        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) uv: vec2<f32>,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.clipPosition = uniforms.viewProj * vec4<f32>(input.position, 1.0);
          output.uv = input.uv;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          let sampled = textureSample(atlas, atlasSampler, input.uv);
          // Use the red channel as alpha (white text on transparent bg)
          let alpha = sampled.r;
          return vec4<f32>(uniforms.color * alpha, alpha * 0.7);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 20, // 3 pos + 2 uv = 5 floats
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth32float',
        depthCompare: 'less',
        depthWriteEnabled: false, // don't occlude grid lines
      },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 80, // 64 (viewProj) + 12 (color) + 4 (pad)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.atlasTexture.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  /**
   * Build vertex data for all label quads from the grid's tick info.
   * Call this whenever the grid is rebuilt or ticks change.
   */
  updateLabels(ticks: TickInfo[]): void {
    const vertices: number[] = [];

    // Thin ticks: show every TICK_STRIDE-th tick
    const thinnedTicks = ticks.filter((_, i) => i % TICK_STRIDE === 0);
    // Always include the last tick if not already included
    if (ticks.length > 0 && thinnedTicks[thinnedTicks.length - 1] !== ticks[ticks.length - 1]) {
      thinnedTicks.push(ticks[ticks.length - 1]);
    }

    for (const tick of thinnedTicks) {
      const label = this.formatValue(tick.value);

      // Labels are placed OUTSIDE the grid:
      // X-axis ticks are at [p, tickLen, 0] — the grid edge is at Y=0,
      //   so labels go at negative Y (below the grid).
      // Y-axis ticks are at [tickLen, p, 0] — the grid edge is at X=0,
      //   so labels go at negative X (left of the grid).
      const labelMargin = 2; // mm gap from the grid edge
      let originX: number, originY: number;
      if (tick.axis === 0) {
        // X-axis: center the label below the grid edge (Y = 0)
        const labelWidth = label.length * (CHAR_WIDTH + CHAR_GAP) - CHAR_GAP;
        originX = tick.value - labelWidth / 2;
        originY = -CHAR_HEIGHT - labelMargin; // outside, below Y=0
      } else {
        // Y-axis: right-align the label to the left of the grid edge (X = 0)
        const labelWidth = label.length * (CHAR_WIDTH + CHAR_GAP) - CHAR_GAP;
        originX = -labelWidth - labelMargin; // outside, left of X=0
        originY = tick.value - CHAR_HEIGHT / 2;
      }

      // Render each character as a quad
      let cursorX = originX;
      for (const ch of label) {
        const glyphIdx = GLYPHS.indexOf(ch);
        if (glyphIdx < 0) {
          cursorX += CHAR_WIDTH + CHAR_GAP;
          continue;
        }

        const col = glyphIdx % ATLAS_COLS;
        const row = Math.floor(glyphIdx / ATLAS_COLS);
        const u0 = col * GLYPH_CELL / ATLAS_W;
        const v0 = row * GLYPH_CELL / ATLAS_H;
        const u1 = (col + 1) * GLYPH_CELL / ATLAS_W;
        const v1 = (row + 1) * GLYPH_CELL / ATLAS_H;

        const x0 = cursorX;
        const x1 = cursorX + CHAR_WIDTH;
        const y0 = originY;
        const y1 = originY + CHAR_HEIGHT;
        const z = 0; // coplanar with grid

        // Two triangles: (x0,y0) (x1,y0) (x1,y1) (x0,y1)
        // UV: top-left=(u0,v0), top-right=(u1,v0), bottom-right=(u1,v1), bottom-left=(u0,v1)
        // In world space: y1 is "top" (higher Y), y0 is "bottom" (lower Y)
        // In texture space: v0 is "top", v1 is "bottom"
        vertices.push(
          // Triangle 1: bottom-left, bottom-right, top-right
          x0, y0, z,  u0, v1,
          x1, y0, z,  u1, v1,
          x1, y1, z,  u1, v0,
          // Triangle 2: bottom-left, top-right, top-left
          x0, y0, z,  u0, v1,
          x1, y1, z,  u1, v0,
          x0, y1, z,  u0, v0,
        );

        cursorX += CHAR_WIDTH + CHAR_GAP;
      }
    }

    this.vertexCount = vertices.length / 5;

    // Destroy old buffer and create new one
    this.vertexBuffer?.destroy();
    if (vertices.length > 0) {
      const data = new Float32Array(vertices);
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

    const uniformData = new ArrayBuffer(80);
    const view = new Float32Array(uniformData);
    for (let i = 0; i < 16; i++) view[i] = viewProj[i];
    view[16] = LABEL_COLOR[0];
    view[17] = LABEL_COLOR[1];
    view[18] = LABEL_COLOR[2];
    view[19] = 0; // pad
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  private formatValue(v: number): string {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(1);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.atlasTexture?.destroy();
  }
}
