/**
 * @file WebGPUApp.test.ts
 * @brief Unit tests for WebGPUApp — the main application orchestrator.
 *
 * These tests focus on methods that do NOT require a real WebGPU device or
 * canvas rendering: pure logic, state management, event handling, keyboard
 * shortcuts, tool/layer filtering, bookmark integration, URL building, and
 * DOM-based display helpers. The constructor is exercised because it does not
 * touch WebGPU (init() does), which lets us test the post-construction state
 * and the many private helper methods via type-cast access.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebGPUApp } from '../src/core/WebGPUApp';
import { Camera } from '../src/core/Camera';
import { BookmarkManager } from '../src/ui/BookmarkManager';
import type { NBPData } from '../src/core/NurbsParser';
import type { TTHRData } from '../src/core/TthrParser';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a minimal mock RpcClient with httpBaseUrl and stubbed methods. */
function createMockRpcClient(): any {
  return {
    httpBaseUrl: 'http://localhost:8021',
    getJobStatus: vi.fn().mockResolvedValue({ state: 'ready', errorMessage: '' }),
    getNurbsPathHttp: vi.fn().mockResolvedValue(new Uint8Array()),
    getBinaryHttp: vi.fn().mockResolvedValue(new Uint8Array()),
    getBlocks: vi.fn().mockResolvedValue({ blocks: [] }),
    getZLayers: vi.fn().mockResolvedValue({ layers: [] }),
    uploadGcodeHttp: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    processJob: vi.fn().mockResolvedValue({}),
  };
}

/** Build a small NBPData object for filter tests. */
function makeNBPData(pieceCount: number, opts?: {
  boundsMin?: [number, number, number];
  boundsMax?: [number, number, number];
  extruderSpeeds?: number[];
  motionTypes?: number[];
}): NBPData {
  const pieces = [];
  for (let i = 0; i < pieceCount; i++) {
    pieces.push({
      degree: 3,
      controlPoints: [i, 0, 0, i + 1, 0, 0],
      weights: [1, 1],
      knots: [0, 0, 0, 1, 1, 1],
      motionType: opts?.motionTypes?.[i] ?? 0,
      deviation: 0,
      extruderSpeed: opts?.extruderSpeeds?.[i] ?? 0,
    });
  }
  return {
    header: {
      magic: 'TNBP',
      version: 3,
      dim: 3,
      pieceCount,
      blockCount: pieceCount,
      totalControlPoints: pieceCount * 2,
      totalKnots: pieceCount * 6,
      totalLength: pieceCount,
      boundsMin: opts?.boundsMin ?? [0, 0, 0],
      boundsMax: opts?.boundsMax ?? [pieceCount, 10, 20],
    },
    pieces,
    blocks: [],
  };
}

/** Build a small TTHRData object. */
function makeTTHRData(sampleCount: number): TTHRData {
  const axes = 3;
  const positions = new Float32Array(sampleCount * axes);
  const blockIndex = new Int32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    positions[i * axes] = i;
    positions[i * axes + 1] = 0;
    positions[i * axes + 2] = i * 0.2;
    blockIndex[i] = i;
  }
  return {
    header: {
      magic: 'TTHR',
      version: 1,
      flags: 0x0001,
      axisCount: axes,
      sampleCount,
      blockCount: sampleCount,
      timeStart: 0,
      timeEnd: sampleCount,
      pathLength: sampleCount,
      boundsMin: [0, 0, 0],
      boundsMax: [sampleCount, 5, 10],
    },
    positions,
    blockIndex,
  };
}

/** Create a fake KeyboardEvent with the given key + modifier flags. */
function makeKeyEvent(key: string, opts: {
  ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
  target?: HTMLElement; preventDefault?: ReturnType<typeof vi.fn>;
} = {}): KeyboardEvent {
  const e = {
    key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    target: opts.target ?? document.body,
    preventDefault: opts.preventDefault ?? vi.fn(),
  } as unknown as KeyboardEvent;
  return e;
}

// ── Test suite ────────────────────────────────────────────────────────────

