/**
 * @file UIPanels.test.ts
 * @brief Unit tests for UI panel components (ComparisonPanel, InfoPanel, PositionOverlay).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ComparisonPanel } from "@tether/compare";
import { InfoPanel } from "@tether/gcode-analyzer";
import { PositionOverlay } from '../src/ui/PositionOverlay';
import { parseGcodeMetadata } from "@tether/gcode-analyzer/GcodeMetadata";

describe('ComparisonPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('creates panel with header', () => {
    const panel = new ComparisonPanel(container);
    expect(container.querySelector('.comparison-panel')).toBeTruthy();
    expect(container.querySelector('h3')?.textContent).toBe('Comparison');
  });

  it('is hidden by default', () => {
    const panel = new ComparisonPanel(container);
    expect(panel.visible).toBe(false);
    // Setting visible to false explicitly sets display:none
    panel.visible = false;
    expect(container.querySelector('.comparison-panel')!.style.display).toBe('none');
  });

  it('can be shown and hidden', () => {
    const panel = new ComparisonPanel(container);
    panel.visible = true;
    expect(panel.visible).toBe(true);
    panel.visible = false;
    expect(panel.visible).toBe(false);
  });

  it('emits loadComparison when Load is clicked with input', () => {
    const panel = new ComparisonPanel(container);
    let loadedJobId = '';
    panel.on('loadComparison', (jobId) => { loadedJobId = jobId; });

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'job123';
    const loadBtn = container.querySelectorAll('button')[0] as HTMLButtonElement;
    loadBtn.click();
    expect(loadedJobId).toBe('job123');
  });

  it('does not emit loadComparison when input is empty', () => {
    const panel = new ComparisonPanel(container);
    let emitted = false;
    panel.on('loadComparison', () => { emitted = true; });

    const loadBtn = container.querySelectorAll('button')[0] as HTMLButtonElement;
    loadBtn.click();
    expect(emitted).toBe(false);
  });

  it('emits toggleOverlay when checkbox changes', () => {
    const panel = new ComparisonPanel(container);
    let overlayState: boolean | null = null;
    panel.on('toggleOverlay', (state) => { overlayState = state; });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const overlayCheckbox = checkboxes[0] as HTMLInputElement;
    overlayCheckbox.checked = true;
    overlayCheckbox.dispatchEvent(new Event('change'));
    expect(overlayState).toBe(true);
  });

  it('emits differenceMode when checkbox changes', () => {
    const panel = new ComparisonPanel(container);
    let diffState: boolean | null = null;
    panel.on('differenceMode', (state) => { diffState = state; });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const diffCheckbox = checkboxes[1] as HTMLInputElement;
    diffCheckbox.checked = true;
    diffCheckbox.dispatchEvent(new Event('change'));
    expect(diffState).toBe(true);
  });
});

describe('PositionOverlay', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('creates overlay element', () => {
    const overlay = new PositionOverlay(container);
    expect(container.querySelector('.position-overlay')).toBeTruthy();
  });

  it('is visible by default', () => {
    const overlay = new PositionOverlay(container);
    expect(overlay.visible).toBe(true);
  });

  it('can be hidden', () => {
    const overlay = new PositionOverlay(container);
    overlay.visible = false;
    expect(overlay.visible).toBe(false);
  });

  it('updates position display', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 10.5, y: 20.3, z: 5.1,
      progress: 0.5, totalTime: 100,
    });
    const rows = container.querySelectorAll('.pos-overlay-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].textContent).toContain('10.50');
    expect(rows[0].textContent).toContain('20.30');
    expect(rows[0].textContent).toContain('5.10');
  });

  it('shows time and ETA', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0.5, totalTime: 120,
    });
    const rows = container.querySelectorAll('.pos-overlay-row');
    expect(rows[1].textContent).toContain('Time');
    expect(rows[1].textContent).toContain('ETA');
    expect(rows[1].textContent).toContain('50.0%');
  });

  it('shows feed rate when > 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      feedRate: 1500,
    });
    const feedRow = container.querySelectorAll('.pos-overlay-row')[2];
    expect(feedRow.style.display).not.toBe('none');
    expect(feedRow.textContent).toContain('1500');
    expect(feedRow.textContent).toContain('mm/min');
  });

  it('hides feed rate when 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      feedRate: 0,
    });
    const feedRow = container.querySelectorAll('.pos-overlay-row')[2];
    expect(feedRow.style.display).toBe('none');
  });

  it('shows tool number when > 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      toolNumber: 3,
    });
    const toolRow = container.querySelectorAll('.pos-overlay-row')[3];
    expect(toolRow.style.display).not.toBe('none');
    expect(toolRow.textContent).toContain('T3');
  });

  it('hides tool number when 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      toolNumber: 0,
    });
    const toolRow = container.querySelectorAll('.pos-overlay-row')[3];
    expect(toolRow.style.display).toBe('none');
  });

  it('shows spindle RPM and direction', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      spindleRpm: 12000,
      spindleDir: 'cw',
    });
    const spindleRow = container.querySelectorAll('.pos-overlay-row')[4];
    expect(spindleRow.style.display).not.toBe('none');
    expect(spindleRow.textContent).toContain('12000');
    expect(spindleRow.textContent).toContain('CW');
  });

  it('shows CCW spindle direction', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      spindleRpm: 8000,
      spindleDir: 'ccw',
    });
    const spindleRow = container.querySelectorAll('.pos-overlay-row')[4];
    expect(spindleRow.textContent).toContain('CCW');
  });

  it('hides spindle when RPM is 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      spindleRpm: 0,
    });
    const spindleRow = container.querySelectorAll('.pos-overlay-row')[4];
    expect(spindleRow.style.display).toBe('none');
  });

  it('shows hotend and bed temperature', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      hotendTemp: 210,
      bedTemp: 60,
    });
    const tempRow = container.querySelectorAll('.pos-overlay-row')[5];
    expect(tempRow.style.display).not.toBe('none');
    expect(tempRow.textContent).toContain('210');
    expect(tempRow.textContent).toContain('60');
  });

  it('shows only hotend when bed is 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      hotendTemp: 200,
      bedTemp: 0,
    });
    const tempRow = container.querySelectorAll('.pos-overlay-row')[5];
    expect(tempRow.style.display).not.toBe('none');
    expect(tempRow.textContent).toContain('200');
  });

  it('hides temperature when both are 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      hotendTemp: 0,
      bedTemp: 0,
    });
    const tempRow = container.querySelectorAll('.pos-overlay-row')[5];
    expect(tempRow.style.display).toBe('none');
  });

  it('shows fan speed with percentage', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      fanSpeed: 128,
      fanSpeedMax: 255,
    });
    const fanRow = container.querySelectorAll('.pos-overlay-row')[6];
    expect(fanRow.style.display).not.toBe('none');
    expect(fanRow.textContent).toContain('128');
    expect(fanRow.textContent).toContain('50%');
  });

  it('hides fan when speed is 0', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      fanSpeed: 0,
    });
    const fanRow = container.querySelectorAll('.pos-overlay-row')[6];
    expect(fanRow.style.display).toBe('none');
  });

  it('shows coolant state', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      coolantState: 'flood',
    });
    const coolantRow = container.querySelectorAll('.pos-overlay-row')[7];
    expect(coolantRow.style.display).not.toBe('none');
    expect(coolantRow.textContent).toContain('FLOOD');
  });

  it('shows mist coolant state', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      coolantState: 'mist',
    });
    const coolantRow = container.querySelectorAll('.pos-overlay-row')[7];
    expect(coolantRow.textContent).toContain('MIST');
  });

  it('hides coolant when off', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      coolantState: 'off',
    });
    const coolantRow = container.querySelectorAll('.pos-overlay-row')[7];
    expect(coolantRow.style.display).toBe('none');
  });

  it('shows chamber temperature when provided', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      chamberTemp: 60,
    });
    const tempRow = container.querySelectorAll('.pos-overlay-row')[5];
    expect(tempRow.style.display).not.toBe('none');
    expect(tempRow.textContent).toContain('Chamber');
    expect(tempRow.textContent).toContain('60');
  });

  it('shows feature type instead of fan speed when provided', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      fanSpeed: 128,
      fanSpeedMax: 255,
      featureType: 'WALL-OUTER',
    });
    const fanRow = container.querySelectorAll('.pos-overlay-row')[6];
    expect(fanRow.style.display).not.toBe('none');
    expect(fanRow.textContent).toContain('Type');
    expect(fanRow.textContent).toContain('WALL-OUTER');
    expect(fanRow.textContent).not.toContain('Fan');
  });

  it('shows chamber temp alongside hotend and bed temps', () => {
    const overlay = new PositionOverlay(container);
    overlay.update({
      x: 0, y: 0, z: 0,
      progress: 0, totalTime: 100,
      hotendTemp: 210,
      bedTemp: 60,
      chamberTemp: 40,
    });
    const tempRow = container.querySelectorAll('.pos-overlay-row')[5];
    expect(tempRow.style.display).not.toBe('none');
    expect(tempRow.textContent).toContain('Hotend');
    expect(tempRow.textContent).toContain('210');
    expect(tempRow.textContent).toContain('Bed');
    expect(tempRow.textContent).toContain('60');
    expect(tempRow.textContent).toContain('Chamber');
    expect(tempRow.textContent).toContain('40');
  });

  it('destroy removes element', () => {
    const overlay = new PositionOverlay(container);
    expect(container.querySelector('.position-overlay')).toBeTruthy();
    overlay.destroy();
    expect(container.querySelector('.position-overlay')).toBeFalsy();
  });
});

describe('InfoPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('creates panel with header', () => {
    const panel = new InfoPanel(container);
    expect(container.querySelector('.info-panel')).toBeTruthy();
    expect(container.querySelector('.info-panel-header')?.textContent).toBe('Analysis');
  });

  it('is visible by default', () => {
    const panel = new InfoPanel(container);
    expect(panel.visible).toBe(true);
  });

  it('can be hidden', () => {
    const panel = new InfoPanel(container);
    panel.visible = false;
    expect(panel.visible).toBe(false);
  });

  it('updates with basic data', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['G1 X10 F100']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 150.5,
      bounds: { min: [0, 0, 0], max: [100, 50, 20] },
      sampleCount: 1000,
      pieceCount: 50,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Job Info');
    expect(content.innerHTML).toContain('Dimensions');
    expect(content.innerHTML).toContain('Speed Stats');
    expect(content.innerHTML).toContain('150.5 mm');
    expect(content.innerHTML).toContain('100.00 mm'); // X dimension
  });

  it('shows layer analysis when miniplot data available', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const miniplotData = {
      totalTime: 100,
      segments: [
        { timeStart: 0, duration: 10, lineNumber: 0, speedX: 10, speedY: 0, speedZ: 0, speedE: 0, speedLinear: 10 },
        { timeStart: 10, duration: 10, lineNumber: 1, speedX: 0, speedY: 10, speedZ: 0, speedE: 0, speedLinear: 10 },
      ],
    };
    panel.update({
      metadata: meta,
      miniplotData,
      zLayers: [{ layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 1 }],
      totalDuration: 100,
      pathLength: 50,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 100,
      pieceCount: 10,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Layers');
  });

  it('shows tools section for CNC jobs', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['T1 M6', 'T2 M6']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Tools');
    expect(content.innerHTML).toContain('Tool Count');
  });

  it('shows spindle section for CNC jobs', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['M3 S12000']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Spindle');
    expect(content.innerHTML).toContain('12000');
  });

  it('shows temperature section for 3DP jobs', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['M104 S210', 'M140 S60']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Temperature');
    expect(content.innerHTML).toContain('210');
    expect(content.innerHTML).toContain('60');
  });

  it('shows fan section when fan events exist', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['M106 S128']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Fan');
  });

  it('shows coolant section when coolant events exist', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['M8']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Coolant');
  });

  it('shows feed rate range when max > 0', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata(['G1 X10 F100', 'G1 X20 F500']);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('F Range');
    expect(content.innerHTML).toContain('100');
    expect(content.innerHTML).toContain('500');
  });

  it('update() with gcodeLines shows advanced analysis sections', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      ';TIME:3600',
      ';STOCK_X:200',
      ';STOCK_Y:200',
      ';STOCK_Z:100',
      'G54',
      'G2 X10',
      'G0 X100 Y100',
      'G1 X10 Y10 Z0.2 F1500',
      ';TYPE:WALL-OUTER',
      'G1 X100 Y10 E5 F1800',
    ];
    const miniplotData = {
      totalTime: 133,
      segments: [
        { timeStart: 0, duration: 30, lineNumber: 0, speedX: 10, speedY: 0, speedZ: 0, speedE: 0, speedLinear: 10 },
        { timeStart: 30, duration: 100, lineNumber: 1, speedX: 0, speedY: 10, speedZ: 0, speedE: 0, speedLinear: 10 },
        { timeStart: 130, duration: 3, lineNumber: 2, speedX: 10, speedY: 10, speedZ: 0, speedE: 0, speedLinear: 14 },
      ],
    };
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 0 },
      { layerIndex: 1, zHeight: 0.4, pieceStart: 1, pieceEnd: 1 },
      { layerIndex: 2, zHeight: 0.6, pieceStart: 2, pieceEnd: 2 },
    ];
    panel.update({
      metadata: meta,
      miniplotData,
      zLayers,
      totalDuration: 133,
      pathLength: 200,
      bounds: { min: [0, 0, 0], max: [200, 200, 100] },
      sampleCount: 500,
      pieceCount: 10,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    const html = content.innerHTML;
    expect(html).toContain('Time Estimate');
    expect(html).toContain('Volumetric Flow');
    expect(html).toContain('Stringing Risk');
    expect(html).toContain('G-code Issues');
    expect(html).toContain('Feature Types');
    expect(html).toContain('Work Coordinates');
    expect(html).toContain('Stock/Bed');
    expect(html).toContain('Layer Warnings');
  });

  it('update() with materialUsage shows Material Usage section', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      materialUsage: { extrusionLength: 1500.5, volume: 3600.0, weight: 4.46 },
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Material Usage');
    expect(content.innerHTML).toContain('Extrusion');
    expect(content.innerHTML).toContain('1500.5 mm');
    expect(content.innerHTML).toContain('Volume');
    expect(content.innerHTML).toContain('Weight');
  });

  it('G-code with errors produces G-code Issues section with error/warning counts', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G2 X10',
      'G1 X10 Y10',
      'G1 X20 E5',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('G-code Issues');
    expect(content.innerHTML).toContain('Errors');
    expect(content.innerHTML).toContain('Warnings');
  });

  it('G-code with feature type comments produces Feature Types section', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      ';TYPE:WALL-OUTER',
      'G1 X10 Y10 E5 F1800',
      ';TYPE:FILL',
      'G1 X20 Y20 E3 F1800',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Feature Types');
    expect(content.innerHTML).toContain('WALL-OUTER');
    expect(content.innerHTML).toContain('FILL');
  });

  it('G-code with WCS commands produces Work Coordinates section', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G54',
      'G1 X10 Y10 F1500',
      'G55',
      'G1 X20 Y20 F1500',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Work Coordinates');
    expect(content.innerHTML).toContain('G54');
    expect(content.innerHTML).toContain('G55');
  });

  it('G-code with stock dimensions produces Stock/Bed section', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      ';STOCK_X:150',
      ';STOCK_Y:100',
      ';STOCK_Z:50',
      'G1 X10 Y10 F1500',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Stock/Bed');
    expect(content.innerHTML).toContain('Width');
    expect(content.innerHTML).toContain('150.0 mm');
    expect(content.innerHTML).toContain('Depth');
    expect(content.innerHTML).toContain('100.0 mm');
    expect(content.innerHTML).toContain('Height');
    expect(content.innerHTML).toContain('50.0 mm');
  });

  it('G-code with Cura TIME comment produces Time Estimate section', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      ';TIME:7200',
      'G28',
      'G1 X10 Y10 F1500',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [10, 10, 5] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Time Estimate');
    expect(content.innerHTML).toContain('Estimated');
    expect(content.innerHTML).toContain('2h 0m 0s');
  });

  it('shows Drilling Cycles section for G-code with G81', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = ['G81 X10 Y10 Z-5 R2 F100', 'G80'];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Drilling Cycles');
    expect(content.innerHTML).toContain('Total Holes');
  });

  it('shows Drilling Cycles section for G-code with G82/G83 cycles', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G82 X10 Y10 Z-5 R2 P1 F100',
      'G80',
      'G83 X20 Y20 Z-10 R2 Q2 F100',
      'G80',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Drilling Cycles');
  });

  it('shows Cutter Compensation section for G-code with G41/G42', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G41 D1',
      'G1 X10 Y10 F100',
      'G40',
      'G42 D2',
      'G1 X20 Y20 F100',
      'G40',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Cutter Compensation');
  });

  it('shows Machine Limits section for G-code with feed rate > 15000', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = ['G1 X10 Y10 F20000'];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Machine Limits');
  });

  it('shows Feature Time Breakdown section for G-code with ;TYPE: comments and extruding moves', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      ';TYPE:WALL-OUTER',
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y20 E5 F1800',
      ';TYPE:FILL',
      'G1 X30 Y30 E3 F1800',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Feature Time Breakdown');
  });

  it('shows Optimization section for G-code with air cuts (G1 without E, long distance)', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G0 X0 Y0',
      'G1 X200 Y0 F1500',
      'G1 X0 Y0 F1500',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [300, 300, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Optimization');
  });

  it('shows Over-Travel section for G-code with X coordinate > 300', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = ['G1 X350 Y10 F100'];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [400, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Over-Travel');
  });

  it('shows Probing section for G-code with G38.2', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = ['G38.2 Z-5 F100'];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Probing');
  });

  it('shows Subprograms section for G-code with M98', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'M98 P1000',
      'G1 X10 Y10 F100',
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Subprograms');
  });

  it('shows Cost Estimate section when materialUsage and gcodeLines are provided', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [';TIME:3600', 'G1 X10 Y10 E5 F1800'];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers: [],
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      materialUsage: { extrusionLength: 1000, volume: 2400, weight: 3.0 },
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    expect(content.innerHTML).toContain('Cost Estimate');
    expect(content.innerHTML).toContain('Material');
    expect(content.innerHTML).toContain('Machine Time');
    expect(content.innerHTML).toContain('Total');
  });

  it('does not crash with zLayers and gcodeLines for Overhangs detection', () => {
    const panel = new InfoPanel(container);
    const meta = parseGcodeMetadata([]);
    const gcodeLines = [
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y20 E5 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 0 },
      { layerIndex: 1, zHeight: 0.4, pieceStart: 1, pieceEnd: 1 },
    ];
    panel.update({
      metadata: meta,
      miniplotData: null,
      zLayers,
      totalDuration: 60,
      pathLength: 100,
      bounds: { min: [0, 0, 0], max: [100, 100, 50] },
      sampleCount: 50,
      pieceCount: 5,
      gcodeLines,
    });
    const content = container.querySelector('.info-panel-content') as HTMLElement;
    // Should not throw; overhang detection may or may not find overhangs
    expect(content.innerHTML).toContain('Job Info');
  });

  it('destroy removes element', () => {
    const panel = new InfoPanel(container);
    expect(container.querySelector('.info-panel')).toBeTruthy();
    panel.destroy();
    expect(container.querySelector('.info-panel')).toBeFalsy();
  });
});
