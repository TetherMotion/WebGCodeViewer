/**
 * @file CutPlanePanel.ts
 * @brief Side panel for controlling the cross-section cut plane.
 */

import { EventDispatcher } from '../core/EventDispatcher';

export interface CutPlaneEvents {
  planeZChanged: number;
  toleranceChanged: number;
  visibleChanged: boolean;
}

export class CutPlanePanel extends EventDispatcher<CutPlaneEvents> {
  private element: HTMLElement;
  private zSlider: HTMLInputElement;
  private tolSlider: HTMLInputElement;
  private visibleCheckbox: HTMLInputElement;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'cut-plane-panel';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Cross-Section</h3>';

    const zLabel = document.createElement('label');
    zLabel.textContent = 'Z Height: ';
    this.zSlider = document.createElement('input');
    this.zSlider.type = 'range';
    this.zSlider.min = '0';
    this.zSlider.max = '100';
    this.zSlider.value = '50';
    this.zSlider.oninput = () => {
      this.emit('planeZChanged', parseFloat(this.zSlider.value));
    };
    zLabel.appendChild(this.zSlider);
    this.element.appendChild(zLabel);

    const tolLabel = document.createElement('label');
    tolLabel.textContent = ' Tolerance: ';
    this.tolSlider = document.createElement('input');
    this.tolSlider.type = 'range';
    this.tolSlider.min = '0.01';
    this.tolSlider.max = '1';
    this.tolSlider.step = '0.01';
    this.tolSlider.value = '0.1';
    this.tolSlider.oninput = () => {
      this.emit('toleranceChanged', parseFloat(this.tolSlider.value));
    };
    tolLabel.appendChild(this.tolSlider);
    this.element.appendChild(tolLabel);

    const visLabel = document.createElement('label');
    visLabel.textContent = ' Visible: ';
    this.visibleCheckbox = document.createElement('input');
    this.visibleCheckbox.type = 'checkbox';
    this.visibleCheckbox.onchange = () => {
      this.emit('visibleChanged', this.visibleCheckbox.checked);
    };
    visLabel.appendChild(this.visibleCheckbox);
    this.element.appendChild(visLabel);
  }

  setZRange(min: number, max: number): void {
    this.zSlider.min = String(min);
    this.zSlider.max = String(max);
  }
}
