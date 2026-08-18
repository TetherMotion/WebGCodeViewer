/**
 * @file WssMiniplotRenderer.ts
 * @brief WebGPU miniplot that evaluates the WSS (Weighted Switching Structure)
 *        analytically in a compute shader — one point per pixel column.
 *
 * Unlike the old ComputeMiniplotRenderer which sampled pre-computed per-segment
 * speeds, this renderer takes the raw WSS arc buffer and evaluates v(t), a(t),
 * j(t) in closed form on the GPU. Because the WSS is analytical, zoom is
 * effectively infinite — every pixel gets an exact evaluation regardless of
 * zoom level.
 *
 * The x-axis is time. Given a time t, we binary-search the arcs by t0 to find
 * the containing arc, then τ = t - t0, and:
 *   BANG:   v = v0 + a0·τ + ½·η·τ²,  a = a0 + η·τ,  j = η
 *   SINGULAR: v = v0 + a*·τ,         a = a*,         j = 0
 *   WALL:   v = v0 (approx),          a = 0,          j = 0
 *
 * No cubic inversion is needed (unlike the NurbsRenderer which maps s → τ).
 */

import type { WssGpuData } from '@tether/viewer-core';

export type WssPlotQuantity = 'velocity' | 'acceleration' | 'jerk';

const QUANTITY_LABELS: Record<WssPlotQuantity, string> = {
  velocity: 'Velocity (mm/s)',
  acceleration: 'Acceleration (mm/s²)',
  jerk: 'Jerk (mm/s³)',
};

const QUANTITY_COLORS: Record<WssPlotQuantity, [number, number, number]> = {
  velocity: [0.29, 0.62, 1.0],
  acceleration: [1.0, 0.53, 0.28],
  jerk: [0.91, 0.33, 0.53],
};

const HIGHLIGHT_COLOR = '#ffcc00';
const EVENT_COLORS: Record<string, string> = {
  tool: '#ffd94d',
  temp: '#ff5c3d',
  fan: '#4d99ff',
  coolant: '#33e6e6',
};

interface ViewRange {
  tMin: number;
  tMax: number;
}

interface EventLines {
  toolChangeLines?: number[];
  tempChangeLines?: number[];
  fanChangeLines?: number[];
  coolantChangeLines?: number[];
}

// Arc layout: 12 floats per arc (matches WssParser.ts / WssData.hpp)
// [s0, s1, t0, v0, a0, eta, aStar, duration, type, 0, 0, 0]
const ARC_FLOATS = 12;

export class WssMiniplotRenderer {
  private container: HTMLElement;
  private device: GPUDevice;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private wssData: WssGpuData | null = null;
  private eventLines: EventLines = {};
  private quantity: WssPlotQuantity = 'velocity';
  private selectedLine: number = -1;
  private lineToTime: Map<number, number> = new Map();

  private totalRange: ViewRange = { tMin: 0, tMax: 1 };
  private viewRange: ViewRange = { tMin: 0, tMax: 1 };
  private yRange: { min: number; max: number } = { min: 0, max: 1 };

  private viewRangeCallback: (() => void) | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartTMin = 0;
  private dragTSpan = 0;

  // GPU resources
  private arcBuffer: GPUBuffer | null = null;
  private pointBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeUniformBuffer: GPUBuffer | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private lineBindGroup: GPUBindGroup | null = null;
  private lineUniformBuffer: GPUBuffer | null = null;

  // Output point buffer sized to canvas pixel width (capped for safety)
  private outputPoints = 1;
  private readonly maxOutputPoints = 4096;

  constructor(container: HTMLElement, device: GPUDevice) {
    this.container = container;
    this.device = device;
  }

