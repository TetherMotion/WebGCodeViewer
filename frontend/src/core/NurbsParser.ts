/**
 * @file NurbsParser.ts
 * @brief Parser for the NBP (NURBS Binary Path) binary format.
 * Reads binary data produced by the C++ NurbsSerializer.
 *
 * NBP format (little-endian):
 *   Header (82 bytes):
 *     magic[4] = "TNBP"
 *     version (u16)
 *     dim (u8)
 *     reserved[3] (u8)
 *     pieceCount (u32)
 *     blockCount (u32)
 *     totalControlPoints (u32)
 *     totalKnots (u32)
 *     totalLength (f64)
 *     boundsMin[3] (f64)
 *     boundsMax[3] (f64)
 *   Piece table (pieceCount × 16 bytes):
 *     degree (u8) + reserved[3]
 *     cpCount (u32)
 *     knotCount (u32)
 *     motionType (u8) + reserved[3]
 *   Control points (totalControlPoints × dim × f64)
 *   Weights (totalControlPoints × f64)
 *   Knots (totalKnots × f64)
 *   Block metadata
 */

export const NBP_MAGIC = 'TNBP';
export const NBP_VERSION = 1;

export interface NBPHeader {
  magic: string;
  version: number;
  dim: number;
  pieceCount: number;
  blockCount: number;
  totalControlPoints: number;
  totalKnots: number;
  totalLength: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface NBPPiece {
  degree: number;
  controlPoints: number[];   // flattened: [cp0_dim0, cp0_dim1, ..., cp1_dim0, ...]
  weights: number[];
  knots: number[];
  motionType: number;
}

export interface NBPBlock {
  blockIndex: number;
  lineNumber: number;
  motionType: number;
  gcodeText: string;
}

export interface NBPData {
  header: NBPHeader;
  pieces: NBPPiece[];
  blocks: NBPBlock[];
}

class BinaryReader {
  private view: DataView;
  private offset: number = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readU8(): number { return this.view.getUint8(this.offset++); }
  readU16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  readU32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  readI32(): number { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  readF64(): number { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  readString(len: number): string {
    const s = new TextDecoder().decode(new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len));
    this.offset += len;
    return s;
  }
  get remaining(): number { return this.view.byteLength - this.offset; }
}

export function parseNBP(data: Uint8Array | ArrayBuffer): NBPData {
  const reader = new BinaryReader(data);

  // Header
  const magic = reader.readString(4);
  if (magic !== NBP_MAGIC) {
    throw new Error(`Invalid NBP magic: "${magic}"`);
  }
  const version = reader.readU16();
  if (version !== NBP_VERSION) {
    throw new Error(`Unsupported NBP version: ${version}`);
  }
  const dim = reader.readU8();
  reader.readU8(); reader.readU8(); reader.readU8(); // reserved[3]

  const pieceCount = reader.readU32();
  const blockCount = reader.readU32();
  const totalControlPoints = reader.readU32();
  const totalKnots = reader.readU32();
  const totalLength = reader.readF64();
  const boundsMin: [number, number, number] = [
    reader.readF64(), reader.readF64(), reader.readF64(),
  ];
  const boundsMax: [number, number, number] = [
    reader.readF64(), reader.readF64(), reader.readF64(),
  ];

  const header: NBPHeader = {
    magic, version, dim, pieceCount, blockCount,
    totalControlPoints, totalKnots, totalLength,
    boundsMin, boundsMax,
  };

  // Piece table
  const pieces: NBPPiece[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const degree = reader.readU8();
    reader.readU8(); reader.readU8(); reader.readU8(); // reserved
    const cpCount = reader.readU32();
    const knotCount = reader.readU32();
    const motionType = reader.readU8();
    reader.readU8(); reader.readU8(); reader.readU8(); // reserved
    pieces.push({
      degree,
      controlPoints: [],
      weights: [],
      knots: [],
      motionType,
    });
    // Pre-allocate
    pieces[i].controlPoints = new Array(cpCount * dim);
    pieces[i].weights = new Array(cpCount);
    pieces[i].knots = new Array(knotCount);
  }

  // Control points (all pieces, contiguous)
  for (let i = 0; i < pieceCount; i++) {
    const cpCount = pieces[i].controlPoints.length / dim;
    for (let j = 0; j < cpCount * dim; j++) {
      pieces[i].controlPoints[j] = reader.readF64();
    }
  }

  // Weights (all pieces, contiguous)
  for (let i = 0; i < pieceCount; i++) {
    for (let j = 0; j < pieces[i].weights.length; j++) {
      pieces[i].weights[j] = reader.readF64();
    }
  }

  // Knots (all pieces, contiguous)
  for (let i = 0; i < pieceCount; i++) {
    for (let j = 0; j < pieces[i].knots.length; j++) {
      pieces[i].knots[j] = reader.readF64();
    }
  }

  // Block metadata
  const blocks: NBPBlock[] = [];
  for (let i = 0; i < blockCount; i++) {
    const blockIndex = reader.readI32();
    const lineNumber = reader.readI32();
    const motionType = reader.readU8();
    const textLen = reader.readU32();
    const gcodeText = reader.readString(textLen);
    blocks.push({ blockIndex, lineNumber, motionType, gcodeText });
  }

  return { header, pieces, blocks };
}

/**
 * Evaluate a NURBS curve at parameter u using De Boor's algorithm.
 * @param piece NURBS piece data
 * @param u parameter value
 * @param dim dimension (typically 3 for XYZ)
 * @returns array of dim values (position)
 */
export function evaluateNurbs(piece: NBPPiece, u: number, dim: number): number[] {
  const { degree, controlPoints, weights, knots } = piece;
  const n = controlPoints.length / dim; // number of control points

  // Clamp u to knot domain
  const uMin = knots[degree];
  const uMax = knots[knots.length - degree - 1];
  const uClamped = Math.max(uMin, Math.min(uMax, u));

  // Find knot span [k, k+1) containing u
  let k = degree;
  for (let i = degree; i < knots.length - degree - 1; i++) {
    if (knots[i] <= uClamped && uClamped < knots[i + 1]) {
      k = i;
      break;
    }
  }
  // If u is at the max, use the last valid span
  if (uClamped >= uMax) k = n - 1; // last control point

  // De Boor's algorithm in homogeneous coordinates
  // Convert to homogeneous: Pw = [P*w, w]
  const d: number[][] = []; // d[j] = [x*w, y*w, z*w, w] for dim+1
  for (let j = 0; j <= degree; j++) {
    const cpIdx = k - degree + j;
    const w = weights[cpIdx];
    const row: number[] = [];
    for (let dd = 0; dd < dim; dd++) {
      row.push(controlPoints[cpIdx * dim + dd] * w);
    }
    row.push(w); // weight
    d.push(row);
  }

  // De Boor recursion
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const a = knots[j] - knots[i];
      const b = knots[j + degree - r + 1] - knots[i];
      const alpha = b === 0 ? 0 : (uClamped - knots[i]) / b;
      for (let dd = 0; dd <= dim; dd++) {
        d[j][dd] = (1 - alpha) * d[j - 1][dd] + alpha * d[j][dd];
      }
    }
  }

  // Divide by weight to get the point
  const w = d[degree][dim];
  const result: number[] = [];
  for (let dd = 0; dd < dim; dd++) {
    result.push(w !== 0 ? d[degree][dd] / w : 0);
  }
  return result;
}

/**
 * Tessellate a NURBS piece into line segments.
 * @param piece NURBS piece data
 * @param dim dimension
 * @param segments number of segments to generate
 * @returns flat array of positions [x0,y0,z0, x1,y1,z1, ...]
 */
export function tessellatePiece(piece: NBPPiece, dim: number, segments: number): Float32Array {
  const positions = new Float32Array((segments + 1) * 3); // always 3D for rendering
  const uMin = piece.knots[piece.degree];
  const uMax = piece.knots[piece.knots.length - piece.degree - 1];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = uMin + t * (uMax - uMin);
    const pt = evaluateNurbs(piece, u, dim);
    positions[i * 3] = pt[0];
    positions[i * 3 + 1] = pt[1] || 0;
    positions[i * 3 + 2] = pt[2] || 0;
  }
  return positions;
}
