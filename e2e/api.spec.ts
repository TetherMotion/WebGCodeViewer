/**
 * @file api.spec.ts
 * @brief E2E tests for the REST API endpoints.
 *
 * These tests exercise the server's HTTP endpoints directly, focusing on:
 *   - G-code upload → process → fetch binary round-trip
 *   - NBP (NURBS binary) format correctness
 *   - Error handling: invalid input returns 400, not 500
 *   - Thread safety: concurrent requests don't crash
 */

import { test, expect, request } from '@playwright/test';

const BASE = 'http://localhost:8099';

// Minimal G-code that produces a simple square toolpath
const SIMPLE_GCODE = `
G28
G1 X0 Y0 Z0 F600
G1 X10 Y0 Z0 E1
G1 X10 Y10 Z0 E1
G1 X0 Y10 Z0 E1
G1 X0 Y0 Z0 E1
G1 X5 Y5 Z5
G0 X0 Y0 Z10
`.trim();

// G-code with arcs (G2/G3)
const ARC_GCODE = `
G17
G1 X0 Y0 Z0 F600
G2 X10 Y0 Z0 I5 J0
G3 X0 Y0 Z0 I-5 J0
`.trim();

async function uploadAndProcess(gcode: string, filename = 'test.gcode'):
  Promise<{ jobId: string; status: string }> {
  const ctx = await request.newContext();
  // Upload
  const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
    headers: { 'Content-Type': 'text/plain' },
    params: { filename },
    data: gcode,
  });
  expect(uploadResp.ok()).toBe(true);
  const uploadJson = await uploadResp.json();
  const jobId = uploadJson.jobId;
  expect(jobId).toBeTruthy();

  // Start processing
  const procResp = await ctx.post(`${BASE}/api/trajectory/${jobId}/process`);
  expect(procResp.ok()).toBe(true);

  // Poll until ready (max ~10 seconds)
  let status = 'processing';
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    const statusResp = await ctx.get(`${BASE}/api/trajectory/${jobId}/status`);
    if (statusResp.ok()) {
      const sj = await statusResp.json();
      status = sj.state;
      if (status === 'ready' || status === 'failed') break;
    }
  }

  await ctx.dispose();
  return { jobId, status };
}

// ─── Upload & Process ───────────────────────────────────────────────

