/**
 * @file Camera.ts
 * @brief Orbit camera with smooth interpolation for WebGPU viewer.
 * Supports both perspective and orthographic projection modes.
 */

import { Vec3, Mat4, mat4Perspective, mat4Ortho, mat4LookAt, mat4Multiply, degToRad, clamp, lerp } from './MathUtils';

export type ProjectionMode = 'perspective' | 'orthographic';

export class Camera {
  private _eye: Vec3 = { x: 200, y: -200, z: 200 };
  private _target: Vec3 = { x: 0, y: 0, z: 0 };
  private _up: Vec3 = { x: 0, y: 0, z: 1 };
  private _fov: number = degToRad(45);
  private _aspect: number = 1.0;
  private _near: number = 0.1;
  private _far: number = 10000;
  private _projectionMode: ProjectionMode = 'perspective';
  private _orthoScale: number = 200; // half-height of ortho frustum

  // Target values for smooth interpolation
  private targetEye: Vec3 = { ...this._eye };
  private targetTarget: Vec3 = { ...this._target };

  // Orbit state
  private orbitAngle: number = 0;
  private orbitElevation: number = degToRad(30);
  private orbitDistance: number = 400;

  constructor() {
    this.updateOrbitPosition();
  }

  get eye(): Vec3 { return { ...this._eye }; }
  get target(): Vec3 { return { ...this._target }; }
  get fov(): number { return this._fov; }
  get projectionMode(): ProjectionMode { return this._projectionMode; }
  get orthoScale(): number { return this._orthoScale; }
  get orbitAngleVal(): number { return this.orbitAngle; }
  get orbitElevationVal(): number { return this.orbitElevation; }
  get orbitDistanceVal(): number { return this.orbitDistance; }

  setAspect(aspect: number): void {
    this._aspect = aspect;
  }

  setProjectionMode(mode: ProjectionMode): void {
    this._projectionMode = mode;
  }

  setTarget(target: Vec3): void {
    this.targetTarget = { ...target };
    this.updateOrbitPosition();
  }

