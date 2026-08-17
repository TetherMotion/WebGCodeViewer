/**
 * @file GcodeAdvanced10.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced10 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeZHops,
  analyzeExtrusionConsistency,
  normalizeGcode,
  analyzeToolpathSmoothing,
  predictPrintQuality,
  analyzeVolumetricFlowRate,
  generateStatisticsSummary,
  matchMachineCapability,
  detectToolpathOverlaps,
  compareBatchGcode,
  analyzePrintEfficiency,
  autoGenerateAnnotations,
} from "@tether/gcode-analyzer/GcodeAdvanced10";
import type { MachineCapability } from "@tether/gcode-analyzer/GcodeAdvanced10";

// ── 1. Z-Hop Analysis ──

describe('analyzeZHops', () => {
  it('detects Z-hop moves', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G0 Z0.3',           // Z-hop up
      'G0 X20 Y20',        // travel
      'G0 Z0',             // Z-hop down
      'G1 X30 Y30 E10 F1800',
    ];
    const result = analyzeZHops(lines);
    expect(result.hasZHop).toBe(true);
    expect(result.count).toBeGreaterThan(0);
  });

  it('detects no Z-hop when none present', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y20 E10 F1800',
    ];
    const result = analyzeZHops(lines);
    expect(result.hasZHop).toBe(false);
    expect(result.count).toBe(0);
  });

  it('computes hop percentage', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G0 Z0.3',
      'G0 X20 Y20',
      'G0 Z0',
      'G1 X30 Y30 E10 F1800',
    ];
    const result = analyzeZHops(lines);
    expect(result.hopPercentage).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = analyzeZHops([]);
    expect(result.count).toBe(0);
    expect(result.hasZHop).toBe(false);
  });
});

// ── 2. Extrusion Consistency Analysis ──

describe('analyzeExtrusionConsistency', () => {
  it('analyzes extrusion consistency', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y20 E10 F1800',
      ';LAYER:1',
      'G1 X10 Y10 E15 F1800',
      'G1 X20 Y20 E20 F1800',
    ];
    const result = analyzeExtrusionConsistency(lines);
    expect(result.layerExtrusion.length).toBe(2);
    expect(result.avgExtrusionPerLayer).toBeGreaterThan(0);
  });

  it('detects consistent extrusion', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y0 E5 F1800',
      ';LAYER:1',
      'G1 X10 Y0 E10 F1800',
      ';LAYER:2',
      'G1 X10 Y0 E15 F1800',
    ];
    const result = analyzeExtrusionConsistency(lines);
    expect(result.isConsistent).toBe(true);
    expect(result.coefficientOfVariation).toBeLessThan(10);
  });

  it('detects inconsistent extrusion', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y0 E5 F1800',
      ';LAYER:1',
      'G1 X100 Y0 E50 F1800',
    ];
    const result = analyzeExtrusionConsistency(lines, 10);
    expect(result.inconsistentLayers.length).toBeGreaterThan(0);
  });

  it('handles no layers', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeExtrusionConsistency(lines);
    expect(result.layerExtrusion).toEqual([]);
  });
});

// ── 3. G-code Normalization ──

describe('normalizeGcode', () => {
  it('uppercases G/M codes', () => {
    const lines = ['g1 x10 y10 f500'];
    const result = normalizeGcode(lines);
    expect(result.normalizedLines[0]).toMatch(/G1/);
  });

  it('removes leading zeros', () => {
    const lines = ['G01 X10 Y10 M06 T01'];
    const result = normalizeGcode(lines);
    expect(result.normalizedLines[0]).toMatch(/G1/);
    expect(result.normalizedLines[0]).toMatch(/M6/);
  });

  it('removes empty lines', () => {
    const lines = ['G1 X10 Y10', '', '   ', 'G1 X20 Y20'];
    const result = normalizeGcode(lines);
    expect(result.normalizedLines.length).toBe(2);
  });

  it('preserves comments', () => {
    const lines = ['; this is a comment', 'G1 X10 Y10 ; inline'];
    const result = normalizeGcode(lines);
    expect(result.normalizedLines[0]).toContain('this is a comment');
  });

  it('sorts parameters', () => {
    const lines = ['G1 F500 E5 Y10 X10'];
    const result = normalizeGcode(lines);
    const line = result.normalizedLines[0];
    const xPos = line.indexOf('X');
    const yPos = line.indexOf('Y');
    const ePos = line.indexOf('E');
    const fPos = line.indexOf('F');
    expect(xPos).toBeLessThan(yPos);
    expect(yPos).toBeLessThan(ePos);
    expect(ePos).toBeLessThan(fPos);
  });

  it('detects already normalized G-code', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = normalizeGcode(lines);
    expect(result.wasAlreadyNormalized).toBe(true);
  });
});

// ── 4. Toolpath Smoothing ──

describe('analyzeToolpathSmoothing', () => {
  it('detects no jagged regions in straight line', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(`G1 X${i * 10} Y0 F500`);
    }
    const result = analyzeToolpathSmoothing(lines);
    expect(result.jaggedRegionCount).toBe(0);
    expect(result.smoothnessScore).toBe(100);
  });

  it('detects jagged regions', () => {
    const lines = [
      'G1 X10 Y0 F500',
      'G1 X10 Y10 F500',   // 90° turn
      'G1 X20 Y10 F500',   // 90° turn
      'G1 X20 Y20 F500',   // 90° turn
      'G1 X30 Y20 F500',   // 90° turn
    ];
    const result = analyzeToolpathSmoothing(lines, 30, 3);
    expect(result.jaggedRegionCount).toBeGreaterThan(0);
  });

  it('computes smoothness score', () => {
    const lines = ['G1 X100 Y0 F500'];
    const result = analyzeToolpathSmoothing(lines);
    expect(result.smoothnessScore).toBeGreaterThanOrEqual(0);
    expect(result.smoothnessScore).toBeLessThanOrEqual(100);
  });

  it('handles empty input', () => {
    const result = analyzeToolpathSmoothing([]);
    expect(result.jaggedRegionCount).toBe(0);
  });
});

// ── 5. Print Quality Prediction ──

describe('predictPrintQuality', () => {
  it('predicts quality issues', () => {
    const lines = [
      'M104 S200',
      'M140 S60',
      'M106 S128',
      'G1 X10 Y10 E5 F1800',
      'G1 X5 Y5 E4.8 F1800',  // retraction
    ];
    const result = predictPrintQuality(lines);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
  });

  it('penalizes missing retraction', () => {
    const lines = [
      'M104 S200',
      'M140 S60',
      'M106 S128',
      'G1 X10 Y10 E5 F1800',
      'G1 X20 Y20 E10 F1800',  // no retraction
    ];
    const result = predictPrintQuality(lines);
    expect(result.issues.some(i => i.type === 'no_retraction')).toBe(true);
  });

  it('penalizes missing temperature', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = predictPrintQuality(lines);
    expect(result.issues.some(i => i.type === 'no_temp_set')).toBe(true);
  });

  it('assigns quality grade', () => {
    const lines = [
      'M104 S200', 'M140 S60', 'M106 S128',
      'G1 X10 Y10 E5 F1800', 'G1 X5 Y5 E4.8 F1800',
    ];
    const result = predictPrintQuality(lines);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
  });
});

// ── 6. Volumetric Flow Rate Analysis ──

describe('analyzeVolumetricFlowRate', () => {
  it('computes flow rates', () => {
    const lines = [
      'G1 X10 Y0 E5 F1800',
    ];
    const result = analyzeVolumetricFlowRate(lines);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.avgFlowRate).toBeGreaterThan(0);
  });

  it('detects exceeding flow rates', () => {
    const lines = [
      'G1 X100 Y0 E50 F60000',  // very high feed rate
    ];
    const result = analyzeVolumetricFlowRate(lines, 11, 0.4, 0.2);
    expect(result.exceedingSegments).toBeGreaterThan(0);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y0'];
    const result = analyzeVolumetricFlowRate(lines);
    expect(result.segments).toEqual([]);
  });

  it('computes max flow rate', () => {
    const lines = ['G1 X10 Y0 E5 F1800', 'G1 X20 Y0 E10 F3600'];
    const result = analyzeVolumetricFlowRate(lines);
    expect(result.maxFlowRate).toBeGreaterThan(result.avgFlowRate);
  });
});

// ── 7. Statistics Summary ──

describe('generateStatisticsSummary', () => {
  it('counts lines correctly', () => {
    const lines = ['G1 X10 Y10 F500', '; comment', '', 'M3 S1000'];
    const result = generateStatisticsSummary(lines);
    expect(result.totalLines).toBe(4);
    expect(result.codeLines).toBe(2);
    expect(result.commentLines).toBe(1);
    expect(result.emptyLines).toBe(1);
  });

  it('counts command types', () => {
    const lines = ['G0 X10 Y0', 'G1 X20 Y20 F500', 'G2 X30 Y10 I5 J0', 'M3 S1000', 'M8', 'G4 P100', 'M6 T1'];
    const result = generateStatisticsSummary(lines);
    expect(result.rapidCommands).toBe(1);
    expect(result.motionCommands).toBe(1);
    expect(result.arcCommands).toBe(1);
    expect(result.spindleCommands).toBe(1);
    expect(result.coolantCommands).toBe(1);
    expect(result.dwellCommands).toBe(1);
    expect(result.toolChanges).toBe(1);
  });

  it('counts unique tools', () => {
    const lines = ['T1 M6', 'G1 X10 Y10', 'T2 M6', 'G1 X20 Y20', 'T1 M6'];
    const result = generateStatisticsSummary(lines);
    expect(result.uniqueTools).toBe(2);
  });

  it('computes complexity score', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`G1 X${i} Y${i} F1800`);
    }
    const result = generateStatisticsSummary(lines);
    expect(result.complexityScore).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = generateStatisticsSummary([]);
    expect(result.totalLines).toBe(0);
  });
});

// ── 8. Machine Capability Match ──

describe('matchMachineCapability', () => {
  const machine: MachineCapability = {
    name: 'TestMachine',
    workEnvelope: { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 200 },
    maxFeedRate: 5000,
    maxSpindleRpm: 10000,
    maxTools: 10,
    features: ['spindle_control', 'coolant', 'dwell'],
    controller: 'fanuc',
  };

  it('passes compatible G-code', () => {
    const lines = ['M3 S5000', 'G1 X100 Y100 Z50 F3000'];
    const result = matchMachineCapability(lines, machine);
    expect(result.isCompatible).toBe(true);
    expect(result.compatibilityScore).toBe(100);
  });

  it('detects X travel exceeding limit', () => {
    const lines = ['G1 X250 Y100 F3000'];
    const result = matchMachineCapability(lines, machine);
    expect(result.isCompatible).toBe(false);
    expect(result.issues.some(i => i.type === 'x_travel')).toBe(true);
  });

  it('detects feed rate exceeding limit', () => {
    const lines = ['G1 X100 Y100 F6000'];
    const result = matchMachineCapability(lines, machine);
    expect(result.isCompatible).toBe(false);
    expect(result.issues.some(i => i.type === 'feed_rate')).toBe(true);
  });

  it('detects unsupported features', () => {
    const lines = ['G2 X10 Y10 I5 J0 F500']; // arc not in features
    const result = matchMachineCapability(lines, machine);
    expect(result.issues.some(i => i.type === 'feature')).toBe(true);
  });

  it('handles empty input', () => {
    const result = matchMachineCapability([], machine);
    expect(result.isCompatible).toBe(true);
  });
});

// ── 9. Toolpath Overlap Detection ──

describe('detectToolpathOverlaps', () => {
  it('detects no overlaps for separated paths', () => {
    const lines = [
      'G1 X10 Y0 E5 F1800',
      'G1 X10 Y10 E10 F1800',
      'G1 X50 Y0 E15 F1800',  // far away
      'G1 X50 Y10 E20 F1800',
    ];
    const result = detectToolpathOverlaps(lines);
    expect(result.count).toBe(0);
  });

  it('detects close parallel paths', () => {
    const lines = [
      'G1 X100 Y0 E5 F1800',     // segment (0,0)→(100,0)
      'G1 X100 Y0.1 E10 F1800',  // segment (100,0)→(100,0.1) — perpendicular, not parallel
      'G1 X0 Y0.1 E15 F1800',    // segment (100,0.1)→(0,0.1) — parallel to first, very close
    ];
    const result = detectToolpathOverlaps(lines, 0.48, 20);
    expect(result.count).toBeGreaterThan(0);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y0'];
    const result = detectToolpathOverlaps(lines);
    expect(result.count).toBe(0);
  });

  it('computes total overlap area', () => {
    const lines = [
      'G1 X100 Y0 E5 F1800',
      'G1 X100 Y0.1 E10 F1800',
    ];
    const result = detectToolpathOverlaps(lines, 0.48, 20);
    if (result.count > 0) {
      expect(result.totalOverlapArea).toBeGreaterThan(0);
    }
  });
});

// ── 10. Batch Comparison ──

describe('compareBatchGcode', () => {
  it('compares multiple files', () => {
    const files = [
      { name: 'file1.gcode', lines: ['G1 X100 Y0 F1800', 'G1 X200 Y0 F1800'] },
      { name: 'file2.gcode', lines: ['G1 X100 Y0 F3600', 'G1 X200 Y0 F3600'] },
    ];
    const result = compareBatchGcode(files);
    expect(result.files.length).toBe(2);
  });

  it('finds fastest file', () => {
    const files = [
      { name: 'slow.gcode', lines: ['G1 X1000 Y0 F600'] },
      { name: 'fast.gcode', lines: ['G1 X1000 Y0 F6000'] },
    ];
    const result = compareBatchGcode(files);
    expect(result.fastestFile).toBe('fast.gcode');
  });

  it('handles single file', () => {
    const files = [{ name: 'only.gcode', lines: ['G1 X100 Y0 F1800'] }];
    const result = compareBatchGcode(files);
    expect(result.files.length).toBe(1);
  });

  it('handles empty input', () => {
    const result = compareBatchGcode([]);
    expect(result.files).toEqual([]);
  });
});

// ── 11. Print Efficiency ──

describe('analyzePrintEfficiency', () => {
  it('analyzes print efficiency', () => {
    const lines = ['G1 X100 Y0 E50 F1800'];
    const result = analyzePrintEfficiency(lines);
    expect(result.printTime).toBeGreaterThan(0);
    expect(result.materialUsed).toBeGreaterThan(0);
    expect(result.materialVolume).toBeGreaterThan(0);
  });

  it('computes efficiency scores', () => {
    const lines = ['G1 X100 Y0 E50 F1800'];
    const result = analyzePrintEfficiency(lines);
    expect(result.timeEfficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.materialEfficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('assigns efficiency grade', () => {
    const lines = ['G1 X100 Y0 E50 F1800'];
    const result = analyzePrintEfficiency(lines);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X100 Y0'];
    const result = analyzePrintEfficiency(lines);
    expect(result.materialUsed).toBe(0);
  });
});

// ── 12. Auto-Generate Annotations ──

describe('autoGenerateAnnotations', () => {
  it('generates tool change annotations', () => {
    const lines = ['T1 M6', 'G1 X10 Y10 F500'];
    const result = autoGenerateAnnotations(lines);
    const toolAnno = result.annotations.find(a => a.source === 'tool_change');
    expect(toolAnno).toBeDefined();
  });

  it('generates spindle annotations', () => {
    const lines = ['M3 S1000'];
    const result = autoGenerateAnnotations(lines);
    const spindleAnno = result.annotations.find(a => a.source === 'spindle');
    expect(spindleAnno).toBeDefined();
  });

  it('generates dwell annotations', () => {
    const lines = ['G4 P500'];
    const result = autoGenerateAnnotations(lines);
    const dwellAnno = result.annotations.find(a => a.source === 'dwell');
    expect(dwellAnno).toBeDefined();
  });

  it('generates high feed rate warnings', () => {
    const lines = ['G1 X10 Y10 F6000'];
    const result = autoGenerateAnnotations(lines);
    const warning = result.annotations.find(a => a.category === 'warning');
    expect(warning).toBeDefined();
  });

  it('generates layer annotations', () => {
    const lines = [';LAYER:0', 'G1 X10 Y10 F500'];
    const result = autoGenerateAnnotations(lines);
    const layerAnno = result.annotations.find(a => a.source === 'layer');
    expect(layerAnno).toBeDefined();
  });

  it('counts by category', () => {
    const lines = ['T1 M6', 'M3 S1000', 'G1 X10 Y10 F6000'];
    const result = autoGenerateAnnotations(lines);
    expect(result.byCategory.info + result.byCategory.warning).toBe(result.count);
  });

  it('handles empty input', () => {
    const result = autoGenerateAnnotations([]);
    expect(result.count).toBe(0);
  });
});
