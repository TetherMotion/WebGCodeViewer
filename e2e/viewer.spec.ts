/**
 * @file viewer.spec.ts
 * @brief E2E tests for the Tether WebGPU G-code Viewer.
 *
 * These tests validate that the page loads without console errors,
 * WebGPU initializes correctly (or fails gracefully), and all UI
 * components render properly.
 *
 * Note: Headless Chromium does not support WebGPU, so tests are
 * designed to handle the "WebGPU not supported" case gracefully.
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';

/**
 * Collect console messages and page errors during a test.
 * Filters out known non-critical messages (favicon 404, browser
 * extension noise, and WebGPU-not-supported in headless mode).
 */
function setupErrorCollector(page: Page) {
  const errors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', (err: Error) => {
    errors.push(`pageerror: ${err.message}`);
  });

  return {
    errors,
    consoleErrors,
    assertNoErrors: (context: string) => {
      expect(errors, `Page errors during ${context}`).toEqual([]);
      // Filter out known non-critical warnings
      const realErrors = consoleErrors.filter(
        e => !e.includes('favicon') &&
             !e.includes('runtime.lastError') &&
             !e.includes('message channel closed') &&
             !e.includes('WebGPU not supported') &&  // expected in headless
             !e.includes('Failed to initialize WebGPU'),
      );
      expect(realErrors, `Console errors during ${context}`).toEqual([]);
    },
    /**
     * Assert no WebGPU validation errors specifically.
     * This catches binding size mismatches, invalid bind groups, etc.
     */
    assertNoWebGPUErrors: () => {
      const webgpuErrors = consoleErrors.filter(
        e => e.includes('Binding size') ||
             e.includes('validation') ||
             e.includes('CreateBindGroup') ||
             e.includes('Invalid BindGroup') ||
             e.includes('Invalid CommandBuffer') ||
             e.includes('minBindingSize') ||
             e.includes('Buffer size') ||
             e.includes('offset') ||
             e.includes('Viewport') ||
             e.includes('Scissor') ||
             e.includes('depth texture') ||
             e.includes('Attachment') ||
             e.includes('RenderPass') ||
             e.includes('GPUBuffer') ||
             e.includes('GPUTexture') ||
             e.includes('destroyed'),
      );
      expect(webgpuErrors, 'WebGPU validation errors detected').toEqual([]);
    },
  };
}

// ─── Page Load & Console Error Tests ───────────────────────────────

test.describe('Page load', () => {
  test('page loads without critical errors', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle('Tether G-code Viewer');
    collector.assertNoErrors('page load');
  });

  test('main HTML structure exists', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('#canvas-container')).toBeVisible();
    await expect(page.locator('#webgpu-canvas')).toBeVisible();
    await expect(page.locator('#gcode-panel')).toBeVisible();
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await expect(page.locator('#nav-cube-container')).toBeVisible();
  });

  test('CSS is loaded', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');

    // Check body background (should be dark, not transparent)
    const bg = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });

  test('JS bundle is loaded', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');

    const scripts = await page.locator('script[src]').evaluateAll(
      els => els.map(e => e.getAttribute('src')),
    );
    expect(scripts.some(s => s && s.includes('tether-viewer.js'))).toBe(true);
  });

  test('no WebGPU validation errors', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    // Even if WebGPU is not supported, there should be no validation errors
    // (those indicate buffer/shader size mismatches, which are bugs)
    collector.assertNoWebGPUErrors();
  });
});

// ─── UI Component Tests ────────────────────────────────────────────

