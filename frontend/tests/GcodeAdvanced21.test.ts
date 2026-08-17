/**
 * @file GcodeAdvanced21.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced21 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePerLayerBounds,
  calculateEngagementTime,
  analyzeRetractionFrequency,
  estimateSpindleLoadProfile,
  countDirectionChanges,
  calculateBedAdhesionArea,
  detectCoordinateRotations,
  calculateWearRate,
  analyzeFlowRateConsistency,
  validateCommandSequence,
  analyzeFeedRateHarmonics,
  analyzeLayerHeightVariance,
} from "@tether/gcode-analyzer/GcodeAdvanced21";

// ── 1. Per-Layer Bounds ──

describe('calculatePerLayerBounds', () => {
  it('calculates per-layer bounds', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y20 Z0.2 F1800', 'G1 X30 Y30 Z0.4 F1800'];
    const result = calculatePerLayerBounds(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes overall bounds', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X50 Y50 Z0.4 F1800'];
    const result = calculatePerLayerBounds(lines);
    expect(result.overallBounds.maxX).toBeGreaterThanOrEqual(10);
  });

  it('handles no layers', () => {
    const lines = ['M3 S1000'];
    const result = calculatePerLayerBounds(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 2. Engagement Time ──

describe('calculateEngagementTime', () => {
  it('calculates engagement time', () => {
    const lines = ['G0 X50 Y0', 'G1 X60 Y0 Z-1 F500', 'G0 X100 Y0'];
    const result = calculateEngagementTime(lines);
    expect(result.totalTime).toBeGreaterThan(0);
  });

  it('computes engagement ratio', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateEngagementTime(lines);
    expect(result.engagementRatio).toBeGreaterThanOrEqual(0);
    expect(result.engagementRatio).toBeLessThanOrEqual(1);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateEngagementTime(lines);
    expect(result.totalEngagementTime).toBe(0);
  });
});

// ── 3. Retraction Frequency ──

describe('analyzeRetractionFrequency', () => {
  it('analyzes retraction frequency', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E5 F1800', 'G1 X20 Y20 E3 F1800'];
    const result = analyzeRetractionFrequency(lines);
    expect(result.retractionCount).toBeGreaterThan(0);
  });

  it('computes frequency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800'];
    const result = analyzeRetractionFrequency(lines);
    expect(result.frequencyScore).toBeGreaterThanOrEqual(0);
    expect(result.frequencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = analyzeRetractionFrequency(lines);
    expect(result.retractionCount).toBe(0);
  });
});

// ── 4. Spindle Load Profile ──

describe('estimateSpindleLoadProfile', () => {
  it('estimates spindle load', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = estimateSpindleLoadProfile(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes distribution', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = estimateSpindleLoadProfile(lines);
    expect(Object.keys(result.distribution).length).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = estimateSpindleLoadProfile(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 5. Direction Change Counter ──

describe('countDirectionChanges', () => {
  it('counts direction changes', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X10 Y10 F500', 'G1 X20 Y10 F500'];
    const result = countDirectionChanges(lines);
    expect(result.totalChanges).toBeGreaterThan(0);
  });

  it('detects sharp changes', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X0 Y0 F500'];
    const result = countDirectionChanges(lines);
    expect(result.sharpChanges).toBeGreaterThan(0);
  });

  it('handles straight path', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = countDirectionChanges(lines);
    expect(result.totalChanges).toBe(0);
  });
});

// ── 6. Bed Adhesion Area ──

describe('calculateBedAdhesionArea', () => {
  it('calculates bed adhesion area', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = calculateBedAdhesionArea(lines);
    expect(result.totalAdhesionArea).toBeGreaterThan(0);
  });

  it('computes adhesion score', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = calculateBedAdhesionArea(lines);
    expect(result.adhesionScore).toBeGreaterThanOrEqual(0);
    expect(result.adhesionScore).toBeLessThanOrEqual(100);
  });

  it('handles no first layer', () => {
    // Set first Z high, then move to higher Z before extruding
    const lines = ['G1 Z1.0 F1800', 'G1 Z2.0 F1800', 'G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = calculateBedAdhesionArea(lines);
    expect(result.totalAdhesionArea).toBe(0);
  });
});

// ── 7. Coordinate Rotation Detector ──

describe('detectCoordinateRotations', () => {
  it('detects G68 rotations', () => {
    const lines = ['G68 X0 Y0 R45', 'G1 X10 Y10 F500', 'G69'];
    const result = detectCoordinateRotations(lines);
    expect(result.count).toBe(2);
  });

  it('detects active rotation at end', () => {
    const lines = ['G68 X0 Y0 R45', 'G1 X10 Y10 F500'];
    const result = detectCoordinateRotations(lines);
    expect(result.activeRotationAtEnd).toBe(true);
  });

  it('handles no rotations', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = detectCoordinateRotations(lines);
    expect(result.count).toBe(0);
  });
});

// ── 8. Wear Rate Calculator ──

describe('calculateWearRate', () => {
  it('calculates wear rate', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateWearRate(lines, 6, 'aluminum');
    expect(result.totalCuttingDistance).toBeGreaterThan(0);
    expect(result.wearRateCategory).toBeDefined();
  });

  it('computes wear rate score', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = calculateWearRate(lines, 6, 'aluminum');
    expect(result.wearRateScore).toBeGreaterThanOrEqual(0);
    expect(result.wearRateScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateWearRate(lines);
    expect(result.totalCuttingDistance).toBe(0);
  });
});

// ── 9. Flow Rate Consistency ──

describe('analyzeFlowRateConsistency', () => {
  it('analyzes flow rate consistency', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800', 'G1 X30 Y10 E15 F1800'];
    const result = analyzeFlowRateConsistency(lines);
    expect(result.avgFlowRate).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = analyzeFlowRateConsistency(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeFlowRateConsistency(lines);
    expect(result.avgFlowRate).toBe(0);
  });
});

// ── 10. Command Sequence Validator ──

describe('validateCommandSequence', () => {
  it('validates command sequence', () => {
    const lines = ['G21 G90', 'G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M5', 'M30'];
    const result = validateCommandSequence(lines);
    expect(result.hasInit).toBe(true);
    expect(result.hasEnd).toBe(true);
  });

  it('detects missing initialization', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500', 'G1 X30 Y30 F500'];
    const result = validateCommandSequence(lines);
    expect(result.violations.some(v => v.type === 'missing_init')).toBe(true);
  });

  it('detects missing end', () => {
    // Need >10 lines to trigger missing_end check
    const lines = ['G21 G90', 'G28', 'M3 S5000',
      'G1 X10 Y10 F500', 'G1 X20 Y20 F500', 'G1 X30 Y30 F500',
      'G1 X40 Y40 F500', 'G1 X50 Y50 F500', 'G1 X60 Y60 F500',
      'G1 X70 Y70 F500', 'G1 X80 Y80 F500', 'G1 X90 Y90 F500'];
    const result = validateCommandSequence(lines);
    expect(result.violations.some(v => v.type === 'missing_end')).toBe(true);
  });
});

// ── 11. Feed Rate Harmonics ──

describe('analyzeFeedRateHarmonics', () => {
  it('analyzes feed rate harmonics', () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`G1 X${i * 10} Y0 F${500 + Math.sin(i) * 100} F${500 + Math.sin(i) * 100}`);
    }
    const result = analyzeFeedRateHarmonics(lines);
    expect(result.avgFeedRate).toBeGreaterThan(0);
  });

  it('computes harmonics score', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 F500`);
    }
    const result = analyzeFeedRateHarmonics(lines);
    expect(result.harmonicsScore).toBeGreaterThanOrEqual(0);
    expect(result.harmonicsScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = analyzeFeedRateHarmonics(lines);
    expect(result.dominantFrequencies).toEqual([]);
  });
});

// ── 12. Layer Height Variance ──

describe('analyzeLayerHeightVariance', () => {
  it('analyzes layer height variance', () => {
    const lines = ['G1 Z0.2 F1800', 'G1 Z0.4 F1800', 'G1 Z0.6 F1800', 'G1 Z0.8 F1800'];
    const result = analyzeLayerHeightVariance(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 Z0.2 F1800', 'G1 Z0.4 F1800', 'G1 Z0.6 F1800'];
    const result = analyzeLayerHeightVariance(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient layers', () => {
    const lines = ['G1 Z0.2 F1800'];
    const result = analyzeLayerHeightVariance(lines);
    expect(result.layerCount).toBe(0);
  });
});
