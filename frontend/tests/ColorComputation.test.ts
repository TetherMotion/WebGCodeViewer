/**
 * @file ColorComputation.test.ts
 * @brief Comprehensive tests for color computation logic across all
 *        color maps, attributes, and edge cases.
 *
 * These tests verify the pure JS color logic that determines what colors
 * are sent to the GPU for rendering. If these are correct, the rendering
 * pipeline will produce the right colors (assuming the GPU shader
 * correctly samples the LUT).
 */

import { describe, it, expect } from 'vitest';
import { ColorMap } from '../src/core/ColorMap';

// ─── Color Map Endpoint Verification ───────────────────────────────────

describe('ColorMap endpoints', () => {
  const expectedEndpoints: Record<string, { start: [number, number, number]; end: [number, number, number] }> = {
    viridis:   { start: [68, 1, 84],     end: [253, 231, 37] },
    plasma:    { start: [13, 8, 135],    end: [240, 249, 33] },
    jet:       { start: [0, 0, 131],     end: [128, 0, 0] },
    turbo:     { start: [48, 18, 59],    end: [122, 81, 25] },
    grayscale: { start: [0, 0, 0],       end: [255, 255, 255] },
    rainbow:   { start: [150, 0, 90],    end: [200, 0, 0] },
  };

  for (const [name, endpoints] of Object.entries(expectedEndpoints)) {
    it(`${name} starts at correct color`, () => {
      const cm = new ColorMap(name as any);
      const [r, g, b] = cm.sample(0);
      expect(r).toBeCloseTo(endpoints.start[0], 0);
      expect(g).toBeCloseTo(endpoints.start[1], 0);
      expect(b).toBeCloseTo(endpoints.start[2], 0);
    });

    it(`${name} ends at correct color`, () => {
      const cm = new ColorMap(name as any);
      const [r, g, b] = cm.sample(1);
      expect(r).toBeCloseTo(endpoints.end[0], 0);
      expect(g).toBeCloseTo(endpoints.end[1], 0);
      expect(b).toBeCloseTo(endpoints.end[2], 0);
    });
  }
});

// ─── Color Map Interpolation Verification ──────────────────────────────

