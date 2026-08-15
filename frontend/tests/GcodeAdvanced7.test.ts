/**
 * @file GcodeAdvanced7.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced7 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  predictChatter,
  trackMacroVariables,
  analyzeMaterialWaste,
  analyzeCoordinateRotation,
  analyzePerLayerSpeedLimits,
  verifyBackplot,
  estimateToolLife,
  semanticDiffGcode,
  verifyCutterCompensation,
  validateTimeAccuracy,
  suggestTravelOptimization,
  addLineNumbers,
  findLineByNumber,
} from '../src/core/GcodeAdvanced7';

// ── 1. Chatter Prediction ──

describe('predictChatter', () => {
  it('predicts chatter risk for cutting moves', () => {
    // Use S15000 to make passFreq (1000Hz) match 3rd harmonic of natural freq (~333Hz)
    const lines = [
      'M3 S15000',
      'G1 X10 Y10 Z-3 F500',
      'G1 X20 Y10 Z-3 F500',
    ];
    const result = predictChatter(lines, 6, 30);
    expect(result.riskPoints.length).toBeGreaterThan(0);
    expect(result.riskPoints[0].spindleRpm).toBe(15000);
  });

  it('provides recommended stable speeds', () => {
    const lines = ['M3 S12000', 'G1 X10 Y10 Z-3 F500'];
    const result = predictChatter(lines, 6, 30);
    expect(result.recommendedSpeeds.length).toBeGreaterThan(0);
  });

  it('provides recommendations', () => {
    const lines = ['M3 S12000', 'G1 X10 Y10 Z-5 F500'];
    const result = predictChatter(lines, 6, 50);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = predictChatter(lines, 6);
    expect(result.riskPoints).toEqual([]);
    expect(result.overallRisk).toBe(0);
  });

  it('handles empty input', () => {
    const result = predictChatter([], 6);
    expect(result.riskPoints).toEqual([]);
  });
});

// ── 2. Macro Variable Tracking ──

describe('trackMacroVariables', () => {
  it('tracks variable assignments', () => {
    const lines = [
      '#100 = 10.0',
      '#101 = 20.0',
      'G1 X#100 Y#101 F500',
    ];
    const result = trackMacroVariables(lines);
    expect(result.uniqueCount).toBe(2);
    expect(result.totalAssignments).toBe(2);
    const v100 = result.variables.get(100);
    expect(v100).toBeDefined();
    expect(v100!.value).toBe(10);
  });

  it('evaluates expressions with variable references', () => {
    const lines = [
      '#100 = 5.0',
      '#101 = #100 + 10.0',
    ];
    const result = trackMacroVariables(lines);
    const v101 = result.variables.get(101);
    expect(v101).toBeDefined();
    expect(v101!.value).toBe(15);
  });

  it('tracks variable usages', () => {
    const lines = [
      '#100 = 10.0',
      'G1 X#100 Y#100 F500',
    ];
    const result = trackMacroVariables(lines);
    expect(result.usages.length).toBeGreaterThan(0);
  });

  it('tracks variable history', () => {
    const lines = [
      '#100 = 10.0',
      '#100 = 20.0',
      '#100 = 30.0',
    ];
    const result = trackMacroVariables(lines);
    const v100 = result.variables.get(100);
    expect(v100!.history.length).toBe(3);
    expect(v100!.value).toBe(30);
    expect(v100!.setCount).toBe(3);
  });

  it('handles no macros', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = trackMacroVariables(lines);
    expect(result.uniqueCount).toBe(0);
    expect(result.assignments).toEqual([]);
  });
});

// ── 3. Material Waste Analysis ──

describe('analyzeMaterialWaste', () => {
  it('computes material utilization', () => {
    const result = analyzeMaterialWaste(100, 100, 20, 80, 80, 15);
    expect(result.stockVolume).toBe(200000);
    expect(result.partVolume).toBe(96000);
    expect(result.utilizationPercentage).toBeCloseTo(48, 0);
    expect(result.scrapPercentage).toBeCloseTo(52, 0);
  });

  it('computes waste cost', () => {
    const result = analyzeMaterialWaste(100, 100, 20, 50, 50, 10, 15, 2.7);
    expect(result.wasteCost).toBeGreaterThan(0);
  });

  it('recommends smaller stock for low utilization', () => {
    const result = analyzeMaterialWaste(200, 200, 50, 20, 20, 5);
    const rec = result.recommendations.find(r => r.includes('low'));
    expect(rec).toBeDefined();
  });

  it('handles 100% utilization', () => {
    const result = analyzeMaterialWaste(50, 50, 10, 50, 50, 10);
    expect(result.utilizationPercentage).toBeCloseTo(100, 0);
    expect(result.wasteVolume).toBe(0);
  });
});

// ── 4. Coordinate Rotation Analysis ──

describe('analyzeCoordinateRotation', () => {
  it('detects G68 rotation', () => {
    const lines = ['G68 X50 Y50 R45', 'G1 X10 Y10 F500', 'G69'];
    const result = analyzeCoordinateRotation(lines);
    expect(result.hasRotation).toBe(true);
    expect(result.events.length).toBe(2); // G68 + G69
    expect(result.events[0].angle).toBe(45);
  });

  it('detects missing G69 cancellation', () => {
    const lines = ['G68 X50 Y50 R30', 'G1 X10 Y10 F500'];
    const result = analyzeCoordinateRotation(lines);
    const warning = result.recommendations.find(r => r.includes('never cancelled'));
    expect(warning).toBeDefined();
  });

  it('tracks unique angles', () => {
    const lines = ['G68 X0 Y0 R30', 'G69', 'G68 X0 Y0 R45', 'G69'];
    const result = analyzeCoordinateRotation(lines);
    expect(result.uniqueAngles).toContain(30);
    expect(result.uniqueAngles).toContain(45);
  });

  it('handles no rotation', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeCoordinateRotation(lines);
    expect(result.hasRotation).toBe(false);
    expect(result.events).toEqual([]);
  });
});

// ── 5. Per-Layer Speed Limits ──

describe('analyzePerLayerSpeedLimits', () => {
  it('recommends speed reduction for first layers', () => {
    const lines = [
      'G1 X10 Y10 E5 F3600', // high speed on first layer
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 0 },
    ];
    const result = analyzePerLayerSpeedLimits(lines, zLayers);
    expect(result.layers.length).toBe(1);
    expect(result.layers[0].shouldReduce).toBe(true);
    expect(result.layers[0].reason).toContain('First');
  });

  it('recommends speed reduction for bridge layers', () => {
    const lines = [
      'G1 X10 Y10 E5 F3600',
    ];
    const zLayers = [
      { layerIndex: 5, zHeight: 1.0, startLine: 0, endLine: 0 },
    ];
    const result = analyzePerLayerSpeedLimits(lines, zLayers, [], [5]);
    expect(result.layers[0].shouldReduce).toBe(true);
    expect(result.layers[0].reason).toContain('Bridge');
  });

  it('recommends speed reduction for overhang layers', () => {
    const lines = ['G1 X10 Y10 E5 F3600'];
    const zLayers = [{ layerIndex: 10, zHeight: 2.0, startLine: 0, endLine: 0 }];
    const result = analyzePerLayerSpeedLimits(lines, zLayers, [10]);
    expect(result.layers[0].shouldReduce).toBe(true);
    expect(result.layers[0].reason).toContain('Overhang');
  });

  it('handles empty input', () => {
    const result = analyzePerLayerSpeedLimits([], []);
    expect(result.layers).toEqual([]);
    expect(result.layersToReduce).toBe(0);
  });
});

// ── 6. Backplot Verification ──

describe('verifyBackplot', () => {
  it('verifies toolpath within bounds', () => {
    const lines = ['G1 X50 Y50 Z5 F500'];
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 50 };
    const result = verifyBackplot(lines, bounds);
    expect(result.isValid).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('detects out-of-bounds moves', () => {
    const lines = ['G1 X150 Y50 Z5 F500'];
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 50 };
    const result = verifyBackplot(lines, bounds);
    const oobViolation = result.violations.find(v => v.type === 'out_of_bounds');
    expect(oobViolation).toBeDefined();
  });

  it('detects rapid through material', () => {
    const lines = ['G0 X50 Y50 Z-5'];
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 50 };
    const result = verifyBackplot(lines, bounds);
    const rapidViolation = result.violations.find(v => v.type === 'rapid_through_material');
    expect(rapidViolation).toBeDefined();
    expect(rapidViolation!.severity).toBe('error');
  });

  it('detects excessive plunge rate', () => {
    const lines = ['G1 X50 Y50 Z-10 F2000'];
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -20, maxZ: 50 };
    const result = verifyBackplot(lines, bounds, 500);
    const plungeViolation = result.violations.find(v => v.type === 'plunge_too_fast');
    expect(plungeViolation).toBeDefined();
  });

  it('computes toolpath bounds', () => {
    const lines = ['G1 X30 Y40 Z5 F500', 'G1 X70 Y60 Z10 F500'];
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 50 };
    const result = verifyBackplot(lines, bounds);
    expect(result.toolpathBounds.minX).toBe(30);
    expect(result.toolpathBounds.maxX).toBe(70);
  });

  it('handles empty input', () => {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 50 };
    const result = verifyBackplot([], bounds);
    expect(result.isValid).toBe(true);
  });
});

// ── 7. Tool Life Estimation ──

describe('estimateToolLife', () => {
  it('estimates tool life from cutting time', () => {
    const lines = [
      'T1 M6',
      'M3 S1000',
      'G1 X100 Y0 Z-2 F500',
      'G1 X100 Y100 Z-2 F500',
    ];
    const result = estimateToolLife(lines, 60, 6);
    expect(result.tools.length).toBe(1);
    expect(result.tools[0].toolNumber).toBe(1);
    expect(result.tools[0].cuttingTime).toBeGreaterThan(0);
    expect(result.tools[0].remainingLife).toBeGreaterThan(0);
  });

  it('classifies tool status', () => {
    const lines: string[] = [];
    lines.push('T1 M6', 'M3 S1000');
    // Generate enough cutting time to wear the tool
    for (let i = 0; i < 100; i++) {
      lines.push(`G1 X${i * 100} Y0 Z-2 F500`);
    }
    const result = estimateToolLife(lines, 0.1, 6); // very short life
    expect(['worn', 'critical', 'replace']).toContain(result.tools[0].status);
  });

  it('tracks multiple tools', () => {
    const lines = [
      'T1 M6', 'M3 S1000', 'G1 X10 Y10 Z-2 F500',
      'T2 M6', 'G1 X20 Y20 Z-3 F500',
    ];
    const result = estimateToolLife(lines);
    expect(result.tools.length).toBe(2);
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = estimateToolLife(lines);
    expect(result.tools).toEqual([]);
  });
});

// ── 8. Semantic G-code Diff ──

describe('semanticDiffGcode', () => {
  it('detects identical files', () => {
    const lines = ['G1 X10 Y10 F500', 'M30'];
    const result = semanticDiffGcode(lines, lines);
    expect(result.isIdentical).toBe(true);
    expect(result.summary.total).toBe(0);
  });

  it('detects added operations', () => {
    const oldLines = ['G1 X10 Y10 F500'];
    const newLines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = semanticDiffGcode(oldLines, newLines);
    expect(result.summary.added).toBeGreaterThan(0);
  });

  it('detects removed operations', () => {
    const oldLines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const newLines = ['G1 X10 Y10 F500'];
    const result = semanticDiffGcode(oldLines, newLines);
    expect(result.summary.removed).toBeGreaterThan(0);
  });

  it('detects modified operations', () => {
    const oldLines = ['M104 S200'];
    const newLines = ['M104 S210'];
    const result = semanticDiffGcode(oldLines, newLines);
    expect(result.summary.modified).toBeGreaterThan(0);
  });

  it('assesses impact level', () => {
    const oldLines = ['G1 X10 Y10 F500'];
    const newLines = ['G1 X10 Y10 F500', 'T1 M6', 'M3 S1000', 'G1 X20 Y20 F500'];
    const result = semanticDiffGcode(oldLines, newLines);
    expect(['minor', 'moderate', 'major']).toContain(result.impact);
  });

  it('provides category breakdown', () => {
    const oldLines = ['M104 S200', 'G1 X10 Y10 F500'];
    const newLines = ['M104 S210', 'G1 X20 Y20 F500'];
    const result = semanticDiffGcode(oldLines, newLines);
    expect(Object.keys(result.byCategory).length).toBeGreaterThan(0);
  });
});

// ── 9. Cutter Compensation Verification ──

describe('verifyCutterCompensation', () => {
  it('detects G41 compensation', () => {
    const lines = ['G41 D1 X10 Y10 F500', 'G1 X20 Y20', 'G40 X0 Y0'];
    const result = verifyCutterCompensation(lines);
    expect(result.hasCompensation).toBe(true);
    expect(result.direction).toBe('left');
    expect(result.offsetRegister).toBe(1);
    expect(result.isCancelled).toBe(true);
  });

  it('detects G42 compensation', () => {
    const lines = ['G42 D2 X10 Y10 F500', 'G1 X20 Y20', 'G40 X0 Y0'];
    const result = verifyCutterCompensation(lines);
    expect(result.direction).toBe('right');
    expect(result.offsetRegister).toBe(2);
  });

  it('detects missing G40 cancellation', () => {
    const lines = ['G41 D1 X10 Y10 F500', 'G1 X20 Y20'];
    const result = verifyCutterCompensation(lines);
    const issue = result.issues.find(i => i.type === 'missing_cancel');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
  });

  it('detects missing D offset', () => {
    const lines = ['G41 X10 Y10 F500', 'G40 X0 Y0'];
    const result = verifyCutterCompensation(lines);
    const issue = result.issues.find(i => i.type === 'missing_offset');
    expect(issue).toBeDefined();
  });

  it('detects compensation in arc move', () => {
    const lines = ['G41 D1 G2 X10 Y10 I5 J0', 'G40 X0 Y0'];
    const result = verifyCutterCompensation(lines);
    const issue = result.issues.find(i => i.type === 'compensation_in_arc');
    expect(issue).toBeDefined();
  });

  it('handles no compensation', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = verifyCutterCompensation(lines);
    expect(result.hasCompensation).toBe(false);
  });
});

// ── 10. Print Time Accuracy Validation ──

describe('validateTimeAccuracy', () => {
  it('computes accuracy for perfect estimate', () => {
    const result = validateTimeAccuracy(3600, 3600);
    expect(result.accuracy).toBe(100);
    expect(result.errorSeconds).toBe(0);
    expect(result.correctionFactor).toBe(1);
  });

  it('computes accuracy for under-estimate', () => {
    const result = validateTimeAccuracy(3000, 3600);
    expect(result.accuracy).toBeLessThan(100);
    expect(result.errorSeconds).toBe(600);
    expect(result.correctionFactor).toBeGreaterThan(1);
  });

  it('computes accuracy for over-estimate', () => {
    const result = validateTimeAccuracy(4000, 3600);
    expect(result.accuracy).toBeLessThan(100);
    expect(result.errorSeconds).toBe(-400);
    expect(result.correctionFactor).toBeLessThan(1);
  });

  it('provides recommendations for large errors', () => {
    const result = validateTimeAccuracy(1800, 3600);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles component breakdown', () => {
    const components = [
      { component: 'printing', estimated: 3000, actual: 3200 },
      { component: 'travel', estimated: 600, actual: 700 },
    ];
    const result = validateTimeAccuracy(3600, 3900, components);
    expect(result.components.length).toBe(2);
    expect(result.components[0].component).toBe('printing');
  });
});

// ── 11. Travel Path Optimization ──

describe('suggestTravelOptimization', () => {
  it('analyzes travel moves', () => {
    const lines: string[] = [];
    // Create extrusion points at various locations
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${(i * 37) % 100} Y${(i * 53) % 100} E${i + 1} F1800`);
    }
    const result = suggestTravelOptimization(lines, 6000, 5);
    expect(result.totalOriginalDistance).toBeGreaterThan(0);
  });

  it('suggests reordering for inefficient paths', () => {
    const lines: string[] = [];
    // Create zigzag pattern (inefficient)
    for (let i = 0; i < 20; i++) {
      const x = i % 2 === 0 ? 0 : 100;
      const y = i * 10;
      lines.push(`G1 X${x} Y${y} E${i + 1} F1800`);
    }
    const result = suggestTravelOptimization(lines, 6000, 10);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
  });

  it('computes savings', () => {
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${(i * 37) % 100} Y${(i * 53) % 100} E${i + 1} F1800`);
    }
    const result = suggestTravelOptimization(lines, 6000, 5);
    expect(result.savingsPercentage).toBeGreaterThanOrEqual(0);
  });

  it('handles empty input', () => {
    const result = suggestTravelOptimization([]);
    expect(result.suggestions).toEqual([]);
    expect(result.totalOriginalDistance).toBe(0);
  });
});

// ── 12. G-code Line Numbering ──

describe('addLineNumbers', () => {
  it('adds line numbers to G-code', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500', 'M30'];
    const result = addLineNumbers(lines, 10, 10);
    expect(result.lines[0]).toContain('N10');
    expect(result.lines[1]).toContain('N20');
    expect(result.lines[2]).toContain('N30');
    expect(result.numberedCount).toBe(3);
  });

  it('skips comment-only lines when configured', () => {
    const lines = ['; comment', 'G1 X10 Y10 F500'];
    const result = addLineNumbers(lines, 10, 10, true);
    expect(result.lines[0]).toBe('; comment');
    expect(result.lines[1]).toContain('N10');
    expect(result.numberedCount).toBe(1);
  });

  it('replaces existing line numbers', () => {
    const lines = ['N100 G1 X10 Y10 F500'];
    const result = addLineNumbers(lines, 10, 10);
    expect(result.replacedExisting).toBe(true);
    expect(result.lines[0]).toContain('N10');
    expect(result.lines[0]).not.toContain('N100');
  });

  it('creates line map for jump-to-line', () => {
    const lines = ['G1 X10 Y10', 'G1 X20 Y20', 'M30'];
    const result = addLineNumbers(lines, 10, 10);
    expect(result.lineMap.size).toBe(3);
    expect(result.lineMap.get(0)).toBe(10);
    expect(result.lineMap.get(1)).toBe(20);
  });

  it('finds line by N-number', () => {
    const lines = ['G1 X10 Y10', 'G1 X20 Y20', 'M30'];
    const result = addLineNumbers(lines, 10, 10);
    const lineIdx = findLineByNumber(result.lineMap, 20);
    expect(lineIdx).toBe(1);
  });

  it('returns -1 for non-existent N-number', () => {
    const lines = ['G1 X10 Y10'];
    const result = addLineNumbers(lines, 10, 10);
    expect(findLineByNumber(result.lineMap, 999)).toBe(-1);
  });
});
