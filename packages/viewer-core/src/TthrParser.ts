/**
 * @file TthrParser.ts
 * @brief Parser for the TTHR (Tether Trajectory Header) binary format.
 * Reads binary data produced by the C++ TrajectorySerializer.
 */

import { BinaryReader } from './BinaryReader';

export const TTHR_MAGIC = 'TTHR';
export const TTHR_VERSION = 1;

export const TTHR_FLAGS = {
  POSITIONS: 0x0001,
  VELOCITIES: 0x0002,
  ACCELERATIONS: 0x0004,
  JERKS: 0x0008,
  LINEAR_METRICS: 0x0010,
  CURVATURE: 0x0020,
  SEGMENT_INFO: 0x0040,
  DEVIATION: 0x0080,
  ALL: 0x00FF,
} as const;

export interface TTHRHeader {
  magic: string;
  version: number;
  flags: number;
  axisCount: number;
  sampleCount: number;
  blockCount: number;
  timeStart: number;
  timeEnd: number;
  pathLength: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export interface TTHRData {
  header: TTHRHeader;
  positions?: Float32Array;     // sampleCount * axisCount
  velocities?: Float32Array;
  accelerations?: Float32Array;
  jerks?: Float32Array;
  linearVelocity?: Float32Array;
  linearAcceleration?: Float32Array;
  linearJerk?: Float32Array;
  curvature?: Float32Array;
  centripetalAccel?: Float32Array;
  segmentIndex?: Int32Array;
  blockIndex?: Int32Array;
  motionType?: Uint8Array;
  deviation?: Float32Array;       // G64 corner deviation % (0-100)
}

export function parseTTHR(data: Uint8Array | ArrayBuffer): TTHRData {
  const reader = new BinaryReader(data);

  // Header (92 bytes serialized, no struct padding)
  const magic = reader.readString(4);
  if (magic !== TTHR_MAGIC) {
    throw new Error(`Invalid TTHR magic: "${magic}"`);
  }

  const version = reader.readUint16();
  if (version !== TTHR_VERSION) {
    throw new Error(`Unsupported TTHR version: ${version}`);
  }

  const flags = reader.readUint16();
  const axisCount = reader.readUint8();
  // 3 bytes reserved/padding
  reader.readUint8();
  reader.readUint8();
  reader.readUint8();
  const sampleCount = reader.readUint32();
  const blockCount = reader.readUint32();

  const timeStart = reader.readFloat64();
  const timeEnd = reader.readFloat64();
  const pathLength = reader.readFloat64();

  const boundsMin: [number, number, number] = [
    reader.readFloat64(),
    reader.readFloat64(),
    reader.readFloat64(),
  ];
  const boundsMax: [number, number, number] = [
    reader.readFloat64(),
    reader.readFloat64(),
    reader.readFloat64(),
  ];

  const header: TTHRHeader = {
    magic, version, flags, axisCount, sampleCount, blockCount,
    timeStart, timeEnd, pathLength, boundsMin, boundsMax,
  };

  const result: TTHRData = { header };

  // Per-sample arrays
  if (flags & TTHR_FLAGS.POSITIONS) {
    result.positions = reader.readFloat32Array(sampleCount * axisCount);
  }
  if (flags & TTHR_FLAGS.VELOCITIES) {
    result.velocities = reader.readFloat32Array(sampleCount * axisCount);
  }
  if (flags & TTHR_FLAGS.ACCELERATIONS) {
    result.accelerations = reader.readFloat32Array(sampleCount * axisCount);
  }
  if (flags & TTHR_FLAGS.JERKS) {
    result.jerks = reader.readFloat32Array(sampleCount * axisCount);
  }
  if (flags & TTHR_FLAGS.LINEAR_METRICS) {
    result.linearVelocity = reader.readFloat32Array(sampleCount);
    result.linearAcceleration = reader.readFloat32Array(sampleCount);
    result.linearJerk = reader.readFloat32Array(sampleCount);
  }
  if (flags & TTHR_FLAGS.CURVATURE) {
    result.curvature = reader.readFloat32Array(sampleCount);
    result.centripetalAccel = reader.readFloat32Array(sampleCount);
  }
  if (flags & TTHR_FLAGS.SEGMENT_INFO) {
    const segBytes = reader.readBytes(sampleCount * 4);
    result.segmentIndex = new Int32Array(segBytes.slice().buffer);
    const blkBytes = reader.readBytes(sampleCount * 4);
    result.blockIndex = new Int32Array(blkBytes.slice().buffer);
    result.motionType = reader.readBytes(sampleCount).slice();
  }
  if (flags & TTHR_FLAGS.DEVIATION) {
    result.deviation = reader.readFloat32Array(sampleCount);
  }

  return result;
}

/**
 * Extract a Z-layer from parsed TTHR data.
 * Returns a subset of the data for samples within the specified Z range.
 */
export function extractZLayer(data: TTHRData, zMin: number, zMax: number): TTHRData {
  if (!data.positions) return data;
  const n = data.header.sampleCount;
  const axes = data.header.axisCount;

  // Find samples within Z range (Z is axis index 2)
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = data.positions[i * axes + 2];
    if (z >= zMin && z <= zMax) {
      indices.push(i);
    }
  }

  const newCount = indices.length;
  const result: TTHRData = {
    header: { ...data.header, sampleCount: newCount },
  };

  // Copy subset for each present array
  function copyPerAxis(src: Float32Array | undefined, axisCount: number): Float32Array | undefined {
    if (!src) return undefined;
    const dst = new Float32Array(newCount * axisCount);
    for (let i = 0; i < newCount; i++) {
      const srcIdx = indices[i];
      for (let a = 0; a < axisCount; a++) {
        dst[i * axisCount + a] = src[srcIdx * axisCount + a];
      }
    }
    return dst;
  }

  function copyPerSample(src: Float32Array | undefined): Float32Array | undefined {
    if (!src) return undefined;
    const dst = new Float32Array(newCount);
    for (let i = 0; i < newCount; i++) {
      dst[i] = src[indices[i]];
    }
    return dst;
  }

  result.positions = copyPerAxis(data.positions, axes);
  result.velocities = copyPerAxis(data.velocities, axes);
  result.accelerations = copyPerAxis(data.accelerations, axes);
  result.jerks = copyPerAxis(data.jerks, axes);
  result.linearVelocity = copyPerSample(data.linearVelocity);
  result.linearAcceleration = copyPerSample(data.linearAcceleration);
  result.linearJerk = copyPerSample(data.linearJerk);
  result.curvature = copyPerSample(data.curvature);
  result.centripetalAccel = copyPerSample(data.centripetalAccel);

  if (data.segmentIndex) {
    const dst = new Int32Array(newCount);
    for (let i = 0; i < newCount; i++) dst[i] = data.segmentIndex[indices[i]];
    result.segmentIndex = dst;
  }
  if (data.blockIndex) {
    const dst = new Int32Array(newCount);
    for (let i = 0; i < newCount; i++) dst[i] = data.blockIndex[indices[i]];
    result.blockIndex = dst;
  }
  if (data.motionType) {
    const dst = new Uint8Array(newCount);
    for (let i = 0; i < newCount; i++) dst[i] = data.motionType[indices[i]];
    result.motionType = dst;
  }
  if (data.deviation) {
    result.deviation = copyPerSample(data.deviation);
  }

  return result;
}
