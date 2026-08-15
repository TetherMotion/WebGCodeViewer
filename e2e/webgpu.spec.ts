/**
 * @file webgpu.spec.ts
 * @brief WebGPU visual regression tests.
 *
 * These tests run with Google Chrome with GPU acceleration enabled
 * (see playwright.config.ts → project "webgpu"). They verify that
 * WebGPU shaders compile correctly and the canvas renders visible content.
 *
 * The tests wait for the `data-ready` attribute on the canvas element,
 * which is set after the first successful render() call.
 */

import { test, expect, Page, ConsoleMessage, APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8099';

const SQUARE_GCODE = `
G1 X0 Y0 Z0 F600
G1 X10 Y0 Z0 E1
G1 X10 Y10 Z0 E1
G1 X0 Y10 Z0 E1
G1 X0 Y0 Z0 E1
`.trim();

const COMPLEX_GCODE = `
G1 X0 Y0 Z0 F1500
G1 X20 Y0 Z0 E2 F1200
G1 X20 Y20 Z0 E2 F900
G1 X0 Y20 Z0 E2 F1200
G1 X0 Y0 Z0 E2 F1500
G1 Z2
G1 X5 Y5 Z2 E1 F600
G1 X15 Y5 Z2 E1
G1 X15 Y15 Z2 E1
G1 X5 Y15 Z2 E1
G1 X5 Y5 Z2 E1
G1 Z5
G0 X0 Y0 Z10
`.trim();

async function uploadAndProcess(request: APIRequestContext, gcode: string, filename = 'test.gcode'): Promise<{ jobId: string; status: string }> {
  const uploadResp = await request.post(`${BASE}/api/trajectory/upload`, {
    headers: { 'Content-Type': 'text/plain' },
    params: { filename },
    data: gcode,
  });
  expect(uploadResp.ok()).toBe(true);
  const { jobId } = await uploadResp.json();
  await request.post(`${BASE}/api/trajectory/${jobId}/process`);

  let status = 'processing';
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const s = await request.get(`${BASE}/api/trajectory/${jobId}/status`);
    if (s.ok()) {
      const sj = await s.json();
      status = sj.state;
      if (status === 'ready' || status === 'failed') break;
    }
  }
  return { jobId, status };
}

function setupMessageCollector(page: Page) {
  const messages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    messages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err: Error) => {
    pageErrors.push(err.message);
  });

  const KNOWN_HARMLESS = [
    'favicon', 'runtime.lastError', 'message channel closed',
  ];

  return {
    messages,
    pageErrors,
    getErrors: () => messages.filter(m => m.type === 'error' && !KNOWN_HARMLESS.some(h => m.text.includes(h))),
    getWarnings: () => messages.filter(m => m.type === 'warning' && !KNOWN_HARMLESS.some(h => m.text.includes(h))),
    assertClean: (context: string) => {
      expect(pageErrors, `Page errors during ${context}`).toEqual([]);
      const errors = messages.filter(m => m.type === 'error' && !KNOWN_HARMLESS.some(h => m.text.includes(h)));
      expect(errors, `Console errors during ${context}`).toEqual([]);
      const warnings = messages.filter(m => m.type === 'warning' && !KNOWN_HARMLESS.some(h => m.text.includes(h)));
      expect(warnings, `Console warnings during ${context}`).toEqual([]);
    },
  };
}

// ─── Helper: count non-transparent pixels on canvas ───────────────────
async function countNonTransparentPixels(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] > 0) count++;
    }
    return count;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PART 1: WebGPU Shader Compilation Tests (BUG 14, BUG 15)
// ═══════════════════════════════════════════════════════════════════════

