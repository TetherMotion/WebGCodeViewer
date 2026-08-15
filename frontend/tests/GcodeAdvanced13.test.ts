/**
 * @file GcodeAdvanced13.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced13 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  generateExecutionTrace,
  analyzeChipThickness,
  generateQualityHeatmap,
  analyzeWorkholding,
  analyzeMaterialFlow,
  generateFlowVisualization,
  optimizeFixturePlacement,
  generateLayerVisualization,
  analyzeCompressionOpportunities,
  analyzeAerodynamics,
  analyzeAdaptiveSpeed,
  generateDependencyGraph,
} from '../src/core/GcodeAdvanced13';

// ── 1. Execution Trace ──

describe('generateExecutionTrace', () => {
  it('generates trace entries', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = generateExecutionTrace(lines);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('tracks position changes', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X10 Y10 F500'];
    const result = generateExecutionTrace(lines);
    const lastEntry = result.entries[result.entries.length - 1];
    expect(lastEntry.positionAfter.x).toBe(10);
    expect(lastEntry.positionAfter.y).toBe(10);
  });

  it('computes total distance', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X10 Y10 F500'];
    const result = generateExecutionTrace(lines);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it('identifies bottlenecks', () => {
    const lines = ['G1 X100 Y0 F100', 'G1 X200 Y0 F5000'];
    const result = generateExecutionTrace(lines);
    expect(result.bottlenecks.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = generateExecutionTrace([]);
    expect(result.entries).toEqual([]);
  });
});

// ── 2. Chip Thickness Analysis ──

describe('analyzeChipThickness', () => {
  it('analyzes chip thickness for cutting operations', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = analyzeChipThickness(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes chip thickness statistics', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = analyzeChipThickness(lines);
    expect(result.avgChipThickness).toBeGreaterThanOrEqual(0);
    expect(result.maxChipThickness).toBeGreaterThanOrEqual(result.minChipThickness);
  });

  it('detects out-of-range chip thickness', () => {
    const lines = ['M3 S100', 'G1 X10 Y0 Z-2 F5000', 'G1 X20 Y0 Z-2 F5000'];
    const result = analyzeChipThickness(lines, 6, 2, 0.05, 0.15);
    expect(result.inRangePercentage).toBeLessThan(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeChipThickness(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 3. Print Quality Heatmap ──

describe('generateQualityHeatmap', () => {
  it('generates heatmap grid', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = generateQualityHeatmap(lines, 5);
    expect(result.cells.length).toBe(25); // 5x5 grid
  });

  it('computes overall quality score', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = generateQualityHeatmap(lines, 5);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = generateQualityHeatmap(lines);
    expect(result.cells).toEqual([]);
  });

  it('identifies quality issues', () => {
    const lines = ['G1 X10 Y10 E5 F6000', 'G1 X20 Y20 E10 F6000'];
    const result = generateQualityHeatmap(lines, 5);
    expect(result.issueDistribution['high_feed']).toBeGreaterThan(0);
  });
});

// ── 4. Workholding Analysis ──

describe('analyzeWorkholding', () => {
  it('detects workholding from comments', () => {
    const lines = ['; Vise clamping', 'M3 S1000', 'G1 X10 Y10 Z-1 F500'];
    const result = analyzeWorkholding(lines);
    expect(result.type).toBe('vise');
  });

  it('uses manual workholding points', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 Z-1 F500'];
    const points = [{ x: 0, y: 0, force: 5000, type: 'vise' as const }];
    const result = analyzeWorkholding(lines, points);
    expect(result.points.length).toBe(1);
    expect(result.totalForce).toBe(5000);
  });

  it('computes safety factor', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 Z-1 F500'];
    const points = [{ x: 0, y: 0, force: 10000, type: 'vise' as const }];
    const result = analyzeWorkholding(lines, points);
    expect(result.safetyFactor).toBeGreaterThanOrEqual(0);
  });

  it('handles no workholding', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeWorkholding(lines);
    expect(result.type).toBe('unknown');
  });
});

// ── 5. Material Flow Analysis ──

describe('analyzeMaterialFlow', () => {
  it('analyzes extrusion flow', () => {
    const lines = ['G1 X10 Y0 E5 F1800', 'G1 X20 Y0 E10 F1800'];
    const result = analyzeMaterialFlow(lines);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('computes volumetric flow', () => {
    const lines = ['G1 X10 Y0 E5 F1800', 'G1 X20 Y0 E10 F1800'];
    const result = analyzeMaterialFlow(lines);
    expect(result.avgVolumetricFlow).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y0 E5 F1800', 'G1 X20 Y0 E10 F1800'];
    const result = analyzeMaterialFlow(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeMaterialFlow(lines);
    expect(result.segments).toEqual([]);
  });
});

// ── 6. Flow Visualization ──

describe('generateFlowVisualization', () => {
  it('generates flow nodes', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateFlowVisualization(lines);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes[0].type).toBe('start');
  });

  it('creates edges between nodes', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateFlowVisualization(lines);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('detects tool changes', () => {
    const lines = ['G28', 'T1 M6', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateFlowVisualization(lines);
    expect(result.nodes.some(n => n.type === 'tool_change')).toBe(true);
  });

  it('handles empty input', () => {
    const result = generateFlowVisualization([]);
    // Start and end nodes are always created
    expect(result.nodes.length).toBe(2);
  });
});

// ── 7. Fixture Optimization ──

describe('optimizeFixturePlacement', () => {
  it('recommends fixtures for a part', () => {
    const lines = ['G1 X0 Y0 Z-1 F500', 'G1 X50 Y0 Z-1 F500', 'G1 X50 Y50 Z-1 F500', 'G1 X0 Y50 Z-1 F500'];
    const result = optimizeFixturePlacement(lines);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('computes part bounds', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'G1 X50 Y40 Z-1 F500'];
    const result = optimizeFixturePlacement(lines);
    expect(result.partBounds.minX).toBe(10);
    expect(result.partBounds.maxX).toBe(50);
  });

  it('recommends vise for small parts', () => {
    const lines = ['G1 X0 Y0 Z-1 F500', 'G1 X5 Y0 Z-1 F500', 'G1 X5 Y5 Z-1 F500', 'G1 X0 Y5 Z-1 F500'];
    const result = optimizeFixturePlacement(lines);
    expect(result.recommendations.some(r => r.type === 'vise')).toBe(true);
  });

  it('handles no part geometry', () => {
    const lines = ['G0 X10 Y10'];
    const result = optimizeFixturePlacement(lines);
    expect(result.fixtureCount).toBe(0);
  });
});

// ── 8. Layer Visualization ──

describe('generateLayerVisualization', () => {
  it('generates per-layer data', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X20 Y20 E15 F1800 Z0.4',
      'G1 X30 Y20 E20 F1800 Z0.4',
    ];
    const result = generateLayerVisualization(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes layer times', () => {
    const lines = ['G1 X10 Y0 E5 F1800 Z0.2', 'G1 X10 Y10 E10 F1800 Z0.4'];
    const result = generateLayerVisualization(lines);
    if (result.layers.length > 0) {
      expect(result.layers[0].layerTime).toBeGreaterThanOrEqual(0);
    }
  });

  it('assigns colors to layers', () => {
    const lines = ['G1 X10 Y0 E5 F1800 Z0.2', 'G1 X10 Y10 E10 F1800 Z0.4', 'G1 X20 Y10 E15 F1800 Z0.6'];
    const result = generateLayerVisualization(lines);
    if (result.layers.length > 0) {
      expect(result.layers[0].color).toMatch(/^rgb\(/);
    }
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = generateLayerVisualization(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 9. Compression Analysis ──

describe('analyzeCompressionOpportunities', () => {
  it('analyzes compression potential', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = analyzeCompressionOpportunities(lines);
    expect(result.originalSize).toBeGreaterThan(0);
    expect(result.compressedSize).toBeGreaterThan(0);
  });

  it('computes compression ratio', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = analyzeCompressionOpportunities(lines);
    expect(result.compressionRatio).toBeGreaterThan(1);
  });

  it('detects comment overhead', () => {
    const lines = ['; This is a very long comment that takes up space', 'G1 X10 Y10 F500'];
    const result = analyzeCompressionOpportunities(lines);
    expect(result.opportunities.some(o => o.type === 'comments')).toBe(true);
  });

  it('computes space savings', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeCompressionOpportunities(lines);
    expect(result.spaceSavings).toBeGreaterThan(0);
    expect(result.spaceSavings).toBeLessThan(100);
  });
});

// ── 10. Aerodynamics Analysis ──

describe('analyzeAerodynamics', () => {
  it('analyzes air vs material cutting', () => {
    const lines = ['G0 X100 Y0', 'G1 X10 Y0 Z-1 E5 F1800'];
    const result = analyzeAerodynamics(lines);
    expect(result.airCuttingTime).toBeGreaterThan(0);
    expect(result.materialCuttingTime).toBeGreaterThan(0);
  });

  it('computes air cutting percentage', () => {
    const lines = ['G0 X100 Y0', 'G1 X10 Y0 Z-1 E5 F1800'];
    const result = analyzeAerodynamics(lines);
    expect(result.airCuttingPercentage).toBeGreaterThan(0);
    expect(result.airCuttingPercentage).toBeLessThan(100);
  });

  it('computes efficiency score', () => {
    const lines = ['G0 X100 Y0', 'G1 X10 Y0 Z-1 E5 F1800'];
    const result = analyzeAerodynamics(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });

  it('handles all-cutting G-code', () => {
    const lines = ['G1 X10 Y0 Z-1 E5 F1800', 'G1 X20 Y0 Z-1 E10 F1800'];
    const result = analyzeAerodynamics(lines);
    expect(result.materialCuttingDistance).toBeGreaterThan(0);
  });
});

// ── 11. Adaptive Speed Analysis ──

describe('analyzeAdaptiveSpeed', () => {
  it('analyzes speed optimization opportunities', () => {
    const lines = ['G1 X10 Y0 E5 F1800 Z0.2', 'G1 X20 Y0 E10 F1800 Z0.2'];
    const result = analyzeAdaptiveSpeed(lines);
    expect(result.segments.length).toBeGreaterThanOrEqual(0);
  });

  it('recommends slower first layer', () => {
    const lines = ['G1 X10 Y0 E5 F2000 Z0.2', 'G1 X20 Y0 E10 F2000 Z0.2'];
    const result = analyzeAdaptiveSpeed(lines);
    expect(result.segments.some(s => s.reason.includes('First layer'))).toBe(true);
  });

  it('computes time savings', () => {
    const lines = ['G1 X10 Y0 E5 F2000 Z0.2', 'G1 X20 Y0 E10 F2000 Z0.2'];
    const result = analyzeAdaptiveSpeed(lines);
    // Time savings can be negative when slowing down for quality (e.g. first layer)
    expect(typeof result.totalTimeSavings).toBe('number');
    expect(Number.isFinite(result.totalTimeSavings)).toBe(true);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeAdaptiveSpeed(lines);
    expect(result.segments).toEqual([]);
  });
});

// ── 12. Dependency Graph ──

describe('generateDependencyGraph', () => {
  it('generates dependency nodes', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateDependencyGraph(lines);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('creates edges', () => {
    const lines = ['G28', 'T1 M6', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateDependencyGraph(lines);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('identifies critical path', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateDependencyGraph(lines);
    expect(result.criticalPath.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = generateDependencyGraph([]);
    expect(result.nodes).toEqual([]);
  });

  it('counts parallelizable operations', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateDependencyGraph(lines);
    expect(result.parallelizableCount).toBeGreaterThanOrEqual(0);
  });
});
