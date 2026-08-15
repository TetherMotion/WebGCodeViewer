/**
 * @file NavigationCube.ts
 * @brief CAD-like navigation overlay with axis gizmo, cube direction buttons,
 * and orthographic/perspective projection switch.
 *
 * Layout (top-right of canvas, vertical stack):
 *   ┌──────────┐
 *   │  gizmo   │  ← small WebGPU canvas showing XYZ axes
 *   │  canvas  │     rotating with camera
 *   ├──────────┤
 *   │ ◆ ◆ ◆ ◆ │  ← cube icons for view directions
 *   │ ◆ ◆ ◆   │
 *   ├──────────┤
 *   │ Persp    │  ← projection switch (toggle)
 *   │ Ortho    │
 *   └──────────┘
 */

import { EventDispatcher } from '../core/EventDispatcher';

export type ViewDirection = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface NavigationCubeEvents {
  directionSelected: ViewDirection;
  projectionChanged: ProjectionMode;
}

// Isometric cube SVG geometry constants
const C = 20; // center
const R = 14;  // radius from center to face center

// Cube face colors (dimmed by default, bright when active)
const FACE_COLORS = {
  top:    { r: 180, g: 80, b: 80 },   // top = looking down -Z (warm)
  front:  { r: 80, g: 140, b: 80 },   // front = looking from -Y (green)
  right:  { r: 80, g: 100, b: 180 },  // right = looking from +X (blue)
};

/**
 * Generate an SVG isometric cube with the specified face highlighted.
 * The cube is drawn as three rhombus faces (top, front-left, front-right).
 * The `highlight` parameter specifies which face to brighten.
 */
function cubeSvg(highlight: 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom'): string {
  // Isometric cube vertices
  // Top face: top, left, center, right
  // Left face: left, bottomLeft, bottom, center
  // Right face: right, center, bottom, bottomRight
  const top = `${C},${C - R * 0.86}`;
  const left = `${C - R * 0.86},${C - R * 0.14}`;
  const right = `${C + R * 0.86},${C - R * 0.14}`;
  const center = `${C},${C + R * 0.14}`;
  const bottom = `${C},${C + R}`;
  const botLeft = `${C - R * 0.86},${C + R * 0.72}`;
  const botRight = `${C + R * 0.86},${C + R * 0.72}`;

  // Determine which faces to highlight based on direction
  // iso = all faces, top = top face, front = left face, right = right face
  // back = no face (dim all), left = no face (dim all), bottom = no face
  const highlightMap: Record<string, string[]> = {
    iso:    ['top', 'left', 'right'],
    top:    ['top'],
    front:  ['left'],
    right:  ['right'],
    back:   [],  // back face not visible in iso
    left:   [],  // left face not visible in iso
    bottom: [],  // bottom face not visible in iso
  };
  const hl = highlightMap[highlight] || [];

  const dim = (c: {r:number,g:number,b:number}) => `rgb(${c.r*0.4|0},${c.g*0.4|0},${c.b*0.4|0})`;
  const bright = (c: {r:number,g:number,b:number}) => `rgb(${c.r},${c.g},${c.b})`;

  const topColor = hl.includes('top') ? bright(FACE_COLORS.top) : dim(FACE_COLORS.top);
  const leftColor = hl.includes('left') ? bright(FACE_COLORS.front) : dim(FACE_COLORS.front);
  const rightColor = hl.includes('right') ? bright(FACE_COLORS.right) : dim(FACE_COLORS.right);

  // For back/left/bottom, highlight the visible faces in a neutral bright color
  const neutralBright = 'rgb(150,170,200)';
  if (highlight === 'back') {
    // back = looking from +Y, so the "right" face in our iso cube represents the back
    return `<svg viewBox="0 0 40 40" class="nav-cube-svg">
      <polygon points="${top} ${left} ${center} ${right}" fill="${topColor}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${left} ${botLeft} ${bottom} ${center}" fill="${neutralBright}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${right} ${center} ${bottom} ${botRight}" fill="${rightColor}" stroke="#555" stroke-width="0.5"/>
    </svg>`;
  }
  if (highlight === 'left') {
    return `<svg viewBox="0 0 40 40" class="nav-cube-svg">
      <polygon points="${top} ${left} ${center} ${right}" fill="${topColor}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${left} ${botLeft} ${bottom} ${center}" fill="${neutralBright}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${right} ${center} ${bottom} ${botRight}" fill="${rightColor}" stroke="#555" stroke-width="0.5"/>
    </svg>`;
  }
  if (highlight === 'bottom') {
    return `<svg viewBox="0 0 40 40" class="nav-cube-svg">
      <polygon points="${top} ${left} ${center} ${right}" fill="${topColor}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${left} ${botLeft} ${bottom} ${center}" fill="${leftColor}" stroke="#555" stroke-width="0.5"/>
      <polygon points="${right} ${center} ${bottom} ${botRight}" fill="${neutralBright}" stroke="#555" stroke-width="0.5"/>
    </svg>`;
  }

  return `<svg viewBox="0 0 40 40" class="nav-cube-svg">
    <polygon points="${top} ${left} ${center} ${right}" fill="${topColor}" stroke="#555" stroke-width="0.5"/>
    <polygon points="${left} ${botLeft} ${bottom} ${center}" fill="${leftColor}" stroke="#555" stroke-width="0.5"/>
    <polygon points="${right} ${center} ${bottom} ${botRight}" fill="${rightColor}" stroke="#555" stroke-width="0.5"/>
  </svg>`;
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

    // Direction buttons with cube icons
    const dirContainer = document.createElement('div');
    dirContainer.className = 'nav-dir-buttons';

    const directions: [ViewDirection, string][] = [
      ['iso', 'Isometric view'],
      ['top', 'Top view (−Z)'],
      ['front', 'Front view (−Y)'],
      ['right', 'Right view (+X)'],
      ['left', 'Left view (−X)'],
      ['back', 'Back view (+Y)'],
      ['bottom', 'Bottom view (+Z)'],
    ];

    for (const [dir, title] of directions) {
      const btn = document.createElement('button');
      btn.className = 'nav-dir-btn';
      btn.title = title;
      btn.innerHTML = cubeSvg(dir);
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
