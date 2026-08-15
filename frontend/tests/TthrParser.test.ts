/**
 * @file TthrParser.test.ts
 * @brief Unit tests for TTHR binary format parser and Z-layer extraction.
 */

import { describe, it, expect } from 'vitest';
import { parseTTHR, extractZLayer, TTHR_FLAGS, TTHR_MAGIC } from '../src/core/TthrParser';

function buildTTHRHeader(sampleCount: number, flags: number, axisCount: number = 3): ArrayBuffer {
  const buffer = new ArrayBuffer(92);
  const view = new DataView(buffer);
  // Magic
  for (let i = 0; i < 4; i++) view.setUint8(i, TTHR_MAGIC.charCodeAt(i));
  // Version
  view.setUint16(4, 1, true);
  // Flags
  view.setUint16(6, flags, true);
  // Axis count
  view.setUint8(8, axisCount);
  // 3 bytes reserved (9-11)
  view.setUint8(9, 0); view.setUint8(10, 0); view.setUint8(11, 0);
  // Sample count
  view.setUint32(12, sampleCount, true);
  // Block count
  view.setUint32(16, 0, true);
  // Time start/end (offset 20, 28)
  view.setFloat64(20, 0.0, true);
  view.setFloat64(28, 1.0, true);
  // Path length (offset 36)
  view.setFloat64(36, 100.0, true);
  // Bounds min (offset 44, 52, 60)
  view.setFloat64(44, 0, true);
  view.setFloat64(52, 0, true);
  view.setFloat64(60, 0, true);
  // Bounds max (offset 68, 76, 84)
  view.setFloat64(68, 100, true);
  view.setFloat64(76, 100, true);
  view.setFloat64(84, 100, true);
  return buffer;
}

