/**
 * @file ControlPanel.ts
 * @brief Top menu bar with thematic dropdown menus for file operations,
 * view settings, analysis, playback, and status.
 */

import { EventDispatcher } from "@tether/viewer-core";
import type { GetJobStatusResponse, GetZLayersResponse } from "@tether/viewer-core/generated";

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
  toggleAutoLayerFilter: boolean;  // auto-filter toolpath to current Z layer during playback
  timeChanged: number;        // 0..1 fraction of path
  playStateChanged: boolean;  // true = playing
  toggleMiniplot: void;
  miniplotAxisChanged: string;
  toggleTravels: void;        // Feature #1: show/hide travel moves
  lineWidthChanged: number;   // Feature #2: line width adjustment
  toggleRetractions: void;    // Feature #3: highlight retraction moves
  toggleTheme: void;          // Feature #66: dark/light theme toggle
  toggleFullscreen: void;     // Feature #73: fullscreen mode
  toggleStats: void;          // Feature #120: render statistics
  toggleBoundingBox: void;    // Feature #48: bounding box dimensions
  copyViewUrl: void;          // Feature #92: copy current view URL
  toggleLayerCount: void;     // Feature #128: layer count display
  toggleVolumetricSegments: boolean;  // volumetric (thick) segment rendering
  // Printer simulation controls
  printerModeChanged: 'realtime' | 'simulation';
  printerSpeedChanged: number;   // speed multiplier (0.5, 1, 2, 5, 10)
  printerDirectionChanged: 'forward' | 'backward';
  returnToRealtime: void;     // button to return to realtime view
  // Analysis features
  toggleInfoPanel: void;      // toggle the analysis info panel
  toggleComparison: void;     // toggle the comparison panel
  exportReport: void;         // export analysis report as JSON
  toolFilterChanged: number;  // tool number to filter by, -1 = all tools
  toggleDiff: void;           // toggle G-code diff panel
  toggleOverhang: void;       // toggle overhang highlighting
  toggleZSeam: void;          // toggle Z-seam visualization
  toggleProbeMarkers: void;   // toggle probe point markers
  toggleDrillMarkers: void;   // toggle drilling cycle markers
  toggleHackPanel: void;      // toggle G-code hack/transform panel
  toggleBridges: void;        // toggle bridge highlighting
  toggleSupport: void;        // toggle support structure highlighting
}

export class ControlPanel extends EventDispatcher<ControlPanelEvents> {
  private element: HTMLElement;
  private statusEl: HTMLElement;
  private gridBtn: HTMLButtonElement;
  private crossBtn: HTMLButtonElement;
  private gridActive = false;
  private crossActive = false;
  private miniplotActive = false;
  private volSegmentsActive = true;

  // Cross-section Z slider
  private crossSectionGroup: HTMLElement;
  private crossSlider: HTMLInputElement;
  private crossLabel: HTMLElement;

  // Layer slider
  private layerGroup: HTMLElement;
  private layerSlider: HTMLInputElement;
  private layerLabel: HTMLElement;

  // Tool filter (CNC)
  private toolGroup: HTMLElement;
  private toolSelect: HTMLSelectElement;

  // Time slider
  private timeGroup: HTMLElement;
  private timeSlider: HTMLInputElement;
  private timeLabel: HTMLElement;
  private playBtn: HTMLButtonElement;
  private playing = false;

  // Printer simulation controls
  private printerGroup: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private directionBtn: HTMLButtonElement;
  private realtimeBtn: HTMLButtonElement;
  private printerMode: 'realtime' | 'simulation' = 'realtime';
  private printerSpeed: number = 1;
  private printerDirection: 'forward' | 'backward' = 'forward';
  private readonly speedSteps: number[] = [0.5, 1, 2, 5, 10];

