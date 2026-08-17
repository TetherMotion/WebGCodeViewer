/**
 * @file MiniplotRenderer.ts
 * @brief WebGPU 2D line chart for per-axis speed visualization, backed by ChartGPU.
 *
 * Uses ChartGPU (https://github.com/ChartGPU/ChartGPU) for rendering,
 * interaction, and zoom/pan instead of a custom WebGPU pipeline.
 */

import { ChartGPU, createPipelineCache, type ChartGPUInstance } from '@chartgpu/chartgpu';
import type { AnnotationConfig, ChartGPUOptions, SeriesConfig } from '@chartgpu/chartgpu';
import type { MiniplotAxis, MiniplotData } from '@tether/viewer-core';

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

const HIGHLIGHT_COLOR = '#ffcc00';
const EVENT_COLORS = {
  tool: '#ffd94d',
  temp: '#ff5c3d',
  fan: '#4d99ff',
  coolant: '#33e6e6',
};

function rgbToCss(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export class MiniplotRenderer {
  private container: HTMLElement;
  private device: GPUDevice;
  private adapter: GPUAdapter;
  private chart: ChartGPUInstance | null = null;

  private data: MiniplotData | null = null;
  private axis: MiniplotAxis = 'speedE';
  private selectedLineNumber: number = -1;
  private totalRange: ViewRange = { tMin: 0, tMax: 1 };

  private viewRangeCallback: (() => void) | null = null;

  constructor(container: HTMLElement, device: GPUDevice, adapter: GPUAdapter) {
    this.container = container;
    this.device = device;
    this.adapter = adapter;

    // Hide any pre-existing canvas so ChartGPU's child canvas is the only one.
    const existingCanvas = container.querySelector('canvas') as HTMLCanvasElement | null;
    if (existingCanvas) {
      existingCanvas.style.display = 'none';
    }
  }

  async init(): Promise<void> {
    const pipelineCache = createPipelineCache(this.device);
    const options: ChartGPUOptions = {
      renderMode: 'external',
      coordinateSystem: 'cartesian2d',
      theme: 'dark',
      tooltip: { show: false },
      xAxis: {
        type: 'value',
        name: 'Time (s)',
        min: 0,
      },
      yAxis: {
        type: 'value',
        name: AXIS_LABELS[this.axis],
        min: 0,
      },
      dataZoom: [{ type: 'inside' }],
      grid: { left: 4, right: 4, top: 4, bottom: 4 },
      series: [this.buildSeries(new Float32Array([0, 1]), new Float32Array([0, 0]))],
      annotations: [],
    };

    this.chart = await ChartGPU.create(this.container, options, {
      adapter: this.adapter,
      device: this.device,
      pipelineCache,
    });

    this.chart.on('zoomRangeChange', () => {
      this.viewRangeCallback?.();
    });
  }

  /**
   * Set the speed data and reset view to show everything.
   */
  setData(data: MiniplotData): void {
    this.data = data;
    if (data.segments.length > 0) {
      this.totalRange = { tMin: 0, tMax: data.totalTime > 0 ? data.totalTime : 1 };
    }
    this.updateChart();
    this.chart?.setZoomRange(0, 100);
  }

  /**
   * Set which axis to plot.
   */
  setAxis(axis: MiniplotAxis): void {
    this.axis = axis;
    this.updateChart();
  }

  /**
   * Set the selected G-code line number (for highlight indicator).
   * Pass -1 to clear.
   */
  setSelectedLine(lineNumber: number): void {
    this.selectedLineNumber = lineNumber;
    this.updateChart();
  }

  /**
   * Reset zoom to show the full time range.
   */
  resetZoom(): void {
    this.chart?.setZoomRange(0, 100);
  }

  /**
   * Handle mouse wheel for zooming. Returns true if handled.
   * ChartGPU handles wheel natively, so this is a no-op kept for API compatibility.
   */
  handleWheel(_deltaY: number, _mouseX: number): boolean {
    return true;
  }

  /**
   * Start a drag operation. No-op: ChartGPU handles panning internally.
   */
  startDrag(_mouseX: number): void {
    // ChartGPU handles drag-to-pan via inside dataZoom.
  }

  /**
   * Update drag. No-op.
   */
  updateDrag(_mouseX: number): void {
    // ChartGPU handles panning.
  }

  /**
   * End drag. No-op.
   */
  endDrag(): void {
    // ChartGPU handles panning.
  }

  /**
   * Whether a drag is currently in progress. Always false.
   */
  get dragging(): boolean {
    return false;
  }

  /**
   * Resize the chart canvas to match its CSS size.
   */
  resize(): void {
    this.chart?.resize();
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
    const total = this.totalRange.tMax - this.totalRange.tMin;
    const zr = this.chart?.getZoomRange();
    if (!zr) {
      return { tMin: this.totalRange.tMin, tMax: this.totalRange.tMax };
    }
    return {
      tMin: this.totalRange.tMin + total * zr.start / 100,
      tMax: this.totalRange.tMin + total * zr.end / 100,
    };
  }

  /**
   * Register a callback that fires whenever the visible time range changes.
   */
  onViewRangeChange(callback: () => void): void {
    this.viewRangeCallback = callback;
  }

  /**
   * Render the miniplot. Call every frame.
   */
  render(): void {
    this.chart?.renderFrame();
  }

  destroy(): void {
    this.chart?.dispose();
    this.chart = null;
  }

  private updateChart(): void {
    if (!this.chart || !this.data || this.data.segments.length === 0) return;

    const { x, y } = this.buildData(this.data, this.axis);
    const annotations = this.buildAnnotations();

    const options: ChartGPUOptions = {
      renderMode: 'external',
      coordinateSystem: 'cartesian2d',
      theme: 'dark',
      tooltip: { show: false },
      xAxis: {
        type: 'value',
        name: 'Time (s)',
        min: 0,
        max: this.data.totalTime,
      },
      yAxis: {
        type: 'value',
        name: AXIS_LABELS[this.axis],
        min: 0,
      },
      dataZoom: [{ type: 'inside' }],
      grid: { left: 4, right: 4, top: 4, bottom: 4 },
      series: [this.buildSeries(x, y)],
      annotations,
    };

    this.chart.setOption(options);
  }

  private buildData(data: MiniplotData, axis: MiniplotAxis): { x: Float32Array; y: Float32Array } {
    const n = data.segments.length * 2;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    for (let i = 0; i < data.segments.length; i++) {
      const s = data.segments[i]!;
      const v = s[axis];
      const tStart = s.timeStart;
      const tEnd = s.timeStart + s.duration;
      x[i * 2] = tStart;
      x[i * 2 + 1] = tEnd;
      y[i * 2] = v;
      y[i * 2 + 1] = v;
    }
    return { x, y };
  }

  private buildSeries(x: Float32Array, y: Float32Array): SeriesConfig {
    const color = rgbToCss(AXIS_COLORS[this.axis]);
    return {
      type: 'line',
      name: AXIS_LABELS[this.axis],
      color,
      step: true,
      sampling: 'none',
      lineStyle: { width: 2 },
      data: { x, y },
    };
  }

  private buildAnnotations(): AnnotationConfig[] {
    if (!this.data) return [];

    const annotations: AnnotationConfig[] = [];

    // Build a line-number -> start-time lookup.
    const lineToTime = new Map<number, number>();
    for (const s of this.data.segments) {
      if (!lineToTime.has(s.lineNumber)) {
        lineToTime.set(s.lineNumber, s.timeStart);
      }
    }

    const addEventAnnotations = (lines: number[] | undefined, color: string): void => {
      if (!lines) return;
      for (const ln of lines) {
        const t = lineToTime.get(ln);
        if (t === undefined) continue;
        annotations.push({
          type: 'lineX',
          x: t,
          style: { color, lineWidth: 1, lineDash: [3, 3], opacity: 0.7 },
        });
      }
    };

    addEventAnnotations(this.data.toolChangeLines, EVENT_COLORS.tool);
    addEventAnnotations(this.data.tempChangeLines, EVENT_COLORS.temp);
    addEventAnnotations(this.data.fanChangeLines, EVENT_COLORS.fan);
    addEventAnnotations(this.data.coolantChangeLines, EVENT_COLORS.coolant);

    if (this.selectedLineNumber >= 0) {
      const t = lineToTime.get(this.selectedLineNumber);
      if (t !== undefined) {
        annotations.push({
          type: 'lineX',
          x: t,
          style: { color: HIGHLIGHT_COLOR, lineWidth: 2, opacity: 1.0 },
        });
      }
    }

    return annotations;
  }
}
