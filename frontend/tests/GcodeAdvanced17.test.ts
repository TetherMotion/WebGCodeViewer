/**
 * @file GcodeAdvanced17.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced17 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeIdleTime,
  quantifyToolpathOverlap,
  adviseFlowRateCalibration,
  estimateMemoryUsage,
  validateCuttingParameters,
  detectLayerShiftRisk,
  optimizeExecutionPath,
  calculateNoseRadiusCompensation,
  analyzeElephantFoot,
  analyzeCommentDensity,
  optimizeRapidTraverse,
  analyzeSkirtBrim,
} from "@tether/gcode-analyzer/GcodeAdvanced17";

// ── 1. Idle Time Analyzer ──

describe('analyzeIdleTime', () => {
  it('analyzes idle time', () => {
    const lines = ['M6 T1', 'G1 X10 Y10 F500', 'G4 P1000', 'G1 X20 Y20 F500'];
    const result = analyzeIdleTime(lines);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.totalIdleTime).toBeGreaterThan(0);
  });

  it('categorizes idle types', () => {
    const lines = ['M6 T1', 'G4 P1000', 'G0 X50 Y50'];
    const result = analyzeIdleTime(lines);
    expect(result.byType.tool_change).toBeDefined();
    expect(result.byType.dwell).toBeDefined();
  });

  it('computes efficiency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = analyzeIdleTime(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });
});

// ── 2. Toolpath Overlap Quantifier ──

describe('quantifyToolpathOverlap', () => {
  it('quantifies overlap', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500', 'G1 X15 Y0 Z-1 F500'];
    const result = quantifyToolpathOverlap(lines, 5);
    expect(result.regions.length).toBe(25);
  });

  it('computes overlap percentage', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = quantifyToolpathOverlap(lines, 5);
    expect(result.avgOverlap).toBeGreaterThanOrEqual(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = quantifyToolpathOverlap(lines);
    expect(result.regions).toEqual([]);
  });
});

// ── 3. Flow Rate Calibration ──

describe('adviseFlowRateCalibration', () => {
  it('advises flow rate', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = adviseFlowRateCalibration(lines);
    expect(result.estimatedWidth).toBeGreaterThan(0);
  });

  it('computes width deviation', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = adviseFlowRateCalibration(lines);
    expect(typeof result.widthDeviation).toBe('number');
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = adviseFlowRateCalibration(lines);
    expect(result.calibrationScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 4. Memory Usage Estimator ──

describe('estimateMemoryUsage', () => {
  it('estimates memory', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500', '; comment'];
    const result = estimateMemoryUsage(lines);
    expect(result.totalMemory).toBeGreaterThan(0);
  });

  it('computes memory pressure', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = estimateMemoryUsage(lines);
    expect(['low', 'medium', 'high']).toContain(result.pressureLevel);
  });

  it('handles empty input', () => {
    const result = estimateMemoryUsage([]);
    expect(result.totalMemory).toBe(0);
  });
});

// ── 5. Cutting Parameter Validator ──

describe('validateCuttingParameters', () => {
  it('validates parameters', () => {
    const lines = ['M3 S30000', 'G1 X10 Y0 Z-10 F10000'];
    const result = validateCuttingParameters(lines, 'aluminum');
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('passes valid parameters', () => {
    const lines = ['M3 S8000', 'G1 X10 Y0 Z-1 F1000'];
    const result = validateCuttingParameters(lines, 'aluminum');
    expect(result.count).toBe(0);
  });

  it('computes validation score', () => {
    const lines = ['M3 S8000', 'G1 X10 Y0 Z-1 F1000'];
    const result = validateCuttingParameters(lines, 'aluminum');
    expect(result.validationScore).toBeGreaterThanOrEqual(0);
    expect(result.validationScore).toBeLessThanOrEqual(100);
  });
});

// ── 6. Layer Shift Risk Detector ──

describe('detectLayerShiftRisk', () => {
  it('detects layer shift risk', () => {
    const lines = [
      'G1 X10 Y10 E5 F5000 Z0.2',
      'G0 X100 Y100',
      'G1 X20 Y20 E10 F5000 Z0.4',
    ];
    const result = detectLayerShiftRisk(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes overall risk', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = detectLayerShiftRisk(lines);
    expect(['low', 'medium', 'high']).toContain(result.overallRisk);
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = detectLayerShiftRisk(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 7. Execution Path Optimizer ──

describe('optimizeExecutionPath', () => {
  it('identifies optimizations', () => {
    const lines = ['G0 X100 Y0 F5000', 'G1 X110 Y0 Z-1 F500', 'M6 T1', 'M6 T2', 'M6 T3', 'G4 P10000'];
    const result = optimizeExecutionPath(lines);
    expect(result.optimizations.length).toBeGreaterThan(0);
  });

  it('computes time saved', () => {
    const lines = ['G0 X100 Y0', 'G1 X110 Y0 Z-1 F500'];
    const result = optimizeExecutionPath(lines);
    expect(result.totalTimeSaved).toBeGreaterThanOrEqual(0);
  });

  it('handles no optimizations', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = optimizeExecutionPath(lines);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 8. Nose Radius Compensation ──

describe('calculateNoseRadiusCompensation', () => {
  it('calculates compensation with G41', () => {
    const lines = ['G41', 'G1 X10 Y0 F500', 'G1 X10 Y10 F500', 'G40'];
    const result = calculateNoseRadiusCompensation(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('handles no compensation', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X10 Y10 F500'];
    const result = calculateNoseRadiusCompensation(lines);
    expect(result.pointCount).toBe(0);
  });

  it('uses specified direction', () => {
    const lines = ['G42', 'G1 X10 Y0 F500', 'G40'];
    const result = calculateNoseRadiusCompensation(lines);
    expect(result.points[0].direction).toBe('right');
  });
});

// ── 9. Elephant Foot Analyzer ──

describe('analyzeElephantFoot', () => {
  it('analyzes elephant foot', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.1', 'G1 X20 Y10 E10 F1800 Z0.1'];
    const result = analyzeElephantFoot(lines);
    expect(result.firstLayerZ).toBe(0.1);
  });

  it('computes squish ratio', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeElephantFoot(lines);
    expect(result.squishRatio).toBeGreaterThan(0);
  });

  it('determines severity', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2'];
    const result = analyzeElephantFoot(lines);
    expect(['none', 'minor', 'moderate', 'severe']).toContain(result.severity);
  });
});

// ── 10. Comment Density Analyzer ──

describe('analyzeCommentDensity', () => {
  it('analyzes comment density', () => {
    const lines = ['; This is a comment', 'G1 X10 Y10 F500', '; Another comment'];
    const result = analyzeCommentDensity(lines);
    expect(result.commentLines).toBe(2);
  });

  it('detects section headers', () => {
    const lines = ['; --- SECTION ---', 'G1 X10 Y10 F500'];
    const result = analyzeCommentDensity(lines);
    expect(result.sectionHeaders).toBeGreaterThan(0);
  });

  it('computes documentation score', () => {
    const lines = ['; comment', 'G1 X10 Y10 F500'];
    const result = analyzeCommentDensity(lines);
    expect(result.documentationScore).toBeGreaterThanOrEqual(0);
    expect(result.documentationScore).toBeLessThanOrEqual(100);
  });

  it('handles no comments', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeCommentDensity(lines);
    expect(result.commentLines).toBe(0);
  });
});

// ── 11. Rapid Traverse Optimizer ──

describe('optimizeRapidTraverse', () => {
  it('identifies rapid optimizations', () => {
    const lines = ['G0 X100 Y100 Z50', 'G1 X110 Y110 Z-1 F500'];
    const result = optimizeRapidTraverse(lines);
    expect(result.totalRapidDistance).toBeGreaterThan(0);
  });

  it('computes savings', () => {
    const lines = ['G0 X200 Y0', 'G1 X210 Y0 Z-1 F500'];
    const result = optimizeRapidTraverse(lines);
    expect(result.savingsPercentage).toBeGreaterThanOrEqual(0);
  });

  it('handles no rapids', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = optimizeRapidTraverse(lines);
    expect(result.totalRapidDistance).toBe(0);
  });
});

// ── 12. Skirt/Brim Analyzer ──

describe('analyzeSkirtBrim', () => {
  it('analyzes skirt/brim', () => {
    const lines = [
      'G1 X0 Y0 E5 F1800 Z0.2',
      'G1 X50 Y0 E10 F1800 Z0.2',
      'G1 X50 Y50 E15 F1800 Z0.2',
      'G1 X10 Y10 E20 F1800 Z0.4',
      'G1 X40 Y40 E25 F1800 Z0.4',
    ];
    const result = analyzeSkirtBrim(lines);
    expect(result.data.lineCount).toBeGreaterThan(0);
  });

  it('handles no skirt/brim', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeSkirtBrim(lines);
    expect(result.detected).toBe(false);
  });

  it('computes adhesion benefit', () => {
    const lines = ['G1 X0 Y0 E5 F1800 Z0.2', 'G1 X50 Y0 E10 F1800 Z0.2'];
    const result = analyzeSkirtBrim(lines);
    expect(result.adhesionBenefitScore).toBeGreaterThanOrEqual(0);
  });
});
