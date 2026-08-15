/**
 * @file GcodeAdvanced14.test.ts
 * @brief Comprehensive tests for the GcodeAdvanced14 module (12 additional features).
 */

import { describe, it, expect } from 'vitest';
import {
  highlightGcodeSyntax,
  predictToolDeflectionAdvanced,
  generateStringingRiskMap,
  previewMacroExpansion,
  predictSurfaceRoughness,
  simulateWarping,
  detectCollisions3D,
  calculateToolLife,
  analyzeInfillPattern,
  computeBounds,
  simulateCuttingForces,
  optimizeRetractions,
} from '../src/core/GcodeAdvanced14';

// ── 1. Syntax Highlighter ──

describe('highlightGcodeSyntax', () => {
  it('tokenizes G-code commands', () => {
    const result = highlightGcodeSyntax(['G1 X10 Y10 F500']);
    expect(result.tokens.some(t => t.type === 'command' || t.type === 'modal')).toBe(true);
  });

  it('tokenizes comments', () => {
    const result = highlightGcodeSyntax(['; this is a comment', 'G1 X10 (inline comment)']);
    expect(result.tokens.some(t => t.type === 'comment')).toBe(true);
  });

  it('tokenizes axis values', () => {
    const result = highlightGcodeSyntax(['G1 X10.5 Y-20 F500']);
    expect(result.tokens.some(t => t.type === 'axis')).toBe(true);
    expect(result.tokens.some(t => t.type === 'value')).toBe(true);
  });

  it('provides CSS classes', () => {
    const result = highlightGcodeSyntax(['G1 X10']);
    expect(result.cssClasses.command).toBeDefined();
    expect(result.cssClasses.comment).toBeDefined();
  });

  it('handles empty input', () => {
    const result = highlightGcodeSyntax([]);
    expect(result.tokens).toEqual([]);
  });
});

// ── 2. Tool Deflection Prediction ──

describe('predictToolDeflectionAdvanced', () => {
  it('predicts deflection for cutting operations', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = predictToolDeflectionAdvanced(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes max deflection', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-2 F1000', 'G1 X20 Y0 Z-2 F1000'];
    const result = predictToolDeflectionAdvanced(lines);
    expect(result.maxDeflection).toBeGreaterThan(0);
  });

  it('computes deflection score', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = predictToolDeflectionAdvanced(lines);
    expect(result.deflectionScore).toBeGreaterThanOrEqual(0);
    expect(result.deflectionScore).toBeLessThanOrEqual(100);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = predictToolDeflectionAdvanced(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 3. Stringing Risk Map ──

describe('generateStringingRiskMap', () => {
  it('generates risk grid', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G0 X50 Y50', 'G1 X60 Y60 E10 F1800'];
    const result = generateStringingRiskMap(lines, 5);
    expect(result.cells.length).toBe(25);
  });

  it('detects travel without retraction', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G0 X50 Y50', 'G1 X60 Y60 E10 F1800'];
    const result = generateStringingRiskMap(lines, 5);
    expect(result.totalTravelWithoutRetraction).toBeGreaterThan(0);
  });

  it('handles no travel moves', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = generateStringingRiskMap(lines);
    expect(result.overallRisk).toBe('low');
  });
});

// ── 4. Macro Expansion Preview ──

describe('previewMacroExpansion', () => {
  it('finds macro definitions', () => {
    const lines = ['#define DRILL(x, y) G81 X{x} Y{y} Z-5 R2', 'DRILL(10, 20)'];
    const result = previewMacroExpansion(lines);
    expect(result.definitions.length).toBeGreaterThan(0);
  });

  it('expands macro calls', () => {
    const lines = ['#define DRILL(x, y) G81 X{x} Y{y} Z-5', 'DRILL(10, 20)'];
    const result = previewMacroExpansion(lines);
    expect(result.expansions.length).toBeGreaterThan(0);
  });

  it('handles no macros', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = previewMacroExpansion(lines);
    expect(result.hasMacros).toBe(false);
  });
});

// ── 5. Surface Roughness Prediction ──

