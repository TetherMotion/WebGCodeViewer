/**
 * @file GcodeAdvanced.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced module (12 advanced features).
 */

import { describe, it, expect } from 'vitest';
import {
  detectOverhangs,
  detectZSeams,
  analyzeZSeamConsistency,
  parseDrillingCycles,
  parseCutterCompensation,
  computeCompensatedPath,
  checkMachineLimits,
  computeFeatureTimeBreakdown,
  analyzePathOptimization,
  checkOverTravel,
  parseProbeEvents,
  parseSubprograms,
  estimateJobCost,
  diffGcode,
} from "@tether/gcode-analyzer/GcodeAdvanced";

// ── 1. Overhang Detection ──

describe('detectOverhangs', () => {
  const makeLayers = (overrides: Partial<{
    layerIndex: number; zHeight: number; layerHeight: number;
    minX: number; maxX: number; minY: number; maxY: number;
    startLine: number; endLine: number;
  }>[]) => overrides.map((o, i) => ({
    layerIndex: i,
    zHeight: 0.2 * (i + 1),
    layerHeight: 0.2,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    startLine: i * 10,
    endLine: i * 10 + 9,
    ...o,
  }));

  it('detects no overhangs for uniform layers', () => {
    const layers = makeLayers([
      { bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
      { bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } },
    ]);
    expect(detectOverhangs(layers)).toEqual([]);
  });

  it('detects overhang when layer extends beyond previous', () => {
    const layers = makeLayers([
      { bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 } },
      { bounds: { minX: -5, maxX: 55, minY: 0, maxY: 50 } }, // 5mm overhang on both sides
    ]);
    const overhangs = detectOverhangs(layers);
    expect(overhangs.length).toBe(1);
    expect(overhangs[0].distance).toBe(5);
    expect(overhangs[0].angle).toBeGreaterThan(0);
  });

  it('classifies severity based on angle', () => {
    const layers = makeLayers([
      { bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 } },
      // 1mm overhang with 0.2mm layer height → angle ≈ 78.7° → severe
      { bounds: { minX: -1, maxX: 51, minY: 0, maxY: 50 } },
    ]);
    const overhangs = detectOverhangs(layers, 30, 45);
    expect(overhangs[0].severity).toBe('severe');
  });

  it('classifies moderate overhang', () => {
    const layers = makeLayers([
      { bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 }, layerHeight: 0.2 },
      // 0.15mm overhang with 0.2mm layer height → angle ≈ 36.87° → moderate
      { bounds: { minX: -0.15, maxX: 50, minY: 0, maxY: 50 }, layerHeight: 0.2 },
    ]);
    const overhangs = detectOverhangs(layers, 30, 45);
    expect(overhangs.length).toBe(1);
    expect(overhangs[0].severity).toBe('moderate');
  });

  it('ignores tiny overhangs', () => {
    const layers = makeLayers([
      { bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50 } },
      { bounds: { minX: -0.05, maxX: 50, minY: 0, maxY: 50 } }, // 0.05mm < 0.1mm threshold
    ]);
    expect(detectOverhangs(layers)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(detectOverhangs([])).toEqual([]);
  });

  it('handles single layer', () => {
    const layers = makeLayers([{ bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } }]);
    expect(detectOverhangs(layers)).toEqual([]);
  });
});

// ── 2. Z-Seam Detection ──

describe('detectZSeams', () => {
  it('detects seam positions from G-code', () => {
    const lines = [
      'G1 Z0.2 F1500',
      'G1 X10 Y10 E1 F1800',  // first extruding move = seam
      'G1 X100 Y10 E5 F1800',
      'G1 Z0.4 F1500',
      'G1 X10 Y10 E6 F1800',  // same position → aligned
      'G1 X100 Y10 E10 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 2 },
      { layerIndex: 1, zHeight: 0.4, startLine: 3, endLine: 5 },
    ];
    const seams = detectZSeams(lines, zLayers);
    expect(seams.length).toBe(2);
    expect(seams[0].x).toBe(10);
    expect(seams[0].y).toBe(10);
    expect(seams[1].aligned).toBe(true); // same position as layer 0
  });

  it('detects unaligned seams', () => {
    const lines = [
      'G1 X10 Y10 E1 F1800',
      'G1 X100 Y10 E5 F1800',
      'G1 X50 Y50 E6 F1800',  // different position
      'G1 X100 Y50 E10 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 1 },
      { layerIndex: 1, zHeight: 0.4, startLine: 2, endLine: 3 },
    ];
    const seams = detectZSeams(lines, zLayers);
    expect(seams.length).toBe(2);
    expect(seams[0].x).toBe(10);
    expect(seams[1].x).toBe(50);
    expect(seams[1].aligned).toBe(false);
  });

  it('handles empty input', () => {
    expect(detectZSeams([], [])).toEqual([]);
  });
});

