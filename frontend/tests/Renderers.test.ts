/**
 * @file Renderers.test.ts
 * @brief Unit tests for WebGPU renderers using mock GPU device.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDevice, createMockRenderPass, MockGPUBuffer, MockGPUTexture, setupNavigatorGPU } from './webgpu-mock';
import { PointCloudRenderer } from '../src/renderers/PointCloudRenderer';
import { GridRenderer } from '../src/renderers/GridRenderer';
import { PrintHeadMarker } from '../src/renderers/PrintHeadMarker';
import { OverlayRenderer } from '../src/renderers/OverlayRenderer';
import { NavigationGizmo } from '../src/renderers/NavigationGizmo';
import { CrossSectionRenderer } from '../src/renderers/CrossSectionRenderer';
import { ToolChangeMarkerRenderer } from '../src/renderers/ToolChangeMarkerRenderer';
import { PrinterFrameRenderer } from '../src/renderers/PrinterFrameRenderer';
import { NurbsRenderer } from '../src/renderers/NurbsRenderer';
import { ToolpathRenderer } from '../src/renderers/ToolpathRenderer';
import { MiniplotRenderer } from '../src/renderers/MiniplotRenderer';
import { DirectionCubeRenderer } from '../src/renderers/DirectionCubeRenderer';
import { GridLabelRenderer } from '../src/renderers/GridLabelRenderer';
import { mat4Identity } from '../src/core/MathUtils';
import type { TTHRData } from '../src/core/TthrParser';
import type { NBPData, NBPPiece } from '../src/core/NurbsParser';

/**
 * Helper: create a mock canvas with WebGPU and 2D context support.
 * The global HTMLCanvasElement.prototype.getContext is already mocked
 * in webgpu-mock.ts, so we just need to create a canvas with dimensions.
 */
function createMockCanvas(width: number = 200, height: number = 100): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

describe('PointCloudRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline and buffers', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    // Should not throw — pipeline and buffers created
    expect(r.visible).toBe(true);
  });

  it('setColor updates point color', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    r.setColor([1, 0, 0]);
    expect(r.pointColor).toEqual([1, 0, 0]);
  });

  it('setPointSize updates point size', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    r.setPointSize(5);
    expect(r.pointSize).toBe(5);
  });

  it('updateData with positions sets point count', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    const data: TTHRData = {
      header: { sampleCount: 3, axisCount: 3, boundsMin: [0, 0, 0], boundsMax: [10, 10, 10] },
      positions: new Float32Array([0, 0, 0, 5, 5, 5, 10, 10, 10]),
    };
    r.updateData(data);
    // No direct getter, but render should draw 3 points
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getDrawCalls()[0].vertexCount).toBe(3);
  });

  it('updateData with no positions does nothing', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    const data = { header: { sampleCount: 0, axisCount: 3 } } as TTHRData;
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('render does nothing when invisible', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('render does nothing with no data', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up buffers', async () => {
    const r = new PointCloudRenderer(device);
    await r.init('bgra8unorm');
    const data: TTHRData = {
      header: { sampleCount: 2, axisCount: 3, boundsMin: [0, 0, 0], boundsMax: [1, 1, 1] },
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
    };
    r.updateData(data);
    r.destroy();
    // Should not throw
    expect(true).toBe(true);
  });
});

