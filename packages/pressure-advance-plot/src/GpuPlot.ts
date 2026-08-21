/**
 * @file GpuPlot.ts
 * @brief WebGPU-accelerated multi-series plot for the "Motion profile &
 *        Pressure advance" panel.
 *
 * Uses the proven rendering pipeline from WssMiniplotRenderer:
 *   - MSAA line strips (probed sample counts, prefer 4×)
 *   - fwidth-based anti-aliased grid drawn on GPU (full-screen quad)
 *   - worldToClip mapping honouring plot margins (device pixels)
 *   - 2D canvas overlay for axis ticks / labels / legend / crosshair
 *   - DPR-aware canvas sizing
 *
 * The plot evaluates B-spline quantity curves (TRNP segments) on the CPU via
 * De Boor's algorithm and uploads the tessellated (time, value) points to a
 * per-series vertex buffer. Each visible series is drawn as a line strip with
 * a per-series colour uniform.
 *
 * A separate `PressureAdvancePlotRenderer` draws the analytical PA series on
 * top of this canvas using `loadOp:'load'`; it queries `getPlotRect()` /
 * `getViewRange()` / `getYRange()` from this host so the two renderers stay
 * aligned.
 */

import { evalBSpline1D, TRNPSegment } from "@tether/viewer-core";

export interface PlotSeries {
  name: string;
  color: [number, number, number];  // RGB 0-1
  visible: boolean;
  segments: TRNPSegment[];
  quantityIndex: number;  // 0=velocity, 1=accel, 2=jerk, 3=time, or PA: 0=offset, 1=velocity
  yLabel: string;
  normalizeMax: number;  // for y-axis scaling
}

export interface PlotOptions {
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  title: string;
  backgroundColor: [number, number, number, number];
  gridColor: [number, number, number, number];
  axisColor: [number, number, number, number];
  textColor: [number, number, number, number];
}

/// Plot rect in device pixels (used by the PA renderer to align).
export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/// Host interface exposed to the PA renderer so it can draw on top with the
/// same plot rect / view range / y range / MSAA texture.
export interface GpuPlotHost {
  getPlotRect(): PlotRect;
  getCanvasSize(): { w: number; h: number };
  getViewRange(): { xMin: number; xMax: number };
  getYRange(): { min: number; max: number };
  getMsaaSampleCount(): number;
  getMsaaTexture(): GPUTexture | null;
  /// The line pipeline + bind group layout so the PA renderer can reuse the
  /// same shader with its own uniform/vertex buffers.
  getLinePipeline(): GPURenderPipeline | null;
  getLineBindGroupLayout(): GPUBindGroupLayout | null;
}

// MSAA sample counts to probe (spec guarantees 1× and 4×).
const MSAA_SAMPLE_COUNTS = [1, 4];

// Plot margins in CSS pixels (scaled by DPR at render time).
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 12;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 28;

export class GpuPlot implements GpuPlotHost {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;

  // Render pipelines (article-style: line + grid, one pair per MSAA count).
  private linePipelines: GPURenderPipeline[] = [];
  private gridPipelines: GPURenderPipeline[] = [];
  private supportedSC: number[] = [];
  private msaaIndex = 0;
  private lineBindGroupLayout: GPUBindGroupLayout | null = null;

  // MSAA resolve texture.
  private msaaTexture: GPUTexture | null = null;
  private msaaSC = 0;
  private msaaW = 0;
  private msaaH = 0;

  // Per-series vertex buffers (CPU-tessellated B-spline points).
  private seriesVertexBuffers: GPUBuffer[] = [];
  private seriesVertexCounts: number[] = [];
  private uniformBuffer: GPUBuffer | null = null;

  private series: PlotSeries[] = [];
  private options: PlotOptions;

  // Current plot rect (device px) — updated each render().
  private plotRect: PlotRect = { x: 0, y: 0, w: 1, h: 1 };
  private canvasW = 1;
  private canvasH = 1;

  // View state
  private xMin = 0;
  private xMax = 1;
  private yMin = -1;
  private yMax = 1;
  private xMinData = 0;
  private xMaxData = 1;
  private yMinData = -1;
  private yMaxData = 1;

  // Interaction state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartXMin = 0;
  private dragStartXMax = 0;
  private dragStartYMin = 0;
  private dragStartYMax = 0;
  private mouseX = -1;
  private mouseY = -1;