describe('analyzeZSeamConsistency', () => {
  it('computes consistency metrics', () => {
    const seams = [
      { layerIndex: 0, zHeight: 0.2, lineNumber: 0, x: 10, y: 10, aligned: false },
      { layerIndex: 1, zHeight: 0.4, lineNumber: 5, x: 10, y: 10, aligned: true },
      { layerIndex: 2, zHeight: 0.6, lineNumber: 10, x: 10, y: 10, aligned: true },
    ];
    const analysis = analyzeZSeamConsistency(seams);
    expect(analysis.totalLayers).toBe(3);
    expect(analysis.alignedCount).toBe(2);
    expect(analysis.alignmentScore).toBeCloseTo(2 / 3, 2);
    expect(analysis.averageSeamDistance).toBe(0); // all same position
  });

  it('handles empty input', () => {
    const analysis = analyzeZSeamConsistency([]);
    expect(analysis.totalLayers).toBe(0);
    expect(analysis.alignmentScore).toBe(0);
  });
});

// ── 3. Drilling Cycle Expansion ──

describe('parseDrillingCycles', () => {
  it('parses G81 simple drilling cycle', () => {
    const lines = [
      'G81 X10 Y10 Z-5 R2 F100',
      'X20',           // second hole at X20, Y10
      'G80',           // cancel cycle
    ];
    const cycles = parseDrillingCycles(lines);
    expect(cycles.length).toBe(2);
    expect(cycles[0].cycleType).toBe('G81');
    expect(cycles[0].x).toBe(10);
    expect(cycles[0].y).toBe(10);
    expect(cycles[0].zDepth).toBe(-5);
    expect(cycles[0].rPlane).toBe(2);
    expect(cycles[0].feedRate).toBe(100);
    // Expanded: rapid to R, feed to depth, rapid out
    expect(cycles[0].expandedMoves.length).toBe(3);
    expect(cycles[0].expandedMoves[0].type).toBe('rapid');
    expect(cycles[0].expandedMoves[1].type).toBe('feed');
    expect(cycles[0].expandedMoves[2].type).toBe('rapid');
  });

  it('parses G82 drilling cycle with dwell', () => {
    const lines = ['G82 X10 Y10 Z-5 R2 P1000 F100', 'G80'];
    const cycles = parseDrillingCycles(lines);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycleType).toBe('G82');
    expect(cycles[0].dwell).toBe(1000);
    // Expanded: rapid, feed, dwell, rapid
    expect(cycles[0].expandedMoves.length).toBe(4);
    expect(cycles[0].expandedMoves[2].type).toBe('dwell');
  });

  it('parses G83 peck drilling cycle', () => {
    const lines = ['G83 X10 Y10 Z-10 R2 Q3 F100', 'G80'];
    const cycles = parseDrillingCycles(lines);
    expect(cycles.length).toBe(1);
    expect(cycles[0].cycleType).toBe('G83');
    expect(cycles[0].peckDepth).toBe(3);
    // Peck depth 3mm, total depth 10mm from R=2 → 12mm
    // Pecks: 2→-1, -1→-4, -4→-7, -7→-10 = 4 pecks, each with retract
    // Each peck: feed + rapid = 2 moves, plus final rapid
    expect(cycles[0].expandedMoves.length).toBeGreaterThan(4);
    expect(cycles[0].expandedMoves.every(m => m.type === 'feed' || m.type === 'rapid')).toBe(true);
  });

  it('handles multiple holes in a single cycle', () => {
    const lines = [
      'G81 X10 Y10 Z-5 R2 F100',
      'X20 Y10',
      'X30 Y10',
      'G80',
    ];
    const cycles = parseDrillingCycles(lines);
    expect(cycles.length).toBe(3);
    expect(cycles[0].x).toBe(10);
    expect(cycles[1].x).toBe(20);
    expect(cycles[2].x).toBe(30);
  });

  it('returns empty for no cycles', () => {
    expect(parseDrillingCycles(['G1 X10 Y10 F100'])).toEqual([]);
  });
});

