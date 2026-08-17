import { describe, it, expect } from 'vitest';
import {
  parseTSSP,
  sampleStateProfile,
  stateProfileToTrnp,
  type StateProfileData,
} from "@tether/viewer-core";

function buildTssp(profile: StateProfileData): Uint8Array {
  const headerSize = 4 + 4 + 4 + 8 + 8 + 4 + 4 + 4; // magic + version + n + L + T + maxV/A/J
  const dataSize = profile.texels.length * 4;
  const buf = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  bytes[0] = 0x54; bytes[1] = 0x53; bytes[2] = 0x53; bytes[3] = 0x50; // TSSP
  let off = 4;
  view.setUint32(off, 1, true); off += 4; // version
  view.setUint32(off, profile.sampleCount, true); off += 4;
  view.setFloat64(off, profile.totalLength, true); off += 8;
  view.setFloat64(off, profile.totalTime, true); off += 8;
  view.setFloat32(off, profile.maxVelocity, true); off += 4;
  view.setFloat32(off, profile.maxAcceleration, true); off += 4;
  view.setFloat32(off, profile.maxJerk, true); off += 4;
  const out = new Float32Array(buf, off);
  for (let i = 0; i < profile.texels.length; i++) {
    out[i] = profile.texels[i];
  }
  return new Uint8Array(buf);
}

describe('StateProfileParser', () => {
  it('parses a valid TSSP payload', () => {
    const data: StateProfileData = {
      version: 1,
      sampleCount: 4,
      totalLength: 100,
      totalTime: 10,
      maxVelocity: 50,
      maxAcceleration: 100,
      maxJerk: 200,
      texels: new Float32Array([0, 0, 0, 0, 2.5, 10, 20, 0, 5, 20, 0, -10, 10, 10, -20, 0]),
    };
    const parsed = parseTSSP(buildTssp(data));
    expect(parsed.sampleCount).toBe(4);
    expect(parsed.totalLength).toBe(100);
    expect(parsed.totalTime).toBe(10);
    expect(parsed.maxVelocity).toBe(50);
    expect(parsed.texels.length).toBe(16);
  });

  it('rejects invalid magic', () => {
    const bad = new Uint8Array(32);
    expect(() => parseTSSP(bad)).toThrow(/Invalid TSSP magic/);
  });

  it('rejects unsupported version', () => {
    const buf = new ArrayBuffer(32);
    const bytes = new Uint8Array(buf);
    bytes[0] = 0x54; bytes[1] = 0x53; bytes[2] = 0x53; bytes[3] = 0x50;
    const view = new DataView(buf);
    view.setUint32(4, 99, true);
    expect(() => parseTSSP(bytes)).toThrow(/Unsupported TSSP version/);
  });

  it('samples linearly between texels', () => {
    const data: StateProfileData = {
      version: 1,
      sampleCount: 3,
      totalLength: 10,
      totalTime: 2,
      maxVelocity: 10,
      maxAcceleration: 0,
      maxJerk: 0,
      texels: new Float32Array([0, 0, 0, 0, 1, 10, 0, 0, 2, 20, 0, 0]),
    };
    const [t, v] = sampleStateProfile(data, 0.25);
    expect(t).toBeCloseTo(0.5, 5);
    expect(v).toBeCloseTo(5, 5);
  });
});

describe('stateProfileToTrnp', () => {
  it('produces a single linear segment over the time domain', () => {
    const data: StateProfileData = {
      version: 1,
      sampleCount: 4,
      totalLength: 100,
      totalTime: 10,
      maxVelocity: 50,
      maxAcceleration: 100,
      maxJerk: 200,
      texels: new Float32Array([0, 0, 0, 0, 2.5, 10, 20, 0, 5, 20, 0, -10, 10, 10, -20, 0]),
    };
    const trnp = stateProfileToTrnp(data);
    expect(trnp.segments.length).toBe(1);
    expect(trnp.segments[0].sStart).toBe(0);
    expect(trnp.segments[0].sEnd).toBe(10);
    expect(trnp.segments[0].quantities.length).toBe(4);
    expect(trnp.header.maxVelocity).toBe(50);
    expect(trnp.allControlPoints.length).toBe(16);
    expect(trnp.quantityMeta.length).toBe(16);
  });
});