test.describe('WebGPU shader compilation (BUG 14, 15)', () => {
  test('no shader compilation errors on page load', async ({ page }) => {
    const collector = setupMessageCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for shader compilation errors
    const shaderErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      (m.text.includes('Shader') ||
       m.text.includes('WGSL') ||
       m.text.includes('shader') ||
       m.text.includes('pipeline'))
    );
    expect(shaderErrors, 'Shader compilation errors detected').toEqual([]);
    collector.assertClean('page load with WebGPU');
  });

  test('canvas has data-ready attribute after first render', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');

    // Wait for the canvas to signal it's ready (first frame rendered)
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
  });

  test('DirectionCubeRenderer shader compiles without WGSL errors', async ({ page }) => {
    // BUG 14: 'let lit = 0.6, 0.6, 0.6' was invalid WGSL syntax
    const collector = setupMessageCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // The direction cube renderer is initialized during app.init()
    // If the shader fails to compile, there will be errors about
    // CreateShaderModule or CreateRenderPipeline
    const errors = collector.messages.filter(m =>
      m.type === 'error' &&
      (m.text.includes('CreateShaderModule') ||
       m.text.includes('CreateRenderPipeline') ||
       m.text.includes('WGSL'))
    );
    expect(errors).toEqual([]);
  });

  test('NurbsRenderer shader compiles without textureSample errors', async ({ page, request }) => {
    // BUG 15: textureSample was called in non-uniform control flow
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'webgpu_nurbs.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for textureSample uniformity errors
    const textureErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      (m.text.includes('textureSample') ||
       m.text.includes('non-uniform') ||
       m.text.includes('uniform control flow'))
    );
    expect(textureErrors).toEqual([]);
    collector.assertClean('NurbsRenderer with G-code loaded');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 2: WebGPU Canvas Rendering Tests
// ═══════════════════════════════════════════════════════════════════════

test.describe('WebGPU canvas rendering', () => {
  test('canvas renders visible content with G-code loaded', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'webgpu_render.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');

    // Wait for first frame
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Take a screenshot for visual regression
    const canvas = page.locator('#webgpu-canvas');
    await expect(canvas).toHaveScreenshot('webgpu-square-gcode.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('canvas renders complex G-code correctly', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_complex.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');

    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const canvas = page.locator('#webgpu-canvas');
    await expect(canvas).toHaveScreenshot('webgpu-complex-gcode.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('direction cube canvas renders visible content', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // The direction cube canvas should have visible content
    const dirCanvas = page.locator('.nav-dir-canvas');
    await expect(dirCanvas).toBeVisible();
  });

  test('no buffer mapping errors during rendering', async ({ page, request }) => {
    // This tests the "Buffer used in submit while mapped" error
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_buffer.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const bufferErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      (m.text.includes('Buffer') &&
       (m.text.includes('mapped') || m.text.includes('submit')))
    );
    expect(bufferErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 3: WebGPU Feature Interaction Tests
// ═══════════════════════════════════════════════════════════════════════

test.describe('WebGPU feature interactions', () => {
  test('toggling travels does not cause WebGPU errors', async ({ page, request }) => {
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_travels.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const travelsBtn = page.locator('#bottom-panel button', { hasText: 'Travels' });
    await travelsBtn.click();
    await page.waitForTimeout(1000);
    await travelsBtn.click();
    await page.waitForTimeout(1000);

    collector.assertClean('toggle travels with WebGPU');
  });

  test('retraction highlight renders correctly with WebGPU', async ({ page, request }) => {
    // BUG 15 regression: ensure textureSample fix works with retraction highlight
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_retraction.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Enable retraction highlighting
    const retractionBtn = page.locator('#bottom-panel button', { hasText: 'Retractions' });
    await retractionBtn.click();
    await page.waitForTimeout(1000);

    collector.assertClean('retraction highlight with WebGPU');
  });

  test('color map switching does not cause WebGPU errors', async ({ page, request }) => {
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'webgpu_colormap.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Switch color maps
    const mapSelect = page.locator('select').nth(1);
    for (const map of ['plasma', 'grayscale', 'cividis', 'viridis']) {
      await mapSelect.selectOption(map);
      await page.waitForTimeout(500);
    }

    collector.assertClean('color map switching with WebGPU');
  });

  test('layer filtering renders correctly with WebGPU', async ({ page, request }) => {
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_layers.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Change layer
    const layerSlider = page.locator('.layer-slider');
    await layerSlider.fill('0');
    await page.waitForTimeout(1000);

    // Reset to all layers
    const allBtn = page.locator('#bottom-panel button', { hasText: 'All' });
    await allBtn.click();
    await page.waitForTimeout(1000);

    collector.assertClean('layer filtering with WebGPU');
  });
});
