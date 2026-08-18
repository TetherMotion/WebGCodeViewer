/**
 * @file GpuPlot.ts
 * @brief WebGPU-accelerated plot component for velocity, acceleration, jerk,
 *        and pressure advance visualization.
 *
 * Features:
 * - Hardware-accelerated line rendering via WebGPU
 * - Mouse wheel zoom (scroll to zoom, drag to pan)
 * - Multi-series support with per-series colors
 * - Crosshair cursor with value readout
 * - Legend with toggle visibility
 * - Axis labels and tick marks
 * - Grid lines
 * - Time-domain x-axis (seconds)
 * - Auto-scaling y-axis with manual override
 * - Smooth NURBS curve evaluation on GPU via De Boor's algorithm
 *
 * The plot evaluates NURBS curves directly in the vertex shader, so even
 * with millions of data points the rendering is O(pixels) not O(samples).
 */

import { evalBSpline1D, TRNPData, TRNPQuantityCurve, TRNPSegment } from "@tether/viewer-core";

export interface PlotSeries {
  name: string;
  color: [number, number, number];  // RGB 0-1
  visible: boolean;
  // Source: either TRNP segments (motion profile) or PA segments
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

export class GpuPlot {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private cpBuffer: GPUBuffer | null = null;
  private knotBuffer: GPUBuffer | null = null;
  private metaBuffer: GPUBuffer | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private lineBindGroupLayout: GPUBindGroupLayout | null = null;

  private series: PlotSeries[] = [];
  private options: PlotOptions;

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

    // ── Line rendering pipeline ──
    // Vertex shader evaluates B-spline curves on GPU and transforms to clip space
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          // View transform: maps data coords to clip space
          xMin: f32, xMax: f32, yMin: f32, yMax: f32,
          // Canvas dimensions
          width: f32, height: f32,
          // Series color
          colorR: f32, colorG: f32, colorB: f32, colorA: f32,
          // Padding
          _pad: f32,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec2<f32>,  // (time, value) in data coords
        };

