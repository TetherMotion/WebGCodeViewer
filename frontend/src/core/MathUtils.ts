/**
 * @file MathUtils.ts
 * @brief Math utility functions for 3D geometry, color mapping, and interpolation.
 */

export interface Vec3 { x: number; y: number; z: number; }
export interface Vec4 { x: number; y: number; z: number; w: number; }

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(v, 1.0 / len);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function degToRad(deg: number): number {
  return deg * Math.PI / 180.0;
}

export function radToDeg(rad: number): number {
  return rad * 180.0 / Math.PI;
}

/**
 * Compute the centroid of a set of 3D points.
 */
export function centroid(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sz += p.z;
  }
  const n = points.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

/**
 * Compute the bounding box of a set of 3D points.
 */
export interface BoundingBox {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

export function boundingBox(points: Vec3[]): BoundingBox | null {
  if (points.length === 0) return null;
  let min = { ...points[0] };
  let max = { ...points[0] };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  return { min, max, center, size };
}

/**
 * 4x4 matrix stored in column-major order (WebGPU convention).
 */
export type Mat4 = Float32Array; // length 16

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const result = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        sum += a[i * 4 + row] * b[col * 4 + i];
      }
      result[col * 4 + row] = sum;
    }
  }
  return result;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(center, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const m = new Float32Array(16);
  m[0] = s.x; m[4] = s.y; m[8] = s.z;
  m[1] = u.x; m[5] = u.y; m[9] = u.z;
  m[2] = -f.x; m[6] = -f.y; m[10] = -f.z;
  m[12] = -dot(s, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  m[15] = 1;
  return m;
}

export function mat4Translate(m: Mat4, t: Vec3): Mat4 {
  const result = new Float32Array(m);
  result[12] += m[0] * t.x + m[4] * t.y + m[8] * t.z;
  result[13] += m[1] * t.x + m[5] * t.y + m[9] * t.z;
  result[14] += m[2] * t.x + m[6] * t.y + m[10] * t.z;
  result[15] += m[3] * t.x + m[7] * t.y + m[11] * t.z;
  return result;
}

export function mat4Scale(m: Mat4, s: Vec3): Mat4 {
  const result = new Float32Array(m);
  result[0] *= s.x; result[1] *= s.x; result[2] *= s.x; result[3] *= s.x;
  result[4] *= s.y; result[5] *= s.y; result[6] *= s.y; result[7] *= s.y;
  result[8] *= s.z; result[9] *= s.z; result[10] *= s.z; result[11] *= s.z;
  return result;
}

/**
 * Linear interpolation between two colors (RGB).
 */
export function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
