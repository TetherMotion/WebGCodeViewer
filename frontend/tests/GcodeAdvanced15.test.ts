/**
 * @file GcodeAdvanced15.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced15 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  profileGcodeExecution,
  generateToolWearMap,
  analyzeLayerAdhesion,
  semanticSearchGcode,
  analyzeChatterFrequency,
  generateOverhangMap,
  generateOperationTimeline,
  checkToolpathContinuity,
  analyzeExtrusionWidthConsistency,
  optimizePostProcessorOutput,
  analyzeMachineVibration,
  trackThermalHistory,
} from "@tether/gcode-analyzer/GcodeAdvanced15";

// ── 1. Execution Profiler ──

describe('profileGcodeExecution', () => {
  it('profiles execution time', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = profileGcodeExecution(lines);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.totalTime).toBeGreaterThan(0);
  });

  it('categorizes operations', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'M6 T2', 'G4 P1000'];
    const result = profileGcodeExecution(lines);
    expect(result.timeByCategory.spindle).toBeGreaterThan(0);
    expect(result.timeByCategory.tool).toBeGreaterThan(0);
    expect(result.timeByCategory.dwell).toBeGreaterThan(0);
  });

  it('identifies hotspots', () => {
    const lines = ['M6 T1', 'G1 X10 Y0 F500'];
    const result = profileGcodeExecution(lines);
    expect(result.hotspots.length).toBeGreaterThan(0);
  });

  it('computes performance rating', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = profileGcodeExecution(lines);
    expect(['excellent', 'good', 'fair', 'poor']).toContain(result.performanceRating);
  });
});

// ── 2. Tool Wear Map ──

describe('generateToolWearMap', () => {
  it('generates wear map', () => {
    const lines = ['T1 M6', 'M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = generateToolWearMap(lines, 5);
    expect(result.cells.length).toBe(25);
  });

  it('computes max wear', () => {
    const lines = ['T1 M6', 'M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = generateToolWearMap(lines, 5);
    expect(result.maxWear).toBeGreaterThanOrEqual(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = generateToolWearMap(lines);
    expect(result.cells).toEqual([]);
  });
});

// ── 3. Layer Adhesion Analyzer ──

describe('analyzeLayerAdhesion', () => {
  it('analyzes layer adhesion', () => {
    const lines = [
      'M140 S60', 'M104 S200', 'M106 S128',
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y20 E10 F1800 Z0.4',
      'G1 X30 Y30 E15 F1800 Z0.6',
    ];
    const result = analyzeLayerAdhesion(lines);
    expect(result.layers.length).toBeGreaterThan(0);
  });

  it('computes adhesion score', () => {
    const lines = ['M140 S60', 'M104 S200', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = analyzeLayerAdhesion(lines);
    expect(result.adhesionScore).toBeGreaterThanOrEqual(0);
    expect(result.adhesionScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeLayerAdhesion(lines);
    expect(result.layers).toEqual([]);
  });
});

// ── 4. Semantic Search ──

describe('semanticSearchGcode', () => {
  it('finds homing operations', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = semanticSearchGcode(lines, 'homing');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].matchedConcept).toBe('homing');
  });

  it('finds tool changes', () => {
    const lines = ['G28', 'T1 M6', 'M3 S1000', 'G1 X10 Y10 F500'];
    const result = semanticSearchGcode(lines, 'tool change');
    expect(result.matches.some(m => m.matchedConcept === 'tool_change')).toBe(true);
  });

  it('handles no matches', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = semanticSearchGcode(lines, 'nonexistent');
    expect(result.matchCount).toBe(0);
  });
});

// ── 5. Chatter Frequency Analysis ──

describe('analyzeChatterFrequency', () => {
  it('analyzes chatter frequencies', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = analyzeChatterFrequency(lines);
    expect(result.spectrum.length).toBeGreaterThan(0);
  });

  it('computes spindle and tooth pass frequencies', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeChatterFrequency(lines);
    expect(result.spindleFrequency).toBeGreaterThan(0);
    expect(result.toothPassFrequency).toBeGreaterThan(0);
  });

  it('computes chatter likelihood', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeChatterFrequency(lines);
    expect(result.chatterLikelihood).toBeGreaterThanOrEqual(0);
    expect(result.chatterLikelihood).toBeLessThanOrEqual(100);
  });
});

// ── 6. Overhang Angle Map ──

describe('generateOverhangMap', () => {
  it('generates overhang map', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X15 Y20 E15 F1800 Z0.4',
    ];
    const result = generateOverhangMap(lines, 5);
    expect(result.cells.length).toBe(25);
  });

  it('computes max overhang angle', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800 Z0.2',
      'G1 X20 Y10 E10 F1800 Z0.2',
      'G1 X15 Y20 E15 F1800 Z0.4',
    ];
    const result = generateOverhangMap(lines, 5);
    expect(result.maxOverhangAngle).toBeGreaterThanOrEqual(0);
  });

  it('handles insufficient data', () => {
    const lines = ['G0 X10 Y10'];
    const result = generateOverhangMap(lines);
    expect(result.cells).toEqual([]);
  });
});

// ── 7. Operation Timeline ──

describe('generateOperationTimeline', () => {
  it('generates timeline events', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500', 'M6 T2', 'G1 X20 Y20 F500', 'M30'];
    const result = generateOperationTimeline(lines);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('categorizes events', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500', 'M6 T2'];
    const result = generateOperationTimeline(lines);
    expect(result.byCategory.spindle).toBeDefined();
    expect(result.byCategory.motion).toBeDefined();
    expect(result.byCategory.tool).toBeDefined();
  });

  it('computes utilization', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = generateOperationTimeline(lines);
    expect(result.utilizationPercentage).toBeGreaterThanOrEqual(0);
  });

  it('handles empty input', () => {
    const result = generateOperationTimeline([]);
    expect(result.events).toEqual([]);
  });
});

// ── 8. Toolpath Continuity Checker ──

describe('checkToolpathContinuity', () => {
  it('detects gaps', () => {
    const lines = ['G1 X10 Y10 F500', 'G0 X50 Y50', 'G1 X60 Y60 F500'];
    const result = checkToolpathContinuity(lines);
    expect(result.issues.some(i => i.type === 'gap')).toBe(true);
  });

  it('detects retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800'];
    const result = checkToolpathContinuity(lines);
    expect(result.issues.some(i => i.type === 'retract')).toBe(true);
  });

  it('passes continuous toolpath', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = checkToolpathContinuity(lines);
    expect(result.isContinuous).toBe(true);
  });

  it('computes continuity score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = checkToolpathContinuity(lines);
    expect(result.continuityScore).toBeGreaterThanOrEqual(0);
    expect(result.continuityScore).toBeLessThanOrEqual(100);
  });
});

// ── 9. Extrusion Width Consistency ──

describe('analyzeExtrusionWidthConsistency', () => {
  it('analyzes extrusion width', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeExtrusionWidthConsistency(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes consistency score', () => {
    const lines = ['G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y10 E10 F1800 Z0.2'];
    const result = analyzeExtrusionWidthConsistency(lines);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeExtrusionWidthConsistency(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 10. Post-processor Optimizer ──

describe('optimizePostProcessorOutput', () => {
  it('removes empty lines', () => {
    const lines = ['G1 X10 Y10 F500', '', 'G1 X20 Y20 F500'];
    const result = optimizePostProcessorOutput(lines);
    expect(result.optimizedLines.length).toBeLessThan(lines.length);
  });

  it('removes redundant feed rates', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = optimizePostProcessorOutput(lines);
    expect(result.optimizations.some(o => o.type === 'redundant_feed')).toBe(true);
  });

  it('computes reduction percentage', () => {
    const lines = ['G1 X10 Y10 F500', '', 'G1 X20 Y20 F500'];
    const result = optimizePostProcessorOutput(lines);
    expect(result.reductionPercentage).toBeGreaterThan(0);
  });

  it('handles already-optimized G-code', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F600'];
    const result = optimizePostProcessorOutput(lines);
    expect(result.optimizedLines.length).toBe(lines.length);
  });
});

// ── 11. Machine Vibration Analysis ──

describe('analyzeMachineVibration', () => {
  it('analyzes vibration', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = analyzeMachineVibration(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes max amplitude', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = analyzeMachineVibration(lines);
    expect(result.maxAmplitude).toBeGreaterThanOrEqual(0);
  });

  it('identifies vibration sources', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G0 X100 Y0'];
    const result = analyzeMachineVibration(lines);
    expect(Object.keys(result.sourceDistribution).length).toBeGreaterThan(0);
  });

  it('handles no motion', () => {
    const lines = ['M3 S5000'];
    const result = analyzeMachineVibration(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 12. Thermal History Tracker ──

describe('trackThermalHistory', () => {
  it('tracks thermal history', () => {
    const lines = ['M140 S60', 'M104 S200', 'M106 S128', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = trackThermalHistory(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes cooling rates', () => {
    const lines = ['M140 S60', 'M104 S200', 'G1 X10 Y10 E5 F1800 Z0.2'];
    const result = trackThermalHistory(lines);
    // Cooling rate can be negative if bed temp > layer temp estimate
    expect(typeof result.maxCoolingRate).toBe('number');
    expect(Number.isFinite(result.maxCoolingRate)).toBe(true);
  });

  it('computes uniformity score', () => {
    const lines = ['M140 S60', 'M104 S200', 'G1 X10 Y10 E5 F1800 Z0.2'];
    const result = trackThermalHistory(lines);
    expect(result.uniformityScore).toBeGreaterThanOrEqual(0);
    expect(result.uniformityScore).toBeLessThanOrEqual(100);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = trackThermalHistory(lines);
    expect(result.points).toEqual([]);
  });
});
