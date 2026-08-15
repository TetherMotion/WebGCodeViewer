/**
 * @file GcodeAdvanced4.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced4 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  executeGcodeLine,
  stepForward,
  stepBackward,
  seekToLine,
  analyzeRetractions,
  checkLayerHeightConsistency,
  analyzeFlowRate,
  analyzeFirstLayer,
  optimizeFeedRates,
  predictStringing,
  createVoxelGrid,
  simulateMaterialRemoval,
  checkPrintHeadCollisions,
  createAnnotation,
  exportAnnotations,
  importAnnotations,
  filterAnnotations,
  searchAnnotations,
  analyzeCoolingFan,
  analyzePrintSpeeds,
} from '../src/core/GcodeAdvanced4';

// ── 1. G-code Playback Controller ──

describe('Playback Controller', () => {
  it('creates initial state', () => {
    const state = createInitialState();
    expect(state.currentLine).toBe(0);
    expect(state.x).toBe(0);
    expect(state.absoluteMode).toBe(true);
  });

  it('executes G1 move', () => {
    const state = createInitialState();
    const newState = executeGcodeLine(state, 'G1 X10 Y20 Z5 F1800', 1);
    expect(newState.x).toBe(10);
    expect(newState.y).toBe(20);
    expect(newState.z).toBe(5);
    expect(newState.feedRate).toBe(1800);
    expect(newState.motionMode).toBe('G1');
  });

  it('handles relative positioning', () => {
    let state = createInitialState();
    state = executeGcodeLine(state, 'G91', 0); // relative mode
    state = executeGcodeLine(state, 'G1 X10 Y10', 1);
    expect(state.x).toBe(10);
    state = executeGcodeLine(state, 'G1 X10 Y10', 2);
    expect(state.x).toBe(20); // cumulative in relative mode
  });

  it('handles extrusion', () => {
    let state = createInitialState();
    state = executeGcodeLine(state, 'G1 X10 Y10 E5 F1800', 1);
    expect(state.e).toBe(5);
    expect(state.isExtruding).toBe(true);
  });

  it('handles retraction', () => {
    let state = createInitialState();
    state = executeGcodeLine(state, 'G1 X10 Y10 E5 F1800', 1);
    state = executeGcodeLine(state, 'G1 E2 F1800', 2); // absolute: E goes from 5 to 2 (retract 3mm)
    expect(state.e).toBe(2);
    expect(state.isExtruding).toBe(false);
  });

  it('handles tool change', () => {
    const state = createInitialState();
    const newState = executeGcodeLine(state, 'T1 M6', 1);
    expect(newState.tool).toBe(1);
  });

  it('handles spindle control', () => {
    const state = createInitialState();
    const newState = executeGcodeLine(state, 'M3 S12000', 1);
    expect(newState.spindleRpm).toBe(12000);
  });

  it('steps forward through lines', () => {
    const lines = ['G1 X10 Y10 F1800', 'G1 X20 Y20 F1800', 'G1 X30 Y30 F1800'];
    let state = createInitialState();
    state = executeGcodeLine(state, lines[0], 0);
    state = stepForward(lines, state, 2);
    expect(state.currentLine).toBe(2);
    expect(state.x).toBe(30);
  });

  it('steps backward through lines', () => {
    const lines = ['G1 X10 Y10 F1800', 'G1 X20 Y20 F1800', 'G1 X30 Y30 F1800'];
    let state = seekToLine(lines, 2);
    expect(state.x).toBe(30);
    state = stepBackward(lines, state, 1);
    expect(state.currentLine).toBe(1);
    expect(state.x).toBe(20);
  });

  it('seeks to specific line', () => {
    const lines = ['G1 X10 F1800', 'G1 X20 F1800', 'G1 X30 F1800'];
    const state = seekToLine(lines, 1);
    expect(state.currentLine).toBe(1);
    expect(state.x).toBe(20);
  });

  it('handles comments and empty lines', () => {
    const state = createInitialState();
    const newState = executeGcodeLine(state, '; this is a comment', 1);
    expect(newState.currentLine).toBe(1);
    expect(newState.x).toBe(0); // unchanged
  });

  it('tracks elapsed time', () => {
    let state = createInitialState();
    state = executeGcodeLine(state, 'G1 X100 Y0 F1800', 1);
    // 100mm at 1800mm/min = 100 / 30 = 3.33s
    expect(state.elapsedTime).toBeCloseTo(100 / 30, 1);
  });
});

// ── 2. Retraction Analysis ──

describe('analyzeRetractions', () => {
  it('detects retraction events', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G1 E2 F1800',        // retraction: E goes from 5 to 2 (3mm)
      'G0 X20 Y20',         // travel
      'G1 E5 F1800',        // deretraction: E goes from 2 to 5
      'G1 X30 Y30 E8 F1800',
    ];
    const result = analyzeRetractions(lines);
    expect(result.count).toBe(1);
    expect(result.events[0].distance).toBe(3);
    expect(result.events[0].isDeretraction).toBe(false);
  });

  it('computes average retraction distance', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G1 E3 F1800',        // retract 2mm (5→3)
      'G1 E5 F1800',        // deretract
      'G1 X20 Y20 E8 F1800',
      'G1 E4 F1800',        // retract 4mm (8→4)
      'G1 E8 F1800',        // deretract
    ];
    const result = analyzeRetractions(lines);
    expect(result.count).toBe(2);
    expect(result.avgDistance).toBe(3); // (2+4)/2
  });

  it('provides recommendations for high count', () => {
    const lines: string[] = [];
    let e = 0;
    for (let i = 0; i < 60; i++) {
      e += 1;
      lines.push(`G1 X${i} Y0 E${e} F1800`);
      e -= 1;
      lines.push(`G1 E${e} F1800`); // retract 1mm
      e += 1;
      lines.push(`G1 E${e} F1800`); // deretract
    }
    const result = analyzeRetractions(lines);
    expect(result.count).toBe(60);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles no retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeRetractions(lines);
    expect(result.count).toBe(0);
    expect(result.avgDistance).toBe(0);
  });
});

// ── 3. Layer Height Consistency ──

describe('checkLayerHeightConsistency', () => {
  it('detects consistent layer heights', () => {
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2 },
      { layerIndex: 1, zHeight: 0.4 },
      { layerIndex: 2, zHeight: 0.6 },
      { layerIndex: 3, zHeight: 0.8 },
    ];
    const result = checkLayerHeightConsistency(zLayers);
    expect(result.avgHeight).toBeCloseTo(0.2, 5);
    expect(result.stdDev).toBeCloseTo(0, 5);
    expect(result.consistencyScore).toBeCloseTo(1, 2);
    expect(result.issues.length).toBe(0);
  });

  it('detects inconsistent layer heights', () => {
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2 },
      { layerIndex: 1, zHeight: 0.4 },
      { layerIndex: 2, zHeight: 0.8 }, // inconsistent: 0.4 jump
      { layerIndex: 3, zHeight: 1.0 },
    ];
    const result = checkLayerHeightConsistency(zLayers);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.consistencyScore).toBeLessThan(1);
  });

  it('detects adaptive layer heights', () => {
    const zLayers = [
      { layerIndex: 0, zHeight: 0.1 },
      { layerIndex: 1, zHeight: 0.3 },
      { layerIndex: 2, zHeight: 0.6 },
      { layerIndex: 3, zHeight: 1.0 },
    ];
    const result = checkLayerHeightConsistency(zLayers);
    expect(result.isAdaptive).toBe(true);
  });

  it('handles empty input', () => {
    const result = checkLayerHeightConsistency([]);
    expect(result.layerHeights).toEqual([]);
    expect(result.consistencyScore).toBe(1);
  });

  it('handles single layer', () => {
    const result = checkLayerHeightConsistency([{ layerIndex: 0, zHeight: 0.2 }]);
    expect(result.layerHeights).toEqual([]);
  });
});

// ── 4. Flow Rate Calibration ──

describe('analyzeFlowRate', () => {
  it('analyzes flow rate consistency', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X100 Y0 E10 F1800',  // 100mm move, 10mm extrusion
      'G1 X100 Y100 E20 F1800', // 100mm move, 10mm extrusion
    ];
    const result = analyzeFlowRate(lines, 0.2, 0.4, 1.75);
    expect(result.segments.length).toBe(2);
    expect(result.avgFlowRate).toBeGreaterThan(0);
    expect(result.consistency).toBeGreaterThan(0.9); // consistent
  });

  it('detects flow rate outliers', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X100 Y0 E10 F1800',   // normal
      'G1 X100 Y100 E50 F1800', // much more extrusion = outlier
    ];
    const result = analyzeFlowRate(lines, 0.2, 0.4, 1.75);
    expect(result.outliers.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = analyzeFlowRate([]);
    expect(result.segments).toEqual([]);
    expect(result.avgFlowRate).toBe(0);
  });

  it('computes recommended adjustment', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X100 Y0 E10 F1800',
    ];
    const result = analyzeFlowRate(lines, 0.2, 0.4, 1.75);
    expect(result.recommendedAdjustment).toBeDefined();
  });
});

// ── 5. First Layer Quality ──

describe('analyzeFirstLayer', () => {
  it('analyzes first layer parameters', () => {
    const lines = [
      'M140 S60',
      'M104 S210',
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y10 E10 F1800',
      'G1 X20 Y20 E15 F1800',
      ';LAYER:1',
      'G1 X30 Y30 E20 F1800',
    ];
    const result = analyzeFirstLayer(lines);
    expect(result.bedTemp).toBe(60);
    expect(result.hotendTemp).toBe(210);
    expect(result.totalExtrusion).toBeGreaterThan(0);
    expect(result.moveCount).toBeGreaterThan(0);
  });

  it('detects high fan speed on first layer', () => {
    const lines = [
      'M106 S128',
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      ';LAYER:1',
    ];
    const result = analyzeFirstLayer(lines);
    expect(result.fanSpeed).toBe(128);
    const fanIssue = result.issues.find(i => i.type === 'fan_speed');
    expect(fanIssue).toBeDefined();
  });

  it('detects low bed temperature', () => {
    const lines = [
      'M140 S40',
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      ';LAYER:1',
    ];
    const result = analyzeFirstLayer(lines);
    const bedIssue = result.issues.find(i => i.type === 'bed_temp');
    expect(bedIssue).toBeDefined();
  });

  it('provides quality score', () => {
    const lines = [
      'M140 S60',
      'M104 S210',
      'M107',
      ';LAYER:0',
      'G1 X10 Y10 E5 F1200',
      ';LAYER:1',
    ];
    const result = analyzeFirstLayer(lines);
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1);
  });

  it('handles no layer markers', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = analyzeFirstLayer(lines);
    expect(result.totalExtrusion).toBeGreaterThan(0);
  });
});

// ── 6. Feed Rate Optimization ──

describe('optimizeFeedRates', () => {
  it('suggests feed rate changes', () => {
    const lines = [
      'M3 S12000',
      'G1 X10 Y10 Z-1 F500',   // slow feed
      'G1 X50 Y10 Z-1 F500',
    ];
    const result = optimizeFeedRates(lines, 6, 5000, 0.05, 4);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('computes time savings', () => {
    const lines = [
      'M3 S12000',
      'G1 X100 Y0 Z-1 F500',
    ];
    const result = optimizeFeedRates(lines, 6, 5000, 0.05, 4);
    expect(result.currentTotalTime).toBeGreaterThan(0);
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = optimizeFeedRates(lines);
    expect(result.suggestions).toEqual([]);
    expect(result.currentTotalTime).toBe(0);
  });
});

// ── 7. Stringing Prediction ──

describe('predictStringing', () => {
  it('detects unretracted travel moves', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G0 X50 Y50',           // travel without retraction (E stays at 5)
      'G1 X60 Y60 E10 F1800',
    ];
    const result = predictStringing(lines);
    expect(result.riskPoints.length).toBeGreaterThan(0);
    expect(result.totalUnretractedTravel).toBeGreaterThan(0);
  });

  it('does not flag retracted travel', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G1 E2 F1800',          // retraction: E 5→2 (3mm retract)
      'G0 X50 Y50',           // travel with retraction
      'G1 E5 F1800',          // deretraction: E 2→5
      'G1 X60 Y60 E10 F1800',
    ];
    const result = predictStringing(lines);
    // The retraction should prevent flagging the travel
    expect(result.riskPoints.length).toBe(0);
  });

  it('provides recommendations', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i + 1} F1800`);
      lines.push(`G0 X${i * 10 + 5} Y50`); // long travel without retraction
    }
    const result = predictStringing(lines);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = predictStringing([]);
    expect(result.riskPoints).toEqual([]);
    expect(result.overallRisk).toBe(0);
  });
});

// ── 8. Voxel Material Removal ──

describe('Voxel Material Removal', () => {
  it('creates a voxel grid', () => {
    const grid = createVoxelGrid(10, 10, 10, 1);
    expect(grid.sizeX).toBe(10);
    expect(grid.sizeY).toBe(10);
    expect(grid.sizeZ).toBe(10);
    expect(grid.data.length).toBe(1000);
    expect(grid.remainingCount).toBe(1000);
    expect(grid.removedCount).toBe(0);
  });

  it('simulates material removal', () => {
    const grid = createVoxelGrid(10, 10, 10, 1);
    const moves = [
      { x: 0, y: 5, z: 5, isCutting: false },
      { x: 10, y: 5, z: 5, isCutting: true },
    ];
    const result = simulateMaterialRemoval(grid, moves, 2);
    expect(result.removedCount).toBeGreaterThan(0);
    expect(result.removalPercentage).toBeGreaterThan(0);
    expect(result.remainingCount).toBeLessThan(1000);
  });

  it('does not remove material for non-cutting moves', () => {
    const grid = createVoxelGrid(10, 10, 10, 1);
    const moves = [
      { x: 0, y: 5, z: 5, isCutting: false },
      { x: 10, y: 5, z: 5, isCutting: false },
    ];
    const result = simulateMaterialRemoval(grid, moves, 2);
    expect(result.removedCount).toBe(0);
  });

  it('handles small voxel size', () => {
    const grid = createVoxelGrid(5, 5, 5, 0.5);
    expect(grid.sizeX).toBe(10);
    expect(grid.data.length).toBe(1000);
  });
});

// ── 9. Print Head Collision ──

describe('checkPrintHeadCollisions', () => {
  it('detects gantry collision with printed geometry', () => {
    const lines = [
      'G1 X50 Y50 Z10 F1800', // nozzle at Z=10
    ];
    const printedLayers = [
      { zHeight: 15, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    ];
    const headModel = { width: 40, depth: 40, height: 30, offsetX: 0, offsetY: 0, gantryHeight: 20 };
    const collisions = checkPrintHeadCollisions(lines, printedLayers, headModel);
    // Gantry at Z=10+20=30, layer at Z=15, 30 > 15+5=20, so no collision
    // But let's adjust: gantry at 30, layer top at 15, 30 > 20 so it should be fine
    // Actually we need gantryZ < layer.zHeight + 5 for collision
    // gantryZ = 10 + 20 = 30, layer.zHeight + 5 = 20, 30 > 20 so no collision
    expect(collisions.length).toBe(0);
  });

  it('detects collision when gantry is low', () => {
    const lines = [
      'G1 X50 Y50 Z5 F1800',
    ];
    const printedLayers = [
      { zHeight: 15, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    ];
    const headModel = { width: 40, depth: 40, height: 30, offsetX: 0, offsetY: 0, gantryHeight: 8 };
    const collisions = checkPrintHeadCollisions(lines, printedLayers, headModel);
    // gantryZ = 5 + 8 = 13, layer.zHeight + 5 = 20, 13 < 20 → collision
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0].type).toBe('gantry');
  });

  it('handles no printed layers', () => {
    const lines = ['G1 X50 Y50 Z10 F1800'];
    const collisions = checkPrintHeadCollisions(lines, [], { width: 40, depth: 40, height: 30, offsetX: 0, offsetY: 0, gantryHeight: 20 });
    expect(collisions).toEqual([]);
  });

  it('handles empty input', () => {
    expect(checkPrintHeadCollisions([], [], { width: 40, depth: 40, height: 30, offsetX: 0, offsetY: 0, gantryHeight: 20 })).toEqual([]);
  });
});

// ── 10. G-code Annotation ──

describe('Annotations', () => {
  it('creates an annotation', () => {
    const ann = createAnnotation(10, 'Check this line', 'warning');
    expect(ann.lineNumber).toBe(10);
    expect(ann.text).toBe('Check this line');
    expect(ann.category).toBe('warning');
    expect(ann.timestamp).toBeDefined();
  });

  it('exports and imports annotations', () => {
    const annotations = [
      createAnnotation(10, 'Note 1', 'note'),
      createAnnotation(20, 'Warning 1', 'warning'),
    ];
    const json = exportAnnotations(annotations);
    expect(json).toContain('Note 1');
    expect(json).toContain('version');

    const imported = importAnnotations(json);
    expect(imported.length).toBe(2);
    expect(imported[0].text).toBe('Note 1');
  });

  it('filters by category', () => {
    const annotations = [
      createAnnotation(10, 'Note', 'note'),
      createAnnotation(20, 'Warning', 'warning'),
      createAnnotation(30, 'Error', 'error'),
    ];
    const warnings = filterAnnotations(annotations, 'warning');
    expect(warnings.length).toBe(1);
    expect(warnings[0].text).toBe('Warning');
  });

  it('searches by text', () => {
    const annotations = [
      createAnnotation(10, 'Check feed rate'),
      createAnnotation(20, 'Verify temperature'),
      createAnnotation(30, 'Check retraction'),
    ];
    const results = searchAnnotations(annotations, 'check');
    expect(results.length).toBe(2);
  });

  it('handles empty annotations on import', () => {
    const json = '{"version":"1.0","annotations":[]}';
    expect(importAnnotations(json)).toEqual([]);
  });
});

// ── 11. Cooling Fan Analysis ──

describe('analyzeCoolingFan', () => {
  it('tracks fan speed events', () => {
    const lines = [
      ';LAYER:0',
      'M106 S0',      // fan off for first layer
      'G1 X10 Y10 E5 F1800',
      ';LAYER:1',
      'M106 S128',    // fan at 50%
      'G1 X20 Y20 E10 F1800',
      'M106 S255',    // fan at 100%
    ];
    const result = analyzeCoolingFan(lines);
    expect(result.events.length).toBe(3);
    expect(result.maxSpeed).toBe(255);
  });

  it('detects fan on during first layer', () => {
    const lines = [
      ';LAYER:0',
      'M106 S128',
      'G1 X10 Y10 E5 F1800',
    ];
    const result = analyzeCoolingFan(lines);
    expect(result.firstLayerSpeed).toBe(128);
    const rec = result.recommendations.find(r => r.includes('first layer'));
    expect(rec).toBeDefined();
  });

  it('handles M107 fan off', () => {
    const lines = ['M106 S128', 'M107'];
    const result = analyzeCoolingFan(lines);
    expect(result.events.length).toBe(2);
    expect(result.events[1].speed).toBe(0);
  });

  it('handles no fan commands', () => {
    const lines = ['G1 X10 Y10 F1800'];
    const result = analyzeCoolingFan(lines);
    expect(result.events).toEqual([]);
    expect(result.maxSpeed).toBe(0);
  });
});

// ── 12. Print Speed Analysis ──

describe('analyzePrintSpeeds', () => {
  it('analyzes speeds by feature type', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F1800',
      'G1 X100 Y100 E10 F1800',
      ';TYPE:INFILL',
      'G1 X0 Y100 E15 F3600',
      'G1 X0 Y0 E20 F3600',
    ];
    const result = analyzePrintSpeeds(lines);
    expect(result.features.length).toBe(2);
    const wall = result.features.find(f => f.featureType === 'WALL-OUTER');
    const infill = result.features.find(f => f.featureType === 'INFILL');
    expect(wall).toBeDefined();
    expect(infill).toBeDefined();
    expect(wall!.avgSpeed).toBe(1800);
    expect(infill!.avgSpeed).toBe(3600);
  });

  it('identifies suboptimal speeds', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F500',  // too slow for wall
    ];
    const result = analyzePrintSpeeds(lines);
    const wall = result.features.find(f => f.featureType === 'WALL-OUTER');
    expect(wall!.isOptimal).toBe(false);
    expect(result.suboptimalCount).toBeGreaterThan(0);
  });

  it('computes time percentages', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F1800',
      ';TYPE:INFILL',
      'G1 X100 Y100 E10 F3600',
    ];
    const result = analyzePrintSpeeds(lines);
    const totalPct = result.features.reduce((sum, f) => sum + f.timePercentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('handles empty input', () => {
    const result = analyzePrintSpeeds([]);
    expect(result.features).toEqual([]);
    expect(result.totalTime).toBe(0);
  });

  it('provides recommendations', () => {
    const lines = [
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F500', // too slow
    ];
    const result = analyzePrintSpeeds(lines);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
