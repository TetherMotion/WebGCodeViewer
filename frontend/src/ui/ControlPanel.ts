/**
 * @file ControlPanel.ts
 * @brief Bottom control panel for file operations, view settings, status,
 * layer navigation, and time playback.
 */

import { EventDispatcher } from '../core/EventDispatcher';
import type { GetJobStatusResponse, GetZLayersResponse } from '../generated/tether_viewer_pb';

export interface ControlPanelEvents {
  uploadFile: File;
  colorAttributeChanged: string;
  colorMapChanged: string;
  toggleGrid: void;
  toggleCrossSection: void;
  crossSectionZChanged: number;  // 0..1 fraction of Z range
  resetView: void;
  exportImage: void;
  layerChanged: number;       // layer index, -1 = all layers
  timeChanged: number;        // 0..1 fraction of path
  playStateChanged: boolean;  // true = playing
  toggleMiniplot: void;
  miniplotAxisChanged: string;
  toggleTravels: void;        // Feature #1: show/hide travel moves
  lineWidthChanged: number;   // Feature #2: line width adjustment
}

export class ControlPanel extends EventDispatcher<ControlPanelEvents> {
  private element: HTMLElement;
  private statusEl: HTMLElement;
  private gridBtn: HTMLButtonElement;
  private crossBtn: HTMLButtonElement;
  private gridActive = false;
  private crossActive = false;
  private miniplotActive = false;

  // Cross-section Z slider
  private crossSectionGroup: HTMLElement;
  private crossSlider: HTMLInputElement;
  private crossLabel: HTMLElement;

  // Layer slider
  private layerGroup: HTMLElement;
  private layerSlider: HTMLInputElement;
  private layerLabel: HTMLElement;

  // Time slider
  private timeGroup: HTMLElement;
  private timeSlider: HTMLInputElement;
  private timeLabel: HTMLElement;
  private playBtn: HTMLButtonElement;
  private playing = false;

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
    for (const attr of ['velocity', 'acceleration', 'jerk', 'curvature', 'deviation', 'zHeight', 'extruderSpeed', 'motion', 'solid']) {
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

    // Feature #2: Line width slider
    const widthLabel = document.createElement('label');
    widthLabel.textContent = 'Width:';
    const widthSlider = document.createElement('input');
    widthSlider.type = 'range';
    widthSlider.min = '1';
    widthSlider.max = '8';
    widthSlider.value = '2';
    widthSlider.step = '0.5';
    widthSlider.className = 'width-slider';
    widthSlider.style.width = '60px';
    const widthValue = document.createElement('span');
    widthValue.className = 'slider-value';
    widthValue.textContent = '2';
    widthSlider.oninput = () => {
      widthValue.textContent = widthSlider.value;
      this.emit('lineWidthChanged', parseFloat(widthSlider.value));
    };
    widthLabel.appendChild(widthSlider);
    widthLabel.appendChild(widthValue);
    colorGroup.appendChild(widthLabel);

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
      this.crossSectionGroup.style.display = this.crossActive ? 'flex' : 'none';
      this.emit('toggleCrossSection', undefined);
    };
    viewGroup.appendChild(this.crossBtn);

    // Cross-section Z-plane slider (hidden until cross-section is activated)
    this.crossSectionGroup = document.createElement('div');
    this.crossSectionGroup.className = 'control-group cross-section-group';
    this.crossSectionGroup.style.display = 'none';

    const crossTitle = document.createElement('div');
    crossTitle.className = 'slider-label';
    crossTitle.textContent = 'Z-Plane:';
    this.crossSectionGroup.appendChild(crossTitle);

    this.crossSlider = document.createElement('input');
    this.crossSlider.type = 'range';
    this.crossSlider.min = '0';
    this.crossSlider.max = '100';
    this.crossSlider.value = '50';
    this.crossSlider.step = '0.1';
    this.crossSlider.className = 'cross-slider';
    this.crossSlider.oninput = () => {
      const frac = parseFloat(this.crossSlider.value) / 100;
      this.crossLabel.textContent = this.crossSlider.value + '%';
      this.emit('crossSectionZChanged', frac);
    };
    this.crossSectionGroup.appendChild(this.crossSlider);

