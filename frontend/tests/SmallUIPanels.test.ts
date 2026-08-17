/**
 * @file SmallUIPanels.test.ts
 * @brief Comprehensive tests for small UI panel components.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CutPlanePanel } from "@tether/cross-section";
import { FilterPanel } from '../src/ui/FilterPanel';
import { StatsPanel } from '../src/ui/StatsPanel';
import { TimeSlider } from '../src/ui/TimeSlider';
import { Toolbar } from '../src/ui/Toolbar';
import { ZLayerPanel } from '../src/ui/ZLayerPanel';
import { NavigationCube } from "@tether/nav-overlay";
import { GridLabels } from "@tether/ground-grid";
import type {
  GetJobStatusResponse,
  GetZLayersResponse,
} from "@tether/viewer-core/generated";

// ── Helpers ──

function makeContainer(): HTMLElement {
  // Clean up any previous containers to avoid duplicate-id conflicts
  // (ZLayerPanel uses document.getElementById internally).
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function makeJobStatus(overrides: Partial<GetJobStatusResponse> = {}): GetJobStatusResponse {
  return {
    jobId: 'job-123',
    state: 'running',
    progress: 0.5,
    sampleCount: 1000,
    duration: 25.5,
    pathLength: 500,
    errorMessage: '',
    ...overrides,
  } as any;
}

// ── CutPlanePanel ──

describe('CutPlanePanel', () => {
  let container: HTMLElement;
  let panel: CutPlanePanel;

  beforeEach(() => {
    container = makeContainer();
    panel = new CutPlanePanel(container);
  });

  it('constructor creates a div with class cut-plane-panel', () => {
    const el = container.querySelector('.cut-plane-panel');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('renders the Cross-Section heading', () => {
    expect(container.querySelector('.cut-plane-panel')!.innerHTML).to.contain('Cross-Section');
  });

  it('creates a Z height range slider with default value 50', () => {
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).to.be.instanceOf(HTMLInputElement);
    expect(slider.value).to.equal('50');
  });

  it('creates a tolerance range slider with default value 0.1', () => {
    const sliders = container.querySelectorAll('input[type="range"]');
    const tolSlider = sliders[1] as HTMLInputElement;
    expect(tolSlider.value).to.equal('0.1');
    expect(tolSlider.step).to.equal('0.01');
  });

  it('creates a visible checkbox', () => {
    const cb = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb).to.be.instanceOf(HTMLInputElement);
  });

  it('emits planeZChanged when Z slider input changes', () => {
    let emitted: number | undefined;
    panel.on('planeZChanged', (v) => { emitted = v; });
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '75';
    slider.dispatchEvent(new Event('input'));
    expect(emitted).to.equal(75);
  });

  it('emits toleranceChanged when tolerance slider input changes', () => {
    let emitted: number | undefined;
    panel.on('toleranceChanged', (v) => { emitted = v; });
    const sliders = container.querySelectorAll('input[type="range"]');
    const tolSlider = sliders[1] as HTMLInputElement;
    tolSlider.value = '0.5';
    tolSlider.dispatchEvent(new Event('input'));
    expect(emitted).to.equal(0.5);
  });

  it('emits visibleChanged when checkbox toggles', () => {
    let emitted: boolean | undefined;
    panel.on('visibleChanged', (v) => { emitted = v; });
    const cb = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(emitted).to.equal(true);
  });

  it('setZRange updates slider min and max', () => {
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    panel.setZRange(-5, 50);
    expect(slider.min).to.equal('-5');
    expect(slider.max).to.equal('50');
  });
});

// ── FilterPanel ──

describe('FilterPanel', () => {
  let container: HTMLElement;
  let panel: FilterPanel;

  beforeEach(() => {
    container = makeContainer();
    panel = new FilterPanel(container);
  });

  it('constructor creates a div with class filter-panel', () => {
    const el = container.querySelector('.filter-panel');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('renders the Filters heading', () => {
    expect(container.querySelector('.filter-panel')!.innerHTML).to.contain('Filters');
  });

  it('creates two number inputs for time range', () => {
    const inputs = container.querySelectorAll('input[type="number"]');
    expect(inputs.length).to.be.at.least(4);
    expect((inputs[0] as HTMLInputElement).placeholder).to.equal('Start');
    expect((inputs[1] as HTMLInputElement).placeholder).to.equal('End');
  });

  it('creates two Apply buttons', () => {
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).to.equal(2);
    expect(buttons[0].textContent).to.equal('Apply');
    expect(buttons[1].textContent).to.equal('Apply');
  });

  it('emits timeRangeChanged when Apply clicked', () => {
    let emitted: { start: number; end: number } | undefined;
    panel.on('timeRangeChanged', (v) => { emitted = v; });
    const inputs = container.querySelectorAll('input[type="number"]');
    (inputs[0] as HTMLInputElement).value = '1.5';
    (inputs[1] as HTMLInputElement).value = '5.0';
    const btn = container.querySelectorAll('button')[0] as HTMLButtonElement;
    btn.click();
    expect(emitted).to.deep.equal({ start: 1.5, end: 5.0 });
  });

  it('emits timeRangeChanged with 0 defaults when inputs empty', () => {
    let emitted: { start: number; end: number } | undefined;
    panel.on('timeRangeChanged', (v) => { emitted = v; });
    const btn = container.querySelectorAll('button')[0] as HTMLButtonElement;
    btn.click();
    expect(emitted).to.deep.equal({ start: 0, end: 0 });
  });

  it('emits segmentRangeChanged when Apply clicked', () => {
    let emitted: { start: number; end: number } | undefined;
    panel.on('segmentRangeChanged', (v) => { emitted = v; });
    const inputs = container.querySelectorAll('input[type="number"]');
    (inputs[2] as HTMLInputElement).value = '3';
    (inputs[3] as HTMLInputElement).value = '9';
    const btn = container.querySelectorAll('button')[1] as HTMLButtonElement;
    btn.click();
    expect(emitted).to.deep.equal({ start: 3, end: 9 });
  });

  it('emits segmentRangeChanged with 0 defaults when inputs empty', () => {
    let emitted: { start: number; end: number } | undefined;
    panel.on('segmentRangeChanged', (v) => { emitted = v; });
    const btn = container.querySelectorAll('button')[1] as HTMLButtonElement;
    btn.click();
    expect(emitted).to.deep.equal({ start: 0, end: 0 });
  });
});

// ── StatsPanel ──

describe('StatsPanel', () => {
  let container: HTMLElement;
  let panel: StatsPanel;

  beforeEach(() => {
    container = makeContainer();
    panel = new StatsPanel(container);
  });

  it('constructor creates a div with class stats-panel', () => {
    const el = container.querySelector('.stats-panel');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('updateJobStatus renders job id', () => {
    panel.updateJobStatus(makeJobStatus());
    const el = container.querySelector('.stats-panel') as HTMLElement;
    expect(el.innerHTML).to.contain('job-123');
  });

  it('updateJobStatus renders state', () => {
    panel.updateJobStatus(makeJobStatus({ state: 'paused' }));
    const el = container.querySelector('.stats-panel') as HTMLElement;
    expect(el.innerHTML).to.contain('paused');
  });

  it('updateJobStatus renders progress as percentage', () => {
    panel.updateJobStatus(makeJobStatus({ progress: 0.5 }));
    const el = container.querySelector('.stats-panel') as HTMLElement;
    expect(el.innerHTML).to.contain('50.0%');
  });

  it('updateJobStatus renders sample count', () => {
    panel.updateJobStatus(makeJobStatus({ sampleCount: 42 }));
    const el = container.querySelector('.stats-panel') as HTMLElement;
    expect(el.innerHTML).to.contain('42');
  });

  it('updateJobStatus renders duration', () => {
    panel.updateJobStatus(makeJobStatus({ duration: 12.3456 }));
    const el = container.querySelector('.stats-panel') as HTMLElement;
    expect(el.innerHTML).to.contain('12.346s');
  });

  it('updateJobStatus does not render error div when no error', () => {
    panel.updateJobStatus(makeJobStatus({ errorMessage: '' }));
    const errEl = container.querySelector('.stat-error');
    expect(errEl).to.be.null;
  });

  it('updateJobStatus renders error div when errorMessage set', () => {
    panel.updateJobStatus(makeJobStatus({ errorMessage: 'Something broke' }));
    const errEl = container.querySelector('.stat-error');
    expect(errEl).to.be.instanceOf(HTMLElement);
    expect(errEl!.textContent).to.contain('Something broke');
  });

  it('renders stat-item divs', () => {
    panel.updateJobStatus(makeJobStatus());
    const items = container.querySelectorAll('.stat-item');
    expect(items.length).to.be.at.least(5);
  });
});

// ── TimeSlider ──

describe('TimeSlider', () => {
  let container: HTMLElement;
  let slider: TimeSlider;

  beforeEach(() => {
    container = makeContainer();
    slider = new TimeSlider(container);
  });

  it('constructor creates a div with class time-slider', () => {
    const el = container.querySelector('.time-slider');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('creates a Play button', () => {
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).to.be.instanceOf(HTMLButtonElement);
    expect(btn.textContent).to.equal('Play');
  });

  it('creates a range slider with max 1000', () => {
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input).to.be.instanceOf(HTMLInputElement);
    expect(input.max).to.equal('1000');
    expect(input.value).to.equal('0');
  });

  it('creates a speed select with 6 options', () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).to.be.instanceOf(HTMLSelectElement);
    expect(select.options.length).to.equal(6);
  });

  it('speed select defaults to 1x', () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).to.equal('1');
  });

  it('emits timeChanged when slider input changes', () => {
    let emitted: number | undefined;
    slider.on('timeChanged', (v) => { emitted = v; });
    slider.duration = 10;
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    input.value = '500';
    input.dispatchEvent(new Event('input'));
    expect(emitted).to.equal(5);
  });

  it('emits playChanged when Play button clicked', () => {
    let emitted: boolean | undefined;
    slider.on('playChanged', (v) => { emitted = v; });
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(emitted).to.equal(true);
  });

  it('toggles button text to Pause when playing', () => {
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(btn.textContent).to.equal('Pause');
  });

  it('toggles button text back to Play when paused', () => {
    const btn = container.querySelector('button') as HTMLButtonElement;
    btn.click(); // play
    btn.click(); // pause
    expect(btn.textContent).to.equal('Play');
  });

  it('emits speedChanged when speed select changes', () => {
    let emitted: number | undefined;
    slider.on('speedChanged', (v) => { emitted = v; });
    const select = container.querySelector('select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(emitted).to.equal(2);
  });

  it('currentTime getter returns 0 initially', () => {
    expect(slider.currentTime).to.equal(0);
  });

  it('duration setter clamps to minimum 0.001', () => {
    slider.duration = -5;
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    input.value = '1000';
    let emitted: number | undefined;
    slider.on('timeChanged', (v) => { emitted = v; });
    input.dispatchEvent(new Event('input'));
    expect(emitted).to.equal(0.001);
  });
});

// ── Toolbar ──

describe('Toolbar', () => {
  let container: HTMLElement;
  let toolbar: Toolbar;

  beforeEach(() => {
    container = makeContainer();
    toolbar = new Toolbar(container);
  });

  it('constructor creates a div with class toolbar', () => {
    const el = container.querySelector('.toolbar');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('creates an Upload G-code button', () => {
    const buttons = container.querySelectorAll('button');
    const uploadBtn = Array.from(buttons).find(b => b.textContent === 'Upload G-code');
    expect(uploadBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a Grid button', () => {
    const buttons = container.querySelectorAll('button');
    const gridBtn = Array.from(buttons).find(b => b.textContent === 'Grid');
    expect(gridBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a Cross-Section button', () => {
    const buttons = container.querySelectorAll('button');
    const crossBtn = Array.from(buttons).find(b => b.textContent === 'Cross-Section');
    expect(crossBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a Reset View button', () => {
    const buttons = container.querySelectorAll('button');
    const resetBtn = Array.from(buttons).find(b => b.textContent === 'Reset View');
    expect(resetBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates an Export button', () => {
    const buttons = container.querySelectorAll('button');
    const exportBtn = Array.from(buttons).find(b => b.textContent === 'Export');
    expect(exportBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a color attribute select with 6 options', () => {
    const selects = container.querySelectorAll('select');
    const attrSelect = selects[0] as HTMLSelectElement;
    expect(attrSelect.options.length).to.equal(6);
    const values = Array.from(attrSelect.options).map(o => o.value);
    expect(values).to.deep.equal(['velocity', 'acceleration', 'jerk', 'curvature', 'motion', 'solid']);
  });

  it('creates a color map select with 6 options', () => {
    const selects = container.querySelectorAll('select');
    const mapSelect = selects[1] as HTMLSelectElement;
    expect(mapSelect.options.length).to.equal(6);
    const values = Array.from(mapSelect.options).map(o => o.value);
    expect(values).to.deep.equal(['viridis', 'plasma', 'jet', 'turbo', 'grayscale', 'rainbow']);
  });

  it('emits colorAttributeChanged when attribute select changes', () => {
    let emitted: string | undefined;
    toolbar.on('colorAttributeChanged', (v) => { emitted = v; });
    const selects = container.querySelectorAll('select');
    const attrSelect = selects[0] as HTMLSelectElement;
    attrSelect.value = 'jerk';
    attrSelect.dispatchEvent(new Event('change'));
    expect(emitted).to.equal('jerk');
  });

  it('emits colorMapChanged when map select changes', () => {
    let emitted: string | undefined;
    toolbar.on('colorMapChanged', (v) => { emitted = v; });
    const selects = container.querySelectorAll('select');
    const mapSelect = selects[1] as HTMLSelectElement;
    mapSelect.value = 'plasma';
    mapSelect.dispatchEvent(new Event('change'));
    expect(emitted).to.equal('plasma');
  });

  it('emits toggleGrid when Grid button clicked', () => {
    let emitted: boolean | undefined;
    toolbar.on('toggleGrid', (v) => { emitted = v; });
    const buttons = container.querySelectorAll('button');
    const gridBtn = Array.from(buttons).find(b => b.textContent === 'Grid') as HTMLButtonElement;
    gridBtn.click();
    expect(emitted).to.equal(true);
  });

  it('emits toggleCrossSection when Cross-Section button clicked', () => {
    let emitted: boolean | undefined;
    toolbar.on('toggleCrossSection', (v) => { emitted = v; });
    const buttons = container.querySelectorAll('button');
    const crossBtn = Array.from(buttons).find(b => b.textContent === 'Cross-Section') as HTMLButtonElement;
    crossBtn.click();
    expect(emitted).to.equal(true);
  });

  it('emits resetView when Reset View button clicked', () => {
    let emitted: boolean | undefined;
    toolbar.on('resetView', () => { emitted = true; });
    const buttons = container.querySelectorAll('button');
    const resetBtn = Array.from(buttons).find(b => b.textContent === 'Reset View') as HTMLButtonElement;
    resetBtn.click();
    expect(emitted).to.equal(true);
  });

  it('emits exportImage when Export button clicked', () => {
    let emitted: boolean | undefined;
    toolbar.on('exportImage', () => { emitted = true; });
    const buttons = container.querySelectorAll('button');
    const exportBtn = Array.from(buttons).find(b => b.textContent === 'Export') as HTMLButtonElement;
    exportBtn.click();
    expect(emitted).to.equal(true);
  });
});

// ── ZLayerPanel ──

describe('ZLayerPanel', () => {
  let container: HTMLElement;
  let panel: ZLayerPanel;

  beforeEach(() => {
    container = makeContainer();
    panel = new ZLayerPanel(container);
  });

  it('constructor creates a div with class z-layer-panel', () => {
    const el = container.querySelector('.z-layer-panel');
    expect(el).to.be.instanceOf(HTMLElement);
  });

  it('renders the Z-Layers heading', () => {
    expect(container.querySelector('.z-layer-panel')!.innerHTML).to.contain('Z-Layers');
  });

  it('creates a tolerance input with default 0.01', () => {
    const input = container.querySelector('.z-tolerance input[type="number"]') as HTMLInputElement;
    expect(input).to.be.instanceOf(HTMLInputElement);
    expect(input.value).to.equal('0.01');
  });

  it('creates a Recompute button', () => {
    const buttons = container.querySelectorAll('button');
    const recomputeBtn = Array.from(buttons).find(b => b.textContent === 'Recompute');
    expect(recomputeBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a Show All Layers button', () => {
    const buttons = container.querySelectorAll('button');
    const showAllBtn = Array.from(buttons).find(b => b.textContent === 'Show All Layers');
    expect(showAllBtn).to.be.instanceOf(HTMLButtonElement);
  });

  it('creates a summary div with id z-layer-summary', () => {
    const summary = container.querySelector('#z-layer-summary');
    expect(summary).to.be.instanceOf(HTMLElement);
  });

  it('creates a layer list items div', () => {
    const listEl = container.querySelector('.z-layer-list-items');
    expect(listEl).to.be.instanceOf(HTMLElement);
  });

  it('update() renders summary with total layers', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const summary = container.querySelector('#z-layer-summary') as HTMLElement;
    expect(summary.innerHTML).to.contain('Total Layers: 1');
    expect(summary.innerHTML).to.contain('Z Range: 0.20 - 0.20 mm');
    expect(summary.innerHTML).to.contain('Layer Height: 0.200 mm');
  });

  it('update() renders layer items', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
        { layerIndex: 1, zHeight: 0.4, sampleStart: 100, sampleEnd: 200, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 2, minZ: 0.2, maxZ: 0.4, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const items = container.querySelectorAll('.z-layer-item');
    expect(items.length).to.equal(2);
  });

  it('update() renders layer index, z height, sample count, path length', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const listEl = container.querySelector('.z-layer-list-items') as HTMLElement;
    expect(listEl.innerHTML).to.contain('L0');
    expect(listEl.innerHTML).to.contain('Z=0.200');
    expect(listEl.innerHTML).to.contain('100 samples');
    expect(listEl.innerHTML).to.contain('50.0 mm');
  });

  it('emits zToleranceChanged when Recompute clicked', () => {
    let emitted: number | undefined;
    panel.on('zToleranceChanged', (v) => { emitted = v; });
    const input = container.querySelector('.z-tolerance input[type="number"]') as HTMLInputElement;
    input.value = '0.05';
    const buttons = container.querySelectorAll('button');
    const recomputeBtn = Array.from(buttons).find(b => b.textContent === 'Recompute') as HTMLButtonElement;
    recomputeBtn.click();
    expect(emitted).to.equal(0.05);
  });

  it('emits zToleranceChanged with default 0.01 when input invalid', () => {
    let emitted: number | undefined;
    panel.on('zToleranceChanged', (v) => { emitted = v; });
    const input = container.querySelector('.z-tolerance input[type="number"]') as HTMLInputElement;
    input.value = 'abc';
    const buttons = container.querySelectorAll('button');
    const recomputeBtn = Array.from(buttons).find(b => b.textContent === 'Recompute') as HTMLButtonElement;
    recomputeBtn.click();
    expect(emitted).to.equal(0.01);
  });

  it('emits layerSelected when a layer item is clicked', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
        { layerIndex: 1, zHeight: 0.4, sampleStart: 100, sampleEnd: 200, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 2, minZ: 0.2, maxZ: 0.4, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    let emitted: number | undefined;
    panel.on('layerSelected', (v) => { emitted = v; });
    const items = container.querySelectorAll('.z-layer-item');
    (items[1] as HTMLElement).click();
    expect(emitted).to.equal(1);
  });

  it('getSelectedLayer returns -1 initially', () => {
    expect(panel.getSelectedLayer()).to.equal(-1);
  });

  it('getSelectedLayer returns selected layer after click', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
        { layerIndex: 1, zHeight: 0.4, sampleStart: 100, sampleEnd: 200, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 2, minZ: 0.2, maxZ: 0.4, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const items = container.querySelectorAll('.z-layer-item');
    (items[1] as HTMLElement).click();
    expect(panel.getSelectedLayer()).to.equal(1);
  });

  it('selected layer gets "selected" class', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
        { layerIndex: 1, zHeight: 0.4, sampleStart: 100, sampleEnd: 200, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 2, minZ: 0.2, maxZ: 0.4, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const items = container.querySelectorAll('.z-layer-item');
    (items[0] as HTMLElement).click();
    const selected = container.querySelectorAll('.z-layer-item.selected');
    expect(selected.length).to.equal(1);
    expect(selected[0].getAttribute('data-layer')).to.equal('0');
  });

  it('emits visibilityChanged when checkbox toggled', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    let emitted: { layerIndex: number; visible: boolean } | undefined;
    panel.on('visibilityChanged', (v) => { emitted = v; });
    const cb = container.querySelector('.layer-visibility') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(emitted).to.deep.equal({ layerIndex: 0, visible: false });
  });

  it('getHiddenLayers returns empty set initially', () => {
    expect(panel.getHiddenLayers().size).to.equal(0);
  });

  it('getHiddenLayers returns hidden layer after unchecking', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const cb = container.querySelector('.layer-visibility') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    const hidden = panel.getHiddenLayers();
    expect(hidden.has(0)).to.equal(true);
    expect(hidden.size).to.equal(1);
  });

  it('emits showAllLayers when Show All Layers button clicked', () => {
    let emitted = false;
    panel.on('showAllLayers', () => { emitted = true; });
    const buttons = container.querySelectorAll('button');
    const showAllBtn = Array.from(buttons).find(b => b.textContent === 'Show All Layers') as HTMLButtonElement;
    showAllBtn.click();
    expect(emitted).to.equal(true);
  });

  it('Show All Layers resets selected layer to -1', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const items = container.querySelectorAll('.z-layer-item');
    (items[0] as HTMLElement).click();
    expect(panel.getSelectedLayer()).to.equal(0);
    const buttons = container.querySelectorAll('button');
    const showAllBtn = Array.from(buttons).find(b => b.textContent === 'Show All Layers') as HTMLButtonElement;
    showAllBtn.click();
    expect(panel.getSelectedLayer()).to.equal(-1);
  });

  it('Show All Layers clears hidden layers', () => {
    const resp: GetZLayersResponse = {
      layers: [
        { layerIndex: 0, zHeight: 0.2, sampleStart: 0, sampleEnd: 100, sampleCount: 100, pathLength: 50 } as any,
      ],
      totalLayers: 1, minZ: 0.2, maxZ: 0.2, layerHeight: 0.2,
    } as any;
    panel.update(resp);
    const cb = container.querySelector('.layer-visibility') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(panel.getHiddenLayers().size).to.equal(1);
    const buttons = container.querySelectorAll('button');
    const showAllBtn = Array.from(buttons).find(b => b.textContent === 'Show All Layers') as HTMLButtonElement;
    showAllBtn.click();
    expect(panel.getHiddenLayers().size).to.equal(0);
  });
});

// ── NavigationCube ──

describe('NavigationCube', () => {
  let container: HTMLElement;
  let cube: NavigationCube;

  beforeEach(() => {
    container = makeContainer();
    cube = new NavigationCube(container);
  });

  it('constructor sets container class to nav-cube-overlay', () => {
    expect(container.className).to.equal('nav-cube-overlay');
  });

  it('creates a gizmo canvas with class nav-gizmo-canvas', () => {
    const canvas = container.querySelector('.nav-gizmo-canvas') as HTMLCanvasElement;
    expect(canvas).to.be.instanceOf(HTMLCanvasElement);
  });

  it('gizmo canvas has 80x80 dimensions', () => {
    const canvas = container.querySelector('.nav-gizmo-canvas') as HTMLCanvasElement;
    expect(canvas.width).to.equal(80);
    expect(canvas.height).to.equal(80);
  });

  it('creates a direction canvas with class nav-dir-canvas', () => {
    const canvas = container.querySelector('.nav-dir-canvas') as HTMLCanvasElement;
    expect(canvas).to.be.instanceOf(HTMLCanvasElement);
  });

  it('creates a projection switch container', () => {
    const proj = container.querySelector('.nav-proj-switch');
    expect(proj).to.be.instanceOf(HTMLElement);
  });

  it('creates Persp button with active class', () => {
    const btn = container.querySelector('.nav-proj-btn') as HTMLButtonElement;
    expect(btn).to.be.instanceOf(HTMLButtonElement);
    expect(btn.textContent).to.equal('Persp');
    expect(btn.classList.contains('active')).to.equal(true);
  });

  it('creates Ortho button without active class', () => {
    const btns = container.querySelectorAll('.nav-proj-btn');
    const ortho = btns[1] as HTMLButtonElement;
    expect(ortho.textContent).to.equal('Ortho');
    expect(ortho.classList.contains('active')).to.equal(false);
  });

  it('getProjectionMode returns perspective initially', () => {
    expect(cube.getProjectionMode()).to.equal('perspective');
  });

  it('emits projectionChanged when Ortho clicked', () => {
    let emitted: string | undefined;
    cube.on('projectionChanged', (v) => { emitted = v; });
    const btns = container.querySelectorAll('.nav-proj-btn');
    (btns[1] as HTMLButtonElement).click();
    expect(emitted).to.equal('orthographic');
  });

  it('Ortho button gets active class after click', () => {
    const btns = container.querySelectorAll('.nav-proj-btn');
    (btns[1] as HTMLButtonElement).click();
    expect(btns[1].classList.contains('active')).to.equal(true);
    expect(btns[0].classList.contains('active')).to.equal(false);
  });

  it('emits projectionChanged when Persp clicked after Ortho', () => {
    const btns = container.querySelectorAll('.nav-proj-btn');
    (btns[1] as HTMLButtonElement).click(); // ortho
    let emitted: string | undefined;
    cube.on('projectionChanged', (v) => { emitted = v; });
    (btns[0] as HTMLButtonElement).click(); // persp
    expect(emitted).to.equal('perspective');
  });

  it('does not emit when clicking already-active projection', () => {
    const btns = container.querySelectorAll('.nav-proj-btn');
    let emitted: string | undefined;
    cube.on('projectionChanged', (v) => { emitted = v; });
    (btns[0] as HTMLButtonElement).click(); // persp already active
    expect(emitted).to.be.undefined;
  });

  it('setProjectionMode updates current mode', () => {
    cube.setProjectionMode('orthographic');
    expect(cube.getProjectionMode()).to.equal('orthographic');
  });

  it('setProjectionMode updates button active classes', () => {
    cube.setProjectionMode('orthographic');
    const btns = container.querySelectorAll('.nav-proj-btn');
    expect(btns[1].classList.contains('active')).to.equal(true);
    expect(btns[0].classList.contains('active')).to.equal(false);
  });

  it('setActiveDirection is callable', () => {
    expect(() => cube.setActiveDirection('top')).to.not.throw();
  });

  it('emits directionSelected on dirCanvas click', () => {
    let emitted: string | undefined;
    cube.on('directionSelected', (v) => { emitted = v; });
    const dirCanvas = container.querySelector('.nav-dir-canvas') as HTMLCanvasElement;
    // Mock getBoundingClientRect
    dirCanvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 200,
      right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    // Click in first cell (iso) - col 0, row 0
    const click = new MouseEvent('click', { clientX: 10, clientY: 10 });
    dirCanvas.dispatchEvent(click);
    expect(emitted).to.equal('iso');
  });

  it('emits correct direction for each grid cell', () => {
    const dirCanvas = container.querySelector('.nav-dir-canvas') as HTMLCanvasElement;
    dirCanvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 200,
      right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const directions = ['iso', 'top', 'front', 'right', 'left', 'back', 'bottom'];
    const cols = 4;
    const rows = 2;
    const cellW = 400 / cols; // 100
    const cellH = 200 / rows; // 100
    for (let i = 0; i < directions.length; i++) {
      let emitted: string | undefined;
      cube.on('directionSelected', (v) => { emitted = v; });
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW + 10;
      const y = row * cellH + 10;
      const click = new MouseEvent('click', { clientX: x, clientY: y });
      dirCanvas.dispatchEvent(click);
      expect(emitted).to.equal(directions[i]);
    }
  });
});

// ── GridLabels ──

describe('GridLabels', () => {
  let canvas: HTMLCanvasElement;
  let labels: GridLabels;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    labels = new GridLabels(canvas);
  });

  it('constructor does not throw with valid 2d context', () => {
    expect(() => new GridLabels(canvas)).to.not.throw();
  });

  it('visible is true by default', () => {
    expect(labels.visible).to.equal(true);
  });

  it('render() does not throw with empty ticks', () => {
    const viewProj = new Float32Array(16);
    // identity-ish matrix
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    expect(() => labels.render([], viewProj, 800, 600)).to.not.throw();
  });

  it('render() is a no-op when visible is false', () => {
    labels.visible = false;
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ctx = canvas.getContext('2d') as any;
    let cleared = false;
    const origClear = ctx.clearRect;
    ctx.clearRect = () => { cleared = true; };
    labels.render([], viewProj, 800, 600);
    expect(cleared).to.equal(false);
    ctx.clearRect = origClear;
  });

  it('render() projects ticks and does not throw', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 0, axis: 0 as 0 | 1 },
      { position: [10, 0, 0] as [number, number, number], value: 10, axis: 0 as 0 | 1 },
      { position: [0, 10, 0] as [number, number, number], value: 10, axis: 1 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() updates canvas size when dimensions change', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    labels.render([], viewProj, 400, 300);
    // dpr is 1 in jsdom, so canvas should be 400x300
    expect(canvas.width).to.equal(400);
    expect(canvas.height).to.equal(300);
  });

  it('render() handles depthData without throwing', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const depthData = new Float32Array(100 * 100).fill(1.0);
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 0, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600, depthData, [100, 100])).to.not.throw();
  });

  it('destroy() is callable and does not throw', () => {
    expect(() => labels.destroy()).to.not.throw();
  });

  it('render() decimates ticks when too many for screen width', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    // Generate 100 X-axis ticks — more than can fit on a 100px canvas
    const ticks: { position: [number, number, number]; value: number; axis: 0 | 1 }[] = [];
    for (let i = 0; i < 100; i++) {
      ticks.push({
        position: [i * 10, 0, 0],
        value: i * 10,
        axis: 0,
      });
    }
    // Use a very small canvas width to force decimation
    expect(() => labels.render(ticks, viewProj, 100, 600)).to.not.throw();
  });

  it('render() decimates Y-axis ticks when too many', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks: { position: [number, number, number]; value: number; axis: 0 | 1 }[] = [];
    for (let i = 0; i < 100; i++) {
      ticks.push({
        position: [0, i * 10, 0],
        value: i * 10,
        axis: 1,
      });
    }
    expect(() => labels.render(ticks, viewProj, 800, 100)).to.not.throw();
  });

  it('render() formats large values (>= 100) without decimals', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 500, axis: 0 as 0 | 1 },
      { position: [10, 0, 0] as [number, number, number], value: 1000, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() formats small values (< 10) with one decimal', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 5.5, axis: 0 as 0 | 1 },
      { position: [10, 0, 0] as [number, number, number], value: 9.9, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() formats near-zero values as "0"', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 1e-10, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() formats medium values (10-99) with one decimal', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 0] as [number, number, number], value: 50.5, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() culls off-screen ticks', () => {
    const viewProj = new Float32Array(16);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;
    // Ticks at extreme positions should be culled
    const ticks = [
      { position: [10000, 0, 0] as [number, number, number], value: 10000, axis: 0 as 0 | 1 },
      { position: [-10000, 0, 0] as [number, number, number], value: -10000, axis: 0 as 0 | 1 },
      { position: [5, 0, 0] as [number, number, number], value: 5, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });

  it('render() handles ticks behind camera (clipW <= 0)', () => {
    // Use a viewProj that makes clipW negative for some ticks
    const viewProj = new Float32Array(16);
    // Set up a matrix where w becomes 0 or negative for z > 0
    viewProj[11] = -1; viewProj[15] = 1;
    const ticks = [
      { position: [0, 0, 100] as [number, number, number], value: 100, axis: 0 as 0 | 1 },
    ];
    expect(() => labels.render(ticks, viewProj, 800, 600)).to.not.throw();
  });
});
