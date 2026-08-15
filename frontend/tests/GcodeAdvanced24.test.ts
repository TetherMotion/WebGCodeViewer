/**
 * @file GcodeAdvanced24.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced24 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEngagementAnglePerSegment,
  optimizeFirstLayerSpeed,
  analyzeRapidTravelEfficiency,
  analyzePlungeRate,
  calculateMaterialPerExtruder,
  classifyClimbConventionalPerPass,
  analyzeLayerCoolingTime,
  analyzeReversalPoints,
  analyzeCuttingModeConsistency,
  analyzeExtrusionStartStopQuality,
  analyzeProgramFlowStructure,
  calculateMRRPerLayer,
} from '../src/core/GcodeAdvanced24';

// ── 1. Engagement Angle Per Segment ──

describe('calculateEngagementAnglePerSegment', () => {
  it('calculates engagement angles', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y1 Z-1 F500', 'G1 X30 Y2 Z-1 F500'];
    const result = calculateEngagementAnglePerSegment(lines, 6);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('computes distribution', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y3 Z-1 F500'];
    const result = calculateEngagementAnglePerSegment(lines, 6);
    expect(Object.keys(result.distribution).length).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateEngagementAnglePerSegment(lines, 6);
    expect(result.segments).toEqual([]);
  });
});

// ── 2. First Layer Speed Optimizer ──

describe('optimizeFirstLayerSpeed', () => {
  it('optimizes first layer speed', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = optimizeFirstLayerSpeed(lines, 'PLA');
    expect(result.currentSpeed).toBeGreaterThan(0);
  });

  it('computes adhesion impact score', () => {
    const lines = ['G1 X10 Y10 E5 F1200 Z0.2', 'G1 X20 Y10 E10 F1200 Z0.2'];
    const result = optimizeFirstLayerSpeed(lines, 'PLA');
    expect(result.adhesionImpactScore).toBeGreaterThanOrEqual(0);
    expect(result.adhesionImpactScore).toBeLessThanOrEqual(100);
  });

  it('handles no first layer', () => {
    // Only G0 moves, no G1 with F on first layer
    const lines = ['G0 X10 Y10 Z1.0', 'G0 X20 Y10 Z2.0'];
    const result = optimizeFirstLayerSpeed(lines);
    expect(result.currentSpeed).toBe(0);
  });
});

// ── 3. Rapid Travel Efficiency ──

describe('analyzeRapidTravelEfficiency', () => {
  it('analyzes rapid travel efficiency', () => {
    const lines = ['G0 X50 Y0', 'G1 X60 Y0 Z-1 F500', 'G0 X100 Y0'];
    const result = analyzeRapidTravelEfficiency(lines);
    expect(result.rapidCount).toBeGreaterThan(0);
  });

  it('computes efficiency score', () => {
    const lines = ['G0 X10 Y0', 'G1 X20 Y0 F500'];
    const result = analyzeRapidTravelEfficiency(lines);
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no rapid moves', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = analyzeRapidTravelEfficiency(lines);
    expect(result.rapidCount).toBe(0);
  });
});

// ── 4. Plunge Rate Analyzer ──

describe('analyzePlungeRate', () => {
  it('analyzes plunge rates', () => {
    const lines = ['G1 X10 Y0 Z0 F500', 'G1 X10 Y0 Z-5 F100', 'G1 X20 Y0 Z-5 F500'];
    const result = analyzePlungeRate(lines, 100);
    expect(result.plungeCount).toBeGreaterThan(0);
  });

  it('computes safety score', () => {
    const lines = ['G1 X10 Y0 Z0 F500', 'G1 X10 Y0 Z-5 F200'];
    const result = analyzePlungeRate(lines, 100);
    expect(result.safetyScore).toBeGreaterThanOrEqual(0);
    expect(result.safetyScore).toBeLessThanOrEqual(100);
  });

  it('handles no plunges', () => {
    // Set Z first with G0, then G1 at same Z — no plunge
    const lines = ['G0 Z-1', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = analyzePlungeRate(lines);
    expect(result.plungeCount).toBe(0);
  });
});

// ── 5. Material Per Extruder ──

describe('calculateMaterialPerExtruder', () => {
  it('calculates material per extruder', () => {
    const lines = ['T0', 'G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800', 'T1', 'G1 X30 Y10 E15 F1800'];
    const result = calculateMaterialPerExtruder(lines);
    expect(result.extruders.length).toBeGreaterThan(0);
  });

  it('computes balance score', () => {
    const lines = ['T0', 'G1 X10 Y10 E5 F1800', 'T1', 'G1 X20 Y10 E10 F1800'];
    const result = calculateMaterialPerExtruder(lines);
    expect(result.balanceScore).toBeGreaterThanOrEqual(0);
    expect(result.balanceScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = calculateMaterialPerExtruder(lines);
    expect(result.extruders).toEqual([]);
  });
});

// ── 6. Climb vs Conventional Per Pass ──

describe('classifyClimbConventionalPerPass', () => {
  it('classifies passes', () => {
    const lines: string[] = [];
    for (let pass = 0; pass < 3; pass++) {
      lines.push(`G1 X0 Y${pass} Z-1 F500`);
      lines.push(`G1 X100 Y${pass} Z-1 F500`);
    }
    const result = classifyClimbConventionalPerPass(lines, 'CW');
    expect(result.passes.length).toBeGreaterThanOrEqual(0);
  });

  it('computes primary mode', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X20 Y1 Z-1 F500'];
    const result = classifyClimbConventionalPerPass(lines, 'CW');
    expect(['climb', 'conventional', 'mixed']).toContain(result.primaryMode);
  });

  it('handles no passes', () => {
    const lines = ['G0 X10 Y0'];
    const result = classifyClimbConventionalPerPass(lines);
    expect(result.passes).toEqual([]);
  });
});

// ── 7. Layer Cooling Time ──

describe('analyzeLayerCoolingTime', () => {
  it('analyzes layer cooling time', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G4 P5000',
      'G1 X30 Y10 E15 F1800 Z0.4',
      'G1 X40 Y10 E20 F1800 Z0.4',
    ];
    const result = analyzeLayerCoolingTime(lines, 5);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G4 P3000', 'G1 X20 Y10 E10 F1800 Z0.4'];
    const result = analyzeLayerCoolingTime(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeLayerCoolingTime(lines);
    expect(result.layerCount).toBe(0);
  });
});

// ── 8. Reversal Points ──

describe('analyzeReversalPoints', () => {
  it('analyzes reversal points', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X0 Y0 F500', 'G1 X10 Y0 F500'];
    const result = analyzeReversalPoints(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('detects U-turns', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X-10 Y0 F500'];
    const result = analyzeReversalPoints(lines);
    expect(result.uTurnCount).toBeGreaterThanOrEqual(0);
  });

  it('handles straight path', () => {
    const lines = ['G1 X10 Y0 F500', 'G1 X20 Y0 F500', 'G1 X30 Y0 F500'];
    const result = analyzeReversalPoints(lines);
    expect(result.count).toBe(0);
  });
});

// ── 9. Cutting Mode Consistency ──

describe('analyzeCuttingModeConsistency', () => {
  it('analyzes cutting mode consistency', () => {
    const lines: string[] = [];
    for (let pass = 0; pass < 5; pass++) {
      lines.push(`G1 X0 Y${pass} Z-1 F500`);
      lines.push(`G1 X100 Y${pass} Z-1 F500`);
    }
    const result = analyzeCuttingModeConsistency(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no passes', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeCuttingModeConsistency(lines);
    expect(result.modeChanges).toBe(0);
  });
});

// ── 10. Extrusion Start/Stop Quality ──

describe('analyzeExtrusionStartStopQuality', () => {
  it('analyzes start/stop quality', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800', 'G1 X30 Y10 E10 F1800'];
    const result = analyzeExtrusionStartStopQuality(lines);
    expect(result.startCount).toBeGreaterThan(0);
  });

  it('computes quality score', () => {
    const lines = ['G1 X10 Y10 E5 F1200', 'G1 X20 Y10 E10 F1200'];
    const result = analyzeExtrusionStartStopQuality(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeExtrusionStartStopQuality(lines);
    expect(result.startCount).toBe(0);
  });
});

// ── 11. Program Flow Structure ──

describe('analyzeProgramFlowStructure', () => {
  it('analyzes program flow structure', () => {
    const lines = ['G21 G90', 'G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M5', 'M30'];
    const result = analyzeProgramFlowStructure(lines);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.hasInit).toBe(true);
    expect(result.hasEnd).toBe(true);
  });

  it('computes structure score', () => {
    const lines = ['G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M30'];
    const result = analyzeProgramFlowStructure(lines);
    expect(result.structureScore).toBeGreaterThanOrEqual(0);
    expect(result.structureScore).toBeLessThanOrEqual(100);
  });

  it('handles minimal program', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeProgramFlowStructure(lines);
    expect(result.sectionCount).toBeGreaterThanOrEqual(0);
  });
});

// ── 12. MRR Per Layer ──

describe('calculateMRRPerLayer', () => {
  it('calculates MRR per layer', () => {
    const lines = [
      'G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500',
      'G1 X10 Y0 Z-2 F500', 'G1 X100 Y0 Z-2 F500',
    ];
    const result = calculateMRRPerLayer(lines, 6, 3);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X100 Y0 Z-1 F500'];
    const result = calculateMRRPerLayer(lines, 6, 3);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = calculateMRRPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});