  constructor(container: HTMLElement) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'control-panel top-menu-bar';
    container.appendChild(this.element);
    this.build();
  }

  private build(): void {
    // ── Helper: create a dropdown menu group ──
    const openMenus: HTMLElement[] = [];
    const createMenu = (label: string): { trigger: HTMLButtonElement; dropdown: HTMLElement } => {
      const group = document.createElement('div');
      group.className = 'menu-group';

      const trigger = document.createElement('button');
      trigger.className = 'menu-trigger';
      trigger.innerHTML = `${label} <span class="chevron">▾</span>`;

      const dropdown = document.createElement('div');
      dropdown.className = 'menu-dropdown';

      trigger.onclick = (e) => {
        e.stopPropagation();
        const wasOpen = dropdown.classList.contains('open');
        // Close all other menus
        for (const m of openMenus) m.classList.remove('open');
        if (!wasOpen) {
          dropdown.classList.add('open');
        }
      };

      group.appendChild(trigger);
      group.appendChild(dropdown);
      this.element.appendChild(group);
      openMenus.push(dropdown);
      return { trigger, dropdown };
    };

    // Helper to add a toggle button to a dropdown
    const addToggle = (dropdown: HTMLElement, label: string, active: boolean, handler: () => void, title?: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (title) btn.title = title;
      if (active) btn.classList.add('active');
      btn.onclick = (e) => {
        e.stopPropagation();
        btn.classList.toggle('active');
        handler();
      };
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.appendChild(btn);
      dropdown.appendChild(row);
      return btn;
    };

    // Helper to add a non-toggle button to a dropdown
    const addButton = (dropdown: HTMLElement, label: string, handler: () => void, title?: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (title) btn.title = title;
      btn.onclick = (e) => {
        e.stopPropagation();
        handler();
      };
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.appendChild(btn);
      dropdown.appendChild(row);
      return btn;
    };

    // Helper to add a labeled control row to a dropdown
    const addRow = (dropdown: HTMLElement, ...elements: HTMLElement[]): void => {
      const row = document.createElement('div');
      row.className = 'menu-row';
      for (const el of elements) row.appendChild(el);
      dropdown.appendChild(row);
    };

    // Helper to add a section label
    const addSection = (dropdown: HTMLElement, label: string): void => {
      const sec = document.createElement('div');
      sec.className = 'menu-section-label';
      sec.textContent = label;
      dropdown.appendChild(sec);
    };

    // Helper to add a divider
    const addDivider = (dropdown: HTMLElement): void => {
      const div = document.createElement('div');
      div.className = 'menu-divider';
      dropdown.appendChild(div);
    };

    // Close menus on outside click
    document.addEventListener('click', () => {
      for (const m of openMenus) m.classList.remove('open');
    });

    // ── File menu ──
    const fileMenu = createMenu('File');
    const fileDropdown = fileMenu.dropdown;

    addButton(fileDropdown, 'Open…', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gcode,.g,.nc,.ngc';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          this.emit('uploadFile', input.files[0]);
        }
      };
      input.click();
    }, 'Open a G-code file');

    addDivider(fileDropdown);
    addButton(fileDropdown, 'Export Image', () => this.emit('exportImage', undefined), 'Export current view as PNG');
    addButton(fileDropdown, 'Copy View URL', () => this.emit('copyViewUrl', undefined), 'Copy current view URL to clipboard');

    // ── Color menu ──
    const colorMenu = createMenu('Color');
    const colorDropdown = colorMenu.dropdown;

    addSection(colorDropdown, 'Attribute');
    const attrLabel = document.createElement('label');
    attrLabel.textContent = 'Color: ';
    const attrSelect = document.createElement('select');
    for (const attr of ['velocity', 'acceleration', 'jerk', 'pressureAdvanceOffset', 'pressureAdvanceVelocity', 'curvature', 'deviation', 'zHeight', 'extruderSpeed', 'motion', 'solid', 'feedRate', 'spindleRpm', 'toolNumber', 'coolant', 'featureType']) {
      const opt = document.createElement('option');
      opt.value = attr;
      opt.textContent = attr;
      attrSelect.appendChild(opt);
    }
    attrSelect.onchange = () => this.emit('colorAttributeChanged', attrSelect.value);
    attrLabel.appendChild(attrSelect);
    addRow(colorDropdown, attrLabel);

    addDivider(colorDropdown);
    addSection(colorDropdown, 'Color Map');
    const mapLabel = document.createElement('label');
    mapLabel.textContent = 'Map: ';
    const mapSelect = document.createElement('select');
    for (const map of ['viridis', 'plasma', 'jet', 'turbo', 'grayscale', 'rainbow', 'cividis', 'coolwarm']) {
      const opt = document.createElement('option');
      opt.value = map;
      opt.textContent = map;
      mapSelect.appendChild(opt);
    }
    mapSelect.onchange = () => this.emit('colorMapChanged', mapSelect.value);
    mapLabel.appendChild(mapSelect);
    addRow(colorDropdown, mapLabel);

    // ── View menu ──
    const viewMenu = createMenu('View');
    const viewDropdown = viewMenu.dropdown;

    this.gridBtn = addToggle(viewDropdown, 'Grid', false, () => this.emit('toggleGrid', undefined), 'Toggle ground grid');
    this.gridActive = false;
    // Override onclick to track state
    this.gridBtn.onclick = (e) => {
      e.stopPropagation();
      this.gridActive = !this.gridActive;
      this.gridBtn.classList.toggle('active', this.gridActive);
      this.emit('toggleGrid', undefined);
    };

    this.crossBtn = addToggle(viewDropdown, 'Cross-Section', false, () => {}, 'Toggle cross-section plane');
    this.crossActive = false;
    this.crossBtn.onclick = (e) => {
      e.stopPropagation();
      this.crossActive = !this.crossActive;
      this.crossBtn.classList.toggle('active', this.crossActive);
      this.crossSectionGroup.style.display = this.crossActive ? 'flex' : 'none';
      this.emit('toggleCrossSection', undefined);
    };

    addButton(viewDropdown, 'Reset View', () => this.emit('resetView', undefined), 'Reset camera to default position');

    addDivider(viewDropdown);
    addSection(viewDropdown, 'Display');

    const travelsBtn = addToggle(viewDropdown, 'Travels', true, () => this.emit('toggleTravels', undefined), 'Show/hide travel moves');
    const retractionBtn = addToggle(viewDropdown, 'Retractions', false, () => this.emit('toggleRetractions', undefined), 'Highlight retraction moves');
    const bboxBtn = addToggle(viewDropdown, 'BBox', false, () => this.emit('toggleBoundingBox', undefined), 'Show bounding box dimensions');
    const layerCountBtn = addToggle(viewDropdown, 'Layer Count', false, () => this.emit('toggleLayerCount', undefined), 'Show layer count display');
    const fullscreenBtn = addButton(viewDropdown, 'Fullscreen', () => this.emit('toggleFullscreen', undefined), 'Toggle fullscreen mode');

    addDivider(viewDropdown);
    addSection(viewDropdown, 'Rendering');

    // Volumetric segments toggle (default enabled)
    const volBtn = addToggle(viewDropdown, 'Volumetric Segments', true, () => {}, 'Render segments as thick camera-facing quads');
    this.volSegmentsActive = true;
    volBtn.classList.toggle('active', this.volSegmentsActive);
    volBtn.onclick = (e) => {
      e.stopPropagation();
      this.volSegmentsActive = !this.volSegmentsActive;
      volBtn.classList.toggle('active', this.volSegmentsActive);
      this.emit('toggleVolumetricSegments', this.volSegmentsActive);
    };

    addDivider(viewDropdown);
    addSection(viewDropdown, 'Line Width');

    // Line width slider inside the view dropdown
    const widthSlider = document.createElement('input');
    widthSlider.type = 'range';
    widthSlider.min = '1';
    widthSlider.max = '8';
    widthSlider.value = '2';
    widthSlider.step = '0.5';
    widthSlider.className = 'width-slider';
    widthSlider.style.width = '80px';
    const widthValue = document.createElement('span');
    widthValue.className = 'slider-value';
    widthValue.textContent = '2';
    widthSlider.oninput = () => {
      widthValue.textContent = widthSlider.value;
      this.emit('lineWidthChanged', parseFloat(widthSlider.value));
    };
    addRow(viewDropdown, widthSlider, widthValue);

    // Cross-section Z-plane slider (hidden until cross-section is activated)
    addDivider(viewDropdown);
    addSection(viewDropdown, 'Cross-Section Z-Plane');
    this.crossSectionGroup = document.createElement('div');
    this.crossSectionGroup.className = 'menu-row cross-section-group';
    this.crossSectionGroup.style.display = 'none';

    this.crossSlider = document.createElement('input');
    this.crossSlider.type = 'range';
    this.crossSlider.min = '0';
    this.crossSlider.max = '100';
    this.crossSlider.value = '50';
    this.crossSlider.step = '0.1';
    this.crossSlider.className = 'cross-slider';
    this.crossSlider.style.flex = '1';
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
    viewDropdown.appendChild(this.crossSectionGroup);

    // ── Analysis menu ──
    const analysisMenu = createMenu('Analysis');
    const analysisDropdown = analysisMenu.dropdown;

    addSection(analysisDropdown, 'Reports');
    const infoBtn = addToggle(analysisDropdown, 'Info Panel', false, () => this.emit('toggleInfoPanel', undefined), 'Toggle analysis info panel');
    addButton(analysisDropdown, 'Export Report', () => this.emit('exportReport', undefined), 'Export analysis report as JSON');

    addDivider(analysisDropdown);
    addSection(analysisDropdown, 'Compare');
    const compareBtn = addToggle(analysisDropdown, 'Compare', false, () => this.emit('toggleComparison', undefined), 'Toggle comparison panel');
    const diffBtn = addToggle(analysisDropdown, 'G-code Diff', false, () => this.emit('toggleDiff', undefined), 'Compare two G-code files');

    addDivider(analysisDropdown);
    addSection(analysisDropdown, '3DP Features');
    const overhangBtn = addToggle(analysisDropdown, 'Overhang', false, () => this.emit('toggleOverhang', undefined), 'Highlight overhang regions');
    const seamBtn = addToggle(analysisDropdown, 'Z-Seam', false, () => this.emit('toggleZSeam', undefined), 'Visualize Z-seam positions');
    const bridgeBtn = addToggle(analysisDropdown, 'Bridges', false, () => this.emit('toggleBridges', undefined), 'Highlight bridge regions');
    const supportBtn = addToggle(analysisDropdown, 'Support', false, () => this.emit('toggleSupport', undefined), 'Highlight support structure');

    addDivider(analysisDropdown);
    addSection(analysisDropdown, 'CNC Features');
    const probeBtn = addToggle(analysisDropdown, 'Probe Markers', false, () => this.emit('toggleProbeMarkers', undefined), 'Show probe point markers');
    const drillBtn = addToggle(analysisDropdown, 'Drill Markers', false, () => this.emit('toggleDrillMarkers', undefined), 'Show drilling cycle positions');

    addDivider(analysisDropdown);
    addSection(analysisDropdown, 'Tools');
    const hackBtn = addToggle(analysisDropdown, 'G-code Hack', false, () => this.emit('toggleHackPanel', undefined), 'Transform G-code (translate, rotate, mirror, scale)');

    // ── Plot menu ──
    const plotMenu = createMenu('Plot');
    const plotDropdown = plotMenu.dropdown;

    const miniplotBtn = addToggle(plotDropdown, 'Miniplot', true, () => {
      this.miniplotActive = !this.miniplotActive;
      miniplotBtn.classList.toggle('active', this.miniplotActive);
      this.emit('toggleMiniplot', undefined);
    }, 'Toggle per-segment miniplot');
    // Override to track state properly — miniplot is visible by default
    this.miniplotActive = true;
    miniplotBtn.classList.add('active');
    miniplotBtn.onclick = (e) => {
      e.stopPropagation();
      this.miniplotActive = !this.miniplotActive;
      miniplotBtn.classList.toggle('active', this.miniplotActive);
      this.emit('toggleMiniplot', undefined);
    };

    addSection(plotDropdown, 'Miniplot Quantity');
    const miniplotAxisLabel = document.createElement('label');
    miniplotAxisLabel.textContent = 'Quantity: ';
    const miniplotAxisSelect = document.createElement('select');
    for (const q of ['Velocity', 'Acceleration', 'Jerk', 'PA Offset', 'Extruder Velocity']) {
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = q;
      miniplotAxisSelect.appendChild(opt);
    }
    miniplotAxisSelect.value = 'Velocity';
    miniplotAxisSelect.onchange = () => this.emit('miniplotAxisChanged', miniplotAxisSelect.value);
    miniplotAxisLabel.appendChild(miniplotAxisSelect);
    addRow(plotDropdown, miniplotAxisLabel);

    // ── Playback menu ──
    const playbackMenu = createMenu('Playback');
    const playbackDropdown = playbackMenu.dropdown;

    addSection(playbackDropdown, 'Time');
    this.timeGroup = document.createElement('div');
    this.timeGroup.className = 'menu-row time-group';
    this.timeGroup.style.display = 'none';

    this.playBtn = document.createElement('button');
    this.playBtn.textContent = '▶';
    this.playBtn.className = 'play-btn';
    this.playBtn.onclick = () => {
      this.playing = !this.playing;
      this.playBtn.textContent = this.playing ? '⏸' : '▶';
      this.emit('playStateChanged', this.playing);
    };
    this.timeGroup.appendChild(this.playBtn);

    this.timeSlider = document.createElement('input');
    this.timeSlider.type = 'range';
    this.timeSlider.min = '0';
    this.timeSlider.max = '1000';
    this.timeSlider.value = '1000';
    this.timeSlider.className = 'time-slider';
    this.timeSlider.style.flex = '1';
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
    playbackDropdown.appendChild(this.timeGroup);

    // Layer slider (hidden until layers are loaded)
    addDivider(playbackDropdown);
    addSection(playbackDropdown, 'Layer');
    this.layerGroup = document.createElement('div');
    this.layerGroup.className = 'menu-row layer-group';
    this.layerGroup.style.display = 'none';

    this.layerSlider = document.createElement('input');
    this.layerSlider.type = 'range';
    this.layerSlider.min = '0';
    this.layerSlider.max = '0';
    this.layerSlider.value = '0';
    this.layerSlider.className = 'layer-slider';
    this.layerSlider.style.flex = '1';
    this.layerSlider.oninput = () => {
      const val = parseInt(this.layerSlider.value, 10);
      this.layerSlider.style.opacity = '1';
      this.layerLabel.textContent = `${val}`;
      this.emit('layerChanged', val);
    };
    this.layerGroup.appendChild(this.layerSlider);

    this.layerLabel = document.createElement('span');
    this.layerLabel.className = 'slider-value';
    this.layerLabel.textContent = 'All';
    this.layerGroup.appendChild(this.layerLabel);

    const allLayersBtn = document.createElement('button');
    allLayersBtn.textContent = 'All';
    allLayersBtn.className = 'small-btn';
    allLayersBtn.onclick = () => {
      this.layerSlider.removeAttribute('data-selected');
      this.layerSlider.style.opacity = '0.5';
      this.layerLabel.textContent = 'All';
      this.emit('layerChanged', -1);
    };
    this.layerGroup.appendChild(allLayersBtn);
    playbackDropdown.appendChild(this.layerGroup);

    // Checkbox: "Show only current Z layer" — when checked, the toolpath is
    // auto-filtered to the current Z layer as the print head moves during
    // realtime playback. Default off so the full toolpath stays visible.
    const autoLayerRow = document.createElement('div');
    autoLayerRow.className = 'menu-row auto-layer-filter-row';
    const autoLayerCheckbox = document.createElement('input');
    autoLayerCheckbox.type = 'checkbox';
    autoLayerCheckbox.id = 'auto-layer-filter';
    autoLayerCheckbox.checked = false;
    autoLayerCheckbox.title = 'When enabled, automatically filter the toolpath to the current Z layer as the print head moves';
    const autoLayerLabel = document.createElement('label');
    autoLayerLabel.htmlFor = 'auto-layer-filter';
    autoLayerLabel.textContent = 'Show only current Z layer';
    autoLayerLabel.style.cursor = 'pointer';
    // Stop propagation on click so the document-level outside-click handler
    // doesn't close the dropdown when interacting with the checkbox/label.
    autoLayerCheckbox.onclick = (e) => e.stopPropagation();
    autoLayerLabel.onclick = (e) => e.stopPropagation();
    autoLayerCheckbox.onchange = () => {
      this.emit('toggleAutoLayerFilter', autoLayerCheckbox.checked);
    };
    autoLayerRow.appendChild(autoLayerCheckbox);
    autoLayerRow.appendChild(autoLayerLabel);
    playbackDropdown.appendChild(autoLayerRow);

    // Tool filter (hidden until tools are detected)
    addDivider(playbackDropdown);
    addSection(playbackDropdown, 'Tool Filter');
    this.toolGroup = document.createElement('div');
    this.toolGroup.className = 'menu-row tool-group';
    this.toolGroup.style.display = 'none';

    this.toolSelect = document.createElement('select');
    const allToolsOpt = document.createElement('option');
    allToolsOpt.value = '-1';
    allToolsOpt.textContent = 'All Tools';
    this.toolSelect.appendChild(allToolsOpt);
    this.toolSelect.onchange = () => {
      this.emit('toolFilterChanged', parseInt(this.toolSelect.value));
    };
    this.toolGroup.appendChild(this.toolSelect);
    playbackDropdown.appendChild(this.toolGroup);

    // Printer simulation controls (hidden until data is loaded)
    addDivider(playbackDropdown);
    addSection(playbackDropdown, 'Printer Simulation');
    this.printerGroup = document.createElement('div');
    this.printerGroup.className = 'menu-row printer-group';
    this.printerGroup.style.display = 'none';
    this.printerGroup.style.flexWrap = 'wrap';
    this.printerGroup.style.gap = '4px';

    this.modeBtn = document.createElement('button');
    this.modeBtn.textContent = 'Realtime';
    this.modeBtn.className = 'printer-btn printer-mode-btn active';
    this.modeBtn.title = 'Toggle between realtime printer tracking and simulation mode';
    this.modeBtn.onclick = () => {
      this.printerMode = this.printerMode === 'realtime' ? 'simulation' : 'realtime';
      this.modeBtn.textContent = this.printerMode === 'realtime' ? 'Realtime' : 'Simulation';
      this.modeBtn.classList.toggle('active', this.printerMode === 'realtime');
      this.speedBtn.style.display = this.printerMode === 'simulation' ? '' : 'none';
      this.directionBtn.style.display = this.printerMode === 'simulation' ? '' : 'none';
      this.realtimeBtn.style.display = this.printerMode === 'simulation' ? '' : 'none';
      this.emit('printerModeChanged', this.printerMode);
    };
    this.printerGroup.appendChild(this.modeBtn);

    this.speedBtn = document.createElement('button');
    this.speedBtn.textContent = '1x';
    this.speedBtn.className = 'printer-btn printer-speed-btn';
    this.speedBtn.title = 'Cycle through speed steps: 0.5x, 1x, 2x, 5x, 10x';
    this.speedBtn.style.display = 'none';
    this.speedBtn.onclick = () => {
      const idx = this.speedSteps.indexOf(this.printerSpeed);
      const nextIdx = (idx + 1) % this.speedSteps.length;
      this.printerSpeed = this.speedSteps[nextIdx];
      this.speedBtn.textContent = `${this.printerSpeed}x`;
      this.emit('printerSpeedChanged', this.printerSpeed);
    };
    this.printerGroup.appendChild(this.speedBtn);

    this.directionBtn = document.createElement('button');
    this.directionBtn.textContent = '▶';
    this.directionBtn.className = 'printer-btn printer-direction-btn';
    this.directionBtn.title = 'Toggle playback direction: forward / backward';
    this.directionBtn.style.display = 'none';
    this.directionBtn.onclick = () => {
      this.printerDirection = this.printerDirection === 'forward' ? 'backward' : 'forward';
      this.directionBtn.textContent = this.printerDirection === 'forward' ? '▶' : '◀';
      this.emit('printerDirectionChanged', this.printerDirection);
    };
    this.printerGroup.appendChild(this.directionBtn);

    this.realtimeBtn = document.createElement('button');
    this.realtimeBtn.textContent = '↻ Realtime';
    this.realtimeBtn.className = 'printer-btn printer-realtime-btn';
    this.realtimeBtn.title = 'Return to realtime printer view';
    this.realtimeBtn.style.display = 'none';
    this.realtimeBtn.onclick = () => {
      this.emit('returnToRealtime', undefined);
    };
    this.printerGroup.appendChild(this.realtimeBtn);
    playbackDropdown.appendChild(this.printerGroup);

    // ── Settings menu (⋯) ──
    const settingsMenu = createMenu('⋯');
    const settingsDropdown = settingsMenu.dropdown;
    settingsMenu.trigger.style.padding = '4px 8px';

    addSection(settingsDropdown, 'Appearance');
    const themeBtn = addButton(settingsDropdown, 'Theme', () => this.emit('toggleTheme', undefined), 'Toggle dark/light theme');
    const statsBtn = addToggle(settingsDropdown, 'Stats', false, () => this.emit('toggleStats', undefined), 'Toggle render statistics');

    // ── Status (right-aligned, always visible) ──
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
      case 'ready': {
        // BUG 10 FIX: Wrap case body in braces to properly scope const declarations
        // Feature #84: Enhanced status bar with print info
        const timeStr = status.duration >= 60
          ? `${Math.floor(status.duration / 60)}m ${Math.round(status.duration % 60)}s`
          : `${status.duration.toFixed(2)}s`;
        this.statusEl.textContent = `Ready: ${status.sampleCount} samples | ${timeStr} | ${status.pathLength.toFixed(1)}mm`;
        // Show time slider and printer controls when data is ready
        this.timeGroup.style.display = 'flex';
        this.showPrinterControls();
        // Show warning if present (non-fatal parse errors, etc.)
        if (status.warning) {
          console.warn('%c[G-code Warning]', 'color: #ffaa00; font-weight: bold', status.warning);
          this.statusEl.textContent += ` ⚠ ${status.warning}`;
        }
        break;
      }
      case 'failed':
        this.statusEl.textContent = `Failed: ${status.errorMessage || 'unknown error'}`;
        this.statusEl.classList.add('error');
        this.statusEl.title = status.errorMessage || 'unknown error';
        // Also log full error to console with structured detail
        console.group('%c[G-code Error]', 'color: #ff4444; font-weight: bold');
        console.error('State: FAILED');
        console.error('Error message:', status.errorMessage || '(none)');
        console.error('Full status object:', status);
        console.groupEnd();
        break;
      default:
        this.statusEl.textContent = status.state;
    }
  }

  /**
   * Feature #84: Set file name in status bar.
   */
  setFileInfo(filename: string): void {
    // Prepend filename to status if we have one
    if (filename) {
      this.statusEl.title = filename;
    }
  }

  setStatus(text: string, type?: 'error' | 'warning'): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('error', 'warning');
    if (type) {
      this.statusEl.classList.add(type);
      // Set title tooltip with the full message so it's readable even if truncated
      this.statusEl.title = text;
    } else {
      this.statusEl.title = '';
    }
  }

  /**
   * Set the layer slider value programmatically.
   * BUG 5 FIX: Does NOT emit 'layerChanged' — callers (like
   * isolateZLayerForLine) already call applyLayerFilter directly.
   * Emitting here would cause applyLayerFilter to run twice.
   */
  setLayerValue(layerIdx: number): void {
    this.layerSlider.value = String(layerIdx);
    this.layerLabel.textContent = layerIdx < 0 ? 'All' : `${layerIdx}`;
    // BUG 11 FIX: Restore slider opacity when a specific layer is set
    this.layerSlider.style.opacity = layerIdx < 0 ? '0.5' : '1';
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
    // BUG 11 FIX: Set initial opacity for "All" state
    this.layerSlider.style.opacity = '0.5';
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
    // BUG 11 FIX: Set initial opacity for "All" state
    this.layerSlider.style.opacity = '0.5';
    this.layerLabel.textContent = 'All';
  }

  /**
   * Update the tool filter dropdown with available tool numbers.
   */
  updateTools(tools: number[]): void {
    // Clear existing options except "All Tools"
    while (this.toolSelect.options.length > 1) {
      this.toolSelect.remove(1);
    }
    if (tools.length === 0) {
      this.toolGroup.style.display = 'none';
      return;
    }
    this.toolGroup.style.display = 'flex';
    for (const t of tools) {
      const opt = document.createElement('option');
      opt.value = String(t);
      opt.textContent = `T${t}`;
      this.toolSelect.appendChild(opt);
    }
    this.toolSelect.value = '-1'; // default to All
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

  /**
   * Show the printer simulation controls (called when data is loaded).
   */
  showPrinterControls(): void {
    this.printerGroup.style.display = 'flex';
  }

  getPrinterMode(): 'realtime' | 'simulation' {
    return this.printerMode;
  }

  getPrinterSpeed(): number {
    return this.printerSpeed;
  }

  getPrinterDirection(): 'forward' | 'backward' {
    return this.printerDirection;
  }

  /**
   * Switch the UI back to realtime mode (called when "return to realtime" is clicked).
   */
  setRealtimeMode(): void {
    this.printerMode = 'realtime';
    this.modeBtn.textContent = 'Realtime';
    this.modeBtn.classList.add('active');
    this.speedBtn.style.display = 'none';
    this.directionBtn.style.display = 'none';
    this.realtimeBtn.style.display = 'none';
  }
}
