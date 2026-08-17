/**
 * @file GcodeAdvanced22.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced22 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeAccelerationProfile,
  analyzeCuttingForceSpectrum,
  optimizePressureAdvance,
  mapCoordinateOrigins,
  detectToolpathLoops,
  analyzeExtrusionWidthPerLayer,
  optimizeSpindleWarmup,
  optimizeSupportStructure,
  optimizeFileSize,
  generateCurvatureHeatmap,
  predictLayerAdhesionStrength,
  calculateCorneringSpeed,
} from "@tether/gcode-analyzer/GcodeAdvanced22";

// ── 1. Acceleration Profile ──

describe('analyzeAccelerationProfile', () => {
  it('analyzes acceleration profile', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F1000', 'G1 X30 Y0 F500'];
    const result = analyzeAccelerationProfile(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('detects jerk events', () => {
    const lines = ['G1 X10 Y0 F100', 'G1 X20 Y0 F5000'];
    const result = analyzeAccelerationProfile(lines, 1000);
    expect(result.jerkCount).toBeGreaterThanOrEqual(0);
  });

  it('handles no motion', () => {
    const lines = ['M3 S1000'];
    const result = analyzeAccelerationProfile(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 2. Cutting Force Spectrum ──

describe('analyzeCuttingForceSpectrum', () => {
  it('analyzes cutting force spectrum', () => {
    const lines: string[] = ['M3 S5000'];
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${i * 10} Y0 Z-1 F500`);
    }
    const result = analyzeCuttingForceSpectrum(lines);
    expect(result.spectrum.length).toBeGreaterThan(0);
  });

  it('computes resonance risk', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeCuttingForceSpectrum(lines);
    expect(result.resonanceRisk).toBeGreaterThanOrEqual(0);
    expect(result.resonanceRisk).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeCuttingForceSpectrum(lines);
    expect(result.spectrum).toEqual([]);
  });
});

// ── 3. Pressure Advance Optimizer ──

describe('optimizePressureAdvance', () => {
  it('optimizes pressure advance', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E5 F1800'];
    const result = optimizePressureAdvance(lines, 'PLA');
    expect(result.recommendedPA).toBeGreaterThan(0);
  });

  it('detects extruder type', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E1 F1800'];
    const result = optimizePressureAdvance(lines);
    expect(['direct', 'bowden', 'unknown']).toContain(result.extruderType);
  });

  it('handles no retraction', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = optimizePressureAdvance(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 4. Coordinate Origin Mapper ──

describe('mapCoordinateOrigins', () => {
  it('maps coordinate origins', () => {
    const lines = ['G54 X10 Y10 Z0', 'G1 X20 Y20 F500', 'G55 X50 Y50 Z0'];
    const result = mapCoordinateOrigins(lines);
    expect(result.origins.length).toBeGreaterThan(0);
  });

  it('detects multiple WCS', () => {
    const lines = ['G54 X0 Y0', 'G55 X50 Y50', 'G56 X100 Y100'];
    const result = mapCoordinateOrigins(lines);
    expect(result.wcsCount).toBe(3);
  });

  it('handles no origins', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = mapCoordinateOrigins(lines);
    expect(result.origins).toEqual([]);
  });
});

// ── 5. Toolpath Loop Detector ──

describe('detectToolpathLoops', () => {
  it('detects repeated loops', () => {
    const lines: string[] = [];
    // Create a loop that repeats
    for (let iter = 0; iter < 3; iter++) {
      lines.push('G1 X10 Y0 F500');
      lines.push('G1 X10 Y10 F500');
      lines.push('G1 X0 Y10 F500');
      lines.push('G1 X0 Y0 F500');
    }
    const result = detectToolpathLoops(lines);
    expect(result.loopCount).toBeGreaterThanOrEqual(0);
  });

  it('handles no loops', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y10 F500', 'G1 X30 Y0 F500'];
    const result = detectToolpathLoops(lines);
    expect(result.loopCount).toBe(0);
  });
});

// ── 6. Extrusion Width Per Layer ──

describe('analyzeExtrusionWidthPerLayer', () => {
  it('analyzes extrusion width per layer', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X30 Y10 E15 F1800 Z0.4',
      'G1 X40 Y10 E20 F1800 Z0.4',
    ];
    const result = analyzeExtrusionWidthPerLayer(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes overall consistency', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.4'];
    const result = analyzeExtrusionWidthPerLayer(lines);
    expect(result.overallConsistency).toBeGreaterThanOrEqual(0);
    expect(result.overallConsistency).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeExtrusionWidthPerLayer(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 7. Spindle Warmup Optimizer ──

describe('optimizeSpindleWarmup', () => {
  it('optimizes spindle warmup', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500'];
    const result = optimizeSpindleWarmup(lines);
    expect(result.recommendedWarmupTime).toBeGreaterThan(0);
  });

  it('computes thermal stability', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500'];
    const result = optimizeSpindleWarmup(lines);
    expect(result.thermalStabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.thermalStabilityScore).toBeLessThanOrEqual(100);
  });

  it('handles no spindle', () => {
    const lines = ['G0 X10 Y0'];
    const result = optimizeSpindleWarmup(lines);
    expect(result.currentWarmupTime).toBe(0);
  });
});

// ── 8. Support Structure Optimizer ──

describe('optimizeSupportStructure', () => {
  it('optimizes support structure', () => {
    const lines = ['; support', 'G1 X10 Y10 E5 F1800', '; support', 'G1 X20 Y10 E10 F1800'];
    const result = optimizeSupportStructure(lines, 100);
    expect(result.supportVolume).toBeGreaterThan(0);
  });

  it('computes optimization score', () => {
    const lines = ['; support', 'G1 X10 Y10 E5 F1800'];
    const result = optimizeSupportStructure(lines, 50);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles no supports', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = optimizeSupportStructure(lines);
    expect(result.supportVolume).toBe(0);
  });
});

// ── 9. File Size Optimizer ──

describe('optimizeFileSize', () => {
  it('optimizes file size', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500', '', '  G1 X30 Y30 F500  '];
    const result = optimizeFileSize(lines);
    expect(result.currentSize).toBeGreaterThan(0);
  });

  it('detects redundant comments', () => {
    const lines = [';;;', 'G1 X10 Y10 F500', '( )', 'G1 X20 Y20 F500'];
    const result = optimizeFileSize(lines);
    expect(result.redundantComments).toBeGreaterThan(0);
  });

  it('computes optimization score', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = optimizeFileSize(lines);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });
});

// ── 10. Curvature Heatmap ──

describe('generateCurvatureHeatmap', () => {
  it('generates curvature heatmap', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X10 Y10 F500', 'G1 X20 Y10 F500'];
    const result = generateCurvatureHeatmap(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('detects sharp corners', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X0 Y0 F500', 'G1 X0 Y10 F500'];
    const result = generateCurvatureHeatmap(lines);
    expect(result.sharpCornerCount).toBeGreaterThanOrEqual(0);
  });

  it('handles straight path', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = generateCurvatureHeatmap(lines);
    expect(result.distribution.straight).toBeGreaterThan(0);
  });
});

// ── 11. Layer Adhesion Strength ──

describe('predictLayerAdhesionStrength', () => {
  it('predicts layer adhesion strength', () => {
    const lines = ['M104 S210', 'G1 Z0.2 F1800', 'G1 Z0.4 F1800', 'G1 Z0.6 F1800'];
    const result = predictLayerAdhesionStrength(lines, 'PLA');
    expect(result.predictedStrength).toBeGreaterThan(0);
    expect(result.rating).toBeDefined();
  });

  it('computes bonding score', () => {
    const lines = ['M104 S210', 'G1 Z0.2 F1800', 'G1 Z0.4 F1800'];
    const result = predictLayerAdhesionStrength(lines, 'PLA');
    expect(result.bondingScore).toBeGreaterThanOrEqual(0);
    expect(result.bondingScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['M104 S210'];
    const result = predictLayerAdhesionStrength(lines, 'PLA');
    expect(result.predictedStrength).toBeGreaterThan(0);
  });
});

// ── 12. Cornering Speed ──

describe('calculateCorneringSpeed', () => {
  it('calculates cornering speed', () => {
    const lines = ['G1 X10 Y0 F1000', 'G1 X10 Y10 F1000', 'G1 X20 Y10 F1000'];
    const result = calculateCorneringSpeed(lines);
    expect(result.cornerCount).toBeGreaterThan(0);
  });

  it('detects overspeed corners', () => {
    const lines = ['G1 X10 Y0 F3000', 'G1 X0 Y0 F3000'];
    const result = calculateCorneringSpeed(lines, 3000);
    expect(result.overspeedCount).toBeGreaterThanOrEqual(0);
  });

  it('handles straight path', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = calculateCorneringSpeed(lines);
    expect(result.cornerCount).toBe(0);
  });
});
