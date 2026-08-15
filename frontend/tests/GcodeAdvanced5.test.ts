/**
 * @file GcodeAdvanced5.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced5 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  lintGcode,
  predictSurfaceFinish,
  analyzeToolpathOptimization,
  checkPrintability,
  computeToolEngagement,
  trackFilamentPerLayer,
  postProcessForMachine,
  getDefaultPostProcessorConfig,
  analyzePressureAdvance,
  detectArcFittingCandidates,
  profileGcode,
  computeBeadGeometry,
  computeBeadFromMove,
  computeGcodeChecksum,
  createRevision,
  diffGcodeRevisions,
  exportRevisionHistory,
  importRevisionHistory,
} from '../src/core/GcodeAdvanced5';

// ── 1. G-code Linting ──

describe('lintGcode', () => {
  it('detects no issues for valid G-code', () => {
    const lines = [
      'G21 G90',
      'M3 S1000',
      'G1 X10 Y10 F500',
      'G1 X20 Y20 F500',
      'M5',
      'M30',
    ];
    const result = lintGcode(lines);
    expect(result.errorCount).toBe(0);
    expect(result.isValid).toBe(true);
  });

  it('detects cutting without spindle', () => {
    const lines = ['G1 X10 Y10 Z-5 F500'];
    const result = lintGcode(lines);
    const safetyIssue = result.issues.find(i => i.category === 'safety');
    expect(safetyIssue).toBeDefined();
    expect(safetyIssue!.severity).toBe('error');
  });

  it('detects very low feed rate', () => {
    const lines = ['G1 X10 Y10 F5'];
    const result = lintGcode(lines);
    const perfIssue = result.issues.find(i => i.category === 'performance');
    expect(perfIssue).toBeDefined();
  });

  it('detects very high feed rate', () => {
    const lines = ['G1 X10 Y10 F50000'];
    const result = lintGcode(lines);
    const perfIssue = result.issues.find(i => i.category === 'performance' && i.message.includes('high'));
    expect(perfIssue).toBeDefined();
  });

  it('detects duplicate words', () => {
    const lines = ['G1 X10 X20 F500'];
    const result = lintGcode(lines);
    const dupIssue = result.issues.find(i => i.message.includes('Duplicate'));
    expect(dupIssue).toBeDefined();
  });

  it('computes quality score', () => {
    const lines = ['G21 G90', 'M3 S1000', 'G1 X10 Y10 F500', 'M30'];
    const result = lintGcode(lines);
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1);
  });

  it('handles empty input', () => {
    const result = lintGcode([]);
    expect(result.issues).toEqual([]);
    expect(result.isValid).toBe(true);
  });
});

// ── 2. Surface Finish Prediction ──

describe('predictSurfaceFinish', () => {
  it('predicts surface finish for ball mill', () => {
    const result = predictSurfaceFinish(0.2, 6, 'ballmill');
    expect(result.ra).toBeGreaterThan(0);
    expect(result.rz).toBeGreaterThan(result.ra);
    expect(result.scallopHeight).toBeGreaterThan(0);
  });

  it('predicts surface finish for end mill', () => {
    const result = predictSurfaceFinish(0.2, 6, 'endmill');
    expect(result.ra).toBeGreaterThan(0);
    expect(result.quality).toBeDefined();
  });

  it('classifies quality correctly', () => {
    const fine = predictSurfaceFinish(0.01, 10, 'ballmill');
    expect(fine.quality).toBe('very_fine');
    const rough = predictSurfaceFinish(5, 6, 'ballmill');
    expect(['rough', 'medium']).toContain(rough.quality);
  });

  it('warns when stepover exceeds tool radius', () => {
    const result = predictSurfaceFinish(10, 6, 'ballmill');
    const warning = result.recommendations.find(r => r.includes('uncut'));
    expect(warning).toBeDefined();
  });

  it('provides recommendations for rough finish', () => {
    const result = predictSurfaceFinish(3, 6, 'ballmill');
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

// ── 3. Toolpath Optimization ──

describe('analyzeToolpathOptimization', () => {
  it('analyzes cutting and travel distances', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G0 X50 Y50',           // travel
      'G1 X60 Y60 E10 F1800',
    ];
    const result = analyzeToolpathOptimization(lines);
    expect(result.cuttingDistance).toBeGreaterThan(0);
    expect(result.travelDistance).toBeGreaterThan(0);
    expect(result.travelCount).toBe(1);
  });

  it('computes travel ratio', () => {
    const lines = [
      'G1 X10 Y10 E5 F1800',
      'G0 X100 Y100',
      'G1 X110 Y110 E10 F1800',
    ];
    const result = analyzeToolpathOptimization(lines);
    expect(result.travelRatio).toBeGreaterThan(0);
    // efficiencyScore = 1 - travelRatio, clamped to [0, 1]
    expect(result.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(result.efficiencyScore).toBeLessThanOrEqual(1);
  });

  it('provides suggestions for high travel ratio', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i} Y0 E${i + 1} F1800`);
      lines.push(`G0 X${i} Y100`); // long travel
    }
    const result = analyzeToolpathOptimization(lines);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = analyzeToolpathOptimization([]);
    expect(result.cuttingDistance).toBe(0);
    expect(result.travelDistance).toBe(0);
  });
});

// ── 4. Printability Check ──

describe('checkPrintability', () => {
  it('detects overhangs', () => {
    const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 20 };
    const zLayers = Array.from({ length: 100 }, (_, i) => ({ layerIndex: i, zHeight: i * 0.2 }));
    const overhangAngles = Array.from({ length: 100 }, (_, i) => i > 50 ? 50 + i * 0.2 : 0);
    const result = checkPrintability(bounds, zLayers, overhangAngles);
    const overhangIssues = result.issues.filter(i => i.type === 'overhang');
    expect(overhangIssues.length).toBeGreaterThan(0);
  });

  it('detects large flat surfaces', () => {
    const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 200, minZ: 0, maxZ: 3 };
    const result = checkPrintability(bounds, [], []);
    const flatIssue = result.issues.find(i => i.type === 'flat_surface');
    expect(flatIssue).toBeDefined();
  });

  it('detects tall thin parts', () => {
    const bounds = { minX: 0, maxX: 5, minY: 0, maxY: 5, minZ: 0, maxZ: 100 };
    const result = checkPrintability(bounds, [], []);
    const thinIssue = result.issues.find(i => i.type === 'thin_wall');
    expect(thinIssue).toBeDefined();
  });

  it('computes printability score', () => {
    const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 20 };
    const result = checkPrintability(bounds, [], []);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('provides summary', () => {
    const bounds = { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 20 };
    const result = checkPrintability(bounds, [], []);
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ── 5. Tool Engagement Angle ──

describe('computeToolEngagement', () => {
  it('computes engagement for cutting moves', () => {
    const lines = [
      'G1 X10 Y10 Z-2 F500',
      'G1 X20 Y10 Z-2 F500',
    ];
    const result = computeToolEngagement(lines, 6, 2, 0.05);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].engagementAngle).toBeGreaterThan(0);
    expect(result[0].chipThickness).toBeGreaterThan(0);
  });

  it('classifies engagement type', () => {
    const lines = ['G1 X10 Y10 Z-2 F500'];
    const result = computeToolEngagement(lines, 6, 2, 0.05);
    if (result.length > 0) {
      expect(['full', 'half', 'partial', 'none']).toContain(result[0].engagementType);
    }
  });

  it('returns empty for no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    expect(computeToolEngagement(lines, 6)).toEqual([]);
  });
});

// ── 6. Filament Per Layer ──

describe('trackFilamentPerLayer', () => {
  it('tracks filament usage per layer', () => {
    const lines = [
      'G1 X0 Y0 E0 F1800',
      'G1 X10 Y0 E5 F1800',
      'G1 X10 Y10 E10 F1800',
      'G1 X0 Y10 E15 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 3 },
    ];
    const result = trackFilamentPerLayer(lines, zLayers);
    expect(result.layers.length).toBe(1);
    expect(result.layers[0].filamentLength).toBe(15);
    expect(result.totalLength).toBe(15);
  });

  it('computes volume and weight', () => {
    const lines = ['G1 X10 Y10 E10 F1800'];
    const zLayers = [{ layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 0 }];
    const result = trackFilamentPerLayer(lines, zLayers, 1.75, 1.24);
    const filamentArea = Math.PI * (1.75 / 2) ** 2;
    expect(result.layers[0].volume).toBeCloseTo(10 * filamentArea, 2);
  });

  it('computes percentages', () => {
    const lines = [
      'G1 X10 Y0 E5 F1800',
      'G1 X20 Y0 E15 F1800',
    ];
    const zLayers = [
      { layerIndex: 0, zHeight: 0.2, startLine: 0, endLine: 0 },
      { layerIndex: 1, zHeight: 0.4, startLine: 1, endLine: 1 },
    ];
    const result = trackFilamentPerLayer(lines, zLayers);
    expect(result.layers[0].percentage).toBeCloseTo(33.33, 0);
    expect(result.layers[1].percentage).toBeCloseTo(66.67, 0);
  });

  it('handles empty input', () => {
    const result = trackFilamentPerLayer([], []);
    expect(result.layers).toEqual([]);
    expect(result.totalLength).toBe(0);
  });
});

// ── 7. Machine Post-Processor ──

describe('postProcessForMachine', () => {
  it('strips comments when configured', () => {
    const lines = ['G1 X10 Y10 ; comment', '(comment) G1 X20 Y20'];
    const config = getDefaultPostProcessorConfig('grbl');
    const result = postProcessForMachine(lines, config);
    expect(result.every(l => !l.includes(';') || l.startsWith(';'))).toBe(true);
  });

  it('adds line numbers when configured', () => {
    const lines = ['G1 X10 Y10', 'G1 X20 Y20'];
    const config = getDefaultPostProcessorConfig('fanuc');
    const result = postProcessForMachine(lines, config);
    expect(result.some(l => l.startsWith('N'))).toBe(true);
  });

  it('adds start and end codes', () => {
    const lines = ['G1 X10 Y10'];
    const config = getDefaultPostProcessorConfig('marlin');
    const result = postProcessForMachine(lines, config);
    // Start code is '; Start\nG28 ; Home' — G28 should be somewhere in the early lines
    expect(result.some(l => l.includes('G28'))).toBe(true);
    expect(result[result.length - 1]).toContain('M84');
  });

  it('clamps feed rate', () => {
    const lines = ['G1 X10 Y10 F10000'];
    const config = getDefaultPostProcessorConfig('grbl');
    config.maxFeedRate = 5000;
    const result = postProcessForMachine(lines, config);
    expect(result.some(l => l.includes('F5000'))).toBe(true);
  });

  it('converts G0 to G1 when configured', () => {
    const lines = ['G0 X10 Y10'];
    const config = getDefaultPostProcessorConfig('generic');
    config.convertRapidToLinear = true;
    const result = postProcessForMachine(lines, config);
    expect(result.some(l => l.includes('G1'))).toBe(true);
  });

  it('returns default config for unknown machine', () => {
    const config = getDefaultPostProcessorConfig('unknown' as any);
    expect(config.machineType).toBe('generic');
  });
});

// ── 8. Pressure Advance ──

describe('analyzePressureAdvance', () => {
  it('detects Marlin M900 pressure advance', () => {
    const lines = ['M900 K0.04'];
    const result = analyzePressureAdvance(lines);
    expect(result.enabled).toBe(true);
    expect(result.value).toBe(0.04);
    expect(result.commandCount).toBe(1);
  });

  it('detects Klipper pressure advance', () => {
    const lines = ['SET_PRESSURE_ADVANCE ADVANCE=0.05'];
    const result = analyzePressureAdvance(lines);
    expect(result.enabled).toBe(true);
    expect(result.value).toBe(0.05);
  });

  it('detects RepRap M572', () => {
    const lines = ['M572 D0 S0.03'];
    const result = analyzePressureAdvance(lines);
    expect(result.enabled).toBe(true);
    expect(result.value).toBe(0.03);
  });

  it('handles no pressure advance', () => {
    const lines = ['G1 X10 Y10 F1800'];
    const result = analyzePressureAdvance(lines);
    expect(result.enabled).toBe(false);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('warns about high pressure advance', () => {
    const lines = ['M900 K0.2'];
    const result = analyzePressureAdvance(lines);
    const warning = result.recommendations.find(r => r.includes('high'));
    expect(warning).toBeDefined();
  });
});

// ── 9. Arc Fitting Optimization ──

describe('detectArcFittingCandidates', () => {
  it('detects arc patterns in linear segments', () => {
    // Generate points on a circle
    const lines: string[] = [];
    const cx = 50, cy = 50, r = 20;
    for (let i = 0; i <= 20; i++) {
      const angle = (i / 20) * Math.PI / 2; // quarter circle
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      lines.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)}`);
    }
    const result = detectArcFittingCandidates(lines, 0.01, 5);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.candidates[0].radius).toBeCloseTo(r, 1);
  });

  it('does not detect arcs in straight lines', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`G1 X${i * 10} Y0`);
    }
    const result = detectArcFittingCandidates(lines, 0.01, 5);
    expect(result.candidateCount).toBe(0);
  });

  it('handles empty input', () => {
    const result = detectArcFittingCandidates([]);
    expect(result.candidates).toEqual([]);
    expect(result.totalSegments).toBe(0);
  });
});

// ── 10. G-code Performance Profiling ──

describe('profileGcode', () => {
  it('profiles G-code execution time', () => {
    const lines = [
      'M3 S1000',
      'G1 X100 Y0 F1800',
      'G1 X100 Y100 F1800',
      'G4 P500',
      'M5',
      'M30',
    ];
    const result = profileGcode(lines);
    expect(result.totalTime).toBeGreaterThan(0);
    expect(result.timeByOperation.length).toBeGreaterThan(0);
  });

  it('identifies bottlenecks', () => {
    const lines: string[] = [];
    // Add many travel moves
    for (let i = 0; i < 50; i++) {
      lines.push(`G0 X${i * 100} Y0`);
    }
    const result = profileGcode(lines);
    expect(result.timeByOperation.length).toBeGreaterThan(0);
  });

  it('tracks slowest lines', () => {
    const lines = [
      'G1 X1000 Y0 F100',  // slow move
      'G1 X1010 Y0 F1800', // fast move
    ];
    const result = profileGcode(lines);
    expect(result.slowestLines.length).toBeGreaterThan(0);
    expect(result.slowestLines[0].time).toBeGreaterThan(0);
  });

  it('handles dwell time', () => {
    const lines = ['G4 P2000']; // 2 second dwell
    const result = profileGcode(lines);
    const dwellTime = result.timeByOperation.find(t => t.operation === 'dwell');
    expect(dwellTime).toBeDefined();
    expect(dwellTime!.time).toBe(2);
  });

  it('handles empty input', () => {
    const result = profileGcode([]);
    expect(result.totalTime).toBe(0);
    expect(result.entries).toEqual([]);
  });
});

// ── 11. Bead Geometry ──

describe('computeBeadGeometry', () => {
  it('computes bead geometry from parameters', () => {
    const result = computeBeadGeometry(0.2, 0.4, 1.75);
    expect(result.width).toBe(0.4);
    expect(result.height).toBe(0.2);
    expect(result.crossSectionArea).toBeGreaterThan(0);
    expect(result.extrusionPerMm).toBeGreaterThan(0);
  });

  it('computes shape factor', () => {
    const result = computeBeadGeometry(0.2, 0.4, 1.75);
    expect(result.shapeFactor).toBeGreaterThan(0);
    expect(result.shapeFactor).toBeLessThanOrEqual(1);
  });

  it('computes flatness ratio', () => {
    const result = computeBeadGeometry(0.2, 0.4, 1.75);
    expect(result.flatness).toBe(2); // 0.4/0.2 = 2
  });
});

describe('computeBeadFromMove', () => {
  it('computes bead from extrusion and distance', () => {
    const result = computeBeadFromMove(5, 100, 1.75);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.crossSectionArea).toBeGreaterThan(0);
  });

  it('handles zero distance', () => {
    const result = computeBeadFromMove(5, 0, 1.75);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('handles zero extrusion', () => {
    const result = computeBeadFromMove(0, 100, 1.75);
    expect(result.width).toBe(0);
  });
});

// ── 12. Revision History ──

describe('Revision History', () => {
  it('computes checksum', () => {
    const lines1 = ['G1 X10 Y10', 'G1 X20 Y20'];
    const lines2 = ['G1 X10 Y10', 'G1 X20 Y20'];
    const lines3 = ['G1 X10 Y10', 'G1 X30 Y30'];
    expect(computeGcodeChecksum(lines1)).toBe(computeGcodeChecksum(lines2));
    expect(computeGcodeChecksum(lines1)).not.toBe(computeGcodeChecksum(lines3));
  });

  it('creates revision entry', () => {
    const lines = ['G1 X10 Y10', 'M30'];
    const revision = createRevision(lines, 1, 'user', 'Initial version');
    expect(revision.revision).toBe(1);
    expect(revision.author).toBe('user');
    expect(revision.description).toBe('Initial version');
    expect(revision.checksum).toBeDefined();
    expect(revision.timestamp).toBeDefined();
  });

  it('diffs two G-code versions', () => {
    const oldLines = ['G1 X10 Y10', 'G1 X20 Y20', 'M30'];
    const newLines = ['G1 X10 Y10', 'G1 X30 Y30', 'M30'];
    const diff = diffGcodeRevisions(oldLines, newLines);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0].oldContent).toBe('G1 X20 Y20');
    expect(diff.modified[0].newContent).toBe('G1 X30 Y30');
    expect(diff.summary.totalChanges).toBe(1);
  });

  it('detects additions and deletions', () => {
    const oldLines = ['G1 X10 Y10', 'M30'];
    const newLines = ['G1 X10 Y10', 'G1 X20 Y20', 'M30'];
    const diff = diffGcodeRevisions(oldLines, newLines);
    expect(diff.added.length).toBe(1);
    expect(diff.summary.additions).toBe(1);
  });

  it('exports and imports revision history', () => {
    const revisions = [
      createRevision(['G1 X10'], 1, 'user', 'v1'),
      createRevision(['G1 X20'], 2, 'user', 'v2'),
    ];
    const json = exportRevisionHistory(revisions);
    expect(json).toContain('v1');
    expect(json).toContain('version');

    const imported = importRevisionHistory(json);
    expect(imported.length).toBe(2);
    expect(imported[0].description).toBe('v1');
  });

  it('handles empty revision history import', () => {
    const json = '{"version":"1.0","revisions":[]}';
    expect(importRevisionHistory(json)).toEqual([]);
  });
});
