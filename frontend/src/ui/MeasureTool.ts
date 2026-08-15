/**
 * @file MeasureTool.ts
 * @brief Measurement tool for picking points and computing distances and angles.
 */

import { EventDispatcher } from '../core/EventDispatcher';
import { Vec3, distance, sub, dot, length, normalize } from '../core/MathUtils';

export interface MeasureEvents {
  pointPicked: Vec3;
  distanceComputed: { from: Vec3; to: Vec3; distance: number };
  angleComputed: { p1: Vec3; p2: Vec3; p3: Vec3; angleDeg: number };
}

type MeasureMode = 'distance' | 'angle';

export class MeasureTool extends EventDispatcher<MeasureEvents> {
  private element: HTMLElement;
  private active = false;
  private mode: MeasureMode = 'distance';
  private firstPoint: Vec3 | null = null;
  private secondPoint: Vec3 | null = null;
  private modeBtn: HTMLButtonElement;
  private measureBtn: HTMLButtonElement;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'measure-tool';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Measure</h3>';

    // Mode toggle
    this.modeBtn = document.createElement('button');
    this.modeBtn.textContent = 'Mode: Distance';
    this.modeBtn.onclick = () => {
      this.mode = this.mode === 'distance' ? 'angle' : 'distance';
      this.modeBtn.textContent = `Mode: ${this.mode === 'distance' ? 'Distance' : 'Angle'}`;
      this.resetPoints();
    };
    this.element.appendChild(this.modeBtn);

    this.measureBtn = document.createElement('button');
    this.measureBtn.textContent = 'Start Measurement';
    this.measureBtn.onclick = () => {
      this.active = !this.active;
      this.measureBtn.textContent = this.active ? 'Cancel' : 'Start Measurement';
      this.resetPoints();
    };
    this.element.appendChild(this.measureBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      this.resetPoints();
      this.updateDisplay(null);
    };
    this.element.appendChild(clearBtn);

    const display = document.createElement('div');
    display.className = 'measure-display';
    display.id = 'measure-display';
    this.element.appendChild(display);
  }

  private resetPoints(): void {
    this.firstPoint = null;
    this.secondPoint = null;
  }

  isActive(): boolean {
    return this.active;
  }

  getMeasureMode(): MeasureMode {
    return this.mode;
  }

  pickPoint(point: Vec3): void {
    if (!this.active) return;
    this.emit('pointPicked', point);

    if (this.mode === 'distance') {
      if (this.firstPoint === null) {
        this.firstPoint = point;
        this.updateDisplay({ type: 'distance', from: point, to: point, distance: 0 });
      } else {
        const d = distance(this.firstPoint, point);
        const result = { from: this.firstPoint, to: point, distance: d };
        this.emit('distanceComputed', result);
        this.updateDisplay({ type: 'distance', from: this.firstPoint, to: point, distance: d });
        this.resetPoints();
      }
    } else {
      // Angle mode: pick 3 points (vertex is the second point)
      if (this.firstPoint === null) {
        this.firstPoint = point;
        this.updateDisplay({ type: 'angle-partial', points: [point], step: 1 });
      } else if (this.secondPoint === null) {
        this.secondPoint = point;
        this.updateDisplay({ type: 'angle-partial', points: [this.firstPoint, point], step: 2 });
      } else {
        // Compute angle at secondPoint between firstPoint and point (third)
        const v1 = sub(this.firstPoint, this.secondPoint);
        const v2 = sub(point, this.secondPoint);
        const l1 = length(v1);
        const l2 = length(v2);
        let angleDeg = 0;
        if (l1 > 1e-9 && l2 > 1e-9) {
          const cosAngle = Math.max(-1, Math.min(1, dot(v1, v2) / (l1 * l2)));
          angleDeg = Math.acos(cosAngle) * 180 / Math.PI;
        }
        const result = { p1: this.firstPoint, p2: this.secondPoint, p3: point, angleDeg };
        this.emit('angleComputed', result);
        this.updateDisplay({ type: 'angle', p1: this.firstPoint, p2: this.secondPoint, p3: point, angleDeg });
        this.resetPoints();
      }
    }
  }

  private updateDisplay(result: any): void {
    const display = document.getElementById('measure-display');
    if (!display) return;
    if (result === null) {
      display.innerHTML = '';
      return;
    }
    if (result.type === 'distance') {
      if (result.distance === 0) {
        display.innerHTML = `First point: (${result.from.x.toFixed(2)}, ${result.from.y.toFixed(2)}, ${result.from.z.toFixed(2)})`;
      } else {
        display.innerHTML = `Distance: ${result.distance.toFixed(3)} mm<br>` +
          `From: (${result.from.x.toFixed(2)}, ${result.from.y.toFixed(2)}, ${result.from.z.toFixed(2)})<br>` +
          `To: (${result.to.x.toFixed(2)}, ${result.to.y.toFixed(2)}, ${result.to.z.toFixed(2)})`;
      }
    } else if (result.type === 'angle-partial') {
      const pts = result.points as Vec3[];
      const step = result.step as number;
      const labels = ['P1 (arm start)', 'P2 (vertex)'];
      let html = `Angle measurement — pick point ${step + 1} of 3<br>`;
      for (let i = 0; i < pts.length; i++) {
        html += `${labels[i] || `P${i+1}`}: (${pts[i].x.toFixed(2)}, ${pts[i].y.toFixed(2)}, ${pts[i].z.toFixed(2)})<br>`;
      }
      display.innerHTML = html;
    } else if (result.type === 'angle') {
      const { p1, p2, p3, angleDeg } = result;
      display.innerHTML = `Angle: ${angleDeg.toFixed(2)}°<br>` +
        `P1: (${p1.x.toFixed(2)}, ${p1.y.toFixed(2)}, ${p1.z.toFixed(2)})<br>` +
        `Vertex: (${p2.x.toFixed(2)}, ${p2.y.toFixed(2)}, ${p2.z.toFixed(2)})<br>` +
        `P3: (${p3.x.toFixed(2)}, ${p3.y.toFixed(2)}, ${p3.z.toFixed(2)})`;
    }
  }
}