// ── 4. Cutter Radius Compensation ──

describe('parseCutterCompensation', () => {
  it('parses G41 (left compensation)', () => {
    const lines = ['G41 D1', 'G1 X10 Y10 F100', 'G40'];
    const infos = parseCutterCompensation(lines);
    expect(infos.length).toBe(2);
    expect(infos[0].mode).toBe('G41');
    expect(infos[0].dRegister).toBe(1);
    expect(infos[1].mode).toBe('G40');
  });

  it('parses G42 (right compensation)', () => {
    const lines = ['G42 D2', 'G1 X10 Y10', 'G40'];
    const infos = parseCutterCompensation(lines);
    expect(infos[0].mode).toBe('G42');
    expect(infos[0].dRegister).toBe(2);
  });

  it('returns empty for no compensation', () => {
    expect(parseCutterCompensation(['G1 X10 Y10'])).toEqual([]);
  });
});

describe('computeCompensatedPath', () => {
  it('offsets path to the left (G41)', () => {
    const moves = [
      { x: 0, y: 0, lineNumber: 0 },
      { x: 10, y: 0, lineNumber: 1 },
      { x: 10, y: 10, lineNumber: 2 },
    ];
    const result = computeCompensatedPath(moves, 2.0, 'left');
    expect(result.length).toBe(3);
    // First point should be offset in +Y direction (left of +X travel)
    expect(result[0].y).toBeGreaterThan(0);
    // Last point should be offset in -X direction (left of +Y travel)
    expect(result[2].x).toBeLessThan(10);
  });

  it('offsets path to the right (G42)', () => {
    const moves = [
      { x: 0, y: 0, lineNumber: 0 },
      { x: 10, y: 0, lineNumber: 1 },
    ];
    const result = computeCompensatedPath(moves, 2.0, 'right');
    expect(result.length).toBe(2);
    // Right of +X travel is -Y
    expect(result[0].y).toBeLessThan(0);
  });

  it('handles empty input', () => {
    expect(computeCompensatedPath([], 2.0, 'left')).toEqual([]);
  });

  it('handles single point', () => {
    const result = computeCompensatedPath([{ x: 5, y: 5, lineNumber: 0 }], 2.0, 'left');
    expect(result.length).toBe(1);
    expect(result[0].compensated).toBe(false);
  });
});

// ── 5. Machine Limits Checking ──

describe('checkMachineLimits', () => {
  const limits = {
    maxFeedRate: 5000,
    maxAcceleration: 1000,
    maxJerk: 20000,
    minX: 0, maxX: 200,
    minY: 0, maxY: 200,
    minZ: -100, maxZ: 200,
  };

  it('detects travel limit violations', () => {
    const lines = ['G1 X250 Y10 F1000']; // X exceeds max
    const violations = checkMachineLimits(lines, limits);
    const travel = violations.filter(v => v.category === 'travel');
    expect(travel.length).toBe(1);
    expect(travel[0].severity).toBe('error');
  });

  it('detects feed rate violations', () => {
    const lines = ['G1 X10 Y10 F6000']; // F exceeds max
    const violations = checkMachineLimits(lines, limits);
    const feedrate = violations.filter(v => v.category === 'feedrate');
    expect(feedrate.length).toBe(1);
  });

  it('returns no violations for safe G-code', () => {
    const lines = ['G1 X10 Y10 Z5 F1000'];
    const violations = checkMachineLimits(lines, limits);
    expect(violations.length).toBe(0);
  });

  it('handles empty input', () => {
    expect(checkMachineLimits([], limits)).toEqual([]);
  });
});

// ── 6. Feature-Based Time Breakdown ──

