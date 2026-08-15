/**
 * @file ComparisonPanel.ts
 * @brief Side panel for comparing two trajectories (overlay).
 */

import { EventDispatcher } from '../core/EventDispatcher';

export interface ComparisonEvents {
  loadComparison: string; // jobId
  toggleOverlay: boolean;
  differenceMode: boolean;
}

export class ComparisonPanel extends EventDispatcher<ComparisonEvents> {
  private element: HTMLElement;
  private visibleFlag = false;

  get visible(): boolean { return this.visibleFlag; }
  set visible(v: boolean) {
    this.visibleFlag = v;
    this.element.style.display = v ? '' : 'none';
  }

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'comparison-panel';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Comparison</h3>';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Job ID to compare';
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.onclick = () => {
      if (input.value.trim()) {
        this.emit('loadComparison', input.value.trim());
      }
    };
    this.element.appendChild(input);
    this.element.appendChild(loadBtn);

    const overlayLabel = document.createElement('label');
    overlayLabel.textContent = ' Overlay: ';
    const overlayCheckbox = document.createElement('input');
    overlayCheckbox.type = 'checkbox';
    overlayCheckbox.onchange = () => this.emit('toggleOverlay', overlayCheckbox.checked);
    overlayLabel.appendChild(overlayCheckbox);
    this.element.appendChild(overlayLabel);

    const diffLabel = document.createElement('label');
    diffLabel.textContent = ' Difference: ';
    const diffCheckbox = document.createElement('input');
    diffCheckbox.type = 'checkbox';
    diffCheckbox.onchange = () => this.emit('differenceMode', diffCheckbox.checked);
    diffLabel.appendChild(diffCheckbox);
    this.element.appendChild(diffLabel);
  }
}
