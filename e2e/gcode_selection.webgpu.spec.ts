import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:8099';

// A small multi-layer G-code so the same-Z detection has something to work with.
const LAYERED_GCODE = [
  'G1 X0 Y0 Z0 F600',
  'G1 X50 Y0 Z0.2 E1',
  'G1 X50 Y50 Z0.2 E1',
  'G1 X0 Y50 Z0.2 E1',
  'G1 X0 Y0 Z0.2 E1',
  'G1 Z0.4',
  'G1 X0 Y0 Z0.4 E1',
  'G1 X50 Y0 Z0.4 E1',
  'G1 X50 Y50 Z0.4 E1',
  'G1 X0 Y50 Z0.4 E1',
  'G1 X0 Y0 Z0.4 E1',
  'M30',
].join('\n');

/// Open a dropdown menu by clicking its trigger button (idempotent), matching
/// the production menu markup (.menu-trigger + .menu-dropdown.open).
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

/// Upload a G-code file via the UI file chooser so the G-code panel is
/// populated (the ?job= URL flow does not load G-code text). Waits until the
/// job is processed and G-code lines are rendered.
async function uploadViaUi(page: Page, filename: string, content: string) {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Open the File menu and click "Open…" which triggers a file chooser.
  await openMenu(page, 'File');
  const openBtn = page.locator('#top-panel .menu-dropdown button', { hasText: 'Open' });
  await expect(openBtn).toBeVisible({ timeout: 5000 });

  const filechooserPromise = page.waitForEvent('filechooser');
  await openBtn.click();
  const filechooser = await filechooserPromise;
  await filechooser.setFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(content) });

  // Wait for processing to finish and G-code lines to appear.
  await expect(page.locator('.gcode-line').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
}

async function openPlotMenuAndToggleMiniplot(page: Page) {
  await openMenu(page, 'Plot');
  const miniplotBtn = page.locator('#top-panel .menu-dropdown button', { hasText: 'Miniplot' });
  await expect(miniplotBtn).toBeVisible({ timeout: 5000 });
  await miniplotBtn.click();
  await page.waitForTimeout(500);
}

test.describe('G-code multi-line selection', () => {
  test('shift+click selects a range and zooms the miniplot without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await uploadViaUi(page, 'layered.gcode', LAYERED_GCODE);
    // Miniplot is now always visible by default — no need to toggle.
    await expect(page.locator('#miniplot-container')).toBeVisible({ timeout: 10000 });

    // Select a range of G-code lines via shift+click.
    const gcodeLines = page.locator('.gcode-line');
    const count = await gcodeLines.count();
    expect(count).toBeGreaterThan(2);
    await gcodeLines.nth(1).click();
    await page.waitForTimeout(200);
    await gcodeLines.nth(3).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(800);

    // The selected lines should carry the selected-range class.
    const selectedCount = await page.locator('.gcode-line.selected-range').count();
    expect(selectedCount).toBeGreaterThanOrEqual(1);

    // The miniplot label should reflect a zoomed view range.
    const label = page.locator('#miniplot-label');
    if (await label.count() > 0) {
      const text = await label.textContent();
      expect(text).toContain('t:');
    }

    expect(consoleErrors, 'No console errors during multi-line selection').toEqual([]);
  });

  test('ctrl+click toggles disjoint lines and clears on plain click', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await uploadViaUi(page, 'layered.gcode', LAYERED_GCODE);

    const gcodeLines = page.locator('.gcode-line');
    const count = await gcodeLines.count();
    expect(count).toBeGreaterThan(3);

    // Ctrl+click two non-adjacent lines → both highlighted.
    await gcodeLines.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);
    await gcodeLines.nth(3).click({ modifiers: ['Control'] });
    await page.waitForTimeout(200);
    expect(await page.locator('.gcode-line.selected-range').count()).toBe(2);

    // Ctrl+click line 1 again → removed, only line 3 stays.
    await gcodeLines.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(200);
    expect(await page.locator('.gcode-line.selected-range').count()).toBe(1);

    // Plain click on a line collapses to a single-line selection.
    await gcodeLines.nth(0).click();
    await page.waitForTimeout(200);
    expect(await page.locator('.gcode-line.selected-range').count()).toBe(1);

    expect(consoleErrors, 'No console errors during ctrl+click selection').toEqual([]);
  });
});