  async init(): Promise<void> {
    // Hide any pre-existing canvases in the container.
    const existingCanvases = this.container.querySelectorAll('canvas');
    for (const c of existingCanvases) {
      (c as HTMLCanvasElement).style.display = 'none';
    }

    // Create WebGPU canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wss-miniplot-canvas';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);

    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('WebGPU canvas context not available');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    // Create 2D overlay canvas for grid/axes/labels
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'wss-miniplot-overlay';
    this.overlayCanvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    this.container.style.position = 'relative';
    this.container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.resizeCanvas();

    // ── Compute shader: one point per pixel column ──
    const computeShader = this.device.createShaderModule({
      code: `
        struct WssArc {
          s0: f32, s1: f32, t0: f32, v0: f32,
          a0: f32, eta: f32, aStar: f32, duration: f32,
          kind: f32, _pad0: f32, _pad1: f32, _pad2: f32,
        };

        struct ComputeUniforms {
          tMin: f32,
          tMax: f32,
          outputPoints: u32,
          quantity: u32,     // 0=velocity, 1=acceleration, 2=jerk
          arcCount: u32,
          _pad: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: ComputeUniforms;
        @group(0) @binding(1) var<storage, read> arcs: array<WssArc>;
        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;

        /// Binary search for the arc whose time range contains t.
        /// Arcs are sorted by t0.
        fn findArcByTime(t: f32) -> u32 {
          let n = uniforms.arcCount;
          if (n == 0u) { return 0u; }
          var lo: u32 = 0u;
          var hi: u32 = n;
          while (lo < hi) {
            let mid = (lo + hi) / 2u;
            let arcT0 = arcs[mid].t0;
            if (arcT0 <= t) {
              lo = mid + 1u;
            } else {
              hi = mid;
            }
          }
          // lo is now the first arc with t0 > t, so the containing arc is lo-1
          if (lo == 0u) { return 0u; }
          return min(lo - 1u, n - 1u);
        }

        /// Evaluate the selected quantity at time t.
        fn evalAtTime(t: f32) -> f32 {
          if (uniforms.arcCount == 0u) { return 0.0; }

          let idx = findArcByTime(t);
          let arc = arcs[idx];
          let tau = max(t - arc.t0, 0.0);
          let arcKind = arc.kind;

          var v: f32;
          var a: f32;
          var j: f32;

          if (arcKind < 2.5) {
            // BANG_PLUS (0) or BANG_MINUS (1)
            v = arc.v0 + arc.a0 * tau + 0.5 * arc.eta * tau * tau;
            a = arc.a0 + arc.eta * tau;
            j = arc.eta;
          } else if (arcKind < 3.5) {
            // SINGULAR (2)
            v = arc.v0 + arc.aStar * tau;
            a = arc.aStar;
            j = 0.0;
          } else {
            // WALL (3): v ≈ v0, a ≈ 0, j = 0
            v = arc.v0;
            a = 0.0;
            j = 0.0;
          }

          switch (uniforms.quantity) {
            case 0u: { return v; }
            case 1u: { return a; }
            case 2u: { return j; }
            default: { return v; }
          }
        }

        @compute @workgroup_size(64)
        fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
          let idx = global_id.x;
          if (idx >= uniforms.outputPoints) { return; }

          let n = uniforms.outputPoints;
          let t = select(uniforms.tMin,
                         uniforms.tMin + (uniforms.tMax - uniforms.tMin) * (f32(idx) / f32(n - 1u)),
                         n > 1u);

          let v = evalAtTime(t);
          points[idx] = vec2<f32>(t, v);
        }
      `,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeShader, entryPoint: 'cs_main' },
    });