  // Callbacks
  onCursorMove: ((x: number, y: number, values: { name: string; value: number }[]) => void) | null = null;
  onViewportChange: ((xMin: number, xMax: number, yMin: number, yMax: number) => void) | null = null;

  // Tessellation resolution per segment
  private readonly TESS_PER_SEG = 128;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, options?: Partial<PlotOptions>) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu')!;

    this.options = {
      width: canvas.width,
      height: canvas.height,
      xLabel: 'Time (s)',
      yLabel: 'Value',
      title: '',
      backgroundColor: [0.05, 0.05, 0.08, 1.0],
      gridColor: [0.3, 0.3, 0.35, 0.5],
      axisColor: [0.6, 0.6, 0.65, 1.0],
      textColor: [0.9, 0.9, 0.95, 1.0],
      ...options,
    };

    this.setupInteraction();
  }

  async init(format: GPUTextureFormat): Promise<void> {
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    // The 2D overlay canvas (axis ticks / labels / legend / crosshair) is
    // provided by the caller (WebGPUApp creates plotOverlayCanvas and calls
    // renderOverlay(ctx) with it). We don't create one here to avoid stacking
    // two transparent overlays.

    // ── Render shader (article-style line + grid pipelines) ──
    const renderShader = this.device.createShaderModule({
      code: `
        struct RenderUniforms {
          xMin          : f32,
          xMax          : f32,
          yMin          : f32,
          yMax          : f32,
          plotX         : f32,
          plotY         : f32,
          plotW         : f32,
          plotH         : f32,
          canvasW       : f32,
          canvasH       : f32,
          xMajorStep    : f32,
          yMajorStep    : f32,
          colorR        : f32,
          colorG        : f32,
          colorB        : f32,
          pointCount    : u32,
        };

        @group(0) @binding(0) var<uniform> ru : RenderUniforms;
        @group(0) @binding(1) var<storage, read> points : array<vec2<f32>>;

        // World → clip space, honouring plot margins (device pixels).
        fn worldToClip(x : f32, y : f32) -> vec4<f32> {
          let plotPx = (x - ru.xMin) / (ru.xMax - ru.xMin) * ru.plotW;
          let plotPy = (ru.yMax - y) / (ru.yMax - ru.yMin) * ru.plotH;
          let canvasPx = ru.plotX + plotPx;
          let canvasPy = ru.plotY + plotPy;
          return vec4<f32>(
            (canvasPx / ru.canvasW) * 2.0 - 1.0,
            1.0 - (canvasPy / ru.canvasH) * 2.0,
            0.0, 1.0
          );
        }

        // ── Line strip pipeline ─────────────────────────────────────────
        struct LineVSOut {
          @builtin(position) clipPos : vec4<f32>,
          @location(0)       color   : vec3<f32>,
        };

        @vertex
        fn vs_line(@builtin(vertex_index) vi : u32) -> LineVSOut {
          var out : LineVSOut;
          if (vi < ru.pointCount) {
            let p = points[vi];
            out.clipPos = worldToClip(p.x, p.y);
          } else {
            out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
          }
          out.color = vec3<f32>(ru.colorR, ru.colorG, ru.colorB);
          return out;
        }

        @fragment
        fn fs_line(in : LineVSOut) -> @location(0) vec4<f32> {
          return vec4<f32>(in.color, 1.0);
        }

        // ── Grid pipeline ───────────────────────────────────────────────
        struct GridVSOut {
          @builtin(position) clipPos : vec4<f32>,
          @location(0)       canvasPx : vec2<f32>,
        };

        @vertex
        fn vs_grid(@builtin(vertex_index) vi : u32) -> GridVSOut {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0, -1.0),
            vec2<f32>( 1.0,  1.0),
            vec2<f32>(-1.0, -1.0),
            vec2<f32>( 1.0,  1.0),
            vec2<f32>(-1.0,  1.0),
          );
          var out : GridVSOut;
          out.clipPos = vec4<f32>(pos[vi], 0.0, 1.0);
          out.canvasPx = vec2<f32>(
            (pos[vi].x * 0.5 + 0.5) * ru.canvasW,
            (1.0 - pos[vi].y * 0.5 - 0.5) * ru.canvasH,
          );
          return out;
        }

        fn gridLineDistPx(coord : f32, step : f32, pxPerWorld : f32) -> f32 {
          let p = coord / step;
          let frac_p = fract(p);
          let dWorld = min(frac_p, 1.0 - frac_p);
          return dWorld * pxPerWorld;
        }

        fn gridLineIntensity(distPx : f32, width : f32) -> f32 {
          return 1.0 - smoothstep(0.0, max(width, 0.0001), distPx);
        }

        @fragment
        fn fs_grid(in : GridVSOut) -> @location(0) vec4<f32> {
          let marginColor = vec3<f32>(0.10, 0.10, 0.12);
          let plotBg = vec3<f32>(0.13, 0.13, 0.16);

          let px = in.canvasPx.x;
          let py = in.canvasPx.y;
          let inside = px >= ru.plotX && px < ru.plotX + ru.plotW
                    && py >= ru.plotY && py < ru.plotY + ru.plotH;

          if (!inside) {
            return vec4<f32>(marginColor, 1.0);
          }

          let worldX = ru.xMin + (px - ru.plotX) / ru.plotW * (ru.xMax - ru.xMin);
          let worldY = ru.yMax - (py - ru.plotY) / ru.plotH * (ru.yMax - ru.yMin);

          let pxPerWorldX = ru.plotW / (ru.xMax - ru.xMin);
          let pxPerWorldY = ru.plotH / (ru.yMax - ru.yMin);

          let minorD = min(gridLineDistPx(worldX, ru.xMajorStep * 0.5, pxPerWorldX),
                           gridLineDistPx(worldY, ru.yMajorStep * 0.5, pxPerWorldY));
          let majorD = min(gridLineDistPx(worldX, ru.xMajorStep, pxPerWorldX),
                           gridLineDistPx(worldY, ru.yMajorStep, pxPerWorldY));

          let xMinor = gridLineIntensity(minorD, 1.0);
          let xMajor = gridLineIntensity(majorD, 1.0);

          let minorColor = vec3<f32>(0.20, 0.20, 0.24);
          let majorColor = vec3<f32>(0.32, 0.32, 0.38);

          var color = plotBg;
          color = mix(color, minorColor, xMinor * 0.5);
          color = mix(color, majorColor, xMajor * 0.7);

          return vec4<f32>(color, 1.0);
        }
      `,
    });

    this.lineBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.lineBindGroupLayout],
    });

    // Probe each MSAA sample count.
    for (const sc of MSAA_SAMPLE_COUNTS) {
      try {
        const [linePipe, gridPipe] = await Promise.all([
          this.device.createRenderPipelineAsync({
            layout: renderPipelineLayout,
            vertex: { module: renderShader, entryPoint: 'vs_line' },
            fragment: { module: renderShader, entryPoint: 'fs_line', targets: [{ format }] },
            primitive: { topology: 'line-strip' },
            multisample: { count: sc },
          }),
          this.device.createRenderPipelineAsync({
            layout: renderPipelineLayout,
            vertex: { module: renderShader, entryPoint: 'vs_grid' },
            fragment: { module: renderShader, entryPoint: 'fs_grid', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
            multisample: { count: sc },
          }),
        ]);
        this.supportedSC.push(sc);
        this.linePipelines.push(linePipe);
        this.gridPipelines.push(gridPipe);
      } catch {
        // Unsupported sample count — skip.
      }
    }
    if (this.supportedSC.length === 0) {
      this.supportedSC.push(1);
      this.linePipelines.push(this.device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module: renderShader, entryPoint: 'vs_line' },
        fragment: { module: renderShader, entryPoint: 'fs_line', targets: [{ format }] },
        primitive: { topology: 'line-strip' },
        multisample: { count: 1 },
      }));
      this.gridPipelines.push(this.device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module: renderShader, entryPoint: 'vs_grid' },
        fragment: { module: renderShader, entryPoint: 'fs_grid', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        multisample: { count: 1 },
      }));
    }
    const TARGET_SC = 4;
    const targetIdx = this.supportedSC.indexOf(TARGET_SC);
    this.msaaIndex = targetIdx !== -1 ? targetIdx : this.supportedSC.length - 1;

    // Render uniforms: 15 × f32 + 1 × u32 = 64 bytes.
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // ── GpuPlotHost interface (used by PressureAdvancePlotRenderer) ──

  getPlotRect(): PlotRect { return { ...this.plotRect }; }
  getCanvasSize(): { w: number; h: number } { return { w: this.canvasW, h: this.canvasH }; }
  getViewRange(): { xMin: number; xMax: number } { return { xMin: this.xMin, xMax: this.xMax }; }
  getYRange(): { min: number; max: number } { return { min: this.yMin, max: this.yMax }; }
  getMsaaSampleCount(): number { return this.supportedSC[this.msaaIndex]; }
  getMsaaTexture(): GPUTexture | null { return this.msaaTexture; }
  getLinePipeline(): GPURenderPipeline | null { return this.linePipelines[this.msaaIndex] ?? null; }
  getLineBindGroupLayout(): GPUBindGroupLayout | null { return this.lineBindGroupLayout; }

  /**
   * Set the series to plot. Each series has TRNP segments that are
   * tessellated on the CPU and rendered as line strips on GPU.
   */
  setSeries(series: PlotSeries[]): void {
    this.series = series;
    this.autoScale();
    this.uploadSeriesBuffers();
  }

  /**
   * Auto-scale axes to fit all visible series.
   */
  autoScale(): void {
    let yMin = Infinity, yMax = -Infinity;
    let xMin = Infinity, xMax = -Infinity;

    for (const s of this.series) {
      if (!s.visible) continue;
      for (const seg of s.segments) {
        if (seg.sStart < xMin) xMin = seg.sStart;
        if (seg.sEnd > xMax) xMax = seg.sEnd;
        const qty = seg.quantities[s.quantityIndex];
        if (qty.controlPoints.length === 0) continue;
        for (let i = 0; i < qty.controlPoints.length; i++) {
          const v = qty.controlPoints[i];
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }

    if (isFinite(xMin) && isFinite(xMax)) {
      this.xMinData = xMin;
      this.xMaxData = xMax;
      this.xMin = xMin;
      this.xMax = xMax;
    }
    if (isFinite(yMin) && isFinite(yMax)) {
      const range = yMax - yMin;
      const margin = range > 0 ? range * 0.1 : 0.1;
      this.yMinData = yMin - margin;
      this.yMaxData = yMax + margin;
      this.yMin = this.yMinData;
      this.yMax = this.yMaxData;
    }
  }

  /// Tessellate each visible series into a vertex buffer.
  private uploadSeriesBuffers(): void {
    // Destroy old buffers.
    for (const b of this.seriesVertexBuffers) b.destroy();
    this.seriesVertexBuffers = [];
    this.seriesVertexCounts = [];

    for (const s of this.series) {
      if (!s.visible) {
        this.seriesVertexBuffers.push(this.device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
        this.seriesVertexCounts.push(0);
        continue;
      }
      const points = this.tessellateSeries(s);
      const buf = this.device.createBuffer({
        size: Math.max(8, points.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buf, 0, points as Float32Array<ArrayBuffer>);
      this.seriesVertexBuffers.push(buf);
      this.seriesVertexCounts.push(points.length / 2);
    }
  }

  /**
   * Tessellate a series into (time, value) points for GPU rendering.
   */
  private tessellateSeries(s: PlotSeries): Float32Array {
    const points: number[] = [];
    for (const seg of s.segments) {
      const qty = seg.quantities[s.quantityIndex];
      if (qty.controlPoints.length === 0) continue;
      const segLen = seg.sEnd - seg.sStart;
      for (let i = 0; i <= this.TESS_PER_SEG; i++) {
        const t = i / this.TESS_PER_SEG;
        const u = t;
        const time = seg.sStart + t * segLen;
        const value = evalBSpline1D(qty.controlPoints, qty.knots, qty.degree, u);
        points.push(time, value);
      }
    }
    return new Float32Array(points);
  }

  private ensureMsaa(w: number, h: number, sc: number): void {
    if (!this.device) return;
    if (this.msaaTexture && this.msaaSC === sc && this.msaaW === w && this.msaaH === h) return;
    if (this.msaaTexture) this.msaaTexture.destroy();
    this.msaaTexture = this.device.createTexture({
      size: [w, h, 1],
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: sc,
    });
    this.msaaSC = sc;
    this.msaaW = w;
    this.msaaH = h;
  }

  /**
   * Render the plot: grid + all visible series (MSAA line strips).
   * The PA renderer draws on top afterwards via renderOverlaySeries().
   */
  render(): void {
    if (!this.linePipelines.length || !this.uniformBuffer || !this.context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cw = Math.max(1, Math.floor(rect.width * dpr));
    const ch = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.canvasW = cw;
    this.canvasH = ch;

    // Plot rect in device pixels (margins scaled by DPR).
    const ml = MARGIN_LEFT * dpr;
    const mr = MARGIN_RIGHT * dpr;
    const mt = MARGIN_TOP * dpr;
    const mb = MARGIN_BOTTOM * dpr;
    this.plotRect = {
      x: ml,
      y: mt,
      w: Math.max(1, cw - ml - mr),
      h: Math.max(1, ch - mt - mb),
    };

    const xMajorStep = this.niceStep(this.xMax - this.xMin, 8);
    const yMajorStep = this.niceStep(this.yMax - this.yMin, 6);

    const sc = this.supportedSC[this.msaaIndex];
    this.ensureMsaa(cw, ch, sc);

    const encoder = this.device.createCommandEncoder();

    const canvasView = this.context.getCurrentTexture().createView();
    const colorAttachment: GPURenderPassColorAttachment = sc > 1
      ? {
          view: this.msaaTexture!.createView(),
          resolveTarget: canvasView,
          clearValue: { r: 0.10, g: 0.10, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'discard',
        }
      : {
          view: canvasView,
          clearValue: { r: 0.10, g: 0.10, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        };

    const renderPass = encoder.beginRenderPass({ colorAttachments: [colorAttachment] });

    // 1) Grid (background).
    this.writeRenderUniforms(this.plotRect, xMajorStep, yMajorStep, [1, 1, 1], 6);
    const gridBindGroup = this.device.createBindGroup({
      layout: this.lineBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        // The grid shader doesn't read points, but the bind group layout
        // requires a storage buffer at binding 1. Use a dedicated dummy
        // storage buffer (NOT a vertex buffer — that would trigger a
        // usage-mismatch validation warning).
        { binding: 1, resource: { buffer: this.dummyStorage() } },
      ],
    });
    renderPass.setPipeline(this.gridPipelines[this.msaaIndex]);
    renderPass.setBindGroup(0, gridBindGroup);
    renderPass.draw(6);

    // 2) Each visible series as a line strip.
    for (let i = 0; i < this.series.length; i++) {
      const s = this.series[i];
      if (!s.visible) continue;
      const count = this.seriesVertexCounts[i];
      if (count === 0) continue;
      this.writeRenderUniforms(this.plotRect, xMajorStep, yMajorStep, s.color, count);
      const bindGroup = this.device.createBindGroup({
        layout: this.lineBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.seriesVertexBuffers[i] } },
        ],
      });
      renderPass.setPipeline(this.linePipelines[this.msaaIndex]);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(count);
    }

    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private dummyStorageCached: GPUBuffer | null = null;
  private dummyStorage(): GPUBuffer {
    if (!this.dummyStorageCached) {
      this.dummyStorageCached = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    return this.dummyStorageCached;
  }

  private writeRenderUniforms(
    rect: PlotRect,
    xMajorStep: number,
    yMajorStep: number,
    color: [number, number, number],
    pointCount: number,
  ): void {
    const ru = new Float32Array(15);
    ru[0] = this.xMin;
    ru[1] = this.xMax;
    ru[2] = this.yMin;
    ru[3] = this.yMax;
    ru[4] = rect.x;
    ru[5] = rect.y;
    ru[6] = rect.w;
    ru[7] = rect.h;
    ru[8] = this.canvasW;
    ru[9] = this.canvasH;
    ru[10] = xMajorStep;
    ru[11] = yMajorStep;
    ru[12] = color[0];
    ru[13] = color[1];
    ru[14] = color[2];
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, ru as Float32Array<ArrayBuffer>);
    const pc = new Uint32Array([pointCount]);
    this.device.queue.writeBuffer(this.uniformBuffer!, 60, pc as Uint32Array<ArrayBuffer>);
  }

  /**
   * Render grid, axes, tick marks, and labels on a 2D canvas overlay.
   * Called after render() — the 2D canvas is positioned on top of the WebGPU canvas.
   */
  renderOverlay(ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvasW;
    const h = this.canvasH;
    const rect = this.plotRect;

    ctx.save();
    ctx.scale(dpr, dpr);
    const cssW = w / dpr;
    const cssH = h / dpr;
    const cssRect = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };

    ctx.clearRect(0, 0, cssW, cssH);

    // Grid ticks + labels
    ctx.strokeStyle = `rgba(${this.options.gridColor[0]*255}, ${this.options.gridColor[1]*255}, ${this.options.gridColor[2]*255}, ${this.options.gridColor[3]})`;
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${this.options.textColor[3]})`;

    // X ticks
    const xTicks = this.niceTicks(this.xMin, this.xMax, 8);
    for (const tx of xTicks) {
      const px = cssRect.x + (tx - this.xMin) / (this.xMax - this.xMin) * cssRect.w;
      if (px < cssRect.x || px > cssRect.x + cssRect.w) continue;
      ctx.fillText(tx.toFixed(3), px - 15, cssH - 8);
    }

    // Y ticks
    const yTicks = this.niceTicks(this.yMin, this.yMax, 6);
    for (const ty of yTicks) {
      const py = cssRect.y + cssRect.h - (ty - this.yMin) / (this.yMax - this.yMin) * cssRect.h;
      if (py < cssRect.y || py > cssRect.y + cssRect.h) continue;
      ctx.fillText(ty.toFixed(2), 4, py + 3);
    }

    // Axes border
    ctx.strokeStyle = `rgba(${this.options.axisColor[0]*255}, ${this.options.axisColor[1]*255}, ${this.options.axisColor[2]*255}, ${this.options.axisColor[3]})`;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(cssRect.x, cssRect.y, cssRect.w, cssRect.h);

    // Labels
    ctx.font = '12px monospace';
    ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${this.options.textColor[3]})`;
    ctx.fillText(this.options.xLabel, cssRect.x + cssRect.w / 2 - 30, cssH - 2);
    ctx.save();
    ctx.translate(14, cssRect.y + cssRect.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.options.yLabel, -30, 0);
    ctx.restore();

    // Title
    if (this.options.title) {
      ctx.font = '14px monospace';
      ctx.fillText(this.options.title, cssRect.x, cssRect.y - 2);
    }

    // Legend
    let legendY = cssRect.y + 16;
    ctx.font = '11px monospace';
    for (const s of this.series) {
      const alpha = s.visible ? 1.0 : 0.3;
      ctx.fillStyle = `rgba(${s.color[0]*255}, ${s.color[1]*255}, ${s.color[2]*255}, ${alpha})`;
      ctx.fillRect(cssRect.x + cssRect.w - 130, legendY, 12, 12);
      ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${alpha})`;
      ctx.fillText(s.name, cssRect.x + cssRect.w - 114, legendY + 10);
      legendY += 16;
    }

    // Crosshair
    const mxCss = this.mouseX / dpr;
    const myCss = this.mouseY / dpr;
    if (mxCss >= cssRect.x && mxCss <= cssRect.x + cssRect.w &&
        myCss >= cssRect.y && myCss <= cssRect.y + cssRect.h) {
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mxCss, cssRect.y);
      ctx.lineTo(mxCss, cssRect.y + cssRect.h);
      ctx.moveTo(cssRect.x, myCss);
      ctx.lineTo(cssRect.x + cssRect.w, myCss);
      ctx.stroke();
      ctx.setLineDash([]);

      const dataX = this.xMin + (mxCss - cssRect.x) / cssRect.w * (this.xMax - this.xMin);
      const dataY = this.yMin + (cssRect.y + cssRect.h - myCss) / cssRect.h * (this.yMax - this.yMin);
      ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
      ctx.font = '10px monospace';
      ctx.fillText(`(${dataX.toFixed(4)}, ${dataY.toFixed(4)})`, mxCss + 5, myCss - 5);
    }

    ctx.restore();
  }

  /**
   * Generate a "nice" step size for tick marks.
   */
  private niceStep(range: number, count: number): number {
    if (range <= 0) return 1;
    const rawStep = range / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let step: number;
    if (normalized < 1.5) step = 1 * magnitude;
    else if (normalized < 3) step = 2 * magnitude;
    else if (normalized < 7) step = 5 * magnitude;
    else step = 10 * magnitude;
    return step;
  }

  private niceTicks(min: number, max: number, count: number): number[] {
    const step = this.niceStep(max - min, count);
    const start = Math.ceil(min / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= max + step * 0.001; v += step) {
      ticks.push(v);
    }
    return ticks;
  }

  /**
   * Set up mouse interaction (zoom, pan, crosshair).
   */
  private setupInteraction(): void {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const mx = (e.clientX - rect.left) * dpr;
      const my = (e.clientY - rect.top) * dpr;
      const pr = this.plotRect;
      if (mx < pr.x || mx > pr.x + pr.w || my < pr.y || my > pr.y + pr.h) return;

      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const dataX = this.xMin + (mx - pr.x) / pr.w * (this.xMax - this.xMin);
      const dataY = this.yMin + (pr.y + pr.h - my) / pr.h * (this.yMax - this.yMin);

      this.xMin = dataX - (dataX - this.xMin) * zoomFactor;
      this.xMax = dataX + (this.xMax - dataX) * zoomFactor;
      this.yMin = dataY - (dataY - this.yMin) * zoomFactor;
      this.yMax = dataY + (this.yMax - dataY) * zoomFactor;

      this.onViewportChange?.(this.xMin, this.xMax, this.yMin, this.yMax);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartXMin = this.xMin;
      this.dragStartXMax = this.xMax;
      this.dragStartYMin = this.yMin;
      this.dragStartYMax = this.yMax;
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.mouseX = (e.clientX - rect.left) * dpr;
      this.mouseY = (e.clientY - rect.top) * dpr;

      if (this.isDragging) {
        const dx = (e.clientX - this.dragStartX) * dpr;
        const dy = (e.clientY - this.dragStartY) * dpr;
        const pr = this.plotRect;
        const xRange = this.dragStartXMax - this.dragStartXMin;
        const yRange = this.dragStartYMax - this.dragStartYMin;
        this.xMin = this.dragStartXMin - dx / pr.w * xRange;
        this.xMax = this.dragStartXMax - dx / pr.w * xRange;
        this.yMin = this.dragStartYMin + dy / pr.h * yRange;
        this.yMax = this.dragStartYMax + dy / pr.h * yRange;
        this.onViewportChange?.(this.xMin, this.xMax, this.yMin, this.yMax);
      }

      if (this.onCursorMove) {
        const pr = this.plotRect;
        if (this.mouseX >= pr.x && this.mouseX <= pr.x + pr.w) {
          const dataX = this.xMin + (this.mouseX - pr.x) / pr.w * (this.xMax - this.xMin);
          const values: { name: string; value: number }[] = [];
          for (const s of this.series) {
            if (!s.visible) continue;
            const val = this.evaluateSeriesAt(s, dataX);
            values.push({ name: s.name, value: val });
          }
          this.onCursorMove(dataX, 0, values);
        }
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'crosshair';
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.mouseX = -1;
      this.mouseY = -1;
      this.canvas.style.cursor = 'default';
    });

    this.canvas.addEventListener('dblclick', () => {
      this.xMin = this.xMinData;
      this.xMax = this.xMaxData;
      this.yMin = this.yMinData;
      this.yMax = this.yMaxData;
      this.onViewportChange?.(this.xMin, this.xMax, this.yMin, this.yMax);
    });
  }

  /**
   * Evaluate a series at a given x (time) value using CPU-side De Boor.
   */
  private evaluateSeriesAt(s: PlotSeries, x: number): number {
    for (const seg of s.segments) {
      if (x >= seg.sStart && x <= seg.sEnd) {
        const qty = seg.quantities[s.quantityIndex];
        if (qty.controlPoints.length === 0) return 0;
        const u = (x - seg.sStart) / (seg.sEnd - seg.sStart);
        return evalBSpline1D(qty.controlPoints, qty.knots, qty.degree, u);
      }
    }
    return 0;
  }

  /**
   * Toggle series visibility.
   */
  toggleSeries(index: number): void {
    if (index >= 0 && index < this.series.length) {
      this.series[index].visible = !this.series[index].visible;
      this.autoScale();
      this.uploadSeriesBuffers();
    }
  }

  /**
   * Reset view to data bounds.
   */
  resetView(): void {
    this.xMin = this.xMinData;
    this.xMax = this.xMaxData;
    this.yMin = this.yMinData;
    this.yMax = this.yMaxData;
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    for (const b of this.seriesVertexBuffers) b.destroy();
    this.seriesVertexBuffers = [];
    this.msaaTexture?.destroy();
    this.dummyStorageCached?.destroy();
  }
}