  setOrbit(angle: number, elevation: number, distance: number): void {
    this.orbitAngle = angle;
    this.orbitElevation = clamp(elevation, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.orbitDistance = Math.max(1, distance);
    this.updateOrbitPosition();
  }

  orbit(deltaAngle: number, deltaElevation: number): void {
    this.orbitAngle += deltaAngle;
    this.orbitElevation = clamp(this.orbitElevation + deltaElevation, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.updateOrbitPosition();
  }

  zoom(factor: number): void {
    if (this._projectionMode === 'orthographic') {
      this._orthoScale = Math.max(1, this._orthoScale * factor);
    } else {
      this.orbitDistance = Math.max(1, this.orbitDistance * factor);
      this.updateOrbitPosition();
    }
  }

  pan(dx: number, dy: number): void {
    const forward = {
      x: this.targetTarget.x - this.targetEye.x,
      y: this.targetTarget.y - this.targetEye.y,
      z: this.targetTarget.z - this.targetEye.z,
    };
    const len = Math.sqrt(forward.x ** 2 + forward.y ** 2 + forward.z ** 2);
    if (len < 1e-6) return;
    forward.x /= len; forward.y /= len; forward.z /= len;

    // Right vector = forward × up
    const right = {
      x: forward.y * this._up.z - forward.z * this._up.y,
      y: forward.z * this._up.x - forward.x * this._up.z,
      z: forward.x * this._up.y - forward.y * this._up.x,
    };

    const panScale = this.orbitDistance * 0.001;
    this.targetTarget.x -= right.x * dx * panScale + forward.x * dy * panScale;
    this.targetTarget.y -= right.y * dx * panScale + forward.y * dy * panScale;
    this.targetTarget.z -= right.z * dx * panScale + forward.z * dy * panScale;
    this.updateOrbitPosition();
  }

  private updateOrbitPosition(): void {
    const ce = Math.cos(this.orbitElevation);
    this.targetEye = {
      x: this.targetTarget.x + this.orbitDistance * Math.cos(this.orbitAngle) * ce,
      y: this.targetTarget.y + this.orbitDistance * Math.sin(this.orbitAngle) * ce,
      z: this.targetTarget.z + this.orbitDistance * Math.sin(this.orbitElevation),
    };
  }

  update(dt: number): void {
    const smoothness = Math.min(1, dt * 10);
    this._eye.x = lerp(this._eye.x, this.targetEye.x, smoothness);
    this._eye.y = lerp(this._eye.y, this.targetEye.y, smoothness);
    this._eye.z = lerp(this._eye.z, this.targetEye.z, smoothness);
    this._target.x = lerp(this._target.x, this.targetTarget.x, smoothness);
    this._target.y = lerp(this._target.y, this.targetTarget.y, smoothness);
    this._target.z = lerp(this._target.z, this.targetTarget.z, smoothness);
  }

  get viewMatrix(): Mat4 {
    return mat4LookAt(this._eye, this._target, this._up);
  }

  get projectionMatrix(): Mat4 {
    if (this._projectionMode === 'orthographic') {
      const halfH = this._orthoScale;
      const halfW = halfH * this._aspect;
      return mat4Ortho(-halfW, halfW, -halfH, halfH, this._near, this._far);
    }
    return mat4Perspective(this._fov, this._aspect, this._near, this._far);
  }

  get viewProjectionMatrix(): Mat4 {
    return mat4Multiply(this.projectionMatrix, this.viewMatrix);
  }

  /**
   * Get the rotation-only matrix (view matrix without translation).
   * Used by the navigation gizmo to match camera orientation.
   */
  get viewRotationMatrix(): Mat4 {
    const view = this.viewMatrix;
    const rot = new Float32Array(16);
    // Copy rotation part (3x3), zero translation
    rot[0] = view[0]; rot[1] = view[1]; rot[2] = view[2]; rot[3] = 0;
    rot[4] = view[4]; rot[5] = view[5]; rot[6] = view[6]; rot[7] = 0;
    rot[8] = view[8]; rot[9] = view[9]; rot[10] = view[10]; rot[11] = 0;
    rot[12] = 0; rot[13] = 0; rot[14] = 0; rot[15] = 1;
    return rot;
  }

  /**
   * Fit the orthographic frustum to the XY bounding rectangle of the given
   * bounds, expanded by `padding` (fraction of the side length) on both sides.
   *
   * Unlike {@link fitToBounds} (which uses the bounding-sphere radius so the
   * whole object fits from any angle), this is meant for the top-down ortho
   * view used when isolating a G-code selection: the visible rectangle becomes
   * the projection's bounding rectangle of the highlighted traces plus the
   * requested margin, so the selection is framed tightly instead of being
   * zoomed out to the diagonal of its bounding box.
   *
   * The Z component is only used to position the orbit target; the frustum
   * size is determined entirely from X/Y and the viewport aspect ratio.
   */
  fitToOrthoRect(min: Vec3, max: Vec3, padding: number = 0.03): void {
    const w = max.x - min.x;
    const h = max.y - min.y;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    // Expand the rect by `padding` on both sides (total +2*padding per axis).
    const halfW = (w * (1 + 2 * padding)) / 2;
    const halfH = (h * (1 + 2 * padding)) / 2;
    // Ortho frustum: half-height = _orthoScale, half-width = _orthoScale * aspect.
    // Pick the smallest scale that still fits the padded rect in both axes.
    this._orthoScale = Math.max(1, Math.max(halfH, halfW / this._aspect));
    // Eye distance is irrelevant for ortho sizing, but keep it bounded so the
    // target stays well within the near/far planes.
    this.orbitDistance = Math.max(1, 2 * Math.max(halfW, halfH) + 10);
    this.setTarget({ x: cx, y: cy, z: cz });
  }

  fitToBounds(min: Vec3, max: Vec3, padding: number = 1.2): void {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    // Use the bounding sphere radius so the whole object is visible from
    // any viewing angle (the sphere's silhouette is a circle of this radius
    // regardless of orientation). Using only the largest axis dimension would
    // clip the object when viewed from an angle (e.g. the default iso view),
    // because the projected silhouette of an axis-aligned box grows as it is
    // rotated away from the axis.
    const dx = max.x - min.x, dy = max.y - min.y, dz = max.z - min.z;
    const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Fit against the smaller of the vertical/horizontal half-FOVs so the
    // sphere fits in both dimensions regardless of viewport aspect ratio.
    const halfV = this._fov / 2;
    const halfH = Math.atan(Math.tan(halfV) * this._aspect);
    const halfFov = Math.min(halfV, halfH);
    const distance = (radius * padding) / Math.sin(halfFov);
    this.setTarget(center);
    this.orbitDistance = Math.max(1, distance);
    this._orthoScale = radius * padding;
    this.updateOrbitPosition();
  }
}
