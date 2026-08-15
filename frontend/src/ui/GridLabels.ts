/**
 * @file GridLabels.ts
 * @brief 2D canvas overlay that renders numeric scale labels for the grid.
 *
 * Projects 3D tick positions to 2D screen space using the camera's
 * view-projection matrix, then draws text labels at those positions.
 * Labels are automatically thinned out when they would overlap (e.g.
 * when zoomed out), and culled when off-screen or behind the camera.
 * All labels use the same gray color as the grid.
 */

import { Mat4 } from '../core/MathUtils';
import type { TickInfo } from '../renderers/GridRenderer';

interface ProjectedTick {
  tick: TickInfo;
  screenX: number;
  screenY: number;
}

export class GridLabels {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  visible: boolean = true;

  // Label formatting
  private fontSize: number = 11;
  private font: string = `${this.fontSize}px sans-serif`;
  private labelColor: string = '#999';
  private bgColor: string = 'rgba(20, 20, 30, 0.6)';

  /** Minimum pixel spacing between labels on the same axis. */
  private minLabelSpacing: number = 35;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for grid labels');
    this.ctx = ctx;
  }

  /**
   * Render the grid labels.
   * @param ticks Array of tick info from GridRenderer
   * @param viewProj Camera view-projection matrix
   * @param canvasWidth WebGPU canvas width in CSS pixels
   * @param canvasHeight WebGPU canvas height in CSS pixels
   * @param depthData Previous frame's depth buffer (Float32Array, row-major, top-to-bottom), or null
   * @param depthSize [width, height] of the depth buffer in pixels
   */
  render(
    ticks: TickInfo[],
    viewProj: Mat4,
    canvasWidth: number,
    canvasHeight: number,
    depthData: Float32Array | null = null,
    depthSize: [number, number] = [0, 0],
  ): void {
    if (!this.visible) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, canvasWidth * dpr);
    const h = Math.max(1, canvasHeight * dpr);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.save();
    this.ctx.scale(dpr, dpr);
    this.ctx.font = this.font;
    this.ctx.textBaseline = 'middle';

    // ── Project all ticks to screen space ──
    const xTicks: ProjectedTick[] = [];
    const yTicks: ProjectedTick[] = [];

    for (const tick of ticks) {
      const [px, py, pz] = tick.position;
      const clipX = viewProj[0] * px + viewProj[4] * py + viewProj[8] * pz + viewProj[12];
      const clipY = viewProj[1] * px + viewProj[5] * py + viewProj[9] * pz + viewProj[13];
      const clipZ = viewProj[2] * px + viewProj[6] * py + viewProj[10] * pz + viewProj[14];
      const clipW = viewProj[3] * px + viewProj[7] * py + viewProj[11] * pz + viewProj[15];

      if (clipW <= 0.001) continue;

      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      const ndcZ = clipZ / clipW;  // NDC depth: -1..1, maps to 0..1 in depth buffer
      const screenX = (ndcX + 1) * 0.5 * canvasWidth;
      const screenY = (1 - ndcY) * 0.5 * canvasHeight;

      // Cull off-screen (with margin)
      if (screenX < -30 || screenX > canvasWidth + 30 ||
          screenY < -30 || screenY > canvasHeight + 30) continue;

      // Depth test: check if this tick is occluded by geometry
      // NDC z maps to depth buffer value as: depth = (ndcZ + 1) * 0.5
      // But WebGPU uses the reverse: depth = ndcZ * 0.5 + 0.5
      const tickDepth = ndcZ * 0.5 + 0.5;

      if (depthData && depthSize[0] > 0 && depthSize[1] > 0) {
        // Sample the depth buffer at the tick's screen position
        // depthData is in device pixels (dpr-scaled), screenX/screenY are in CSS pixels
        const bufW = depthSize[0];
        const bufH = depthSize[1];
        const sx = Math.round((screenX / canvasWidth) * bufW);
        const sy = Math.round((screenY / canvasHeight) * bufH);
        if (sx >= 0 && sx < bufW && sy >= 0 && sy < bufH) {
          const bufDepth = depthData[sy * bufW + sx];
          // If the depth buffer value is closer (smaller) than the tick's depth,
          // the tick is behind geometry and should be culled.
          // Use a small epsilon to avoid z-fighting with the grid plane itself.
          if (bufDepth < tickDepth - 0.002) continue;
        }
      }

      const pt = { tick, screenX, screenY };
      if (tick.axis === 0) xTicks.push(pt);
      else yTicks.push(pt);
    }

    // ── Thin out labels to avoid overlap ──
    // Sort by screen position, then keep every Nth label so that
    // consecutive labels are at least minLabelSpacing pixels apart.
    const visibleXTicks = this.thinTicks(xTicks, 'x');
    const visibleYTicks = this.thinTicks(yTicks, 'y');

    // ── Draw X-axis labels (bottom edge) ──
    for (const pt of visibleXTicks) {
      const label = this.formatValue(pt.tick.value);
      const metrics = this.ctx.measureText(label);
      const textW = metrics.width;
      const textH = this.fontSize;

      // Position label below the tick mark (further from grid center)
      const lx = pt.screenX;
      const ly = pt.screenY + 8;

      this.ctx.fillStyle = this.bgColor;
      this.ctx.fillRect(lx - textW / 2 - 2, ly - textH / 2 - 1, textW + 4, textH + 2);

      this.ctx.fillStyle = this.labelColor;
      this.ctx.textAlign = 'center';
      this.ctx.fillText(label, lx, ly);
    }

    // ── Draw Y-axis labels (left edge) ──
    for (const pt of visibleYTicks) {
      const label = this.formatValue(pt.tick.value);
      const metrics = this.ctx.measureText(label);
      const textW = metrics.width;
      const textH = this.fontSize;

      // Position label to the left of the tick mark (further from grid center)
      const lx = pt.screenX - 8;
      const ly = pt.screenY;

      this.ctx.fillStyle = this.bgColor;
      this.ctx.fillRect(lx - textW - 2, ly - textH / 2 - 1, textW + 4, textH + 2);

      this.ctx.fillStyle = this.labelColor;
      this.ctx.textAlign = 'right';
      this.ctx.fillText(label, lx, ly);
    }

    this.ctx.restore();
  }

  /**
   * Thin out ticks so that consecutive labels are at least minLabelSpacing
   * pixels apart on screen. Keeps the first and last, plus every Nth in between.
   */
  private thinTicks(ticks: ProjectedTick[], axis: 'x' | 'y'): ProjectedTick[] {
    if (ticks.length <= 1) return ticks;

    // Sort by screen position along the relevant axis
    const sorted = [...ticks].sort((a, b) =>
      axis === 'x' ? a.screenX - b.screenX : a.screenY - b.screenY,
    );

    // Find the total screen span
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = axis === 'x'
      ? last.screenX - first.screenX
      : last.screenY - first.screenY;

    // How many labels can fit?
    const maxLabels = Math.max(1, Math.floor(span / this.minLabelSpacing));
    if (maxLabels >= sorted.length) return sorted;

    // Pick evenly spaced subset
    const stride = Math.ceil(sorted.length / maxLabels);
    const result: ProjectedTick[] = [];
    for (let i = 0; i < sorted.length; i += stride) {
      result.push(sorted[i]);
    }
    // Always include the last one
    if (result[result.length - 1] !== last) {
      result.push(last);
    }
    return result;
  }

  private formatValue(v: number): string {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(1);
  }

  destroy(): void {
    // Nothing to clean up
  }
}
