/**
 * @file NavigationCube.ts
 * @brief CAD-like navigation overlay with axis gizmo, WebGPU-rendered
 * direction cubes, and orthographic/perspective projection switch.
 */

import { EventDispatcher } from '../core/EventDispatcher';

export type ViewDirection = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface NavigationCubeEvents {
  directionSelected: ViewDirection;
  projectionChanged: ProjectionMode;
}

export class NavigationCube extends EventDispatcher<NavigationCubeEvents> {
  private container: HTMLElement;
  gizmoCanvas: HTMLCanvasElement;
  dirCanvas: HTMLCanvasElement;  // WebGPU canvas for direction cubes
  private perspBtn: HTMLButtonElement;
  private orthoBtn: HTMLButtonElement;
  private currentMode: ProjectionMode = 'perspective';
  private activeDirection: ViewDirection | null = null;

  constructor(container: HTMLElement) {
    super();
    this.container = container;
    this.container.innerHTML = '';
    this.container.className = 'nav-cube-overlay';
    this.build();
  }

  private build(): void {
    // Gizmo canvas (small WebGPU canvas for axis rendering)
    this.gizmoCanvas = document.createElement('canvas');
    this.gizmoCanvas.className = 'nav-gizmo-canvas';
    this.gizmoCanvas.width = 80;
    this.gizmoCanvas.height = 80;
    this.container.appendChild(this.gizmoCanvas);

    // Direction cubes canvas (WebGPU-rendered 3D cubes)
    this.dirCanvas = document.createElement('canvas');
    this.dirCanvas.className = 'nav-dir-canvas';
    this.container.appendChild(this.dirCanvas);

    // Click handler for direction cubes
    this.dirCanvas.addEventListener('click', (e) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.dirCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cols = 4;
      const rows = 2;
      const cellW = rect.width / cols;
      const cellH = rect.height / rows;
      const col = Math.floor(x / cellW);
      const row = Math.floor(y / cellH);
      const idx = row * cols + col;
      const directions: ViewDirection[] = ['iso', 'top', 'front', 'right', 'left', 'back', 'bottom'];
      if (idx >= 0 && idx < directions.length) {
        const dir = directions[idx];
        this.emit('directionSelected', dir);
        this.setActiveDirection(dir);
      }
    });

    // Projection switch
    const projContainer = document.createElement('div');
    projContainer.className = 'nav-proj-switch';

    this.perspBtn = document.createElement('button');
    this.perspBtn.className = 'nav-proj-btn active';
    this.perspBtn.textContent = 'Persp';
    this.perspBtn.onclick = () => {
      if (this.currentMode !== 'perspective') {
        this.currentMode = 'perspective';
        this.perspBtn.classList.add('active');
        this.orthoBtn.classList.remove('active');
        this.emit('projectionChanged', 'perspective');
      }
    };
    projContainer.appendChild(this.perspBtn);

    this.orthoBtn = document.createElement('button');
    this.orthoBtn.className = 'nav-proj-btn';
    this.orthoBtn.textContent = 'Ortho';
    this.orthoBtn.onclick = () => {
      if (this.currentMode !== 'orthographic') {
        this.currentMode = 'orthographic';
        this.orthoBtn.classList.add('active');
        this.perspBtn.classList.remove('active');
        this.emit('projectionChanged', 'orthographic');
      }
    };
    projContainer.appendChild(this.orthoBtn);

    this.container.appendChild(projContainer);
  }

  setActiveDirection(dir: ViewDirection): void {
    this.activeDirection = dir;
  }

  setProjectionMode(mode: ProjectionMode): void {
    this.currentMode = mode;
    this.perspBtn.classList.toggle('active', mode === 'perspective');
    this.orthoBtn.classList.toggle('active', mode === 'orthographic');
  }

  getProjectionMode(): ProjectionMode {
    return this.currentMode;
  }
}
