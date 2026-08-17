/**
 * @file GridLabelProjection.test.ts
 * @brief Tests for 3D→2D projection and label formatting logic
 *        used by the grid labels overlay.
 *
 * These tests verify the mathematical projection of 3D tick positions
 * to 2D screen coordinates, label thinning, and value formatting —
 * all of which are pure JS logic that doesn't require WebGPU.
 */

import { describe, it, expect } from 'vitest';
import { mat4Perspective, mat4LookAt, mat4Multiply, Mat4 } from "@tether/viewer-core";

// ─── Projection Logic Tests ────────────────────────────────────────────

describe('3D to 2D projection', () => {
  // Replicate the projection logic from GridLabels.render()
  function project(
    pos: [number, number, number],
    viewProj: Mat4,
    canvasWidth: number,
    canvasHeight: number,
  ): { x: number; y: number; z: number; behindCamera: boolean } {
    const [px, py, pz] = pos;
    const clipX = viewProj[0] * px + viewProj[4] * py + viewProj[8] * pz + viewProj[12];
    const clipY = viewProj[1] * px + viewProj[5] * py + viewProj[9] * pz + viewProj[13];
    const clipZ = viewProj[2] * px + viewProj[6] * py + viewProj[10] * pz + viewProj[14];
    const clipW = viewProj[3] * px + viewProj[7] * py + viewProj[11] * pz + viewProj[15];

    if (clipW <= 0.001) return { x: 0, y: 0, z: 0, behindCamera: true };

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;
    const screenX = (ndcX + 1) * 0.5 * canvasWidth;
    const screenY = (1 - ndcY) * 0.5 * canvasHeight;

    return { x: screenX, y: screenY, z: ndcZ, behindCamera: false };
  }

  it('projects origin to center of canvas', () => {
    const view = mat4LookAt({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const proj = mat4Perspective(60, 1, 0.1, 100);
    const vp = mat4Multiply(proj, view);

    const result = project([0, 0, 0], vp, 800, 600);
    expect(result.behindCamera).toBe(false);
    // Origin should project near the center
    expect(result.x).toBeCloseTo(400, 0);
    expect(result.y).toBeCloseTo(300, 0);
  });

  it('projects points behind camera correctly', () => {
    const view = mat4LookAt({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const proj = mat4Perspective(60, 1, 0.1, 100);
    const vp = mat4Multiply(proj, view);

    // Point behind the camera (at x=20, camera at x=10 looking toward origin)
    const result = project([20, 0, 5], vp, 800, 600);
    expect(result.behindCamera).toBe(true);
  });

  it('projects points at different X positions to different screen X', () => {
    // Camera looking down the Y axis at the origin from above
    const view = mat4LookAt({ x: 0, y: -10, z: 10 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const proj = mat4Perspective(60, 1, 0.1, 100);
    const vp = mat4Multiply(proj, view);

    const left = project([-5, 0, 0], vp, 800, 600);
    const center = project([0, 0, 0], vp, 800, 600);
    const right = project([5, 0, 0], vp, 800, 600);

    // All three should be in front of the camera
    expect(left.behindCamera).toBe(false);
    expect(center.behindCamera).toBe(false);
    expect(right.behindCamera).toBe(false);
    // They should project to different screen X positions
    expect(left.x).not.toBeCloseTo(right.x, 0);
  });
});

// ─── Label Thinning Logic Tests ────────────────────────────────────────

describe('Label thinning algorithm', () => {
  // Replicate the thinTicks logic from GridLabels
  function thinTicks(
    ticks: { screenX: number; screenY: number; value: number }[],
    axis: 'x' | 'y',
    minSpacing: number,
  ): typeof ticks {
    if (ticks.length <= 1) return ticks;

    const sorted = [...ticks].sort((a, b) =>
      axis === 'x' ? a.screenX - b.screenX : a.screenY - b.screenY,
    );

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = axis === 'x'
      ? last.screenX - first.screenX
      : last.screenY - first.screenY;

    const maxLabels = Math.max(1, Math.floor(span / minSpacing));
    if (maxLabels >= sorted.length) return sorted;

    const stride = Math.ceil(sorted.length / maxLabels);
    const result: typeof ticks = [];
    for (let i = 0; i < sorted.length; i += stride) {
      result.push(sorted[i]);
    }
    if (result[result.length - 1] !== last) {
      result.push(last);
    }
    return result;
  }

  it('returns all ticks when they fit', () => {
    const ticks = [
      { screenX: 0, screenY: 0, value: 0 },
      { screenX: 100, screenY: 0, value: 10 },
      { screenX: 200, screenY: 0, value: 20 },
    ];
    const result = thinTicks(ticks, 'x', 35);
    expect(result.length).toBe(3);
  });

  it('thins ticks when they are too close', () => {
    const ticks: { screenX: number; screenY: number; value: number }[] = [];
    for (let i = 0; i < 100; i++) {
      ticks.push({ screenX: i * 5, screenY: 0, value: i });
    }
    // Span = 495, minSpacing = 35 → maxLabels = 14
    const result = thinTicks(ticks, 'x', 35);
    expect(result.length).toBeLessThan(100);
    expect(result.length).toBeGreaterThan(1);
  });

  it('always includes the last tick', () => {
    const ticks: { screenX: number; screenY: number; value: number }[] = [];
    for (let i = 0; i < 50; i++) {
      ticks.push({ screenX: i * 3, screenY: 0, value: i });
    }
    const result = thinTicks(ticks, 'x', 35);
    const lastTick = ticks[ticks.length - 1];
    const lastResult = result[result.length - 1];
    expect(lastResult.screenX).toBe(lastTick.screenX);
  });

  it('handles single tick', () => {
    const ticks = [{ screenX: 50, screenY: 0, value: 5 }];
    const result = thinTicks(ticks, 'x', 35);
    expect(result.length).toBe(1);
  });

  it('handles empty array', () => {
    const result = thinTicks([], 'x', 35);
    expect(result.length).toBe(0);
  });
});

// ─── Value Formatting Tests ────────────────────────────────────────────

describe('Label value formatting', () => {
  // Replicate the formatValue logic from GridLabels
  function formatValue(v: number): string {
    if (Math.abs(v) < 1e-9) return '0';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(1);
  }

  it('formats zero as "0"', () => {
    expect(formatValue(0)).toBe('0');
  });

  it('formats near-zero as "0"', () => {
    expect(formatValue(1e-10)).toBe('0');
    expect(formatValue(-1e-10)).toBe('0');
  });

  it('formats large values without decimals', () => {
    expect(formatValue(100)).toBe('100');
    expect(formatValue(150)).toBe('150');
    expect(formatValue(999)).toBe('999');
  });

  it('formats medium values with one decimal', () => {
    expect(formatValue(10)).toBe('10.0');
    expect(formatValue(50)).toBe('50.0');
    expect(formatValue(99.9)).toBe('99.9');
  });

  it('formats small values with one decimal', () => {
    expect(formatValue(1)).toBe('1.0');
    expect(formatValue(5.5)).toBe('5.5');
    expect(formatValue(9.99)).toBe('10.0');
  });

  it('formats negative values correctly', () => {
    expect(formatValue(-100)).toBe('-100');
    expect(formatValue(-50)).toBe('-50.0');
    expect(formatValue(-5)).toBe('-5.0');
  });
});

// ─── Grid Tick Generation Tests ────────────────────────────────────────

describe('Grid tick generation', () => {
  // Replicate the grid tick generation logic from GridRenderer
  function generateTicks(gridSize: number, gridDivisions: number) {
    const step = gridSize / gridDivisions;
    const half = gridSize / 2;
    const tickLength = step * 0.3;
    const ticks: { position: [number, number, number]; value: number; axis: 0 | 1 }[] = [];

    for (let i = 0; i <= gridDivisions; i++) {
      const val = -half + i * step;
      // X-axis ticks (on bottom edge, Y = -half)
      ticks.push({
        position: [val, -half, 0],
        value: val,
        axis: 0,
      });
      // Y-axis ticks (on left edge, X = -half)
      ticks.push({
        position: [-half, val, 0],
        value: val,
        axis: 1,
      });
    }
    return { ticks, step, half, tickLength };
  }

  it('generates correct number of ticks', () => {
    const { ticks } = generateTicks(200, 20);
    // 21 X ticks + 21 Y ticks = 42
    expect(ticks.length).toBe(42);
  });

  it('tick values span from -half to +half', () => {
    const { ticks, half } = generateTicks(200, 20);
    const xTicks = ticks.filter(t => t.axis === 0);
    expect(xTicks[0].value).toBe(-half);
    expect(xTicks[xTicks.length - 1].value).toBe(half);
  });

  it('tick step is correct', () => {
    const { step } = generateTicks(200, 20);
    expect(step).toBe(10);
  });

  it('includes a tick at zero', () => {
    const { ticks } = generateTicks(200, 20);
    const hasZero = ticks.some(t => Math.abs(t.value) < 1e-9);
    expect(hasZero).toBe(true);
  });

  it('tick positions are on the grid edges', () => {
    const { ticks, half } = generateTicks(200, 20);
    const xTicks = ticks.filter(t => t.axis === 0);
    for (const t of xTicks) {
      // X ticks should be at Y = -half
      expect(t.position[1]).toBe(-half);
    }
    const yTicks = ticks.filter(t => t.axis === 1);
    for (const t of yTicks) {
      // Y ticks should be at X = -half
      expect(t.position[0]).toBe(-half);
    }
  });
});
