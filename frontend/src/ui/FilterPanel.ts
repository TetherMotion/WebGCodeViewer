/**
 * @file FilterPanel.ts
 * @brief Side panel for filtering trajectory data by time, segment, and attributes.
 */

import { EventDispatcher } from "@tether/viewer-core";

export interface FilterEvents {
  timeRangeChanged: { start: number; end: number };
  segmentRangeChanged: { start: number; end: number };
  velocityThresholdChanged: number;
  accelerationThresholdChanged: number;
}

export class FilterPanel extends EventDispatcher<FilterEvents> {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'filter-panel';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    this.element.innerHTML = '<h3>Filters</h3>';

    // Time range
    const timeDiv = document.createElement('div');
    timeDiv.innerHTML = '<label>Time Range:</label>';
    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.placeholder = 'Start';
    startInput.step = '0.001';
    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.placeholder = 'End';
    endInput.step = '0.001';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
      this.emit('timeRangeChanged', {
        start: parseFloat(startInput.value) || 0,
        end: parseFloat(endInput.value) || 0,
      });
    };
    timeDiv.appendChild(startInput);
    timeDiv.appendChild(endInput);
    timeDiv.appendChild(applyBtn);
    this.element.appendChild(timeDiv);

    // Segment range
    const segDiv = document.createElement('div');
    segDiv.innerHTML = '<label>Segment Range:</label>';
    const segStart = document.createElement('input');
    segStart.type = 'number';
    segStart.placeholder = 'Start';
    const segEnd = document.createElement('input');
    segEnd.type = 'number';
    segEnd.placeholder = 'End';
    const segBtn = document.createElement('button');
    segBtn.textContent = 'Apply';
    segBtn.onclick = () => {
      this.emit('segmentRangeChanged', {
        start: parseInt(segStart.value) || 0,
        end: parseInt(segEnd.value) || 0,
      });
    };
    segDiv.appendChild(segStart);
    segDiv.appendChild(segEnd);
    segDiv.appendChild(segBtn);
    this.element.appendChild(segDiv);
  }
}
