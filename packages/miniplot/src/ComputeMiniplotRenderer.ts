/**
 * @file ComputeMiniplotRenderer.ts
 * @brief Experimental WebGPU miniplot that resamples the source data on the GPU.
 *
 * Instead of feeding a pre-tessellated polyline to a chart library, this
 * renderer keeps the raw per-segment MiniplotData in a storage buffer and
 * dispatches a compute shader that emits one (time, value) point per output
 * pixel for the current view range. A second pass draws the resulting line
 * strip. This means the GPU only evaluates the points that are actually needed
 * for the current zoom/scroll window.
 *
 * Current scope:
 * - One continuous line for the selected axis.
 * - Wheel zoom and drag pan on the time axis.
 * - A selected G-code line highlighted as a vertical overlay.
 */

import type { MiniplotAxis, MiniplotData } from '@tether/viewer-core';

const AXIS_LABELS: Record<MiniplotAxis, string> = {
  speedE: 'Extruder Speed (mm/s)',
  speedX: 'X Speed (mm/s)',
  speedY: 'Y Speed (mm/s)',
  speedZ: 'Z Speed (mm/s)',
  speedLinear: 'Linear Speed (mm/s)',
};

const AXIS_COLORS: Record<MiniplotAxis, [number, number, number]> = {
  speedE: [0.29, 0.62, 1.0],
  speedX: [1.0, 0.53, 0.28],
  speedY: [0.53, 0.85, 0.38],
  speedZ: [0.91, 0.33, 0.53],
  speedLinear: [0.85, 0.85, 0.35],
};

const HIGHLIGHT_COLOR = '#ffcc00';

interface ViewRange {
  tMin: number;
  tMax: number;
}

interface SegmentUniform {
  timeStart: number;
  duration: number;
  speedX: number;
  speedY: number;
  speedZ: number;
  speedE: number;
  speedLinear: number;
  blockIndex: number;
  lineNumber: number;
}

export class ComputeMiniplotRenderer {
  private container: HTMLElement;
  private device: GPUDevice;
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;

  private data: MiniplotData | null = null;
  private axis: MiniplotAxis = 'speedLinear';
  private selectedLine: number = -1;

  private totalRange: ViewRange = { tMin: 0, tMax: 1 };
  private viewRange: ViewRange = { tMin: 0, tMax: 1 };
  private yRange: { min: number; max: number } = { min: 0, max: 1 };

  private viewRangeCallback: (() => void) | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartTMin = 0;
  private dragTSpan = 0;

  // GPU resources
  private segmentBuffer: GPUBuffer | null = null;
  private pointBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  private computeUniformBuffer: GPUBuffer | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private lineBindGroup: GPUBindGroup | null = null;
  private lineUniformBuffer: GPUBuffer | null = null;

  private readonly maxOutputPoints = 2048;

  constructor(container: HTMLElement, device: GPUDevice) {
    this.container = container;
    this.device = device;
  }

  async init(): Promise<void> {
    // Hide any pre-existing canvases in the container (the static fallback canvas).
    const existingCanvases = this.container.querySelectorAll('canvas');
    for (const c of existingCanvases) {
      (c as HTMLCanvasElement).style.display = 'none';
    }

    // Create a canvas that fills the container.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'miniplot-compute-canvas';
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

    this.resizeCanvas();

    // Compute shader: one point per output pixel.
    const computeShader = this.device.createShaderModule({
      code: `
        struct Segment {
          timeStart: f32,
          duration: f32,
          speedX: f32,
          speedY: f32,
          speedZ: f32,
          speedE: f32,
          speedLinear: f32,
          blockIndex: f32,
          lineNumber: f32,
        };

        struct ComputeUniforms {
          tMin: f32,
          tMax: f32,
          outputPoints: u32,
          axis: u32,          // 0=X,1=Y,2=Z,3=E,4=Linear
          segmentCount: u32,
          padding: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: ComputeUniforms;
        @group(0) @binding(1) var<storage, read> segments: array<Segment>;
        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;

        fn segmentValue(s: Segment, axis: u32) -> f32 {
          switch (axis) {
            case 0u: { return s.speedX; }
            case 1u: { return s.speedY; }
            case 2u: { return s.speedZ; }
            case 3u: { return s.speedE; }
            case 4u: { return s.speedLinear; }
            default: { return s.speedLinear; }
          }
        }

        @compute @workgroup_size(64)
        fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
          let idx = global_id.x;
          if (idx >= uniforms.outputPoints) { return; }

          let n = uniforms.outputPoints;
          let t = select(uniforms.tMin, uniforms.tMin + (uniforms.tMax - uniforms.tMin) * (f32(idx) / f32(n - 1)), n > 1u);

          // Binary search for the segment containing t.
          var lo = 0u;
          var hi = uniforms.segmentCount;
          while (lo < hi) {
            let mid = (lo + hi) / 2u;
            if (segments[mid].timeStart <= t) {
              lo = mid + 1u;
            } else {
              hi = mid;
            }
          }
          var segIdx = lo;
          if (segIdx == 0u || segIdx > uniforms.segmentCount) {
            segIdx = 0u;
          } else {
            segIdx = segIdx - 1u;
          }

          // Clamp to valid segment.
          if (segIdx >= uniforms.segmentCount) {
            segIdx = uniforms.segmentCount - 1u;
          }

          let s = segments[segIdx];
          let v = segmentValue(s, uniforms.axis);
          points[idx] = vec2<f32>(t, v);
        }
      `,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeShader, entryPoint: 'cs_main' },
    });

