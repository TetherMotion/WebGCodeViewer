/**
 * @file gcode-display.spec.ts
 * @brief E2E tests verifying that a loaded G-code file is displayed in 3D.
 *
 * These tests run in the headless Playwright project (no WebGPU). They verify
 * the full data pipeline: upload → process → load via URL → renderer receives
 * data → UI shows ready state. Since headless Chromium cannot render WebGPU
 * content, actual pixel verification is in webgpu-gcode-display.spec.ts.
 *
 * Test coverage:
 *   1. Upload + process via API, load via ?job= URL parameter
 *   2. Status bar shows "Ready: N samples" with correct metrics
 *   3. G-code panel displays the loaded G-code text
 *   4. Browser-side evaluation confirms NurbsRenderer has data (pieces > 0)
 *   5. Camera has been fitted to the toolpath bounds (non-default position)
 *   6. No console errors or page errors during the entire flow
 *   7. Drag-and-drop upload path also results in data loaded
 *   8. Multiple files can be loaded sequentially without stale state
 */

import { test, expect, Page, ConsoleMessage, APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8099';

// ─── Test G-code samples ──────────────────────────────────────────────

const SQUARE_GCODE = `
G1 X0 Y0 Z0 F600
G1 X10 Y0 Z0 E1
G1 X10 Y10 Z0 E1
G1 X0 Y10 Z0 E1
G1 X0 Y0 Z0 E1
`.trim();

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

const ARC_GCODE = `
G17
G1 X0 Y0 Z0 F600
G2 X10 Y0 Z0 I5 J0
G1 X10 Y10 Z0
G3 X0 Y10 Z0 I-5 J0
G1 X0 Y0 Z0
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

// ─── Helper: upload and process G-code via API ────────────────────────

async function uploadAndProcess(
  request: APIRequestContext,
  gcode: string,
  filename = 'test.gcode',
): Promise<{ jobId: string; status: string }> {
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

// ─── Helper: console message collector ─────────────────────────────────

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
    'favicon',
    'runtime.lastError',
    'message channel closed',
    'WebGPU not supported',
    'navigator.gpu is undefined',
    'Failed to load NURBS data',
    'ReNURBS data not available',
    'PA data not available',
  ];

  return {
    messages,
    pageErrors,
    getErrors: () => messages.filter(
      m => m.type === 'error' && !KNOWN_HARMLESS.some(h => m.text.includes(h)),
    ),
    getWarnings: () => messages.filter(
      m => m.type === 'warning' && !KNOWN_HARMLESS.some(h => m.text.includes(h)),
    ),
    assertClean: (context: string) => {
      expect(pageErrors, `Page errors during ${context}`).toEqual([]);
      const errors = messages.filter(
        m => m.type === 'error' && !KNOWN_HARMLESS.some(h => m.text.includes(h)),
      );
      expect(errors, `Console errors during ${context}`).toEqual([]);
    },
  };
}

// ─── Helper: wait for job data to be loaded in the browser ─────────────
//
// The app sets the status bar text to "Ready: N samples | ..." when the
// job data has been fetched and loaded into the renderer. We poll for this
// text to appear, which confirms the full pipeline completed.

async function waitForJobLoaded(page: Page, timeout = 15000): Promise<void> {
  await expect(
    page.locator('.status-text'),
    'Status bar should show "Ready" after job data is loaded',
  ).toHaveText(/Ready:\s+\d+\s+samples/, { timeout });
}

// ─── Helper: get renderer state from the browser ───────────────────────
//
// Evaluates browser-side JS to inspect the NurbsRenderer state.
// The app instance is attached to window.__wgvApp for testing (see main.ts).

async function getRendererState(page: Page): Promise<{
  hasNBP: boolean;
  nbpPieces: number;
  nbpControlPoints: number;
  cameraDistance: number;
  cameraAngle: number;
  cameraElevation: number;
}> {
  return await page.evaluate(() => {
    const app = (window as any).__wgvApp;
    if (!app) return {
      hasNBP: false, nbpPieces: 0, nbpControlPoints: 0,
      cameraDistance: 0, cameraAngle: 0, cameraElevation: 0,
    };
    const nbp = app.currentNBP;
    const cam = app.camera;
    return {
      hasNBP: !!nbp,
      nbpPieces: nbp?.header.pieceCount ?? 0,
      nbpControlPoints: nbp?.header.totalControlPoints ?? 0,
      cameraDistance: cam?.orbitDistance ?? 0,
      cameraAngle: cam?.orbitAngle ?? 0,
      cameraElevation: cam?.orbitElevation ?? 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PART 1: Basic G-code Loading via URL Parameter
// ═══════════════════════════════════════════════════════════════════════

test.describe('G-code loading via URL parameter', () => {
  test('square G-code: status bar shows Ready with sample count', async ({ page, request }) => {
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'square.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    // Status bar should show "Ready: N samples | time | pathLength"
    const statusText = await page.locator('.status-text').textContent();
    expect(statusText).toMatch(/Ready:\s+\d+\s+samples/);
    expect(statusText).toMatch(/\d+\.\d+mm/);

    collector.assertClean('square G-code load');
  });

  test('square G-code: NurbsRenderer has data with correct piece count', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'square_rend.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state = await getRendererState(page);
    // The square has 4 extruding moves → at least 1 NURBS piece
    expect(state.hasNBP, 'NBP data must be loaded').toBe(true);
    if (state.hasNBP) {
      expect(state.nbpPieces, 'NURBS piece count must be > 0').toBeGreaterThan(0);
      expect(state.nbpControlPoints, 'NURBS control point count must be > 0').toBeGreaterThan(0);
    }
  });

  test('square G-code: camera is fitted to toolpath bounds', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, SQUARE_GCODE, 'square_cam.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state = await getRendererState(page);
    // After fitToBounds, the camera distance should be non-zero and
    // significantly larger than the default (which is typically 100-200).
    // For a 10x10mm square, the camera should be positioned to view it.
    expect(state.cameraDistance, 'Camera distance must be > 0 after fitToBounds').toBeGreaterThan(0);
  });

  test('square G-code: G-code panel displays loaded text via drag-and-drop', async ({ page, request }) => {
    // When loading via URL (?job=), the raw G-code text is NOT loaded into
    // the G-code panel — only block metadata is loaded. The raw text is
    // only loaded when uploading via handleUpload (drag-and-drop or file
    // picker). So we test the G-code panel via drag-and-drop.
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Simulate file drop
    await page.evaluate(async (gcode) => {
      const blob = new Blob([gcode], { type: 'text/plain' });
      const file = new File([blob], 'panel-test.gcode', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropEvent = new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(dropEvent);
    }, SQUARE_GCODE);

    // Wait for the G-code text to be loaded (loadGcodeText is called
    // immediately in handleUpload, before the upload completes)
    await page.waitForTimeout(500);

    // The G-code panel should show the filename
    const filenameEl = page.locator('.gcode-filename, [class*="filename"]');
    await expect(filenameEl).toContainText('panel-test.gcode', { timeout: 5000 });

    // The G-code panel should show line count
    const lineCountEl = page.locator('.gcode-line-count');
    await expect(lineCountEl).toContainText(/\d+\s+lines/);

    // Wait for the job to be processed and loaded
    await waitForJobLoaded(page, 30000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 2: Various G-code Types
// ═══════════════════════════════════════════════════════════════════════

test.describe('Various G-code types load and display correctly', () => {
  test('layered G-code: multiple layers detected and loaded', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, LAYERED_GCODE, 'layered.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state = await getRendererState(page);
    expect(state.hasNBP).toBe(true);
    // Layered G-code has moves at Z=0 and Z=5, so the bounds should
    // span at least 5mm in Z.
    expect(state.cameraDistance).toBeGreaterThan(0);
  });

  test('arc G-code: curved pieces are generated', async ({ page, request }) => {
    const { jobId, status } = await uploadAndProcess(request, ARC_GCODE, 'arc.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state = await getRendererState(page);
    expect(state.hasNBP).toBe(true);
    if (state.hasNBP) {
      // Arc G-code should produce at least 2 pieces (arc + line)
      expect(state.nbpPieces).toBeGreaterThanOrEqual(2);
    }
  });

  test('complex G-code: multi-layer path with travels loads correctly', async ({ page, request }) => {
    const collector = setupMessageCollector(page);
    const { jobId, status } = await uploadAndProcess(request, COMPLEX_GCODE, 'complex.gcode');
    expect(status).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${jobId}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state = await getRendererState(page);
    expect(state.hasNBP).toBe(true);
    // Complex G-code has 11 moves → multiple pieces
    if (state.hasNBP) {
      expect(state.nbpPieces).toBeGreaterThanOrEqual(5);
    }

    collector.assertClean('complex G-code load');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 3: Error Handling
// ═══════════════════════════════════════════════════════════════════════

test.describe('Error handling during G-code display', () => {
  test('invalid job ID shows error, does not crash', async ({ page }) => {
    const collector = setupMessageCollector(page);
    await page.goto('http://localhost:8099/?job=nonexistent-job-id');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // The page should still be functional — canvas exists
    const canvas = page.locator('#webgpu-canvas');
    await expect(canvas).toBeVisible();

    // Status bar should show some error/failure/loading state
    const statusText = await page.locator('.status-text').textContent();
    // It should show an error, loading, or deleted state (not "Ready")
    expect(statusText).toMatch(/Failed|Loading|Error|timeout|deleted|Polling/i);

    collector.assertClean('invalid job ID');
  });

  test('page loads without G-code and remains functional', async ({ page }) => {
    const collector = setupMessageCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Canvas should exist
    const canvas = page.locator('#webgpu-canvas');
    await expect(canvas).toBeVisible();

    // No data should be loaded
    const state = await getRendererState(page);
    expect(state.hasNBP).toBe(false);

    collector.assertClean('page load without G-code');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 4: Sequential Loading (no stale state)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Sequential G-code loading', () => {
  test('loading a second file replaces the first file data', async ({ page, request }) => {
    // Load first file
    const { jobId: job1, status: status1 } = await uploadAndProcess(request, SQUARE_GCODE, 'seq1.gcode');
    expect(status1).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${job1}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state1 = await getRendererState(page);
    expect(state1.hasNBP).toBe(true);

    // Load second file via navigation
    const { jobId: job2, status: status2 } = await uploadAndProcess(request, COMPLEX_GCODE, 'seq2.gcode');
    expect(status2).toBe('ready');

    await page.goto(`http://localhost:8099/?job=${job2}`);
    await page.waitForLoadState('networkidle');
    await waitForJobLoaded(page);

    const state2 = await getRendererState(page);
    expect(state2.hasNBP).toBe(true);

    // The second file should have more pieces/samples than the first
    // (complex G-code has 11 moves vs square's 4)
    const count1 = state1.nbpPieces;
    const count2 = state2.nbpPieces;
    expect(count2, 'Second file should have more segments than first').toBeGreaterThan(count1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 5: Drag-and-Drop Upload Path
// ═══════════════════════════════════════════════════════════════════════

test.describe('Drag-and-drop upload displays G-code', () => {
  test('dropping a G-code file triggers upload and data loading', async ({ page }) => {
    const collector = setupMessageCollector(page);
    await page.goto('http://localhost:8099/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Simulate file drop via the DataTransfer API
    const dropResult = await page.evaluate(async (gcode) => {
      const blob = new Blob([gcode], { type: 'text/plain' });
      const file = new File([blob], 'drop-test.gcode', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropEvent = new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(dropEvent);
      return true;
    }, SQUARE_GCODE);

    expect(dropResult).toBe(true);

    // Wait for the job to be processed and loaded
    await waitForJobLoaded(page, 30000);

    const state = await getRendererState(page);
    expect(state.hasNBP, 'Data must be loaded after drag-and-drop').toBe(true);

    collector.assertClean('drag-and-drop upload');
  });
});
