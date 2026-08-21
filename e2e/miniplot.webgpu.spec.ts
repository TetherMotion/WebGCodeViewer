import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8099';
const SQUARE_GCODE = `G1 X0 Y0 Z0 F600
G1 X100 Y0 Z0 E1
G1 X100 Y100 Z0 E1
G1 X0 Y100 Z0 E1
G1 X0 Y0 Z0 E1
M30`;

async function uploadAndProcess(request: APIRequestContext) {
  const uploadResp = await request.post(`${BASE}/api/trajectory/upload`, {
    headers: { 'Content-Type': 'text/plain' },
    params: { filename: 'square.gcode' },
    data: SQUARE_GCODE,
  });
  expect(uploadResp.ok()).toBe(true);
  const { jobId } = await uploadResp.json();
  const processResp = await request.post(`${BASE}/api/trajectory/${jobId}/process`);
  expect(processResp.ok()).toBe(true);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 200));
    const s = await request.get(`${BASE}/api/trajectory/${jobId}/status`);
    const j = await s.json();
    if (j.state === 'ready' || j.state === 'failed') break;
  }
  return jobId;
}

test.describe('WSS miniplot (WebGPU)', () => {
  test('miniplot renders without console errors when toggled', async ({ page, request }) => {
    const jobId = await uploadAndProcess(request);
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/?job=${jobId}`);
    await page.waitForTimeout(2000);

    // The miniplot is now always visible by default (no toggle needed).
    // Wait for the WSS miniplot canvas (or compute miniplot fallback) to be present and visible.
    const canvas = page.locator('#miniplot-container canvas.wss-miniplot-canvas, #miniplot-container canvas.miniplot-compute-canvas');
    await expect(canvas).toBeVisible();

    expect(consoleErrors, 'No console errors while opening/running miniplot').toEqual([]);
  });
});