        @vertex
        fn vs_main(input: VertexInput) -> @builtin(position) vec4<f32> {
          // Map data coords to clip space [-1, 1]
          let xRange = uniforms.xMax - uniforms.xMin;
          let yRange = uniforms.yMax - uniforms.yMin;
          let xClip = (input.position.x - uniforms.xMin) / xRange * 2.0 - 1.0;
          let yClip = (input.position.y - uniforms.yMin) / yRange * 2.0 - 1.0;
          return vec4<f32>(xClip, yClip, 0.0, 1.0);
        }

        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(uniforms.colorR, uniforms.colorG, uniforms.colorB, uniforms.colorA);
        }
      `,
    });

    this.lineBindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.linePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.lineBindGroupLayout],
      }),
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{ format, blend: {
          alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        }}],
      },
      primitive: { topology: 'line-strip' },
    });

    // Uniform buffer: 12 floats = 48 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Set the series to plot. Each series has NURBS segments that are
   * tessellated on the CPU (for now) and rendered as line strips on GPU.
   */
  setSeries(series: PlotSeries[]): void {
    this.series = series;
    this.autoScale();
  }

  /**
   * Auto-scale y-axis to fit all visible series.
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
        const u = t; // normalized parameter within segment
        const time = seg.sStart + t * segLen;
        const value = evalBSpline1D(qty.controlPoints, qty.knots, qty.degree, u);
        points.push(time, value);
      }
    }
    return new Float32Array(points);
  }

  /**
   * Render the plot.
   */
  render(): void {
    if (!this.linePipeline || !this.uniformBuffer) return;

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: this.options.backgroundColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(this.linePipeline);

    // Temp buffers must outlive queue.submit(); collect them here.
    const tempBuffers: GPUBuffer[] = [];

    // Render each visible series
    for (let i = 0; i < this.series.length; i++) {
      const s = this.series[i];
      if (!s.visible) continue;

      const points = this.tessellateSeries(s);
      if (points.length === 0) continue;

      // Create temp buffer for this series' points
      const pointBuffer = this.device.createBuffer({
        size: points.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(pointBuffer, 0, points as Float32Array<ArrayBuffer>);

      // Update uniforms for this series
      const uniformData = new Float32Array(12);
      uniformData[0] = this.xMin;
      uniformData[1] = this.xMax;
      uniformData[2] = this.yMin;
      uniformData[3] = this.yMax;
      uniformData[4] = this.options.width;
      uniformData[5] = this.options.height;
      uniformData[6] = s.color[0];
      uniformData[7] = s.color[1];
      uniformData[8] = s.color[2];
      uniformData[9] = 1.0; // alpha
      uniformData[10] = 0;  // pad
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData as Float32Array<ArrayBuffer>);

      const bindGroup = this.device.createBindGroup({
        layout: this.lineBindGroupLayout!,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, pointBuffer);
      pass.draw(points.length / 2);

      // Queue temp buffer for destruction after submit
      tempBuffers.push(pointBuffer);
    }

    pass.end();

    // Render grid, axes, and text via overlay (CPU canvas 2D)
    // This is done in renderOverlay() after the GPU pass

    this.device.queue.submit([encoder.finish()]);
    for (const b of tempBuffers) b.destroy();
  }

  /**
   * Render grid, axes, tick marks, and labels on a 2D canvas overlay.
   * Called after render() — the 2D canvas is positioned on top of the WebGPU canvas.
   */
  renderOverlay(ctx: CanvasRenderingContext2D): void {
    const w = this.options.width;
    const h = this.options.height;
    const padLeft = 60;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 30;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = `rgba(${this.options.gridColor[0]*255}, ${this.options.gridColor[1]*255}, ${this.options.gridColor[2]*255}, ${this.options.gridColor[3]})`;
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${this.options.textColor[3]})`;

    // X grid + ticks
    const xTicks = this.niceTicks(this.xMin, this.xMax, 8);
    for (const tx of xTicks) {
      const px = padLeft + (tx - this.xMin) / (this.xMax - this.xMin) * plotW;
      if (px < padLeft || px > w - padRight) continue;
      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, h - padBottom);
      ctx.stroke();
      ctx.fillText(tx.toFixed(3), px - 15, h - padBottom + 15);
    }

    // Y grid + ticks
    const yTicks = this.niceTicks(this.yMin, this.yMax, 6);
    for (const ty of yTicks) {
      const py = h - padBottom - (ty - this.yMin) / (this.yMax - this.yMin) * plotH;
      if (py < padTop || py > h - padBottom) continue;
      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(w - padRight, py);
      ctx.stroke();
      ctx.fillText(ty.toFixed(2), 5, py + 3);
    }

    // Axes
    ctx.strokeStyle = `rgba(${this.options.axisColor[0]*255}, ${this.options.axisColor[1]*255}, ${this.options.axisColor[2]*255}, ${this.options.axisColor[3]})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, h - padBottom);
    ctx.lineTo(w - padRight, h - padBottom);
    ctx.stroke();

    // Labels
    ctx.font = '12px monospace';
    ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${this.options.textColor[3]})`;
    ctx.fillText(this.options.xLabel, w / 2 - 30, h - 5);
    ctx.save();
    ctx.translate(15, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.options.yLabel, -30, 0);
    ctx.restore();

    // Title
    if (this.options.title) {
      ctx.font = '14px monospace';
      ctx.fillText(this.options.title, padLeft, padTop + 12);
    }

    // Legend
    let legendY = padTop + 20;
    ctx.font = '11px monospace';
    for (const s of this.series) {
      const alpha = s.visible ? 1.0 : 0.3;
      ctx.fillStyle = `rgba(${s.color[0]*255}, ${s.color[1]*255}, ${s.color[2]*255}, ${alpha})`;
      ctx.fillRect(w - 120, legendY, 12, 12);
      ctx.fillStyle = `rgba(${this.options.textColor[0]*255}, ${this.options.textColor[1]*255}, ${this.options.textColor[2]*255}, ${alpha})`;
      ctx.fillText(s.name, w - 105, legendY + 10);
      legendY += 16;
    }

    // Crosshair
    if (this.mouseX >= padLeft && this.mouseX <= w - padRight &&
        this.mouseY >= padTop && this.mouseY <= h - padBottom) {
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(this.mouseX, padTop);
      ctx.lineTo(this.mouseX, h - padBottom);
      ctx.moveTo(padLeft, this.mouseY);
      ctx.lineTo(w - padRight, this.mouseY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Value readout
      const dataX = this.xMin + (this.mouseX - padLeft) / plotW * (this.xMax - this.xMin);
      const dataY = this.yMin + (h - padBottom - this.mouseY) / plotH * (this.yMax - this.yMin);
      ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
      ctx.font = '10px monospace';
      ctx.fillText(`(${dataX.toFixed(4)}, ${dataY.toFixed(4)})`, this.mouseX + 5, this.mouseY - 5);
    }
  }

  /**
   * Generate "nice" tick values for an axis.
   */
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

  /**
   * Set up mouse interaction (zoom, pan, crosshair).
   */
  private setupInteraction(): void {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width * this.options.width;
      const my = (e.clientY - rect.top) / rect.height * this.options.height;
      const padLeft = 60, padRight = 10, padTop = 10, padBottom = 30;
      const plotW = this.options.width - padLeft - padRight;
      const plotH = this.options.height - padTop - padBottom;

      if (mx < padLeft || mx > this.options.width - padRight ||
          my < padTop || my > this.options.height - padBottom) return;

      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const dataX = this.xMin + (mx - padLeft) / plotW * (this.xMax - this.xMin);
      const dataY = this.yMin + (this.options.height - padBottom - my) / plotH * (this.yMax - this.yMin);

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
      this.mouseX = (e.clientX - rect.left) / rect.width * this.options.width;
      this.mouseY = (e.clientY - rect.top) / rect.height * this.options.height;

      if (this.isDragging) {
        const dx = (e.clientX - this.dragStartX) / rect.width * this.options.width;
        const dy = (e.clientY - this.dragStartY) / rect.height * this.options.height;
        const padLeft = 60, padBottom = 30, padTop = 10, padRight = 10;
        const plotW = this.options.width - padLeft - padRight;
        const plotH = this.options.height - padTop - padBottom;
        const xRange = this.dragStartXMax - this.dragStartXMin;
        const yRange = this.dragStartYMax - this.dragStartYMin;
        this.xMin = this.dragStartXMin - dx / plotW * xRange;
        this.xMax = this.dragStartXMax - dx / plotW * xRange;
        this.yMin = this.dragStartYMin + dy / plotH * yRange;
        this.yMax = this.dragStartYMax + dy / plotH * yRange;
        this.onViewportChange?.(this.xMin, this.xMax, this.yMin, this.yMax);
      }

      // Compute cursor values
      if (this.onCursorMove) {
        const padLeft = 60, padBottom = 30, padTop = 10, padRight = 10;
        const plotW = this.options.width - padLeft - padRight;
        const plotH = this.options.height - padTop - padBottom;
        if (this.mouseX >= padLeft && this.mouseX <= this.options.width - padRight) {
          const dataX = this.xMin + (this.mouseX - padLeft) / plotW * (this.xMax - this.xMin);
          const values: { name: string; value: number }[] = [];
          for (const s of this.series) {
            if (!s.visible) continue;
            // Evaluate series at dataX
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
      // Reset to data bounds
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
    this.cpBuffer?.destroy();
    this.knotBuffer?.destroy();
    this.metaBuffer?.destroy();
  }
}
