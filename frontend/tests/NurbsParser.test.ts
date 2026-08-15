/**
 * @file NurbsParser.test.ts
 * @brief Unit tests for NBP (NURBS Binary Path) format parser.
 *
 * These tests build NBP binary data manually (matching the C++ serializer
 * format) and verify that parseNBP correctly reads all fields.
 * They specifically guard against:
 *   - Reserved byte count mismatches (the 1-byte vs 3-byte bug)
 *   - Header size / offset errors
 *   - Piece table parsing errors
 *   - Control point / weight / knot alignment
 */

import { describe, it, expect } from 'vitest';
import { parseNBP, NBP_MAGIC, NBP_VERSION, tessellatePiece, evaluateNurbs } from '../src/core/NurbsParser';

// ── NBP header size must be exactly 82 bytes ──────────────────────────
//  4 (magic) + 2 (version) + 1 (dim) + 3 (reserved) + 4×4 (counts) +
//  1 (totalLength f64) ×8 + 3×8 (boundsMin) + 3×8 (boundsMax) = 82
const NBP_HEADER_SIZE = 82;
const NBP_PIECE_ENTRY_SIZE = 16;

/**
 * Build a complete NBP binary buffer matching the C++ serializer format.
 */
function buildNBP(opts: {
  dim?: number;
  pieces?: Array<{
    degree: number;
    controlPoints: number[][];
    weights: number[];
    knots: number[];
    motionType?: number;
  }>;
  blocks?: Array<{
    blockIndex: number;
    lineNumber: number;
    motionType: number;
    gcodeText: string;
  }>;
}): ArrayBuffer {
  const dim = opts.dim ?? 3;
  const pieces = opts.pieces ?? [];
  const blocks = opts.blocks ?? [];

  const pieceCount = pieces.length;
  const blockCount = blocks.length;
  const totalCP = pieces.reduce((s, p) => s + p.controlPoints.length, 0);
  const totalKnots = pieces.reduce((s, p) => s + p.knots.length, 0);

  // Compute total size
  let size = NBP_HEADER_SIZE;
  size += pieceCount * NBP_PIECE_ENTRY_SIZE;
  size += totalCP * dim * 8; // control points
  size += totalCP * 8;       // weights
  size += totalKnots * 8;    // knots
  for (const b of blocks) {
    size += 4 + 4 + 1 + 4 + b.gcodeText.length; // blockIndex + lineNumber + motionType + textLen + text
  }

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let off = 0;

  // ── Header ──
  for (let i = 0; i < 4; i++) view.setUint8(off++, NBP_MAGIC.charCodeAt(i));
  view.setUint16(off, NBP_VERSION, true); off += 2;
  view.setUint8(off++, dim);
  view.setUint8(off++, 0); view.setUint8(off++, 0); view.setUint8(off++, 0); // reserved[3]
  view.setUint32(off, pieceCount, true); off += 4;
  view.setUint32(off, blockCount, true); off += 4;
  view.setUint32(off, totalCP, true); off += 4;
  view.setUint32(off, totalKnots, true); off += 4;
  view.setFloat64(off, 42.0, true); off += 8; // totalLength
  view.setFloat64(off, -10, true); off += 8;
  view.setFloat64(off, -10, true); off += 8;
  view.setFloat64(off, 0, true); off += 8;
  view.setFloat64(off, 110, true); off += 8;
  view.setFloat64(off, 110, true); off += 8;
  view.setFloat64(off, 100, true); off += 8;

  expect(off).toBe(NBP_HEADER_SIZE);

  // ── Piece table ──
  for (const p of pieces) {
    view.setUint8(off++, p.degree);
    view.setUint8(off++, 0); view.setUint8(off++, 0); view.setUint8(off++, 0); // reserved[3]
    view.setUint32(off, p.controlPoints.length, true); off += 4;
    view.setUint32(off, p.knots.length, true); off += 4;
    view.setUint8(off++, p.motionType ?? 1);
    view.setUint8(off++, 0); view.setUint8(off++, 0); view.setUint8(off++, 0); // reserved[3]
  }

  // ── Control points (all pieces, contiguous) ──
  for (const p of pieces) {
    for (const cp of p.controlPoints) {
      for (let d = 0; d < dim; d++) {
        view.setFloat64(off, cp[d] ?? 0, true); off += 8;
      }
    }
  }

  // ── Weights (all pieces, contiguous) ──
  for (const p of pieces) {
    for (const w of p.weights) {
      view.setFloat64(off, w, true); off += 8;
    }
  }

  // ── Knots (all pieces, contiguous) ──
  for (const p of pieces) {
    for (const k of p.knots) {
      view.setFloat64(off, k, true); off += 8;
    }
  }

  // ── Block metadata ──
  for (const b of blocks) {
    view.setInt32(off, b.blockIndex, true); off += 4;
    view.setInt32(off, b.lineNumber, true); off += 4;
    view.setUint8(off++, b.motionType);
    view.setUint32(off, b.gcodeText.length, true); off += 4;
    for (let i = 0; i < b.gcodeText.length; i++) {
      view.setUint8(off++, b.gcodeText.charCodeAt(i));
    }
  }

  expect(off).toBe(size);
  return buf;
}

