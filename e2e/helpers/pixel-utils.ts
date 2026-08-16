/**
 * @file pixel-utils.ts
 * @brief Utilities for analyzing canvas pixels in E2E tests.
 *
 * Provides functions to extract pixel data from canvas elements in the
 * browser, count non-transparent/non-background pixels, sample colors
 * at specific locations, and verify that canvases are actually rendering
 * content (not just blank/transparent).
 *
 * NOTE: WebGPU canvases do not support toDataURL() or getContext('2d').
 * Use captureCanvasPixels() (Playwright screenshot-based) for WebGPU
 * canvases, and getCanvasPixels() (toDataURL-based) for 2D canvases.
 */

import { PNG } from 'pngjs';
import { Page, Locator } from '@playwright/test';

/**
 * Canvas pixel data extracted from a browser canvas element.
 */
export interface CanvasPixels {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, 4 bytes per pixel
}

/**
 * Extract raw pixel data from a canvas element in the browser.
 * Works with both 2D and WebGPU canvases (via toDataURL).
 */
export async function getCanvasPixels(page: Page, canvasSelector: string): Promise<CanvasPixels | null> {
  const dataUrl = await page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }, canvasSelector);

  if (!dataUrl) return null;

  // Decode the PNG data URL in Node.js
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const png = PNG.sync.read(buffer);

  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data),
  };
}

/**
 * Count the number of non-transparent pixels (alpha > threshold).
 */
export function countNonTransparentPixels(pixels: CanvasPixels, alphaThreshold = 10): number {
  let count = 0;
  for (let i = 3; i < pixels.data.length; i += 4) {
    if (pixels.data[i] > alphaThreshold) count++;
  }
  return count;
}

/**
 * Count pixels matching a specific color within a tolerance.
 */
export function countPixelsMatching(
  pixels: CanvasPixels,
  r: number, g: number, b: number,
  tolerance = 20,
): number {
  let count = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const dr = Math.abs(pixels.data[i] - r);
    const dg = Math.abs(pixels.data[i + 1] - g);
    const db = Math.abs(pixels.data[i + 2] - b);
    if (dr <= tolerance && dg <= tolerance && db <= tolerance && pixels.data[i + 3] > 10) {
      count++;
    }
  }
  return count;
}

/**
 * Count pixels that are NOT the background color.
 * Background is determined by sampling the corner pixels.
 */
export function countNonBackgroundPixels(pixels: CanvasPixels, tolerance = 15): number {
  // Sample background from top-left corner
  const bgR = pixels.data[0];
  const bgG = pixels.data[1];
  const bgB = pixels.data[2];
  const bgA = pixels.data[3];

  let count = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const dr = Math.abs(pixels.data[i] - bgR);
    const dg = Math.abs(pixels.data[i + 1] - bgG);
    const db = Math.abs(pixels.data[i + 2] - bgB);
    const da = Math.abs(pixels.data[i + 3] - bgA);
    if (dr > tolerance || dg > tolerance || db > tolerance || da > tolerance) {
      count++;
    }
  }
  return count;
}

/**
 * Get the pixel color at a specific (x, y) position.
 */
export function getPixelAt(pixels: CanvasPixels, x: number, y: number): { r: number; g: number; b: number; a: number } | null {
  if (x < 0 || x >= pixels.width || y < 0 || y >= pixels.height) return null;
  const idx = (y * pixels.width + x) * 4;
  return {
    r: pixels.data[idx],
    g: pixels.data[idx + 1],
    b: pixels.data[idx + 2],
    a: pixels.data[idx + 3],
  };
}

/**
 * Sample the average color of a rectangular region.
 */
export function getAverageColor(
  pixels: CanvasPixels,
  x0: number, y0: number, x1: number, y1: number,
): { r: number; g: number; b: number; a: number } {
  let r = 0, g = 0, b = 0, a = 0, count = 0;
  for (let y = y0; y < y1 && y < pixels.height; y++) {
    for (let x = x0; x < x1 && x < pixels.width; x++) {
      const idx = (y * pixels.width + x) * 4;
      r += pixels.data[idx];
      g += pixels.data[idx + 1];
      b += pixels.data[idx + 2];
      a += pixels.data[idx + 3];
      count++;
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
    a: Math.round(a / count),
  };
}

/**
 * Check if a canvas has any visible content at all (not fully transparent or single-color).
 */
export function hasVisibleContent(pixels: CanvasPixels): boolean {
  return countNonBackgroundPixels(pixels) > 10;
}

/**
 * Get a histogram of distinct colors (quantized to 32 levels per channel).
 * Returns a map of "r_g_b" → count, sorted by count descending.
 */
export function getColorHistogram(pixels: CanvasPixels, minCount = 5): Map<string, number> {
  const hist = new Map<string, number>();
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] < 10) continue; // skip transparent
    const r = Math.floor(pixels.data[i] / 32) * 32;
    const g = Math.floor(pixels.data[i + 1] / 32) * 32;
    const b = Math.floor(pixels.data[i + 2] / 32) * 32;
    const key = `${r}_${g}_${b}`;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const filtered = new Map<string, number>();
  for (const [k, v] of hist) {
    if (v >= minCount) filtered.set(k, v);
  }
  return filtered;
}

// ─── WebGPU canvas support ─────────────────────────────────────────────
//
// WebGPU canvases do not support toDataURL() or getContext('2d'). To capture
// their pixels, we use Playwright's locator.screenshot() which takes a
// screenshot of the element via the browser's compositor.
//
// LIMITATION: In headless Chromium with SwiftShader, the compositor caches
// the first WebGPU frame. Subsequent screenshots on the same page return
// the same pixels even after re-rendering. This means before/after pixel
// comparison tests (e.g., camera rotation, color map switching) on the
// SAME page are not possible. Tests that navigate to a new page work
// correctly because each page load creates a fresh canvas.
//
// Attempted fixes that DON'T work:
//   - transferToImageBitmap(): not implemented in bundled Chromium
//   - copyTextureToBuffer + mapAsync: SwiftShader GC bug ("A valid external
//     Instance reference no longer exists")
//   - drawImage from WebGPU canvas to 2D canvas: reads cached compositor frame
//   - Canvas resize / display toggle / reflow: don't force recomposite

/**
 * Capture pixel data from a canvas element using Playwright's screenshot
 * mechanism. This works with WebGPU canvases (which don't support
 * toDataURL or getContext('2d')).
 *
 * NOTE: In headless Chromium with SwiftShader, the compositor caches the
 * first WebGPU frame. Subsequent screenshots on the same page will return
 * the same pixels even after re-rendering. Only use this for single-
 * screenshot tests or comparisons across different page loads.
 *
 * @param locator Playwright locator for the canvas element
 * @returns Canvas pixel data, or null if the canvas is not visible
 */
export async function captureCanvasPixels(locator: Locator): Promise<CanvasPixels | null> {
  try {
    const screenshotBuffer = await locator.screenshot({ type: 'png' });
    const png = PNG.sync.read(screenshotBuffer);
    return {
      width: png.width,
      height: png.height,
      data: new Uint8Array(png.data),
    };
  } catch (e) {
    return null;
  }
}
