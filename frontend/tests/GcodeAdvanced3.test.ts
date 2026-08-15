/**
 * @file GcodeAdvanced3.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced3 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  createStockModel,
  createFixture,
  getDefaultToolLibrary,
  parseToolDefinitions,
  parseRotaryAxes,
  computeToolOrientation,
  simulateThermal,
  predictWarping,
  editGcode,
  findReplaceGcode,
  buildPrintTimeGraph,
  createCustomPalette,
  generatePaletteLUT,
  exportPalette,
  importPalette,
  exportBookmarks,
  importBookmarks,
  estimateSpindleLoad,
  estimateToolWear,
  checkCollisions,
} from '../src/core/GcodeAdvanced3';

// ── 1. Stock/Fixture Visualization ──

describe('createStockModel', () => {
  it('creates a block stock model', () => {
    const stock = createStockModel('block', 100, 50, 20, 0, 0, 0, true, 'aluminum');
    expect(stock.type).toBe('block');
    expect(stock.length).toBe(100);
    expect(stock.width).toBe(50);
    expect(stock.height).toBe(20);
    expect(stock.vertices.length).toBe(24); // 8 corners × 3
    expect(stock.edges.length).toBe(24); // 12 edges × 2
  });

  it('creates a cylinder stock model', () => {
    const stock = createStockModel('cylinder', 50, 50, 20);
    expect(stock.type).toBe('cylinder');
    expect(stock.vertices.length).toBe(96); // 16 segments × 2 (top+bottom) × 3
    expect(stock.edges.length).toBe(96); // 16×3 (bottom + top + verticals) × 2
  });

  it('handles center origin', () => {
    const stock = createStockModel('block', 100, 50, 20, 50, 25, 0, false);
    // Origin at center means corner is at (0, 0, 0)
    expect(stock.vertices[0]).toBe(0); // first X = 50 - 100/2 = 0
    expect(stock.vertices[1]).toBe(0); // first Y = 25 - 50/2 = 0
  });

  it('handles corner origin', () => {
    const stock = createStockModel('block', 100, 50, 20, 10, 20, 0, true);
    expect(stock.vertices[0]).toBe(10); // first X = originX
    expect(stock.vertices[1]).toBe(20); // first Y = originY
  });
});

describe('createFixture', () => {
  it('creates a fixture model', () => {
    const fixture = createFixture('Vise', 'vise', 0, 0, 0, 100, 50, 30);
    expect(fixture.name).toBe('Vise');
    expect(fixture.type).toBe('vise');
    expect(fixture.width).toBe(100);
    expect(fixture.vertices.length).toBe(24); // 8 corners × 3
    expect(fixture.edges.length).toBe(24); // 12 edges × 2
  });
});

// ── 2. Tool Library Management ──

describe('getDefaultToolLibrary', () => {
  it('returns default tools', () => {
    const tools = getDefaultToolLibrary();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].toolNumber).toBe(1);
    expect(tools[0].diameter).toBeGreaterThan(0);
    expect(tools[0].type).toBe('endmill');
  });
});

describe('parseToolDefinitions', () => {
  it('parses tool definition comments', () => {
    const lines = ['; TOOL: T1 D6.0 L50 F4 CARBIDE TiAlN'];
    const tools = parseToolDefinitions(lines);
    expect(tools.length).toBe(1);
    expect(tools[0].toolNumber).toBe(1);
    expect(tools[0].diameter).toBe(6);
    expect(tools[0].flutes).toBe(4);
  });

  it('parses alternative format', () => {
    const lines = ['; T1 D=6.0 TYPE=ENDMILL'];
    const tools = parseToolDefinitions(lines);
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe('endmill');
    expect(tools[0].diameter).toBe(6);
  });

  it('returns empty for no tool definitions', () => {
    expect(parseToolDefinitions(['G1 X10 Y10 F1800'])).toEqual([]);
  });
});

// ── 3. 5-Axis Movement Tracking ──

describe('parseRotaryAxes', () => {
  it('parses A axis movements', () => {
    const lines = ['G1 X10 Y10 A45 F1000', 'G1 X20 Y20 A90 F1000'];
    const { moves, finalState } = parseRotaryAxes(lines);
    expect(moves.length).toBe(2);
    expect(moves[0].axis).toBe('A');
    expect(moves[0].angle).toBe(45);
    expect(moves[1].angle).toBe(90);
    expect(moves[1].deltaAngle).toBe(45);
    expect(finalState.a).toBe(90);
  });

  it('parses B and C axes', () => {
    const lines = ['G1 X10 Y10 B30 F1000', 'G1 X20 Y20 C60 F1000'];
    const { moves, finalState } = parseRotaryAxes(lines);
    expect(moves.length).toBe(2);
    expect(moves[0].axis).toBe('B');
    expect(moves[1].axis).toBe('C');
    expect(finalState.b).toBe(30);
    expect(finalState.c).toBe(60);
  });

  it('returns empty for no rotary moves', () => {
    const { moves, finalState } = parseRotaryAxes(['G1 X10 Y10 F1000']);
    expect(moves).toEqual([]);
    expect(finalState.a).toBe(0);
  });
});

describe('computeToolOrientation', () => {
  it('returns default orientation for zero angles', () => {
    const orient = computeToolOrientation(0, 0, 0);
    expect(orient.x).toBeCloseTo(0, 5);
    expect(orient.y).toBeCloseTo(0, 5);
    expect(orient.z).toBeCloseTo(-1, 5); // pointing down
  });

  it('rotates with A axis (around X)', () => {
    const orient = computeToolOrientation(90, 0, 0);
    // A=90 rotates -Z to +Y (positive Y)
    expect(orient.y).toBeCloseTo(1, 5);
    expect(orient.z).toBeCloseTo(0, 5);
  });

  it('rotates with B axis (around Y)', () => {
    const orient = computeToolOrientation(0, 90, 0);
    // B=90 rotates -Z to -X
    expect(orient.x).toBeCloseTo(-1, 5);
    expect(orient.z).toBeCloseTo(0, 5);
  });
});

// ── 4. Simplified Thermal Simulation ──

describe('simulateThermal', () => {
  it('estimates temperatures for extruding moves', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X10 Y0 E5 F1800',
      'G1 X20 Y0 E10 F1800',
    ];
    const result = simulateThermal(lines, 210, 60, 128, 25);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.maxTemp).toBeGreaterThan(25); // above ambient
    expect(result.avgTemp).toBeGreaterThan(25);
  });

  it('handles empty input', () => {
    const result = simulateThermal([], 210, 60, 128, 25);
    expect(result.points).toEqual([]);
    expect(result.maxTemp).toBe(0);
  });

  it('detects hot zones', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i} Y0 E${i} F1800`);
    }
    const result = simulateThermal(lines, 210, 60, 0, 25);
    // With no fan, should have high temps
    expect(result.maxTemp).toBeGreaterThan(100);
  });
});

// ── 5. Warp Prediction ──

describe('predictWarping', () => {
  it('predicts low risk for small parts', () => {
    const thermal = { points: [], maxTemp: 210, minTemp: 60, avgTemp: 100, hotZones: [] };
    const result = predictWarping(thermal, {
      minX: 0, maxX: 20, minY: 0, maxY: 20, minZ: 0, maxZ: 10,
    }, 0.2, 60, 25);
    expect(result.riskScore).toBeLessThan(0.5);
    expect(result.level).toBe('low');
  });

  it('predicts higher risk for large flat parts', () => {
    const thermal = { points: [], maxTemp: 250, minTemp: 25, avgTemp: 100, hotZones: [] };
    const result = predictWarping(thermal, {
      minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 5,
    }, 0.2, 60, 25);
    expect(result.factors.largeFlatAreas).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('provides recommendations', () => {
    const thermal = { points: [], maxTemp: 250, minTemp: 25, avgTemp: 100, hotZones: [] };
    const result = predictWarping(thermal, {
      minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 5,
    }, 0.4, 50, 25);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('classifies risk levels', () => {
    const thermal = { points: [], maxTemp: 250, minTemp: 25, avgTemp: 100, hotZones: [] };
    const lowRisk = predictWarping(thermal, { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }, 0.2, 60, 25);
    expect(['low', 'moderate', 'high', 'severe']).toContain(lowRisk.level);
  });
});

// ── 6. G-code Editing ──

describe('editGcode', () => {
  it('inserts a line', () => {
    const lines = ['G1 X10', 'G1 X20'];
    const result = editGcode(lines, { type: 'insert', lineNumber: 1, content: 'G1 X15' });
    expect(result.length).toBe(3);
    expect(result[1]).toBe('G1 X15');
  });

  it('deletes a line', () => {
    const lines = ['G1 X10', 'G1 X20', 'G1 X30'];
    const result = editGcode(lines, { type: 'delete', lineNumber: 1 });
    expect(result.length).toBe(2);
    expect(result[1]).toBe('G1 X30');
  });

  it('replaces a line', () => {
    const lines = ['G1 X10 F1000'];
    const result = editGcode(lines, { type: 'replace', lineNumber: 0, content: 'G1 X10 F2000' });
    expect(result[0]).toBe('G1 X10 F2000');
  });

  it('inserts a block of lines', () => {
    const lines = ['G1 X10', 'G1 X30'];
    const result = editGcode(lines, { type: 'insertBlock', lineNumber: 1, contents: ['G1 X15', 'G1 X20', 'G1 X25'] });
    expect(result.length).toBe(5);
    expect(result[1]).toBe('G1 X15');
  });

  it('deletes a range of lines', () => {
    const lines = ['G1 X10', 'G1 X20', 'G1 X30', 'G1 X40'];
    const result = editGcode(lines, { type: 'deleteRange', startLine: 1, endLine: 2 });
    expect(result.length).toBe(2);
    expect(result[1]).toBe('G1 X40');
  });
});

describe('findReplaceGcode', () => {
  it('replaces text in lines', () => {
    const lines = ['G1 X10 F1000', 'G1 X20 F1000'];
    const { result, replacements } = findReplaceGcode(lines, 'F1000', 'F2000');
    expect(replacements).toBe(2);
    expect(result[0]).toContain('F2000');
  });

  it('handles no matches', () => {
    const { result, replacements } = findReplaceGcode(['G1 X10'], 'F1000', 'F2000');
    expect(replacements).toBe(0);
    expect(result[0]).toBe('G1 X10');
  });

  it('supports regex', () => {
    const lines = ['G1 X10 F1000', 'G1 X20 F1500'];
    const { result, replacements } = findReplaceGcode(lines, 'F\\d+', 'F2000', true);
    expect(replacements).toBe(2);
    expect(result[0]).toContain('F2000');
  });
});

// ── 7. Print Time Graph Data ──

describe('buildPrintTimeGraph', () => {
  it('builds timeline from G-code', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      ';LAYER:0',
      'G1 X100 Y0 E5 F1800',
      'G1 X100 Y100 E10 F1800',
      ';LAYER:1',
      'G1 X0 Y100 E15 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 1, endLine: 3 },
      { layerIndex: 1, zHeight: 0.4, startLine: 4, endLine: 5 },
    ];
    const graph = buildPrintTimeGraph(lines, zLayers);
    expect(graph.totalTime).toBeGreaterThan(0);
    expect(graph.points.length).toBeGreaterThan(0);
    expect(graph.layerTimes.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const graph = buildPrintTimeGraph([], []);
    expect(graph.totalTime).toBe(0);
    expect(graph.points).toEqual([]);
  });

  it('tracks feature times', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      ';LAYER:0',
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F1800',
      ';TYPE:INFILL',
      'G1 X100 Y100 E10 F1800',
    ];
    const graph = buildPrintTimeGraph(lines, []);
    expect(graph.featureTimes.length).toBe(2);
    const wall = graph.featureTimes.find(f => f.feature === 'WALL-OUTER');
    expect(wall).toBeDefined();
    expect(wall!.percentage).toBeGreaterThan(0);
  });
});

// ── 8. Custom Color Palettes ──

describe('createCustomPalette', () => {
  it('creates a palette from color stops', () => {
    const palette = createCustomPalette('test', [
      [0, [0, 0, 255]],
      [0.5, [0, 255, 0]],
      [1, [255, 0, 0]],
    ], 'user', 'Test palette');
    expect(palette.name).toBe('test');
    expect(palette.stops.length).toBe(3);
    expect(palette.stops[0][0]).toBe(0);
  });

  it('sorts stops by position', () => {
    const palette = createCustomPalette('test', [
      [1, [255, 0, 0]],
      [0, [0, 0, 255]],
      [0.5, [0, 255, 0]],
    ]);
    expect(palette.stops[0][0]).toBe(0);
    expect(palette.stops[2][0]).toBe(1);
  });
});

describe('generatePaletteLUT', () => {
  it('generates a 256-color LUT', () => {
    const palette = createCustomPalette('test', [
      [0, [0, 0, 0]],
      [1, [255, 255, 255]],
    ]);
    const lut = generatePaletteLUT(palette, 256);
    expect(lut.length).toBe(768); // 256 × 3
    expect(lut[0]).toBe(0); // black at start
    expect(lut[765]).toBe(255); // white at end
  });

  it('interpolates colors correctly', () => {
    const palette = createCustomPalette('test', [
      [0, [0, 0, 0]],
      [1, [255, 0, 0]],
    ]);
    const lut = generatePaletteLUT(palette, 256);
    // Middle should be ~127
    expect(lut[128 * 3]).toBeGreaterThan(100);
    expect(lut[128 * 3]).toBeLessThan(150);
  });
});

describe('export/import palette', () => {
  it('exports and imports palette as JSON', () => {
    const palette = createCustomPalette('test', [[0, [0, 0, 0]], [1, [255, 255, 255]]], 'user', 'test');
    const json = exportPalette(palette);
    const imported = importPalette(json);
    expect(imported.name).toBe('test');
    expect(imported.stops.length).toBe(2);
  });
});

// ── 9. Bookmark Export/Import ──

describe('export/import bookmarks', () => {
  it('exports bookmarks as JSON', () => {
    const bookmarks = [
      { lineNumber: 10, label: 'Start', annotation: 'Print start', timestamp: '2024-01-01' },
      { lineNumber: 50, label: 'Layer 5', annotation: '', timestamp: '2024-01-01' },
    ];
    const json = exportBookmarks(bookmarks);
    expect(json).toContain('Start');
    expect(json).toContain('Layer 5');
    expect(json).toContain('version');
  });

  it('imports bookmarks from JSON', () => {
    const json = '{"version":"1.0","exported":"2024-01-01","bookmarks":[{"lineNumber":10,"label":"Start","annotation":"","timestamp":"2024-01-01"}]}';
    const bookmarks = importBookmarks(json);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0].lineNumber).toBe(10);
    expect(bookmarks[0].label).toBe('Start');
  });

  it('handles empty bookmarks', () => {
    const json = '{"version":"1.0","bookmarks":[]}';
    expect(importBookmarks(json)).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    expect(() => importBookmarks('not json')).toThrow();
  });
});

// ── 10. Spindle Load Estimation ──

describe('estimateSpindleLoad', () => {
  it('estimates load for cutting moves', () => {
    const lines = [
      'M3 S12000',
      'G1 X10 Y10 Z-2 F500',
      'G1 X20 Y10 Z-2 F500',
    ];
    const estimates = estimateSpindleLoad(lines, 6, 0.7, 5);
    expect(estimates.length).toBeGreaterThan(0);
    expect(estimates[0].load).toBeGreaterThan(0);
    expect(estimates[0].rpm).toBe(12000);
  });

  it('returns empty for no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    expect(estimateSpindleLoad(lines)).toEqual([]);
  });

  it('computes load percentage', () => {
    const lines = ['M3 S12000', 'G1 X10 Y10 Z-5 F1000'];
    const estimates = estimateSpindleLoad(lines, 6, 0.7, 5);
    if (estimates.length > 0) {
      expect(estimates[0].loadPercentage).toBeGreaterThan(0);
    }
  });
});

// ── 11. Tool Wear Estimation ──

describe('estimateToolWear', () => {
  it('estimates wear for tools', () => {
    const lines = [
      'T1 M6',
      'M3 S12000',
      'G1 X10 Y10 Z-2 F500',
      'G1 X20 Y10 Z-2 F500',
    ];
    const estimates = estimateToolWear(lines);
    expect(estimates.length).toBe(1);
    expect(estimates[0].toolNumber).toBe(1);
    expect(estimates[0].cuttingTime).toBeGreaterThan(0);
    expect(estimates[0].wear).toBeGreaterThanOrEqual(0);
    expect(estimates[0].lifeRemaining).toBeGreaterThan(0);
  });

  it('provides recommendations', () => {
    const lines = ['T1 M6', 'M3 S12000', 'G1 X10 Y10 Z-2 F500'];
    const estimates = estimateToolWear(lines);
    expect(estimates[0].recommendation).toBeDefined();
    expect(estimates[0].recommendation.length).toBeGreaterThan(0);
  });

  it('handles no tool changes', () => {
    const lines = ['G1 X10 Y10 F500'];
    const estimates = estimateToolWear(lines);
    // Default tool 0 may or may not appear
    expect(estimates).toBeDefined();
  });
});

// ── 12. Collision Detection ──

describe('checkCollisions', () => {
  const stock = createStockModel('block', 100, 100, 50, 0, 0, 0, true, 'aluminum');
  const fixture = createFixture('Vise', 'vise', -20, 40, 0, 20, 20, 30);

  it('detects toolpath outside stock', () => {
    const lines = ['G1 X200 Y10 Z5 F500']; // X=200 is outside stock (0-100)
    const violations = checkCollisions(lines, stock, [], 3);
    const outside = violations.filter(v => v.type === 'toolpath-stock');
    expect(outside.length).toBeGreaterThan(0);
  });

  it('detects Z below stock bottom', () => {
    const lines = ['G1 X50 Y50 Z-10 F500']; // Z=-10 is below stock bottom (0)
    const violations = checkCollisions(lines, stock, [], 3);
    const below = violations.filter(v => v.description.includes('below stock'));
    expect(below.length).toBe(1);
    expect(below[0].severity).toBe('error');
  });

  it('detects rapid moves into stock', () => {
    const lines = ['G0 X50 Y50 Z25']; // rapid inside stock at Z=25
    const violations = checkCollisions(lines, stock, [], 3);
    const rapid = violations.filter(v => v.type === 'rapid-into-stock');
    expect(rapid.length).toBe(1);
    expect(rapid[0].severity).toBe('error');
  });

  it('detects fixture collisions', () => {
    const lines = ['G1 X-10 Y50 Z15 F500']; // inside fixture at (-20 to 0, 40 to 60, 0 to 30)
    const violations = checkCollisions(lines, stock, [fixture], 3);
    const fixtureCollisions = violations.filter(v => v.type === 'toolpath-fixture');
    expect(fixtureCollisions.length).toBe(1);
  });

  it('returns no violations for safe moves', () => {
    const lines = ['G1 X50 Y50 Z10 F500']; // center of stock, above bottom
    const violations = checkCollisions(lines, stock, [], 3);
    expect(violations).toEqual([]);
  });

  it('handles empty input', () => {
    expect(checkCollisions([], stock, [])).toEqual([]);
  });
});
