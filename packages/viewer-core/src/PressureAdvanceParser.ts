/**
 * @file PressureAdvanceParser.ts
 * @brief Parse TWPA (Tether Weighted Pressure Advance) binary data.
 *
 * TWPA contains PA algorithm parameters — NOT sampled data or NURBS curves.
 * The frontend evaluates PA analytically in WGSL shaders using the WSS arcs
 * (from TWSF v2) and these parameters.
 *
 * This replaces the old TRNP-PA format which carried NURBS control points.
 * The new approach is O(1) in trajectory length — the parameter count is
 * fixed per algorithm, independent of print duration.
 *
 * Format layout (all little-endian):
 *   Header (32 bytes):
 *     magic[4] = "TWPA"
 *     version (u16) = 1
 *     algorithmCount (u8)
 *     reserved[25]
 *
 *   Per-algorithm block (variable size):
 *     algorithmId (u8), reserved[3]
 *     algorithmName[32]
 *     maxOffset (f32), maxVelocity (f32)
 *     paramSize (u32)
 *     params[paramSize] — algorithm-specific parameters
 *
 * @see PressureAdvanceSerializer.hpp for the C++ counterpart
 */

/// PA algorithm IDs (match C++ PressureAdvanceAlgorithm enum).
export type PressureAdvanceAlgorithmId = 0 | 1 | 2 | 3 | 4;
// 0=Linear, 1=PowerLaw, 2=CrossWLF, 3=LTI-Deconv, 4=LPV-Deconv

/// Per-algorithm parameter block.
export interface PressureAdvanceParamBlock {
  algorithmId: PressureAdvanceAlgorithmId;
  algorithmName: string;
  maxOffset: number;
  maxVelocity: number;

  // Linear parameters
  pressureAdvance: number;
  smoothTime: number;
  maxCompensation: number;

  // PowerLaw parameters
  powerLawBaseGain: number;
  flowIndex: number;
  filamentDiameter: number;

  // CrossWLF parameters
  crossWlfCompressibility: number;
  meltTempC: number;
  qGrid: Float32Array;       // Flow rate grid [mm³/s]
  tempGrid: Float32Array;    // Temperature grid [°C]
  pValues: Float32Array;     // Pressure LUT [qGridCount × tempGridCount]

  // LTI/LPV parameters
  groupDelay: number;
  moments: Float32Array;     // LTI: 4 moments. LPV: 4 per op point (flattened).

  // LPV parameters
  opPointVelocities: Float32Array;  // Operating point velocities
}

const TWPA_MAGIC = 'TWPA';
const TWPA_VERSION = 1;

class BinaryReader {
  private view: DataView;
  private offset_ = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readU8(): number { return this.view.getUint8(this.offset_++); }
  readU16(): number { const v = this.view.getUint16(this.offset_, true); this.offset_ += 2; return v; }
  readU32(): number { const v = this.view.getUint32(this.offset_, true); this.offset_ += 4; return v; }
  readF32(): number { const v = this.view.getFloat32(this.offset_, true); this.offset_ += 4; return v; }
  skip(n: number): void { this.offset_ += n; }

  readString32(): string {
    const chars: string[] = [];
    for (let i = 0; i < 32; i++) {
      const c = this.view.getUint8(this.offset_++);
      if (c === 0) { this.skip(31 - i); break; }
      chars.push(String.fromCharCode(c));
    }
    return chars.join('');
  }

  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.view.getFloat32(this.offset_, true);
      this.offset_ += 4;
    }
    return arr;
  }

  get remaining(): number { return this.view.byteLength - this.offset_; }
  set offset(value: number) { this.offset_ = value; }
  get offset(): number { return this.offset_; }
}

/**
 * Parse TWPA binary data into an array of PA parameter blocks.
 * @param data Binary TWPA data from the server
 * @returns Array of PA parameter blocks, one per algorithm
 */
export function parseTWPA(data: Uint8Array | ArrayBuffer): PressureAdvanceParamBlock[] {
  const reader = new BinaryReader(data);

  // Header (32 bytes)
  const magic = String.fromCharCode(reader.readU8(), reader.readU8(), reader.readU8(), reader.readU8());
  if (magic !== TWPA_MAGIC) {
    throw new Error(`Invalid TWPA magic: "${magic}"`);
  }

  const version = reader.readU16();
  if (version !== TWPA_VERSION) {
    throw new Error(`Unsupported TWPA version: ${version}`);
  }

  const algorithmCount = reader.readU8();
  reader.skip(25); // reserved

  const results: PressureAdvanceParamBlock[] = [];

  for (let i = 0; i < algorithmCount; i++) {
    const algorithmId = reader.readU8() as PressureAdvanceAlgorithmId;
    reader.skip(3); // reserved
    const algorithmName = reader.readString32();
    const maxOffset = reader.readF32();
    const maxVelocity = reader.readF32();
    const paramSize = reader.readU32();

    const paramEnd = reader.offset + paramSize;

    // Initialize with defaults
    const block: PressureAdvanceParamBlock = {
      algorithmId,
      algorithmName,
      maxOffset,
      maxVelocity,
      pressureAdvance: 0,
      smoothTime: 0,
      maxCompensation: 0,
      powerLawBaseGain: 0,
      flowIndex: 1,
      filamentDiameter: 1.75,
      crossWlfCompressibility: 1e-5,
      meltTempC: 210,
      qGrid: new Float32Array(0),
      tempGrid: new Float32Array(0),
      pValues: new Float32Array(0),
      groupDelay: 0,
      moments: new Float32Array(0),
      opPointVelocities: new Float32Array(0),
    };

    switch (algorithmId) {
      case 0: // Linear
        block.pressureAdvance = reader.readF32();
        block.smoothTime = reader.readF32();
        block.maxCompensation = reader.readF32();
        break;

      case 1: // PowerLaw
        block.powerLawBaseGain = reader.readF32();
        block.flowIndex = reader.readF32();
        block.filamentDiameter = reader.readF32();
        block.smoothTime = reader.readF32();
        block.maxCompensation = reader.readF32();
        break;

      case 2: { // CrossWLF
        block.crossWlfCompressibility = reader.readF32();
        block.filamentDiameter = reader.readF32();
        block.smoothTime = reader.readF32();
        block.maxCompensation = reader.readF32();
        block.meltTempC = reader.readF32();
        const qCount = reader.readU32();
        const tCount = reader.readU32();
        block.qGrid = reader.readFloat32Array(qCount);
        block.tempGrid = reader.readFloat32Array(tCount);
        block.pValues = reader.readFloat32Array(qCount * tCount);
        break;
      }

      case 3: { // LTI-Deconv
        block.groupDelay = reader.readF32();
        block.maxCompensation = reader.readF32();
        const momentCount = reader.readU32();
        block.moments = reader.readFloat32Array(momentCount);
        break;
      }

      case 4: { // LPV-Deconv
        block.groupDelay = reader.readF32();
        block.maxCompensation = reader.readF32();
        const opCount = reader.readU32();
        const momentCount = reader.readU32();
        block.opPointVelocities = new Float32Array(opCount);
        block.moments = new Float32Array(opCount * momentCount);
        for (let j = 0; j < opCount; j++) {
          block.opPointVelocities[j] = reader.readF32();
          for (let k = 0; k < momentCount; k++) {
            block.moments[j * momentCount + k] = reader.readF32();
          }
        }
        break;
      }
    }

    // Skip any remaining bytes in the param block
    reader.offset = paramEnd;
    results.push(block);
  }

  return results;
}
