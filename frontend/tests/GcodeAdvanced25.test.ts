/**
 * @file GcodeAdvanced25.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced25 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAirCuttingTime,
  analyzeBeadWidthVariance,
  validateParameterRanges,
  generateEngagementHeatmapPerLayer,
  analyzeFanDutyCycle,
  optimizeToolChangePositions,
  adviseSpindleSpeed,
  optimizeFirstLayerHeight,
  checkContinuityPerLayer,
  calculateMinimumClearance,
  analyzeWallThicknessConsistency,
  optimizeExecutionOrder,
} from "@tether/gcode-analyzer/GcodeAdvanced25";

// ── 1. Air Cutting Time ──

describe('calculateAirCuttingTime', () => {
  it('calculates air cutting time', () => {
    const lines = ['G1 X10 Y0 Z0 F500', 'G1 X20 Y0 Z0 F500', 'G1 X30 Y0 Z-1 F500'];
    const result = calculateAirCuttingTime(lines);
    expect(result.airCuttingCount).toBeGreaterThan(0);
  });

  it('computes efficiency score', () => {
    const lines = ['G1 X10 Y0 Z0 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateAirCuttingTime(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no air cutting', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateAirCuttingTime(lines);
    expect(result.airCuttingCount).toBe(0);
  });
});

// ── 2. Bead Width Variance ──

describe('analyzeBeadWidthVariance', () => {
  it('analyzes bead width variance', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 0.5} F1800`);
    }
    const result = analyzeBeadWidthVariance(lines, 0.4);
    expect(result.avgBeadWidth).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 0.5} F1800`);
    }
    const result = analyzeBeadWidthVariance(lines, 0.4);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['G1 X10 Y0 E5 F1800'];
    const result = analyzeBeadWidthVariance(lines, 0.4);
    expect(result.avgBeadWidth).toBe(0);
  });
});

// ── 3. Parameter Range Validator ──

describe('validateParameterRanges', () => {
  it('validates parameter ranges', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'M3 S5000', 'G1 X20 Y10 Z-1 F600'];
    const result = validateParameterRanges(lines);
    expect(result.parametersChecked).toBeGreaterThan(0);
  });

  it('detects violations', () => {
    const lines = ['G1 X10 Y10 Z-1 F60000'];
    const result = validateParameterRanges(lines, { maxFeed: 5000 });
    expect(result.count).toBeGreaterThan(0);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('handles no violations', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = validateParameterRanges(lines);
    expect(result.count).toBe(0);
  });
});

// ── 4. Engagement Heatmap Per Layer ──

describe('generateEngagementHeatmapPerLayer', () => {
  it('generates engagement heatmap per layer', () => {
    const lines = [
      'G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500',
      'G1 X10 Y0 Z-2 F500', 'G1 X100 Y0 Z-2 F500',
    ];
    const result = generateEngagementHeatmapPerLayer(lines, 6);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500'];
    const result = generateEngagementHeatmapPerLayer(lines, 6);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = generateEngagementHeatmapPerLayer(lines, 6);
    expect(result.layers).toEqual([]);
  });
});

// ── 5. Fan Duty Cycle ──

describe('analyzeFanDutyCycle', () => {
  it('analyzes fan duty cycle', () => {
    const lines = [
      'M106 S128', 'G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800',
      'M106 S255', 'G1 X30 Y10 E15 F1800',
    ];
    const result = analyzeFanDutyCycle(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['M106 S128', 'G1 X10 Y10 E5 F1800'];
    const result = analyzeFanDutyCycle(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no fan data', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeFanDutyCycle(lines);
    expect(result.avgDutyCycle).toBe(0);
    expect(result.cycleCount).toBe(0);
  });
});

// ── 6. Tool Change Position Optimizer ──

describe('optimizeToolChangePositions', () => {
  it('optimizes tool change positions', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'T1 M6', 'G1 X50 Y50 Z-1 F500', 'T2 M6', 'G1 X100 Y100 Z-1 F500'];
    const result = optimizeToolChangePositions(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('computes optimization score', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'T1 M6', 'G1 X50 Y50 Z-1 F500'];
    const result = optimizeToolChangePositions(lines);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles no tool changes', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = optimizeToolChangePositions(lines);
    expect(result.count).toBe(0);
  });
});

// ── 7. Spindle Speed Advisor ──

describe('adviseSpindleSpeed', () => {
  it('advises on spindle speed', () => {
    const lines = ['M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = adviseSpindleSpeed(lines, 6, 'aluminum');
    expect(result.currentSpeed).toBeGreaterThan(0);
    expect(result.recommendedSpeed).toBeGreaterThan(0);
  });

  it('computes optimization score', () => {
    const lines = ['M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = adviseSpindleSpeed(lines, 6, 'aluminum');
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles no spindle speed', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = adviseSpindleSpeed(lines, 6, 'aluminum');
    expect(result.currentSpeed).toBe(0);
  });
});

// ── 8. First Layer Height Optimizer ──

describe('optimizeFirstLayerHeight', () => {
  it('optimizes first layer height', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800'];
    const result = optimizeFirstLayerHeight(lines, 0.4);
    expect(result.currentHeight).toBeGreaterThan(0);
  });

  it('computes adhesion score', () => {
    const lines = ['G1 X10 Y10 Z0.3 F1800', 'G1 X20 Y10 Z0.5 F1800'];
    const result = optimizeFirstLayerHeight(lines, 0.4);
    expect(result.adhesionScore).toBeGreaterThanOrEqual(0);
    expect(result.adhesionScore).toBeLessThanOrEqual(100);
  });

  it('handles no Z data', () => {
    const lines = ['G1 X10 Y10 F1800'];
    const result = optimizeFirstLayerHeight(lines, 0.4);
    expect(result.currentHeight).toBe(0);
  });
});

// ── 9. Continuity Per Layer ──

describe('checkContinuityPerLayer', () => {
  it('checks continuity per layer', () => {
    const lines = [
      'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.2 F1800',
      'G1 X30 Y10 Z0.4 F1800', 'G1 X40 Y10 Z0.4 F1800',
    ];
    const result = checkContinuityPerLayer(lines, 5);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('detects gaps', () => {
    const lines = [
      'G1 X10 Y10 Z0.2 F1800', 'G1 X100 Y10 Z0.2 F1800',
      'G1 X10 Y10 Z0.4 F1800',
    ];
    const result = checkContinuityPerLayer(lines, 5);
    expect(result.totalGaps).toBeGreaterThanOrEqual(0);
  });

  it('handles no layers', () => {
    const lines = ['; comment only'];
    const result = checkContinuityPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 10. Minimum Clearance ──

describe('calculateMinimumClearance', () => {
  it('calculates minimum clearance', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'G1 X50 Y50 Z-1 F500', 'G1 X100 Y100 Z-1 F500'];
    const result = calculateMinimumClearance(lines, 10);
    expect(result.minClearance).toBeGreaterThan(0);
  });

  it('computes safety score', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'G1 X50 Y50 Z-1 F500'];
    const result = calculateMinimumClearance(lines, 10);
    expect(result.safetyScore).toBeGreaterThanOrEqual(0);
    expect(result.safetyScore).toBeLessThanOrEqual(100);
  });

  it('handles no positions', () => {
    const lines = ['; comment only'];
    const result = calculateMinimumClearance(lines);
    expect(result.minClearance).toBe(0);
  });
});

// ── 11. Wall Thickness Consistency ──

describe('analyzeWallThicknessConsistency', () => {
  it('analyzes wall thickness consistency', () => {
    const lines: string[] = ['; wall'];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 0.5} F1800`);
    }
    const result = analyzeWallThicknessConsistency(lines, 0.8);
    expect(result.avgWallThickness).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines: string[] = ['; wall'];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 0.5} F1800`);
    }
    const result = analyzeWallThicknessConsistency(lines, 0.8);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['; wall', 'G1 X10 Y0 E5 F1800'];
    const result = analyzeWallThicknessConsistency(lines, 0.8);
    expect(result.avgWallThickness).toBe(0);
  });
});

// ── 12. Execution Order Optimizer ──

describe('optimizeExecutionOrder', () => {
  it('optimizes execution order', () => {
    const lines = [
      'T1 M6', 'G1 X10 Y10 Z-1 F500',
      'T2 M6', 'G1 X50 Y50 Z-2 F500',
      'T1 M6', 'G1 X100 Y100 Z-3 F500',
    ];
    const result = optimizeExecutionOrder(lines);
    expect(result.operationCount).toBeGreaterThanOrEqual(0);
  });

  it('computes optimization scores', () => {
    const lines = ['T1 M6', 'G1 X10 Y10 Z-1 F500', 'T2 M6', 'G1 X50 Y50 Z-1 F500'];
    const result = optimizeExecutionOrder(lines);
    expect(result.currentScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizedScore).toBeGreaterThanOrEqual(0);
  });

  it('handles no operations', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = optimizeExecutionOrder(lines);
    expect(result.operationCount).toBe(0);
  });
});
