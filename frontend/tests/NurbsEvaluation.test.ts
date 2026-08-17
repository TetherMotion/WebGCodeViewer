/**
 * @file NurbsEvaluation.test.ts
 * @brief Tests for NURBS evaluation (De Boor's algorithm) and
 *        tessellation logic.
 *
 * These tests verify that the De Boor's algorithm implementation
 * correctly evaluates NURBS curves at various parameter values,
 * and that tessellation produces the right number of points.
 */

import { describe, it, expect } from 'vitest';
import { evaluateNurbs, tessellatePiece, NBPPiece } from "@tether/viewer-core";

// ─── Helper: Create a simple linear NURBS (degree 1) ───────────────────

function makeLinearPiece(start: number[], end: number[]): NBPPiece {
  const dim = start.length;
  return {
    degree: 1,
    controlPoints: [...start, ...end],
    weights: [1, 1],
    knots: [0, 0, 1, 1],
    motionType: 0,
    deviation: 0,
    extruderSpeed: 0,
  };
}

// ─── Helper: Create a quadratic NURBS (degree 2) ───────────────────────

function makeQuadraticPiece(): NBPPiece {
  // A simple quadratic Bezier curve in 2D
  // Control points: (0,0), (0.5, 1), (1, 0)
  return {
    degree: 2,
    controlPoints: [0, 0, 0.5, 1, 1, 0],
    weights: [1, 1, 1],
    knots: [0, 0, 0, 1, 1, 1],
    motionType: 0,
    deviation: 0,
    extruderSpeed: 0,
  };
}

// ─── Helper: Create a cubic NURBS (degree 3) ───────────────────────────

function makeCubicPiece(): NBPPiece {
  // A cubic Bezier curve in 3D
  // Control points: (0,0,0), (0,1,0), (1,1,0), (1,0,0)
  return {
    degree: 3,
    controlPoints: [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
    weights: [1, 1, 1, 1],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    motionType: 0,
    deviation: 0,
    extruderSpeed: 0,
  };
}

// ─── Linear NURBS Tests ────────────────────────────────────────────────

describe('Linear NURBS evaluation (degree 1)', () => {
  it('evaluates to start point at u=0', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 0, 0]);
    const pt = evaluateNurbs(piece, 0, 3);
    expect(pt[0]).toBeCloseTo(0, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
    expect(pt[2]).toBeCloseTo(0, 5);
  });

  it('evaluates to end point at u=1', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 0, 0]);
    const pt = evaluateNurbs(piece, 1, 3);
    expect(pt[0]).toBeCloseTo(10, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
    expect(pt[2]).toBeCloseTo(0, 5);
  });

  it('evaluates to midpoint at u=0.5', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 20, 30]);
    const pt = evaluateNurbs(piece, 0.5, 3);
    expect(pt[0]).toBeCloseTo(5, 5);
    expect(pt[1]).toBeCloseTo(10, 5);
    expect(pt[2]).toBeCloseTo(15, 5);
  });

  it('interpolates linearly along the curve', () => {
    const piece = makeLinearPiece([0, 0, 0], [100, 0, 0]);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const pt = evaluateNurbs(piece, u, 3);
      expect(pt[0]).toBeCloseTo(100 * u, 3);
    }
  });
});

// ─── Quadratic NURBS Tests ─────────────────────────────────────────────

