/**
 * @file webgpu-autolayer-fix.spec.ts
 * @brief Verifies that loading a layered G-code does NOT auto-filter the
 *        toolpath to the topmost layer by default. Both the full toolpath
 *        and the printer frame should remain visible after load.
 *
 *        Also verifies the "Show only current Z layer" checkbox:
 *          - exists in the Playback > Layer section
 *          - defaults to unchecked
 *          - when checked, triggers auto-layer-filtering
 *          - when unchecked, restores the full toolpath
 */
import { test, expect, APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8099';

const LAYERED_GCODE = `
G1 X0 Y0 Z0 F600
G1 X10 Y0 Z0 E1
G1 X10 Y10 Z0 E1
G1 X0 Y10 Z0 E1
G1 X0 Y0 Z0 E1
G1 Z5
G1 X0 Y0 Z5 E1
G1 X10 Y0 Z5 E1
G1 X10 Y10 Z5 E1
G1 X0 Y10 Z5 E1
G1 X0 Y0 Z5 E1
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
async function openMenu(page: import('@playwright/test').Page, label: string) {
  await page.evaluate((menuLabel) => {
    const triggers = [...document.querySelectorAll('#top-panel .menu-trigger')];
    const trigger = triggers.find(el => el.textContent?.includes(menuLabel));
    const dropdown = trigger?.parentElement?.querySelector('.menu-dropdown') as HTMLElement | null;
    if (trigger && dropdown && !dropdown.classList.contains('open')) {
      (trigger as HTMLButtonElement).click();
    }
  }, label);
}

test.describe('Auto-layer-tracking: "Show only current Z layer" checkbox', () => {
  test('full toolpath visible after load; checkbox defaults unchecked', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, LAYERED_GCODE, 'autolayer_fix.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    await openMenu(page, 'Playback');

    // The layer label must say "All" — no layer filter auto-applied on load.
    const layerLabel = page.locator('#top-panel .menu-dropdown.open .layer-group .slider-value');
    await expect(layerLabel).toHaveText('All');

    // The "Show only current Z layer" checkbox must exist and be unchecked.
    const checkbox = page.locator('#top-panel .menu-dropdown.open #auto-layer-filter');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  test('checking the box enables auto-layer-filter; unchecking restores full toolpath', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, LAYERED_GCODE, 'autolayer_checkbox.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    await openMenu(page, 'Playback');

    const checkbox = page.locator('#top-panel .menu-dropdown.open #auto-layer-filter');
    const layerLabel = page.locator('#top-panel .menu-dropdown.open .layer-group .slider-value');

    // Initially "All"
    await expect(layerLabel).toHaveText('All');

    // Check the box — auto-layer-tracking kicks in at progress=1.0 (top layer)
    await checkbox.check();
    await page.waitForTimeout(1000);

    // The label should now show a specific layer (the topmost, since
    // playProgress starts at 1.0 = end of print)
    await expect(layerLabel).not.toHaveText('All');

    // Uncheck — full toolpath restored
    await checkbox.uncheck();
    await page.waitForTimeout(1000);
    await expect(layerLabel).toHaveText('All');
  });
});
