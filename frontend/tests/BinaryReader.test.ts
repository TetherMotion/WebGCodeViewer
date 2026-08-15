/**
 * @file BinaryReader.test.ts
 * @brief Unit tests for BinaryReader.
 */

import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/core/BinaryReader';

describe('BinaryReader', () => {
  it('reads uint8 values', () => {
    const buf = new Uint8Array([0, 127, 200, 255]);
    const reader = new BinaryReader(buf);
    expect(reader.readUint8()).toBe(0);
    expect(reader.readUint8()).toBe(127);
    expect(reader.readUint8()).toBe(200);
    expect(reader.readUint8()).toBe(255);
  });

  it('reads uint16 little-endian', () => {
    const buf = new Uint8Array([0x01, 0x00, 0xFF, 0x00, 0x00, 0x80]);
    const reader = new BinaryReader(buf);
    expect(reader.readUint16()).toBe(1);
    expect(reader.readUint16()).toBe(255);
    expect(reader.readUint16()).toBe(32768);
  });

  it('reads uint32 little-endian', () => {
    const buf = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]);
    const reader = new BinaryReader(buf);
    expect(reader.readUint32()).toBe(1);
    expect(reader.readUint32()).toBe(0xFFFFFFFF);
  });

  it('reads int32 negative values', () => {
    const buf = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
    const reader = new BinaryReader(buf);
    expect(reader.readInt32()).toBe(-1);
  });

  it('reads float32', () => {
    const buf = new Float32Array([1.5, -2.25, 0]).buffer;
    const reader = new BinaryReader(buf);
    expect(reader.readFloat32()).toBeCloseTo(1.5);
    expect(reader.readFloat32()).toBeCloseTo(-2.25);
    expect(reader.readFloat32()).toBeCloseTo(0);
  });

  it('reads float64', () => {
    const buf = new Float64Array([3.141592653589793, -1e100]).buffer;
    const reader = new BinaryReader(buf);
    expect(reader.readFloat64()).toBeCloseTo(3.141592653589793);
    expect(reader.readFloat64()).toBeCloseTo(-1e100);
  });

  it('reads string', () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint8(0, 84); // T
    view.setUint8(1, 84); // T
    view.setUint8(2, 72); // H
    view.setUint8(3, 82); // R
    const reader = new BinaryReader(buf);
    expect(reader.readString(4)).toBe('TTHR');
  });

  it('throws on read past end', () => {
    const buf = new Uint8Array([1, 2]);
    const reader = new BinaryReader(buf);
    reader.readUint8();
    reader.readUint8();
    expect(() => reader.readUint8()).toThrow(RangeError);
  });

  it('seek moves position', () => {
    const buf = new Uint8Array([10, 20, 30, 40]);
    const reader = new BinaryReader(buf);
    reader.seek(2);
    expect(reader.readUint8()).toBe(30);
  });

  it('reports remaining bytes', () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const reader = new BinaryReader(buf);
    expect(reader.remaining).toBe(4);
    reader.readUint16();
    expect(reader.remaining).toBe(2);
  });

  it('reads float32 array', () => {
    const buf = new Float32Array([1.0, 2.0, 3.0, 4.0]).buffer;
    const reader = new BinaryReader(buf);
    const arr = reader.readFloat32Array(4);
    expect(arr.length).toBe(4);
    expect(arr[0]).toBeCloseTo(1.0);
    expect(arr[3]).toBeCloseTo(4.0);
  });

  it('reads float32 array from unaligned offset', () => {
    // Build a buffer with a leading byte to force misalignment, then 3 floats
    const floats = new Float32Array([1.5, 2.5, 3.5]);
    const buf = new Uint8Array(1 + floats.byteLength);
    buf[0] = 42;
    buf.set(new Uint8Array(floats.buffer), 1);
    const reader = new BinaryReader(buf);
    reader.readUint8(); // advance offset by 1 -> byteOffset % 4 !== 0
    const arr = reader.readFloat32Array(3);
    expect(arr.length).toBe(3);
    expect(arr[0]).toBeCloseTo(1.5);
    expect(arr[1]).toBeCloseTo(2.5);
    expect(arr[2]).toBeCloseTo(3.5);
  });

  it('throws when float32 array reads past end', () => {
    const buf = new Float32Array([1.0, 2.0]).buffer;
    const reader = new BinaryReader(buf);
    expect(() => reader.readFloat32Array(3)).toThrow(RangeError);
  });

  it('reads float64 array (aligned)', () => {
    const buf = new Float64Array([1.0, 2.0, 3.0, 4.0]).buffer;
    const reader = new BinaryReader(buf);
    const arr = reader.readFloat64Array(4);
    expect(arr.length).toBe(4);
    expect(arr[0]).toBeCloseTo(1.0);
    expect(arr[3]).toBeCloseTo(4.0);
  });

  it('reads float64 array from unaligned offset', () => {
    // Build a buffer with a leading byte to force misalignment, then 2 doubles
    const doubles = new Float64Array([1.25, 2.75]);
    const buf = new Uint8Array(1 + doubles.byteLength);
    buf[0] = 7;
    buf.set(new Uint8Array(doubles.buffer), 1);
    const reader = new BinaryReader(buf);
    reader.readUint8(); // advance offset by 1 -> byteOffset % 8 !== 0
    const arr = reader.readFloat64Array(2);
    expect(arr.length).toBe(2);
    expect(arr[0]).toBeCloseTo(1.25);
    expect(arr[1]).toBeCloseTo(2.75);
  });

  it('throws when float64 array reads past end', () => {
    const buf = new Float64Array([1.0]).buffer;
    const reader = new BinaryReader(buf);
    expect(() => reader.readFloat64Array(2)).toThrow(RangeError);
  });
});
