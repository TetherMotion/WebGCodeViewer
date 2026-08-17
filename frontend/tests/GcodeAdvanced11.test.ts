/**
 * @file GcodeAdvanced11.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced11 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  simulateGcode,
  trackToolWearProgression,
  generateOptimizationReport,
  analyzeBedThermalMap,
  buildSubprogramCallGraph,
  processGcodeTemplate,
  analyzeCoolingEffectiveness,
  analyzeDependencies,
  predictPrintFailure,
  generateDocumentation,
  benchmarkGcode,
  auditGcodeSecurity,
} from "@tether/gcode-analyzer/GcodeAdvanced11";

// ── 1. Simulation Engine ──

describe('simulateGcode', () => {
  it('simulates basic motion', () => {
    const lines = ['G1 X10 Y10 F1800', 'G1 X20 Y20 F1800'];
    const result = simulateGcode(lines);
    expect(result.stepCount).toBe(2);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it('tracks position', () => {
    const lines = ['G1 X10 Y0 F1800', 'G1 X10 Y10 F1800'];
    const result = simulateGcode(lines);
    expect(result.finalState.position.x).toBe(10);
    expect(result.finalState.position.y).toBe(10);
  });

  it('tracks spindle state', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500', 'M5'];
    const result = simulateGcode(lines);
    expect(result.finalState.spindleOn).toBe(false);
    expect(result.finalState.spindleRpm).toBe(1000);
  });

  it('tracks tool changes', () => {
    const lines = ['T1 M6', 'G1 X10 Y10 F500'];
    const result = simulateGcode(lines);
    expect(result.finalState.tool).toBe(1);
  });

  it('computes cutting vs travel distance', () => {
    const lines = ['G0 X10 Y0', 'G1 X20 Y0 E5 F1800'];
    const result = simulateGcode(lines);
    expect(result.travelDistance).toBeGreaterThan(0);
    expect(result.cuttingDistance).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = simulateGcode([]);
    expect(result.stepCount).toBe(0);
  });
});

// ── 2. Tool Wear Progression ──

describe('trackToolWearProgression', () => {
  it('tracks tool wear', () => {
    const lines = [
      'T1 M6',
      'G1 X10 Y0 Z-1 F500',
      'G1 X100 Y0 Z-1 F500',
    ];
    const result = trackToolWearProgression(lines);
    expect(result.perTool.length).toBe(1);
    expect(result.perTool[0].tool).toBe(1);
  });

  it('tracks multiple tools', () => {
    const lines = [
      'T1 M6', 'G1 X10 Y0 Z-1 F500',
      'T2 M6', 'G1 X20 Y0 Z-1 F500',
    ];
    const result = trackToolWearProgression(lines);
    expect(result.perTool.length).toBe(2);
  });

  it('computes wear percentage', () => {
    const lines = [
      'T1 M6',
      'G1 X100 Y0 Z-1 F500',
    ];
    const result = trackToolWearProgression(lines, 1000);
    expect(result.perTool[0].finalWearPercentage).toBeGreaterThan(0);
  });

  it('identifies tools needing replacement', () => {
    const lines = [
      'T1 M6',
      'G1 X10000 Y0 Z-1 F500',
    ];
    const result = trackToolWearProgression(lines, 1000);
    expect(result.toolsNeedingReplacement).toContain(1);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = trackToolWearProgression(lines);
    expect(result.perTool).toEqual([]);
  });
});

// ── 3. Optimization Report ──

describe('generateOptimizationReport', () => {
  it('generates suggestions', () => {
    const lines = [
      'G0 X5000 Y0',
      'G1 X4990 Y0 E5 F1800',
      'G0 X0 Y5000',
      'G1 X0 Y4990 E10 F1800',
      'G4 P100',
      'T1 M6',
    ];
    const result = generateOptimizationReport(lines);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('detects travel optimization opportunity', () => {
    const lines = ['G0 X1000 Y0', 'G1 X10 Y0 E5 F1800'];
    const result = generateOptimizationReport(lines);
    expect(result.suggestions.some(s => s.category === 'time')).toBe(true);
  });

  it('detects dwell optimization', () => {
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) lines.push('G4 P100');
    const result = generateOptimizationReport(lines);
    expect(result.suggestions.some(s => s.suggestion.includes('dwell'))).toBe(true);
  });

  it('computes optimization score', () => {
    const lines = ['G1 X10 Y0 E5 F1800'];
    const result = generateOptimizationReport(lines);
    expect(result.optimizationScore).toBeGreaterThanOrEqual(0);
    expect(result.optimizationScore).toBeLessThanOrEqual(100);
  });

  it('handles empty input', () => {
    const result = generateOptimizationReport([]);
    expect(result.suggestions).toEqual([]);
  });
});

// ── 4. Bed Thermal Map ──

describe('analyzeBedThermalMap', () => {
  it('detects bed heating commands', () => {
    const lines = ['M140 S60', 'M190 S60', 'G1 X10 Y10 E5 F1800'];
    const result = analyzeBedThermalMap(lines);
    expect(result.hasBedHeating).toBe(true);
    expect(result.events.length).toBe(2);
  });

  it('computes temperature statistics', () => {
    const lines = ['M140 S60', 'M140 S70', 'M140 S65'];
    const result = analyzeBedThermalMap(lines);
    expect(result.maxTemp).toBe(70);
    expect(result.minTemp).toBe(60);
    expect(result.avgTemp).toBeCloseTo(65, 0);
  });

  it('detects no bed heating', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeBedThermalMap(lines);
    expect(result.hasBedHeating).toBe(false);
  });

  it('computes temperature stability', () => {
    const lines = ['M140 S60', 'M140 S60', 'M140 S60'];
    const result = analyzeBedThermalMap(lines);
    expect(result.temperatureStability).toBeCloseTo(0, 0);
  });
});

// ── 5. Subprogram Call Graph ──

describe('buildSubprogramCallGraph', () => {
  it('finds subprogram definitions', () => {
    const lines = ['O1001', 'G1 X10 Y10 F500', 'M99'];
    const result = buildSubprogramCallGraph(lines);
    expect(result.subprogramCount).toBeGreaterThan(0);
  });

  it('finds subprogram calls', () => {
    const lines = ['M98 P1001', 'O1001', 'G1 X10 Y10 F500', 'M99'];
    const result = buildSubprogramCallGraph(lines);
    expect(result.totalCalls).toBeGreaterThan(0);
  });

  it('detects no subprograms', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = buildSubprogramCallGraph(lines);
    expect(result.subprogramCount).toBe(0);
  });

  it('builds hierarchy', () => {
    const lines = ['M98 P1001', 'O1001', 'M98 P1002', 'M99', 'O1002', 'G1 X10 Y10', 'M99'];
    const result = buildSubprogramCallGraph(lines);
    expect(result.hierarchy.length).toBeGreaterThan(0);
  });
});

// ── 6. G-code Templating ──

describe('processGcodeTemplate', () => {
  it('substitutes double-brace variables', () => {
    const template = ['G1 X{{x}} Y{{y}} F{{feed}}'];
    const result = processGcodeTemplate(template, { x: 10, y: 20, feed: 1800 });
    expect(result.processedLines[0]).toContain('X10');
    expect(result.processedLines[0]).toContain('Y20');
    expect(result.processedLines[0]).toContain('F1800');
  });

  it('finds template variables', () => {
    const template = ['G1 X{{x}} Y{{y}} F{{feed}}'];
    const result = processGcodeTemplate(template);
    expect(result.variables.length).toBe(3);
  });

  it('detects missing required variables', () => {
    const template = ['G1 X{{x}} Y{{y}} F{{feed}}'];
    const result = processGcodeTemplate(template, { x: 10 });
    expect(result.allRequiredProvided).toBe(false);
    expect(result.missingVariables).toContain('y');
  });

  it('uses default values', () => {
    const template = ['; @var feed=1800 Default feed rate', 'G1 X10 Y10 F{{feed}}'];
    const result = processGcodeTemplate(template, {});
    // The @var comment line is skipped, so processedLines[0] is the G1 line
    expect(result.processedLines[0]).toContain('F1800');
  });

  it('counts substitutions', () => {
    const template = ['G1 X{{x}} Y{{y}} F{{feed}}'];
    const result = processGcodeTemplate(template, { x: 10, y: 20, feed: 1800 });
    expect(result.substitutionCount).toBe(3);
  });
});

// ── 7. Cooling Analysis ──

describe('analyzeCoolingEffectiveness', () => {
  it('analyzes fan control', () => {
    const lines = ['M106 S128', 'G1 X10 Y10 Z0.2 E5 F1800'];
    const result = analyzeCoolingEffectiveness(lines);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.maxFanSpeed).toBe(128);
  });

  it('detects inadequate cooling', () => {
    const lines = ['M106 S10', 'G1 X10 Y10 Z0.2 E5 F1800'];
    const result = analyzeCoolingEffectiveness(lines, 50);
    expect(result.inadequateCoolingCount).toBeGreaterThan(0);
  });

  it('detects no fan control', () => {
    const lines = ['G1 X10 Y10 Z0.2 E5 F1800'];
    const result = analyzeCoolingEffectiveness(lines);
    expect(result.avgFanSpeed).toBe(0);
  });

  it('computes cooling score', () => {
    const lines = ['M106 S255', 'G1 X10 Y10 Z0.2 E5 F1800'];
    const result = analyzeCoolingEffectiveness(lines, 50);
    expect(result.coolingScore).toBeGreaterThanOrEqual(0);
    expect(result.coolingScore).toBeLessThanOrEqual(100);
  });
});

// ── 8. Dependency Analysis ──

describe('analyzeDependencies', () => {
  it('finds operations', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M5', 'M30'];
    const result = analyzeDependencies(lines);
    expect(result.operationCount).toBeGreaterThan(0);
  });

  it('identifies reorderable operations', () => {
    const lines = ['G28', 'M3 S1000', 'G4 P100', 'G1 X10 Y10 F500'];
    const result = analyzeDependencies(lines);
    expect(result.reorderableCount).toBeGreaterThan(0);
  });

  it('detects missing homing', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500'];
    const result = analyzeDependencies(lines);
    expect(result.recommendations.some(r => r.includes('homing'))).toBe(true);
  });

  it('builds critical path', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = analyzeDependencies(lines);
    expect(result.criticalPath.length).toBeGreaterThan(0);
  });
});

// ── 9. Print Failure Prediction ──

describe('predictPrintFailure', () => {
  it('predicts failure probability', () => {
    const lines = ['M104 S200', 'M140 S60', 'M106 S128', 'G28', 'G1 X10 Y10 E5 F1800', 'G1 X5 Y5 E4.8 F1800'];
    const result = predictPrintFailure(lines);
    expect(result.failureProbability).toBeGreaterThanOrEqual(0);
    expect(result.failureProbability).toBeLessThanOrEqual(100);
  });

  it('detects missing hotend heat as high risk', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = predictPrintFailure(lines);
    expect(result.risks.some(r => r.type === 'no_hotend_heat')).toBe(true);
  });

  it('detects missing homing', () => {
    const lines = ['M104 S200', 'G1 X10 Y10 E5 F1800'];
    const result = predictPrintFailure(lines);
    expect(result.risks.some(r => r.type === 'no_homing')).toBe(true);
  });

  it('determines if likely to succeed', () => {
    const lines = ['M104 S200', 'M140 S60', 'M106 S128', 'G28', 'G1 X10 Y10 E5 F1800', 'G1 X5 Y5 E4.8 F1800'];
    const result = predictPrintFailure(lines);
    expect(typeof result.likelyToSucceed).toBe('boolean');
  });
});

// ── 10. Documentation Generator ──

describe('generateDocumentation', () => {
  it('generates overview section', () => {
    const lines = ['G1 X10 Y10 F500', '; comment'];
    const result = generateDocumentation(lines);
    expect(result.sections.some(s => s.title === 'Overview')).toBe(true);
  });

  it('documents tools', () => {
    const lines = ['T1 M6', 'G1 X10 Y10 F500'];
    const result = generateDocumentation(lines);
    expect(result.sections.some(s => s.title === 'Tools Used')).toBe(true);
  });

  it('generates markdown', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = generateDocumentation(lines);
    expect(result.markdown).toContain('##');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('documents operation sequence', () => {
    const lines = ['G28', 'T1 M6', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = generateDocumentation(lines);
    expect(result.sections.some(s => s.title === 'Operation Sequence')).toBe(true);
  });
});

// ── 11. Performance Benchmark ──

describe('benchmarkGcode', () => {
  it('benchmarks parsing', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = benchmarkGcode(lines);
    expect(result.totalLines).toBe(2);
    expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('computes lines per second', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`G1 X${i} Y${i} F500`);
    const result = benchmarkGcode(lines);
    expect(result.linesPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('assigns complexity rating', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = benchmarkGcode(lines);
    expect(['simple', 'moderate', 'complex', 'very_complex']).toContain(result.complexityRating);
  });

  it('computes performance score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = benchmarkGcode(lines);
    expect(result.performanceScore).toBeGreaterThanOrEqual(0);
    expect(result.performanceScore).toBeLessThanOrEqual(100);
  });
});

// ── 12. Security Audit ──

describe('auditGcodeSecurity', () => {
  it('detects missing homing', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = auditGcodeSecurity(lines);
    expect(result.issues.some(i => i.type === 'no_safety_boundary')).toBe(true);
  });

  it('detects missing program end', () => {
    const lines = ['G28', 'G1 X10 Y10 F500'];
    const result = auditGcodeSecurity(lines);
    expect(result.issues.some(i => i.type === 'missing_stop')).toBe(true);
  });

  it('passes safe G-code', () => {
    const lines = ['G28', 'M3 S1000', 'G1 X10 Y10 F500', 'M5', 'M30'];
    const result = auditGcodeSecurity(lines);
    expect(result.securityScore).toBeGreaterThan(50);
  });

  it('computes security score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = auditGcodeSecurity(lines);
    expect(result.securityScore).toBeGreaterThanOrEqual(0);
    expect(result.securityScore).toBeLessThanOrEqual(100);
  });

  it('counts issues by severity', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = auditGcodeSecurity(lines);
    expect(result.bySeverity.low + result.bySeverity.medium + result.bySeverity.high + result.bySeverity.critical).toBe(result.issueCount);
  });

  it('detects high RPM without warmup', () => {
    const lines = ['G28', 'M3 S10000', 'G1 X10 Y10 F500', 'M30'];
    const result = auditGcodeSecurity(lines, 10, 5000);
    expect(result.issues.some(i => i.type === 'high_rpm')).toBe(true);
  });
});
