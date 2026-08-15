/**
 * @file MiniplotRenderer.ts
 * @brief WebGPU 2D line chart renderer for per-axis speed visualization.
 *
 * Renders a speed-vs-time plot with:
 *   - The actual speed curve (step function across segments)
 *   - Dashed vertical lines at G-code line boundaries
 *   - A highlighted indicator at the selected G-code line
 *   - Full zoom (wheel) and pan (drag) support
 *
 * The renderer uses its own WebGPU context (separate canvas) and a simple
 * orthographic 2D projection. Vertices are in pixel space [0..width, 0..height].
 */

export type MiniplotAxis = 'speedE' | 'speedX' | 'speedY' | 'speedZ' | 'speedLinear';

export interface MiniplotSegment {
  timeStart: number;
  duration: number;
  blockIndex: number;
  lineNumber: number;
  speedX: number;
  speedY: number;
  speedZ: number;
  speedE: number;
  speedLinear: number;
}

export interface MiniplotData {
  totalTime: number;
  segments: MiniplotSegment[];
}

interface ViewRange {
  tMin: number;  // visible time range
  tMax: number;
}

const AXIS_LABELS: Record<MiniplotAxis, string> = {
  speedE: 'Extruder Speed (mm/s)',
  speedX: 'X Speed (mm/s)',
  speedY: 'Y Speed (mm/s)',
  speedZ: 'Z Speed (mm/s)',
  speedLinear: 'Linear Speed (mm/s)',
};

const AXIS_COLORS: Record<MiniplotAxis, [number, number, number]> = {
  speedE: [0.29, 0.62, 1.0],   // blue
  speedX: [1.0, 0.53, 0.28],   // orange
  speedY: [0.53, 0.85, 0.38],  // green
  speedZ: [0.91, 0.33, 0.53],  // pink
  speedLinear: [0.85, 0.85, 0.35], // yellow
};

const DASH_COLOR: [number, number, number] = [0.4, 0.4, 0.45];
const HIGHLIGHT_COLOR: [number, number, number] = [1.0, 0.78, 0.0];
const AXIS_LINE_COLOR: [number, number, number] = [0.25, 0.25, 0.3];