// A simple linear NURBS: degree 1, 2 control points, knots {0,0,1,1}
function makeLinePiece(p0: number[], p1: number[], motionType = 1) {
  return {
    degree: 1,
    controlPoints: [p0, p1],
    weights: [1.0, 1.0],
    knots: [0, 0, 1, 1],
    motionType,
  };
}

describe('NurbsParser', () => {
  // ── Header parsing ──────────────────────────────────────────────

  it('parses valid header with 3 reserved bytes (82-byte header)', () => {
    const buf = buildNBP({ pieces: [makeLinePiece([0, 0, 0], [10, 0, 0])] });
    const data = parseNBP(buf);
    expect(data.header.magic).toBe('TNBP');
    expect(data.header.version).toBe(NBP_VERSION);
    expect(data.header.dim).toBe(3);
    expect(data.header.pieceCount).toBe(1);
    expect(data.header.blockCount).toBe(0);
    expect(data.header.totalControlPoints).toBe(2);
    expect(data.header.totalKnots).toBe(4);
    expect(data.header.totalLength).toBe(42.0);
    expect(data.header.boundsMin).toEqual([-10, -10, 0]);
    expect(data.header.boundsMax).toEqual([110, 110, 100]);
  });

  it('rejects invalid magic', () => {
    const buf = buildNBP({ pieces: [makeLinePiece([0, 0, 0], [1, 0, 0])] });
    const view = new DataView(buf);
    view.setUint8(0, 'X'.charCodeAt(0)); // corrupt magic
    expect(() => parseNBP(buf)).toThrow('Invalid NBP magic');
  });

  it('rejects unsupported version', () => {
    const buf = buildNBP({ pieces: [makeLinePiece([0, 0, 0], [1, 0, 0])] });
    const view = new DataView(buf);
    view.setUint16(4, 999, true); // unsupported version
    expect(() => parseNBP(buf)).toThrow('Unsupported NBP version');
  });

  // ── Reserved bytes regression test ──────────────────────────────
  // This test specifically catches the bug where the parser read only
  // 1 reserved byte instead of 3, causing pieceCount to be read from
  // the wrong offset.

  it('correctly reads pieceCount after 3 reserved bytes (not 1)', () => {
    // Build NBP with 5 pieces — if reserved bytes are wrong, pieceCount
    // will be garbage and parsing will fail or produce wrong results
    const pieces = [
      makeLinePiece([0, 0, 0], [10, 0, 0]),
      makeLinePiece([10, 0, 0], [10, 10, 0]),
      makeLinePiece([10, 10, 0], [0, 10, 0]),
      makeLinePiece([0, 10, 0], [0, 0, 0]),
      makeLinePiece([0, 0, 0], [5, 5, 5]),
    ];
    const buf = buildNBP({ pieces });
    const data = parseNBP(buf);
    expect(data.header.pieceCount).toBe(5);
    expect(data.pieces.length).toBe(5);
    expect(data.pieces[0].controlPoints.length).toBe(6); // 2 CPs × 3 dim
    expect(data.pieces[4].controlPoints.length).toBe(6);
  });

  // ── Piece table parsing ─────────────────────────────────────────

  it('parses piece table entries with correct degree and motionType', () => {
    const pieces = [
      { degree: 1, controlPoints: [[0, 0, 0], [10, 0, 0]], weights: [1, 1], knots: [0, 0, 1, 1], motionType: 0 },
      { degree: 2, controlPoints: [[0, 0, 0], [5, 5, 0], [10, 0, 0]], weights: [1, 1, 1], knots: [0, 0, 0, 1, 1, 1], motionType: 2 },
    ];
    const buf = buildNBP({ pieces });
    const data = parseNBP(buf);
    expect(data.pieces[0].degree).toBe(1);
    expect(data.pieces[0].motionType).toBe(0);
    expect(data.pieces[1].degree).toBe(2);
    expect(data.pieces[1].motionType).toBe(2);
  });

  it('parses control points, weights, and knots correctly', () => {
    const piece = {
      degree: 1,
      controlPoints: [[1, 2, 3], [4, 5, 6]],
      weights: [1.0, 0.5],
      knots: [0, 0, 1, 1],
    };
    const buf = buildNBP({ pieces: [piece] });
    const data = parseNBP(buf);
    expect(data.pieces[0].controlPoints).toEqual([1, 2, 3, 4, 5, 6]);
    expect(data.pieces[0].weights).toEqual([1.0, 0.5]);
    expect(data.pieces[0].knots).toEqual([0, 0, 1, 1]);
  });

  // ── Multiple pieces alignment ───────────────────────────────────

  it('correctly separates control points across multiple pieces', () => {
    const pieces = [
      makeLinePiece([0, 0, 0], [10, 0, 0]),
      makeLinePiece([20, 0, 0], [30, 0, 0]),
    ];
    const buf = buildNBP({ pieces });
    const data = parseNBP(buf);
    // Piece 0: CP0=[0,0,0], CP1=[10,0,0]
    expect(data.pieces[0].controlPoints).toEqual([0, 0, 0, 10, 0, 0]);
    // Piece 1: CP0=[20,0,0], CP1=[30,0,0]
    expect(data.pieces[1].controlPoints).toEqual([20, 0, 0, 30, 0, 0]);
  });

  // ── Block metadata parsing ──────────────────────────────────────

  it('parses block metadata with gcode text', () => {
    const blocks = [
      { blockIndex: 0, lineNumber: 5, motionType: 1, gcodeText: 'G1 X10 Y0 F600' },
      { blockIndex: 1, lineNumber: 6, motionType: 0, gcodeText: 'G0 Z5' },
    ];
    const buf = buildNBP({ pieces: [makeLinePiece([0, 0, 0], [10, 0, 0])], blocks });
    const data = parseNBP(buf);
    expect(data.blocks.length).toBe(2);
    expect(data.blocks[0].blockIndex).toBe(0);
    expect(data.blocks[0].lineNumber).toBe(5);
    expect(data.blocks[0].motionType).toBe(1);
    expect(data.blocks[0].gcodeText).toBe('G1 X10 Y0 F600');
    expect(data.blocks[1].gcodeText).toBe('G0 Z5');
  });

  // ── Edge cases ──────────────────────────────────────────────────

  it('handles empty pieces (header only)', () => {
    const buf = buildNBP({ pieces: [] });
    const data = parseNBP(buf);
    expect(data.header.pieceCount).toBe(0);
    expect(data.pieces).toEqual([]);
    expect(data.blocks).toEqual([]);
  });

  it('handles 2D dimension', () => {
    const piece = {
      degree: 1,
      controlPoints: [[0, 0], [10, 10]],
      weights: [1, 1],
      knots: [0, 0, 1, 1],
    };
    const buf = buildNBP({ dim: 2, pieces: [piece] });
    const data = parseNBP(buf);
    expect(data.header.dim).toBe(2);
    expect(data.pieces[0].controlPoints).toEqual([0, 0, 10, 10]);
  });

  // ── NURBS evaluation ────────────────────────────────────────────

  it('evaluateNurbs interpolates linear NURBS correctly', () => {
    const piece = {
      degree: 1,
      controlPoints: [0, 0, 0, 10, 20, 30],
      weights: [1, 1],
      knots: [0, 0, 1, 1],
    };
    const p0 = evaluateNurbs(piece as any, 0.0, 3);
    const pMid = evaluateNurbs(piece as any, 0.5, 3);
    const p1 = evaluateNurbs(piece as any, 1.0, 3);
    expect(p0).toEqual([0, 0, 0]);
    expect(pMid).toEqual([5, 10, 15]);
    expect(p1).toEqual([10, 20, 30]);
  });

  it('tessellatePiece produces correct number of vertices', () => {
    const piece = {
      degree: 1,
      controlPoints: [0, 0, 0, 10, 0, 0],
      weights: [1, 1],
      knots: [0, 0, 1, 1],
    };
    const positions = tessellatePiece(piece as any, 3, 4);
    expect(positions.length).toBe((4 + 1) * 3); // 5 vertices × 3
    // First vertex at start
    expect(positions[0]).toBeCloseTo(0);
    // Last vertex at end
    expect(positions[12]).toBeCloseTo(10);
  });

  // ── Round-trip: build → parse → verify ──────────────────────────

  it('round-trip: multiple pieces with blocks parse correctly', () => {
    const pieces = [
      makeLinePiece([0, 0, 0], [10, 0, 0], 1),
      makeLinePiece([10, 0, 0], [10, 10, 0], 1),
      makeLinePiece([10, 10, 0], [0, 10, 0], 1),
    ];
    const blocks = [
      { blockIndex: 0, lineNumber: 1, motionType: 1, gcodeText: 'G1 X10 Y0' },
      { blockIndex: 1, lineNumber: 2, motionType: 1, gcodeText: 'G1 X10 Y10' },
      { blockIndex: 2, lineNumber: 3, motionType: 1, gcodeText: 'G1 X0 Y10' },
    ];
    const buf = buildNBP({ pieces, blocks });
    const data = parseNBP(buf);

    expect(data.header.pieceCount).toBe(3);
    expect(data.pieces.length).toBe(3);
    expect(data.blocks.length).toBe(3);

    // Verify each piece's endpoints
    expect(data.pieces[0].controlPoints.slice(0, 3)).toEqual([0, 0, 0]);
    expect(data.pieces[0].controlPoints.slice(3, 6)).toEqual([10, 0, 0]);
    expect(data.pieces[1].controlPoints.slice(0, 3)).toEqual([10, 0, 0]);
    expect(data.pieces[1].controlPoints.slice(3, 6)).toEqual([10, 10, 0]);

    // Verify blocks
    expect(data.blocks[0].gcodeText).toBe('G1 X10 Y0');
    expect(data.blocks[2].lineNumber).toBe(3);
  });
});
