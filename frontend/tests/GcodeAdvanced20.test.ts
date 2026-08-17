/**
 * @file GcodeAdvanced20.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced20 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  generateSpeedHeatmap,
  predictToolWearProgression,
  optimizeRetractionSpeed,
  scoreLineComplexity,
  optimizeDepthOfCut,
  optimizeLayerFanSpeed,
  detectCircularInterpolation,
  calculateToolpathEfficiency,
  trackMaterialPerLayer,
  removeCommandRedundancy,
  adviseCuttingStrategy,
  analyzeIroningPattern,
} from "@tether/gcode-analyzer/GcodeAdvanced20";

// ── 1. Speed Heatmap ──

describe('generateSpeedHeatmap', () => {
  it('generates speed heatmap', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F1000', 'G1 X30 Y0 F2000'];
    const result = generateSpeedHeatmap(lines);
    expect(result.points.length).toBe(3);
  });

  it('categorizes speeds', () => {
    const lines = ['G1 X10 Y0 F100', 'G1 X20 Y0 F5000'];
    const result = generateSpeedHeatmap(lines);
    expect(result.distribution.very_slow).toBeGreaterThan(0);
    expect(result.distribution.very_fast).toBeGreaterThan(0);
  });

  it('handles no motion', () => {
    const lines = ['M3 S1000'];
    const result = generateSpeedHeatmap(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 2. Tool Wear Progression ──

describe('predictToolWearProgression', () => {
  it('predicts wear progression', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = predictToolWearProgression(lines);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.finalWearPercentage).toBeGreaterThanOrEqual(0);
  });

  it('tracks cutting distance', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = predictToolWearProgression(lines);
    expect(result.totalCuttingDistance).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = predictToolWearProgression(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 3. Retraction Speed Optimizer ──

describe('optimizeRetractionSpeed', () => {
  it('optimizes retraction speed', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F3600', 'G1 X20 Y20 E5 F1800'];
    const result = optimizeRetractionSpeed(lines);
    expect(result.currentSpeed).toBeGreaterThan(0);
  });

  it('detects extruder type', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E1 F1800'];
    const result = optimizeRetractionSpeed(lines);
    expect(['direct', 'bowden', 'unknown']).toContain(result.extruderType);
  });

  it('handles no retraction', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = optimizeRetractionSpeed(lines);
    expect(result.speedScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 4. Line Complexity Scorer ──

describe('scoreLineComplexity', () => {
  it('scores line complexity', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'G2 X20 Y10 I5 J0 F500'];
    const result = scoreLineComplexity(lines);
    expect(result.lines.length).toBe(2);
    expect(result.lines[1].complexity).toBeGreaterThan(result.lines[0].complexity);
  });

  it('computes distribution', () => {
    const lines = ['G0 X10 Y0', 'G1 X20 Y0 Z-1 F500', 'G2 X30 Y10 I5 J5 F500'];
    const result = scoreLineComplexity(lines);
    expect(result.distribution.simple).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = scoreLineComplexity([]);
    expect(result.lines).toEqual([]);
  });
});

// ── 5. Depth of Cut Optimizer ──

describe('optimizeDepthOfCut', () => {
  it('optimizes depth of cut', () => {
    const lines = ['G1 X10 Y0 Z-5 F500', 'G1 X20 Y0 Z-5 F500'];
    const result = optimizeDepthOfCut(lines, 6, 'aluminum');
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.currentMaxDOC).toBe(5);
  });

  it('computes optimization score', () => {
    const lines = ['G1 X10 Y0 Z-3 F500'];
    const result = optimizeDepthOfCut(lines, 6, 'aluminum');
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = optimizeDepthOfCut(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 6. Layer Fan Speed Optimizer ──

describe('optimizeLayerFanSpeed', () => {
  it('optimizes layer fan speed', () => {
    const lines = ['M107', 'G1 X10 Y10 E5 F1800 Z0.2', 'M106 S255', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = optimizeLayerFanSpeed(lines);
    expect(result.advice.length).toBeGreaterThan(0);
  });

  it('recommends fan off for first layers', () => {
    const lines = ['M107', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = optimizeLayerFanSpeed(lines, 3);
    expect(result.firstLayerFanOff).toBe(true);
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = optimizeLayerFanSpeed(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 7. Circular Interpolation Detector ──

describe('detectCircularInterpolation', () => {
  it('detects arc opportunities', () => {
    // Create a series of linear moves that approximate an arc
    const lines: string[] = [];
    const cx = 50, cy = 50, r = 10;
    for (let a = 0; a <= 180; a += 10) {
      const x = cx + r * Math.cos(a * Math.PI / 180);
      const y = cy + r * Math.sin(a * Math.PI / 180);
      lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F500`);
    }
    const result = detectCircularInterpolation(lines);
    expect(result.opportunityCount).toBeGreaterThan(0);
  });

  it('handles no opportunities', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500'];
    const result = detectCircularInterpolation(lines);
    expect(result.opportunityCount).toBe(0);
  });
});

// ── 8. Toolpath Efficiency Calculator ──

describe('calculateToolpathEfficiency', () => {
  it('calculates efficiency', () => {
    const lines = ['G0 X50 Y0', 'G1 X60 Y0 Z-1 F500', 'G0 X100 Y0'];
    const result = calculateToolpathEfficiency(lines);
    expect(result.metrics.totalDistance).toBeGreaterThan(0);
  });

  it('computes cutting ratio', () => {
    const lines = ['G0 X50 Y0', 'G1 X60 Y0 Z-1 F500'];
    const result = calculateToolpathEfficiency(lines);
    expect(result.metrics.cuttingRatio).toBeGreaterThanOrEqual(0);
    expect(result.metrics.cuttingRatio).toBeLessThanOrEqual(1);
  });

  it('computes efficiency score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateToolpathEfficiency(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });
});

// ── 9. Material Per Layer Tracker ──

describe('trackMaterialPerLayer', () => {
  it('tracks material per layer', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X30 Y10 E15 F1800 Z0.4',
      'G1 X40 Y10 E20 F1800 Z0.4',
    ];
    const result = trackMaterialPerLayer(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes total filament', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.4'];
    const result = trackMaterialPerLayer(lines);
    expect(result.totalFilamentMm).toBeGreaterThan(0);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = trackMaterialPerLayer(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 10. Command Redundancy Remover ──

describe('removeCommandRedundancy', () => {
  it('detects redundant commands', () => {
    const lines = ['G21 G90', 'G1 X10 Y10 F500', 'G1 X20 Y20 F500', 'G1 X30 Y30 F500'];
    const result = removeCommandRedundancy(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('detects empty lines', () => {
    const lines = ['G1 X10 Y10 F500', '', '', 'G1 X20 Y20 F500'];
    const result = removeCommandRedundancy(lines);
    expect(result.items.filter(i => i.type === 'empty_line').length).toBe(2);
  });

  it('computes cleanup score', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = removeCommandRedundancy(lines);
    expect(result.cleanupScore).toBeGreaterThanOrEqual(0);
    expect(result.cleanupScore).toBeLessThanOrEqual(100);
  });
});

// ── 11. Cutting Strategy Advisor ──

describe('adviseCuttingStrategy', () => {
  it('advises cutting strategy', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500', 'G1 X30 Y0 Z-1 F500'];
    const result = adviseCuttingStrategy(lines);
    expect(result.advice.strategy).toBeDefined();
  });

  it('computes climb percentage', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = adviseCuttingStrategy(lines);
    expect(result.climbPercentage).toBeGreaterThanOrEqual(0);
    expect(result.climbPercentage).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = adviseCuttingStrategy(lines);
    expect(result.climbPercentage).toBe(0);
  });
});

// ── 12. Ironing Pattern Analyzer ──

describe('analyzeIroningPattern', () => {
  it('analyzes ironing pattern', () => {
    // Ironing: set Z first, then do ironing passes on same Z
    const lines = [
      'G1 Z0.2 F1800',
      '; ironing', 'G1 X10 Y10 E5.1 F1800',
      '; ironing', 'G1 X20 Y10 E5.2 F1800',
    ];
    const result = analyzeIroningPattern(lines);
    expect(result.detected).toBe(true);
  });

  it('handles no ironing', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeIroningPattern(lines);
    expect(result.detected).toBe(false);
  });

  it('computes ironing score', () => {
    const lines = ['; ironing', 'G1 X10 Y10 E5.1 F1800 Z0.2'];
    const result = analyzeIroningPattern(lines);
    expect(result.ironingScore).toBeGreaterThanOrEqual(0);
    expect(result.ironingScore).toBeLessThanOrEqual(100);
  });
});