describe('WebGPUApp', () => {
  let canvas: HTMLCanvasElement;
  let topPanel: HTMLElement;
  let gcodePanel: HTMLElement;
  let navCubeContainer: HTMLElement;
  let rpcClient: any;
  let app: WebGPUApp;

  beforeEach(() => {
    // Create DOM containers required by the constructor
    canvas = document.createElement('canvas');
    canvas.id = 'webgpu-canvas';
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    topPanel = document.createElement('div');
    topPanel.id = 'top-panel';
    document.body.appendChild(topPanel);

    gcodePanel = document.createElement('div');
    gcodePanel.id = 'gcode-panel';
    document.body.appendChild(gcodePanel);

    navCubeContainer = document.createElement('div');
    navCubeContainer.id = 'nav-cube';
    document.body.appendChild(navCubeContainer);

    rpcClient = createMockRpcClient();
    app = new WebGPUApp(canvas, rpcClient, topPanel, gcodePanel, navCubeContainer);
  });

  afterEach(() => {
    try { (app as any).destroy(); } catch { /* ignore */ }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ── Construction ────────────────────────────────────────────────────────

  describe('construction', () => {
    it('constructs without WebGPU (init not called)', () => {
      expect(app).toBeInstanceOf(WebGPUApp);
    });

    it('registers a keydown listener on window', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      // Re-create to observe the spy
      const app2 = new WebGPUApp(canvas, rpcClient, topPanel, gcodePanel, navCubeContainer);
      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      (app2 as any).destroy();
    });

    it('sets up drag-and-drop on document.body', () => {
      // drag-active class toggling via dragover
      const dropZone = document.body;
      const event = new Event('dragover', { bubbles: true });
      (event as any).preventDefault = vi.fn();
      (event as any).stopPropagation = vi.fn();
      dropZone.dispatchEvent(event);
      expect(dropZone.classList.contains('drag-active')).toBe(true);
    });
  });

  // ── buildViewUrl ────────────────────────────────────────────────────────

  describe('buildViewUrl', () => {
    it('returns a URL with cam param and no job when no job loaded', () => {
      const url = app.buildViewUrl();
      expect(url).toContain('cam=');
      expect(url).not.toContain('job=');
    });

    it('includes job param when a job id is set', () => {
      (app as any).currentJobId = 'abc123';
      const url = app.buildViewUrl();
      expect(url).toContain('job=abc123');
      expect(url).toContain('cam=');
    });

    it('encodes camera angle, elevation, and distance', () => {
      const cam: Camera = (app as any).camera;
      cam.setOrbit(0.5, 0.3, 400);
      const url = app.buildViewUrl();
      // URLSearchParams encodes commas as %2C
      expect(url).toContain('cam=0.5000%2C0.3000%2C400.00');
    });

    it('uses window.location origin and pathname as base', () => {
      const url = app.buildViewUrl();
      expect(url.startsWith(window.location.origin)).toBe(true);
    });
  });

  // ── applyCameraFromUrl ──────────────────────────────────────────────────

  describe('applyCameraFromUrl', () => {
    it('applies valid camera params immediately when no job loading', () => {
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('0.5,0.3,400');
      expect(setOrbitSpy).toHaveBeenCalledWith(0.5, 0.3, 400);
    });

    it('defers camera params when a job is loading but data not yet available', () => {
      (app as any).currentJobId = 'job-loading';
      // currentNBP and fullData are null → defer
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('1.0,0.2,300');
      expect(setOrbitSpy).not.toHaveBeenCalled();
      expect((app as any).pendingCamParams).toEqual({ angle: 1.0, elevation: 0.2, distance: 300 });
    });

    it('applies immediately when job is loading but data already available', () => {
      (app as any).currentJobId = 'job-loaded';
      (app as any).currentNBP = makeNBPData(2);
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('0.1,0.4,500');
      expect(setOrbitSpy).toHaveBeenCalledWith(0.1, 0.4, 500);
      expect((app as any).pendingCamParams).toBeNull();
    });

    it('ignores invalid params (non-numeric)', () => {
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('abc,def,ghi');
      expect(setOrbitSpy).not.toHaveBeenCalled();
      expect((app as any).pendingCamParams).toBeNull();
    });

    it('ignores params with fewer than 3 values', () => {
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('0.5,0.3');
      expect(setOrbitSpy).not.toHaveBeenCalled();
    });

    it('ignores params containing NaN', () => {
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      app.applyCameraFromUrl('0.5,NaN,400');
      expect(setOrbitSpy).not.toHaveBeenCalled();
    });
  });

  // ── handleKeyDown ───────────────────────────────────────────────────────

  describe('handleKeyDown', () => {
    it('toggles search visibility on Ctrl+F', () => {
      const gv = (app as any).gcodeViewer;
      const showSpy = vi.spyOn(gv, 'showSearch');
      const hideSpy = vi.spyOn(gv, 'hideSearch');
      const isVisSpy = vi.spyOn(gv, 'isSearchVisible').mockReturnValue(false);
      (app as any).handleKeyDown(makeKeyEvent('f', { ctrlKey: true }));
      expect(showSpy).toHaveBeenCalled();
      isVisSpy.mockReturnValue(true);
      (app as any).handleKeyDown(makeKeyEvent('f', { ctrlKey: true }));
      expect(hideSpy).toHaveBeenCalled();
    });

    it('toggles goto visibility on Ctrl+G', () => {
      const gv = (app as any).gcodeViewer;
      const showSpy = vi.spyOn(gv, 'showGoto');
      const hideSpy = vi.spyOn(gv, 'hideGoto');
      const isVisSpy = vi.spyOn(gv, 'isGotoVisible').mockReturnValue(false);
      (app as any).handleKeyDown(makeKeyEvent('g', { ctrlKey: true }));
      expect(showSpy).toHaveBeenCalled();
      isVisSpy.mockReturnValue(true);
      (app as any).handleKeyDown(makeKeyEvent('g', { ctrlKey: true }));
      expect(hideSpy).toHaveBeenCalled();
    });

    it('closes search and goto on Escape', () => {
      const gv = (app as any).gcodeViewer;
      const hideSearchSpy = vi.spyOn(gv, 'hideSearch');
      const hideGotoSpy = vi.spyOn(gv, 'hideGoto');
      vi.spyOn(gv, 'isSearchVisible').mockReturnValue(true);
      vi.spyOn(gv, 'isGotoVisible').mockReturnValue(true);
      (app as any).handleKeyDown(makeKeyEvent('Escape'));
      expect(hideSearchSpy).toHaveBeenCalled();
      expect(hideGotoSpy).toHaveBeenCalled();
    });

    it('toggles help overlay on ?', () => {
      (app as any).handleKeyDown(makeKeyEvent('?'));
      const helpOverlay = (app as any).helpOverlay;
      expect(helpOverlay).not.toBeNull();
      expect(helpOverlay.style.display).toBe('flex');
    });

    it('toggles help overlay on Shift+/', () => {
      (app as any).handleKeyDown(makeKeyEvent('/', { shiftKey: true }));
      const helpOverlay = (app as any).helpOverlay;
      expect(helpOverlay).not.toBeNull();
      expect(helpOverlay.style.display).toBe('flex');
    });

    it('hides help overlay on second ? press', () => {
      (app as any).handleKeyDown(makeKeyEvent('?'));
      (app as any).handleKeyDown(makeKeyEvent('?'));
      const helpOverlay = (app as any).helpOverlay;
      expect(helpOverlay.style.display).toBe('none');
    });

    it('does not process letter shortcuts when typing in an input', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const cp = (app as any).controlPanel;
      const emitSpy = vi.spyOn(cp, 'emit');
      (app as any).handleKeyDown(makeKeyEvent('r', { target: input }));
      // 'r' would emit resetView, but since target is input, it should be skipped
      expect(emitSpy).not.toHaveBeenCalledWith('resetView', undefined);
    });

    it('emits resetView on lowercase r', () => {
      const cp = (app as any).controlPanel;
      const emitSpy = vi.spyOn(cp, 'emit');
      (app as any).handleKeyDown(makeKeyEvent('r'));
      expect(emitSpy).toHaveBeenCalledWith('resetView', undefined);
    });

    it('emits exportImage on lowercase e', () => {
      const cp = (app as any).controlPanel;
      const emitSpy = vi.spyOn(cp, 'emit');
      (app as any).handleKeyDown(makeKeyEvent('e'));
      expect(emitSpy).toHaveBeenCalledWith('exportImage', undefined);
    });

    it('toggles playing state on Space', () => {
      const cp = (app as any).controlPanel;
      const setPlayingSpy = vi.spyOn(cp, 'setPlaying');
      const e = makeKeyEvent(' ');
      (app as any).handleKeyDown(e);
      expect((app as any).playing).toBe(true);
      expect(setPlayingSpy).toHaveBeenCalledWith(true);
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('toggles playing state off on second Space', () => {
      const cp = (app as any).controlPanel;
      vi.spyOn(cp, 'setPlaying');
      (app as any).handleKeyDown(makeKeyEvent(' '));
      (app as any).handleKeyDown(makeKeyEvent(' '));
      expect((app as any).playing).toBe(false);
    });

    it('clicks Grid button on lowercase g (without ctrl)', () => {
      // Add a Grid button to the bottom panel so the shortcut can find it
      const gridBtn = document.createElement('button');
      gridBtn.textContent = 'Grid';
      gridBtn.id = 'btn-grid';
      topPanel.appendChild(gridBtn);
      const clickSpy = vi.spyOn(gridBtn, 'click');
      (app as any).handleKeyDown(makeKeyEvent('g'));
      expect(clickSpy).toHaveBeenCalled();
    });

    it('clicks Travels button on lowercase t', () => {
      const travelsBtn = document.createElement('button');
      travelsBtn.textContent = 'Travels';
      topPanel.appendChild(travelsBtn);
      const clickSpy = vi.spyOn(travelsBtn, 'click');
      (app as any).handleKeyDown(makeKeyEvent('t'));
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // ── filterExtrudingLayers ───────────────────────────────────────────────

  describe('filterExtrudingLayers', () => {
    it('returns layers unchanged when no NBP data loaded', () => {
      const layers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 4, pieceCount: 5 },
      ];
      const result = (app as any).filterExtrudingLayers(layers);
      expect(result).toBe(layers);
    });

    it('returns layers unchanged when layers array is empty', () => {
      (app as any).currentNBP = makeNBPData(5);
      const result = (app as any).filterExtrudingLayers([]);
      expect(result).toEqual([]);
    });

    it('filters out travel-only layers (no extrusion, no motion)', () => {
      // 4 pieces: pieces 0-1 extrude, pieces 2-3 are travel-only
      (app as any).currentNBP = makeNBPData(4, {
        extruderSpeeds: [10, 10, 0, 0],
        motionTypes: [1, 1, 0, 0],
      });
      const layers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 1, pieceCount: 2 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 2, pieceEnd: 3, pieceCount: 2 },
      ];
      const result = (app as any).filterExtrudingLayers(layers);
      expect(result.length).toBe(1);
      expect(result[0].zHeight).toBe(0.2);
      // layerIndex re-numbered sequentially
      expect(result[0].layerIndex).toBe(0);
    });

    it('keeps layers with motionType > 0 even if extruderSpeed is 0', () => {
      (app as any).currentNBP = makeNBPData(2, {
        extruderSpeeds: [0, 0],
        motionTypes: [1, 0],
      });
      const layers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 0, pieceCount: 1 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 1, pieceEnd: 1, pieceCount: 1 },
      ];
      const result = (app as any).filterExtrudingLayers(layers);
      expect(result.length).toBe(1);
      expect(result[0].zHeight).toBe(0.2);
    });

    it('returns original layers if all are filtered out (fallback)', () => {
      (app as any).currentNBP = makeNBPData(2, {
        extruderSpeeds: [0, 0],
        motionTypes: [0, 0],
      });
      const layers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 0, pieceCount: 1 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 1, pieceEnd: 1, pieceCount: 1 },
      ];
      const result = (app as any).filterExtrudingLayers(layers);
      // All filtered out → fallback returns original layers
      expect(result).toBe(layers);
    });

    it('re-numbers layerIndex sequentially after filtering', () => {
      (app as any).currentNBP = makeNBPData(6, {
        extruderSpeeds: [10, 0, 10, 0, 10, 0],
        motionTypes: [1, 0, 1, 0, 1, 0],
      });
      const layers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 0, pieceCount: 1 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 1, pieceEnd: 1, pieceCount: 1 },
        { layerIndex: 2, zHeight: 0.6, pieceStart: 2, pieceEnd: 2, pieceCount: 1 },
        { layerIndex: 3, zHeight: 0.8, pieceStart: 3, pieceEnd: 3, pieceCount: 1 },
        { layerIndex: 4, zHeight: 1.0, pieceStart: 4, pieceEnd: 4, pieceCount: 1 },
        { layerIndex: 5, zHeight: 1.2, pieceStart: 5, pieceEnd: 5, pieceCount: 1 },
      ];
      const result = (app as any).filterExtrudingLayers(layers);
      expect(result.length).toBe(3);
      expect(result.map(l => l.layerIndex)).toEqual([0, 1, 2]);
      expect(result.map(l => l.zHeight)).toEqual([0.2, 0.6, 1.0]);
    });
  });

  // ── getCurrentBounds / getCurrentFullBounds ─────────────────────────────

  describe('getCurrentBounds', () => {
    it('returns null when no data loaded', () => {
      expect((app as any).getCurrentBounds()).toBeNull();
    });

    it('returns Z bounds from NBP data', () => {
      (app as any).currentNBP = makeNBPData(2, {
        boundsMin: [0, 0, 1],
        boundsMax: [10, 10, 21],
      });
      const bounds = (app as any).getCurrentBounds();
      expect(bounds).toEqual({ zMin: 1, zMax: 21 });
    });

    it('returns Z bounds from TTHR fullData when no NBP', () => {
      (app as any).fullData = makeTTHRData(5);
      const bounds = (app as any).getCurrentBounds();
      expect(bounds).toEqual({ zMin: 0, zMax: 10 });
    });
  });

  describe('getCurrentFullBounds', () => {
    it('returns null when no data loaded', () => {
      expect((app as any).getCurrentFullBounds()).toBeNull();
    });

    it('returns full bounds from NBP data (preferred)', () => {
      (app as any).currentNBP = makeNBPData(2, {
        boundsMin: [1, 2, 3],
        boundsMax: [11, 12, 13],
      });
      const bounds = (app as any).getCurrentFullBounds();
      expect(bounds).toEqual({ min: [1, 2, 3], max: [11, 12, 13] });
    });

    it('returns full bounds from fullData when no NBP', () => {
      (app as any).fullData = makeTTHRData(5);
      const bounds = (app as any).getCurrentFullBounds();
      expect(bounds).toEqual({ min: [0, 0, 0], max: [5, 5, 10] });
    });

    it('returns full bounds from currentData as last resort', () => {
      (app as any).currentData = makeTTHRData(3);
      const bounds = (app as any).getCurrentFullBounds();
      expect(bounds).toEqual({ min: [0, 0, 0], max: [3, 5, 10] });
    });
  });

  // ── applyLayerFilter ────────────────────────────────────────────────────

  describe('applyLayerFilter', () => {
    it('resets to full data when layerIdx is -1', () => {
      (app as any).currentNBP = makeNBPData(4);
      (app as any).fullData = makeTTHRData(10);
      (app as any).currentData = makeTTHRData(3);
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      const toolpathRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      const crossSectionRenderer = { updateData: vi.fn() };
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).toolpathRenderer = toolpathRenderer;
      (app as any).crossSectionRenderer = crossSectionRenderer;
      (app as any).applyLayerFilter(-1);
      expect(nurbsRenderer.updateData).toHaveBeenCalled();
      expect(toolpathRenderer.updateData).toHaveBeenCalled();
      // currentData should be reset to fullData
      expect((app as any).currentData).toBe((app as any).fullData);
    });

    it('filters NBP pieces to the selected layer range', () => {
      const nbp = makeNBPData(10);
      (app as any).currentNBP = nbp;
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 3, pieceCount: 4 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 4, pieceEnd: 7, pieceCount: 4 },
        { layerIndex: 2, zHeight: 0.6, pieceStart: 8, pieceEnd: 9, pieceCount: 2 },
      ];
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).applyLayerFilter(1);
      expect(nurbsRenderer.updateData).toHaveBeenCalledTimes(1);
      const filteredNBP = nurbsRenderer.updateData.mock.calls[0][0];
      expect(filteredNBP.pieces.length).toBe(4); // pieces 4-7
      expect(filteredNBP.header.pieceCount).toBe(4);
    });

    it('does nothing when layerIdx out of range and no fullData', () => {
      (app as any).currentNBP = makeNBPData(2);
      (app as any).zLayers = [];
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      // layerIdx 5 is out of range, no fullData → fallback returns early
      (app as any).applyLayerFilter(5);
      expect(nurbsRenderer.updateData).not.toHaveBeenCalled();
    });
  });

  // ── applyToolFilter ─────────────────────────────────────────────────────

  describe('applyToolFilter', () => {
    it('does nothing when no NBP data or metadata', () => {
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).applyToolFilter(1);
      expect(nurbsRenderer.updateData).not.toHaveBeenCalled();
    });

    it('resets to full data when toolNumber is -1', () => {
      (app as any).currentNBP = makeNBPData(4);
      (app as any).gcodeMetadata = { blockTools: new Map() };
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).applyToolFilter(-1);
      expect(nurbsRenderer.updateData).toHaveBeenCalledWith((app as any).currentNBP);
    });

    it('filters pieces to those matching the selected tool', () => {
      (app as any).currentNBP = makeNBPData(5);
      const blockTools = new Map<number, number>();
      blockTools.set(0, 1);
      blockTools.set(1, 1);
      blockTools.set(2, 2);
      blockTools.set(3, 2);
      blockTools.set(4, 1);
      (app as any).gcodeMetadata = { blockTools };
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).applyToolFilter(2);
      expect(nurbsRenderer.updateData).toHaveBeenCalledTimes(1);
      const filtered = nurbsRenderer.updateData.mock.calls[0][0];
      expect(filtered.pieces.length).toBe(2); // pieces 2 and 3
      expect(filtered.header.pieceCount).toBe(2);
    });

    it('sets status and does not update renderer when no pieces match', () => {
      (app as any).currentNBP = makeNBPData(2);
      (app as any).gcodeMetadata = { blockTools: new Map([[0, 1], [1, 1]]) };
      const nurbsRenderer = { updateData: vi.fn(), setProgress: vi.fn(), getPositionAt: vi.fn().mockReturnValue(null) };
      (app as any).nurbsRenderer = nurbsRenderer;
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      (app as any).applyToolFilter(99);
      expect(nurbsRenderer.updateData).not.toHaveBeenCalled();
      expect(setStatusSpy).toHaveBeenCalledWith('No pieces for T99');
    });
  });

  // ── autoUpdateLayer ─────────────────────────────────────────────────────

  describe('autoUpdateLayer', () => {
    it('does nothing when zLayers is empty', () => {
      const cp = (app as any).controlPanel;
      const setLayerValueSpy = vi.spyOn(cp, 'setLayerValue');
      (app as any).autoUpdateLayer(5);
      expect(setLayerValueSpy).not.toHaveBeenCalled();
    });

    it('selects the layer with largest zHeight <= currentZ', () => {
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 3, pieceCount: 4 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 4, pieceEnd: 7, pieceCount: 4 },
        { layerIndex: 2, zHeight: 0.6, pieceStart: 8, pieceEnd: 9, pieceCount: 2 },
      ];
      const cp = (app as any).controlPanel;
      const setLayerValueSpy = vi.spyOn(cp, 'setLayerValue');
      const applyLayerFilterSpy = vi.spyOn(app as any, 'applyLayerFilter');
      (app as any).lastAutoLayerIdx = -1;
      (app as any).autoUpdateLayer(0.5);
      // 0.4 is the largest zHeight <= 0.5 → layer 1
      expect(applyLayerFilterSpy).toHaveBeenCalledWith(1);
      expect(setLayerValueSpy).toHaveBeenCalledWith(1);
    });

    it('does not update when the same layer is selected again', () => {
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 3, pieceCount: 4 },
      ];
      const cp = (app as any).controlPanel;
      const setLayerValueSpy = vi.spyOn(cp, 'setLayerValue');
      (app as any).lastAutoLayerIdx = 0;
      (app as any).autoUpdateLayer(0.3);
      expect(setLayerValueSpy).not.toHaveBeenCalled();
    });

    it('sets bestIdx to -1 when currentZ is below all layers', () => {
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.5, pieceStart: 0, pieceEnd: 3, pieceCount: 4 },
      ];
      const cp = (app as any).controlPanel;
      const setLayerValueSpy = vi.spyOn(cp, 'setLayerValue');
      (app as any).lastAutoLayerIdx = -1;
      (app as any).autoUpdateLayer(0.1);
      // bestIdx is -1, so applyLayerFilter/setLayerValue not called
      expect(setLayerValueSpy).not.toHaveBeenCalled();
      expect((app as any).lastAutoLayerIdx).toBe(-1);
    });
  });

  // ── setViewDirection ────────────────────────────────────────────────────

  describe('setViewDirection', () => {
    it('orients camera to the front preset', () => {
      (app as any).currentNBP = makeNBPData(2, {
        boundsMin: [0, 0, 0],
        boundsMax: [10, 10, 10],
      });
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      (app as any).setViewDirection('front');
      // front preset: angle=0, elevation=0
      expect(setOrbitSpy).toHaveBeenCalledWith(0, 0, expect.any(Number));
    });

    it('orients camera to the top preset', () => {
      (app as any).currentNBP = makeNBPData(2);
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      (app as any).setViewDirection('top');
      // top preset: angle=0, elevation=89° in radians
      expect(setOrbitSpy).toHaveBeenCalled();
      const [, elev] = setOrbitSpy.mock.calls[0];
      expect(elev).toBeCloseTo(89 * Math.PI / 180, 2);
    });

    it('orients camera to the iso preset', () => {
      (app as any).currentNBP = makeNBPData(2);
      const cam: Camera = (app as any).camera;
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      (app as any).setViewDirection('iso');
      expect(setOrbitSpy).toHaveBeenCalled();
      const [angle, elev] = setOrbitSpy.mock.calls[0];
      expect(angle).toBeCloseTo(35 * Math.PI / 180, 2);
      expect(elev).toBeCloseTo(30 * Math.PI / 180, 2);
    });

    it('calls fitToBounds before orienting', () => {
      (app as any).currentNBP = makeNBPData(2, {
        boundsMin: [1, 2, 3],
        boundsMax: [11, 12, 13],
      });
      const cam: Camera = (app as any).camera;
      const fitSpy = vi.spyOn(cam, 'fitToBounds');
      (app as any).setViewDirection('right');
      expect(fitSpy).toHaveBeenCalledWith(
        { x: 1, y: 2, z: 3 },
        { x: 11, y: 12, z: 13 },
      );
    });

    it('still orients camera even with no bounds (no fitToBounds call)', () => {
      const cam: Camera = (app as any).camera;
      const fitSpy = vi.spyOn(cam, 'fitToBounds');
      const setOrbitSpy = vi.spyOn(cam, 'setOrbit');
      (app as any).setViewDirection('back');
      expect(fitSpy).not.toHaveBeenCalled();
      expect(setOrbitSpy).toHaveBeenCalled();
    });
  });

  // ── updateBBoxDisplay ───────────────────────────────────────────────────

  describe('updateBBoxDisplay', () => {
    it('does nothing when bboxEl is null', () => {
      (app as any).bboxEl = null;
      expect(() => (app as any).updateBBoxDisplay()).not.toThrow();
    });

    it('shows "No data loaded" when no data available', () => {
      const el = document.createElement('div');
      (app as any).bboxEl = el;
      (app as any).updateBBoxDisplay();
      expect(el.innerHTML).toContain('No data loaded');
    });

    it('displays bounding box dimensions from NBP data', () => {
      const el = document.createElement('div');
      (app as any).bboxEl = el;
      (app as any).currentNBP = makeNBPData(2, {
        boundsMin: [0, 0, 0],
        boundsMax: [10, 20, 30],
      });
      (app as any).updateBBoxDisplay();
      expect(el.innerHTML).toContain('Bounding Box');
      expect(el.innerHTML).toContain('0.0');
      expect(el.innerHTML).toContain('10.0');
      expect(el.innerHTML).toContain('20.0');
      expect(el.innerHTML).toContain('30.0');
    });

    it('displays bounding box dimensions from fullData', () => {
      const el = document.createElement('div');
      (app as any).bboxEl = el;
      (app as any).fullData = makeTTHRData(5);
      (app as any).updateBBoxDisplay();
      expect(el.innerHTML).toContain('Bounding Box');
    });
  });

  // ── updateLayerCountDisplay ─────────────────────────────────────────────

  describe('updateLayerCountDisplay', () => {
    it('does nothing when layerCountEl is null', () => {
      (app as any).layerCountEl = null;
      expect(() => (app as any).updateLayerCountDisplay()).not.toThrow();
    });

    it('shows "No layers loaded" when zLayers is empty', () => {
      const el = document.createElement('div');
      (app as any).layerCountEl = el;
      (app as any).updateLayerCountDisplay();
      expect(el.innerHTML).toContain('No layers loaded');
    });

    it('displays layer count, Z range, and avg pieces', () => {
      const el = document.createElement('div');
      (app as any).layerCountEl = el;
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.20, pieceStart: 0, pieceEnd: 4, pieceCount: 5 },
        { layerIndex: 1, zHeight: 0.40, pieceStart: 5, pieceEnd: 9, pieceCount: 5 },
        { layerIndex: 2, zHeight: 0.60, pieceStart: 10, pieceEnd: 14, pieceCount: 5 },
      ];
      (app as any).updateLayerCountDisplay();
      expect(el.innerHTML).toContain('Layer Info');
      expect(el.innerHTML).toContain('>3<');
      expect(el.innerHTML).toContain('0.20');
      expect(el.innerHTML).toContain('0.60');
      expect(el.innerHTML).toContain('5.0');
    });
  });

  // ── Help overlay ────────────────────────────────────────────────────────

  describe('help overlay', () => {
    it('showHelpOverlay creates and appends overlay element', () => {
      (app as any).showHelpOverlay();
      const overlay = (app as any).helpOverlay;
      expect(overlay).not.toBeNull();
      expect(overlay.className).toBe('help-overlay');
      expect(overlay.style.display).toBe('flex');
      expect(document.body.contains(overlay)).toBe(true);
      expect(overlay.innerHTML).toContain('Keyboard Shortcuts');
    });

    it('showHelpOverlay does not create duplicate on second call', () => {
      (app as any).showHelpOverlay();
      const first = (app as any).helpOverlay;
      (app as any).showHelpOverlay();
      expect((app as any).helpOverlay).toBe(first);
    });

    it('hideHelpOverlay sets display to none', () => {
      (app as any).showHelpOverlay();
      (app as any).hideHelpOverlay();
      expect((app as any).helpOverlay.style.display).toBe('none');
    });

    it('hideHelpOverlay is a no-op when overlay not created', () => {
      expect(() => (app as any).hideHelpOverlay()).not.toThrow();
    });

    it('toggleHelpOverlay shows then hides', () => {
      (app as any).toggleHelpOverlay();
      expect((app as any).helpOverlay.style.display).toBe('flex');
      (app as any).toggleHelpOverlay();
      expect((app as any).helpOverlay.style.display).toBe('none');
    });
  });

  // ── exportReport ────────────────────────────────────────────────────────

  describe('exportReport', () => {
    it('sets status to "No data loaded" when no metadata', () => {
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      (app as any).exportReport();
      expect(setStatusSpy).toHaveBeenCalledWith('No data loaded');
    });

    it('exports a JSON report when metadata is available', () => {
      (app as any).gcodeMetadata = {
        tools: [{ number: 1, name: 'T1' }],
        toolChanges: [],
        spindleEvents: [],
        temperatureEvents: [],
        fanEvents: [],
        coolantEvents: [],
        feedRateRange: { min: 100, max: 200 },
      };
      (app as any).currentNBP = makeNBPData(2);
      (app as any).zLayers = [];
      (app as any).totalDuration = 60;
      const gv = (app as any).gcodeViewer;
      vi.spyOn(gv, 'filename', 'get').mockReturnValue('test.gcode');
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      const clickSpy = vi.fn();
      const anchorEl = { click: clickSpy, href: '', download: '' } as unknown as HTMLAnchorElement;
      const createElSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchorEl);
      // jsdom doesn't implement URL.createObjectURL
      (URL as any).createObjectURL = vi.fn().mockReturnValue('blob:mock');
      (URL as any).revokeObjectURL = vi.fn();
      (app as any).exportReport();
      expect(clickSpy).toHaveBeenCalled();
      expect(setStatusSpy).toHaveBeenCalledWith('Report exported');
      createElSpy.mockRestore();
    });
  });

  // ── startStatsOnlyLoop ──────────────────────────────────────────────────

  describe('startStatsOnlyLoop', () => {
    it('starts a requestAnimationFrame loop and stores the id', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(42);
      (app as any).startStatsOnlyLoop();
      expect(rafSpy).toHaveBeenCalled();
      expect((app as any).statsLoopId).toBe(42);
      rafSpy.mockRestore();
    });
  });

  // ── destroy ─────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('cancels animation frame when animationId is set', () => {
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      (app as any).animationId = 99;
      (app as any).destroy();
      expect(cancelSpy).toHaveBeenCalledWith(99);
    });

    it('cancels stats loop when statsLoopId is set', () => {
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      (app as any).statsLoopId = 7;
      (app as any).destroy();
      expect(cancelSpy).toHaveBeenCalledWith(7);
      expect((app as any).statsLoopId).toBeNull();
    });

    it('disconnects resize observers', () => {
      const ro = { disconnect: vi.fn() };
      (app as any).resizeObserver = ro;
      (app as any).gizmoResizeObserver = ro;
      (app as any).dirCubeResizeObserver = ro;
      (app as any).destroy();
      expect(ro.disconnect).toHaveBeenCalledTimes(3);
      expect((app as any).resizeObserver).toBeNull();
    });

    it('removes dynamically created DOM elements', () => {
      const statsEl = document.createElement('div');
      const bboxEl = document.createElement('div');
      const layerCountEl = document.createElement('div');
      const helpOverlay = document.createElement('div');
      document.body.appendChild(statsEl);
      document.body.appendChild(bboxEl);
      document.body.appendChild(layerCountEl);
      document.body.appendChild(helpOverlay);
      (app as any).statsEl = statsEl;
      (app as any).bboxEl = bboxEl;
      (app as any).layerCountEl = layerCountEl;
      (app as any).helpOverlay = helpOverlay;
      (app as any).destroy();
      expect(document.body.contains(statsEl)).toBe(false);
      expect(document.body.contains(bboxEl)).toBe(false);
      expect(document.body.contains(layerCountEl)).toBe(false);
      expect(document.body.contains(helpOverlay)).toBe(false);
      expect((app as any).statsEl).toBeNull();
      expect((app as any).bboxEl).toBeNull();
    });

    it('destroys renderers when present', () => {
      const toolpathRenderer = { destroy: vi.fn() };
      const nurbsRenderer = { destroy: vi.fn() };
      const gridRenderer = { destroy: vi.fn() };
      (app as any).toolpathRenderer = toolpathRenderer;
      (app as any).nurbsRenderer = nurbsRenderer;
      (app as any).gridRenderer = gridRenderer;
      (app as any).destroy();
      expect(toolpathRenderer.destroy).toHaveBeenCalled();
      expect(nurbsRenderer.destroy).toHaveBeenCalled();
      expect(gridRenderer.destroy).toHaveBeenCalled();
    });

    it('increments depthReadbackGen to invalidate stale callbacks', () => {
      const before = (app as any).depthReadbackGen;
      (app as any).destroy();
      expect((app as any).depthReadbackGen).toBe(before + 1);
    });
  });

  // ── Bookmark toggle integration ─────────────────────────────────────────

  describe('bookmark toggle integration', () => {
    it('toggles a bookmark via gcodeViewer bookmarkToggled event', () => {
      (app as any).bookmarkManager = new BookmarkManager('test-file');
      const gv = (app as any).gcodeViewer;
      const refreshSpy = vi.spyOn(gv, 'refresh');
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      // Emit the bookmarkToggled event for line 5
      gv.emit('bookmarkToggled', 5);
      expect(setStatusSpy).toHaveBeenCalledWith('Bookmarked line 6');
      expect(refreshSpy).toHaveBeenCalled();
    });

    it('removes a bookmark on second toggle', () => {
      (app as any).bookmarkManager = new BookmarkManager('test-file2');
      const gv = (app as any).gcodeViewer;
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      gv.emit('bookmarkToggled', 3);
      expect(setStatusSpy).toHaveBeenCalledWith('Bookmarked line 4');
      gv.emit('bookmarkToggled', 3);
      expect(setStatusSpy).toHaveBeenCalledWith('Removed bookmark at line 4');
    });

    it('does nothing when bookmarkManager is null', () => {
      const gv = (app as any).gcodeViewer;
      const cp = (app as any).controlPanel;
      const setStatusSpy = vi.spyOn(cp, 'setStatus');
      (app as any).bookmarkManager = null;
      expect(() => gv.emit('bookmarkToggled', 1)).not.toThrow();
      expect(setStatusSpy).not.toHaveBeenCalled();
    });
  });

  // ── ControlPanel event wiring ───────────────────────────────────────────

  describe('controlPanel event wiring', () => {
    it('toggleTheme toggles lightTheme and document class', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleTheme', undefined);
      expect((app as any).lightTheme).toBe(true);
      expect(document.documentElement.classList.contains('light-theme')).toBe(true);
      cp.emit('toggleTheme', undefined);
      expect((app as any).lightTheme).toBe(false);
      expect(document.documentElement.classList.contains('light-theme')).toBe(false);
    });

    it('toggleStats creates and shows stats overlay element', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleStats', undefined);
      expect((app as any).showStats).toBe(true);
      expect((app as any).statsEl).not.toBeNull();
      expect((app as any).statsEl.style.display).toBe('block');
      expect((app as any).statsEl.className).toBe('stats-overlay');
    });

    it('toggleStats hides stats overlay on second toggle', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleStats', undefined);
      cp.emit('toggleStats', undefined);
      expect((app as any).showStats).toBe(false);
      expect((app as any).statsEl.style.display).toBe('none');
    });

    it('toggleBoundingBox creates and shows bbox overlay', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleBoundingBox', undefined);
      expect((app as any).showBBox).toBe(true);
      expect((app as any).bboxEl).not.toBeNull();
      expect((app as any).bboxEl.style.display).toBe('block');
    });

    it('toggleBoundingBox hides overlay on second toggle', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleBoundingBox', undefined);
      cp.emit('toggleBoundingBox', undefined);
      expect((app as any).showBBox).toBe(false);
      expect((app as any).bboxEl.style.display).toBe('none');
    });

    it('toggleLayerCount creates and shows layer count overlay', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleLayerCount', undefined);
      expect((app as any).showLayerCount).toBe(true);
      expect((app as any).layerCountEl).not.toBeNull();
      expect((app as any).layerCountEl.style.display).toBe('block');
    });

    it('toggleLayerCount hides overlay on second toggle', () => {
      const cp = (app as any).controlPanel;
      cp.emit('toggleLayerCount', undefined);
      cp.emit('toggleLayerCount', undefined);
      expect((app as any).showLayerCount).toBe(false);
      expect((app as any).layerCountEl.style.display).toBe('none');
    });

    it('printerModeChanged sets printerMode and resets lastAutoLayerIdx for simulation', () => {
      const cp = (app as any).controlPanel;
      (app as any).lastAutoLayerIdx = 3;
      cp.emit('printerModeChanged', 'simulation');
      expect((app as any).printerMode).toBe('simulation');
      expect((app as any).lastAutoLayerIdx).toBe(-1);
    });

    it('printerSpeedChanged sets printerSpeed', () => {
      const cp = (app as any).controlPanel;
      cp.emit('printerSpeedChanged', 5);
      expect((app as any).printerSpeed).toBe(5);
    });

    it('printerDirectionChanged sets printerDirection', () => {
      const cp = (app as any).controlPanel;
      cp.emit('printerDirectionChanged', 'backward');
      expect((app as any).printerDirection).toBe('backward');
    });

    it('returnToRealtime resets to realtime mode and forward direction', () => {
      const cp = (app as any).controlPanel;
      (app as any).printerMode = 'simulation';
      (app as any).printerDirection = 'backward';
      (app as any).lastAutoLayerIdx = 5;
      const setRealtimeSpy = vi.spyOn(cp, 'setRealtimeMode');
      cp.emit('returnToRealtime', undefined);
      expect((app as any).printerMode).toBe('realtime');
      expect((app as any).printerDirection).toBe('forward');
      expect((app as any).lastAutoLayerIdx).toBe(-1);
      expect(setRealtimeSpy).toHaveBeenCalled();
    });

    it('timeChanged sets playProgress and stops playing', () => {
      const cp = (app as any).controlPanel;
      (app as any).playing = true;
      const setPlayingSpy = vi.spyOn(cp, 'setPlaying');
      cp.emit('timeChanged', 0.5);
      expect((app as any).playProgress).toBe(0.5);
      expect((app as any).playing).toBe(false);
      expect(setPlayingSpy).toHaveBeenCalledWith(false);
    });

    it('playStateChanged resets progress to 0 when playing from end', () => {
      const cp = (app as any).controlPanel;
      (app as any).playProgress = 1.0;
      cp.emit('playStateChanged', true);
      expect((app as any).playing).toBe(true);
      expect((app as any).playProgress).toBe(0);
    });

    it('playStateChanged does not reset progress when not at end', () => {
      const cp = (app as any).controlPanel;
      (app as any).playProgress = 0.3;
      cp.emit('playStateChanged', true);
      expect((app as any).playProgress).toBe(0.3);
    });

    it('copyViewUrl writes URL to clipboard', async () => {
      const cp = (app as any).controlPanel;
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      cp.emit('copyViewUrl', undefined);
      expect(writeText).toHaveBeenCalled();
      const url = writeText.mock.calls[0][0];
      expect(url).toContain('cam=');
    });

    it('toggleComparison toggles comparisonPanel visibility', () => {
      const cp = (app as any).controlPanel;
      const comparisonPanel = { visible: false };
      (app as any).comparisonPanel = comparisonPanel;
      cp.emit('toggleComparison', undefined);
      expect(comparisonPanel.visible).toBe(true);
      cp.emit('toggleComparison', undefined);
      expect(comparisonPanel.visible).toBe(false);
    });
  });

  // ── NavigationCube event wiring ─────────────────────────────────────────

  describe('NavigationCube event wiring', () => {
    it('directionSelected triggers setViewDirection', () => {
      const navCube = (app as any).navCube;
      const setViewDirectionSpy = vi.spyOn(app as any, 'setViewDirection');
      navCube.emit('directionSelected', 'top');
      expect(setViewDirectionSpy).toHaveBeenCalledWith('top');
    });

    it('projectionChanged sets camera projection mode', () => {
      const navCube = (app as any).navCube;
      const cam: Camera = (app as any).camera;
      const setProjSpy = vi.spyOn(cam, 'setProjectionMode');
      navCube.emit('projectionChanged', 'orthographic');
      expect(setProjSpy).toHaveBeenCalledWith('orthographic');
    });
  });

  // ── updateCrossSection ──────────────────────────────────────────────────

  describe('updateCrossSection', () => {
    it('does nothing when crossSectionRenderer is null', () => {
      (app as any).crossSectionRenderer = null;
      expect(() => (app as any).updateCrossSection()).not.toThrow();
    });

    it('updates from NBP when currentNBP is available', () => {
      const cs = { updateFromNurbs: vi.fn(), updateData: vi.fn() };
      (app as any).crossSectionRenderer = cs;
      (app as any).currentNBP = makeNBPData(2);
      (app as any).updateCrossSection();
      expect(cs.updateFromNurbs).toHaveBeenCalled();
      expect(cs.updateData).not.toHaveBeenCalled();
    });

    it('updates from TTHR when only currentData is available', () => {
      const cs = { updateFromNurbs: vi.fn(), updateData: vi.fn() };
      (app as any).crossSectionRenderer = cs;
      (app as any).currentData = makeTTHRData(3);
      (app as any).updateCrossSection();
      expect(cs.updateData).toHaveBeenCalled();
      expect(cs.updateFromNurbs).not.toHaveBeenCalled();
    });
  });

  // ── isolateZLayerForLine ────────────────────────────────────────────────

  describe('isolateZLayerForLine', () => {
    it('switches to orthographic and top view', () => {
      const cam: Camera = (app as any).camera;
      const setProjSpy = vi.spyOn(cam, 'setProjectionMode');
      const setViewDirectionSpy = vi.spyOn(app as any, 'setViewDirection');
      (app as any).isolateZLayerForLine(0);
      expect(setProjSpy).toHaveBeenCalledWith('orthographic');
      expect(setViewDirectionSpy).toHaveBeenCalledWith('top');
    });

    it('applies layer filter when block found in NBP and layer range matches', () => {
      (app as any).currentNBP = {
        header: makeNBPData(10).header,
        pieces: makeNBPData(10).pieces,
        blocks: [
          { blockIndex: 5, lineNumber: 10, motionType: 1, gcodeText: 'G1' },
        ],
      };
      (app as any).zLayers = [
        { layerIndex: 0, zHeight: 0.2, pieceStart: 0, pieceEnd: 4, pieceCount: 5 },
        { layerIndex: 1, zHeight: 0.4, pieceStart: 5, pieceEnd: 9, pieceCount: 5 },
      ];
      const applyLayerFilterSpy = vi.spyOn(app as any, 'applyLayerFilter');
      const cp = (app as any).controlPanel;
      const setLayerValueSpy = vi.spyOn(cp, 'setLayerValue');
      (app as any).isolateZLayerForLine(10);
      expect(applyLayerFilterSpy).toHaveBeenCalledWith(1);
      expect(setLayerValueSpy).toHaveBeenCalledWith(1);
    });

    it('does nothing when block not found for the given line', () => {
      (app as any).currentNBP = {
        header: makeNBPData(2).header,
        pieces: makeNBPData(2).pieces,
        blocks: [{ blockIndex: 0, lineNumber: 5, motionType: 1, gcodeText: 'G1' }],
      };
      (app as any).zLayers = [];
      const applyLayerFilterSpy = vi.spyOn(app as any, 'applyLayerFilter');
      (app as any).isolateZLayerForLine(999);
      expect(applyLayerFilterSpy).not.toHaveBeenCalled();
    });
  });
});