    this.crossLabel = document.createElement('span');
    this.crossLabel.className = 'slider-value';
    this.crossLabel.textContent = '50%';
    this.crossSectionGroup.appendChild(this.crossLabel);
    this.element.appendChild(this.crossSectionGroup);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset View';
    resetBtn.onclick = () => this.emit('resetView', undefined);
    viewGroup.appendChild(resetBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export';
    exportBtn.onclick = () => this.emit('exportImage', undefined);
    viewGroup.appendChild(exportBtn);

    // Feature #1: Travel moves toggle
    const travelsBtn = document.createElement('button');
    travelsBtn.textContent = 'Travels';
    travelsBtn.className = 'active';
    travelsBtn.onclick = () => {
      travelsBtn.classList.toggle('active');
      this.emit('toggleTravels', undefined);
    };
    viewGroup.appendChild(travelsBtn);

    this.element.appendChild(viewGroup);

    // Miniplot group
    const miniplotGroup = document.createElement('div');
    miniplotGroup.className = 'control-group miniplot-group';

    const miniplotBtn = document.createElement('button');
    miniplotBtn.textContent = 'Miniplot';
    miniplotBtn.onclick = () => {
      this.miniplotActive = !this.miniplotActive;
      miniplotBtn.classList.toggle('active', this.miniplotActive);
      this.emit('toggleMiniplot', undefined);
    };
    miniplotGroup.appendChild(miniplotBtn);

    const miniplotAxisLabel = document.createElement('label');
    miniplotAxisLabel.textContent = 'Axis:';
    const miniplotAxisSelect = document.createElement('select');
    for (const ax of ['Extruder', 'X', 'Y', 'Z', 'Linear']) {
      const opt = document.createElement('option');
      opt.value = ax;
      opt.textContent = ax;
      miniplotAxisSelect.appendChild(opt);
    }
    miniplotAxisSelect.value = 'Extruder';
    miniplotAxisSelect.onchange = () => this.emit('miniplotAxisChanged', miniplotAxisSelect.value);
    miniplotAxisLabel.appendChild(miniplotAxisSelect);
    miniplotGroup.appendChild(miniplotAxisLabel);
    this.element.appendChild(miniplotGroup);

    // Layer slider group
    this.layerGroup = document.createElement('div');
    this.layerGroup.className = 'control-group layer-group';
    this.layerGroup.style.display = 'none'; // hidden until layers are loaded

    const layerTitle = document.createElement('span');
    layerTitle.className = 'slider-label';
    layerTitle.textContent = 'Layer:';
    this.layerGroup.appendChild(layerTitle);

    this.layerSlider = document.createElement('input');
    this.layerSlider.type = 'range';
    this.layerSlider.min = '0';
    this.layerSlider.max = '0';
    this.layerSlider.value = '0';
    this.layerSlider.className = 'layer-slider';
    this.layerSlider.oninput = () => {
      const val = parseInt(this.layerSlider.value, 10);
      this.layerLabel.textContent = val < 0 ? 'All' : `${val}`;
      this.emit('layerChanged', val);
    };
    this.layerGroup.appendChild(this.layerSlider);

    this.layerLabel = document.createElement('span');
    this.layerLabel.className = 'slider-value';
    this.layerLabel.textContent = 'All';
    this.layerGroup.appendChild(this.layerLabel);

    // "All layers" button
    const allLayersBtn = document.createElement('button');
    allLayersBtn.textContent = 'All';
    allLayersBtn.className = 'small-btn';
    allLayersBtn.onclick = () => {
      this.layerSlider.value = '-1';
      this.layerLabel.textContent = 'All';
      this.emit('layerChanged', -1);
    };
    this.layerGroup.appendChild(allLayersBtn);

    this.element.appendChild(this.layerGroup);

    // Time slider group
    this.timeGroup = document.createElement('div');
    this.timeGroup.className = 'control-group time-group';
    this.timeGroup.style.display = 'none'; // hidden until data is loaded

    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '▶';
    this.playBtn.className = 'play-btn';
    this.playBtn.onclick = () => {
      this.playing = !this.playing;
      this.playBtn.textContent = this.playing ? '⏸' : '▶';
      this.emit('playStateChanged', this.playing);
    };
    this.timeGroup.appendChild(this.playBtn);

    const timeTitle = document.createElement('span');
    timeTitle.className = 'slider-label';
    timeTitle.textContent = 'Time:';
    this.timeGroup.appendChild(timeTitle);

    this.timeSlider = document.createElement('input');
    this.timeSlider.type = 'range';
    this.timeSlider.min = '0';
    this.timeSlider.max = '1000';
    this.timeSlider.value = '1000';
    this.timeSlider.className = 'time-slider';
    this.timeSlider.oninput = () => {
      const frac = parseInt(this.timeSlider.value, 10) / 1000;
      this.timeLabel.textContent = `${(frac * 100).toFixed(1)}%`;
      this.emit('timeChanged', frac);
    };
    this.timeGroup.appendChild(this.timeSlider);

    this.timeLabel = document.createElement('span');
    this.timeLabel.className = 'slider-value';
    this.timeLabel.textContent = '100%';
    this.timeGroup.appendChild(this.timeLabel);

    this.element.appendChild(this.timeGroup);

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
        // Show time slider when data is ready
        this.timeGroup.style.display = 'flex';
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

  /**
   * Set the layer slider value programmatically.
   */
  setLayerValue(layerIdx: number): void {
    this.layerSlider.value = String(layerIdx);
    this.layerLabel.textContent = layerIdx < 0 ? 'All' : `${layerIdx}`;
    this.emit('layerChanged', layerIdx);
  }

  /**
   * Update the layer slider with Z-layer data from the server.
   */
  updateLayers(layers: GetZLayersResponse): void {
    if (layers.totalLayers <= 0) {
      this.layerGroup.style.display = 'none';
      return;
    }
    this.layerGroup.style.display = 'flex';
    this.layerSlider.min = '0';
    this.layerSlider.max = String(layers.totalLayers - 1);
    this.layerSlider.value = String(layers.totalLayers - 1);
    this.layerLabel.textContent = 'All';
  }

  /**
   * Update the layer slider with Z-layer data from HTTP endpoint.
   */
  updateLayersFromHttp(layers: {
    layers: { layerIndex: number; zHeight: number; pieceStart: number; pieceEnd: number; pieceCount: number }[];
    totalLayers: number;
  }): void {
    if (layers.totalLayers <= 0) {
      this.layerGroup.style.display = 'none';
      return;
    }
    this.layerGroup.style.display = 'flex';
    this.layerSlider.min = '0';
    this.layerSlider.max = String(layers.totalLayers - 1);
    this.layerSlider.value = String(layers.totalLayers - 1);
    this.layerLabel.textContent = 'All';
  }

  /**
   * Set the time slider position (0..1). Called by the playback animation.
   */
  setTimePosition(frac: number): void {
    this.timeSlider.value = String(Math.round(frac * 1000));
    this.timeLabel.textContent = `${(frac * 100).toFixed(1)}%`;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playBtn.textContent = playing ? '⏸' : '▶';
  }
}
