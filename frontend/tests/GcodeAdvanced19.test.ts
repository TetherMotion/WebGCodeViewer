/**
 * @file GcodeAdvanced19.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced19 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateArcLength,
  analyzeEntryExitAngles,
  optimizeRetractionDistance,
  analyzeBlockStructure,
  calculateFeedPerRevolution,
  analyzeThinWalls,
  trackVariableUsage,
  classifyToolpathSegments,
  analyzeInfillDensityVariance,
  detectErrorPatterns,
  calculateSurfaceSpeed,
  analyzeLayerTimeVariance,
} from "@tether/gcode-analyzer/GcodeAdvanced19";

// ── 1. Arc Length Calculator ──

describe('calculateArcLength', () => {
  it('calculates arc length with I/J', () => {
    const lines = ['G1 X0 Y0 F500', 'G2 X10 Y0 I5 J0 F500'];
    const result = calculateArcLength(lines);
    expect(result.arcs.length).toBe(1);
    expect(result.totalArcLength).toBeGreaterThan(0);
  });

  it('calculates arc length with R', () => {
    const lines = ['G1 X0 Y0 F500', 'G3 X10 Y0 R5 F500'];
    const result = calculateArcLength(lines);
    expect(result.arcs.length).toBe(1);
  });

  it('tracks CW vs CCW', () => {
    const lines = ['G1 X0 Y0 F500', 'G2 X10 Y0 I5 J0 F500', 'G3 X10 Y10 I5 J5 F500'];
    const result = calculateArcLength(lines);
    expect(result.directionCount.CW).toBe(1);
    expect(result.directionCount.CCW).toBe(1);
  });

  it('handles no arcs', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = calculateArcLength(lines);
    expect(result.arcCount).toBe(0);
  });
});

// ── 2. Entry/Exit Angle Analyzer ──

describe('analyzeEntryExitAngles', () => {
  it('analyzes entry angles', () => {
    const lines = ['G0 X10 Y0 Z5', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeEntryExitAngles(lines);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('detects plunge entries', () => {
    const lines = ['G0 X10 Y0 Z5', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeEntryExitAngles(lines);
    expect(result.events[0].entryType).toBe('plunge');
  });

  it('handles no entries', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = analyzeEntryExitAngles(lines);
    expect(result.count).toBe(0);
  });
});

// ── 3. Retraction Distance Optimizer ──

describe('optimizeRetractionDistance', () => {
  it('optimizes retraction distance', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E5 F1800'];
    const result = optimizeRetractionDistance(lines);
    expect(result.retractionCount).toBeGreaterThan(0);
  });

  it('detects extruder type', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E1 F1800'];
    const result = optimizeRetractionDistance(lines);
    expect(['direct', 'bowden', 'unknown']).toContain(result.extruderType);
  });

  it('handles no retraction', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = optimizeRetractionDistance(lines);
    expect(result.retractionCount).toBe(0);
  });
});

// ── 4. Block Structure Analyzer ──

describe('analyzeBlockStructure', () => {
  it('analyzes block structure', () => {
    const lines = ['; Setup', 'G21 G90', 'G28', '; Operation 1', 'G1 X10 Y10 F500', 'M30'];
    const result = analyzeBlockStructure(lines);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('detects tool change blocks', () => {
    const lines = ['G1 X10 Y10 F500', 'M6 T1', 'G1 X20 Y20 F500'];
    const result = analyzeBlockStructure(lines);
    expect(result.typeDistribution.tool_change).toBeGreaterThan(0);
  });

  it('computes structure score', () => {
    const lines = ['; Setup', 'G21', 'G28', '; Operation', 'G1 X10 F500', 'M30'];
    const result = analyzeBlockStructure(lines);
    expect(result.structureScore).toBeGreaterThanOrEqual(0);
    expect(result.structureScore).toBeLessThanOrEqual(100);
  });
});

// ── 5. Feed Per Revolution Calculator ──

describe('calculateFeedPerRevolution', () => {
  it('calculates feed per revolution', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F1000'];
    const result = calculateFeedPerRevolution(lines);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points[0].feedPerRev).toBeCloseTo(0.2, 1);
  });

  it('computes in-range percentage', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F1000'];
    const result = calculateFeedPerRevolution(lines);
    expect(result.inRangePercentage).toBeGreaterThanOrEqual(0);
    expect(result.inRangePercentage).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateFeedPerRevolution(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 6. Thin Wall Analyzer ──

describe('analyzeThinWalls', () => {
  it('analyzes thin walls', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E6 F1800'];
    const result = analyzeThinWalls(lines);
    expect(result.walls.length).toBeGreaterThan(0);
  });

  it('computes printability score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E6 F1800'];
    const result = analyzeThinWalls(lines);
    expect(result.printabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.printabilityScore).toBeLessThanOrEqual(100);
  });

  it('handles no walls', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeThinWalls(lines);
    expect(result.wallCount).toBe(0);
  });
});

// ── 7. Variable Usage Tracker ──

describe('trackVariableUsage', () => {
  it('tracks variable definitions', () => {
    const lines = ['#1 = 10', 'G1 X#1 Y0 F500'];
    const result = trackVariableUsage(lines);
    expect(result.variables.length).toBeGreaterThan(0);
  });

  it('tracks usage count', () => {
    const lines = ['#1 = 10', 'G1 X#1 Y0 F500', 'G1 X#1 Y10 F500'];
    const result = trackVariableUsage(lines);
    expect(result.variables[0].usageCount).toBeGreaterThan(0);
  });

  it('handles no variables', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = trackVariableUsage(lines);
    expect(result.variableCount).toBe(0);
  });
});

// ── 8. Tool Path Segment Classifier ──

describe('classifyToolpathSegments', () => {
  it('classifies segments', () => {
    const lines = ['G1 X10 Y0 Z0 F2000', 'G1 X20 Y0 Z0 F2000', 'G1 X30 Y0 Z-1 F300'];
    const result = classifyToolpathSegments(lines);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('identifies dominant type', () => {
    const lines = ['G1 X10 Y0 Z0 F2000', 'G1 X20 Y0 Z0 F2000', 'G1 X30 Y0 Z0 F2000'];
    const result = classifyToolpathSegments(lines);
    expect(result.dominantType).not.toBe('none');
  });

  it('handles no segments', () => {
    const lines = ['M3 S1000'];
    const result = classifyToolpathSegments(lines);
    expect(result.totalSegments).toBe(0);
  });
});

// ── 9. Infill Density Variance ──

describe('analyzeInfillDensityVariance', () => {
  it('analyzes infill variance', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800', 'G1 X30 Y10 E15 F1800'];
    const result = analyzeInfillDensityVariance(lines, 5);
    expect(result.regions.length).toBe(25);
  });

  it('computes uniformity score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = analyzeInfillDensityVariance(lines, 5);
    expect(result.uniformityScore).toBeGreaterThanOrEqual(0);
    expect(result.uniformityScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeInfillDensityVariance(lines);
    expect(result.regions).toEqual([]);
  });
});

// ── 10. Error Pattern Detector ──

describe('detectErrorPatterns', () => {
  it('detects error patterns', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20', 'S-1000', 'G1 X30 Y30'];
    const result = detectErrorPatterns(lines);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('detects negative RPM', () => {
    const lines = ['M3 S-5000', 'G1 X10 Y0 F500'];
    const result = detectErrorPatterns(lines);
    expect(result.patterns.some(p => p.name === 'negative_rpm')).toBe(true);
  });

  it('handles clean G-code', () => {
    const lines = ['G21 G90', 'G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M30'];
    const result = detectErrorPatterns(lines);
    expect(result.errorFreeScore).toBeGreaterThan(50);
  });
});

// ── 11. Surface Speed Calculator ──

describe('calculateSurfaceSpeed', () => {
  it('calculates surface speed', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500'];
    const result = calculateSurfaceSpeed(lines, 6, 'aluminum');
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points[0].surfaceSpeed).toBeGreaterThan(0);
  });

  it('computes in-range percentage', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 F500'];
    const result = calculateSurfaceSpeed(lines, 6, 'aluminum');
    expect(result.inRangePercentage).toBeGreaterThanOrEqual(0);
    expect(result.inRangePercentage).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateSurfaceSpeed(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 12. Layer Time Variance ──

describe('analyzeLayerTimeVariance', () => {
  it('analyzes layer time variance', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X30 Y10 E15 F1800 Z0.4',
      'G1 X40 Y10 E20 F1800 Z0.4',
    ];
    const result = analyzeLayerTimeVariance(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.4',
    ];
    const result = analyzeLayerTimeVariance(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeLayerTimeVariance(lines);
    expect(result.layerCount).toBe(0);
  });
});