test.describe('UI components', () => {
  test('control panel renders with buttons', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const openBtn = page.locator('#bottom-panel button', { hasText: 'Open G-code' });
    await expect(openBtn).toBeVisible();

    const colorSelect = page.locator('#bottom-panel select').first();
    await expect(colorSelect).toBeVisible();

    await expect(page.locator('#bottom-panel button', { hasText: 'Grid' })).toBeVisible();
    await expect(page.locator('#bottom-panel button', { hasText: 'Reset View' })).toBeVisible();
    await expect(page.locator('#bottom-panel button', { hasText: 'Export' })).toBeVisible();
    await expect(page.locator('#bottom-panel .status-text')).toBeVisible();
  });

  test('G-code panel renders with header', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const header = page.locator('#gcode-panel-header');
    await expect(header).toBeVisible();
    await expect(page.locator('.gcode-filename')).toContainText(/No file|G-code/i);
  });

  test('navigation cube overlay renders', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const overlay = page.locator('.nav-cube-overlay');
    await expect(overlay).toBeVisible();

    await expect(page.locator('.nav-gizmo-canvas')).toBeVisible();
    await expect(page.locator('.nav-dir-canvas')).toBeVisible();
    await expect(page.locator('.nav-proj-btn', { hasText: 'Persp' })).toBeVisible();
    await expect(page.locator('.nav-proj-btn', { hasText: 'Ortho' })).toBeVisible();
  });

  test('overlay is constrained to right side (not full screen)', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const overlay = page.locator('.nav-cube-overlay');
    const overlayBox = await overlay.boundingBox();
    const canvasContainer = page.locator('#canvas-container');
    const containerBox = await canvasContainer.boundingBox();

    expect(overlayBox).not.toBeNull();
    expect(containerBox).not.toBeNull();

    // Overlay width should be small (not taking up entire screen)
    expect(overlayBox!.width).toBeLessThan(200);
    // Overlay should be positioned in the top-right area
    expect(overlayBox!.x + overlayBox!.width).toBeGreaterThan(
      containerBox!.x + containerBox!.width - 200,
    );
  });
});

// ─── Interaction Tests ─────────────────────────────────────────────

test.describe('Interactions', () => {
  test('Ctrl+F opens G-code search bar', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const searchBar = page.locator('.gcode-search-bar');
    await expect(searchBar).not.toBeVisible();

    // Press Ctrl+F
    await page.keyboard.press('Control+f');
    await expect(searchBar).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(searchBar).not.toBeVisible();
  });

  test('projection toggle switches between Persp and Ortho', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const perspBtn = page.locator('.nav-proj-btn', { hasText: 'Persp' });
    const orthoBtn = page.locator('.nav-proj-btn', { hasText: 'Ortho' });

    await expect(perspBtn).toHaveClass(/active/);
    await expect(orthoBtn).not.toHaveClass(/active/);

    await orthoBtn.click();
    await expect(orthoBtn).toHaveClass(/active/);
    await expect(perspBtn).not.toHaveClass(/active/);

    await perspBtn.click();
    await expect(perspBtn).toHaveClass(/active/);
    await expect(orthoBtn).not.toHaveClass(/active/);
  });

  test('direction cube canvas is clickable', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const dirCanvas = page.locator('.nav-dir-canvas');
    const box = await dirCanvas.boundingBox();
    expect(box).not.toBeNull();

    // Click on the first cell (ISO view)
    await page.mouse.click(box!.x + box!.width / 8, box!.y + box!.height / 4);
    await page.waitForTimeout(500);
    collector.assertNoErrors('direction cube click');
  });
});

// ─── Rendering Stability ───────────────────────────────────────────

test.describe('Rendering stability', () => {
  test('no critical errors after 5 seconds', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    collector.assertNoErrors('5 second render loop');
    collector.assertNoWebGPUErrors();
  });

  test('no errors after rapid resize events', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Rapidly change viewport size to trigger ResizeObserver
    for (let i = 0; i < 5; i++) {
      await page.setViewportSize({
        width: 800 + i * 100,
        height: 600 + i * 50,
      });
      await page.waitForTimeout(200);
    }

    // Wait for resize to settle
    await page.waitForTimeout(1000);
    collector.assertNoErrors('rapid resize');
    collector.assertNoWebGPUErrors();
  });

  test('no errors when canvas has zero size (minimized)', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Set viewport to very small size
    await page.setViewportSize({ width: 1, height: 1 });
    await page.waitForTimeout(500);

    // Restore
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    collector.assertNoErrors('zero-size canvas');
  });
});

// ─── WebGPU Renderer Tests ──────────────────────────────────────────

