/**
 * @file ColorMap.test.ts
 * @brief Unit tests for ColorMap.
 */

import { describe, it, expect } from 'vitest';
import { ColorMap } from "@tether/viewer-core";

describe('ColorMap', () => {
  it('samples viridis at t=0', () => {
    const cm = new ColorMap('viridis');
    const [r, g, b] = cm.sample(0);
    expect(r).toBe(68);
    expect(g).toBe(1);
    expect(b).toBe(84);
  });

  it('samples viridis at t=1', () => {
    const cm = new ColorMap('viridis');
    const [r, g, b] = cm.sample(1);
    expect(r).toBe(253);
    expect(g).toBe(231);
    expect(b).toBe(37);
  });

  it('samples intermediate values', () => {
    const cm = new ColorMap('viridis');
    const [r, g, b] = cm.sample(0.375);
    // At t=0.375, we're between stops at t=0.25 and t=0.5
    // Stop at 0.25: (59, 82, 139), Stop at 0.5: (33, 145, 140)
    // Local t = (0.375 - 0.25) / (0.5 - 0.25) = 0.5
    // r = 59 + (33-59)*0.5 = 46
    expect(r).toBeGreaterThan(33);
    expect(r).toBeLessThan(59);
  });

  it('clamps t below 0', () => {
    const cm = new ColorMap('viridis');
    const [r] = cm.sample(-1);
    expect(r).toBe(68);
  });

  it('clamps t above 1', () => {
    const cm = new ColorMap('viridis');
    const [r] = cm.sample(2);
    expect(r).toBe(253);
  });

  it('generates LUT of correct size', () => {
    const cm = new ColorMap('plasma');
    const lut = cm.generateLUT(256);
    expect(lut.length).toBe(256 * 3);
  });

  it('LUT values are in [0, 255]', () => {
    const cm = new ColorMap('jet');
    const lut = cm.generateLUT(256);
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  it('supports all color maps', () => {
    for (const name of ColorMap.availableMaps()) {
      const cm = new ColorMap(name);
      const [r, g, b] = cm.sample(0.5);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });

  it('sampleNormalized returns [0,1] range', () => {
    const cm = new ColorMap('viridis');
    const [r, g, b] = cm.sampleNormalized(0);
    expect(r).toBeCloseTo(68 / 255);
    expect(g).toBeCloseTo(1 / 255);
    expect(b).toBeCloseTo(84 / 255);
  });
});
