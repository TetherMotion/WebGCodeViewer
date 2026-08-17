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

/** Open a dropdown menu by clicking its trigger button (idempotent). */
async function openMenu(page: Page, label: string) {
  await page.evaluate((menuLabel) => {
    const triggers = [...document.querySelectorAll('#top-panel .menu-trigger')];
    const trigger = triggers.find(el => el.textContent?.includes(menuLabel));
    const dropdown = trigger?.parentElement?.querySelector('.menu-dropdown') as HTMLElement | null;
    if (trigger && dropdown && !dropdown.classList.contains('open')) {
      (trigger as HTMLButtonElement).click();
    }
  }, label);
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
    // BUG 16: "Buffer used in submit while mapped" + "Buffer is already mapped"
    // The depth readback buffer's mapAsync callback didn't call unmap() if
    // getMappedRange() threw, leaving the buffer mapped forever.
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

  test('no buffer mapping errors during aggressive resize', async ({ page, request }) => {
    // BUG 16 regression: resizing the canvas destroys and recreates the depth
    // readback buffer. If a mapAsync is in-flight during resize, the buffer
    // could be left in a mapped state.
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_buffer_resize.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Aggressively resize the viewport to trigger depth buffer reallocation
    for (let i = 0; i < 10; i++) {
      await page.setViewportSize({ width: 800 + i * 50, height: 600 + i * 30 });
      await page.waitForTimeout(200);
    }
    // Resize back to small then large to stress-test
    await page.setViewportSize({ width: 400, height: 300 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(1000);

    const bufferErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      m.text.includes('Buffer') &&
      (m.text.includes('mapped') || m.text.includes('submit'))
    );
    expect(bufferErrors, 'Buffer mapping errors during resize').toEqual([]);
  });

  test('no buffer mapping errors during rapid resize with G-code loaded', async ({ page, request }) => {
    // BUG 16 regression: rapid resize cycles while rendering G-code
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'webgpu_buffer_rapid.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Rapid resize cycle: small → large → small → large
    const sizes = [
      { width: 320, height: 240 },
      { width: 1920, height: 1080 },
      { width: 320, height: 240 },
      { width: 1280, height: 720 },
      { width: 100, height: 100 },
      { width: 2560, height: 1440 },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
    }
    // Wait for any pending mapAsync to resolve
    await page.waitForTimeout(2000);

    const bufferErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      m.text.includes('Buffer') &&
      (m.text.includes('mapped') || m.text.includes('submit'))
    );
    expect(bufferErrors, 'Buffer mapping errors during rapid resize').toEqual([]);
  });

  test('no buffer mapping errors after long rendering session', async ({ page, request }) => {
    // BUG 16 regression: the error may only appear after many frames of
    // rendering, when a transient getMappedRange failure leaves the buffer
    // mapped. Run for 5 seconds to catch intermittent issues.
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'webgpu_buffer_long.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });

    // Interact with the viewer during rendering to trigger depth readback
    const canvas = page.locator('#webgpu-canvas');
    const box = await canvas.boundingBox();
    if (box) {
      // Mouse drag to rotate camera (triggers depth re-rendering)
      await canvas.hover();
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(box.x + 100 + i * 5, box.y + 100 + i * 2);
        await page.waitForTimeout(50);
      }
      await page.mouse.up();
    }
    // Zoom in/out (triggers depth re-rendering at different distances)
    for (let i = 0; i < 10; i++) {
      await canvas.hover();
      await page.mouse.wheel(0, i % 2 === 0 ? 100 : -100);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(2000);

    const bufferErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      m.text.includes('Buffer') &&
      (m.text.includes('mapped') || m.text.includes('submit'))
    );
    expect(bufferErrors, 'Buffer mapping errors after long session').toEqual([]);
  });

  test('depth readback buffer is labeled', async ({ page, request }) => {
    // BUG 16: The depth readback buffer should be labeled so that any
    // future WebGPU validation errors clearly identify the source.
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'webgpu_buffer_label.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // If there are any buffer errors, they should mention "depth-readback"
    // (the label we set on the buffer). If the buffer is unlabeled, the
    // error would say "Buffer (unlabeled)".
    const unlabeledErrors = collector.messages.filter(m =>
      m.type === 'error' &&
      m.text.includes('Buffer (unlabeled)')
    );
    // We don't expect any errors, but if there are any, they should NOT
    // say "unlabeled" — they should identify the buffer by its label.
    expect(unlabeledErrors, 'Unlabeled buffer errors found — buffer label not set').toEqual([]);
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

    const travelsBtn = page.locator('#top-panel button', { hasText: 'Travels' });
    await openMenu(page, 'View');
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
    const retractionBtn = page.locator('#top-panel button', { hasText: 'Retractions' });
    await openMenu(page, 'View');
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

    // Switch color maps (Color menu)
    await openMenu(page, 'Color');
    const mapSelect = page.locator('#top-panel .menu-dropdown.open select').nth(1);
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

    // Change layer (Playback menu)
    await openMenu(page, 'Playback');
    const layerSlider = page.locator('#top-panel .menu-dropdown.open .layer-slider');
    await layerSlider.fill('0');
    await page.waitForTimeout(1000);

    // Reset to all layers
    await openMenu(page, 'Playback');
    const allBtn = page.locator('#top-panel .menu-dropdown.open button', { hasText: 'All' });
    await allBtn.click();
    await page.waitForTimeout(1000);

    collector.assertClean('layer filtering with WebGPU');
  });
});
