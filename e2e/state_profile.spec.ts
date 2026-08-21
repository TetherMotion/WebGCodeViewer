import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BASE = 'http://localhost:8099';
const ARC_GCODE = `G17
G1 X0 Y0 Z0 F600
G2 X50 Y0 I25 J0
M30`;

const SQUARE_GCODE = `G1 X0 Y0 Z0 F600
G1 X100 Y0 Z0 E1
G1 X100 Y100 Z0 E1
G1 X0 Y100 Z0 E1
G1 X0 Y0 Z0 E1
M30`;

async function uploadAndProcess(request: APIRequestContext, gcode: string, filename: string) {
  const uploadResp = await request.post(`${BASE}/api/trajectory/upload`, {
    headers: { 'Content-Type': 'text/plain' },
    params: { filename },
    data: gcode,
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

test.describe('WSS (TWSF) integration', () => {
  test('GET /api/trajectory/{jobId}/wss returns TWSF binary', async ({ request }) => {
    const jobId = await uploadAndProcess(request, ARC_GCODE, 'arc.gcode');
    const resp = await request.get(`${BASE}/api/trajectory/${jobId}/wss`);
    expect(resp.ok()).toBe(true);

    const buffer = await resp.body();
    expect(buffer.length).toBeGreaterThan(80);

    // Magic
    const magic = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
    expect(magic).toBe('TWSF');

    // Version (TWSF v2 includes extrusion ratios)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    expect(view.getUint16(4, true)).toBe(2);

    // Arc count
    const arcCount = view.getUint32(8, true);
    expect(arcCount).toBeGreaterThan(0);

    // Total length and total time (f64 at offsets 12 and 20)
    const totalLength = view.getFloat64(12, true);
    const totalTime = view.getFloat64(20, true);
    expect(totalLength).toBeGreaterThan(70);
    expect(totalLength).toBeLessThan(90);
    expect(totalTime).toBeGreaterThan(0);

    // Max velocity positive (f32 at offset 28)
    const maxV = view.getFloat32(28, true);
    expect(maxV).toBeGreaterThan(0);
  });

  test('loading arc G-code with velocity color mode produces no 404s', async ({ page, request }) => {
    const jobId = await uploadAndProcess(request, ARC_GCODE, 'arc_wss.gcode');
    const networkErrors: string[] = [];
    page.on('response', r => {
      if (r.status() >= 400) networkErrors.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(`${BASE}/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    expect(networkErrors).toEqual([]);
  });

  test('square G-code WSS has the correct path length', async ({ request }) => {
    const jobId = await uploadAndProcess(request, SQUARE_GCODE, 'square_wss.gcode');
    const resp = await request.get(`${BASE}/api/trajectory/${jobId}/wss`);
    expect(resp.ok()).toBe(true);
    const buffer = await resp.body();
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const totalLength = view.getFloat64(12, true);
    expect(totalLength).toBeGreaterThan(390);
    expect(totalLength).toBeLessThan(410);
  });
});
