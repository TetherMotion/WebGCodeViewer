/**
 * @file NavigationCube.ts
 * @brief CAD-like navigation overlay with axis gizmo, direction buttons,
 * and orthographic/perspective projection switch.
 *
 * Layout (top-right of canvas, vertical stack):
 *   ┌──────────┐
 *   │  gizmo   │  ← small WebGPU canvas showing XYZ axes
 *   │  canvas  │     rotating with camera
 *   ├──────────┤
 *   │ ISO □    │  ← isometric view button
 *   │ TOP □    │  ← top view (looking down -Z)
 *   │ FRONT □  │  ← front view (looking from -Y)
 *   │ RIGHT □  │  ← right view (looking from +X)
 *   ├──────────┤
 *   │ Persp    │  ← projection switch (toggle)
 *   │ Ortho    │
 *   └──────────┘
 */

import { EventDispatcher } from '../core/EventDispatcher';
import { degToRad } from '../core/MathUtils';

export type ViewDirection = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface NavigationCubeEvents {
  directionSelected: ViewDirection;
  projectionChanged: ProjectionMode;
}

export class NavigationCube extends EventDispatcher<NavigationCubeEvents> {
  private container: HTMLElement;
  gizmoCanvas: HTMLCanvasElement;
  private dirButtons: Map<ViewDirection, HTMLButtonElement> = new Map();
  private perspBtn: HTMLButtonElement;
  private orthoBtn: HTMLButtonElement;
  private currentMode: ProjectionMode = 'perspective';

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

    // Direction buttons
    const dirContainer = document.createElement('div');
    dirContainer.className = 'nav-dir-buttons';

    const directions: [ViewDirection, string, string][] = [
      ['iso', 'ISO', 'Isometric view'],
      ['top', 'TOP', 'Top view (−Z)'],
      ['front', 'FRONT', 'Front view (−Y)'],
      ['right', 'RIGHT', 'Right view (+X)'],
      ['left', 'LEFT', 'Left view (−X)'],
      ['back', 'BACK', 'Back view (+Y)'],
      ['bottom', 'BOTTOM', 'Bottom view (+Z)'],
    ];

    for (const [dir, label, title] of directions) {
      const btn = document.createElement('button');
      btn.className = 'nav-dir-btn';
      btn.textContent = label;
      btn.title = title;
      btn.onclick = () => {
        this.emit('directionSelected', dir);
        this.setActiveDirection(dir);
      };
      this.dirButtons.set(dir, btn);
      dirContainer.appendChild(btn);
    }

    this.container.appendChild(dirContainer);

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
    for (const [key, btn] of this.dirButtons) {
      btn.classList.toggle('active', key === dir);
    }
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