export class MiniplotRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private vertexCount: number = 0;

  private data: MiniplotData | null = null;
  private axis: MiniplotAxis = 'speedE';
  private selectedLineNumber: number = -1;

  // View range (time domain)
  private view: ViewRange = { tMin: 0, tMax: 1 };
  private totalRange: ViewRange = { tMin: 0, tMax: 1 };

  // Interaction state
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartView: ViewRange = { tMin: 0, tMax: 1 };

  // Cached for label rendering
  private currentMaxSpeed: number = 0;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
  }

  async init(): Promise<void> {
    const shader = this.device.createShaderModule({
      code: `
        struct Uniforms {
          resolution: vec2<f32>,
          _pad: vec2<f32>,
        };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) position: vec2<f32>,
          @location(1) color: vec3<f32>,
        };
        struct VertexOutput {
          @builtin(position) clipPosition: vec4<f32>,
          @location(0) color: vec3<f32>,
        };
        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          // Convert pixel coordinates to NDC [-1, 1]
          let ndc = (input.position / uniforms.resolution) * 2.0 - 1.0;
          output.clipPosition = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
          output.color = input.color;
          return output;
        }
        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
          return vec4<f32>(input.color, 1.0);
        }
      `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 20, // 2 floats pos + 3 floats color
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' },
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 16, // vec2 + vec2 padding = 16 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  /**
   * Set the speed data and reset view to show everything.
   */
  setData(data: MiniplotData): void {
    this.data = data;
    if (data.segments.length > 0) {
      this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
      this.view = { ...this.totalRange };
    }
    this.updateBuffer();
  }

  /**
   * Set which axis to plot.
   */
  setAxis(axis: MiniplotAxis): void {
    this.axis = axis;
    this.updateBuffer();
  }

  /**
   * Set the selected G-code line number (for highlight indicator).
   * Pass -1 to clear.
   */
  setSelectedLine(lineNumber: number): void {
    this.selectedLineNumber = lineNumber;
    this.updateBuffer();
  }

  /**
   * Reset zoom to show the full time range.
   */
  resetZoom(): void {
    this.view = { ...this.totalRange };
    this.updateBuffer();
  }

  /**
   * Zoom into a time range centered on a given time.
   */
  zoomToRange(centerTime: number, zoomFactor: number): void {
    const range = this.view.tMax - this.view.tMin;
    const newRange = range / zoomFactor;
    const halfRange = newRange / 2;
    this.view.tMin = Math.max(this.totalRange.tMin, centerTime - halfRange);
    this.view.tMax = Math.min(this.totalRange.tMax, centerTime + halfRange);
    if (this.view.tMax - this.view.tMin < newRange) {
      // Clamped — adjust to maintain range
      this.view.tMin = this.totalRange.tMin;
      this.view.tMax = this.totalRange.tMin + newRange;
      if (this.view.tMax > this.totalRange.tMax) {
        this.view.tMax = this.totalRange.tMax;
        this.view.tMin = this.view.tMax - newRange;
      }
    }
    this.updateBuffer();
  }

  /**
   * Pan the view by a time delta.
   */
  pan(deltaTime: number): void {
    const range = this.view.tMax - this.view.tMin;
    let newMin = this.view.tMin + deltaTime;
    let newMax = this.view.tMax + deltaTime;
    if (newMin < this.totalRange.tMin) {
      newMin = this.totalRange.tMin;
      newMax = newMin + range;
    }
    if (newMax > this.totalRange.tMax) {
      newMax = this.totalRange.tMax;
      newMin = newMax - range;
    }
    this.view = { tMin: newMin, tMax: newMax };
    this.updateBuffer();
  }

  /**
   * Convert a pixel X coordinate to time.
   */
  pixelToTime(px: number): number {
    const w = this.canvas.clientWidth;
    const frac = px / w;
    return this.view.tMin + frac * (this.view.tMax - this.view.tMin);
  }

  /**
   * Convert a time value to pixel X coordinate.
   */
  timeToPixel(t: number): number {
    const w = this.canvas.clientWidth;
    const frac = (t - this.view.tMin) / (this.view.tMax - this.view.tMin);
    return frac * w;
  }

  /**
   * Handle mouse wheel for zooming. Returns true if handled.
   */
  handleWheel(deltaY: number, mouseX: number): boolean {
    if (!this.data) return false;
    const zoomFactor = deltaY > 0 ? 1.2 : 1 / 1.2;
    const mouseTime = this.pixelToTime(mouseX);
    this.zoomToRange(mouseTime, zoomFactor);
    return true;
  }

  /**
   * Start a drag operation.
   */
  startDrag(mouseX: number): void {
    this.isDragging = true;
    this.dragStartX = mouseX;
    this.dragStartView = { ...this.view };
  }

  /**
   * Update drag — pan the view.
   */
  updateDrag(mouseX: number): void {
    if (!this.isDragging) return;
    const dx = mouseX - this.dragStartX;
    const w = this.canvas.clientWidth;
    if (w <= 0) return;
    const deltaTime = -dx / w * (this.dragStartView.tMax - this.dragStartView.tMin);
    // Reset to start view then pan
    this.view = { ...this.dragStartView };
    this.pan(deltaTime);
  }

  /**
   * End drag.
   */
  endDrag(): void {
    this.isDragging = false;
  }

  /**
   * Whether a drag is currently in progress.
   */
  get dragging(): boolean {
    return this.isDragging;
  }

  /**
   * Resize the canvas to match its CSS size.
   */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const newW = Math.max(1, Math.floor(w * dpr));
    const newH = Math.max(1, Math.floor(h * dpr));
    if (this.canvas.width !== newW || this.canvas.height !== newH) {
      this.canvas.width = newW;
      this.canvas.height = newH;
      this.updateBuffer();
    }
  }

  /**
   * Get the current axis label for display.
   */
  getAxisLabel(): string {
    return AXIS_LABELS[this.axis];
  }

  /**
   * Get the current view range (for external display).
   */
  getViewRange(): ViewRange {
    return { ...this.view };
  }

  /**
   * Build the vertex buffer: speed curve + dashed verticals + highlight.
   */
  private updateBuffer(): void {
    if (!this.data || this.data.segments.length === 0) {
      this.vertexCount = 0;
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width || this.canvas.clientWidth * dpr;
    const h = this.canvas.height || this.canvas.clientHeight * dpr;
    if (w <= 0 || h <= 0) return;

    const padTop = 20 * dpr;
    const padBottom = 20 * dpr;
    const plotH = h - padTop - padBottom;

    const segments = this.data.segments;
    const axis = this.axis;
    const viewRange = this.view.tMax - this.view.tMin;
    if (viewRange <= 0) return;

    // Find max speed in visible range for Y scaling
    let maxSpeed = 0;
    for (const s of segments) {
      const tEnd = s.timeStart + s.duration;
      if (tEnd < this.view.tMin || s.timeStart > this.view.tMax) continue;
      const v = s[axis];
      if (v > maxSpeed) maxSpeed = v;
    }
    if (maxSpeed < 1e-6) maxSpeed = 1;
    this.currentMaxSpeed = maxSpeed;

    // Helper: time -> pixel X
    const t2x = (t: number): number => {
      const frac = (t - this.view.tMin) / viewRange;
      return frac * w;
    };
    // Helper: speed -> pixel Y (inverted, 0 at bottom)
    const v2y = (v: number): number => {
      const frac = v / maxSpeed;
      return h - padBottom - frac * plotH;
    };

    const vertices: number[] = [];
    const color = AXIS_COLORS[axis];

    // ── Draw axis lines (top and bottom borders) ──
    const axisCol = AXIS_LINE_COLOR;
    // Bottom line
    vertices.push(0, h - padBottom, axisCol[0], axisCol[1], axisCol[2]);
    vertices.push(w, h - padBottom, axisCol[0], axisCol[1], axisCol[2]);
    // Top line
    vertices.push(0, padTop, axisCol[0], axisCol[1], axisCol[2]);
    vertices.push(w, padTop, axisCol[0], axisCol[1], axisCol[2]);

    // ── Draw speed curve (step function) ──
    // For each segment in view, draw a horizontal line at the speed value
    // from segment start to segment end, with vertical connectors.
    let prevY = v2y(0);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const tStart = s.timeStart;
      const tEnd = s.timeStart + s.duration;
      if (tEnd < this.view.tMin || tStart > this.view.tMax) continue;

      const x1 = t2x(Math.max(tStart, this.view.tMin));
      const x2 = t2x(Math.min(tEnd, this.view.tMax));
      const y = v2y(s[axis]);

      // Vertical connector from previous Y to current Y (at x1)
      if (i > 0 && Math.abs(y - prevY) > 0.5) {
        vertices.push(x1, prevY, color[0], color[1], color[2]);
        vertices.push(x1, y, color[0], color[1], color[2]);
      }

      // Horizontal line for this segment
      vertices.push(x1, y, color[0], color[1], color[2]);
      vertices.push(x2, y, color[0], color[1], color[2]);

      prevY = y;
    }

    // ── Draw dashed vertical lines at G-code line boundaries ──
    // A boundary is where lineNumber changes between consecutive segments.
    const dashLen = 4 * dpr;
    const gapLen = 3 * dpr;
    const dashPeriod = dashLen + gapLen;

    // Collect unique boundary times (where lineNumber changes)
    const boundaries: { time: number; lineNumber: number }[] = [];
    let lastLine = -1;
    for (const s of segments) {
      if (s.lineNumber !== lastLine && s.lineNumber >= 0) {
        boundaries.push({ time: s.timeStart, lineNumber: s.lineNumber });
        lastLine = s.lineNumber;
      }
    }

    for (const b of boundaries) {
      if (b.time < this.view.tMin || b.time > this.view.tMax) continue;
      const x = t2x(b.time);
      // Draw dashed line from top to bottom of plot area
      let y = padTop;
      while (y < h - padBottom) {
        const yEnd = Math.min(y + dashLen, h - padBottom);
        vertices.push(x, y, DASH_COLOR[0], DASH_COLOR[1], DASH_COLOR[2]);
        vertices.push(x, yEnd, DASH_COLOR[0], DASH_COLOR[1], DASH_COLOR[2]);
        y += dashPeriod;
      }
    }

    // ── Draw highlight for selected G-code line ──
    if (this.selectedLineNumber >= 0) {
      // Find the segment(s) with this line number
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.lineNumber !== this.selectedLineNumber) continue;
        const tStart = s.timeStart;
        const tEnd = s.timeStart + s.duration;
        if (tEnd < this.view.tMin || tStart > this.view.tMax) continue;

        const x1 = t2x(Math.max(tStart, this.view.tMin));
        const x2 = t2x(Math.min(tEnd, this.view.tMax));

        // Solid vertical line at start
        vertices.push(x1, padTop, HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]);
        vertices.push(x1, h - padBottom, HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]);
        // Solid vertical line at end
        vertices.push(x2, padTop, HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]);
        vertices.push(x2, h - padBottom, HIGHLIGHT_COLOR[0], HIGHLIGHT_COLOR[1], HIGHLIGHT_COLOR[2]);
        break; // Only highlight first matching segment
      }
    }

    // Upload to GPU
    const vertexData = new Float32Array(vertices);
    this.vertexCount = vertices.length / 5;

    if (this.vertexBuffer) this.vertexBuffer.destroy();
    this.vertexBuffer = null;

    if (vertexData.byteLength === 0) return;

    this.vertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);
  }

  /**
   * Render the miniplot. Call every frame.
   */
  render(): void {
    if (!this.pipeline || !this.vertexBuffer || this.vertexCount === 0) return;
    if (!this.uniformBuffer || !this.bindGroup) return;
    if (this.canvas.width === 0 || this.canvas.height === 0) return;

    // Write resolution uniform
    const resolution = new Float32Array([this.canvas.width, this.canvas.height, 0, 0]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, resolution);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.12, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }
}