test.describe('WebGPU renderer initialization', () => {
  test('all renderer canvases exist in DOM', async ({ page }) => {
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Main canvas
    await expect(page.locator('#webgpu-canvas')).toBeVisible();
    // Gizmo canvas
    await expect(page.locator('.nav-gizmo-canvas')).toBeVisible();
    // Direction cube canvas
    await expect(page.locator('.nav-dir-canvas')).toBeVisible();
  });

  test('no WebGPU errors after all direction cube cells clicked', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const dirCanvas = page.locator('.nav-dir-canvas');
    const box = await dirCanvas.boundingBox();
    expect(box).not.toBeNull();

    // Click each cell in the 4x2 grid (8 cells)
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        const x = box!.x + (col + 0.5) * (box!.width / 4);
        const y = box!.y + (row + 0.5) * (box!.height / 2);
        await page.mouse.click(x, y);
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(500);
    collector.assertNoErrors('all direction cube cells clicked');
    collector.assertNoWebGPUErrors();
  });

  test('no WebGPU errors after projection toggle', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Toggle projection multiple times
    for (let i = 0; i < 3; i++) {
      await page.locator('.nav-proj-btn', { hasText: 'Ortho' }).click();
      await page.waitForTimeout(300);
      await page.locator('.nav-proj-btn', { hasText: 'Persp' }).click();
      await page.waitForTimeout(300);
    }

    collector.assertNoErrors('projection toggle');
    collector.assertNoWebGPUErrors();
  });

  test('no WebGPU errors after grid toggle', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Toggle grid on/off multiple times
    const gridBtn = page.locator('#bottom-panel button', { hasText: 'Grid' });
    for (let i = 0; i < 3; i++) {
      await gridBtn.click();
      await page.waitForTimeout(300);
    }

    collector.assertNoErrors('grid toggle');
    collector.assertNoWebGPUErrors();
  });

  test('no WebGPU errors after camera reset', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const resetBtn = page.locator('#bottom-panel button', { hasText: 'Reset View' });
    for (let i = 0; i < 3; i++) {
      await resetBtn.click();
      await page.waitForTimeout(300);
    }

    collector.assertNoErrors('camera reset');
    collector.assertNoWebGPUErrors();
  });

  test('no WebGPU errors after mouse drag on main canvas', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const canvas = page.locator('#webgpu-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Simulate mouse drag (rotate camera)
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(cx + i * 10, cy + i * 5);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    collector.assertNoErrors('mouse drag');
    collector.assertNoWebGPUErrors();
  });

  test('no WebGPU errors after mouse wheel zoom', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const canvas = page.locator('#webgpu-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Zoom in and out with mouse wheel
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -100); // zoom in
      await page.waitForTimeout(50);
    }
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100); // zoom out
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(500);

    collector.assertNoErrors('mouse wheel zoom');
    collector.assertNoWebGPUErrors();
  });
});

// ─── G-code Upload via UI ───────────────────────────────────────────

test.describe('G-code upload and render', () => {
  test('upload G-code via UI and verify no render errors', async ({ page }) => {
    const collector = setupErrorCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check if file input exists (may be hidden)
    const fileInput = page.locator('input[type="file"]');
    const inputCount = await fileInput.count();

    if (inputCount > 0) {
      // Upload via file input
      const gcode = 'G1 X0 Y0 Z0 F600\nG1 X10 Y0 Z0 E1\nG1 X10 Y10 Z0 E1\nG1 X0 Y10 Z0 E1\nG1 X0 Y0 Z0 E1\n';
      await fileInput.setInputFiles({
        name: 'test_square.gcode',
        mimeType: 'text/plain',
        buffer: Buffer.from(gcode),
      });

      // Wait for processing and rendering
      await page.waitForTimeout(5000);
    }

    collector.assertNoErrors('G-code upload and render');
    collector.assertNoWebGPUErrors();
  });

  test('upload G-code via API and load in viewer', async ({ page, request }) => {
    const collector = setupErrorCollector(page);

    // Upload via API (request is already an APIRequestContext in Playwright)
    const gcode = 'G1 X0 Y0 Z0 F600\nG1 X20 Y0 Z0 E1\nG1 X20 Y20 Z0 E1\nG1 X0 Y20 Z0 E1\nG1 X0 Y0 Z0 E1\n';
    const uploadResp = await request.post('http://localhost:8099/api/trajectory/upload', {
      headers: { 'Content-Type': 'text/plain' },
      params: { filename: 'api_test.gcode' },
      data: gcode,
    });
    expect(uploadResp.ok()).toBe(true);
    const { jobId } = await uploadResp.json();

    // Process
    await request.post(`http://localhost:8099/api/trajectory/${jobId}/process`);

    // Wait for processing
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      const statusResp = await request.get(`http://localhost:8099/api/trajectory/${jobId}/status`);
      if (statusResp.ok()) {
        const sj = await statusResp.json();
        if (sj.state === 'ready') break;
      }
    }

    // Navigate to viewer with job loaded
    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    collector.assertNoErrors('API upload + viewer load');
    collector.assertNoWebGPUErrors();
  });
});