describe('predictSurfaceRoughness', () => {
  it('predicts roughness for finishing passes', () => {
    const lines = ['M3 S8000', 'G1 X10 Y0 Z-0.5 F500'];
    const result = predictSurfaceRoughness(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes Ra values', () => {
    const lines = ['M3 S8000', 'G1 X10 Y0 Z-0.5 F500'];
    const result = predictSurfaceRoughness(lines);
    expect(result.avgRa).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = predictSurfaceRoughness(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 6. Warping Simulation ──

describe('simulateWarping', () => {
  it('simulates warping', () => {
    const lines = ['M140 S60', 'M104 S200', 'G1 X10 Y10 E5 F1800 Z0.2', 'G1 X20 Y20 E10 F1800 Z0.4'];
    const result = simulateWarping(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes max warping', () => {
    const lines = ['M140 S60', 'M104 S200', 'G1 X10 Y10 E5 F1800 Z0.2'];
    const result = simulateWarping(lines);
    expect(result.maxWarping).toBeGreaterThanOrEqual(0);
  });

  it('handles no extrusion', () => {
    const lines = ['G0 X10 Y10'];
    const result = simulateWarping(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 7. Collision Detection 3D ──

describe('detectCollisions3D', () => {
  it('detects rapid collisions with stock', () => {
    const stockBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 0 };
    const lines = ['G0 X50 Y50 Z-5'];
    const result = detectCollisions3D(lines, stockBounds, 10);
    expect(result.events.some(e => e.type === 'rapid_collision')).toBe(true);
  });

  it('detects clearance violations', () => {
    const lines = ['G0 X50 Y50 Z5'];
    const result = detectCollisions3D(lines, null, 10);
    expect(result.events.some(e => e.type === 'clearance_violation')).toBe(true);
  });

  it('passes safe G-code', () => {
    const stockBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: -10, maxZ: 0 };
    const lines = ['G0 X50 Y50 Z20', 'G1 X60 Y60 Z-1 F500'];
    const result = detectCollisions3D(lines, stockBounds, 10);
    expect(result.hasCollisions).toBe(false);
  });

  it('computes safety score', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = detectCollisions3D(lines);
    expect(result.safetyScore).toBeGreaterThanOrEqual(0);
    expect(result.safetyScore).toBeLessThanOrEqual(100);
  });
});

// ── 8. Tool Life Calculator ──

describe('calculateToolLife', () => {
  it('calculates tool life from RPM', () => {
    const lines = ['T1 M6', 'M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = calculateToolLife(lines);
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('computes Taylor tool life', () => {
    const lines = ['T1 M6', 'M3 S5000', 'G1 X10 Y10 Z-1 F500'];
    const result = calculateToolLife(lines);
    expect(result.tools[0].toolLifeMinutes).toBeGreaterThan(0);
  });

  it('handles no tools', () => {
    const lines = ['G1 X10 Y10 F500'];
    const result = calculateToolLife(lines);
    expect(result.tools).toEqual([]);
  });
});

// ── 9. Infill Pattern Analyzer ──

describe('analyzeInfillPattern', () => {
  it('detects infill pattern', () => {
    const lines: string[] = [];
    // Create a grid pattern
    for (let y = 0; y <= 50; y += 10) {
      lines.push(`G1 X0 Y${y} E5 F1800`);
      lines.push(`G1 X50 Y${y} E10 F1800`);
    }
    const result = analyzeInfillPattern(lines);
    expect(result.hasInfill).toBe(true);
  });

  it('computes density', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y10 E10 F1800'];
    const result = analyzeInfillPattern(lines);
    expect(result.pattern.density).toBeGreaterThanOrEqual(0);
  });

  it('handles no infill', () => {
    const lines = ['G0 X10 Y10'];
    const result = analyzeInfillPattern(lines);
    expect(result.hasInfill).toBe(false);
  });
});

// ── 10. Bounds Calculator ──

describe('computeBounds', () => {
  it('computes bounds from motion', () => {
    const lines = ['G1 X10 Y20 Z-5 F500', 'G1 X50 Y60 Z-10 F500'];
    const result = computeBounds(lines);
    expect(result.valid).toBe(true);
    expect(result.x.min).toBe(10);
    expect(result.x.max).toBe(50);
  });

  it('computes center point', () => {
    const lines = ['G1 X0 Y0 Z0 F500', 'G1 X100 Y100 Z10 F500'];
    const result = computeBounds(lines);
    expect(result.center.x).toBe(50);
    expect(result.center.y).toBe(50);
  });

  it('adds margin', () => {
    const lines = ['G1 X10 Y10 Z0 F500', 'G1 X20 Y20 Z5 F500'];
    const result = computeBounds(lines, 5);
    expect(result.withMargin.bounds.minX).toBe(5);
    expect(result.withMargin.bounds.maxX).toBe(25);
  });

  it('handles no motion', () => {
    const result = computeBounds([]);
    expect(result.valid).toBe(false);
  });
});

// ── 11. Cutting Force Simulator ──

describe('simulateCuttingForces', () => {
  it('simulates cutting forces', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500', 'G1 X20 Y0 Z-1 F500'];
    const result = simulateCuttingForces(lines);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('computes force components', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-1 F500'];
    const result = simulateCuttingForces(lines);
    expect(result.points[0].tangentialForce).toBeGreaterThan(0);
    expect(result.points[0].resultantForce).toBeGreaterThan(0);
  });

  it('computes required power', () => {
    const lines = ['M3 S5000', 'G1 X10 Y0 Z-2 F1000'];
    const result = simulateCuttingForces(lines);
    expect(result.requiredPower).toBeGreaterThan(0);
  });

  it('handles no cutting', () => {
    const lines = ['G0 X10 Y0'];
    const result = simulateCuttingForces(lines);
    expect(result.points).toEqual([]);
  });
});

// ── 12. Retraction Optimization ──

describe('optimizeRetractions', () => {
  it('detects retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800', 'G1 X20 Y20 E8 F1800'];
    const result = optimizeRetractions(lines);
    expect(result.retractionCount).toBeGreaterThan(0);
  });

  it('computes average retraction distance', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E3 F1800'];
    const result = optimizeRetractions(lines);
    expect(result.avgRetractionDistance).toBeGreaterThan(0);
  });

  it('generates recommendations', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X10 Y10 E1 F1800', 'G1 X20 Y20 E6 F1800'];
    const result = optimizeRetractions(lines, 'PETG');
    expect(result.advice.length).toBeGreaterThan(0);
  });

  it('handles no retractions', () => {
    const lines = ['G1 X10 Y10 E5 F1800', 'G1 X20 Y20 E10 F1800'];
    const result = optimizeRetractions(lines);
    expect(result.retractionCount).toBe(0);
  });
});
