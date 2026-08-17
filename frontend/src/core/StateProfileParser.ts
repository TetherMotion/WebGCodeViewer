/**
 * @file StateProfileParser.ts
 * @brief Parse TSSP (Tether Sampled State Profile) binary data.
 *
 * TSSP is a compact binary format produced by the C++ backend that contains
 * a uniformly-sampled 1D (t, v, a, j) texture for the WebGPU UI. It is a
 * drop-in replacement for the TRNP ReNURBS profile data.
 */

export interface StateProfileData {
  version: number;
  sampleCount: number;
  totalLength: number;
  totalTime: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk: number;
  texels: Float32Array; // 4 floats per sample: (time, velocity, acceleration, jerk)
}

class BinaryReader {
  private view: DataView;
  private offset: number = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readU8(): number { return this.view.getUint8(this.offset++); }
  readU32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  readF64(): number { const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  readF32(): number { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }

  get remaining(): number { return this.view.byteLength - this.offset; }
}

export function parseTSSP(data: Uint8Array | ArrayBuffer): StateProfileData {
  const reader = new BinaryReader(data);

  const magic = String.fromCharCode(reader.readU8(), reader.readU8(), reader.readU8(), reader.readU8());
  if (magic !== 'TSSP') {
    throw new Error(`Invalid TSSP magic: ${magic}`);
  }

  const version = reader.readU32();
  if (version !== 1) {
    throw new Error(`Unsupported TSSP version: ${version}`);
  }

  const sampleCount = reader.readU32();
  const totalLength = reader.readF64();
  const totalTime = reader.readF64();
  const maxVelocity = reader.readF32();
  const maxAcceleration = reader.readF32();
  const maxJerk = reader.readF32();

  const expectedFloats = sampleCount * 4;
  const expectedBytes = expectedFloats * 4;
  if (reader.remaining < expectedBytes) {
    throw new Error(`TSSP texel data too short: expected ${expectedBytes} bytes, got ${reader.remaining}`);
  }

  const texels = new Float32Array(expectedFloats);
  for (let i = 0; i < expectedFloats; ++i) {
    texels[i] = reader.readF32();
  }

  return {
    version,
    sampleCount,
    totalLength,
    totalTime,
    maxVelocity,
    maxAcceleration,
    maxJerk,
    texels,
  };
}

/**
 * Sample the state profile at a normalized arc length sNorm in [0, 1].
 * Returns the (time, velocity, acceleration, jerk) at that arc length
 * using linear interpolation between texels.
 */
export function sampleStateProfile(data: StateProfileData, sNorm: number): [number, number, number, number] {
  const n = data.sampleCount;
  if (n === 0) return [0, 0, 0, 0];

  const u = Math.max(0, Math.min(1, sNorm)) * (n - 1);
  const i0 = Math.min(Math.floor(u), n - 1);
  const i1 = Math.min(i0 + 1, n - 1);
  const alpha = u - i0;

  const b0 = i0 * 4;
  const b1 = i1 * 4;
  const t = data.texels[b0 + 0] + alpha * (data.texels[b1 + 0] - data.texels[b0 + 0]);
  const v = data.texels[b0 + 1] + alpha * (data.texels[b1 + 1] - data.texels[b0 + 1]);
  const a = data.texels[b0 + 2] + alpha * (data.texels[b1 + 2] - data.texels[b0 + 2]);
  const j = data.texels[b0 + 3] + alpha * (data.texels[b1 + 3] - data.texels[b0 + 3]);

  return [t, v, a, j];
}
