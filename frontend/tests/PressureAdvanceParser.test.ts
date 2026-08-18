import { describe, it, expect } from 'vitest';
import { parseTWPA } from "@tether/viewer-core";
import type { PressureAdvanceParamBlock } from "@tether/viewer-core";

/**
 * Build a minimal TWPA binary for testing.
 */
function buildTestTWPA(): Uint8Array {
  const blocks: PressureAdvanceParamBlock[] = [
    {
      algorithmId: 0, algorithmName: 'Linear',
      maxOffset: 0.3, maxVelocity: 100,
      pressureAdvance: 0.045, smoothTime: 0.04, maxCompensation: 0.5,
      powerLawBaseGain: 0, flowIndex: 1, filamentDiameter: 1.75,
      crossWlfCompressibility: 1e-5, meltTempC: 210,
      qGrid: new Float32Array(0), tempGrid: new Float32Array(0), pValues: new Float32Array(0),
      groupDelay: 0, moments: new Float32Array(0), opPointVelocities: new Float32Array(0),
    },
    {
      algorithmId: 3, algorithmName: 'LTI-Deconv',
      maxOffset: 0.3, maxVelocity: 100,
      pressureAdvance: 0, smoothTime: 0.04, maxCompensation: 0.5,
      powerLawBaseGain: 0, flowIndex: 1, filamentDiameter: 1.75,
      crossWlfCompressibility: 1e-5, meltTempC: 210,
      qGrid: new Float32Array(0), tempGrid: new Float32Array(0), pValues: new Float32Array(0),
      groupDelay: 0.02, moments: new Float32Array([0.1, 0.01, 0.001, 0.0001]),
      opPointVelocities: new Float32Array(0),
    },
  ];

  // Build binary
  const buf = new ArrayBuffer(32 + 2 * (4 + 32 + 8 + 4 + 12) + (4 + 32 + 8 + 4 + 24));
  const view = new DataView(buf);
  let off = 0;

  // Header
  view.setUint8(off++, 0x54); // T
  view.setUint8(off++, 0x57); // W
  view.setUint8(off++, 0x50); // P
  view.setUint8(off++, 0x41); // A
  view.setUint16(off, 1, true); off += 2; // version
  view.setUint8(off++, 2); // algorithmCount
  off += 25; // reserved

  // Block 0: Linear
  view.setUint8(off++, 0); // algorithmId
  off += 3; // reserved
  for (let i = 0; i < 32; i++) {
    view.setUint8(off++, i < 'Linear'.length ? 'Linear'.charCodeAt(i) : 0);
  }
  view.setFloat32(off, 0.3, true); off += 4; // maxOffset
  view.setFloat32(off, 100, true); off += 4; // maxVelocity
  view.setUint32(off, 12, true); off += 4; // paramSize
  view.setFloat32(off, 0.045, true); off += 4; // pressureAdvance
  view.setFloat32(off, 0.04, true); off += 4; // smoothTime
  view.setFloat32(off, 0.5, true); off += 4; // maxCompensation

  // Block 1: LTI
  view.setUint8(off++, 3); // algorithmId
  off += 3; // reserved
  const name = 'LTI-Deconv';
  for (let i = 0; i < 32; i++) {
    view.setUint8(off++, i < name.length ? name.charCodeAt(i) : 0);
  }
  view.setFloat32(off, 0.3, true); off += 4; // maxOffset
  view.setFloat32(off, 100, true); off += 4; // maxVelocity
  view.setUint32(off, 24, true); off += 4; // paramSize
  view.setFloat32(off, 0.02, true); off += 4; // groupDelay
  view.setFloat32(off, 0.5, true); off += 4; // maxCompensation
  view.setUint32(off, 4, true); off += 4; // momentCount
  view.setFloat32(off, 0.1, true); off += 4;
  view.setFloat32(off, 0.01, true); off += 4;
  view.setFloat32(off, 0.001, true); off += 4;
  view.setFloat32(off, 0.0001, true); off += 4;

  return new Uint8Array(buf, 0, off);
}

describe('parseTWPA', () => {
  it('parses valid TWPA data', () => {
    const data = buildTestTWPA();
    const parsed = parseTWPA(data);
    expect(parsed.length).toBe(2);
    expect(parsed[0].algorithmId).toBe(0);
    expect(parsed[0].algorithmName).toBe('Linear');
    expect(parsed[1].algorithmId).toBe(3);
    expect(parsed[1].algorithmName).toBe('LTI-Deconv');
  });

  it('parses Linear parameters', () => {
    const data = buildTestTWPA();
    const parsed = parseTWPA(data);
    expect(parsed[0].pressureAdvance).toBeCloseTo(0.045);
    expect(parsed[0].smoothTime).toBeCloseTo(0.04);
    expect(parsed[0].maxCompensation).toBeCloseTo(0.5);
  });

  it('parses LTI moments', () => {
    const data = buildTestTWPA();
    const parsed = parseTWPA(data);
    expect(parsed[1].moments.length).toBe(4);
    expect(parsed[1].moments[0]).toBeCloseTo(0.1);
    expect(parsed[1].moments[3]).toBeCloseTo(0.0001);
    expect(parsed[1].groupDelay).toBeCloseTo(0.02);
  });

  it('rejects invalid magic', () => {
    const bad = new Uint8Array([0x58, 0x58, 0x58, 0x58, 0, 0, 0, 0]);
    expect(() => parseTWPA(bad)).toThrow();
  });

  it('handles empty algorithm list', () => {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint8(0, 0x54); view.setUint8(1, 0x57);
    view.setUint8(2, 0x50); view.setUint8(3, 0x41);
    view.setUint16(4, 1, true); // version
    view.setUint8(6, 0); // algorithmCount = 0
    const parsed = parseTWPA(new Uint8Array(buf));
    expect(parsed.length).toBe(0);
  });
});