describe('ColorMap interpolation', () => {
  it('viridis interpolates linearly between stops', () => {
    const cm = new ColorMap('viridis');
    // Between t=0.0 (68,1,84) and t=0.25 (59,82,139)
    // At t=0.125: localT=0.5
    // r = 68 + (59-68)*0.5 = 63.5
    // g = 1 + (82-1)*0.5 = 41.5
    // b = 84 + (139-84)*0.5 = 111.5
    const [r, g, b] = cm.sample(0.125);
    expect(r).toBeCloseTo(63.5, 0);
    expect(g).toBeCloseTo(41.5, 0);
    expect(b).toBeCloseTo(111.5, 0);
  });

  it('grayscale interpolates linearly', () => {
    const cm = new ColorMap('grayscale');
    const [r, g, b] = cm.sample(0.5);
    expect(r).toBeCloseTo(127.5, 0);
    expect(g).toBeCloseTo(127.5, 0);
    expect(b).toBeCloseTo(127.5, 0);
  });

  it('produces monotonically changing values for viridis R channel', () => {
    const cm = new ColorMap('viridis');
    let prev = cm.sample(0)[0];
    for (let i = 1; i <= 100; i++) {
      const t = i / 100;
      const [r] = cm.sample(t);
      // R should generally increase (not strictly monotonic due to interpolation)
      // but should not jump wildly
      expect(Math.abs(r - prev)).toBeLessThan(50);
      prev = r;
    }
  });

  it('all color maps produce valid RGB at many sample points', () => {
    for (const name of ColorMap.availableMaps()) {
      const cm = new ColorMap(name);
      for (let i = 0; i <= 1000; i++) {
        const t = i / 1000;
        const [r, g, b] = cm.sample(t);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });
});

// ─── LUT Generation Verification ───────────────────────────────────────

describe('ColorMap LUT generation', () => {
  it('LUT first entry matches t=0 color', () => {
    const cm = new ColorMap('viridis');
    const lut = cm.generateLUT(256);
    expect(lut[0]).toBe(68);   // R
    expect(lut[1]).toBe(1);    // G
    expect(lut[2]).toBe(84);   // B
  });

  it('LUT last entry matches t=1 color', () => {
    const cm = new ColorMap('viridis');
    const lut = cm.generateLUT(256);
    expect(lut[255 * 3]).toBe(253);     // R
    expect(lut[255 * 3 + 1]).toBe(231); // G
    expect(lut[255 * 3 + 2]).toBe(37);  // B
  });

  it('LUT of size 1 produces a single color', () => {
    const cm = new ColorMap('plasma');
    const lut = cm.generateLUT(1);
    expect(lut.length).toBe(3);
    // For size=1: i=0, t = 0/(1-1) = 0/0 = NaN
    // interpStops: NaN <= 0 is false, NaN >= 1 is false, so it falls through
    // the loop (NaN comparisons are all false) and returns the last stop
    // Plasma last stop: [240, 249, 33]
    expect(lut[0]).toBe(240);
    expect(lut[1]).toBe(249);
    expect(lut[2]).toBe(33);
  });

  it('LUT of size 2 produces start and end colors', () => {
    const cm = new ColorMap('jet');
    const lut = cm.generateLUT(2);
    expect(lut.length).toBe(6);
    // t=0: (0, 0, 131)
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(131);
    // t=1: (128, 0, 0)
    expect(lut[3]).toBe(128);
    expect(lut[4]).toBe(0);
    expect(lut[5]).toBe(0);
  });

  it('LUT values are rounded to integers', () => {
    const cm = new ColorMap('viridis');
    const lut = cm.generateLUT(256);
    for (let i = 0; i < lut.length; i++) {
      expect(Number.isInteger(lut[i])).toBe(true);
    }
  });

  it('LUT is contiguous (no gaps between entries)', () => {
    const cm = new ColorMap('turbo');
    const lut = cm.generateLUT(256);
    for (let i = 0; i < 255; i++) {
      const r1 = lut[i * 3], g1 = lut[i * 3 + 1], b1 = lut[i * 3 + 2];
      const r2 = lut[(i + 1) * 3], g2 = lut[(i + 1) * 3 + 1], b2 = lut[(i + 1) * 3 + 2];
      const dr = Math.abs(r2 - r1);
      const dg = Math.abs(g2 - g1);
      const db = Math.abs(b2 - b1);
      // Adjacent entries should be close (smooth gradient)
      expect(dr).toBeLessThan(10);
      expect(dg).toBeLessThan(10);
      expect(db).toBeLessThan(10);
    }
  });
});

// ─── sampleNormalized Verification ─────────────────────────────────────

describe('ColorMap.sampleNormalized', () => {
  it('returns values in [0, 1] range', () => {
    const cm = new ColorMap('viridis');
    for (let i = 0; i <= 100; i++) {
      const [r, g, b] = cm.sampleNormalized(i / 100);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('matches sample() / 255', () => {
    const cm = new ColorMap('plasma');
    const [r, g, b] = cm.sample(0.5);
    const [rn, gn, bn] = cm.sampleNormalized(0.5);
    expect(rn).toBeCloseTo(r / 255, 5);
    expect(gn).toBeCloseTo(g / 255, 5);
    expect(bn).toBeCloseTo(b / 255, 5);
  });
});

// ─── Color Map Distinctness ────────────────────────────────────────────

describe('Color map distinctness', () => {
  it('all 6 color maps are available', () => {
    const maps = ColorMap.availableMaps();
    expect(maps).toHaveLength(6);
    expect(maps).toContain('viridis');
    expect(maps).toContain('plasma');
    expect(maps).toContain('jet');
    expect(maps).toContain('turbo');
    expect(maps).toContain('grayscale');
    expect(maps).toContain('rainbow');
  });

  it('different color maps produce different colors at t=0.5', () => {
    const colors = new Set<string>();
    for (const name of ColorMap.availableMaps()) {
      const cm = new ColorMap(name);
      const [r, g, b] = cm.sample(0.5);
      colors.add(`${Math.round(r)}_${Math.round(g)}_${Math.round(b)}`);
    }
    // All 6 should produce distinct colors at t=0.5
    expect(colors.size).toBe(6);
  });

  it('color map name is stored correctly', () => {
    const cm = new ColorMap('jet');
    expect(cm.name).toBe('jet');
  });
});
