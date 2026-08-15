/**
 * @file GcodeAdvanced12.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced12 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  reverseEngineerGcode,
  searchMaterialDatabase,
  getMaterialByName,
  getAllMaterials,
  getExtendedToolLibrary,
  recommendTool,
  createVersionControl,
  analyzeMachiningStrategy,
  analyzeBedLevelingQuality,
  convertGcodeUnits,
  autoCorrectGcode,
  optimizeToolpathForRendering,
  schedulePrintJobs,
  validateGcodeRules,
  scheduleWarmupCooldown,
} from '../src/core/GcodeAdvanced12';

// ── 1. Reverse Engineering ──

describe('reverseEngineerGcode', () => {
  it('identifies features from toolpath', () => {
    const lines = [
      'G1 X10 Y0 Z-1 F500',
      'G1 X10 Y10 Z-1 F500',
      'G1 X0 Y10 Z-1 F500',
      'G1 X0 Y0 Z-1 F500',
    ];
    const result = reverseEngineerGcode(lines);
    expect(result.features.length).toBeGreaterThan(0);
  });

  it('detects holes from circular patterns', () => {
    const lines: string[] = [];
    for (let i = 0; i < 36; i++) {
      const angle = (i * 10) * Math.PI / 180;
      lines.push(`G1 X${(5 * Math.cos(angle)).toFixed(3)} Y${(5 * Math.sin(angle)).toFixed(3)} Z-1 F500`);
    }
    const result = reverseEngineerGcode(lines);
    expect(result.features.some(f => f.type === 'hole')).toBe(true);
  });

  it('handles empty input', () => {
    const result = reverseEngineerGcode([]);
    expect(result.totalFeatures).toBe(0);
  });

  it('computes confidence scores', () => {
    const lines = ['G1 X10 Y0 Z-1 F500', 'G1 X10 Y10 Z-1 F500', 'G1 X0 Y10 Z-1 F500', 'G1 X0 Y0 Z-1 F500'];
    const result = reverseEngineerGcode(lines);
    if (result.features.length > 0) {
      expect(result.features[0].confidence).toBeGreaterThan(0);
      expect(result.features[0].confidence).toBeLessThanOrEqual(100);
    }
  });
});

// ── 2. Material Property Database ──

describe('searchMaterialDatabase', () => {
  it('finds materials by name', () => {
    const result = searchMaterialDatabase('PLA');
    expect(result.found).toBe(true);
    expect(result.materials.some(m => m.name === 'PLA')).toBe(true);
  });

  it('finds materials by category', () => {
    const result = searchMaterialDatabase('', 'metal');
    expect(result.materials.every(m => m.category === 'metal')).toBe(true);
  });

  it('handles no matches', () => {
    const result = searchMaterialDatabase('nonexistent');
    expect(result.found).toBe(false);
    expect(result.count).toBe(0);
  });

  it('returns all materials with empty query', () => {
    const result = searchMaterialDatabase();
    expect(result.count).toBeGreaterThan(5);
  });
});

describe('getMaterialByName', () => {
  it('finds material by exact name', () => {
    const mat = getMaterialByName('PLA');
    expect(mat).not.toBeNull();
    expect(mat!.name).toBe('PLA');
  });

  it('finds material by partial name', () => {
    const mat = getMaterialByName('Aluminum');
    expect(mat).not.toBeNull();
    expect(mat!.name).toContain('Aluminum');
  });

  it('returns null for unknown material', () => {
    const mat = getMaterialByName('Unobtanium');
    expect(mat).toBeNull();
  });
});

describe('getAllMaterials', () => {
  it('returns all materials', () => {
    const mats = getAllMaterials();
    expect(mats.length).toBeGreaterThan(5);
  });
});

// ── 3. Extended Tool Library ──

describe('getExtendedToolLibrary', () => {
  it('returns all tools', () => {
    const result = getExtendedToolLibrary();
    expect(result.count).toBeGreaterThan(3);
  });

  it('filters by material', () => {
    const result = getExtendedToolLibrary('Aluminum');
    expect(result.tools.every(t => t.suitableMaterials.some(m => m.includes('Aluminum')))).toBe(true);
  });

  it('categorizes by type', () => {
    const result = getExtendedToolLibrary();
    expect(Object.keys(result.byType).length).toBeGreaterThan(0);
  });
});

describe('recommendTool', () => {
  it('recommends a tool for an operation', () => {
    const tool = recommendTool('end_mill', 'Aluminum 6061');
    expect(tool).not.toBeNull();
    expect(tool!.type).toBe('end_mill');
  });

  it('returns null for no match', () => {
    const tool = recommendTool('end_mill', 'Unobtanium');
    expect(tool).toBeNull();
  });

  it('filters by diameter', () => {
    const tool = recommendTool('end_mill', 'Aluminum 6061', 6.35);
    expect(tool).not.toBeNull();
    expect(Math.abs(tool!.diameter - 6.35)).toBeLessThan(1);
  });
});

// ── 4. Version Control ──

describe('GcodeVersionControl', () => {
  it('creates and commits', () => {
    const vc = createVersionControl();
    const result = vc.commit(['G1 X10 Y10 F500'], 'Initial commit');
    expect(result.commitCount).toBe(1);
    expect(result.head).not.toBeNull();
  });

  it('creates branches', () => {
    const vc = createVersionControl();
    vc.commit(['G1 X10 Y10 F500'], 'Initial');
    const result = vc.createBranch('feature');
    expect(result.branches.some(b => b.name === 'feature')).toBe(true);
  });

  it('switches branches', () => {
    const vc = createVersionControl();
    vc.commit(['G1 X10 Y10 F500'], 'Initial');
    vc.createBranch('feature');
    const result = vc.checkout('feature');
    expect(result.currentBranch).toBe('feature');
  });

  it('tracks commit history', () => {
    const vc = createVersionControl();
    vc.commit(['G1 X10 Y10 F500'], 'First');
    vc.commit(['G1 X20 Y20 F500'], 'Second');
    const history = vc.getHistory();
    expect(history.length).toBe(2);
  });

  it('generates checksums', () => {
    const vc = createVersionControl();
    vc.commit(['G1 X10 Y10 F500'], 'Initial');
    const result = vc.getStatus();
    expect(result.head!.checksum).toBeDefined();
  });
});

// ── 5. Machining Strategy Analyzer ──

describe('analyzeMachiningStrategy', () => {
  it('identifies machining strategies', () => {
    const lines = [
      'T1 M6',
      'M3 S5000',
      'G1 X0 Y0 Z-1 F1000',
      'G1 X100 Y0 Z-1 F1000',
      'G1 X100 Y100 Z-1 F1000',
      'G1 X0 Y100 Z-1 F1000',
      'G1 X0 Y0 Z-1 F1000',
    ];
    const result = analyzeMachiningStrategy(lines);
    expect(result.strategies.length).toBeGreaterThan(0);
  });

  it('detects facing operations', () => {
    const lines: string[] = [];
    lines.push('M3 S3000');
    for (let y = 0; y <= 100; y += 10) {
      lines.push(`G1 X0 Y${y} Z-0.5 F2000`);
      lines.push(`G1 X100 Y${y} Z-0.5 F2000`);
    }
    const result = analyzeMachiningStrategy(lines);
    expect(result.strategies.some(s => s.type === 'facing')).toBe(true);
  });

  it('handles empty input', () => {
    const result = analyzeMachiningStrategy([]);
    expect(result.strategies).toEqual([]);
  });
});

// ── 6. Bed Leveling Quality ──

describe('analyzeBedLevelingQuality', () => {
  it('detects bed leveling commands', () => {
    const lines = ['G28', 'G29', 'G1 X10 Y10 E5 F1800'];
    const result = analyzeBedLevelingQuality(lines);
    expect(result.hasLeveling).toBe(true);
    expect(result.levelingType).toBe('auto');
  });

  it('parses mesh points', () => {
    const lines = [
      'G29',
      '; X:10 Y:10 Z:0.123',
      '; X:10 Y:50 Z:0.045',
      '; X:50 Y:10 Z:-0.012',
      '; X:50 Y:50 Z:0.089',
    ];
    const result = analyzeBedLevelingQuality(lines);
    expect(result.meshPoints.length).toBe(4);
  });

  it('detects no leveling', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeBedLevelingQuality(lines);
    expect(result.hasLeveling).toBe(false);
  });

  it('computes flatness score', () => {
    const lines = ['G29', '; X:0 Y:0 Z:0.01', '; X:10 Y:0 Z:0.01', '; X:0 Y:10 Z:0.01', '; X:10 Y:10 Z:0.01'];
    const result = analyzeBedLevelingQuality(lines);
    expect(result.flatnessScore).toBeGreaterThan(50);
  });
});

// ── 7. Unit Conversion ──

describe('convertGcodeUnits', () => {
  it('converts imperial to metric', () => {
    const lines = ['G20', 'G1 X1.0 Y2.0 F100'];
    const result = convertGcodeUnits(lines, 'metric');
    expect(result.wasConverted).toBe(true);
    expect(result.convertedLines[0]).toContain('G21');
    expect(result.convertedLines[1]).toContain('X25.4000');
  });

  it('converts metric to imperial', () => {
    const lines = ['G21', 'G1 X25.4 Y50.8 F2540'];
    const result = convertGcodeUnits(lines, 'imperial');
    expect(result.wasConverted).toBe(true);
    expect(result.convertedLines[0]).toContain('G20');
  });

  it('detects no conversion needed', () => {
    const lines = ['G21', 'G1 X10 Y10 F500'];
    const result = convertGcodeUnits(lines, 'metric');
    expect(result.wasConverted).toBe(false);
  });

  it('converts feed rates', () => {
    const lines = ['G20', 'G1 X1.0 F100'];
    const result = convertGcodeUnits(lines, 'metric');
    expect(result.convertedLines[1]).toContain('F2540.0');
  });
});

// ── 8. Error Auto-Correction ──

describe('autoCorrectGcode', () => {
  it('uppercases G/M codes', () => {
    const lines = ['g1 x10 y10 f500'];
    const result = autoCorrectGcode(lines);
    expect(result.correctedLines[0]).toContain('G1');
    expect(result.correctedLines[0]).toContain('X10');
  });

  it('removes leading zeros', () => {
    const lines = ['G01 X10 Y10 M06 T01'];
    const result = autoCorrectGcode(lines);
    expect(result.correctedLines[0]).toContain('G1');
    expect(result.correctedLines[0]).toContain('M6');
  });

  it('adds missing spaces', () => {
    const lines = ['G1X10Y10F500'];
    const result = autoCorrectGcode(lines);
    expect(result.correctedLines[0]).toContain('G1 X10');
  });

  it('detects no corrections needed', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = autoCorrectGcode(lines);
    expect(result.wasCorrected).toBe(false);
  });

  it('counts corrections', () => {
    const lines = ['g01 x10 y10', 'm06 t01'];
    const result = autoCorrectGcode(lines);
    expect(result.correctionCount).toBeGreaterThan(0);
  });
});

// ── 9. Rendering Optimization ──

describe('optimizeToolpathForRendering', () => {
  it('removes duplicate points', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X10 Y10 F500', 'G1 X20 Y20 F500'];
    const result = optimizeToolpathForRendering(lines);
    expect(result.optimizedSegments).toBeLessThan(result.originalSegments);
  });

  it('removes collinear points', () => {
    const lines = ['G1 X0 Y0 F500', 'G1 X5 Y0 F500', 'G1 X10 Y0 F500', 'G1 X15 Y0 F500'];
    const result = optimizeToolpathForRendering(lines);
    expect(result.optimizedSegments).toBeLessThan(result.originalSegments);
  });

  it('computes reduction percentage', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X10 Y10 F500'];
    const result = optimizeToolpathForRendering(lines);
    expect(result.reductionPercentage).toBeGreaterThanOrEqual(0);
  });

  it('handles empty input', () => {
    const result = optimizeToolpathForRendering([]);
    expect(result.originalSegments).toBe(0);
  });
});

// ── 10. Print Job Scheduler ──

describe('schedulePrintJobs', () => {
  it('schedules jobs by priority', () => {
    const jobs = [
      { name: 'A', estimatedTime: 3600, materialNeeded: 50, priority: 2, dependencies: [] },
      { name: 'B', estimatedTime: 1800, materialNeeded: 30, priority: 1, dependencies: [] },
    ];
    const result = schedulePrintJobs(jobs);
    expect(result.schedule.length).toBe(2);
    expect(result.schedule[0].name).toBe('B');
  });

  it('respects dependencies', () => {
    const jobs = [
      { name: 'A', estimatedTime: 3600, materialNeeded: 50, priority: 1, dependencies: ['B'] },
      { name: 'B', estimatedTime: 1800, materialNeeded: 30, priority: 2, dependencies: [] },
    ];
    const result = schedulePrintJobs(jobs);
    expect(result.schedule[0].name).toBe('B');
    expect(result.schedule[1].name).toBe('A');
  });

  it('detects circular dependencies', () => {
    const jobs = [
      { name: 'A', estimatedTime: 3600, materialNeeded: 50, priority: 1, dependencies: ['B'] },
      { name: 'B', estimatedTime: 1800, materialNeeded: 30, priority: 2, dependencies: ['A'] },
    ];
    const result = schedulePrintJobs(jobs);
    expect(result.unscheduledJobs.length).toBeGreaterThan(0);
  });

  it('handles material limits', () => {
    const jobs = [
      { name: 'A', estimatedTime: 3600, materialNeeded: 100, priority: 1, dependencies: [] },
    ];
    const result = schedulePrintJobs(jobs, 50);
    expect(result.unscheduledJobs).toContain('A');
  });
});

// ── 11. Validation Rules Engine ──

describe('validateGcodeRules', () => {
  it('detects missing homing', () => {
    const lines = ['G1 X10 Y10 F500', 'M30'];
    const result = validateGcodeRules(lines);
    expect(result.violations.some(v => v.ruleName === 'has_homing')).toBe(true);
  });

  it('passes valid G-code', () => {
    const lines = ['G21', 'G28', 'G1 X10 Y10 F500', 'M30'];
    const result = validateGcodeRules(lines);
    expect(result.bySeverity.error).toBe(0);
  });

  it('detects missing program end', () => {
    const lines = ['G28', 'G1 X10 Y10 F500'];
    const result = validateGcodeRules(lines);
    expect(result.violations.some(v => v.ruleName === 'has_program_end')).toBe(true);
  });

  it('supports custom rules', () => {
    const customRule = {
      name: 'custom_check',
      description: 'Custom validation',
      category: 'quality' as const,
      severity: 'warning' as const,
      check: (lines: string[]) => ({ passed: false, message: 'Custom fail', lineNumbers: [] }),
    };
    const result = validateGcodeRules(['G1 X10 Y10 F500'], [customRule]);
    expect(result.violations.some(v => v.ruleName === 'custom_check')).toBe(true);
  });

  it('computes validation score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = validateGcodeRules(lines);
    expect(result.validationScore).toBeGreaterThanOrEqual(0);
    expect(result.validationScore).toBeLessThanOrEqual(100);
  });
});

// ── 12. Warmup/Cooldown Scheduler ──

describe('scheduleWarmupCooldown', () => {
  it('generates warmup routine', () => {
    const result = scheduleWarmupCooldown(10000);
    expect(result.warmupLines.length).toBeGreaterThan(0);
    expect(result.warmupSteps.length).toBeGreaterThan(0);
  });

  it('generates cooldown routine', () => {
    const result = scheduleWarmupCooldown(10000);
    expect(result.cooldownLines.length).toBeGreaterThan(0);
    expect(result.cooldownSteps.length).toBeGreaterThan(0);
  });

  it('creates progressive RPM steps', () => {
    const result = scheduleWarmupCooldown(10000);
    const rpms = result.warmupSteps.map(s => s.rpm);
    expect(rpms[0]).toBeLessThan(rpms[rpms.length - 1]);
  });

  it('computes total time', () => {
    const result = scheduleWarmupCooldown(10000);
    expect(result.totalTime).toBeGreaterThan(0);
    expect(result.totalTime).toBe(result.warmupDuration + result.cooldownDuration);
  });

  it('adjusts for spindle type', () => {
    const bearing = scheduleWarmupCooldown(10000, 'bearing');
    const ceramic = scheduleWarmupCooldown(10000, 'ceramic');
    expect(bearing.warmupDuration).toBeGreaterThan(ceramic.warmupDuration);
  });
});
