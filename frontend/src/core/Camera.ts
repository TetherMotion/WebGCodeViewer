/**
 * @file Camera.ts
 * @brief Orbit camera with smooth interpolation for WebGPU viewer.
 */

import { Vec3, Mat4, mat4Perspective, mat4LookAt, mat4Multiply, degToRad, clamp, lerp } from './MathUtils';

export class Camera {
  private _eye: Vec3 = { x: 200, y: -200, z: 200 };
  private _target: Vec3 = { x: 0, y: 0, z: 0 };
  private _up: Vec3 = { x: 0, y: 0, z: 1 };
  private _fov: number = degToRad(45);
  private _aspect: number = 1.0;
  private _near: number = 0.1;
  private _far: number = 10000;

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

  setAspect(aspect: number): void {
    this._aspect = aspect;
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
    this.orbitDistance = Math.max(1, this.orbitDistance * factor);
    this.updateOrbitPosition();
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
    return mat4Perspective(this._fov, this._aspect, this._near, this._far);
  }

  get viewProjectionMatrix(): Mat4 {
    return mat4Multiply(this.projectionMatrix, this.viewMatrix);
  }

  fitToBounds(min: Vec3, max: Vec3, padding: number = 1.2): void {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = Math.max(
      max.x - min.x,
      max.y - min.y,
      max.z - min.z,
    );
    const distance = size * padding / (2 * Math.tan(this._fov / 2));
    this.setTarget(center);
    this.orbitDistance = Math.max(1, distance);
    this.updateOrbitPosition();
  }
}