describe('Quadratic NURBS evaluation (degree 2)', () => {
  it('evaluates to first control point at u=0', () => {
    const piece = makeQuadraticPiece();
    const pt = evaluateNurbs(piece, 0, 2);
    expect(pt[0]).toBeCloseTo(0, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
  });

  it('evaluates to last control point at u=1', () => {
    const piece = makeQuadraticPiece();
    const pt = evaluateNurbs(piece, 1, 2);
    expect(pt[0]).toBeCloseTo(1, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
  });

  it('evaluates to midpoint correctly for quadratic Bezier', () => {
    // Quadratic Bezier at t=0.5: B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
    // = 0.25*(0,0) + 0.5*(0.5,1) + 0.25*(1,0) = (0.5, 0.5)
    const piece = makeQuadraticPiece();
    const pt = evaluateNurbs(piece, 0.5, 2);
    expect(pt[0]).toBeCloseTo(0.5, 4);
    expect(pt[1]).toBeCloseTo(0.5, 4);
  });

  it('curve stays within convex hull of control points', () => {
    const piece = makeQuadraticPiece();
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      const pt = evaluateNurbs(piece, u, 2);
      // X should be between 0 and 1
      expect(pt[0]).toBeGreaterThanOrEqual(-0.001);
      expect(pt[0]).toBeLessThanOrEqual(1.001);
      // Y should be between 0 and 1
      expect(pt[1]).toBeGreaterThanOrEqual(-0.001);
      expect(pt[1]).toBeLessThanOrEqual(1.001);
    }
  });
});

// ─── Cubic NURBS Tests ─────────────────────────────────────────────────

describe('Cubic NURBS evaluation (degree 3)', () => {
  it('evaluates to first control point at u=0', () => {
    const piece = makeCubicPiece();
    const pt = evaluateNurbs(piece, 0, 3);
    expect(pt[0]).toBeCloseTo(0, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
    expect(pt[2]).toBeCloseTo(0, 5);
  });

  it('evaluates to last control point at u=1', () => {
    const piece = makeCubicPiece();
    const pt = evaluateNurbs(piece, 1, 3);
    expect(pt[0]).toBeCloseTo(1, 5);
    expect(pt[1]).toBeCloseTo(0, 5);
    expect(pt[2]).toBeCloseTo(0, 5);
  });

  it('evaluates midpoint correctly for cubic Bezier', () => {
    // Cubic Bezier at t=0.5: B(0.5) = 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
    // P0=(0,0,0), P1=(0,1,0), P2=(1,1,0), P3=(1,0,0)
    // = 0.125*(0,0,0) + 0.375*(0,1,0) + 0.375*(1,1,0) + 0.125*(1,0,0)
    // = (0.5, 0.75, 0)
    const piece = makeCubicPiece();
    const pt = evaluateNurbs(piece, 0.5, 3);
    expect(pt[0]).toBeCloseTo(0.5, 4);
    expect(pt[1]).toBeCloseTo(0.75, 4);
    expect(pt[2]).toBeCloseTo(0, 4);
  });
});

// ─── Tessellation Tests ────────────────────────────────────────────────

describe('NURBS tessellation', () => {
  it('linear piece produces 2 points (start + end)', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 0, 0]);
    const positions = tessellatePiece(piece, 3, 1);
    expect(positions.length).toBe(2 * 3); // 2 points × 3 coords
    // First point should be start
    expect(positions[0]).toBeCloseTo(0, 5);
    // Last point should be end
    expect(positions[3]).toBeCloseTo(10, 5);
  });

  it('quadratic piece produces multiple points', () => {
    const piece = makeQuadraticPiece();
    const positions = tessellatePiece(piece, 2, 10);
    expect(positions.length).toBe(11 * 3); // 11 points × 3 coords (but 2D, z=0)
    // Should be a smooth curve
    expect(positions[0]).toBeCloseTo(0, 5);
    expect(positions[10 * 3]).toBeCloseTo(1, 5);
  });

  it('cubic piece produces multiple points', () => {
    const piece = makeCubicPiece();
    const positions = tessellatePiece(piece, 3, 10);
    expect(positions.length).toBe(11 * 3);
    expect(positions[0]).toBeCloseTo(0, 5);
    expect(positions[10 * 3]).toBeCloseTo(1, 5);
  });

  it('tessellated points are in order (monotonic u)', () => {
    const piece = makeQuadraticPiece();
    const positions = tessellatePiece(piece, 2, 20);
    // X should generally increase from 0 to 1
    for (let i = 1; i <= 20; i++) {
      expect(positions[i * 3]).toBeGreaterThanOrEqual(positions[(i - 1) * 3] - 0.001);
    }
  });

  it('single segment produces exactly 2 points', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 10, 10]);
    const positions = tessellatePiece(piece, 3, 1);
    expect(positions.length).toBe(6); // 2 points × 3 coords
  });

  it('handles many segments', () => {
    const piece = makeCubicPiece();
    const positions = tessellatePiece(piece, 3, 100);
    expect(positions.length).toBe(101 * 3);
    // Verify all points are finite
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i])).toBe(true);
    }
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────────

describe('NURBS evaluation edge cases', () => {
  it('clamps u below knot domain', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 0, 0]);
    const pt = evaluateNurbs(piece, -1, 3);
    expect(pt[0]).toBeCloseTo(0, 5);
  });

  it('clamps u above knot domain', () => {
    const piece = makeLinearPiece([0, 0, 0], [10, 0, 0]);
    const pt = evaluateNurbs(piece, 2, 3);
    expect(pt[0]).toBeCloseTo(10, 5);
  });

  it('handles weighted NURBS (rational curve)', () => {
    // A rational quadratic curve with weight on middle point
    // This creates a conic section
    const piece: NBPPiece = {
      degree: 2,
      controlPoints: [0, 0, 1, 1, 2, 0],
      weights: [1, 2, 1], // Middle point has weight 2
      knots: [0, 0, 0, 1, 1, 1],
      motionType: 0,
      deviation: 0,
      extruderSpeed: 0,
    };
    const pt = evaluateNurbs(piece, 0.5, 2);
    // With weight 2 on middle point, the curve is pulled toward (1,1)
    // Standard Bezier midpoint would be (1, 0.5)
    // With weight 2: B(0.5) = (0.25*0 + 0.5*2*1 + 0.25*2) / (0.25 + 0.5*2 + 0.25)
    //              = (1 + 0.5) / 1.5 = 1.0 for x
    //              = (0.5*2*1) / 1.5 = 0.667 for y
    expect(pt[0]).toBeCloseTo(1.0, 3);
    expect(pt[1]).toBeCloseTo(0.667, 2);
  });
});
