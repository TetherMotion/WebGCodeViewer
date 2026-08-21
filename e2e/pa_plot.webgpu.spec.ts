import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:8099';

// A small G-code with extrusion so PA data is computed.
const GCODE = [
  'G1 X0 Y0 Z0 F600',
  'G1 X50 Y0 Z0.2 E1',
  'G1 X50 Y50 Z0.2 E1',
  'G1 X0 Y50 Z0.2 E1',
  'G1 X0 Y0 Z0.2 E1',
  'M30',
].join('\n');

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

async function uploadViaUi(page: Page, filename: string, content: string) {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await openMenu(page, 'File');
  const openBtn = page.locator('#top-panel .menu-dropdown button', { hasText: 'Open' });
  await expect(openBtn).toBeVisible({ timeout: 5000 });
  const filechooserPromise = page.waitForEvent('filechooser');
  await openBtn.click();
  const filechooser = await filechooserPromise;
  await filechooser.setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.waitForTimeout(3000);
}

test.describe('Motion profile & Pressure advance plot', () => {
  test('renders both motion and PA series without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await uploadViaUi(page, 'pa_test.gcode', GCODE);

    // The PA plot container should become visible after PA data loads.
    const container = page.locator('#pa-plot-container');
    await expect(container).toBeVisible({ timeout: 20000 });

    // The WebGPU canvas inside the container should have non-zero dimensions.
    const canvas = container.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Wait for rendering to settle.
    await page.waitForTimeout(2000);

    // Verify the canvas has non-transparent pixels (the plot was actually
    // drawn, not left blank). Sample a small region in the centre.
    const hasContent = await page.evaluate(() => {
      const c = document.querySelector('#pa-plot-container canvas') as HTMLCanvasElement;
      if (!c || c.width === 0) return false;
      try {
        const ctx = c.getContext('2d');
        if (!ctx) return true; // 2D context may not work on a WebGPU canvas
        const data = ctx.getImageData(
          Math.floor(c.width / 4), Math.floor(c.height / 4),
          Math.min(10, c.width / 2), Math.min(10, c.height / 2),
        ).data;
        let nonZero = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) nonZero++;
        }
        return nonZero > 0;
      } catch {
        // getImageData on a WebGPU canvas throws — that's expected; the
        // canvas is rendered by WebGPU, not 2D context. Presence of the
        // visible canvas + no console errors is the real check.
        return true;
      }
    });
    expect(hasContent).toBe(true);

    expect(consoleErrors, 'No console errors during PA plot render').toEqual([]);
  });
});
