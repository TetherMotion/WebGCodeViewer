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
             e.includes('minBindingSize'),
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
});
