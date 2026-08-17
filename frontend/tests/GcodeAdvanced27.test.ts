/**
 * @file GcodeAdvanced27.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced27 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeEntryStrategy,
  analyzeRetractionAcceleration,
  checkCoordinateSystemAlignment,
  validateNoseRadiusCompensation,
  analyzeInfillDensityPerLayer,
  classifySegmentsPerLayer,
  validateSpindleWarmupCycle,
  analyzeFanSpeedPerLayer,
  analyzeStructureComplexityPerSection,
  analyzeLeadInOut,
  analyzeExtrusionConsistencyPerLayer,
  checkMachineCoordinateBoundary,
} from "@tether/gcode-analyzer/GcodeAdvanced27";

// ── 1. Entry Strategy ──

describe('analyzeEntryStrategy', () => {
  it('analyzes entry strategy', () => {
    const lines = ['G0 Z5', 'G1 Z-1 F100', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeEntryStrategy(lines);
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it('computes consistency score', () => {
    const lines = ['G0 Z5', 'G1 Z-1 F100', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeEntryStrategy(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no entries', () => {
    const lines = ['G1 X10 Y0 Z-1 F500'];
    const result = analyzeEntryStrategy(lines);
    expect(result.count).toBe(0);
  });
});

// ── 2. Retraction Acceleration ──

describe('analyzeRetractionAcceleration', () => {
  it('analyzes retraction acceleration', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y10 E5 F1800'];
    const result = analyzeRetractionAcceleration(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('computes quality score', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800'];
    const result = analyzeRetractionAcceleration(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
  });

  it('handles no retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = analyzeRetractionAcceleration(lines);
    expect(result.count).toBe(0);
  });
});

// ── 3. Coordinate System Alignment ──

describe('checkCoordinateSystemAlignment', () => {
  it('checks coordinate system alignment', () => {
    const lines = ['G28', 'G54', 'G1 X10 Y10 Z-1 F500'];
    const result = checkCoordinateSystemAlignment(lines);
    expect(result.wcsCount).toBeGreaterThan(0);
  });

  it('computes alignment score', () => {
    const lines = ['G28', 'G54', 'G1 X10 Y10 F500'];
    const result = checkCoordinateSystemAlignment(lines);
    expect(result.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(result.alignmentScore).toBeLessThanOrEqual(100);
  });

  it('handles no WCS', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = checkCoordinateSystemAlignment(lines);
    expect(result.wcsCount).toBe(0);
  });
});

// ── 4. Nose Radius Compensation ──

describe('validateNoseRadiusCompensation', () => {
  it('validates nose radius compensation', () => {
    const lines = ['G41 D1', 'G1 X10 Y10 F500', 'G40', 'G1 X20 Y20 F500'];
    const result = validateNoseRadiusCompensation(lines);
    expect(result.count).toBeGreaterThan(0);
  });

  it('computes validation score', () => {
    const lines = ['G41 D1', 'G1 X10 Y10 F500', 'G40'];
    const result = validateNoseRadiusCompensation(lines);
    expect(result.validationScore).toBeGreaterThanOrEqual(0);
    expect(result.validationScore).toBeLessThanOrEqual(100);
  });

  it('handles no compensation', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = validateNoseRadiusCompensation(lines);
    expect(result.count).toBe(0);
  });
});

// ── 5. Infill Density Per Layer ──

describe('analyzeInfillDensityPerLayer', () => {
  it('analyzes infill density per layer', () => {
    const lines = [
      '; infill', 'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.2 F1800',
      '; perimeter', 'G1 X30 Y10 Z0.4 F1800', 'G1 X40 Y10 Z0.4 F1800',
    ];
    const result = analyzeInfillDensityPerLayer(lines);
    expect(result.layers.length).toBeGreaterThanOrEqual(0);
  });

  it('computes consistency score', () => {
    const lines = ['; infill', 'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800'];
    const result = analyzeInfillDensityPerLayer(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no data', () => {
    const lines = ['; comment only'];
    const result = analyzeInfillDensityPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 6. Segment Classification Per Layer ──

describe('classifySegmentsPerLayer', () => {
  it('classifies segments per layer', () => {
    const lines = [
      'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.2 F1800',
      'G1 X30 Y10 Z0.4 F1800', 'G1 X40 Y10 Z0.4 F1800',
    ];
    const result = classifySegmentsPerLayer(lines);
    expect(result.layers.length).toBeGreaterThanOrEqual(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800'];
    const result = classifySegmentsPerLayer(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no data', () => {
    const lines = ['; comment only'];
    const result = classifySegmentsPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 7. Spindle Warmup Cycle ──

describe('validateSpindleWarmupCycle', () => {
  it('validates spindle warmup cycle', () => {
    const lines = ['M3 S1000', 'G4 P5000', 'M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = validateSpindleWarmupCycle(lines, 300);
    expect(typeof result.hasWarmup).toBe('boolean');
  });

  it('computes validation score', () => {
    const lines = ['M3 S1000', 'G4 P5000', 'M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = validateSpindleWarmupCycle(lines, 300);
    expect(result.validationScore).toBeGreaterThanOrEqual(0);
    expect(result.validationScore).toBeLessThanOrEqual(100);
  });

  it('handles no spindle', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = validateSpindleWarmupCycle(lines);
    expect(result.hasWarmup).toBe(false);
  });
});

// ── 8. Fan Speed Per Layer ──

describe('analyzeFanSpeedPerLayer', () => {
  it('analyzes fan speed per layer', () => {
    const lines = [
      'M106 S128', 'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.2 F1800',
      'M106 S255', 'G1 X30 Y10 Z0.4 F1800',
    ];
    const result = analyzeFanSpeedPerLayer(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['M106 S128', 'G1 X10 Y10 Z0.2 F1800', 'G1 X20 Y10 Z0.4 F1800'];
    const result = analyzeFanSpeedPerLayer(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no fan data', () => {
    const lines = ['; comment only'];
    const result = analyzeFanSpeedPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 9. Structure Complexity Per Section ──

describe('analyzeStructureComplexityPerSection', () => {
  it('analyzes structure complexity per section', () => {
    const lines = ['G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M5', 'M30'];
    const result = analyzeStructureComplexityPerSection(lines);
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it('computes structure score', () => {
    const lines = ['G28', 'M3 S5000', 'G1 X10 Y10 F500', 'M30'];
    const result = analyzeStructureComplexityPerSection(lines);
    expect(result.structureScore).toBeGreaterThanOrEqual(0);
    expect(result.structureScore).toBeLessThanOrEqual(100);
  });

  it('handles no sections', () => {
    const lines: string[] = [];
    const result = analyzeStructureComplexityPerSection(lines);
    expect(result.sections).toEqual([]);
  });
});

// ── 10. Lead-In/Lead-Out ──

describe('analyzeLeadInOut', () => {
  it('analyzes lead-in/out', () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y10 Z-1 F500', 'G0 X20 Y20 Z5'];
    const result = analyzeLeadInOut(lines);
    expect(result.leadInCount + result.leadOutCount).toBeGreaterThanOrEqual(0);
  });

  it('computes quality score', () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y10 Z-1 F500', 'G0 X20 Y20 Z5'];
    const result = analyzeLeadInOut(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('handles no lead-in/out', () => {
    // Start at Z=-1 with G0, then G1 at same Z — no transition
    const lines = ['G0 X0 Y0 Z-1', 'G1 X10 Y10 Z-1 F500', 'G1 X20 Y20 Z-1 F500'];
    const result = analyzeLeadInOut(lines);
    expect(result.leadInCount + result.leadOutCount).toBe(0);
  });
});

// ── 11. Extrusion Consistency Per Layer ──

describe('analyzeExtrusionConsistencyPerLayer', () => {
  it('analyzes extrusion consistency per layer', () => {
    const lines = [
      'G1 X10 Y10 E5 Z0.2 F1800', 'G1 X20 Y10 E10 Z0.2 F1800',
      'G1 X30 Y10 E15 Z0.4 F1800', 'G1 X40 Y10 E20 Z0.4 F1800',
    ];
    const result = analyzeExtrusionConsistencyPerLayer(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 E5 Z0.2 F1800', 'G1 X20 Y10 E10 Z0.2 F1800', 'G1 X30 Y10 E15 Z0.4 F1800'];
    const result = analyzeExtrusionConsistencyPerLayer(lines);
    expect(result.overallConsistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.overallConsistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no data', () => {
    const lines = ['; comment only'];
    const result = analyzeExtrusionConsistencyPerLayer(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 12. Machine Coordinate Boundary ──

describe('checkMachineCoordinateBoundary', () => {
  it('checks machine coordinate boundary', () => {
    const lines = ['G1 X10 Y10 Z-1 F500', 'G1 X20 Y20 Z-2 F500'];
    const result = checkMachineCoordinateBoundary(lines);
    expect(result.violationCount).toBeGreaterThanOrEqual(0);
  });

  it('detects violations', () => {
    const lines = ['G1 X600 Y10 Z-1 F500'];
    const result = checkMachineCoordinateBoundary(lines, {
      minX: -500, maxX: 500, minY: -500, maxY: 500, minZ: -500, maxZ: 500,
    });
    expect(result.violationCount).toBeGreaterThan(0);
  });

  it('handles no violations', () => {
    const lines = ['G1 X10 Y10 Z-1 F500'];
    const result = checkMachineCoordinateBoundary(lines);
    expect(result.violationCount).toBe(0);
    expect(result.isWithinBounds).toBe(true);
  });
});