    this.computeUniformBuffer = this.device.createBuffer({
      size: 24, // 2 × f32 + 3 × u32 + 1 × f32 pad = 24 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pointBuffer = this.device.createBuffer({
      size: this.maxOutputPoints * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Dummy arc buffer so bind group can be created before data is set.
    this.arcBuffer = this.device.createBuffer({
      size: ARC_FLOATS * 4, // one arc
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.arcBuffer, 0, new Float32Array(ARC_FLOATS) as Float32Array<ArrayBuffer>);

    // ── Line render pipeline ──
    const renderShader = this.device.createShaderModule({
      code: `
        struct LineUniforms {
          tMin: f32,
          tMax: f32,
          yMin: f32,
          yMax: f32,
          color: vec3<f32>,
          pointCount: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: LineUniforms;

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
        };

        @vertex
        fn vs_main(@location(0) point: vec2<f32>) -> VertexOutput {
          var out: VertexOutput;
          let nx = (point.x - uniforms.tMin) / (uniforms.tMax - uniforms.tMin);
          let ny = select(0.0,
                          (point.y - uniforms.yMin) / (uniforms.yMax - uniforms.yMin),
                          uniforms.yMax > uniforms.yMin);
          out.position = vec4<f32>(2.0 * nx - 1.0, 2.0 * ny - 1.0, 0.0, 1.0);
          return out;
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(uniforms.color, 1.0);
        }
      `,
    });

    this.linePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: renderShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        }],
      },
      fragment: {
        module: renderShader,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-strip' },
    });

    this.lineUniformBuffer = this.device.createBuffer({
      size: 32, // 8 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lineBindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.lineUniformBuffer } },
      ],
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.arcBuffer } },
        { binding: 2, resource: { buffer: this.pointBuffer } },
      ],
    });

    // Event handlers
    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('dblclick', () => this.resetZoom());
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.context || !this.overlayCanvas) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    // Overlay canvas matches CSS pixels for crisp text
    this.overlayCanvas.width = Math.max(1, Math.floor(rect.width));
    this.overlayCanvas.height = Math.max(1, Math.floor(rect.height));
  }

  /**
   * Set the WSS data and reset view to show everything.
   */
  setWssData(data: WssGpuData): void {
    this.wssData = data;
    this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
    this.viewRange = { ...this.totalRange };
    this.computeYRange();
    this.uploadArcs(data);
  }

  /**
   * Set event line numbers for annotation overlays.
   */
  setEventLines(events: EventLines): void {
    this.eventLines = events;
  }

  /**
   * Set the line-number → time map for selected-line highlight.
   */
  setLineToTimeMap(map: Map<number, number>): void {
    this.lineToTime = map;
  }

  private computeYRange(): void {
    if (!this.wssData) {
      this.yRange = { min: 0, max: 1 };
      return;
    }
    let minV: number, maxV: number;
    switch (this.quantity) {
      case 'velocity':
        minV = 0;
        maxV = this.wssData.maxVelocity * 1.05;
        break;
      case 'acceleration':
        minV = -this.wssData.maxAcceleration * 1.05;
        maxV = this.wssData.maxAcceleration * 1.05;
        break;
      case 'jerk':
        minV = -this.wssData.maxJerk * 1.05;
        maxV = this.wssData.maxJerk * 1.05;
        break;
    }
    if (!isFinite(minV) || !isFinite(maxV) || minV >= maxV) {
      minV = 0;
      maxV = 1;
    }
    this.yRange = { min: minV, max: maxV };
  }

  private uploadArcs(data: WssGpuData): void {
    if (!this.device) return;
    const arr = data.arcBuffer as Float32Array<ArrayBuffer>;
    if (arr.byteLength === 0) return;

    if (this.arcBuffer && this.arcBuffer.size >= arr.byteLength) {
      this.device.queue.writeBuffer(this.arcBuffer, 0, arr);
    } else {
      this.arcBuffer?.destroy();
      this.arcBuffer = this.device.createBuffer({
        size: arr.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.arcBuffer, 0, arr);
      // Recreate compute bind group
      if (this.computePipeline) {
        this.computeBindGroup = this.device.createBindGroup({
          layout: this.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
            { binding: 1, resource: { buffer: this.arcBuffer } },
            { binding: 2, resource: { buffer: this.pointBuffer! } },
          ],
        });
      }
    }
  }

  setQuantity(q: WssPlotQuantity): void {
    this.quantity = q;
    this.computeYRange();
  }

  setSelectedLine(lineNumber: number): void {
    this.selectedLine = lineNumber;
  }

  resetZoom(): void {
    this.viewRange = { ...this.totalRange };
    this.viewRangeCallback?.();
  }

  getAxisLabel(): string {
    return QUANTITY_LABELS[this.quantity];
  }

  getViewRange(): ViewRange {
    return { ...this.viewRange };
  }

  onViewRangeChange(callback: () => void): void {
    this.viewRangeCallback = callback;
  }

  handleWheel(_deltaY: number, _mouseX: number): boolean {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = _mouseX - rect.left;
    const t = this.viewRange.tMin + (mouseX / rect.width) * (this.viewRange.tMax - this.viewRange.tMin);
    const factor = _deltaY > 0 ? 1.1 : 0.9;
    const newSpan = (this.viewRange.tMax - this.viewRange.tMin) * factor;
    const newMin = t - (t - this.viewRange.tMin) * factor;
    const newMax = newMin + newSpan;
    this.viewRange = this.clampRange({ tMin: newMin, tMax: newMax });
    this.viewRangeCallback?.();
    return true;
  }

  startDrag(mouseX: number): void {
    this.isDragging = true;
    this.dragStartX = mouseX;
    this.dragStartTMin = this.viewRange.tMin;
    this.dragTSpan = this.viewRange.tMax - this.viewRange.tMin;
  }

  updateDrag(mouseX: number): void {
    if (!this.isDragging || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dx = mouseX - this.dragStartX;
    const dt = -(dx / rect.width) * this.dragTSpan;
    this.viewRange = this.clampRange({
      tMin: this.dragStartTMin + dt,
      tMax: this.dragStartTMin + this.dragTSpan + dt,
    });
    this.viewRangeCallback?.();
  }

  endDrag(): void {
    this.isDragging = false;
  }

  get dragging(): boolean {
    return this.isDragging;
  }

  private clampRange(range: ViewRange): ViewRange {
    const span = range.tMax - range.tMin;
    const totalSpan = this.totalRange.tMax - this.totalRange.tMin;
    if (span > totalSpan) {
      return { ...this.totalRange };
    }
    let tMin = range.tMin;
    if (tMin < this.totalRange.tMin) tMin = this.totalRange.tMin;
    let tMax = tMin + span;
    if (tMax > this.totalRange.tMax) {
      tMax = this.totalRange.tMax;
      tMin = tMax - span;
      if (tMin < this.totalRange.tMin) tMin = this.totalRange.tMin;
    }
    return { tMin, tMax };
  }

  resize(): void {
    this.resizeCanvas();
  }

  render(): void {
    if (!this.context || !this.canvas || !this.computePipeline || !this.linePipeline) return;
    if (!this.wssData || this.wssData.arcs.length === 0 || !this.arcBuffer) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    const canvasWidth = Math.max(1, Math.floor(rect.width * dpr));
    this.outputPoints = Math.min(this.maxOutputPoints, canvasWidth);

    // Update compute uniforms
    const cu = new ArrayBuffer(24);
    const cv = new DataView(cu);
    cv.setFloat32(0, this.viewRange.tMin, true);
    cv.setFloat32(4, this.viewRange.tMax, true);
    cv.setUint32(8, this.outputPoints, true);
    cv.setUint32(12, this.quantityToIndex(this.quantity), true);
    cv.setUint32(16, this.wssData.arcs.length, true);
    this.device.queue.writeBuffer(this.computeUniformBuffer!, 0, cu);

    // Update line uniforms
    const color = QUANTITY_COLORS[this.quantity];
    const lu = new Float32Array(8);
    lu[0] = this.viewRange.tMin;
    lu[1] = this.viewRange.tMax;
    lu[2] = this.yRange.min;
    lu[3] = this.yRange.max;
    lu[4] = color[0];
    lu[5] = color[1];
    lu[6] = color[2];
    lu[7] = this.outputPoints;
    this.device.queue.writeBuffer(this.lineUniformBuffer!, 0, lu);

    // Compute pass
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup!);
    computePass.dispatchWorkgroups(Math.ceil(this.outputPoints / 64));
    computePass.end();

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: [0.08, 0.08, 0.10, 1.0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.linePipeline);
    renderPass.setBindGroup(0, this.lineBindGroup!);
    renderPass.setVertexBuffer(0, this.pointBuffer!);
    renderPass.draw(this.outputPoints);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);

    // Draw overlay (grid, axes, labels, event markers, selected line)
    this.drawOverlay();
  }

  private quantityToIndex(q: WssPlotQuantity): number {
    switch (q) {
      case 'velocity': return 0;
      case 'acceleration': return 1;
      case 'jerk': return 2;
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    if (!ctx || !this.overlayCanvas) return;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    const padLeft = 50;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 22;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(80, 80, 90, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(180, 180, 190, 0.8)';

    // X grid + ticks
    const xTicks = this.niceTicks(this.viewRange.tMin, this.viewRange.tMax, 8);
    for (const tx of xTicks) {
      const px = padLeft + (tx - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * plotW;
      if (px < padLeft || px > w - padRight) continue;
      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, h - padBottom);
      ctx.stroke();
      ctx.fillText(this.formatTime(tx), px - 15, h - padBottom + 14);
    }

    // Y grid + ticks
    const yTicks = this.niceTicks(this.yRange.min, this.yRange.max, 5);
    for (const ty of yTicks) {
      const py = h - padBottom - (ty - this.yRange.min) / (this.yRange.max - this.yRange.min) * plotH;
      if (py < padTop || py > h - padBottom) continue;
      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(w - padRight, py);
      ctx.stroke();
      ctx.fillText(ty.toFixed(1), 4, py + 3);
    }

    // Axes
    ctx.strokeStyle = 'rgba(120, 120, 130, 0.8)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, h - padBottom);
    ctx.lineTo(w - padRight, h - padBottom);
    ctx.stroke();

    // Y label
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(200, 200, 210, 0.9)';
    ctx.fillText(QUANTITY_LABELS[this.quantity], -40, 0);
    ctx.restore();

    // Event markers
    this.drawEventMarkers(ctx, w, h, padLeft, padTop, padBottom, plotW);

    // Selected line highlight
    if (this.selectedLine >= 0) {
      const t = this.lineToTime.get(this.selectedLine);
      if (t !== undefined && t >= this.viewRange.tMin && t <= this.viewRange.tMax) {
        const px = padLeft + (t - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * plotW;
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, padTop);
        ctx.lineTo(px, h - padBottom);
        ctx.stroke();
      }
    }
  }

  private drawEventMarkers(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    padLeft: number, padTop: number, padBottom: number,
    plotW: number,
  ): void {
    const drawLines = (lines: number[] | undefined, color: string) => {
      if (!lines) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const ln of lines) {
        const t = this.lineToTime.get(ln);
        if (t === undefined) continue;
        if (t < this.viewRange.tMin || t > this.viewRange.tMax) continue;
        const px = padLeft + (t - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin) * plotW;
        ctx.beginPath();
        ctx.moveTo(px, padTop);
        ctx.lineTo(px, h - padBottom);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };

    drawLines(this.eventLines.toolChangeLines, EVENT_COLORS.tool);
    drawLines(this.eventLines.tempChangeLines, EVENT_COLORS.temp);
    drawLines(this.eventLines.fanChangeLines, EVENT_COLORS.fan);
    drawLines(this.eventLines.coolantChangeLines, EVENT_COLORS.coolant);
  }

  private formatTime(t: number): string {
    if (t < 1) return t.toFixed(3);
    if (t < 100) return t.toFixed(2);
    return t.toFixed(1);
  }

  private niceTicks(min: number, max: number, count: number): number[] {
    const range = max - min;
    if (range <= 0) return [min];
    const rawStep = range / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let step: number;
    if (normalized < 1.5) step = 1 * magnitude;
    else if (normalized < 3) step = 2 * magnitude;
    else if (normalized < 7) step = 5 * magnitude;
    else step = 10 * magnitude;
    const start = Math.ceil(min / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= max + step * 0.001; v += step) {
      ticks.push(v);
    }
    return ticks;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.handleWheel(e.deltaY, e.clientX);
  }

  private onMouseDown(e: MouseEvent): void {
    this.startDrag(e.clientX);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isDragging) this.updateDrag(e.clientX);
  }

  private onMouseUp(): void {
    this.endDrag();
  }

  destroy(): void {
    this.canvas?.remove();
    this.overlayCanvas?.remove();
    this.canvas = null;
    this.overlayCanvas = null;
    this.arcBuffer?.destroy();
    this.pointBuffer?.destroy();
    this.computeUniformBuffer?.destroy();
    this.lineUniformBuffer?.destroy();
  }
}
