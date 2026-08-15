/**
 * @file GridLabels.ts
 * @brief 2D canvas overlay that renders numeric scale labels for the grid.
 *
 * Projects 3D tick positions to 2D screen space using the camera's
 * view-projection matrix, then draws text labels at those positions.
 * Labels are culled when they go off-screen or behind the camera.
 */

import { Mat4 } from '../core/MathUtils';
import type { TickInfo } from '../renderers/GridRenderer';

export class GridLabels {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  visible: boolean = true;

  // Label formatting
  private fontSize: number = 11;
  private font: string = `${this.fontSize}px sans-serif`;
  private labelColor: string = '#ccc';
  private xAxisColor: string = '#e55';
  private yAxisColor: string = '#5c5';
  private bgColor: string = 'rgba(20, 20, 30, 0.6)';

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
   */
  render(
    ticks: TickInfo[],
    viewProj: Mat4,
    canvasWidth: number,
    canvasHeight: number,
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

    for (const tick of ticks) {
      // Project 3D position to clip space
      const [px, py, pz] = tick.position;
      const clipX = viewProj[0] * px + viewProj[4] * py + viewProj[8] * pz + viewProj[12];
      const clipY = viewProj[1] * px + viewProj[5] * py + viewProj[9] * pz + viewProj[13];
      const clipZ = viewProj[2] * px + viewProj[6] * py + viewProj[10] * pz + viewProj[14];
      const clipW = viewProj[3] * px + viewProj[7] * py + viewProj[11] * pz + viewProj[15];

      // Behind camera or degenerate
      if (clipW <= 0.001) continue;

      // NDC
      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;

      // Screen space (CSS pixels)
      const screenX = (ndcX + 1) * 0.5 * canvasWidth;
      const screenY = (1 - ndcY) * 0.5 * canvasHeight;

      // Cull off-screen
      if (screenX < -20 || screenX > canvasWidth + 20 ||
          screenY < -20 || screenY > canvasHeight + 20) continue;

      const label = this.formatValue(tick.value);
      const color = tick.axis === 0 ? this.xAxisColor : this.yAxisColor;

      // Measure text for background
      const metrics = this.ctx.measureText(label);
      const textW = metrics.width;
      const textH = this.fontSize;

      // Offset label slightly from tick position
      const offsetX = tick.axis === 0 ? 0 : 6;
      const offsetY = tick.axis === 0 ? -8 : 0;
      const lx = screenX + offsetX;
      const ly = screenY + offsetY;

      // Draw background
      this.ctx.fillStyle = this.bgColor;
      this.ctx.fillRect(lx - textW / 2 - 2, ly - textH / 2 - 1, textW + 4, textH + 2);

      // Draw text
      this.ctx.fillStyle = color;
      this.ctx.textAlign = 'center';
      this.ctx.fillText(label, lx, ly);
    }

    this.ctx.restore();
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