test.describe('Upload and process', () => {
  test('upload G-code and process to ready state', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');
    expect(jobId).toBeTruthy();
  });

  test('upload returns 400 for empty body', async () => {
    const ctx = await request.newContext();
    const resp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      data: '',
    });
    expect(resp.status()).toBe(400);
    await ctx.dispose();
  });

  test('process returns 409 for non-existent job', async () => {
    const ctx = await request.newContext();
    const resp = await ctx.post(`${BASE}/api/trajectory/nonexistent-id/process`);
    expect(resp.status()).toBe(409);
    await ctx.dispose();
  });

  test('status returns deleted state for non-existent job', async () => {
    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/nonexistent-id/status`);
    expect(resp.status()).toBe(200);
    const json = await resp.json();
    expect(json.state).toBe('deleted');
    await ctx.dispose();
  });
});

// ─── Binary Data Fetch ──────────────────────────────────────────────

test.describe('Binary data', () => {
  test('fetch TTHR binary data for processed job', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/binary`);
    expect(resp.ok()).toBe(true);
    const buf = await resp.body();
    expect(buf.length).toBeGreaterThan(0);

    // Check TTHR magic
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(magic).toBe('TTHR');
    await ctx.dispose();
  });

  test('fetch NBP binary data for processed job', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/nurbs`);
    expect(resp.ok()).toBe(true);
    const buf = await resp.body();
    expect(buf.length).toBeGreaterThan(0);

    // Check NBP magic
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(magic).toBe('TNBP');

    // Check version (u16 LE at offset 4) — v3 adds per-piece extruderSpeed field
    const version = buf[4] | (buf[5] << 8);
    expect(version).toBe(3);

    // Check dim (u8 at offset 6)
    const dim = buf[6];
    expect(dim).toBe(3);

    // Check reserved[3] at offsets 7, 8, 9 — must be zero
    expect(buf[7]).toBe(0);
    expect(buf[8]).toBe(0);
    expect(buf[9]).toBe(0);

    // pieceCount (u32 LE at offset 10) — should be > 0 for our G-code
    const pieceCount = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    expect(pieceCount).toBeGreaterThan(0);

    await ctx.dispose();
  });

  test('NBP header is exactly 82 bytes (3 reserved bytes, not 1)', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/nurbs`);
    expect(resp.ok()).toBe(true);
    const buf = await resp.body();

    // The header is 82 bytes. After the header comes the piece table.
    // If the header were 80 bytes (1 reserved byte), the piece table
    // would start at offset 80, but the serializer writes 82 bytes.
    // We verify by checking that pieceCount at offset 10 is reasonable
    // and that the first piece entry's degree at offset 82 is valid.
    const pieceCount = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    expect(pieceCount).toBeGreaterThan(0);
    expect(pieceCount).toBeLessThan(10000); // sanity check

    // First piece entry starts at offset 82
    // degree (u8) should be 1 (linear) or 2+ (arc)
    const firstDegree = buf[82];
    expect(firstDegree).toBeGreaterThanOrEqual(1);
    expect(firstDegree).toBeLessThanOrEqual(3);

    // reserved[3] of first piece entry at offsets 83, 84, 85
    expect(buf[83]).toBe(0);
    expect(buf[84]).toBe(0);
    expect(buf[85]).toBe(0);

    await ctx.dispose();
  });

  test('NBP contains extruder speed for G-code with E values', async () => {
    // G-code with extrusion (E axis)
    const extrudeGcode =
      'G21\nG90\nG92 E0\nM82\n' +
      'G0 X0 Y0 Z5 F3000\n' +
      'G1 X10 Y0 Z5 E1 F1800\n' +
      'G1 X20 Y0 Z5 E2 F1800\n' +
      'M30\n';

    const { jobId, status } = await uploadAndProcess(extrudeGcode);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/nurbs`);
    expect(resp.ok()).toBe(true);
    const buf = await resp.body();
    expect(buf.length).toBeGreaterThan(82);

    // Verify NBP version 3
    const version = buf[4] | (buf[5] << 8);
    expect(version).toBe(3);

    const pieceCount = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    expect(pieceCount).toBeGreaterThan(0);

    // Check that at least one piece has non-zero extruderSpeed
    // Piece entry is 24 bytes starting at offset 82
    // Layout: degree(1) + res(3) + cpCount(4) + knotCount(4) + motionType(1) + res(3) + deviation(4) + extruderSpeed(4)
    // extruderSpeed offset within entry = 20
    let hasNonZeroExtruderSpeed = false;
    for (let i = 0; i < pieceCount; i++) {
      const entryOff = 82 + i * 24 + 20; // extruderSpeed at offset 20 within entry
      const espeedBytes = buf[entryOff] | (buf[entryOff + 1] << 8) | (buf[entryOff + 2] << 16) | (buf[entryOff + 3] << 24);
      const espeed = new Float32Array(new Uint8Array([buf[entryOff], buf[entryOff + 1], buf[entryOff + 2], buf[entryOff + 3]]).buffer)[0];
      if (espeed > 0.01) hasNonZeroExtruderSpeed = true;
    }
    expect(hasNonZeroExtruderSpeed).toBe(true);

    await ctx.dispose();
  });

  test('fetch speeds JSON for miniplot', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/speeds`);
    expect(resp.ok()).toBe(true);
    const json = await resp.json();

    expect(json.totalTime).toBeGreaterThan(0);
    expect(json.totalSegments).toBeGreaterThan(0);
    expect(json.segments.length).toBe(json.totalSegments);
    expect(json.segments.length).toBeGreaterThan(0);

    // Check first segment structure
    const seg = json.segments[0];
    expect(seg).toHaveProperty('timeStart');
    expect(seg).toHaveProperty('duration');
    expect(seg).toHaveProperty('blockIndex');
    expect(seg).toHaveProperty('lineNumber');
    expect(seg).toHaveProperty('speedX');
    expect(seg).toHaveProperty('speedY');
    expect(seg).toHaveProperty('speedZ');
    expect(seg).toHaveProperty('speedE');
    expect(seg).toHaveProperty('speedLinear');

    // At least one segment should have non-zero speedE (extrusion)
    const hasExtrusion = json.segments.some((s: any) => s.speedE > 0.01);
    expect(hasExtrusion).toBe(true);

    await ctx.dispose();
  });

  test('fetch blocks JSON for processed job', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/blocks`);
    expect(resp.ok()).toBe(true);
    const json = await resp.json();
    expect(Array.isArray(json.blocks)).toBe(true);
    await ctx.dispose();
  });

  test('fetch zlayers JSON for processed job', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/zlayers`);
    expect(resp.ok()).toBe(true);
    const json = await resp.json();
    expect(json.layers).toBeDefined();
    expect(json.totalLayers).toBeDefined();
    expect(json.totalLayers).toBeGreaterThanOrEqual(0);
    await ctx.dispose();
  });

  test('fetch statistics JSON for processed job', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/statistics`);
    expect(resp.ok()).toBe(true);
    const json = await resp.json();
    expect(json).toHaveProperty('sampleCount');
    await ctx.dispose();
  });
});

// ─── Error Handling: Bad Input ──────────────────────────────────────

test.describe('Error handling — bad input returns 400, not 500', () => {
  test('process endpoint: invalid sampleRate returns 400', async () => {
    const ctx = await request.newContext();
    // First upload valid G-code
    const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      data: SIMPLE_GCODE,
    });
    const { jobId } = await uploadResp.json();

    // Try to process with invalid sampleRate
    const resp = await ctx.post(
      `${BASE}/api/trajectory/${jobId}/process?sampleRate=not-a-number`,
    );
    expect(resp.status()).toBe(400);
    const body = await resp.text();
    expect(body).toContain('Invalid');
    await ctx.dispose();
  });

  test('process endpoint: invalid maxVelocity returns 400', async () => {
    const ctx = await request.newContext();
    const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      data: SIMPLE_GCODE,
    });
    const { jobId } = await uploadResp.json();

    const resp = await ctx.post(
      `${BASE}/api/trajectory/${jobId}/process?maxVelocity=abc`,
    );
    expect(resp.status()).toBe(400);
    await ctx.dispose();
  });

  test('binary endpoint: invalid axes parameter returns 400', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(
      `${BASE}/api/trajectory/${jobId}/binary?axes=xyz`,
    );
    expect(resp.status()).toBe(400);
    await ctx.dispose();
  });

  test('binary endpoint: invalid downsample returns 400', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(
      `${BASE}/api/trajectory/${jobId}/binary?downsample=not-a-number`,
    );
    expect(resp.status()).toBe(400);
    await ctx.dispose();
  });

  test('binary endpoint: invalid start time returns 400', async () => {
    const { jobId, status } = await uploadAndProcess(SIMPLE_GCODE);
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(
      `${BASE}/api/trajectory/${jobId}/binary?start=not-a-number`,
    );
    expect(resp.status()).toBe(400);
    await ctx.dispose();
  });
});

// ─── Thread Safety ──────────────────────────────────────────────────

test.describe('Thread safety', () => {
  test('concurrent status polls during processing do not crash', async () => {
    const ctx = await request.newContext();
    const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      data: SIMPLE_GCODE,
    });
    const { jobId } = await uploadResp.json();
    await ctx.post(`${BASE}/api/trajectory/${jobId}/process`);

    // Fire 10 concurrent status requests
    const promises = Array.from({ length: 10 }, () =>
      ctx.get(`${BASE}/api/trajectory/${jobId}/status`),
    );
    const responses = await Promise.all(promises);
    for (const r of responses) {
      expect(r.status()).toBe(200);
    }
    await ctx.dispose();
  });

  test('multiple jobs can be processed concurrently', async () => {
    const ctx = await request.newContext();

    // Upload 3 jobs
    const jobIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const resp = await ctx.post(`${BASE}/api/trajectory/upload`, {
        headers: { 'Content-Type': 'text/plain' },
        params: { filename: `concurrent_${i}.gcode` },
        data: SIMPLE_GCODE,
      });
      const json = await resp.json();
      jobIds.push(json.jobId);
    }

    // Start all 3 processing concurrently
    await Promise.all(jobIds.map(id =>
      ctx.post(`${BASE}/api/trajectory/${id}/process`),
    ));

    // Wait for all to complete
    const statuses: string[] = [];
    for (let poll = 0; poll < 40; poll++) {
      await new Promise(r => setTimeout(r, 250));
      statuses.length = 0;
      for (const id of jobIds) {
        const r = await ctx.get(`${BASE}/api/trajectory/${id}/status`);
        if (r.ok()) {
          const j = await r.json();
          statuses.push(j.state);
        }
      }
      if (statuses.every(s => s === 'ready' || s === 'failed')) break;
    }

    // All jobs should reach ready state
    expect(statuses.every(s => s === 'ready')).toBe(true);
    await ctx.dispose();
  });
});

// ─── Job Lifecycle ──────────────────────────────────────────────────

test.describe('Job lifecycle', () => {
  test('list jobs includes uploaded job', async () => {
    const ctx = await request.newContext();
    const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      params: { filename: 'lifecycle_test.gcode' },
      data: SIMPLE_GCODE,
    });
    const { jobId } = await uploadResp.json();

    const listResp = await ctx.get(`${BASE}/api/trajectory/jobs`);
    expect(listResp.ok()).toBe(true);
    const json = await listResp.json();
    expect(json.jobs).toBeDefined();
    const found = json.jobs.some((j: any) => j.id === jobId);
    expect(found).toBe(true);
    await ctx.dispose();
  });

  test('delete job removes it from list', async () => {
    const ctx = await request.newContext();
    const uploadResp = await ctx.post(`${BASE}/api/trajectory/upload`, {
      headers: { 'Content-Type': 'text/plain' },
      data: SIMPLE_GCODE,
    });
    const { jobId } = await uploadResp.json();

    const delResp = await ctx.delete(`${BASE}/api/trajectory/${jobId}`);
    expect(delResp.ok()).toBe(true);

    // Status should now return deleted state
    const statusResp = await ctx.get(`${BASE}/api/trajectory/${jobId}/status`);
    expect(statusResp.status()).toBe(200);
    const json = await statusResp.json();
    expect(json.state).toBe('deleted');
    await ctx.dispose();
  });
});

// ─── Arc G-code ─────────────────────────────────────────────────────

test.describe('Arc G-code processing', () => {
  test('arc G-code produces NBP with arc pieces', async () => {
    const { jobId, status } = await uploadAndProcess(ARC_GCODE, 'arcs.gcode');
    expect(status).toBe('ready');

    const ctx = await request.newContext();
    const resp = await ctx.get(`${BASE}/api/trajectory/${jobId}/nurbs`);
    expect(resp.ok()).toBe(true);
    const buf = await resp.body();

    // Verify NBP magic
    const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(magic).toBe('TNBP');

    // pieceCount should be > 0
    const pieceCount = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    expect(pieceCount).toBeGreaterThan(0);

    // At least one piece should have degree > 1 (arc = degree 2+)
    let hasArc = false;
    for (let i = 0; i < pieceCount && i < 20; i++) {
      const entryOffset = 82 + i * 16;
      const degree = buf[entryOffset];
      if (degree > 1) {
        hasArc = true;
        break;
      }
    }
    expect(hasArc).toBe(true);

    await ctx.dispose();
  });
});
