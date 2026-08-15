/**
 * @file Camera.test.ts
 * @brief Unit tests for Camera.
 */

import { describe, it, expect } from 'vitest';
import { Camera } from '../src/core/Camera';
import { degToRad } from '../src/core/MathUtils';

describe('Camera', () => {
  it('has default eye and target', () => {
    const cam = new Camera();
    const eye = cam.eye;
    expect(eye.x).not.toBe(0);
    expect(eye.y).not.toBe(0);
    expect(eye.z).not.toBe(0);
  });

  it('setAspect updates aspect ratio', () => {
    const cam = new Camera();
    cam.setAspect(16 / 9);
    // No direct getter, but projection matrix should reflect aspect
    const proj = cam.projectionMatrix;
    expect(proj[0]).not.toBe(0);
  });

  it('orbit changes eye position', () => {
    const cam = new Camera();
    const eye1 = cam.eye;
    cam.orbit(0.5, 0.1);
    cam.update(1.0); // Interpolate to target
    const eye2 = cam.eye;
    // After orbiting by 0.5 rad and updating, eye should have moved
    const moved = Math.abs(eye1.x - eye2.x) + Math.abs(eye1.y - eye2.y);
    expect(moved).toBeGreaterThan(0.01);
  });

  it('zoom changes distance', () => {
    const cam = new Camera();
    const eye1 = cam.eye;
    cam.zoom(0.5);
    cam.update(1.0);
    const eye2 = cam.eye;
    const dist1 = Math.hypot(eye1.x, eye1.y, eye1.z);
    const dist2 = Math.hypot(eye2.x, eye2.y, eye2.z);
    expect(dist2).toBeLessThan(dist1);
  });

  it('setTarget moves target', () => {
    const cam = new Camera();
    cam.setTarget({ x: 100, y: 50, z: 25 });
    cam.update(1.0);
    const t = cam.target;
    expect(t.x).toBeCloseTo(100, 0);
    expect(t.y).toBeCloseTo(50, 0);
    expect(t.z).toBeCloseTo(25, 0);
  });

  it('fitToBounds adjusts camera', () => {
    const cam = new Camera();
    cam.fitToBounds(
      { x: -50, y: -50, z: 0 },
      { x: 50, y: 50, z: 100 },
    );
    cam.update(1.0);
    const t = cam.target;
    expect(t.x).toBeCloseTo(0, 0);
    expect(t.y).toBeCloseTo(0, 0);
    expect(t.z).toBeCloseTo(50, 0);
  });

  it('viewProjectionMatrix is 16 elements', () => {
    const cam = new Camera();
    const vp = cam.viewProjectionMatrix;
    expect(vp.length).toBe(16);
  });

  it('update interpolates towards target', () => {
    const cam = new Camera();
    cam.setTarget({ x: 100, y: 0, z: 0 });
    const eye1 = cam.eye;
    cam.update(1.0);
    const eye2 = cam.eye;
    // After update, eye should have moved
    expect(eye1.x).not.toBeCloseTo(eye2.x, 1);
  });
});
