/**
 * @file Toolbar.ts
 * @brief Top toolbar UI panel for the viewer.
 */

import { EventDispatcher } from '../core/EventDispatcher';

export interface ToolbarEvents {
  uploadFile: File;
  colorAttributeChanged: string;
  colorMapChanged: string;
  toggleGrid: boolean;
  toggleCrossSection: boolean;
  resetView: void;
  exportImage: void;
}

export class Toolbar extends EventDispatcher<ToolbarEvents> {
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'toolbar';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    // Upload button
    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = 'Upload G-code';
    uploadBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gcode,.g,.nc,.ngc';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          this.emit('uploadFile', input.files[0]);
        }
      };
      input.click();
    };
    this.element.appendChild(uploadBtn);

    // Color attribute selector
    const attrLabel = document.createElement('label');
    attrLabel.textContent = 'Color: ';
    const attrSelect = document.createElement('select');
    for (const attr of ['velocity', 'acceleration', 'jerk', 'curvature', 'motion', 'solid']) {
      const opt = document.createElement('option');
      opt.value = attr;
      opt.textContent = attr;
      attrSelect.appendChild(opt);
    }
    attrSelect.onchange = () => this.emit('colorAttributeChanged', attrSelect.value);
    attrLabel.appendChild(attrSelect);
    this.element.appendChild(attrLabel);

    // Color map selector
    const mapLabel = document.createElement('label');
    mapLabel.textContent = ' Map: ';
    const mapSelect = document.createElement('select');
    for (const map of ['viridis', 'plasma', 'jet', 'turbo', 'grayscale', 'rainbow']) {
      const opt = document.createElement('option');
      opt.value = map;
      opt.textContent = map;
      mapSelect.appendChild(opt);
    }
    mapSelect.onchange = () => this.emit('colorMapChanged', mapSelect.value);
    mapLabel.appendChild(mapSelect);
    this.element.appendChild(mapLabel);

    // Toggle grid
    const gridBtn = document.createElement('button');
    gridBtn.textContent = 'Grid';
    gridBtn.onclick = () => this.emit('toggleGrid', true);
    this.element.appendChild(gridBtn);

    // Toggle cross-section
    const crossBtn = document.createElement('button');
    crossBtn.textContent = 'Cross-Section';
    crossBtn.onclick = () => this.emit('toggleCrossSection', true);
    this.element.appendChild(crossBtn);

    // Reset view
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset View';
    resetBtn.onclick = () => this.emit('resetView', undefined);
    this.element.appendChild(resetBtn);

    // Export image
    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export';
    exportBtn.onclick = () => this.emit('exportImage', undefined);
    this.element.appendChild(exportBtn);
  }
}
