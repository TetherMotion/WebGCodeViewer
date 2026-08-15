/**
 * @file ControlPanel.ts
 * @brief Bottom control panel for file operations, view settings, and status.
 *
 * Replaces the old Toolbar. Contains:
 * - Open G-code button
 * - Color attribute & color map selectors
 * - Grid / Cross-section / Reset view / Export buttons
 * - Job status display
 */

import { EventDispatcher } from '../core/EventDispatcher';
import type { GetJobStatusResponse } from '../generated/tether_viewer_pb';

export interface ControlPanelEvents {
  uploadFile: File;
  colorAttributeChanged: string;
  colorMapChanged: string;
  toggleGrid: void;
  toggleCrossSection: void;
  resetView: void;
  exportImage: void;
}

export class ControlPanel extends EventDispatcher<ControlPanelEvents> {
  private element: HTMLElement;
  private statusEl: HTMLElement;
  private gridBtn: HTMLButtonElement;
  private crossBtn: HTMLButtonElement;
  private gridActive = false;
  private crossActive = false;

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'control-panel';
    this.element.style.display = 'flex';
    this.element.style.width = '100%';
    this.element.style.alignItems = 'center';
    this.element.style.gap = '12px';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    // File group
    const fileGroup = document.createElement('div');
    fileGroup.className = 'control-group';

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open G-code';
    openBtn.onclick = () => {
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
    fileGroup.appendChild(openBtn);
    this.element.appendChild(fileGroup);

    // Color group
    const colorGroup = document.createElement('div');
    colorGroup.className = 'control-group';

    const attrLabel = document.createElement('label');
    attrLabel.textContent = 'Color:';
    const attrSelect = document.createElement('select');
    for (const attr of ['velocity', 'acceleration', 'jerk', 'curvature', 'motion', 'solid']) {
      const opt = document.createElement('option');
      opt.value = attr;
      opt.textContent = attr;
      attrSelect.appendChild(opt);
    }
    attrSelect.onchange = () => this.emit('colorAttributeChanged', attrSelect.value);
    attrLabel.appendChild(attrSelect);
    colorGroup.appendChild(attrLabel);

    const mapLabel = document.createElement('label');
    mapLabel.textContent = 'Map:';
    const mapSelect = document.createElement('select');
    for (const map of ['viridis', 'plasma', 'jet', 'turbo', 'grayscale', 'rainbow']) {
      const opt = document.createElement('option');
      opt.value = map;
      opt.textContent = map;
      mapSelect.appendChild(opt);
    }
    mapSelect.onchange = () => this.emit('colorMapChanged', mapSelect.value);
    mapLabel.appendChild(mapSelect);
    colorGroup.appendChild(mapLabel);
    this.element.appendChild(colorGroup);

    // View group
    const viewGroup = document.createElement('div');
    viewGroup.className = 'control-group';

    this.gridBtn = document.createElement('button');
    this.gridBtn.textContent = 'Grid';
    this.gridBtn.onclick = () => {
      this.gridActive = !this.gridActive;
      this.gridBtn.classList.toggle('active', this.gridActive);
      this.emit('toggleGrid', undefined);
    };
    viewGroup.appendChild(this.gridBtn);

    this.crossBtn = document.createElement('button');
    this.crossBtn.textContent = 'Cross-Section';
    this.crossBtn.onclick = () => {
      this.crossActive = !this.crossActive;
      this.crossBtn.classList.toggle('active', this.crossActive);
      this.emit('toggleCrossSection', undefined);
    };
    viewGroup.appendChild(this.crossBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset View';
    resetBtn.onclick = () => this.emit('resetView', undefined);
    viewGroup.appendChild(resetBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export';
    exportBtn.onclick = () => this.emit('exportImage', undefined);
    viewGroup.appendChild(exportBtn);
    this.element.appendChild(viewGroup);

    // Status group (right-aligned)
    const statusGroup = document.createElement('div');
    statusGroup.className = 'control-group status';

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'status-text';
    this.statusEl.textContent = 'Ready';
    statusGroup.appendChild(this.statusEl);
    this.element.appendChild(statusGroup);
  }

  updateJobStatus(status: GetJobStatusResponse): void {
    const pct = Math.round(status.progress * 100);
    switch (status.state) {
      case 'processing':
        this.statusEl.textContent = `Processing: ${pct}% (${status.sampleCount} samples)`;
        break;
      case 'ready':
        this.statusEl.textContent = `Ready: ${status.sampleCount} samples, ${status.duration.toFixed(2)}s, ${status.pathLength.toFixed(1)}mm`;
        break;
      case 'failed':
        this.statusEl.textContent = `Failed: ${status.errorMessage || 'unknown error'}`;
        break;
      default:
        this.statusEl.textContent = status.state;
    }
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}