    this.computeUniformBuffer = this.device.createBuffer({
      size: 24,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pointBuffer = this.device.createBuffer({
      size: this.maxOutputPoints * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Line render pipeline.
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
          let ny = select(0.0, (point.y - uniforms.yMin) / (uniforms.yMax - uniforms.yMin), uniforms.yMax > uniforms.yMin);
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
      size: 32,
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
        { binding: 2, resource: { buffer: this.pointBuffer } },
      ],
    });

    // Event handlers.
    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.context) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    // CSS size stays 100%.
  }

  setData(data: MiniplotData): void {
    this.data = data;
    this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
    this.viewRange = { ...this.totalRange };
    this.computeYRange(data);
    this.uploadSegments(data);
  }

  private computeYRange(data: MiniplotData): void {
    let minV = Infinity;
    let maxV = -Infinity;
    for (const s of data.segments) {
      const v = s[this.axis];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (!isFinite(minV) || !isFinite(maxV) || minV >= maxV) {
      minV = 0;
      maxV = 1;
    } else {
      const pad = (maxV - minV) * 0.05;
      minV -= pad;
      maxV += pad;
    }
    this.yRange = { min: minV, max: maxV };
  }

  private uploadSegments(data: MiniplotData): void {
    if (!this.device) return;
    const n = data.segments.length;
    const arr = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const s = data.segments[i];
      const u: SegmentUniform = {
        timeStart: s.timeStart,
        duration: s.duration,
        speedX: s.speedX,
        speedY: s.speedY,
        speedZ: s.speedZ,
        speedE: s.speedE,
        speedLinear: s.speedLinear,
        blockIndex: s.blockIndex,
        lineNumber: s.lineNumber,
      };
      const base = i * 9;
      arr[base + 0] = u.timeStart;
      arr[base + 1] = u.duration;
      arr[base + 2] = u.speedX;
      arr[base + 3] = u.speedY;
      arr[base + 4] = u.speedZ;
      arr[base + 5] = u.speedE;
      arr[base + 6] = u.speedLinear;
      arr[base + 7] = u.blockIndex;
      arr[base + 8] = u.lineNumber;
    }
    if (this.segmentBuffer && this.segmentBuffer.size >= arr.byteLength) {
      this.device.queue.writeBuffer(this.segmentBuffer, 0, arr);
    } else {
      this.segmentBuffer?.destroy();
      this.segmentBuffer = this.device.createBuffer({
        size: arr.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.segmentBuffer, 0, arr);
      // Recreate compute bind group because segment buffer changed.
      if (this.computePipeline) {
        this.computeBindGroup = this.device.createBindGroup({
          layout: this.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
            { binding: 1, resource: { buffer: this.segmentBuffer } },
            { binding: 2, resource: { buffer: this.pointBuffer! } },
          ],
        });
      }
    }
  }

  setAxis(axis: MiniplotAxis): void {
    this.axis = axis;
    if (this.data) this.computeYRange(this.data);
  }

  setSelectedLine(lineNumber: number): void {
    this.selectedLine = lineNumber;
  }

  resetZoom(): void {
    this.viewRange = { ...this.totalRange };
    this.viewRangeCallback?.();
  }

  getAxisLabel(): string {
    return AXIS_LABELS[this.axis];
  }

  getViewRange(): ViewRange {
    return { ...this.viewRange };
  }

  onViewRangeChange(callback: () => void): void {
    this.viewRangeCallback = callback;
  }

  handleWheel(deltaY: number, _mouseX: number): boolean {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = _mouseX - rect.left;
    const t = this.viewRange.tMin + (mouseX / rect.width) * (this.viewRange.tMax - this.viewRange.tMin);
    const factor = deltaY > 0 ? 1.1 : 0.9;
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
    if (span > this.totalRange.tMax - this.totalRange.tMin) {
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
    if (!this.data || this.data.segments.length === 0 || !this.segmentBuffer) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    const canvasWidth = Math.max(1, Math.floor(rect.width * dpr));
    const outputPoints = Math.min(this.maxOutputPoints, canvasWidth);

    // Update compute uniforms.
    const cu = new ArrayBuffer(24);
    const cv = new DataView(cu);
    cv.setFloat32(0, this.viewRange.tMin, true);
    cv.setFloat32(4, this.viewRange.tMax, true);
    cv.setUint32(8, outputPoints, true);
    cv.setUint32(12, this.axisToIndex(this.axis), true);
    cv.setUint32(16, this.data.segments.length, true);
    this.device.queue.writeBuffer(this.computeUniformBuffer!, 0, cu);

    // Update line uniforms.
    const color = AXIS_COLORS[this.axis];
    const lu = new Float32Array(8);
    lu[0] = this.viewRange.tMin;
    lu[1] = this.viewRange.tMax;
    lu[2] = this.yRange.min;
    lu[3] = this.yRange.max;
    lu[4] = color[0];
    lu[5] = color[1];
    lu[6] = color[2];
    lu[7] = outputPoints;
    this.device.queue.writeBuffer(this.lineUniformBuffer!, 0, lu);

    // Compute pass.
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup!);
    computePass.dispatchWorkgroups(Math.ceil(outputPoints / 64));
    computePass.end();

    // Render pass.
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 0],
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(this.linePipeline);
    renderPass.setBindGroup(0, this.lineBindGroup!);
    renderPass.setVertexBuffer(0, this.pointBuffer!);
    renderPass.draw(outputPoints);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);

    // Overlay for selected line (CPU CSS). ChartGPU-style annotations omitted.
    this.drawSelectedLineOverlay();
  }

  private axisToIndex(axis: MiniplotAxis): number {
    switch (axis) {
      case 'speedX': return 0;
      case 'speedY': return 1;
      case 'speedZ': return 2;
      case 'speedE': return 3;
      case 'speedLinear': return 4;
    }
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

  private drawSelectedLineOverlay(): void {
    if (!this.canvas || this.selectedLine < 0 || !this.data) return;
    const t = this.findTimeForLine(this.selectedLine);
    if (t === null) return;
    if (t < this.viewRange.tMin || t > this.viewRange.tMax) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = ((t - this.viewRange.tMin) / (this.viewRange.tMax - this.viewRange.tMin)) * rect.width;

    // Remove old overlay line.
    const old = this.container.querySelector('.miniplot-compute-overlay') as HTMLElement | null;
    if (old) old.remove();

    const line = document.createElement('div');
    line.className = 'miniplot-compute-overlay';
    line.style.position = 'absolute';
    line.style.left = `${x}px`;
    line.style.top = '0';
    line.style.width = '2px';
    line.style.height = '100%';
    line.style.backgroundColor = HIGHLIGHT_COLOR;
    line.style.pointerEvents = 'none';
    this.container.style.position = 'relative';
    this.container.appendChild(line);
  }

  private findTimeForLine(lineNumber: number): number | null {
    if (!this.data) return null;
    for (const s of this.data.segments) {
      if (s.lineNumber === lineNumber) return s.timeStart;
    }
    return null;
  }

  destroy(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.segmentBuffer?.destroy();
    this.pointBuffer?.destroy();
    this.computeUniformBuffer?.destroy();
    this.lineUniformBuffer?.destroy();
  }
}
