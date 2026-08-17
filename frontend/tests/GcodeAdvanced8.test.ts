/**
 * @file GcodeAdvanced8.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced8 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  trackModalStates,
  analyzeDwellTime,
  check3DPSafety,
  analyzeCurvature,
  recognizeFeatures,
  analyzeSpindlePower,
  analyzeMultiPart,
  checkFixtureClearance,
  analyzeBedAdhesion,
  transformCoordinates,
  optimizeCycleTime,
  checkGcodeCompatibility,
} from "@tether/gcode-analyzer/GcodeAdvanced8";
import type { Fixture } from "@tether/gcode-analyzer/GcodeAdvanced8";

// ── 1. Modal State Tracker ──

describe('trackModalStates', () => {
  it('tracks default initial state', () => {
    const result = trackModalStates([]);
    expect(result.finalState.motionMode).toBe('G0');
    expect(result.finalState.plane).toBe('G17');
    expect(result.finalState.distanceMode).toBe('G90');
    expect(result.finalState.units).toBe('G21');
  });

  it('records state changes', () => {
    const lines = ['G90 G21', 'G1 X10 Y10 F500', 'G91', 'G20'];
    const result = trackModalStates(lines);
    expect(result.changes.length).toBeGreaterThan(0);
    const distChange = result.changes.find(c => c.property === 'distanceMode');
    expect(distChange).toBeDefined();
    expect(distChange!.newValue).toBe('G91');
  });

  it('detects improper reset', () => {
    const lines = ['G41 D1', 'M3 S1000', 'M8'];
    const result = trackModalStates(lines);
    expect(result.isProperlyReset).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('detects proper reset', () => {
    const lines = ['G41 D1', 'M3 S1000', 'M8', 'G40', 'M5', 'M9'];
    const result = trackModalStates(lines);
    expect(result.isProperlyReset).toBe(true);
  });

  it('warns about inch mode at end', () => {
    const lines = ['G20'];
    const result = trackModalStates(lines);
    const warning = result.warnings.find(w => w.includes('inch'));
    expect(warning).toBeDefined();
  });

  it('counts changes by property', () => {
    const lines = ['G91', 'G90', 'G91', 'G90'];
    const result = trackModalStates(lines);
    expect(result.changeCounts['distanceMode']).toBe(4);
  });
});

// ── 2. Dwell Time Analysis ──

describe('analyzeDwellTime', () => {
  it('detects G4 dwell commands', () => {
    const lines = ['G4 P1000', 'G1 X10 Y10 F500', 'G4 P500'];
    const result = analyzeDwellTime(lines);
    expect(result.eventCount).toBe(2);
    expect(result.totalDwellTime).toBe(1500);
  });

  it('handles X format dwell', () => {
    const lines = ['G4 X2.5'];
    const result = analyzeDwellTime(lines);
    expect(result.eventCount).toBe(1);
    expect(result.events[0].format).toBe('X');
    expect(result.events[0].duration).toBe(2.5);
  });

  it('computes dwell percentage', () => {
    const lines = ['G4 P600', 'G1 X10 Y10 F500'];
    const result = analyzeDwellTime(lines, 6000);
    expect(result.dwellPercentage).toBe(10);
  });

  it('computes dwell cost', () => {
    const lines = ['G4 P3600'];
    const result = analyzeDwellTime(lines, 3600, 60);
    expect(result.dwellCost).toBeGreaterThan(0);
  });

  it('handles no dwell commands', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = analyzeDwellTime(lines);
    expect(result.eventCount).toBe(0);
    expect(result.totalDwellTime).toBe(0);
  });

  it('provides recommendations for long dwells', () => {
    const lines = ['G4 P10'];
    const result = analyzeDwellTime(lines, 50);
    const rec = result.recommendations.find(r => r.includes('long'));
    expect(rec).toBeDefined();
  });
});

// ── 3. 3DP Safety Check ──

describe('check3DPSafety', () => {
  it('detects missing homing', () => {
    const lines = ['M104 S210', 'M140 S60', 'G1 X10 Y10 E5 F1800'];
    const result = check3DPSafety(lines);
    const homingIssue = result.issues.find(i => i.type === 'no_homing');
    expect(homingIssue).toBeDefined();
  });

  it('detects cold extrusion', () => {
    const lines = ['G28', 'G1 X10 Y10 E5 F1800', 'M104 S210'];
    const result = check3DPSafety(lines);
    const coldIssue = result.issues.find(i => i.type === 'cold_extrusion');
    expect(coldIssue).toBeDefined();
    expect(coldIssue!.severity).toBe('critical');
  });

  it('detects safe G-code', () => {
    const lines = [
      'G28', 'G29', 'M104 S210', 'M109 S210', 'M140 S60', 'M190 S60',
      'M106 S128', 'G1 X10 Y10 E5 F1800', 'M84',
    ];
    const result = check3DPSafety(lines);
    expect(result.isSafe).toBe(true);
    expect(result.safetyScore).toBeGreaterThan(80);
  });

  it('detects missing auto-level', () => {
    const lines = ['G28', 'M104 S210', 'G1 X10 Y10 E5 F1800'];
    const result = check3DPSafety(lines);
    const levelIssue = result.issues.find(i => i.type === 'no_autolevel');
    expect(levelIssue).toBeDefined();
  });

  it('detects high first layer speed', () => {
    const lines = ['G28', 'M104 S210', 'G1 X10 Y10 E5 F4200'];
    const result = check3DPSafety(lines);
    const speedIssue = result.issues.find(i => i.type === 'high_speed_first_layer');
    expect(speedIssue).toBeDefined();
  });

  it('computes safety score', () => {
    const lines = ['G28', 'M104 S210', 'M140 S60', 'G1 X10 Y10 E5 F1800', 'M84'];
    const result = check3DPSafety(lines);
    expect(result.safetyScore).toBeGreaterThan(0);
    expect(result.safetyScore).toBeLessThanOrEqual(100);
  });
});

// ── 4. Toolpath Curvature Analysis ──

describe('analyzeCurvature', () => {
  it('analyzes straight line curvature', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(`G1 X${i * 10} Y0`);
    }
    const result = analyzeCurvature(lines);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.avgCurvature).toBeCloseTo(0, 5);
    expect(result.smoothnessScore).toBe(100);
  });

  it('detects sharp turns', () => {
    const lines = [
      'G1 X10 Y0',
      'G1 X10 Y10',  // 90° turn
      'G1 X0 Y10',   // 90° turn
    ];
    const result = analyzeCurvature(lines, 60);
    expect(result.sharpTurnCount).toBeGreaterThan(0);
  });

  it('computes minimum radius', () => {
    const lines = ['G1 X10 Y0', 'G1 X10 Y10', 'G1 X20 Y10'];
    const result = analyzeCurvature(lines);
    expect(result.minRadius).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = analyzeCurvature([]);
    expect(result.segments).toEqual([]);
    expect(result.smoothnessScore).toBe(100);
  });

  it('provides recommendations for sharp turns', () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`G1 X${i % 2 === 0 ? 10 : 0} Y${i * 5}`);
    }
    const result = analyzeCurvature(lines);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});

// ── 5. Feature Recognition ──

describe('recognizeFeatures', () => {
  it('detects circular holes', () => {
    const lines: string[] = [];
    const cx = 50, cy = 50, r = 10;
    for (let i = 0; i <= 30; i++) {
      const angle = (i / 30) * 2 * Math.PI;
      lines.push(`G1 X${(cx + r * Math.cos(angle)).toFixed(4)} Y${(cy + r * Math.sin(angle)).toFixed(4)} Z-2`);
    }
    const result = recognizeFeatures(lines);
    expect(result.features.length).toBeGreaterThan(0);
    expect(result.features.some(f => f.type === 'hole')).toBe(true);
  });

  it('detects pockets', () => {
    const lines: string[] = [];
    // Raster pattern at constant Z
    for (let i = 0; i < 20; i++) {
      const x = (i % 2 === 0) ? 0 : 20;
      const y = Math.floor(i / 2) * 2;
      lines.push(`G1 X${x} Y${y} Z-3`);
    }
    const result = recognizeFeatures(lines);
    expect(result.totalFeatures).toBeGreaterThan(0);
  });

  it('counts features by type', () => {
    const lines: string[] = [];
    const cx = 50, cy = 50, r = 10;
    for (let i = 0; i <= 30; i++) {
      const angle = (i / 30) * 2 * Math.PI;
      lines.push(`G1 X${(cx + r * Math.cos(angle)).toFixed(4)} Y${(cy + r * Math.sin(angle)).toFixed(4)} Z-2`);
    }
    const result = recognizeFeatures(lines);
    expect(result.counts['hole']).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = recognizeFeatures([]);
    expect(result.features).toEqual([]);
    expect(result.hasFeatures).toBe(false);
  });
});

// ── 6. Spindle Power/Torque Analysis ──

describe('analyzeSpindlePower', () => {
  it('analyzes spindle power for cutting moves', () => {
    const lines = ['M3 S5000', 'G1 X100 Y0 Z-2 F500'];
    const result = analyzeSpindlePower(lines, 750, 3000, 6, 2, 3);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0].rpm).toBe(5000);
  });

  it('computes power utilization', () => {
    const lines = ['M3 S5000', 'G1 X100 Y0 Z-2 F500'];
    const result = analyzeSpindlePower(lines);
    expect(result.segments[0].powerUtilization).toBeGreaterThan(0);
  });

  it('detects overload conditions', () => {
    const lines = ['M3 S100', 'G1 X100 Y0 Z-10 F2000'];
    const result = analyzeSpindlePower(lines, 100, 3000, 10, 10, 10);
    // Low RPM with high MRR should overload
    const overload = result.segments.find(s => s.status === 'overload');
    expect(overload).toBeDefined();
  });

  it('provides recommendations', () => {
    const lines = ['M3 S100', 'G1 X100 Y0 Z-10 F2000'];
    const result = analyzeSpindlePower(lines, 100, 3000, 10, 10, 10);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('handles no cutting moves', () => {
    const lines = ['G0 X10 Y10 Z5'];
    const result = analyzeSpindlePower(lines);
    expect(result.segments).toEqual([]);
  });
});

// ── 7. Multi-Part Analysis ──

describe('analyzeMultiPart', () => {
  it('detects single part', () => {
    const lines = ['G1 X10 Y10 Z-2 F500', 'G1 X50 Y50 Z-2 F500'];
    const result = analyzeMultiPart(lines);
    expect(result.isMultiPart).toBe(false);
    expect(result.partCount).toBeLessThanOrEqual(1);
  });

  it('detects multiple parts via rapid moves', () => {
    const lines: string[] = [];
    // Part 1 — need >10 moves
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${10 + i} Y${10 + i} Z-2 F500`);
    }
    // Rapid to new location at safe Z
    lines.push('G0 X200 Y200 Z10');
    // Part 2 — need >10 moves
    for (let i = 0; i < 15; i++) {
      lines.push(`G1 X${110 + i} Y${110 + i} Z-2 F500`);
    }
    const result = analyzeMultiPart(lines);
    expect(result.partCount).toBeGreaterThan(1);
    expect(result.isMultiPart).toBe(true);
  });

  it('computes total time', () => {
    const lines = ['G1 X100 Y0 Z-2 F500'];
    const result = analyzeMultiPart(lines);
    if (result.parts.length > 0) {
      expect(result.totalTime).toBeGreaterThan(0);
    }
  });

  it('handles empty input', () => {
    const result = analyzeMultiPart([]);
    expect(result.parts).toEqual([]);
    expect(result.partCount).toBe(0);
  });
});

// ── 8. Fixture Clearance Check ──

describe('checkFixtureClearance', () => {
  const fixtures: Fixture[] = [
    { name: 'Clamp1', type: 'clamp', position: { x: 50, y: 0, z: 0 }, size: { width: 20, depth: 10, height: 30 } },
  ];

  it('detects clearance violations', () => {
    const lines = ['G1 X45 Y0 Z10 F500']; // Very close to clamp
    const result = checkFixtureClearance(lines, fixtures, 5);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('passes when clearance is sufficient', () => {
    const lines = ['G1 X0 Y0 Z50 F500']; // Far from clamp
    const result = checkFixtureClearance(lines, fixtures, 2);
    expect(result.isClear).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('classifies severity', () => {
    const lines = ['G1 X50 Y0 Z5 F500']; // Inside clamp
    const result = checkFixtureClearance(lines, fixtures, 5);
    const error = result.violations.find(v => v.severity === 'error');
    expect(error).toBeDefined();
  });

  it('computes closest approach', () => {
    const lines = ['G1 X30 Y0 Z15 F500'];
    const result = checkFixtureClearance(lines, fixtures, 2);
    expect(result.closestApproach).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = checkFixtureClearance([], fixtures);
    expect(result.violations).toEqual([]);
    expect(result.isClear).toBe(true);
  });
});

// ── 9. Bed Adhesion Pattern Analysis ──

describe('analyzeBedAdhesion', () => {
  it('analyzes first layer', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      'G1 X50 Y10 E10 F1800',
      'G1 X50 Y50 E15 F1800',
      ';LAYER:1',
      'G1 X10 Y10 E20 F1800',
    ];
    const result = analyzeBedAdhesion(lines);
    expect(result.coveragePercentage).toBeGreaterThanOrEqual(0);
  });

  it('detects brim pattern', () => {
    const lines = [
      ';LAYER:0',
      ';TYPE:BRIM',
      'G1 X10 Y10 E5 F1800',
      'G1 X50 Y10 E10 F1800',
      ';LAYER:1',
      'G1 X10 Y10 E15 F1800',
    ];
    const result = analyzeBedAdhesion(lines);
    expect(result.brimCount).toBeGreaterThan(0);
  });

  it('computes adhesion score', () => {
    const lines = [
      ';LAYER:0',
      'G1 X10 Y10 E5 F1800',
      'G1 X50 Y50 E10 F1800',
      ';LAYER:1',
      'G1 X10 Y10 E15 F1800',
    ];
    const result = analyzeBedAdhesion(lines);
    expect(result.adhesionScore).toBeGreaterThanOrEqual(0);
    expect(result.adhesionScore).toBeLessThanOrEqual(100);
  });

  it('handles no layers', () => {
    const lines = ['G1 X10 Y10 E5 F1800'];
    const result = analyzeBedAdhesion(lines);
    expect(result.pattern).toBeDefined();
  });
});

// ── 10. Coordinate System Transform ──

describe('transformCoordinates', () => {
  it('translates coordinates', () => {
    const lines = ['G1 X10 Y10 Z5 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 50, offsetY: 50, offsetZ: 0,
      rotation: 0, scale: 1, mirrorX: false, mirrorY: false,
    });
    expect(result.transformedCount).toBeGreaterThan(0);
    expect(result.lines[0]).toContain('X60');
    expect(result.lines[0]).toContain('Y60');
  });

  it('scales coordinates', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 0, offsetY: 0, offsetZ: 0,
      rotation: 0, scale: 2, mirrorX: false, mirrorY: false,
    });
    expect(result.lines[0]).toContain('X20');
    expect(result.lines[0]).toContain('Y20');
  });

  it('mirrors X coordinates', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 0, offsetY: 0, offsetZ: 0,
      rotation: 0, scale: 1, mirrorX: true, mirrorY: false,
    });
    expect(result.lines[0]).toContain('X-10');
  });

  it('rotates coordinates', () => {
    const lines = ['G1 X10 Y0 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 0, offsetY: 0, offsetZ: 0,
      rotation: 90, scale: 1, mirrorX: false, mirrorY: false,
    });
    // 90° rotation: (10, 0) → (0, 10)
    expect(result.lines[0]).toContain('X0.0000');
    expect(result.lines[0]).toContain('Y10.0000');
  });

  it('computes bounds', () => {
    const lines = ['G1 X10 Y10 F500', 'G1 X50 Y50 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 100, offsetY: 100, offsetZ: 0,
      rotation: 0, scale: 1, mirrorX: false, mirrorY: false,
    });
    expect(result.originalBounds.minX).toBe(10);
    expect(result.transformedBounds.minX).toBe(110);
  });

  it('preserves comments', () => {
    const lines = ['; this is a comment', 'G1 X10 Y10 F500'];
    const result = transformCoordinates(lines, {
      offsetX: 0, offsetY: 0, offsetZ: 0,
      rotation: 0, scale: 1, mirrorX: false, mirrorY: false,
    });
    expect(result.lines[0]).toBe('; this is a comment');
  });
});

// ── 11. Cycle Time Optimization ──

describe('optimizeCycleTime', () => {
  it('suggests travel speed increases', () => {
    const lines = ['G0 X100 Y0 F3000'];
    const result = optimizeCycleTime(lines, {
      maxFeedRate: 6000, minQualityFeedRate: 1800,
      maxAcceleration: 3000, optimizeTravels: true,
      reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.5,
    });
    const travelOpt = result.suggestions.find(s => s.type === 'optimize_travel');
    expect(travelOpt).toBeDefined();
  });

  it('suggests dwell reductions', () => {
    const lines = ['G4 P5'];
    const result = optimizeCycleTime(lines, {
      maxFeedRate: 6000, minQualityFeedRate: 1800,
      maxAcceleration: 3000, optimizeTravels: true,
      reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.5,
    });
    const dwellOpt = result.suggestions.find(s => s.type === 'reduce_dwell');
    expect(dwellOpt).toBeDefined();
    expect(dwellOpt!.timeSavings).toBe(4);
  });

  it('computes total time savings', () => {
    const lines = ['G4 P5', 'G0 X100 Y0 F3000'];
    const result = optimizeCycleTime(lines, {
      maxFeedRate: 6000, minQualityFeedRate: 1800,
      maxAcceleration: 3000, optimizeTravels: true,
      reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.5,
    });
    expect(result.totalTimeSavings).toBeGreaterThan(0);
  });

  it('computes savings percentage', () => {
    const lines = ['G4 P10'];
    const result = optimizeCycleTime(lines, {
      maxFeedRate: 6000, minQualityFeedRate: 1800,
      maxAcceleration: 3000, optimizeTravels: true,
      reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.5,
    });
    expect(result.savingsPercentage).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = optimizeCycleTime([], {
      maxFeedRate: 6000, minQualityFeedRate: 1800,
      maxAcceleration: 3000, optimizeTravels: true,
      reduceDwells: true, maxDwellTime: 1, qualityPriority: 0.5,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.totalTimeSavings).toBe(0);
  });
});

// ── 12. G-code Dialect/Compatibility Checker ──

describe('checkGcodeCompatibility', () => {
  it('checks Fanuc compatibility', () => {
    const lines = ['G1 X10 Y10 F500', 'M30'];
    const result = checkGcodeCompatibility(lines, 'fanuc');
    expect(result.isCompatible).toBe(true);
    expect(result.compatibilityScore).toBe(100);
  });

  it('detects unsupported macros for GRBL', () => {
    const lines = ['#100 = 10.0', 'G1 X#100 Y10 F500'];
    const result = checkGcodeCompatibility(lines, 'grbl');
    const macroIssue = result.issues.find(i => i.description.includes('Macro'));
    expect(macroIssue).toBeDefined();
    expect(result.isCompatible).toBe(false);
  });

  it('detects unsupported subprograms for GRBL', () => {
    const lines = ['M98 P100'];
    const result = checkGcodeCompatibility(lines, 'grbl');
    const subIssue = result.issues.find(i => i.description.includes('Subprogram'));
    expect(subIssue).toBeDefined();
  });

  it('detects unsupported arcs for Marlin', () => {
    const lines = ['G2 X10 Y10 I5 J0'];
    const result = checkGcodeCompatibility(lines, 'marlin');
    const arcIssue = result.issues.find(i => i.description.includes('Arc'));
    expect(arcIssue).toBeDefined();
  });

  it('detects unsupported drilling cycles for GRBL', () => {
    const lines = ['G81 X10 Y10 Z-5 R2 F100'];
    const result = checkGcodeCompatibility(lines, 'grbl');
    const drillIssue = result.issues.find(i => i.description.includes('Drilling'));
    expect(drillIssue).toBeDefined();
  });

  it('handles unknown controller', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = checkGcodeCompatibility(lines, 'unknown');
    expect(result.isCompatible).toBe(false);
    expect(result.compatibilityScore).toBe(0);
  });

  it('lists supported features', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = checkGcodeCompatibility(lines, 'fanuc');
    expect(result.supportedFeatures).toContain('macros');
    expect(result.supportedFeatures).toContain('arcs');
  });

  it('passes compatible G-code for LinuxCNC', () => {
    const lines = ['G1 X10 Y10 F500', 'G2 X20 Y20 I5 J5', 'M30'];
    const result = checkGcodeCompatibility(lines, 'linuxcnc');
    expect(result.isCompatible).toBe(true);
  });
});
