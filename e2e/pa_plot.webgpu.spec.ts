import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:8099';

/// Count pixels in a PNG screenshot that look like the velocity curve color
/// (blue [0.29, 0.62, 1.0]). This avoids needing a screenshot baseline and
/// catches regressions where the miniplot compute shader fails to draw.
async function countVelocityPixels(page: Page, pngBase64: string): Promise<number> {
  return page.evaluate((base64) => {
    return new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(0); return; }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Velocity color is ~[74, 158, 255]; be tolerant of AA/DPR variation.
          if (b > 200 && r < 100 && g < 180) {
            count++;
          }
        }
        resolve(count);
      };
      img.onerror = () => resolve(0);
      img.src = `data:image/png;base64,${base64}`;
    });
  }, pngBase64);
}

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

test.describe('Pressure advance in miniplot', () => {
  test('PA algorithm selector and PA Offset quantity work without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await uploadViaUi(page, 'pa_test.gcode', GCODE);

    // The miniplot section should be visible (always visible now).
    const section = page.locator('#miniplot-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    // The PA algorithm selector should be present in the miniplot toolbar.
    const algoSelect = page.locator('#miniplot-algorithm-select');
    await expect(algoSelect).toBeVisible({ timeout: 20000 });

    // Select "PA Offset" as the quantity.
    const quantitySelect = page.locator('#miniplot-quantity-select');
    await quantitySelect.selectOption('PA Offset');
    await page.waitForTimeout(1000);

    // Switch to a different PA algorithm (PowerLaw).
    await algoSelect.selectOption('1');
    await page.waitForTimeout(1000);

    // Switch to another algorithm (CrossWLF).
    await algoSelect.selectOption('2');
    await page.waitForTimeout(1000);

    // Switch back to velocity.
    await quantitySelect.selectOption('Velocity');
    await page.waitForTimeout(500);

    expect(consoleErrors, 'No console errors during PA miniplot render').toEqual([]);

    // Regression: the Velocity curve must actually be drawn.
    const canvas = page.locator('#miniplot-canvas');
    await expect(canvas).toBeVisible();
    const screenshot = (await canvas.screenshot({ type: 'png' })).toString('base64');
    const velocityPixels = await countVelocityPixels(page, screenshot);
    expect(velocityPixels, 'Velocity curve should be visible in the miniplot').toBeGreaterThan(10);
  });
});
