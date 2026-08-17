/**
 * @file UIPanels.test.ts
 * @brief Unit tests for UI panel components (ComparisonPanel, PositionOverlay).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ComparisonPanel } from "@tether/compare";
import { PositionOverlay } from '../src/ui/PositionOverlay';

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