describe('TthrParser', () => {
  it('parses valid header', () => {
    const buf = buildTTHRHeader(0, TTHR_FLAGS.ALL);
    const data = parseTTHR(buf);
    expect(data.header.magic).toBe('TTHR');
    expect(data.header.version).toBe(1);
    expect(data.header.sampleCount).toBe(0);
    expect(data.header.timeStart).toBe(0);
    expect(data.header.timeEnd).toBe(1);
    expect(data.header.pathLength).toBe(100);
  });

  it('rejects invalid magic', () => {
    const buf = new ArrayBuffer(96);
    const view = new DataView(buf);
    view.setUint8(0, 'X'.charCodeAt(0));
    expect(() => parseTTHR(buf)).toThrow('Invalid TTHR magic');
  });

  it('parses positions', () => {
    const sampleCount = 3;
    const headerBuf = buildTTHRHeader(sampleCount, TTHR_FLAGS.POSITIONS);
    const fullBuf = new ArrayBuffer(92 + sampleCount * 3 * 4);
    new Uint8Array(fullBuf).set(new Uint8Array(headerBuf), 0);
    // Write position data
    const view = new DataView(fullBuf, 92);
    const positions = [0, 0, 0, 10, 0, 5, 20, 10, 10];
    for (let i = 0; i < positions.length; i++) {
      view.setFloat32(i * 4, positions[i], true);
    }
    const data = parseTTHR(fullBuf);
    expect(data.positions).toBeDefined();
    expect(data.positions!.length).toBe(9);
    expect(data.positions![0]).toBeCloseTo(0);
    expect(data.positions![3]).toBeCloseTo(10);
    expect(data.positions![8]).toBeCloseTo(10);
  });

  it('parses linear metrics', () => {
    const sampleCount = 2;
    const headerBuf = buildTTHRHeader(sampleCount, TTHR_FLAGS.LINEAR_METRICS);
    const fullBuf = new ArrayBuffer(92 + sampleCount * 3 * 4);
    new Uint8Array(fullBuf).set(new Uint8Array(headerBuf), 0);
    const view = new DataView(fullBuf, 92);
    view.setFloat32(0, 10.5, true); // linearVelocity[0]
    view.setFloat32(4, 20.5, true); // linearVelocity[1]
    view.setFloat32(8, 100, true);  // linearAcceleration[0]
    view.setFloat32(12, 200, true); // linearAcceleration[1]
    view.setFloat32(16, 1000, true); // linearJerk[0]
    view.setFloat32(20, 2000, true); // linearJerk[1]
    const data = parseTTHR(fullBuf);
    expect(data.linearVelocity).toBeDefined();
    expect(data.linearVelocity![0]).toBeCloseTo(10.5);
    expect(data.linearVelocity![1]).toBeCloseTo(20.5);
    expect(data.linearAcceleration).toBeDefined();
    expect(data.linearJerk).toBeDefined();
  });

  it('extractZLayer filters by Z range', () => {
    const sampleCount = 4;
    const headerBuf = buildTTHRHeader(sampleCount, TTHR_FLAGS.POSITIONS);
    const fullBuf = new ArrayBuffer(92 + sampleCount * 3 * 4);
    new Uint8Array(fullBuf).set(new Uint8Array(headerBuf), 0);
    const view = new DataView(fullBuf, 92);
    // 4 samples: (0,0,0), (10,0,5), (20,0,5), (30,0,10)
    const positions = [0, 0, 0, 10, 0, 5, 20, 0, 5, 30, 0, 10];
    for (let i = 0; i < positions.length; i++) {
      view.setFloat32(i * 4, positions[i], true);
    }
    const data = parseTTHR(fullBuf);
    const layer = extractZLayer(data, 4, 6); // Z between 4 and 6
    expect(layer.header.sampleCount).toBe(2);
    expect(layer.positions![0]).toBeCloseTo(10); // X of 2nd sample
    expect(layer.positions![3]).toBeCloseTo(20); // X of 3rd sample
  });

  it('extractZLayer with no matches returns empty', () => {
    const sampleCount = 2;
    const headerBuf = buildTTHRHeader(sampleCount, TTHR_FLAGS.POSITIONS);
    const fullBuf = new ArrayBuffer(92 + sampleCount * 3 * 4);
    new Uint8Array(fullBuf).set(new Uint8Array(headerBuf), 0);
    const view = new DataView(fullBuf, 92);
    const positions = [0, 0, 0, 10, 0, 10];
    for (let i = 0; i < positions.length; i++) {
      view.setFloat32(i * 4, positions[i], true);
    }
    const data = parseTTHR(fullBuf);
    const layer = extractZLayer(data, 100, 200);
    expect(layer.header.sampleCount).toBe(0);
  });

  it('extractZLayer copies motionType and deviation', () => {
    const sampleCount = 4;
    const flags = TTHR_FLAGS.POSITIONS | TTHR_FLAGS.SEGMENT_INFO | TTHR_FLAGS.DEVIATION;
    const headerBuf = buildTTHRHeader(sampleCount, flags);
    // positions: 4 samples * 3 axes * 4 bytes = 48
    // segmentIndex: 4 * 4 = 16
    // blockIndex: 4 * 4 = 16
    // motionType: 4 * 1 = 4
    // deviation: 4 * 4 = 16
    const dataSize = 48 + 16 + 16 + 4 + 16;
    const fullBuf = new ArrayBuffer(92 + dataSize);
    new Uint8Array(fullBuf).set(new Uint8Array(headerBuf), 0);
    const view = new DataView(fullBuf, 92);
    // Positions: (0,0,0), (10,0,5), (20,0,5), (30,0,10)
    const positions = [0, 0, 0, 10, 0, 5, 20, 0, 5, 30, 0, 10];
    for (let i = 0; i < positions.length; i++) {
      view.setFloat32(i * 4, positions[i], true);
    }
    let off = 48;
    // segmentIndex (Int32)
    const segIdx = [0, 1, 1, 2];
    for (let i = 0; i < segIdx.length; i++) {
      view.setInt32(off + i * 4, segIdx[i], true);
    }
    off += 16;
    // blockIndex (Int32)
    const blkIdx = [10, 11, 11, 12];
    for (let i = 0; i < blkIdx.length; i++) {
      view.setInt32(off + i * 4, blkIdx[i], true);
    }
    off += 16;
    // motionType (Uint8)
    const motionTypes = [0, 1, 2, 3];
    for (let i = 0; i < motionTypes.length; i++) {
      view.setUint8(off + i, motionTypes[i]);
    }
    off += 4;
    // deviation (Float32)
    const deviations = [0.0, 50.0, 75.0, 100.0];
    for (let i = 0; i < deviations.length; i++) {
      view.setFloat32(off + i * 4, deviations[i], true);
    }
    const data = parseTTHR(fullBuf);
    expect(data.motionType).toBeDefined();
    expect(data.deviation).toBeDefined();
    // Extract Z layer for samples with Z in [4, 6] -> samples 1 and 2
    const layer = extractZLayer(data, 4, 6);
    expect(layer.header.sampleCount).toBe(2);
    // motionType copied correctly
    expect(layer.motionType).toBeDefined();
    expect(layer.motionType!.length).toBe(2);
    expect(layer.motionType![0]).toBe(1);
    expect(layer.motionType![1]).toBe(2);
    // deviation copied correctly
    expect(layer.deviation).toBeDefined();
    expect(layer.deviation!.length).toBe(2);
    expect(layer.deviation![0]).toBeCloseTo(50.0);
    expect(layer.deviation![1]).toBeCloseTo(75.0);
  });

  it('extractZLayer returns data unchanged when no positions', () => {
    const headerBuf = buildTTHRHeader(0, TTHR_FLAGS.DEVIATION);
    const data = parseTTHR(headerBuf);
    const layer = extractZLayer(data, 0, 100);
    expect(layer).toBe(data);
  });
});
