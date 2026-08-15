/**
 * @file ColorMap.ts
 * @brief Color mapping utilities for trajectory visualization.
 * Maps scalar values (velocity, acceleration, jerk, curvature) to RGB colors.
 */

export type ColorMapName = 'viridis' | 'plasma' | 'jet' | 'turbo' | 'grayscale' | 'rainbow' | 'cividis' | 'coolwarm';

export interface ColorStop {
  t: number;
  color: [number, number, number];
}

const viridisStops: ColorStop[] = [
  { t: 0.0, color: [68, 1, 84] },
  { t: 0.25, color: [59, 82, 139] },
  { t: 0.5, color: [33, 145, 140] },
  { t: 0.75, color: [94, 201, 98] },
  { t: 1.0, color: [253, 231, 37] },
];

const plasmaStops: ColorStop[] = [
  { t: 0.0, color: [13, 8, 135] },
  { t: 0.25, color: [126, 3, 168] },
  { t: 0.5, color: [204, 71, 120] },
  { t: 0.75, color: [248, 149, 64] },
  { t: 1.0, color: [240, 249, 33] },
];

const jetStops: ColorStop[] = [
  { t: 0.0, color: [0, 0, 131] },
  { t: 0.125, color: [0, 60, 170] },
  { t: 0.375, color: [5, 255, 255] },
  { t: 0.625, color: [255, 255, 0] },
  { t: 0.875, color: [250, 0, 0] },
  { t: 1.0, color: [128, 0, 0] },
];

const turboStops: ColorStop[] = [
  { t: 0.0, color: [48, 18, 59] },
  { t: 0.25, color: [69, 86, 179] },
  { t: 0.5, color: [33, 168, 154] },
  { t: 0.75, color: [157, 220, 63] },
  { t: 1.0, color: [122, 81, 25] },
];

const grayscaleStops: ColorStop[] = [
  { t: 0.0, color: [0, 0, 0] },
  { t: 1.0, color: [255, 255, 255] },
];

const rainbowStops: ColorStop[] = [
  { t: 0.0, color: [150, 0, 90] },
  { t: 0.2, color: [0, 0, 200] },
  { t: 0.4, color: [0, 200, 200] },
  { t: 0.6, color: [0, 200, 0] },
  { t: 0.8, color: [200, 200, 0] },
  { t: 1.0, color: [200, 0, 0] },
];

// Feature #126: Colorblind-friendly color maps
// Cividis: designed for color vision deficiency (blue-yellow)
const cividisStops: ColorStop[] = [
  { t: 0.0, color: [0, 32, 77] },
  { t: 0.25, color: [48, 76, 119] },
  { t: 0.5, color: [120, 132, 47] },
  { t: 0.75, color: [205, 184, 32] },
  { t: 1.0, color: [255, 233, 69] },
];

// Cool-warm: diverging blue-red, distinguishable for most CVD types
const coolwarmStops: ColorStop[] = [
  { t: 0.0, color: [59, 76, 192] },
  { t: 0.25, color: [98, 130, 234] },
  { t: 0.5, color: [221, 221, 221] },
  { t: 0.75, color: [234, 130, 98] },
  { t: 1.0, color: [192, 76, 59] },
];

const colorMapStops: Record<ColorMapName, ColorStop[]> = {
  viridis: viridisStops,
  plasma: plasmaStops,
  jet: jetStops,
  turbo: turboStops,
  grayscale: grayscaleStops,
  rainbow: rainbowStops,
  cividis: cividisStops,
  coolwarm: coolwarmStops,
};

function interpStops(stops: ColorStop[], t: number): [number, number, number] {
  if (t <= 0) return stops[0].color;
  if (t >= 1) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * localT,
        a.color[1] + (b.color[1] - a.color[1]) * localT,
        a.color[2] + (b.color[2] - a.color[2]) * localT,
      ];
    }
  }
  return stops[stops.length - 1].color;
}

export class ColorMap {
  private stops: ColorStop[];
  public readonly name: ColorMapName;

  constructor(name: ColorMapName = 'viridis') {
    this.name = name;
    this.stops = colorMapStops[name];
  }

  /**
   * Map a normalized value [0, 1] to an RGB color.
   */
  sample(t: number): [number, number, number] {
    return interpStops(this.stops, t);
  }

  /**
   * Map a normalized value [0, 1] to an RGB color packed as a float [0, 1].
   */
  sampleNormalized(t: number): [number, number, number] {
    const [r, g, b] = this.sample(t);
    return [r / 255, g / 255, b / 255];
  }

  /**
   * Generate a 1D lookup texture (256 entries) as a Uint8Array.
   */
  generateLUT(size: number = 256): Uint8Array {
    const lut = new Uint8Array(size * 3);
    for (let i = 0; i < size; i++) {
      const t = i / (size - 1);
      const [r, g, b] = this.sample(t);
      lut[i * 3] = Math.round(r);
      lut[i * 3 + 1] = Math.round(g);
      lut[i * 3 + 2] = Math.round(b);
    }
    return lut;
  }

  static availableMaps(): ColorMapName[] {
    return ['viridis', 'plasma', 'jet', 'turbo', 'grayscale', 'rainbow', 'cividis', 'coolwarm'];
  }
}
