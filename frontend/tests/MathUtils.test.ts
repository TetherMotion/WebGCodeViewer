/**
 * @file MathUtils.test.ts
 * @brief Unit tests for MathUtils.
 */

import { describe, it, expect } from 'vitest';
import {
  vec3, add, sub, scale, dot, cross, length, normalize, distance,
  lerp, clamp, degToRad, radToDeg, centroid, boundingBox,
  mat4Identity, mat4Multiply, mat4Perspective, mat4Ortho, mat4LookAt,
} from '../src/core/MathUtils';

describe('MathUtils', () => {
  describe('Vec3 operations', () => {
    it('creates vec3', () => {
      const v = vec3(1, 2, 3);
      expect(v).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('adds vectors', () => {
      expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
    });

    it('subtracts vectors', () => {
      expect(sub(vec3(4, 5, 6), vec3(1, 2, 3))).toEqual({ x: 3, y: 3, z: 3 });
    });

    it('scales vector', () => {
      expect(scale(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
    });

    it('computes dot product', () => {
      expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
      expect(dot(vec3(1, 0, 0), vec3(1, 0, 0))).toBe(1);
    });

    it('computes cross product', () => {
      expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    });

    it('computes length', () => {
      expect(length(vec3(3, 4, 0))).toBe(5);
      expect(length(vec3(0, 0, 0))).toBe(0);
    });

    it('normalizes vector', () => {
      const n = normalize(vec3(3, 0, 0));
      expect(n.x).toBeCloseTo(1);
      expect(n.y).toBeCloseTo(0);
      expect(n.z).toBeCloseTo(0);
    });

    it('normalizes zero vector to zero', () => {
      const n = normalize(vec3(0, 0, 0));
      expect(n).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('computes distance', () => {
      expect(distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5);
    });
  });

  describe('Scalar operations', () => {
    it('lerp', () => {
      expect(lerp(0, 10, 0.5)).toBe(5);
      expect(lerp(0, 10, 0)).toBe(0);
      expect(lerp(0, 10, 1)).toBe(10);
    });

    it('clamp', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(11, 0, 10)).toBe(10);
    });

    it('degToRad / radToDeg', () => {
      expect(degToRad(0)).toBe(0);
      expect(degToRad(180)).toBeCloseTo(Math.PI);
      expect(radToDeg(Math.PI)).toBeCloseTo(180);
    });
  });

  describe('Geometry', () => {
    it('computes centroid', () => {
      const points = [vec3(0, 0, 0), vec3(2, 2, 2), vec3(4, 0, 0)];
      const c = centroid(points);
      expect(c.x).toBeCloseTo(2);
      expect(c.y).toBeCloseTo(2/3);
      expect(c.z).toBeCloseTo(2/3);
    });

    it('computes bounding box', () => {
      const points = [vec3(-1, -2, -3), vec3(1, 2, 3)];
      const bb = boundingBox(points)!;
      expect(bb.min).toEqual({ x: -1, y: -2, z: -3 });
      expect(bb.max).toEqual({ x: 1, y: 2, z: 3 });
      expect(bb.center).toEqual({ x: 0, y: 0, z: 0 });
      expect(bb.size).toEqual({ x: 2, y: 4, z: 6 });
    });

    it('returns null for empty bounding box', () => {
      expect(boundingBox([])).toBeNull();
    });
  });

  describe('Matrix operations', () => {
    it('identity matrix', () => {
      const m = mat4Identity();
      expect(m[0]).toBe(1);
      expect(m[5]).toBe(1);
      expect(m[10]).toBe(1);
      expect(m[15]).toBe(1);
    });

    it('multiply identity', () => {
      const a = mat4Identity();
      const b = mat4Identity();
      const c = mat4Multiply(a, b);
      expect(c[0]).toBe(1);
      expect(c[15]).toBe(1);
    });

    it('perspective matrix', () => {
      const m = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
      expect(m[0]).not.toBe(0);
      expect(m[11]).toBe(-1);
    });

    it('perspective matrix maps near plane to NDC z=0, far to NDC z=1 (WebGPU)', () => {
      const near = 0.1, far = 100;
      const m = mat4Perspective(Math.PI / 2, 1, near, far);
      // Near plane: z_eye = -near, w = near
      const nearClipZ = m[10] * (-near) + m[14];
      const nearW = -(-near);
      expect(nearClipZ / nearW).toBeCloseTo(0, 5);
      // Far plane: z_eye = -far, w = far
      const farClipZ = m[10] * (-far) + m[14];
      const farW = -(-far);
      expect(farClipZ / farW).toBeCloseTo(1, 5);
    });

    it('ortho matrix maps near plane to NDC z=0, far to NDC z=1 (WebGPU)', () => {
      const near = 0.1, far = 100;
      const m = mat4Ortho(-10, 10, -10, 10, near, far);
      // Near plane: z_eye = -near, w = 1
      const nearNdcZ = m[10] * (-near) + m[14];
      expect(nearNdcZ).toBeCloseTo(0, 5);
      // Far plane: z_eye = -far, w = 1
      const farNdcZ = m[10] * (-far) + m[14];
      expect(farNdcZ).toBeCloseTo(1, 5);
    });

    it('lookAt matrix', () => {
      const m = mat4LookAt(vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0));
      expect(m[15]).toBe(1);
    });
  });
});
