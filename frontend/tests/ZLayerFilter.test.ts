/**
 * @file ZLayerFilter.test.ts
 * @brief Unit tests for Z-layer filtering logic.
 */

import { describe, it, expect } from 'vitest';
import { parseTTHR, extractZLayer, TTHR_FLAGS } from "@tether/viewer-core";

function buildTTHRWithPositions(positions: number[], axisCount: number = 3): ArrayBuffer {
  const sampleCount = positions.length / axisCount;
  const headerSize = 92;
  const dataSize = sampleCount * axisCount * 4;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // Magic 'TTHR'
  view.setUint8(0, 84); // T
  view.setUint8(1, 84); // T
  view.setUint8(2, 72); // H
  view.setUint8(3, 82); // R
  view.setUint16(4, 1, true); // version
  view.setUint16(6, TTHR_FLAGS.POSITIONS, true); // flags
  view.setUint8(8, axisCount); // axisCount
  // 3 bytes reserved (9-11)
  view.setUint8(9, 0); view.setUint8(10, 0); view.setUint8(11, 0);
  view.setUint32(12, sampleCount, true);
  view.setUint32(16, 0, true); // blockCount
  view.setFloat64(20, 0, true); // timeStart
  view.setFloat64(28, 10, true); // timeEnd
  view.setFloat64(36, 100, true); // pathLength

  // Bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < sampleCount; i++) {
    const x = positions[i * axisCount];
    const y = positions[i * axisCount + 1];
    const z = positions[i * axisCount + 2];
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  view.setFloat64(44, minX, true);
  view.setFloat64(52, minY, true);
  view.setFloat64(60, minZ, true);
  view.setFloat64(68, maxX, true);
  view.setFloat64(76, maxY, true);
  view.setFloat64(84, maxZ, true);

  // Position data
  for (let i = 0; i < positions.length; i++) {
    view.setFloat32(headerSize + i * 4, positions[i], true);
  }

  return buffer;
}

describe('Z-Layer Filtering', () => {
  it('extracts a single layer by Z range', () => {
    // 6 samples at Z=0, Z=5, Z=5, Z=10, Z=10, Z=15
    const positions = [
      0, 0, 0,
      10, 0, 5,
      20, 0, 5,
      30, 0, 10,
      40, 0, 10,
      50, 0, 15,
    ];
    const data = parseTTHR(buildTTHRWithPositions(positions));
    const layer = extractZLayer(data, 4, 6);
    expect(layer.header.sampleCount).toBe(2);
    expect(layer.positions![0]).toBeCloseTo(10);
    expect(layer.positions![3]).toBeCloseTo(20);
  });

  it('extracts layer at Z=10', () => {
    const positions = [
      0, 0, 0,
      10, 0, 5,
      20, 0, 10,
      30, 0, 10,
      40, 0, 15,
    ];
    const data = parseTTHR(buildTTHRWithPositions(positions));
    const layer = extractZLayer(data, 9, 11);
    expect(layer.header.sampleCount).toBe(2);
    expect(layer.positions![0]).toBeCloseTo(20);
  });

  it('returns all samples when range covers everything', () => {
    const positions = [
      0, 0, 0,
      10, 0, 5,
      20, 0, 10,
    ];
    const data = parseTTHR(buildTTHRWithPositions(positions));
    const layer = extractZLayer(data, -100, 100);
    expect(layer.header.sampleCount).toBe(3);
  });

  it('returns no samples for out-of-range Z', () => {
    const positions = [
      0, 0, 0,
      10, 0, 5,
    ];
    const data = parseTTHR(buildTTHRWithPositions(positions));
    const layer = extractZLayer(data, 100, 200);
    expect(layer.header.sampleCount).toBe(0);
  });

  it('handles boundary correctly (inclusive)', () => {
    const positions = [
      0, 0, 5,
      10, 0, 5,
    ];
    const data = parseTTHR(buildTTHRWithPositions(positions));
    const layer = extractZLayer(data, 5, 5);
    expect(layer.header.sampleCount).toBe(2);
  });

  it('preserves other data arrays when filtering', () => {
    // Build with positions + linear velocity
    const sampleCount = 4;
    const headerSize = 92;
    const flags = TTHR_FLAGS.POSITIONS | TTHR_FLAGS.LINEAR_METRICS;
    const dataSize = sampleCount * 3 * 4 + sampleCount * 3 * 4; // positions + linear metrics
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    view.setUint8(0, 84); view.setUint8(1, 84); view.setUint8(2, 72); view.setUint8(3, 82);
    view.setUint16(4, 1, true);
    view.setUint16(6, flags, true);
    view.setUint8(8, 3);
    view.setUint8(9, 0); view.setUint8(10, 0); view.setUint8(11, 0);
    view.setUint32(12, sampleCount, true);
    view.setUint32(16, 0, true);
    view.setFloat64(20, 0, true);
    view.setFloat64(28, 10, true);
    view.setFloat64(36, 100, true);
    view.setFloat64(44, 0, true); view.setFloat64(52, 0, true); view.setFloat64(60, 0, true);
    view.setFloat64(68, 30, true); view.setFloat64(76, 0, true); view.setFloat64(84, 15, true);

    const positions = [0, 0, 0, 10, 0, 5, 20, 0, 5, 30, 0, 15];
    let offset = headerSize;
    for (const p of positions) {
      view.setFloat32(offset, p, true);
      offset += 4;
    }
    // Linear velocity, acceleration, jerk
    for (let i = 0; i < sampleCount; i++) {
      view.setFloat32(offset, i * 10, true); offset += 4; // linearVelocity
    }
    for (let i = 0; i < sampleCount; i++) {
      view.setFloat32(offset, i * 100, true); offset += 4; // linearAcceleration
    }
    for (let i = 0; i < sampleCount; i++) {
      view.setFloat32(offset, i * 1000, true); offset += 4; // linearJerk
    }

    const data = parseTTHR(buffer);
    expect(data.linearVelocity).toBeDefined();
    const layer = extractZLayer(data, 4, 6);
    expect(layer.header.sampleCount).toBe(2);
    expect(layer.linearVelocity).toBeDefined();
    expect(layer.linearVelocity!.length).toBe(2);
    // Samples at index 1 and 2 had linearVelocity 10 and 20
    expect(layer.linearVelocity![0]).toBeCloseTo(10);
    expect(layer.linearVelocity![1]).toBeCloseTo(20);
  });
});
