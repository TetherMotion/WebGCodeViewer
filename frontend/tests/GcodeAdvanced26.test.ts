/**
 * @file GcodeAdvanced26.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced26 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEngagementTimePerLayer,
  analyzeExtrusionRatePerLayer,
  analyzeWorkOffsetUsage,
  calculateDeflectionCompensation,
  optimizeBridgingSpeed,
  detectOverlapsPerLayer,
  analyzeSpindleLoadPerLayer,
  analyzeRetractionHopHeight,
  calculateProgramComplexity,
  analyzeArcInterpolationQuality,
  analyzeLayerHeightConsistencyPerLayer,
  analyzeModalStateTransitions,
} from "@tether/gcode-analyzer/GcodeAdvanced26";

// ── 1. Engagement Time Per Layer ──

describe('calculateEngagementTimePerLayer', () => {
  it('calculates engagement time per layer', () => {
    const lines = [
      'G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500',
      'G1 X10 Y0 Z-2 F500', 'G1 X100 Y0 Z-2 F500',
    ];
    const result = calculateEngagementTimePerLayer(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes distribution score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500'];
    const result = calculateEngagementTimePerLayer(lines);
    expect(result.distributionScore).toBeGreaterThanOrEqual(0);
    expect(result.distributionScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateEngagementTimePerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 2. Extrusion Rate Per Layer ──

describe('analyzeExtrusionRatePerLayer', () => {
  it('analyzes extrusion rate per layer', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X30 Y10 E15 F1800 Z0.4', 'G1 X40 Y10 E20 F1800 Z0.4',
    ];
    const result = analyzeExtrusionRatePerLayer(lines, 1.75);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2', 'G1 X30 Y10 E15 F1800 Z0.4'];
    const result = analyzeExtrusionRatePerLayer(lines, 1.75);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeExtrusionRatePerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 3. Work Offset Usage ──

describe('analyzeWorkOffsetUsage', () => {
  it('analyzes work offset usage', () => {
    const lines = ['G54', 'G1 X10 Y10 Z-1 F500', 'G55', 'G1 X20 Y20 Z-1 F500'];
    const result = analyzeWorkOffsetUsage(lines);
    expect(result.activeCount).toBeGreaterThan(0);
  });

  it('computes complexity score', () => {
    const lines = ['G54', 'G1 X10 Y10 F500', 'G55', 'G1 X20 Y20 F500'];
    const result = analyzeWorkOffsetUsage(lines);
    expect(result.complexityScore).toBeGreaterThanOrEqual(0);
    expect(result.complexityScore).toBeLessThanOrEqual(100);
  });

  it('handles no offsets', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeWorkOffsetUsage(lines);
    expect(result.activeCount).toBe(0);
  });
});

// ── 4. Tool Deflection Compensation ──

describe('calculateDeflectionCompensation', () => {
  it('calculates deflection compensation', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = calculateDeflectionCompensation(lines, 6, 30, 50);
    expect(result.estimatedDeflection).toBeGreaterThanOrEqual(0);
  });

  it('computes accuracy impact score', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = calculateDeflectionCompensation(lines, 6, 30, 50);
    expect(result.accuracyImpactScore).toBeGreaterThanOrEqual(0);
    expect(result.accuracyImpactScore).toBeLessThanOrEqual(100);
  });

  it('handles no feed rate', () => {
    const lines = ['G0 X10 Y10'];
    const result = calculateDeflectionCompensation(lines, 6, 30, 50);
    expect(result.estimatedDeflection).toBeGreaterThanOrEqual(0);
  });
});

// ── 5. Bridging Speed Optimizer ──

describe('optimizeBridgingSpeed', () => {
  it('optimizes bridging speed', () => {
    const lines = ['; bridge', 'G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = optimizeBridgingSpeed(lines, 'PLA');
    expect(result.bridgeCount).toBeGreaterThan(0);
  });

  it('computes quality score', () => {
    const lines = ['; bridge', 'G1 X10 Y10 E5 F1500', 'G1 X20 Y10 E10 F1500'];
    const result = optimizeBridgingSpeed(lines, 'PLA');
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('handles no bridges', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = optimizeBridgingSpeed(lines);
    expect(result.bridgeCount).toBe(0);
  });
});

// ── 6. Overlaps Per Layer ──

describe('detectOverlapsPerLayer', () => {
  it('detects overlaps per layer', () => {
    const lines = [
      'G1 X10 Y10 Z0.2 F1800', 'G1 X10 Y10 Z0.2 F1800',
      'G1 X20 Y10 Z0.4 F1800', 'G1 X20 Y10 Z0.4 F1800',
    ];
    const result = detectOverlapsPerLayer(lines, 2);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes severity score', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X10 Y10 Z0.2 F1800'];
    const result = detectOverlapsPerLayer(lines, 2);
    expect(result.severityScore).toBeGreaterThanOrEqual(0);
    expect(result.severityScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['; comment only'];
    const result = detectOverlapsPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 7. Spindle Load Per Layer ──

describe('analyzeSpindleLoadPerLayer', () => {
  it('analyzes spindle load per layer', () => {
    const lines = [
      'M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500',
      'G1 X10 Y0 Z-2 F500', 'G1 X100 Y0 Z-2 F500',
    ];
    const result = analyzeSpindleLoadPerLayer(lines, 5);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes stability score', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500'];
    const result = analyzeSpindleLoadPerLayer(lines, 5);
    expect(result.stabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.stabilityScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeSpindleLoadPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 8. Retraction Hop Height ──

describe('analyzeRetractionHopHeight', () => {
  it('analyzes retraction hop height', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X10 Y10 E-1 F1800 Z0.4',
      'G1 X20 Y10 E5 F1800 Z0.2',
    ];
    const result = analyzeRetractionHopHeight(lines);
    expect(result.hopCount).toBeGreaterThanOrEqual(0);
  });

  it('computes efficiency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X10 Y10 E-1 F1800 Z0.4'];
    const result = analyzeRetractionHopHeight(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no hops', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeRetractionHopHeight(lines);
    expect(result.hopCount).toBe(0);
  });
});

// ── 9. Program Complexity ──

describe('calculateProgramComplexity', () => {
  it('calculates program complexity', () => {
    const lines = ['G21 G90', 'G54', 'M3 S5000', 'G1 X10 Y10 F500', 'T1 M6', 'M30'];
    const result = calculateProgramComplexity(lines);
    expect(result.complexityScore).toBeGreaterThanOrEqual(0);
    expect(result.complexityScore).toBeLessThanOrEqual(100);
  });

  it('detects rating', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = calculateProgramComplexity(lines);
    expect(['simple', 'moderate', 'complex', 'very_complex']).toContain(result.rating);
  });

  it('handles empty program', () => {
    const lines: string[] = [];
    const result = calculateProgramComplexity(lines);
    expect(result.complexityScore).toBe(0);
  });
});

// ── 10. Arc Interpolation Quality ──

describe('analyzeArcInterpolationQuality', () => {
  it('analyzes arc interpolation quality', () => {
    const lines = ['G1 X0 Y0 F500', 'G2 X10 Y10 I5 J5 F500'];
    const result = analyzeArcInterpolationQuality(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('computes quality score', () => {
    const lines = ['G1 X0 Y0 F500', 'G3 X10 Y10 R10 F500'];
    const result = analyzeArcInterpolationQuality(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('handles no arcs', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeArcInterpolationQuality(lines);
    expect(result.count).toBe(0);
  });
});

// ── 11. Layer Height Consistency Per Layer ──

describe('analyzeLayerHeightConsistencyPerLayer', () => {
  it('analyzes layer height consistency', () => {
    const lines = [
      'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800',
      'G1 X30 Y10 Z0.6 F1800', 'G1 X40 Y10 Z0.8 F1800',
    ];
    const result = analyzeLayerHeightConsistencyPerLayer(lines, 0.02);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800', 'G1 X30 Y10 Z0.6 F1800'];
    const result = analyzeLayerHeightConsistencyPerLayer(lines, 0.02);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800'];
    const result = analyzeLayerHeightConsistencyPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 12. Modal State Transitions ──

describe('analyzeModalStateTransitions', () => {
  it('analyzes modal state transitions', () => {
    const lines = ['G0 X10 Y10', 'G1 X20 Y20 F500', 'G0 X30 Y30', 'G91 G1 X10 F500'];
    const result = analyzeModalStateTransitions(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('computes stability score', () => {
    const lines = ['G0 X10 Y10', 'G1 X20 Y20 F500'];
    const result = analyzeModalStateTransitions(lines);
    expect(result.stabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.stabilityScore).toBeLessThanOrEqual(100);
  });

  it('handles no transitions', () => {
    // Use only G0 (matches initial state) with no other modal changes
    const lines = ['G0 X10 Y10', 'G0 X20 Y20', 'G0 X30 Y30'];
    const result = analyzeModalStateTransitions(lines);
    expect(result.count).toBe(0);
  });
});
