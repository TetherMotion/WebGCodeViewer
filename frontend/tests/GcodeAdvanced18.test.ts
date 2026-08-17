/**
 * @file GcodeAdvanced18.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced18 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzePerToolPathLength,
  analyzeOozePrevention,
  analyzeCoordinateSystems,
  analyzeSpindleSpeedVariation,
  predictBridgeQuality,
  analyzeModalGroups,
  simulateFeedRateOverride,
  analyzeFanCurve,
  analyzeSubprogramComplexity,
  countDirectionReversals,
  optimizeZSeamAlignment,
  assessExecutionRisk,
} from "@tether/gcode-analyzer/GcodeAdvanced18";

// ── 1. Per-Tool Path Length ──

describe('analyzePerToolPathLength', () => {
  it('tracks per-tool distance', () => {
    const lines = ['M6 T1', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500', 'M6 T2', 'G1 X30 Y0 Z-1 F500'];
    const result = analyzePerToolPathLength(lines);
    expect(result.tools.length).toBe(2);
    expect(result.tools[0].cuttingDistance).toBeGreaterThan(0);
  });

  it('identifies busiest tool', () => {
    const lines = ['M6 T1', 'G1 X10 Y0 Z-1 F500', 'M6 T2', 'G1 X5 Y0 Z-1 F500'];
    const result = analyzePerToolPathLength(lines);
    expect(result.busiestTool).not.toBeNull();
    expect(result.busiestTool!.tool).toBe(1);
  });

  it('handles no tool changes', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = analyzePerToolPathLength(lines);
    expect(result.toolCount).toBe(0);
  });
});

// ── 2. Ooze Prevention ──

describe('analyzeOozePrevention', () => {
  it('analyzes ooze prevention', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E3 F1800', 'G1 X20 Y20 E5 F1800'];
    const result = analyzeOozePrevention(lines);
    expect(result.retractionCount).toBeGreaterThan(0);
  });

  it('computes prevention score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E3 F1800'];
    const result = analyzeOozePrevention(lines);
    expect(result.preventionScore).toBeGreaterThanOrEqual(0);
    expect(result.preventionScore).toBeLessThanOrEqual(100);
  });

  it('handles no retraction', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = analyzeOozePrevention(lines);
    expect(result.retractionCount).toBe(0);
    expect(result.riskLevel).toBe('high');
  });
});

// ── 3. Coordinate System Analyzer ──

describe('analyzeCoordinateSystems', () => {
  it('analyzes coordinate systems', () => {
    const lines = ['G28', 'G54', 'G1 X10 Y10 F500', 'G55', 'G1 X20 Y20 F500'];
    const result = analyzeCoordinateSystems(lines);
    expect(result.systems.length).toBe(2);
    expect(result.hasHoming).toBe(true);
  });

  it('tracks system changes', () => {
    const lines = ['G54', 'G55', 'G56', 'G54'];
    const result = analyzeCoordinateSystems(lines);
    expect(result.systemChanges).toBe(3);
  });

  it('handles no WCS', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeCoordinateSystems(lines);
    expect(result.systems.length).toBe(0);
    expect(result.hasHoming).toBe(false);
  });
});

// ── 4. Spindle Speed Variation ──

describe('analyzeSpindleSpeedVariation', () => {
  it('tracks spindle variations', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500', 'S8000', 'G1 X20 Y0 F500', 'S3000'];
    const result = analyzeSpindleSpeedVariation(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500', 'S5000'];
    const result = analyzeSpindleSpeedVariation(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no spindle', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = analyzeSpindleSpeedVariation(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 5. Bridge Quality Predictor ──

describe('predictBridgeQuality', () => {
  it('predicts bridge quality', () => {
    const lines = ['M106 S255', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X50 Y10 E20 F1800 Z0.2'];
    const result = predictBridgeQuality(lines);
    expect(result.bridges.length).toBeGreaterThan(0);
  });

  it('computes quality score', () => {
    const lines = ['M106 S255', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X50 Y10 E20 F1800 Z0.2'];
    const result = predictBridgeQuality(lines);
    expect(result.avgQualityScore).toBeGreaterThanOrEqual(0);
    expect(result.avgQualityScore).toBeLessThanOrEqual(100);
  });

  it('handles no bridges', () => {
    const lines = ['G0 X10 Y10'];
    const result = predictBridgeQuality(lines);
    expect(result.bridgeCount).toBe(0);
  });
});

// ── 6. Modal Group Analyzer ──

describe('analyzeModalGroups', () => {
  it('analyzes modal groups', () => {
    const lines = ['G21 G90', 'G1 X10 Y10 F500', 'G0 X0 Y0', 'G1 X20 Y20 F500'];
    const result = analyzeModalGroups(lines);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it('detects redundant commands', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500', 'G1 X30 Y30 F500'];
    const result = analyzeModalGroups(lines);
    expect(result.redundantCommands).toBeGreaterThan(0);
  });

  it('computes modal score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeModalGroups(lines);
    expect(result.modalScore).toBeGreaterThanOrEqual(0);
    expect(result.modalScore).toBeLessThanOrEqual(100);
  });
});

// ── 7. Feed Rate Override Simulator ──

describe('simulateFeedRateOverride', () => {
  it('simulates feed override', () => {
    const lines = ['G1 X100 Y0 F500'];
    const result = simulateFeedRateOverride(lines, 120);
    expect(result.adjustedFeedRate).toBeGreaterThan(result.originalFeedRate);
    expect(result.timeSaved).toBeGreaterThan(0);
  });

  it('computes time saved', () => {
    const lines = ['G1 X100 Y0 F500', 'G1 X200 Y0 F500'];
    const result = simulateFeedRateOverride(lines, 150);
    expect(result.timeSavedPercentage).toBeGreaterThan(0);
  });

  it('checks safety', () => {
    const lines = ['G1 X100 Y0 F500'];
    const result = simulateFeedRateOverride(lines, 200, 150);
    expect(result.safe).toBe(false);
  });

  it('handles no motion', () => {
    const lines = ['M3 S1000'];
    const result = simulateFeedRateOverride(lines, 120);
    expect(result.originalTime).toBe(0);
  });
});

// ── 8. Fan Curve Analyzer ──

describe('analyzeFanCurve', () => {
  it('analyzes fan curve', () => {
    const lines = ['M107', 'G1 X10 Y10 E5 F1800 Z0.2', 'M106 S128', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = analyzeFanCurve(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('tracks fan speed changes', () => {
    const lines = ['M107', 'G1 X10 Y10 E5 F1800 Z0.2', 'M106 S255', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = analyzeFanCurve(lines);
    expect(result.changeCount).toBeGreaterThan(0);
  });

  it('handles no fan commands', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2'];
    const result = analyzeFanCurve(lines);
    expect(result.changeCount).toBe(0);
  });
});

// ── 9. Subprogram Complexity ──

describe('analyzeSubprogramComplexity', () => {
  it('analyzes subprograms', () => {
    const lines = ['O100', 'G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'M99', 'M98 P100'];
    const result = analyzeSubprogramComplexity(lines);
    expect(result.subprograms.length).toBeGreaterThan(0);
  });

  it('computes complexity score', () => {
    const lines = ['O100', 'G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'M99'];
    const result = analyzeSubprogramComplexity(lines);
    expect(result.subprograms[0].complexityScore).toBeGreaterThan(0);
  });

  it('handles no subprograms', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = analyzeSubprogramComplexity(lines);
    expect(result.subprogramCount).toBe(0);
  });
});

// ── 10. Direction Reversal Counter ──

describe('countDirectionReversals', () => {
  it('counts reversals', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X5 Y0 F500', 'G1 X15 Y0 F500'];
    const result = countDirectionReversals(lines);
    expect(result.reversalCount).toBeGreaterThan(0);
  });

  it('computes smoothness score', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = countDirectionReversals(lines);
    expect(result.smoothnessScore).toBeGreaterThanOrEqual(0);
    expect(result.smoothnessScore).toBeLessThanOrEqual(100);
  });

  it('handles no reversals', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = countDirectionReversals(lines);
    expect(result.reversalCount).toBe(0);
  });
});

// ── 11. Z-seam Alignment Optimizer ──

describe('optimizeZSeamAlignment', () => {
  it('optimizes Z-seam', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X10 Y10 E15 F1800 Z0.4',
      'G1 X20 Y10 E20 F1800 Z0.4',
    ];
    const result = optimizeZSeamAlignment(lines);
    expect(result.positions.length).toBeGreaterThan(0);
  });

  it('computes alignment score', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X10 Y10 E15 F1800 Z0.4',
    ];
    const result = optimizeZSeamAlignment(lines);
    expect(result.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(result.alignmentScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = optimizeZSeamAlignment(lines);
    expect(result.positions).toEqual([]);
  });
});

// ── 12. Execution Risk Assessment ──

describe('assessExecutionRisk', () => {
  it('assesses execution risk', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = assessExecutionRisk(lines);
    expect(result.factors.length).toBeGreaterThan(0);
    expect(result.riskLevel).toBe('high');
  });

  it('passes safe G-code', () => {
    const lines = ['G28', 'M3 S5000', 'M6 T1', 'G1 X10 Y0 Z-1 F500', 'M30'];
    const result = assessExecutionRisk(lines);
    expect(result.safeToExecute).toBe(true);
  });

  it('computes risk score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = assessExecutionRisk(lines);
    expect(result.overallRiskScore).toBeGreaterThan(0);
    expect(result.overallRiskScore).toBeLessThanOrEqual(100);
  });

  it('detects rapid into material', () => {
    const lines = ['G28', 'M3 S5000', 'G0 X10 Y0 Z-1'];
    const result = assessExecutionRisk(lines);
    expect(result.factors.some(f => f.name === 'rapid_into_material')).toBe(true);
  });
});
