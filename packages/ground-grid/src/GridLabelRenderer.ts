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

import { Mat4 } from "@tether/viewer-core";
import { TickInfo } from './GridRenderer';

// Grid line color (must match GridRenderer's gridColor)
const LABEL_COLOR: [number, number, number] = [0.25, 0.25, 0.27];

// Characters supported by the glyph atlas
const GLYPHS = '0123456789.-';
const NUM_GLYPHS = GLYPHS.length;

// Atlas layout: single row, variable-width cells measured per glyph.
const GLYPH_PX_H = 32;            // pixel height of each glyph cell
const GLYPH_PAD = 2;              // px padding around each glyph (anti-bleed)
// ATLAS_W / ATLAS_H are computed at init after measuring every glyph.

// World-space character height (mm). Per-glyph width is derived from the
// measured pixel width, preserving the font's natural aspect ratio.
const CHAR_HEIGHT = 7.5;

interface GlyphInfo {
  u0: number; v0: number; u1: number; v1: number;
  worldW: number; // world-space width (mm) for this glyph
}

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
  private glyphMap: Map<string, GlyphInfo> = new Map();

  private visibleFlag: boolean = true;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) { this.visibleFlag = v; }

  constructor(private device: GPUDevice) {}

  async init(format: GPUTextureFormat): Promise<void> {
    // ── Generate glyph atlas on a 2D canvas ──
    // Use a serif / math-friendly font stack and measure each glyph's
    // advance width so the atlas uses variable-width cells (no more
    // fixed-width look).
    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d')!;
    const fontPx = Math.floor(GLYPH_PX_H * 0.8);
    const fontStack = '"Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", Georgia, serif';
    mctx.font = `${fontPx}px ${fontStack}`;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';

    // Measure every glyph and build the cell layout (single row).
    const cellWidths: number[] = [];
    let totalW = 0;
    for (let i = 0; i < NUM_GLYPHS; i++) {
      const w = Math.ceil(mctx.measureText(GLYPHS[i]).width) + 2 * GLYPH_PAD;
      cellWidths.push(w);
      totalW += w;
    }
    const atlasW = totalW;
    const atlasH = GLYPH_PX_H;

    // Draw the atlas.
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = atlasW;
    atlasCanvas.height = atlasH;
    const ctx = atlasCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, atlasW, atlasH);
    ctx.fillStyle = 'white';
    ctx.font = `${fontPx}px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let xOff = 0;
    for (let i = 0; i < NUM_GLYPHS; i++) {
      const cw = cellWidths[i];
      const cx = xOff + cw / 2;
      const cy = atlasH / 2;
      ctx.fillText(GLYPHS[i], cx, cy);

      // Record glyph info: UVs + world-space width (proportional to pixel width).
      const worldW = CHAR_HEIGHT * cw / GLYPH_PX_H;
      this.glyphMap.set(GLYPHS[i], {
        u0: xOff / atlasW,
        v0: 0,
        u1: (xOff + cw) / atlasW,
        v1: 1,
        worldW,
      });
      xOff += cw;
    }

    // Upload atlas as WebGPU texture
    this.atlasTexture = this.device.createTexture({
      size: [atlasW, atlasH],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlasCanvas },
      { texture: this.atlasTexture },
      [atlasW, atlasH],
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

      // Look up glyph info (UVs + variable world width) from the atlas map.
      const glyphFor = (ch: string): GlyphInfo | null =>
        this.glyphMap.get(ch) ?? null;

      // Total label width = sum of per-glyph advance widths.
      let labelWidth = 0;
      for (const ch of label) {
        const g = glyphFor(ch);
        labelWidth += g ? g.worldW : CHAR_HEIGHT * 0.5;
      }

      if (tick.axis === 0) {
        // X-axis (red): rotate the label -90° about Z so the text runs along
        // Y (normal to the X axis being labeled), while remaining coplanar
        // with the grid plane (z=0). The label is centered on the tick in X
        // and placed just below the grid edge (negative Y).
        const pivotX = tick.value;
        const pivotY = -labelMargin - labelWidth / 2;
        const z = 0;
        let advance = 0; // cumulative unrotated X advance
        for (const ch of label) {
          const g = glyphFor(ch);
          const w = g ? g.worldW : CHAR_HEIGHT * 0.5;
          // Unrotated center X relative to label center.
          const cx = advance + w / 2 - labelWidth / 2;
          // After -90° about Z: (x,y) -> (y,-x), so the center maps to
          // (0, -cx) relative to the pivot.
          const yCenter = pivotY - cx;
          // Post-rotation half-extents: X = CHAR_HEIGHT/2, Y = w/2.
          const hx = CHAR_HEIGHT / 2;
          const hy = w / 2;
          const u0 = g ? g.u0 : 0, u1 = g ? g.u1 : 0;
          const v0 = g ? g.v0 : 0, v1 = g ? g.v1 : 1;
          vertices.push(
            // Triangle 1: BL, BR, TR
            pivotX - hx, yCenter + hy, z, u0, v1,
            pivotX - hx, yCenter - hy, z, u1, v1,
            pivotX + hx, yCenter - hy, z, u1, v0,
            // Triangle 2: BL, TR, TL
            pivotX - hx, yCenter + hy, z, u0, v1,
            pivotX + hx, yCenter - hy, z, u1, v0,
            pivotX + hx, yCenter + hy, z, u0, v0,
          );
          advance += w;
        }
      } else {
        // Y-axis: right-align the label to the left of the grid edge (X = 0)
        const originX = -labelWidth - labelMargin;
        const originY = tick.value - CHAR_HEIGHT / 2;

        let cursorX = originX;
        for (const ch of label) {
          const g = glyphFor(ch);
          const w = g ? g.worldW : CHAR_HEIGHT * 0.5;
          const x0 = cursorX;
          const x1 = cursorX + w;
          const y0 = originY;
          const y1 = originY + CHAR_HEIGHT;
          const z = 0; // coplanar with grid

          const u0 = g ? g.u0 : 0, u1 = g ? g.u1 : 0;
          const v0 = g ? g.v0 : 0, v1 = g ? g.v1 : 1;

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

          cursorX += w;
        }
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
