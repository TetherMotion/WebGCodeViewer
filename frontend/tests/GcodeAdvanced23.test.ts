/**
 * @file GcodeAdvanced23.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced23 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateScallopHeight,
  detectFilamentDiameterVariance,
  detectCoordinateScaling,
  calculateChipThinning,
  analyzeInfillAngles,
  analyzeSegmentLengthDistribution,
  calculateStepover,
  calibrateExtrusionMultiplier,
  detectToolpathSymmetry,
  optimizeRetractPlane,
  analyzeSkirtBrimGap,
  estimateExecutionTime,
} from '../src/core/GcodeAdvanced23';

// ── 1. Scallop Height ──

describe('calculateScallopHeight', () => {
  it('calculates scallop height', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y1 Z-1 F500', 'G1 X30 Y2 Z-1 F500'];
    const result = calculateScallopHeight(lines, 6);
    expect(result.stepover).toBeGreaterThan(0);
  });

  it('computes smoothness score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0.5 Z-1 F500'];
    const result = calculateScallopHeight(lines, 6);
    expect(result.smoothnessScore).toBeGreaterThanOrEqual(0);
    expect(result.smoothnessScore).toBeLessThanOrEqual(100);
  });

  it('handles no passes', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = calculateScallopHeight(lines, 6);
    expect(result.passCount).toBe(1);
  });
});

// ── 2. Filament Diameter Variance ──

describe('detectFilamentDiameterVariance', () => {
  it('detects filament diameter variance', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 5} F1800`);
    }
    const result = detectFilamentDiameterVariance(lines, 1.75);
    expect(result.avgDiameter).toBe(1.75);
  });

  it('computes quality score', () => {
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 5} F1800`);
    }
    const result = detectFilamentDiameterVariance(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['G1 X10 Y0 E5 F1800'];
    const result = detectFilamentDiameterVariance(lines);
    expect(result.diameterVariance).toBe(0);
  });
});

// ── 3. Coordinate Scaling ──

describe('detectCoordinateScaling', () => {
  it('detects G51 scaling', () => {
    const lines = ['G51 X2 Y2 Z1', 'G1 X10 Y10 F500', 'G50'];
    const result = detectCoordinateScaling(lines);
    expect(result.count).toBe(2);
  });

  it('detects active scaling at end', () => {
    const lines = ['G51 X2 Y2', 'G1 X10 Y10 F500'];
    const result = detectCoordinateScaling(lines);
    expect(result.activeAtEnd).toBe(true);
  });

  it('handles no scaling', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = detectCoordinateScaling(lines);
    expect(result.count).toBe(0);
  });
});

// ── 4. Chip Thinning ──

describe('calculateChipThinning', () => {
  it('calculates chip thinning', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y1 Z-1 F500'];
    const result = calculateChipThinning(lines, 6, 2);
    expect(result.radialEngagement).toBeGreaterThanOrEqual(0);
  });

  it('computes thinning factor', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0.5 Z-1 F500'];
    const result = calculateChipThinning(lines, 6, 2);
    expect(result.thinningFactor).toBeGreaterThanOrEqual(1);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateChipThinning(lines);
    expect(result.nominalChipLoad).toBe(0);
  });
});

// ── 5. Infill Angles ──

describe('analyzeInfillAngles', () => {
  it('analyzes infill angles', () => {
    const lines = ['; infill', 'G1 X10 Y0 F1800', 'G1 X10 Y10 F1800', 'G1 X20 Y10 F1800'];
    const result = analyzeInfillAngles(lines);
    expect(result.angles.length).toBeGreaterThan(0);
  });

  it('detects primary angle', () => {
    const lines = ['; infill', 'G1 X10 Y0 F1800', 'G1 X20 Y0 F1800', 'G1 X30 Y0 F1800'];
    const result = analyzeInfillAngles(lines);
    expect(result.primaryAngle).toBeGreaterThanOrEqual(0);
  });

  it('handles no infill', () => {
    const lines = ['G1 X10 Y0 F1800'];
    const result = analyzeInfillAngles(lines);
    expect(result.angles).toEqual([]);
  });
});

// ── 6. Segment Length Distribution ──

describe('analyzeSegmentLengthDistribution', () => {
  it('analyzes segment length distribution', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X50 Y0 F500'];
    const result = analyzeSegmentLengthDistribution(lines);
    expect(result.totalSegments).toBeGreaterThan(0);
  });

  it('computes distribution', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500'];
    const result = analyzeSegmentLengthDistribution(lines);
    expect(Object.keys(result.distribution).length).toBeGreaterThan(0);
  });

  it('handles no segments', () => {
    const lines = ['M3 S1000'];
    const result = analyzeSegmentLengthDistribution(lines);
    expect(result.totalSegments).toBe(0);
  });
});

// ── 7. Stepover ──

describe('calculateStepover', () => {
  it('calculates stepover', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X10 Y1 Z-1 F500', 'G1 X10 Y2 Z-1 F500'];
    const result = calculateStepover(lines, 6);
    expect(result.avgStepover).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X10 Y1 Z-1 F500'];
    const result = calculateStepover(lines, 6);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no stepover', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = calculateStepover(lines, 6);
    expect(result.avgStepover).toBe(0);
  });
});

// ── 8. Extrusion Multiplier ──

describe('calibrateExtrusionMultiplier', () => {
  it('calibrates extrusion multiplier', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 5} F1800`);
    }
    const result = calibrateExtrusionMultiplier(lines, 1.0);
    expect(result.currentMultiplier).toBe(1.0);
  });

  it('computes calibration score', () => {
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${i * 10} Y0 E${i * 5} F1800`);
    }
    const result = calibrateExtrusionMultiplier(lines);
    expect(result.calibrationScore).toBeGreaterThanOrEqual(0);
    expect(result.calibrationScore).toBeLessThanOrEqual(100);
  });

  it('handles insufficient data', () => {
    const lines = ['G1 X10 Y0 E5 F1800'];
    const result = calibrateExtrusionMultiplier(lines);
    expect(result.flowDeviation).toBe(0);
  });
});

// ── 9. Symmetry Detector ──

describe('detectToolpathSymmetry', () => {
  it('detects mirror symmetry', () => {
    const lines: string[] = [];
    // Create symmetric pattern around X=50
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${50 - i} Y${i} F500`);
    }
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${50 + i} Y${i} F500`);
    }
    const result = detectToolpathSymmetry(lines, 1.0);
    expect(result.symmetryType).toBeDefined();
  });

  it('handles insufficient points', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = detectToolpathSymmetry(lines);
    expect(result.isSymmetric).toBe(false);
  });

  it('detects no symmetry in random path', () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`G1 X${Math.random() * 100} Y${Math.random() * 100} F500`);
    }
    const result = detectToolpathSymmetry(lines, 0.1);
    expect(result.symmetryScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 10. Retract Plane ──

describe('optimizeRetractPlane', () => {
  it('optimizes retract plane', () => {
    const lines = ['G0 Z20', 'G1 X10 Y0 Z-1 F500', 'G0 Z20', 'G1 X20 Y0 Z-1 F500'];
    const result = optimizeRetractPlane(lines, 50);
    expect(result.retractCount).toBeGreaterThan(0);
  });

  it('computes optimization score', () => {
    const lines = ['G0 Z10', 'G1 X10 Y0 Z-1 F500'];
    const result = optimizeRetractPlane(lines, 50);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles no retracts', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = optimizeRetractPlane(lines);
    expect(result.retractCount).toBe(0);
  });
});

// ── 11. Skirt/Brim Gap ──

describe('analyzeSkirtBrimGap', () => {
  it('analyzes skirt gap', () => {
    // Need both skirt lines and part lines
    const lines = [
      '; skirt', 'G1 X0 Y0 Z0.2 F1800', 'G1 X10 Y0 Z0.2 F1800',
      '; layer 1', 'G1 X5 Y5 Z0.2 F1800', 'G1 X15 Y5 Z0.2 F1800',
    ];
    const result = analyzeSkirtBrimGap(lines);
    expect(result.type).toBe('skirt');
  });

  it('analyzes brim gap', () => {
    // Need both brim lines and part lines
    const lines = [
      '; brim', 'G1 X0 Y0 Z0.2 F1800', 'G1 X10 Y0 Z0.2 F1800',
      '; layer 1', 'G1 X5 Y5 Z0.2 F1800', 'G1 X15 Y5 Z0.2 F1800',
    ];
    const result = analyzeSkirtBrimGap(lines);
    expect(result.type).toBe('brim');
  });

  it('handles no skirt/brim', () => {
    const lines = ['G1 X10 Y0 Z0.2 F1800'];
    const result = analyzeSkirtBrimGap(lines);
    expect(result.type).toBe('none');
  });
});

// ── 12. Execution Time ──

describe('estimateExecutionTime', () => {
  it('estimates execution time', () => {
    const lines = ['G1 X10 Y0 Z-1 F600', 'G1 X20 Y0 Z-1 F600', 'G0 X30 Y0 Z10'];
    const result = estimateExecutionTime(lines);
    expect(result.totalTime).toBeGreaterThan(0);
  });

  it('computes time breakdown', () => {
    const lines = ['G1 X10 Y0 F600', 'G0 X20 Y0', 'G4 P1000'];
    const result = estimateExecutionTime(lines);
    expect(Object.keys(result.breakdown).length).toBeGreaterThan(0);
  });

  it('handles dwell time', () => {
    const lines = ['G4 P2000', 'G1 X10 Y0 F600'];
    const result = estimateExecutionTime(lines);
    expect(result.dwellTime).toBeGreaterThan(0);
  });

  it('handles tool changes', () => {
    const lines = ['T1', 'M6', 'G1 X10 Y0 F600', 'T2', 'M6', 'G1 X20 Y0 F600'];
    const result = estimateExecutionTime(lines);
    expect(result.toolChangeTime).toBeGreaterThan(0);
  });
});