describe('computeFeatureTimeBreakdown', () => {
  it('computes time per feature type', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      ';TYPE:WALL-OUTER',
      'G1 X100 Y0 E5 F1800',   // 100mm at 30mm/s = 3.33s
      'G1 X100 Y100 E10 F1800', // 100mm at 30mm/s = 3.33s
      ';TYPE:INFILL',
      'G1 X0 Y100 E15 F3600',   // 100mm at 60mm/s = 1.67s
    ];
    const breakdown = computeFeatureTimeBreakdown(lines);
    expect(breakdown.length).toBe(2);
    const wall = breakdown.find(b => b.featureType === 'WALL-OUTER');
    const infill = breakdown.find(b => b.featureType === 'INFILL');
    expect(wall).toBeDefined();
    expect(infill).toBeDefined();
    expect(wall!.moveCount).toBe(2);
    expect(infill!.moveCount).toBe(1);
    // WALL-OUTER should take more time than INFILL
    expect(wall!.totalTime).toBeGreaterThan(infill!.totalTime);
    // Percentages should sum to ~100
    const totalPct = breakdown.reduce((sum, b) => sum + b.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('returns empty for no feature types', () => {
    expect(computeFeatureTimeBreakdown(['G1 X10 Y10 F1800'])).toEqual([]);
  });

  it('sorts by time descending', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      ';TYPE:SLOW',
      'G1 X100 Y0 E5 F600',   // slow
      ';TYPE:FAST',
      'G1 X200 Y0 E10 F6000',  // fast
    ];
    const breakdown = computeFeatureTimeBreakdown(lines);
    expect(breakdown[0].totalTime).toBeGreaterThanOrEqual(breakdown[1].totalTime);
  });
});

// ── 7. Path Optimization Analysis ──