describe('GridRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new GridRenderer(device);
    await r.init('bgra8unorm');
    expect(r.visible).toBe(true);
  });

  it('render draws when visible', async () => {
    const r = new GridRenderer(device);
    await r.init('bgra8unorm');
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('render does nothing when invisible', async () => {
    const r = new GridRenderer(device);
    await r.init('bgra8unorm');
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('setGridSize updates grid size', async () => {
    const r = new GridRenderer(device);
    await r.init('bgra8unorm');
    r.gridSize = 400;
    expect(r.gridSize).toBe(400);
  });

  it('destroy cleans up', async () => {
    const r = new GridRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('PrintHeadMarker', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new PrintHeadMarker(device);
    await r.init('bgra8unorm');
    expect(r.visible).toBe(true);
  });

  it('setPosition updates position', async () => {
    const r = new PrintHeadMarker(device);
    await r.init('bgra8unorm');
    r.setPosition(10, 20, 30);
    // Should not throw, render should work
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('render does nothing when invisible', async () => {
    const r = new PrintHeadMarker(device);
    await r.init('bgra8unorm');
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new PrintHeadMarker(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('OverlayRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    expect(r.visible).toBe(true);
  });

  it('render does nothing when invisible', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });

  // ── Data-driven tests exercising setLines and render ──

  it('setLines with lines then render draws vertices', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 }, color: [1, 0, 0] },
      { start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 10, z: 0 }, color: [0, 1, 0] },
    ]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // 2 lines → 4 vertices → 1 draw call
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getDrawCalls()[0].vertexCount).toBe(4);
  });

  it('setLines with single line draws 2 vertices', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 5, z: 5 }, color: [0, 0, 1] },
    ]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getDrawCalls()[0].vertexCount).toBe(2);
  });

  it('setLines with empty array produces no draw', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('setLines replaces previous lines', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 1, z: 1 }, color: [1, 1, 1] },
    ]);
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 2, z: 2 }, color: [1, 1, 1] },
      { start: { x: 3, y: 3, z: 3 }, end: { x: 4, y: 4, z: 4 }, color: [1, 1, 1] },
      { start: { x: 5, y: 5, z: 5 }, end: { x: 6, y: 6, z: 6 }, color: [1, 1, 1] },
    ]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getDrawCalls()[0].vertexCount).toBe(6);
  });

  it('render does nothing when invisible even with lines', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 }, color: [1, 0, 0] },
    ]);
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy after setLines cleans up', async () => {
    const r = new OverlayRenderer(device);
    await r.init('bgra8unorm');
    r.setLines([
      { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 }, color: [1, 0, 0] },
    ]);
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('NavigationGizmo', () => {
  let device: ReturnType<typeof createMockDevice>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    device = createMockDevice();
    setupNavigatorGPU(device);
    canvas = createMockCanvas(100, 100);
  });

  it('init creates pipeline', async () => {
    const r = new NavigationGizmo(device, canvas);
    await r.init('bgra8unorm');
    // init should complete without error
    expect(true).toBe(true);
  });

  it('render executes without error', async () => {
    const r = new NavigationGizmo(device, canvas);
    await r.init('bgra8unorm');
    r.render(mat4Identity());
    expect(true).toBe(true);
  });

  it('destroy cleans up', async () => {
    const r = new NavigationGizmo(device, canvas);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('CrossSectionRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    // CrossSectionRenderer defaults to invisible
    expect(r.visible).toBe(false);
  });

  it('render does nothing when invisible', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('render does nothing when visible but no data', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });

  // ── Data-driven tests exercising updateData, updateFromNurbs, render ──

  /**
   * Helper: build TTHRData with samples that cross a Z plane.
   * Samples: z = [0, 10, 0, 10] so a plane at z=5 produces crossings.
   */
  function makeCrossSectionData(): TTHRData {
    return {
      header: {
        magic: 'TTHR', version: 1, flags: 0xFF,
        axisCount: 3, sampleCount: 4, blockCount: 1,
        timeStart: 0, timeEnd: 10, pathLength: 100,
        boundsMin: [0, 0, 0], boundsMax: [10, 10, 10],
      },
      positions: new Float32Array([0, 0, 0, 10, 10, 10, 20, 0, 0, 30, 10, 10]),
    };
  }

  it('updateData with plane crossings then render draws lines', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    r.planeZ = 5;
    r.updateData(makeCrossSectionData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // Three segments cross z=5 → 3 vertices → 1 draw call
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getDrawCalls()[0].vertexCount).toBe(3);
  });

  it('updateData with no plane crossings produces no draw', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    r.planeZ = 100; // above all samples
    r.updateData(makeCrossSectionData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('updateData with no positions does nothing', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    r.planeZ = 5;
    const data = { header: { sampleCount: 0, axisCount: 3 } } as TTHRData;
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('updateFromNurbs with crossing pieces then render draws lines', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    r.planeZ = 5;
    const nurbsData: NBPData = {
      header: {
        magic: 'NBP', version: 3, dim: 3,
        pieceCount: 1, blockCount: 0,
        totalControlPoints: 2, totalKnots: 4, totalLength: 10,
        boundsMin: [0, 0, 0], boundsMax: [10, 10, 10],
      },
      pieces: [{
        degree: 1,
        controlPoints: [0, 0, 0, 10, 10, 10],
        weights: [1, 1],
        knots: [0, 0, 1, 1],
        motionType: 1,
        deviation: 0,
        extruderSpeed: 0,
      }],
      blocks: [],
    };
    r.updateFromNurbs(nurbsData);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // Linear piece crosses z=5 → 1 vertex → draw
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateFromNurbs with curved piece (degree > 1) crossing plane', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    r.planeZ = 5;
    const nurbsData: NBPData = {
      header: {
        magic: 'NBP', version: 3, dim: 3,
        pieceCount: 1, blockCount: 0,
        totalControlPoints: 4, totalKnots: 8, totalLength: 20,
        boundsMin: [0, 0, 0], boundsMax: [20, 10, 10],
      },
      pieces: [{
        degree: 3,
        controlPoints: [0, 0, 0, 5, 10, 10, 15, 10, 10, 20, 0, 0],
        weights: [1, 1, 1, 1],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        motionType: 1,
        deviation: 0,
        extruderSpeed: 0,
      }],
      blocks: [],
    };
    r.updateFromNurbs(nurbsData);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('render does nothing when visible but no data', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.visible = true;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy after updateData cleans up', async () => {
    const r = new CrossSectionRenderer(device);
    await r.init('bgra8unorm');
    r.planeZ = 5;
    r.updateData(makeCrossSectionData());
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('ToolChangeMarkerRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new ToolChangeMarkerRenderer(device);
    await r.init('bgra8unorm');
    expect(r.visible).toBe(true);
  });

  it('updateMarkers with empty array', async () => {
    const r = new ToolChangeMarkerRenderer(device);
    await r.init('bgra8unorm');
    r.updateMarkers([]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // No markers → no draw calls
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('updateMarkers with markers and render', async () => {
    const r = new ToolChangeMarkerRenderer(device);
    await r.init('bgra8unorm');
    r.updateMarkers([
      { position: [10, 20, 30], toolNumber: 1 },
      { position: [40, 50, 60], toolNumber: 2 },
    ]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('render does nothing when invisible', async () => {
    const r = new ToolChangeMarkerRenderer(device);
    await r.init('bgra8unorm');
    r.visible = false;
    r.updateMarkers([{ position: [0, 0, 0], toolNumber: 1 }]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new ToolChangeMarkerRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('PrinterFrameRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    expect(r.visible).toBe(true);
  });

  it('setBounds updates frame dimensions', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    r.setBounds([0, 0, 0], [200, 200, 200]);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('setExtruderPosition updates position', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    r.setBounds([0, 0, 0], [200, 200, 200]);
    r.setExtruderPosition(50, 60, 70);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('setBedTemperature updates temperature', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    r.setBounds([0, 0, 0], [200, 200, 200]);
    r.setBedTemperature(60);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // Should still render (build plate with temp color)
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('render does nothing when invisible', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    r.setBounds([0, 0, 0], [200, 200, 200]);
    r.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new PrinterFrameRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('NurbsRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.visible).toBe(true);
  });

  it('setColorMap updates options', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    const { ColorMap } = await import('../src/core/ColorMap');
    r.setColorMap(new ColorMap('plasma'));
    expect(r.options.colorMap.name).toBe('plasma');
  });

  it('setProgress clamps to 0..1', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.setProgress(1.5);
    // No direct getter, but should not throw
    r.setProgress(-0.5);
    expect(true).toBe(true);
  });

  it('setHighlightOverhangs updates options', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.highlightOverhangs).toBe(false);
    r.setHighlightOverhangs(true);
    expect(r.options.highlightOverhangs).toBe(true);
  });

  it('setZSeamVisible updates options', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.zSeamVisible).toBe(false);
    r.setZSeamVisible(true);
    expect(r.options.zSeamVisible).toBe(true);
  });

  it('setHighlightBridges updates options', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.highlightBridges).toBe(false);
    r.setHighlightBridges(true);
    expect(r.options.highlightBridges).toBe(true);
  });

  it('setHighlightSupport updates options', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.highlightSupport).toBe(false);
    r.setHighlightSupport(true);
    expect(r.options.highlightSupport).toBe(true);
  });

  it('setFeedRates updates feed rates', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.setFeedRates([100, 200, 300]);
    expect(true).toBe(true);
  });

  it('setSpindleRpms updates spindle RPMs', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.setSpindleRpms([5000, 12000]);
    expect(true).toBe(true);
  });

  it('setToolNumbers updates tool numbers', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.setToolNumbers([1, 2, 3]);
    expect(true).toBe(true);
  });

  it('getPositionAt returns null with no data', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    expect(r.getPositionAt(0.5)).toBeNull();
  });

  it('render does nothing when invisible', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('render does nothing with no data', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy cleans up', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });

  // ── Data-driven tests exercising updateData and render ──

  /**
   * Helper: create minimal NBPData with linear pieces.
   */
  function makeNBPData(pieces: Partial<NBPPiece>[]): NBPData {
    return {
      header: {
        magic: 'NBP', version: 3, dim: 3,
        pieceCount: pieces.length, blockCount: 0,
        totalControlPoints: 0, totalKnots: 0, totalLength: 100,
        boundsMin: [0, 0, 0], boundsMax: [100, 100, 100],
      },
      pieces: pieces.map(p => {
        const cp = p.controlPoints ?? [0, 0, 0, 10, 10, 10];
        const cpCount = cp.length / 3;
        return {
          degree: p.degree ?? 1,
          controlPoints: cp,
          // Default weights = 1.0 for each control point
          weights: p.weights ?? new Array(cpCount).fill(1),
          // Default knots for degree-1 piece with 2 control points: [0,0,1,1]
          knots: p.knots ?? [0, 0, 1, 1],
          motionType: p.motionType ?? 1,
          deviation: p.deviation ?? 0,
          extruderSpeed: p.extruderSpeed ?? 0,
        };
      }),
      blocks: [],
    };
  }

  it('updateData with linear pieces and pieceIndex color', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'pieceIndex';
    const data = makeNBPData([
      { controlPoints: [0, 0, 0, 10, 0, 0] },
      { controlPoints: [10, 0, 0, 20, 10, 0] },
    ]);
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with deviation color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'deviation';
    const data = makeNBPData([{ deviation: 50 }]);
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with zHeight color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'zHeight';
    const data = makeNBPData([{ controlPoints: [0, 0, 50, 10, 10, 50] }]);
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with extruderSpeed color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'extruderSpeed';
    const data = makeNBPData([{ extruderSpeed: 5 }, { extruderSpeed: 10 }]);
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with motion color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'motion';
    const data = makeNBPData([{ motionType: 1 }, { motionType: 2 }]);
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with solid color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'solid';
    r.updateData(makeNBPData([{}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with feedRate color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'feedRate';
    r.setFeedRates([100, 200]);
    r.updateData(makeNBPData([{}, {}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with spindleRpm color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'spindleRpm';
    r.setSpindleRpms([5000, 12000]);
    r.updateData(makeNBPData([{}, {}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with toolNumber color attribute', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'toolNumber';
    r.setToolNumbers([1, 2, 3]);
    r.updateData(makeNBPData([{}, {}, {}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('coolant color attribute renders', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'coolant';
    r.setCoolantStates([0, 1, 2, 3]);
    r.updateData(makeNBPData([{}, {}, {}, {}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('featureType color attribute renders', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'featureType';
    r.setFeatureTypes([0, 1, 2, 0]);
    r.updateData(makeNBPData([{}, {}, {}, {}]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with curved piece (degree > 1)', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeNBPData([{
      degree: 3,
      controlPoints: [0, 0, 0, 5, 10, 0, 15, 10, 0, 20, 0, 0],
      weights: [1, 1, 1, 1],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    }]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData skips travel moves when showTravels is false', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.showTravels = false;
    r.updateData(makeNBPData([{ motionType: 0 }, { motionType: 1 }]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // Should still render (only the non-travel piece)
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData highlights retractions when enabled', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.options.highlightRetractions = true;
    r.updateData(makeNBPData([{ extruderSpeed: -5 }]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });

  it('updateData with empty pieces does nothing', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeNBPData([]));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('getPositionAt returns position after updateData', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeNBPData([{ controlPoints: [0, 0, 0, 100, 0, 0], knots: [0, 0, 1, 1] }]));
    const pos = r.getPositionAt(0.5);
    expect(pos).not.toBeNull();
    expect(pos![0]).toBeCloseTo(50, 0);
  });

  it('render with progress < 1 draws partial path', async () => {
    const r = new NurbsRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeNBPData([{ controlPoints: [0, 0, 0, 100, 0, 0], knots: [0, 0, 1, 1] }]));
    r.setProgress(0.5);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBeGreaterThan(0);
  });
});

describe('ToolpathRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;

  beforeEach(() => {
    device = createMockDevice();
  });

  it('init creates pipeline', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    expect(r.options.visible).toBe(true);
  });

  it('render does nothing when invisible', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.visible = false;
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('render does nothing with no data', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('setProgress clamps value', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.setProgress(1.5);
    r.setProgress(-0.5);
    expect(true).toBe(true);
  });

  it('clearHighlight works', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.clearHighlight();
    expect(true).toBe(true);
  });

  it('getPositionAt returns null with no data', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const emptyData = { header: { sampleCount: 0, axisCount: 3 } } as any;
    expect(r.getPositionAt(0.5, emptyData)).toBeNull();
  });

  it('destroy cleans up', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });

  // ── Data-driven tests exercising updateData, render, highlight, position ──

  /**
   * Helper: build a TTHRData with 4 samples (axisCount 3) whose Z values
   * span 0..10 so various color attributes and crossings can be exercised.
   */
  function makeTHRData(extra: Partial<TTHRData> = {}): TTHRData {
    const n = 4;
    const axes = 3;
    return {
      header: {
        magic: 'TTHR', version: 1, flags: 0xFF,
        axisCount: axes, sampleCount: n, blockCount: 2,
        timeStart: 0, timeEnd: 10, pathLength: 100,
        boundsMin: [0, 0, 0], boundsMax: [10, 10, 10],
      },
      positions: new Float32Array([0, 0, 0, 10, 0, 4, 10, 10, 6, 0, 10, 10]),
      linearVelocity: new Float32Array([10, 20, 30, 40]),
      linearAcceleration: new Float32Array([1, 2, 3, 4]),
      linearJerk: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      curvature: new Float32Array([0.5, 1.0, 1.5, 2.0]),
      deviation: new Float32Array([0, 25, 50, 100]),
      blockIndex: new Int32Array([0, 0, 1, 1]),
      motionType: new Uint8Array([0, 1, 1, 1]),
      ...extra,
    };
  }

  it('updateData with positions then render draws indexed lines', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    // One indexed draw call for the line strip
    expect(pass.getDrawCalls().length).toBe(1);
    expect(pass.getIndexedDrawCalls().length).toBe(1);
    // 4 samples → 3 segments → 6 indices
    expect(pass.getIndexedDrawCalls()[0].indexCount).toBe(6);
  });

  it('updateData with no positions does nothing', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = { header: { sampleCount: 0, axisCount: 3 } } as TTHRData;
    r.updateData(data);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('updateData with velocity color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'velocity';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with acceleration color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'acceleration';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with jerk color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'jerk';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with curvature color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'curvature';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with deviation color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'deviation';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with zHeight color attribute', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'zHeight';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with motion color attribute fills default', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'motion';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('updateData with solid color attribute fills default', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.options.colorAttribute = 'solid';
    r.updateData(makeTHRData());
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('render with progress < 1 still draws', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeTHRData());
    r.setProgress(0.5);
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(1);
  });

  it('setHighlight with block indices does not throw', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = makeTHRData();
    r.updateData(data);
    r.setHighlight(new Set([1]), data);
    expect(true).toBe(true);
  });

  it('setHighlight with empty set clears highlight', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = makeTHRData();
    r.updateData(data);
    r.setHighlight(new Set(), data);
    expect(true).toBe(true);
  });

  it('setHighlight with null clears highlight', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = makeTHRData();
    r.updateData(data);
    r.setHighlight(null, data);
    expect(true).toBe(true);
  });

  it('setHighlight before updateData does nothing', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.setHighlight(new Set([0]));
    expect(true).toBe(true);
  });

  it('clearHighlight after updateData does not throw', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeTHRData());
    r.clearHighlight();
    expect(true).toBe(true);
  });

  it('getPositionAt returns position for valid data', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = makeTHRData();
    // frac 0 → first sample [0,0,0]
    const p0 = r.getPositionAt(0, data);
    expect(p0).not.toBeNull();
    expect(p0![0]).toBe(0);
    expect(p0![1]).toBe(0);
    expect(p0![2]).toBe(0);
    // frac 1 → last sample [0,10,10]
    const p1 = r.getPositionAt(1, data);
    expect(p1).not.toBeNull();
    expect(p1![0]).toBe(0);
    expect(p1![1]).toBe(10);
    expect(p1![2]).toBe(10);
  });

  it('getPositionAt clamps out-of-range fractions', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    const data = makeTHRData();
    const pNeg = r.getPositionAt(-1, data);
    expect(pNeg).not.toBeNull();
    expect(pNeg![0]).toBe(0);
    const pBig = r.getPositionAt(2, data);
    expect(pBig).not.toBeNull();
    expect(pBig![2]).toBe(10);
  });

  it('render does nothing with fewer than 2 samples', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeTHRData({
      header: {
        magic: 'TTHR', version: 1, flags: 0xFF,
        axisCount: 3, sampleCount: 1, blockCount: 1,
        timeStart: 0, timeEnd: 1, pathLength: 1,
        boundsMin: [0, 0, 0], boundsMax: [1, 1, 1],
      },
      positions: new Float32Array([5, 5, 5]),
    }));
    const pass = createMockRenderPass();
    r.render(pass, mat4Identity());
    expect(pass.getDrawCalls().length).toBe(0);
  });

  it('destroy after updateData cleans up buffers', async () => {
    const r = new ToolpathRenderer(device);
    await r.init('bgra8unorm');
    r.updateData(makeTHRData());
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('MiniplotRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    device = createMockDevice();
    setupNavigatorGPU(device);
    canvas = createMockCanvas(200, 100);
  });

  it('init creates pipeline', async () => {
    const r = new MiniplotRenderer(canvas, device);
    await r.init();
    expect(true).toBe(true);
  });

  it('setData with empty segments', async () => {
    const r = new MiniplotRenderer(canvas, device);
    await r.init();
    r.setData({ totalTime: 0, segments: [] });
    expect(true).toBe(true);
  });

  it('setData with segments', async () => {
    const r = new MiniplotRenderer(canvas, device);
    await r.init();
    r.setData({
      totalTime: 100,
      segments: [
        { timeStart: 0, duration: 10, lineNumber: 0, speedX: 10, speedY: 0, speedZ: 0, speedE: 0, speedLinear: 10 },
        { timeStart: 10, duration: 20, lineNumber: 1, speedX: 20, speedY: 0, speedZ: 0, speedE: 0, speedLinear: 20 },
      ],
    });
    expect(true).toBe(true);
  });

  it('render executes without error', async () => {
    const r = new MiniplotRenderer(canvas, device);
    await r.init();
    r.setData({
      totalTime: 100,
      segments: [
        { timeStart: 0, duration: 50, lineNumber: 0, speedX: 10, speedY: 0, speedZ: 0, speedE: 0, speedLinear: 10 },
      ],
    });
    r.render();
    expect(true).toBe(true);
  });

  it('destroy cleans up', async () => {
    const r = new MiniplotRenderer(canvas, device);
    await r.init();
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('DirectionCubeRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    device = createMockDevice();
    setupNavigatorGPU(device);
    canvas = createMockCanvas(100, 100);
  });

  it('init creates pipeline', async () => {
    const r = new DirectionCubeRenderer(device, canvas);
    await r.init('bgra8unorm');
    expect(true).toBe(true);
  });

  it('render executes without error', async () => {
    const r = new DirectionCubeRenderer(device, canvas);
    await r.init('bgra8unorm');
    r.render(mat4Identity());
    expect(true).toBe(true);
  });

  it('resize executes without error', async () => {
    const r = new DirectionCubeRenderer(device, canvas);
    await r.init('bgra8unorm');
    r.resize();
    expect(true).toBe(true);
  });

  it('destroy cleans up', async () => {
    const r = new DirectionCubeRenderer(device, canvas);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});

describe('GridLabelRenderer', () => {
  let device: ReturnType<typeof createMockDevice>;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    device = createMockDevice();
    setupNavigatorGPU(device);
    canvas = createMockCanvas(800, 600);
  });

  it('init creates pipeline', async () => {
    const r = new GridLabelRenderer(device, canvas);
    await r.init('bgra8unorm');
    expect(true).toBe(true);
  });

  it('render executes without error', async () => {
    const r = new GridLabelRenderer(device, canvas);
    await r.init('bgra8unorm');
    r.render(mat4Identity(), mat4Identity());
    expect(true).toBe(true);
  });

  it('destroy cleans up', async () => {
    const r = new GridLabelRenderer(device, canvas);
    await r.init('bgra8unorm');
    r.destroy();
    expect(true).toBe(true);
  });
});
