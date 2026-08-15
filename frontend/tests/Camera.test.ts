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

  it('fitToBounds centers on bbox midpoint', () => {
    const cam = new Camera();
    cam.setAspect(1.0);
    cam.fitToBounds(
      { x: 10, y: 20, z: 30 },
      { x: 110, y: 120, z: 130 },
    );
    cam.update(1.0);
    const t = cam.target;
    expect(t.x).toBeCloseTo(60, 5);
    expect(t.y).toBeCloseTo(70, 5);
    expect(t.z).toBeCloseTo(80, 5);
  });

  it('fitToBounds sets distance so the whole object fits from any angle', () => {
    const cam = new Camera();
    cam.setAspect(1.0);
    // A long thin box: 200 x 1 x 1. The bounding sphere radius is ~100.
    // The old max-dimension approach used size=200 and would clip the
    // 200-long axis when viewed from an angle; the sphere approach uses
    // the half-diagonal so the silhouette fits regardless of orientation.
    cam.fitToBounds(
      { x: -100, y: -0.5, z: -0.5 },
      { x: 100, y: 0.5, z: 0.5 },
    );
    const dist = cam.orbitDistanceVal;
    expect(dist).toBeGreaterThan(0);
    // For a sphere of radius r viewed with vertical half-fov h, the eye must
    // be at least r / sin(h) away for the sphere to fit. Verify the chosen
    // distance satisfies this for the default 45° fov.
    const radius = 0.5 * Math.sqrt(200 * 200 + 1 * 1 + 1 * 1);
    const halfFov = degToRad(45) / 2;
    expect(dist).toBeGreaterThanOrEqual(radius / Math.sin(halfFov) - 1e-6);
  });

  it('fitToBounds accounts for portrait aspect ratio', () => {
    const cam = new Camera();
    // Portrait viewport: horizontal fov is the constraint.
    cam.setAspect(0.5);
    cam.fitToBounds(
      { x: -100, y: -1, z: -1 },
      { x: 100, y: 1, z: 1 },
    );
    const distPortrait = cam.orbitDistanceVal;

    // Landscape viewport with the same bounds: vertical fov is the
    // constraint and is larger, so the required distance is smaller.
    cam.setAspect(2.0);
    cam.fitToBounds(
      { x: -100, y: -1, z: -1 },
      { x: 100, y: 1, z: 1 },
    );
    const distLandscape = cam.orbitDistanceVal;

    expect(distPortrait).toBeGreaterThan(distLandscape);
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

  it('pan moves target', () => {
    const cam = new Camera();
    const t1 = cam.target;
    cam.pan(100, 50);
    cam.update(1.0);
    const t2 = cam.target;
    expect(Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y)).toBeGreaterThan(0.01);
  });

  it('pan with zero-length forward does nothing', () => {
    const cam = new Camera();
    // Force eye == target to get zero-length forward
    cam.setTarget({ x: 0, y: 0, z: 0 });
    // Override internal state via setOrbit to make distance 0
    cam.setOrbit(0, 0.01, 1);
    const t1 = cam.target;
    cam.pan(100, 100);
    const t2 = cam.target;
    // Should not crash and target should remain essentially the same
    expect(t2.x).toBeCloseTo(t1.x, 5);
    expect(t2.y).toBeCloseTo(t1.y, 5);
  });

  it('setProjectionMode switches to orthographic', () => {
    const cam = new Camera();
    expect(cam.projectionMode).toBe('perspective');
    cam.setProjectionMode('orthographic');
    expect(cam.projectionMode).toBe('orthographic');
    // Projection matrix should be orthographic
    const proj = cam.projectionMatrix;
    expect(proj.length).toBe(16);
  });

  it('zoom in orthographic mode changes orthoScale', () => {
    const cam = new Camera();
    cam.setProjectionMode('orthographic');
    const scale1 = cam.orthoScale;
    cam.zoom(0.5);
    const scale2 = cam.orthoScale;
    expect(scale2).toBeLessThan(scale1);
  });

  it('viewRotationMatrix returns rotation-only matrix', () => {
    const cam = new Camera();
    const rot = cam.viewRotationMatrix;
    expect(rot.length).toBe(16);
    // Translation column should be zeroed
    expect(rot[12]).toBe(0);
    expect(rot[13]).toBe(0);
    expect(rot[14]).toBe(0);
    expect(rot[15]).toBe(1);
  });

  it('setOrbit clamps elevation and distance', () => {
    const cam = new Camera();
    cam.setOrbit(1.0, 10, -50); // extreme values
    expect(cam.orbitElevationVal).toBeLessThan(Math.PI / 2);
    expect(cam.orbitElevationVal).toBeGreaterThan(-Math.PI / 2);
    expect(cam.orbitDistanceVal).toBeGreaterThanOrEqual(1);
  });

  it('orbit clamps elevation', () => {
    const cam = new Camera();
    cam.orbit(0, 10); // large delta
    expect(cam.orbitElevationVal).toBeLessThan(Math.PI / 2);
  });

  it('getters return expected values', () => {
    const cam = new Camera();
    expect(cam.fov).toBeGreaterThan(0);
    expect(cam.orbitAngleVal).toBe(0);
    expect(cam.orbitElevationVal).toBeGreaterThan(0);
    expect(cam.orbitDistanceVal).toBeGreaterThan(0);
  });

  it('viewMatrix is 16 elements', () => {
    const cam = new Camera();
    const v = cam.viewMatrix;
    expect(v.length).toBe(16);
  });
});
