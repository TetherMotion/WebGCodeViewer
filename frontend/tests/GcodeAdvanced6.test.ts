/**
 * @file GcodeAdvanced6.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced6 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  estimateJobCostDetailed,
  detectMillingDirection,
  estimateAccelerationLimitedTime,
  estimateEnergyConsumption,
  analyzeWorkOffsets,
  getMaterialRecommendations,
  compareMaterialParameters,
  recognizePatterns,
  ratePrintDifficulty,
  estimateToolDeflection,
  compressGcode,
  compensateThermalExpansion,
  expandSubprograms,
} from '../src/core/GcodeAdvanced6';

// ── 1. Cost Estimation ──

describe('estimateJobCost', () => {
  it('estimates material cost from filament length', () => {
    const result = estimateJobCostDetailed(1000, 1.75, 120, {
      materialPricePerKg: 20,
      machineHourlyRate: 10,
      energyPricePerKwh: 0.15,
      averagePowerWatts: 200,
      density: 1.24,
    });
    expect(result.materialWeight).toBeGreaterThan(0);
    expect(result.materialCost).toBeGreaterThan(0);
    expect(result.machineTimeCost).toBeGreaterThan(0);
    expect(result.energyCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(result.materialCost + result.machineTimeCost + result.energyCost);
  });

  it('computes cost breakdown percentages', () => {
    const result = estimateJobCostDetailed(1000, 1.75, 60, {
      materialPricePerKg: 25,
      machineHourlyRate: 15,
      energyPricePerKwh: 0.20,
      averagePowerWatts: 300,
      density: 1.24,
    });
    expect(result.breakdown.material + result.breakdown.machine + result.breakdown.energy).toBeCloseTo(100, 0);
  });

  it('handles zero filament length', () => {
    const result = estimateJobCostDetailed(0, 1.75, 60, {
      materialPricePerKg: 20, machineHourlyRate: 10,
      energyPricePerKwh: 0.15, averagePowerWatts: 200, density: 1.24,
    });
    expect(result.materialCost).toBe(0);
    expect(result.machineTimeCost).toBeGreaterThan(0);
  });
});

// ── 2. Climb vs Conventional Milling ──

describe('detectMillingDirection', () => {
  it('detects milling direction segments', () => {
    const lines = [
      'M3 S1000',
      'G1 X10 Y0 F500',
      'G1 X10 Y10 F500',
      'G1 X0 Y10 F500',
      'G1 X0 Y0 F500',
    ];
    const result = detectMillingDirection(lines, 6);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.climbCount + result.conventionalCount).toBe(result.segments.length);
  });

  it('tracks spindle direction change', () => {
    const lines = [
      'M3 S1000',
      'G1 X10 Y0 F500',
      'M4 S1000',
      'G1 X20 Y0 F500',
    ];
    const result = detectMillingDirection(lines, 6);
    expect(result.segments[0].toolRotation).toBe(1);
    expect(result.segments[1].toolRotation).toBe(-1);
  });

  it('detects mixed directions', () => {
    const lines = [
      'M3 S1000',
      'G1 X10 Y10 F500',
      'G1 X-10 Y-10 F500',
    ];
    const result = detectMillingDirection(lines, 6);
    expect(result.isMixed).toBeDefined();
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = detectMillingDirection(lines, 6);
    expect(result.segments).toEqual([]);
  });
});

// ── 3. Acceleration-Limited Speed ──

describe('estimateAccelerationLimitedTime', () => {
  it('estimates time with acceleration limits', () => {
    const lines = [
      'G1 X100 Y0 F1800',
      'G1 X100 Y100 F1800',
    ];
    const result = estimateAccelerationLimitedTime(lines, 3000, 500);
    expect(result.limitedTime).toBeGreaterThan(0);
    expect(result.unlimitedTime).toBeGreaterThan(0);
    expect(result.limitedTime).toBeGreaterThanOrEqual(result.unlimitedTime);
  });

  it('detects acceleration overhead', () => {
    const lines: string[] = [];
    // Many short moves with direction changes
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i % 2 === 0 ? 5 : 0} Y0 F1800`);
    }
    const result = estimateAccelerationLimitedTime(lines, 3000, 500);
    expect(result.accelerationOverhead).toBeGreaterThan(0);
    expect(result.overheadPercentage).toBeGreaterThan(0);
  });

  it('counts direction changes', () => {
    const lines = [
      'G1 X10 Y0 F1800',
      'G1 X10 Y10 F1800',   // 90° change
      'G1 X0 Y10 F1800',    // 90° change
    ];
    const result = estimateAccelerationLimitedTime(lines, 3000, 500);
    expect(result.directionChanges).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = estimateAccelerationLimitedTime([]);
    expect(result.limitedTime).toBe(0);
    expect(result.unlimitedTime).toBe(0);
  });
});

// ── 4. Energy Consumption ──

describe('estimateEnergyConsumption', () => {
  it('estimates energy for 3DP', () => {
    const lines = [
      'M104 S210',
      'M140 S60',
      'G1 X100 Y0 E5 F1800',
      'G1 X100 Y100 E10 F1800',
    ];
    const result = estimateEnergyConsumption(lines, 0.15, '3dp');
    expect(result.totalEnergy).toBeGreaterThan(0);
    expect(result.peakPower).toBeGreaterThan(0);
    expect(result.avgPower).toBeGreaterThan(0);
  });

  it('estimates energy for CNC', () => {
    const lines = [
      'M3 S12000',
      'G1 X100 Y0 Z-2 F500',
    ];
    const result = estimateEnergyConsumption(lines, 0.15, 'cnc');
    expect(result.totalEnergy).toBeGreaterThan(0);
    expect(result.peakPower).toBeGreaterThan(100);
  });

  it('computes cost', () => {
    const lines = ['M104 S210', 'G1 X100 Y0 E5 F1800'];
    const result = estimateEnergyConsumption(lines, 0.20, '3dp');
    expect(result.estimatedCost).toBeGreaterThan(0);
  });

  it('provides breakdown by operation', () => {
    const lines = [
      'M104 S210', 'M140 S60',
      'G1 X100 Y0 E5 F1800',
      'G0 X0 Y0',
    ];
    const result = estimateEnergyConsumption(lines, 0.15, '3dp');
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = estimateEnergyConsumption([]);
    expect(result.totalEnergy).toBe(0);
    expect(result.segments).toEqual([]);
  });
});

// ── 5. Work Offset Analysis ──

describe('analyzeWorkOffsets', () => {
  it('detects G54 work offset', () => {
    const lines = ['G54', 'G1 X10 Y10 F500'];
    const result = analyzeWorkOffsets(lines);
    expect(result.offsets.length).toBe(1);
    expect(result.offsets[0].name).toBe('G54');
    expect(result.activeOffset).toBe('G54');
  });

  it('detects multiple work offsets', () => {
    const lines = ['G54', 'G1 X10 Y10 F500', 'G55', 'G1 X20 Y20 F500'];
    const result = analyzeWorkOffsets(lines);
    expect(result.offsets.length).toBe(2);
    expect(result.usesMultipleOffsets).toBe(true);
    expect(result.offsetChanges).toBe(2);
  });

  it('parses G10 L2 offset setting', () => {
    const lines = ['G10 L2 P1 X10 Y20 Z5', 'G54', 'G1 X10 Y10 F500'];
    const result = analyzeWorkOffsets(lines);
    expect(result.g10Commands.length).toBe(1);
    expect(result.g10Commands[0].offset).toBe('G54');
    expect(result.g10Commands[0].x).toBe(10);
  });

  it('handles no work offsets', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeWorkOffsets(lines);
    expect(result.offsets).toEqual([]);
    expect(result.activeOffset).toBeNull();
  });
});

// ── 6. Material Recommendations ──

describe('getMaterialRecommendations', () => {
  it('returns recommendations for common materials', () => {
    const recs = getMaterialRecommendations();
    expect(recs.PLA).toBeDefined();
    expect(recs.ABS).toBeDefined();
    expect(recs.PETG).toBeDefined();
    expect(recs.TPU).toBeDefined();
  });

  it('PLA has correct properties', () => {
    const pla = getMaterialRecommendations().PLA;
    expect(pla.hotendTemp.min).toBeLessThan(pla.hotendTemp.max);
    expect(pla.needsCooling).toBe(true);
    expect(pla.needsEnclosure).toBe(false);
  });

  it('ABS requires enclosure', () => {
    const abs = getMaterialRecommendations().ABS;
    expect(abs.needsEnclosure).toBe(true);
  });
});

describe('compareMaterialParameters', () => {
  it('compares actual parameters against recommendations', () => {
    const lines = ['M104 S210', 'M140 S60', 'M106 S128', 'G1 X10 Y10 F1800'];
    const result = compareMaterialParameters(lines, 'PLA');
    expect(result.material).not.toBeNull();
    expect(result.actual.hotendTemp).toBe(210);
    expect(result.actual.bedTemp).toBe(60);
  });

  it('detects temperature issues', () => {
    const lines = ['M104 S150']; // too low for ABS
    const result = compareMaterialParameters(lines, 'ABS');
    const tempIssue = result.issues.find(i => i.parameter === 'Hotend Temperature');
    expect(tempIssue).toBeDefined();
  });

  it('handles unknown material', () => {
    const lines = ['M104 S210'];
    const result = compareMaterialParameters(lines, 'UNKNOWN');
    expect(result.material).toBeNull();
  });
});

// ── 7. Pattern Recognition ──

describe('recognizePatterns', () => {
  it('detects linear patterns', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0`);
    }
    const result = recognizePatterns(lines, 10);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('detects circular patterns', () => {
    const lines: string[] = [];
    const cx = 50, cy = 50, r = 20;
    // Full circle with enough points
    for (let i = 0; i <= 40; i++) {
      const angle = (i / 40) * 2 * Math.PI;
      lines.push(`G1 X${(cx + r * Math.cos(angle)).toFixed(4)} Y${(cy + r * Math.sin(angle)).toFixed(4)}`);
    }
    const result = recognizePatterns(lines, 25);
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.patterns.some(p => p.type === 'circle')).toBe(true);
  });

  it('detects zigzag patterns', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      const x = i * 10;
      const y = i % 2 === 0 ? 0 : 50;
      lines.push(`G1 X${x} Y${y}`);
    }
    const result = recognizePatterns(lines, 15);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = recognizePatterns([]);
    expect(result.patterns).toEqual([]);
  });
});

// ── 8. Print Difficulty Rating ──

describe('ratePrintDifficulty', () => {
  it('rates easy print', () => {
    const bounds = { minX: 0, maxX: 30, minY: 0, maxY: 30, minZ: 0, maxZ: 10 };
    const result = ratePrintDifficulty(bounds, 50, 0, 0, false, 20, 0.8, 200, false);
    expect(result.rating).toBe('easy');
    expect(result.overallDifficulty).toBeLessThan(0.2);
  });

  it('rates hard print with overhangs', () => {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 80 };
    const result = ratePrintDifficulty(bounds, 300, 20, 10, true, 65, 0.3, 250, true);
    expect(['hard', 'very_hard', 'expert']).toContain(result.rating);
  });

  it('provides recommendations', () => {
    const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 30 };
    const result = ratePrintDifficulty(bounds, 100, 10, 5, true, 55, 0.4, 230, true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('computes factor scores', () => {
    const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 20 };
    const result = ratePrintDifficulty(bounds, 100, 5, 2, false, 40, 0.5, 210, false);
    expect(result.factors.length).toBe(8);
    for (const f of result.factors) {
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(1);
    }
  });
});

// ── 9. Tool Deflection ──

describe('estimateToolDeflection', () => {
  it('estimates deflection for cutting moves', () => {
    const lines = [
      'M3 S1000',
      'G1 X10 Y10 Z-2 F500',
      'G1 X20 Y10 Z-2 F500',
    ];
    const result = estimateToolDeflection(lines, 6, 30, 0.05, 2, 3);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.maxDeflection).toBeGreaterThan(0);
  });

  it('classifies severity', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 Z-5 F500'];
    const result = estimateToolDeflection(lines, 6, 50, 0.1, 5, 5);
    if (result.segments.length > 0) {
      expect(['low', 'medium', 'high']).toContain(result.segments[0].severity);
    }
  });

  it('provides recommendations for high deflection', () => {
    const lines = ['M3 S1000', 'G1 X10 Y10 Z-5 F500'];
    const result = estimateToolDeflection(lines, 3, 50, 0.1, 5, 3);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = estimateToolDeflection(lines, 6);
    expect(result.segments).toEqual([]);
    expect(result.maxDeflection).toBe(0);
  });
});

// ── 10. G-code Compression ──

describe('compressGcode', () => {
  it('removes duplicate feed rates', () => {
    const lines = [
      'G1 X10 Y10 F1800',
      'G1 X20 Y20 F1800',  // duplicate F
      'G1 X30 Y30 F3600',
    ];
    const result = compressGcode(lines);
    expect(result.compressedLines_.length).toBeLessThanOrEqual(lines.length);
    const hasDupAction = result.actions.find(a => a.type.includes('duplicate feed'));
    expect(hasDupAction).toBeDefined();
  });

  it('removes duplicate modal G-codes', () => {
    const lines = [
      'G1 X10 Y10 F1800',
      'G1 X20 Y20 F1800',
      'G1 X30 Y30 F1800',
    ];
    const result = compressGcode(lines);
    // After removing duplicate F and G1, lines should be shorter
    expect(result.savingsPercentage).toBeGreaterThan(0);
  });

  it('removes empty lines', () => {
    const lines = ['G1 X10 Y10', '', '  ', 'G1 X20 Y20'];
    const result = compressGcode(lines);
    expect(result.compressedLines_.length).toBeLessThan(lines.length);
  });

  it('strips comments when configured', () => {
    const lines = ['G1 X10 Y10 ; this is a comment', '(another comment) G1 X20 Y20'];
    const result = compressGcode(lines, true);
    expect(result.compressedLines_.every(l => !l.includes('comment'))).toBe(true);
  });

  it('computes compression ratio', () => {
    const lines = ['G1 X10 Y10 F1800', 'G1 X20 Y20 F1800', 'G1 X30 Y30 F1800'];
    const result = compressGcode(lines);
    expect(result.compressionRatio).toBeGreaterThan(1);
    expect(result.savingsPercentage).toBeGreaterThan(0);
  });
});

// ── 11. Thermal Expansion Compensation ──

describe('compensateThermalExpansion', () => {
  it('compensates positions for thermal expansion', () => {
    const lines = ['G1 X50 Y50 Z25 F500'];
    const result = compensateThermalExpansion(lines, 20, 30, 23, 100, 100, 50);
    expect(result.compensatedLines.length).toBe(lines.length);
    expect(result.maxExpansion).toBeGreaterThan(0);
  });

  it('detects significant expansion', () => {
    const lines = ['G1 X100 Y100 Z50 F500'];
    const result = compensateThermalExpansion(lines, 20, 50, 23, 200, 200, 100);
    expect(result.isSignificant).toBe(true);
  });

  it('handles negligible expansion', () => {
    const lines = ['G1 X10 Y10 Z5 F500'];
    const result = compensateThermalExpansion(lines, 20, 21, 1.2, 10, 10, 5);
    expect(result.isSignificant).toBe(false);
  });

  it('provides recommendations for high CTE', () => {
    const lines = ['G1 X50 Y50 Z25 F500'];
    const result = compensateThermalExpansion(lines, 20, 40, 25, 100, 100, 50);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles non-motion lines', () => {
    const lines = ['M3 S1000', '; comment', 'G1 X10 Y10 F500'];
    const result = compensateThermalExpansion(lines);
    expect(result.compensatedLines.length).toBe(lines.length);
  });
});

// ── 12. Subprogram Expansion ──

describe('expandSubprograms', () => {
  it('finds subprogram definitions', () => {
    const lines = [
      'O100',
      'G1 X10 Y10 F500',
      'G1 X20 Y20 F500',
      'M99',
      'M98 P100',
    ];
    const result = expandSubprograms(lines);
    expect(result.definitions.length).toBe(1);
    expect(result.definitions[0].programNumber).toBe(100);
  });

  it('finds M98 subprogram calls', () => {
    const lines = [
      'O100',
      'G1 X10 Y10 F500',
      'M99',
      'M98 P100 L3',
    ];
    const result = expandSubprograms(lines);
    expect(result.calls.length).toBe(1);
    expect(result.calls[0].callType).toBe('M98');
    expect(result.calls[0].repetitions).toBe(3);
  });

  it('finds G65 macro calls', () => {
    const lines = [
      'O200',
      'G1 X10 Y10 F500',
      'M99',
      'G65 P200 A10 B20',
    ];
    const result = expandSubprograms(lines);
    expect(result.calls.length).toBe(1);
    expect(result.calls[0].callType).toBe('G65');
    expect(result.calls[0].arguments.length).toBe(2);
  });

  it('expands subprogram calls', () => {
    const lines = [
      'O100',
      'G1 X10 Y10 F500',
      'M99',
      'M98 P100 L2',
    ];
    const result = expandSubprograms(lines);
    expect(result.expandedLineCount).toBeGreaterThan(result.originalLineCount);
    expect(result.expandedLines.some(l => l.includes('Expanded'))).toBe(true);
  });

  it('handles no subprograms', () => {
    const lines = ['G1 X10 Y10 F500', 'M30'];
    const result = expandSubprograms(lines);
    expect(result.hasSubprograms).toBe(false);
    expect(result.calls).toEqual([]);
  });
});
