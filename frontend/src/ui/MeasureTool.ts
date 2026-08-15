/**
 * @file MeasureTool.ts
 * @brief Measurement tool for picking points and computing distances.
 */

import { EventDispatcher } from '../core/EventDispatcher';
import { Vec3, distance } from '../core/MathUtils';

export interface MeasureEvents {
  pointPicked: Vec3;
  distanceComputed: { from: Vec3; to: Vec3; distance: number };
}

export class MeasureTool extends EventDispatcher<MeasureEvents> {
  private element: HTMLElement;
  private active = false;
  private firstPoint: Vec3 | null = null;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'measure-tool';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Measure</h3>';
    const btn = document.createElement('button');
    btn.textContent = 'Start Measurement';
    btn.onclick = () => {
      this.active = !this.active;
      btn.textContent = this.active ? 'Cancel' : 'Start Measurement';
      this.firstPoint = null;
    };
    this.element.appendChild(btn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      this.firstPoint = null;
      this.updateDisplay(null);
    };
    this.element.appendChild(clearBtn);

    const display = document.createElement('div');
    display.className = 'measure-display';
    display.id = 'measure-display';
    this.element.appendChild(display);
  }

  isActive(): boolean {
    return this.active;
  }

  pickPoint(point: Vec3): void {
    if (!this.active) return;
    this.emit('pointPicked', point);
    if (this.firstPoint === null) {
      this.firstPoint = point;
      this.updateDisplay({ from: point, to: point, distance: 0 });
    } else {
      const d = distance(this.firstPoint, point);
      const result = { from: this.firstPoint, to: point, distance: d };
      this.emit('distanceComputed', result);
      this.updateDisplay(result);
      this.firstPoint = null;
    }
  }

  private updateDisplay(result: { from: Vec3; to: Vec3; distance: number } | null): void {
    const display = document.getElementById('measure-display');
    if (!display) return;
    if (result === null) {
      display.innerHTML = '';
    } else if (result.distance === 0) {
      display.innerHTML = `First point: (${result.from.x.toFixed(2)}, ${result.from.y.toFixed(2)}, ${result.from.z.toFixed(2)})`;
    } else {
      display.innerHTML = `Distance: ${result.distance.toFixed(3)} mm<br>
        From: (${result.from.x.toFixed(2)}, ${result.from.y.toFixed(2)}, ${result.from.z.toFixed(2)})<br>
        To: (${result.to.x.toFixed(2)}, ${result.to.y.toFixed(2)}, ${result.to.z.toFixed(2)})`;
    }
  }
}
