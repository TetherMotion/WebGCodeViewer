/**
 * @file ControlPanel.test.ts
 * @brief Unit tests for ControlPanel.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ControlPanel } from '../src/ui/ControlPanel';

describe('ControlPanel', () => {
  let container: HTMLElement;
  let panel: ControlPanel;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new ControlPanel(container);
  });

  // Helper: open all dropdown menus so buttons inside them are visible/clickable
  const openAllDropdowns = () => {
    const dropdowns = container.querySelectorAll('.menu-dropdown');
    for (const d of dropdowns) {
      (d as HTMLElement).classList.add('open');
    }
  };

  // Helper: find and click a button by text content (searches all buttons,
  // including those inside dropdown menus)
  const clickButton = (text: string) => {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === text) {
        (btn as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  };

  it('creates panel element', () => {
    expect(container.querySelector('.control-panel')).toBeTruthy();
  });

  it('setStatus updates status text', () => {
    panel.setStatus('Test status');
    const status = container.querySelector('.status-text');
    expect(status?.textContent).toContain('Test status');
  });

  it('emits toggleGrid when Grid button clicked', () => {
    let emitted = false;
    panel.on('toggleGrid', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Grid');
    expect(emitted).toBe(true);
  });

  it('emits toggleTravels when Travels button clicked', () => {
    let emitted = false;
    panel.on('toggleTravels', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Travels');
    expect(emitted).toBe(true);
  });

  it('emits resetView when Reset View button clicked', () => {
    let emitted = false;
    panel.on('resetView', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Reset View');
    expect(emitted).toBe(true);
  });

  it('emits exportImage when Export Image button clicked', () => {
    let emitted = false;
    panel.on('exportImage', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Export Image');
    expect(emitted).toBe(true);
  });

  it('emits toggleInfoPanel when Info Panel button clicked', () => {
    let emitted = false;
    panel.on('toggleInfoPanel', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Info Panel');
    expect(emitted).toBe(true);
  });

  it('emits toggleComparison when Compare button clicked', () => {
    let emitted = false;
    panel.on('toggleComparison', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Compare');
    expect(emitted).toBe(true);
  });

  it('emits exportReport when Export Report button clicked', () => {
    let emitted = false;
    panel.on('exportReport', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Export Report');
    expect(emitted).toBe(true);
  });

  it('emits toggleDiff when G-code Diff button clicked', () => {
    let emitted = false;
    panel.on('toggleDiff', () => { emitted = true; });
    openAllDropdowns();
    clickButton('G-code Diff');
    expect(emitted).toBe(true);
  });

  it('emits toggleOverhang when Overhang button clicked', () => {
    let emitted = false;
    panel.on('toggleOverhang', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Overhang');
    expect(emitted).toBe(true);
  });

  it('emits toggleZSeam when Z-Seam button clicked', () => {
    let emitted = false;
    panel.on('toggleZSeam', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Z-Seam');
    expect(emitted).toBe(true);
  });

  it('emits toggleProbeMarkers when Probe Markers button clicked', () => {
    let emitted = false;
    panel.on('toggleProbeMarkers', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Probe Markers');
    expect(emitted).toBe(true);
  });

  it('emits toggleDrillMarkers when Drill Markers button clicked', () => {
    let emitted = false;
    panel.on('toggleDrillMarkers', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Drill Markers');
    expect(emitted).toBe(true);
  });

  it('emits toggleHackPanel when G-code Hack button clicked', () => {
    let emitted = false;
    panel.on('toggleHackPanel', () => { emitted = true; });
    openAllDropdowns();
    clickButton('G-code Hack');
    expect(emitted).toBe(true);
  });

  it('emits toggleBridges when Bridges button clicked', () => {
    let emitted = false;
    panel.on('toggleBridges', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Bridges');
    expect(emitted).toBe(true);
  });

  it('emits toggleSupport when Support button clicked', () => {
    let emitted = false;
    panel.on('toggleSupport', () => { emitted = true; });
    openAllDropdowns();
    clickButton('Support');
    expect(emitted).toBe(true);
  });

  it('emits colorAttributeChanged when dropdown changes', () => {
    let attr = '';
    panel.on('colorAttributeChanged', (a) => { attr = a; });
    const select = container.querySelector('select') as HTMLSelectElement;
    if (select) {
      select.value = 'deviation';
      select.dispatchEvent(new Event('change'));
      expect(attr).toBe('deviation');
    }
  });

  it('updateTools populates tool filter dropdown', () => {
    panel.updateTools([1, 2, 3]);
    const toolSelect = container.querySelector('.tool-group select') as HTMLSelectElement;
    expect(toolSelect).toBeTruthy();
    expect(toolSelect.options.length).toBe(4); // "All Tools" + 3 tools
    expect(toolSelect.options[1].textContent).toBe('T1');
    expect(toolSelect.options[3].textContent).toBe('T3');
  });

  it('updateTools with empty array hides tool group', () => {
    panel.updateTools([]);
    const toolGroup = container.querySelector('.tool-group') as HTMLElement;
    expect(toolGroup.style.display).toBe('none');
  });

  it('emits toolFilterChanged when tool select changes', () => {
    let toolNum = -999;
    panel.on('toolFilterChanged', (n) => { toolNum = n; });
    panel.updateTools([1, 2]);
    const toolSelect = container.querySelector('.tool-group select') as HTMLSelectElement;
    toolSelect.value = '2';
    toolSelect.dispatchEvent(new Event('change'));
    expect(toolNum).toBe(2);
  });

  it('updateLayersFromHttp shows layer group', () => {
    panel.updateLayersFromHttp({
      layers: [{ layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 5, pieceCount: 6 }],
      totalLayers: 1,
    });
    const layerGroup = container.querySelector('.layer-group') as HTMLElement;
    expect(layerGroup.style.display).toBe('flex');
  });

  it('updateLayersFromHttp with 0 layers hides group', () => {
    panel.updateLayersFromHttp({ layers: [], totalLayers: 0 });
    const layerGroup = container.querySelector('.layer-group') as HTMLElement;
    expect(layerGroup.style.display).toBe('none');
  });

  it('setTimePosition updates slider and label', () => {
    panel.setTimePosition(0.5);
    const timeGroup = container.querySelector('.time-group');
    const timeLabel = timeGroup?.querySelector('.slider-value');
    expect(timeLabel?.textContent).toContain('50.0%');
  });

  it('isPlaying returns false initially', () => {
    expect(panel.isPlaying()).toBe(false);
  });

  it('setPlaying updates playing state', () => {
    panel.setPlaying(true);
    expect(panel.isPlaying()).toBe(true);
    panel.setPlaying(false);
    expect(panel.isPlaying()).toBe(false);
  });

  it('setRealtimeMode shows printer controls', () => {
    panel.setRealtimeMode();
    expect(panel.getPrinterMode()).toBe('realtime');
  });

  it('getPrinterSpeed returns default 1', () => {
    expect(panel.getPrinterSpeed()).toBe(1);
  });

  it('getPrinterDirection returns forward by default', () => {
    expect(panel.getPrinterDirection()).toBe('forward');
  });

  it('showPrinterControls displays printer group', () => {
    panel.showPrinterControls();
    const printerGroup = container.querySelector('.printer-group') as HTMLElement;
    expect(printerGroup.style.display).toBe('flex');
  });

  it('panel element exists in container', () => {
    expect(container.querySelector('.control-panel')).toBeTruthy();
  });
});
