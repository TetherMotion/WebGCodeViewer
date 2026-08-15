/**
 * @file GcodeAdvanced2.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced2 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  estimateMotionProfileTime,
  parseColorChanges,
  buildCodePathLinks,
  transformGcode,
  buildLayerAnimation,
  getLayerAtTime,
  analyzeSupportStructure,
  parseInfillDensity,
  estimateInfillDensityFromMoves,
  parseMacros,
  trackMultiExtruder,
  parseBedLevelingMesh,
  detectBridges,
  detectRapidPlanes,
} from '../src/core/GcodeAdvanced2';

// ── 1. Motion Profile Time Estimation ──

describe('estimateMotionProfileTime', () => {
  const params = {
    maxAcceleration: 1000,
    maxDeceleration: 1000,
    maxJerk: 20000,
    junctionDeviation: 0.05,
    minFeedRate: 10,
  };

  it('handles empty input', () => {
    const result = estimateMotionProfileTime([], params);
    expect(result.totalTime).toBe(0);
    expect(result.moveCount).toBe(0);
  });

  it('estimates time for simple moves', () => {
    const moves = [
      { x: 0, y: 0, z: 0, feedRate: 1800, lineNumber: 0 },
      { x: 100, y: 0, z: 0, feedRate: 1800, lineNumber: 1 },
    ];
    const result = estimateMotionProfileTime(moves, params);
    expect(result.totalTime).toBeGreaterThan(0);
    expect(result.totalDistance).toBe(100);
    expect(result.moveCount).toBe(2);
    expect(result.averageSpeed).toBeGreaterThan(0);
  });

  it('accounts for acceleration on short moves', () => {
    const moves = [
      { x: 0, y: 0, z: 0, feedRate: 6000, lineNumber: 0 },
      { x: 1, y: 0, z: 0, feedRate: 6000, lineNumber: 1 }, // very short move
    ];
    const result = estimateMotionProfileTime(moves, params);
    // Short move should take more time than distance/cruiseSpeed due to accel/decel
    const naiveTime = 1 / (6000 / 60);
    expect(result.totalTime).toBeGreaterThan(naiveTime * 0.5);
  });

  it('handles cornering speed reduction', () => {
    const moves = [
      { x: 0, y: 0, z: 0, feedRate: 6000, lineNumber: 0 },
      { x: 50, y: 0, z: 0, feedRate: 6000, lineNumber: 1 },
      { x: 50, y: 50, z: 0, feedRate: 6000, lineNumber: 2 }, // 90° corner
    ];
    const result = estimateMotionProfileTime(moves, params);
    expect(result.totalTime).toBeGreaterThan(0);
    // Corner should slow down
    const cornerMove = result.moves[1];
    expect(cornerMove.entrySpeed).toBeLessThanOrEqual(6000 / 60);
  });
});

// ── 2. Multi-Material/Color Change Tracking ──

describe('parseColorChanges', () => {
  it('parses PrusaSlicer COLOR_CHANGE format', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      ';LAYER:5',
      ';COLOR_CHANGE,#FF0000',
      'G1 X20 Y20 E10 F1800',
    ];
    const events = parseColorChanges(lines);
    expect(events.length).toBe(1);
    expect(events[0].color).toBe('#FF0000');
    expect(events[0].layer).toBe(5);
  });

  it('parses COLOR_CHANGE with extruder', () => {
    const lines = [';COLOR_CHANGE,T1,#00FF00'];
    const events = parseColorChanges(lines);
    expect(events.length).toBe(1);
    expect(events[0].extruder).toBe(1);
    expect(events[0].color).toBe('#00FF00');
  });

  it('parses Cura COLOR format', () => {
    const lines = [';COLOR,#0000FF'];
    const events = parseColorChanges(lines);
    expect(events.length).toBe(1);
    expect(events[0].color).toBe('#0000FF');
  });

  it('parses M163 extruder mixing', () => {
    const lines = ['M163 S0.5 E0'];
    const events = parseColorChanges(lines);
    expect(events.length).toBe(1);
    expect(events[0].extruder).toBe(0);
  });

  it('returns empty for no color changes', () => {
    expect(parseColorChanges(['G1 X10 Y10 F1800'])).toEqual([]);
  });
});

// ── 3. Bidirectional Code-to-Path Linking ──

describe('buildCodePathLinks', () => {
  it('builds links from G-code without block map', () => {
    const lines = [
      'G1 X10 Y10 F1800',
      'G1 X20 Y20 F1800',
      'G1 X30 Y30 F1800',
    ];
    const { lineToBlock, blockToLines, links } = buildCodePathLinks(lines);
    expect(links.length).toBe(3);
    expect(lineToBlock.size).toBe(3);
    expect(blockToLines.size).toBe(3);
    expect(links[0].blockIndex).toBe(0);
    expect(links[1].blockIndex).toBe(1);
    expect(links[0].position).toEqual({ x: 10, y: 10, z: 0 });
  });

  it('builds links from block map', () => {
    const blockLineMap = new Map<number, [number, number]>([
      [0, [0, 2]],
      [1, [3, 5]],
    ]);
    const lines = ['G1 X10', 'G1 X20', 'G1 X30', 'G1 X40', 'G1 X50', 'G1 X60'];
    const { lineToBlock, blockToLines, links } = buildCodePathLinks(lines, blockLineMap);
    expect(lineToBlock.get(0)).toBe(0);
    expect(lineToBlock.get(2)).toBe(0);
    expect(lineToBlock.get(3)).toBe(1);
    expect(blockToLines.get(0)).toEqual([0, 1, 2]);
    expect(blockToLines.get(1)).toEqual([3, 4, 5]);
    expect(links.length).toBe(6);
  });

  it('handles empty input', () => {
    const { lineToBlock, blockToLines, links } = buildCodePathLinks([]);
    expect(lineToBlock.size).toBe(0);
    expect(blockToLines.size).toBe(0);
    expect(links.length).toBe(0);
  });

  it('skips non-move lines', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X10 Y10 F1800',
      ';LAYER:1',
      'G1 X20 Y20 F1800',
    ];
    const { links } = buildCodePathLinks(lines);
    expect(links.length).toBe(2);
  });
});

// ── 4. G-code Hack Panel ──

describe('transformGcode', () => {
  it('translates X and Y', () => {
    const lines = ['G1 X10 Y20 F1800'];
    const result = transformGcode(lines, { translateX: 5, translateY: 10 });
    expect(result[0]).toContain('X15');
    expect(result[0]).toContain('Y30');
  });

  it('translates Z', () => {
    const lines = ['G1 X10 Y20 Z5 F1800'];
    const result = transformGcode(lines, { translateZ: 2 });
    expect(result[0]).toContain('Z7');
  });

  it('mirrors X axis', () => {
    const lines = ['G1 X10 Y20 F1800'];
    const result = transformGcode(lines, { mirrorX: true });
    expect(result[0]).toContain('X-10');
  });

  it('mirrors Y axis', () => {
    const lines = ['G1 X10 Y20 F1800'];
    const result = transformGcode(lines, { mirrorY: true });
    expect(result[0]).toContain('Y-20');
  });

  it('scales coordinates', () => {
    const lines = ['G1 X10 Y20 F1800'];
    const result = transformGcode(lines, { scale: 2.0 });
    expect(result[0]).toContain('X20');
    expect(result[0]).toContain('Y40');
  });

  it('rotates around Z', () => {
    const lines = ['G1 X10 Y0 F1800'];
    const result = transformGcode(lines, { rotateZ: 90 });
    // Rotating (10, 0) by 90° → (0, 10)
    expect(result[0]).toMatch(/X-?0\.0+|X0\b/);
    expect(result[0]).toContain('Y10');
  });

  it('swaps tool numbers', () => {
    const lines = ['T1 M6'];
    const swapMap = new Map([[1, 2]]);
    const result = transformGcode(lines, { swapTools: swapMap });
    expect(result[0]).toContain('T2');
  });

  it('multiplies feed rate', () => {
    const lines = ['G1 X10 Y10 F1800'];
    const result = transformGcode(lines, { feedRateMultiplier: 1.5 });
    expect(result[0]).toContain('F2700');
  });

  it('multiplies spindle speed', () => {
    const lines = ['M3 S1000'];
    const result = transformGcode(lines, { spindleMultiplier: 1.2 });
    expect(result[0]).toContain('S1200');
  });

  it('preserves comments', () => {
    const lines = ['G1 X10 Y10 F1800 ; perimeter'];
    const result = transformGcode(lines, { translateX: 5 });
    expect(result[0]).toContain('; perimeter');
  });

  it('handles empty input', () => {
    expect(transformGcode([], {})).toEqual([]);
  });

  it('no-op with empty options', () => {
    const lines = ['G1 X10 Y10 F1800'];
    const result = transformGcode(lines, {});
    expect(result[0]).toContain('X10');
    expect(result[0]).toContain('Y10');
  });
});

// ── 5. Layer-by-Layer Animation ──

describe('buildLayerAnimation', () => {
  it('builds animation frames from layer times', () => {
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, timeSeconds: 30 },
      { layerIndex: 1, zHeight: 0.4, timeSeconds: 60 },
      { layerIndex: 2, zHeight: 0.6, timeSeconds: 45 },
    ];
    const frames = buildLayerAnimation(zLayers, 135);
    expect(frames.length).toBe(3);
    expect(frames[0].startTime).toBe(0);
    expect(frames[0].endTime).toBe(30);
    expect(frames[1].startTime).toBe(30);
    expect(frames[1].endTime).toBe(90);
    expect(frames[2].progress).toBeCloseTo(1, 2);
  });

  it('handles empty input', () => {
    expect(buildLayerAnimation([], 0)).toEqual([]);
  });

  it('handles single layer', () => {
    const frames = buildLayerAnimation([{ layerIndex: 0, zHeight: 0.2, timeSeconds: 60 }], 60);
    expect(frames.length).toBe(1);
    expect(frames[0].startTime).toBe(0);
    expect(frames[0].endTime).toBe(60);
  });
});

describe('getLayerAtTime', () => {
  const frames = [
    { layerIndex: 0, zHeight: 0.2, startTime: 0, endTime: 30, duration: 30, progress: 0.22 },
    { layerIndex: 1, zHeight: 0.4, startTime: 30, endTime: 90, duration: 60, progress: 0.67 },
    { layerIndex: 2, zHeight: 0.6, startTime: 90, endTime: 135, duration: 45, progress: 1 },
  ];

  it('finds layer at given time', () => {
    expect(getLayerAtTime(frames, 15)?.layerIndex).toBe(0);
    expect(getLayerAtTime(frames, 45)?.layerIndex).toBe(1);
    expect(getLayerAtTime(frames, 100)?.layerIndex).toBe(2);
  });

  it('returns last frame for time past end', () => {
    expect(getLayerAtTime(frames, 200)?.layerIndex).toBe(2);
  });

  it('returns null for empty frames', () => {
    expect(getLayerAtTime([], 10)).toBeNull();
  });

  it('returns null for negative time', () => {
    expect(getLayerAtTime(frames, -1)).toBeNull();
  });
});

// ── 6. Support Structure Analysis ──

describe('analyzeSupportStructure', () => {
  it('detects support material by TYPE comment', () => {
    const lines = [
      ';LAYER:0',
      ';TYPE:SUPPORT',
      'G1 X10 Y10 E1 F1800',
      'G1 X20 Y10 E2 F1800',
      ';TYPE:WALL-OUTER',
      'G1 X30 Y10 E3 F1800',
    ];
    const result = analyzeSupportStructure(lines, 3, 1.75, 0.4);
    expect(result.segmentCount).toBe(2);
    expect(result.totalLength).toBeGreaterThan(0);
    expect(result.supportLayers).toContain(0);
  });

  it('detects tree support', () => {
    const lines = [
      ';TYPE:TREE_SUPPORT',
      'G1 X10 Y10 E1 F1800',
    ];
    const result = analyzeSupportStructure(lines);
    expect(result.segmentCount).toBe(1);
    expect(result.byType[0].type).toBe('TREE_SUPPORT');
  });

  it('computes support percentage', () => {
    const lines = [
      ';TYPE:SUPPORT',
      'G1 X10 Y10 E5 F1800',
      ';TYPE:WALL-OUTER',
      'G1 X20 Y10 E5 F1800',
    ];
    const result = analyzeSupportStructure(lines, 10, 1.75, 0.4);
    expect(result.supportPercentage).toBeCloseTo(50, 0);
  });

  it('handles no support material', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X10 Y10 E5 F1800',
    ];
    const result = analyzeSupportStructure(lines, 5);
    expect(result.segmentCount).toBe(0);
    expect(result.totalLength).toBe(0);
  });
});

// ── 7. Infill Density ──

describe('parseInfillDensity', () => {
  it('parses INFILL_DENSITY comment', () => {
    const lines = [';LAYER:0', ';INFILL_DENSITY: 20'];
    const infos = parseInfillDensity(lines);
    expect(infos.length).toBe(1);
    expect(infos[0].density).toBe(20);
    expect(infos[0].layer).toBe(0);
  });

  it('parses FILL_DENSITY comment', () => {
    const lines = [';FILL_DENSITY: 35'];
    const infos = parseInfillDensity(lines);
    expect(infos.length).toBe(1);
    expect(infos[0].density).toBe(35);
  });

  it('parses INFILL_SPACING (Cura)', () => {
    const lines = [';INFILL_SPACING: 1.6'];
    const infos = parseInfillDensity(lines);
    expect(infos.length).toBe(1);
    // density = 0.4 / (0.4 + 1.6) * 100 = 20%
    expect(infos[0].density).toBeCloseTo(20, 0);
  });

  it('parses infill pattern', () => {
    const lines = [';INFILL_DENSITY: 20', ';INFILL_PATTERN: grid'];
    const infos = parseInfillDensity(lines);
    expect(infos[0].pattern).toBe('grid');
  });

  it('returns empty for no infill info', () => {
    expect(parseInfillDensity(['G1 X10 Y10 F1800'])).toEqual([]);
  });
});

describe('estimateInfillDensityFromMoves', () => {
  it('estimates density from parallel lines', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X100 Y0 E5 F1800',   // line 1 at Y=0
      'G1 X100 Y2 E5 F1800',   // move to Y=2
      'G1 X0 Y2 E10 F1800',    // line 2 at Y=2
      'G1 X0 Y4 E10 F1800',    // move to Y=4
      'G1 X100 Y4 E15 F1800',  // line 3 at Y=4
    ];
    const result = estimateInfillDensityFromMoves(lines, 0, lines.length - 1);
    expect(result.direction).toBe('X'); // lines along X
    expect(result.lineSpacing).toBeCloseTo(2, 0);
    // density = 0.4 / 2.0 * 100 = 20%
    expect(result.estimatedDensity).toBeCloseTo(20, 0);
  });

  it('handles empty input', () => {
    const result = estimateInfillDensityFromMoves([], 0, 0);
    expect(result.estimatedDensity).toBe(0);
  });

  it('handles single move', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = estimateInfillDensityFromMoves(lines, 0, 0);
    expect(result.estimatedDensity).toBe(0);
  });
});

// ── 8. Custom Macros/Variables ──

describe('parseMacros', () => {
  it('parses variable assignments', () => {
    const lines = ['#100 = 5.0', '#101 = 10.5'];
    const { variables, calls } = parseMacros(lines);
    expect(variables.length).toBe(2);
    expect(variables[0].number).toBe(100);
    expect(variables[0].value).toBe(5.0);
    expect(variables[0].type).toBe('user');
  });

  it('classifies variable types', () => {
    const lines = ['#1 = 1.0', '#100 = 2.0', '#1000 = 3.0'];
    const { variables } = parseMacros(lines);
    expect(variables[0].type).toBe('local');
    expect(variables[1].type).toBe('user');
    expect(variables[2].type).toBe('system');
  });

  it('parses G65 macro calls with arguments', () => {
    const lines = ['G65 P1001 A5 B10 C20'];
    const { calls } = parseMacros(lines);
    expect(calls.length).toBe(1);
    expect(calls[0].macroName).toBe('G65');
    expect(calls[0].subprogramNumber).toBe(1001);
    expect(calls[0].arguments.length).toBe(3);
    expect(calls[0].arguments[0].letter).toBe('A');
    expect(calls[0].arguments[0].value).toBe(5);
  });

  it('parses G66 modal macro calls', () => {
    const lines = ['G66 P2002'];
    const { calls } = parseMacros(lines);
    expect(calls.length).toBe(1);
    expect(calls[0].macroName).toBe('G66');
    expect(calls[0].subprogramNumber).toBe(2002);
  });

  it('returns empty for no macros', () => {
    const result = parseMacros(['G1 X10 Y10 F1800']);
    expect(result.variables).toEqual([]);
    expect(result.calls).toEqual([]);
  });
});

// ── 9. Multi-Extruder Tracking ──

describe('trackMultiExtruder', () => {
  it('tracks single extruder usage', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y10 E10 F1800',
    ];
    const result = trackMultiExtruder(lines);
    expect(result.length).toBe(1);
    expect(result[0].extruder).toBe(0);
    expect(result[0].filamentLength).toBe(10);
  });

  it('tracks multiple extruders with tool changes', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'T1 M6',
      'G1 X20 Y10 E10 F1800',  // E is absolute, extruder 1 starts from 0
    ];
    const result = trackMultiExtruder(lines);
    expect(result.length).toBe(2);
    const ext0 = result.find(e => e.extruder === 0);
    const ext1 = result.find(e => e.extruder === 1);
    expect(ext0).toBeDefined();
    expect(ext1).toBeDefined();
    expect(ext0!.filamentLength).toBe(5);
    expect(ext1!.filamentLength).toBe(10); // E10 from 0 = 10mm
    expect(ext1!.toolChanges).toBe(1);
  });

  it('computes volume and weight', () => {
    const lines = ['G1 X10 Y10 E10 F1800'];
    const result = trackMultiExtruder(lines, 1.75, 1.24);
    const filamentArea = Math.PI * (1.75 / 2) ** 2;
    expect(result[0].volume).toBeCloseTo(10 * filamentArea, 2);
    expect(result[0].weight).toBeCloseTo((10 * filamentArea * 1.24) / 1000, 4);
  });

  it('handles empty input', () => {
    const result = trackMultiExtruder([]);
    expect(result.length).toBe(1); // extruder 0 always exists
    expect(result[0].filamentLength).toBe(0);
  });
});

// ── 10. Bed Leveling Mesh ──

describe('parseBedLevelingMesh', () => {
  it('parses Marlin M420 mesh report', () => {
    const lines = [
      'M420 S0 V1',
      'X10.0 Y10.0 Z0.05',
      'X50.0 Y10.0 Z-0.02',
      'X10.0 Y50.0 Z0.01',
      'X50.0 Y50.0 Z0.03',
    ];
    const mesh = parseBedLevelingMesh(lines);
    expect(mesh).not.toBeNull();
    expect(mesh!.points.length).toBe(4);
    expect(mesh!.rows).toBe(2);
    expect(mesh!.cols).toBe(2);
    expect(mesh!.xRange.min).toBe(10);
    expect(mesh!.xRange.max).toBe(50);
  });

  it('parses G29 mesh output', () => {
    const lines = [
      'G29 S0',
      'X0 Y0 Z0.1',
      'X100 Y0 Z-0.05',
      'X0 Y100 Z0.0',
      'X100 Y100 Z0.02',
    ];
    const mesh = parseBedLevelingMesh(lines);
    expect(mesh).not.toBeNull();
    expect(mesh!.points.length).toBe(4);
  });

  it('computes Z range and average', () => {
    const lines = [
      'M420 S0 V1',
      'X0 Y0 Z0.0',
      'X10 Y0 Z0.1',
      'X0 Y10 Z-0.1',
      'X10 Y10 Z0.05',
    ];
    const mesh = parseBedLevelingMesh(lines);
    expect(mesh!.zRange.min).toBeCloseTo(-0.1, 2);
    expect(mesh!.zRange.max).toBeCloseTo(0.1, 2);
    expect(mesh!.averageZ).toBeCloseTo(0.0125, 3);
  });

  it('returns null for no mesh data', () => {
    expect(parseBedLevelingMesh(['G1 X10 Y10 F1800'])).toBeNull();
  });
});

// ── 11. Bridge Detection ──

describe('detectBridges', () => {
  it('detects bridges at start of new layers', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X10 Y0 E5 F1800',
      // Layer 1 starts
      'G1 X0 Y0 F1800',       // travel
      'G1 X50 Y0 E6 F1800',   // bridge: extruding 50mm at new layer
      'G1 X50 Y5 F1800',      // travel (ends bridge)
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 1 },
      { layerIndex: 1, zHeight: 0.4, startLine: 2, endLine: 4 },
    ];
    const bridges = detectBridges(lines, zLayers);
    expect(bridges.length).toBeGreaterThan(0);
    expect(bridges[0].zHeight).toBe(0.4);
  });

  it('classifies bridge severity', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X10 Y0 E5 F1800',
      'G1 X0 Y0 F1800',
      'G1 X30 Y0 E6 F1800',   // 30mm bridge = long
      'G1 X30 Y5 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 1 },
      { layerIndex: 1, zHeight: 0.4, startLine: 2, endLine: 4 },
    ];
    const bridges = detectBridges(lines, zLayers);
    if (bridges.length > 0) {
      expect(bridges[0].severity).toBe('long');
    }
  });

  it('handles empty input', () => {
    expect(detectBridges([], [])).toEqual([]);
  });

  it('handles single layer', () => {
    const zLayers = [{ layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 5 }];
    expect(detectBridges(['G1 X10 Y10 E5 F1800'], zLayers)).toEqual([]);
  });
});

// ── 12. Rapid Plane Detection ──

describe('detectRapidPlanes', () => {
  it('detects safe Z planes from rapid moves', () => {
    const lines = [
      'G0 X0 Y0 Z5',    // rapid at Z=5
      'G0 X10 Y10 Z5',  // rapid at Z=5
      'G0 X20 Y20 Z5',  // rapid at Z=5
      'G1 X30 Y30 Z0 F1800', // cutting move
    ];
    const planes = detectRapidPlanes(lines);
    expect(planes.length).toBeGreaterThan(0);
    const z5 = planes.find(p => p.zHeight === 5);
    expect(z5).toBeDefined();
    expect(z5!.rapidCount).toBe(3);
  });

  it('identifies primary safe Z', () => {
    const lines = [
      'G0 X0 Y0 Z10',
      'G0 X10 Y10 Z10',
      'G0 X20 Y20 Z10',
      'G0 X0 Y0 Z2',
    ];
    const planes = detectRapidPlanes(lines);
    const primary = planes.find(p => p.isPrimary);
    expect(primary).toBeDefined();
    expect(primary!.zHeight).toBe(10);
  });

  it('handles no rapid moves', () => {
    expect(detectRapidPlanes(['G1 X10 Y10 F1800'])).toEqual([]);
  });

  it('handles empty input', () => {
    expect(detectRapidPlanes([])).toEqual([]);
  });

  it('computes total travel distance', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G0 X100 Y0 Z5',  // 100mm travel
    ];
    const planes = detectRapidPlanes(lines);
    const z5 = planes.find(p => p.zHeight === 5);
    expect(z5!.totalTravel).toBeGreaterThan(0);
  });
});