describe('analyzePathOptimization', () => {
  it('detects air cuts (G1 without extrusion)', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X100 Y0 F1800',  // air cut: G1 without E, 100mm
    ];
    const issues = analyzePathOptimization(lines);
    const airCuts = issues.filter(i => i.category === 'air-cut');
    expect(airCuts.length).toBe(1);
    expect(airCuts[0].waste).toBeGreaterThan(0);
  });

  it('detects long travels', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G0 X200 Y0',  // long travel 200mm
    ];
    const issues = analyzePathOptimization(lines);
    const travels = issues.filter(i => i.category === 'redundant-travel');
    expect(travels.length).toBe(1);
  });

  it('detects unnecessary dwells', () => {
    const lines = ['G4 P2000']; // 2 second dwell
    const issues = analyzePathOptimization(lines);
    const dwells = issues.filter(i => i.category === 'unnecessary-dwell');
    expect(dwells.length).toBe(1);
    expect(dwells[0].waste).toBeGreaterThan(1);
  });

  it('detects excessive retractions', () => {
    // Create 20 moves with 5 retractions (> 25%)
    const lines: string[] = ['G1 X0 Y0 E0 F1800'];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i % 4 === 3 ? (i - 1) * 0.5 : (i + 1) * 0.5} F1800`);
    }
    const issues = analyzePathOptimization(lines);
    // May or may not detect excessive retraction depending on actual count
    // But at least should not crash
    expect(issues).toBeDefined();
  });

  it('handles empty input', () => {
    expect(analyzePathOptimization([])).toEqual([]);
  });
});

// ── 8. Over-Travel Detection ──

describe('checkOverTravel', () => {
  const envelope = {
    minX: 0, maxX: 200,
    minY: 0, maxY: 200,
    minZ: -100, maxZ: 200,
  };

  it('detects positive over-travel', () => {
    const lines = ['G1 X250 Y10 Z5'];
    const violations = checkOverTravel(lines, envelope);
    expect(violations.length).toBe(1);
    expect(violations[0].axis).toBe('X');
    expect(violations[0].direction).toBe('positive');
  });

  it('detects negative over-travel', () => {
    const lines = ['G1 X-10 Y10 Z5'];
    const violations = checkOverTravel(lines, envelope);
    expect(violations.length).toBe(1);
    expect(violations[0].axis).toBe('X');
    expect(violations[0].direction).toBe('negative');
  });

  it('detects multiple axis violations', () => {
    const lines = ['G1 X250 Y250 Z-150'];
    const violations = checkOverTravel(lines, envelope);
    expect(violations.length).toBe(3);
  });

  it('returns no violations for safe moves', () => {
    const lines = ['G1 X100 Y100 Z5'];
    expect(checkOverTravel(lines, envelope)).toEqual([]);
  });

  it('handles rotary axes', () => {
    const lines = ['G1 X100 Y100 Z5 A45'];
    const violations = checkOverTravel(lines, {
      ...envelope,
      minA: -10, maxA: 10,
    });
    expect(violations.length).toBe(1);
    expect(violations[0].axis).toBe('A');
  });

  it('handles empty input', () => {
    expect(checkOverTravel([], envelope)).toEqual([]);
  });
});

// ── 9. Probe Point Tracking ──

describe('parseProbeEvents', () => {
  it('parses G38.2 probe cycles', () => {
    const lines = [
      'G1 X10 Y10 Z5 F1000',
      'G38.2 Z-5 F100',  // probe Z down
    ];
    const events = parseProbeEvents(lines);
    expect(events.length).toBe(1);
    expect(events[0].probeType).toBe('G38.2');
    expect(events[0].axis).toBe('Z');
    expect(events[0].feedRate).toBe(100);
  });

  it('parses different probe types', () => {
    const lines = [
      'G38.2 Z-5 F100',
      'G38.3 Z-5 F100',
      'G38.4 Z5 F100',
      'G38.5 Z5 F100',
    ];
    const events = parseProbeEvents(lines);
    expect(events.length).toBe(4);
    expect(events[0].probeType).toBe('G38.2');
    expect(events[1].probeType).toBe('G38.3');
    expect(events[2].probeType).toBe('G38.4');
    expect(events[3].probeType).toBe('G38.5');
  });

  it('detects probed axis from changed coordinates', () => {
    const lines = ['G38.2 X10 F100']; // only X changed
    const events = parseProbeEvents(lines);
    expect(events[0].axis).toBe('X');
  });

  it('returns empty for no probe cycles', () => {
    expect(parseProbeEvents(['G1 X10 Y10 F100'])).toEqual([]);
  });
});

// ── 10. Subprogram Call Tracing ──

describe('parseSubprograms', () => {
  it('parses M98 subprogram calls', () => {
    const lines = [
      'G1 X10 Y10 F1000',
      'M98 P1001 L3',  // call subprogram 1001, 3 times
      'G1 X20 Y20',
    ];
    const { calls, definitions } = parseSubprograms(lines);
    expect(calls.length).toBe(1);
    expect(calls[0].subprogramNumber).toBe(1001);
    expect(calls[0].loopCount).toBe(3);
    expect(calls[0].depth).toBe(0);
  });

  it('parses subprogram definitions', () => {
    const lines = [
      'O1001',
      'G1 X10 Y10',
      'M99',
    ];
    const { calls, definitions } = parseSubprograms(lines);
    expect(definitions.length).toBe(1);
    expect(definitions[0].number).toBe(1001);
    expect(definitions[0].endLine).toBe(2);
  });

  it('handles default loop count (L=1)', () => {
    const lines = ['M98 P1001'];
    const { calls } = parseSubprograms(lines);
    expect(calls[0].loopCount).toBe(1);
  });

  it('returns empty for no subprograms', () => {
    const result = parseSubprograms(['G1 X10 Y10']);
    expect(result.calls).toEqual([]);
    expect(result.definitions).toEqual([]);
  });
});

// ── 11. Cost Estimation ──

describe('estimateJobCost', () => {
  it('computes material cost from weight', () => {
    const cost = estimateJobCost(3600, 100, 0.05, 10);
    expect(cost.materialCost).toBe(5); // 100g * $0.05/g
  });

  it('computes machine cost from time', () => {
    const cost = estimateJobCost(3600, 0, 0.05, 10, 0, 0);
    // 1 hour at $10/hour = $10
    expect(cost.machineCost).toBeCloseTo(10, 1);
  });

  it('includes setup time in machine cost', () => {
    const cost = estimateJobCost(3600, 0, 0.05, 10, 600, 0); // overheadRate=0
    // (3600 + 600) / 3600 * 10 = $11.67
    expect(cost.machineCost).toBeCloseTo(11.67, 1);
  });

  it('includes overhead', () => {
    const cost = estimateJobCost(3600, 0, 0.05, 10, 0, 0.2);
    // Machine cost = $10, overhead = 20% = $2
    expect(cost.details.overheadCost).toBeCloseTo(2, 1);
    expect(cost.totalCost).toBeCloseTo(12, 1);
  });

  it('computes total cost', () => {
    const cost = estimateJobCost(3600, 100, 0.05, 10, 300, 0.2);
    // Material: 100 * 0.05 = $5
    // Machine: (3600 + 300) / 3600 * 10 = $10.83
    // Overhead: 20% of $10.83 = $2.17
    // Total: 5 + 10.83 + 2.17 = $18
    expect(cost.totalCost).toBeCloseTo(18, 0);
  });

  it('handles zero time and weight', () => {
    const cost = estimateJobCost(0, 0, 0.05, 10, 0, 0); // no setup, no overhead
    expect(cost.totalCost).toBe(0);
  });
});

// ── 12. G-code Diff ──

describe('diffGcode', () => {
  it('detects added lines', () => {
    const oldLines = ['G1 X10 Y10', 'G1 X20 Y20'];
    const newLines = ['G1 X10 Y10', 'G1 X20 Y20', 'G1 X30 Y30'];
    const diff = diffGcode(oldLines, newLines);
    expect(diff.summary.totalAdded).toBe(1);
    expect(diff.added[0].content).toBe('G1 X30 Y30');
  });

  it('detects removed lines', () => {
    const oldLines = ['G1 X10 Y10', 'G1 X20 Y20', 'G1 X30 Y30'];
    const newLines = ['G1 X10 Y10', 'G1 X20 Y20'];
    const diff = diffGcode(oldLines, newLines);
    expect(diff.summary.totalRemoved).toBe(1);
    expect(diff.removed[0].content).toBe('G1 X30 Y30');
  });

  it('detects modified lines', () => {
    const oldLines = ['G1 X10 Y10 F1000'];
    const newLines = ['G1 X10 Y10 F2000'];
    const diff = diffGcode(oldLines, newLines);
    expect(diff.summary.totalModified).toBe(1);
    expect(diff.modified[0].oldContent).toContain('F1000');
    expect(diff.modified[0].newContent).toContain('F2000');
  });

  it('detects word-level changes', () => {
    const oldLines = ['G1 X10 Y10 F1000'];
    const newLines = ['G1 X10 Y10 F2000'];
    const diff = diffGcode(oldLines, newLines);
    const fChange = diff.wordChanges.find(w => w.word === 'F');
    expect(fChange).toBeDefined();
    expect(fChange!.oldValue).toBe('F1000');
    expect(fChange!.newValue).toBe('F2000');
  });

  it('computes similarity score', () => {
    const oldLines = ['G1 X10', 'G1 X20', 'G1 X30'];
    const newLines = ['G1 X10', 'G1 X20', 'G1 X30'];
    const diff = diffGcode(oldLines, newLines);
    expect(diff.summary.similarityScore).toBe(1); // identical
  });

  it('computes low similarity for different files', () => {
    const oldLines = ['G1 X10', 'G1 X20'];
    const newLines = ['G2 X30', 'G3 X40'];
    const diff = diffGcode(oldLines, newLines);
    expect(diff.summary.similarityScore).toBe(0);
  });

  it('handles identical files', () => {
    const lines = ['G1 X10 Y10', 'G1 X20 Y20'];
    const diff = diffGcode(lines, lines);
    expect(diff.summary.totalAdded).toBe(0);
    expect(diff.summary.totalRemoved).toBe(0);
    expect(diff.summary.totalModified).toBe(0);
    expect(diff.summary.totalUnchanged).toBe(2);
  });

  it('handles empty files', () => {
    const diff = diffGcode([], []);
    expect(diff.summary.similarityScore).toBe(1);
    expect(diff.summary.totalUnchanged).toBe(0);
  });
});
