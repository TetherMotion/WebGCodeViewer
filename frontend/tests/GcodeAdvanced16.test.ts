/**
 * @file GcodeAdvanced16.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced16 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeLineStatistics,
  generateEngagementMap,
  visualizeBedMesh,
  generateCommandFlow,
  calculateChipLoad,
  estimateSpoolUsage,
  suggestErrorRecovery,
  calculateMRR,
  analyzeCoasting,
  identifyBottlenecks,
  calculatePullOffDistance,
  analyzeFirstLayerSquish,
} from '../src/core/GcodeAdvanced16';

// ── 1. Line Statistics ──

describe('analyzeLineStatistics', () => {
  it('computes per-line statistics', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500'];
    const result = analyzeLineStatistics(lines);
    expect(result.lines.length).toBe(2);
    expect(result.lines[0].distance).toBe(10);
  });

  it('computes total distance', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500'];
    const result = analyzeLineStatistics(lines);
    expect(result.totalDistance).toBe(20);
  });

  it('separates travel and active distance', () => {
    const lines = ['G0 X50 Y0', 'G1 X60 Y0 Z-1 F500'];
    const result = analyzeLineStatistics(lines);
    expect(result.totalTravelDistance).toBe(50);
    // Active distance includes Z component
    expect(result.totalActiveDistance).toBeCloseTo(10.05, 1);
  });

  it('handles no motion', () => {
    const result = analyzeLineStatistics(['M3 S1000']);
    expect(result.lines).toEqual([]);
  });
});

// ── 2. Engagement Map ──

describe('generateEngagementMap', () => {
  it('generates engagement map', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = generateEngagementMap(lines, 5);
    expect(result.cells.length).toBe(25);
  });

  it('computes max engagement angle', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = generateEngagementMap(lines, 5);
    expect(result.maxEngagementAngle).toBeGreaterThanOrEqual(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = generateEngagementMap(lines);
    expect(result.cells).toEqual([]);
  });
});

// ── 3. Bed Mesh Visualizer ──

describe('visualizeBedMesh', () => {
  it('parses G30 probe points', () => {
    const lines = ['G30 X10 Y10 Z0.1', 'G30 X50 Y10 Z-0.1', 'G30 X10 Y50 Z0.05'];
    const result = visualizeBedMesh(lines);
    expect(result.points.length).toBe(3);
    expect(result.hasMesh).toBe(true);
  });

  it('computes flatness score', () => {
    const lines = ['G30 X10 Y10 Z0.1', 'G30 X50 Y10 Z0.1'];
    const result = visualizeBedMesh(lines);
    expect(result.flatnessScore).toBeGreaterThanOrEqual(0);
    expect(result.flatnessScore).toBeLessThanOrEqual(100);
  });

  it('handles no mesh', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = visualizeBedMesh(lines);
    expect(result.hasMesh).toBe(false);
  });
});

// ── 4. Command Flow ──

describe('generateCommandFlow', () => {
  it('generates flow nodes', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateCommandFlow(lines);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('creates links between nodes', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateCommandFlow(lines);
    expect(result.links.length).toBeGreaterThan(0);
  });

  it('computes distribution', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = generateCommandFlow(lines);
    expect(result.distribution.linear).toBe(2);
  });

  it('handles empty input', () => {
    const result = generateCommandFlow([]);
    expect(result.totalCommands).toBe(0);
  });
});

// ── 5. Chip Load Calculator ──

describe('calculateChipLoad', () => {
  it('calculates chip load', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = calculateChipLoad(lines);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points[0].chipLoad).toBeGreaterThan(0);
  });

  it('computes in-range percentage', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = calculateChipLoad(lines);
    expect(result.inRangePercentage).toBeGreaterThanOrEqual(0);
    expect(result.inRangePercentage).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateChipLoad(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 6. Spool Estimator ──

describe('estimateSpoolUsage', () => {
  it('estimates filament usage', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = estimateSpoolUsage(lines);
    // E goes from 5 to 10 = 5mm of filament
    expect(result.filamentUsedMm).toBe(5);
  });

  it('computes weight', () => {
    const lines = ['G1 X10 Y10 E0 F1800', 'G1 X20 Y20 E100 F1800'];
    const result = estimateSpoolUsage(lines);
    expect(result.filamentWeightG).toBeGreaterThan(0);
  });

  it('checks spool sufficiency', () => {
    const lines = ['G1 X10 Y10 E100 F1800'];
    const result = estimateSpoolUsage(lines, 1.75, 1.24, 1000);
    expect(result.sufficient).toBe(true);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = estimateSpoolUsage(lines);
    expect(result.filamentUsedMm).toBe(0);
  });
});

// ── 7. Error Recovery ──

describe('suggestErrorRecovery', () => {
  it('detects motion before homing', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = suggestErrorRecovery(lines);
    expect(result.suggestions.some(s => s.errorType === 'no_homing')).toBe(true);
  });

  it('detects cutting without spindle', () => {
    const lines = ['G28', 'G1 X10 Y0 Z-1 F500'];
    const result = suggestErrorRecovery(lines);
    expect(result.suggestions.some(s => s.errorType === 'no_spindle')).toBe(true);
  });

  it('passes clean G-code', () => {
    const lines = ['G21 G90', 'G28', 'M3 S1000', 'T1 M6', 'G1 X10 Y0 Z-1 F500', 'M30'];
    const result = suggestErrorRecovery(lines);
    expect(result.hasErrors).toBe(false);
  });

  it('computes recovery score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = suggestErrorRecovery(lines);
    expect(result.recoveryScore).toBeGreaterThanOrEqual(0);
    expect(result.recoveryScore).toBeLessThanOrEqual(100);
  });
});

// ── 8. MRR Calculator ──

describe('calculateMRR', () => {
  it('calculates MRR', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = calculateMRR(lines);
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points[0].mrr).toBeGreaterThan(0);
  });

  it('computes total volume', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = calculateMRR(lines);
    expect(result.totalVolume).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateMRR(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 9. Coasting Analysis ──

describe('analyzeCoasting', () => {
  it('analyzes coasting', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E4.8 F1800', 'G0 X20 Y20'];
    const result = analyzeCoasting(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('detects coasting transitions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E4.8 F1800', 'G0 X20 Y20'];
    const result = analyzeCoasting(lines);
    expect(result.coastingCount).toBeGreaterThan(0);
  });

  it('handles no coasting', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = analyzeCoasting(lines);
    expect(result.coastingCount).toBe(0);
  });
});

// ── 10. Bottleneck Analyzer ──

describe('identifyBottlenecks', () => {
  it('identifies slow feed bottlenecks', () => {
    const lines = ['G1 X10 Y0 F50'];
    const result = identifyBottlenecks(lines, 100);
    expect(result.bottlenecks.some(b => b.type === 'slow_feed')).toBe(true);
  });

  it('identifies excessive dwell', () => {
    const lines = ['G4 P2000'];
    const result = identifyBottlenecks(lines);
    expect(result.bottlenecks.some(b => b.type === 'excessive_dwell')).toBe(true);
  });

  it('identifies tool changes', () => {
    const lines = ['M6 T1'];
    const result = identifyBottlenecks(lines);
    expect(result.bottlenecks.some(b => b.type === 'tool_change')).toBe(true);
  });

  it('passes clean G-code', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = identifyBottlenecks(lines, 100);
    expect(result.count).toBe(0);
  });
});

// ── 11. Pull-off Calculator ──

describe('calculatePullOffDistance', () => {
  it('calculates pull-off distance', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-2 F500'];
    const result = calculatePullOffDistance(lines);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.recommendedDistance).toBeGreaterThan(0);
  });

  it('computes average pull-off', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-3 F500'];
    const result = calculatePullOffDistance(lines);
    expect(result.avgPullOff).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculatePullOffDistance(lines);
    expect(result.operations).toEqual([]);
  });
});

// ── 12. First Layer Squish ──

describe('analyzeFirstLayerSquish', () => {
  it('analyzes first layer squish', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeFirstLayerSquish(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes squish ratio', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeFirstLayerSquish(lines);
    expect(result.avgSquishRatio).toBeGreaterThan(0);
  });

  it('computes optimal percentage', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2'];
    const result = analyzeFirstLayerSquish(lines);
    expect(result.optimalPercentage).toBeGreaterThanOrEqual(0);
    expect(result.optimalPercentage).toBeLessThanOrEqual(100);
  });

  it('handles no first layer', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeFirstLayerSquish(lines);
    expect(result.points).toEqual([]);
  });
});
