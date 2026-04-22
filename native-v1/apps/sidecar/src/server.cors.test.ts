// N2.1.1 Task 2 — CORS header test. Verifies that cross-origin fetches from
// a Tauri-webview-like Origin receive Access-Control-Allow-Origin on
// response, unblocking the JS-layer fetch that WKWebView would otherwise
// reject as a disallowed cross-origin response.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { EventBus } from './ws/event-bus.js';
import { UnimplementedOrchestrator } from './routes/sessions.js';
import { createServer } from './server.js';

describe('CORS middleware — webview cross-origin fetch unblocked', () => {
  let tmp: string;
  let db: ReturnType<typeof initDatabase>;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'cors-'));
    db = initDatabase({ dbPath: join(tmp, 'test.db') });
    app = createServer({
      db,
      bus: new EventBus(),
      orchestrator: new UnimplementedOrchestrator(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.raw.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('GET /api/health with a tauri:// Origin returns Access-Control-Allow-Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'tauri://localhost' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('tauri://localhost');
  });

  it('GET /api/health with an http://localhost dev-vite Origin returns reflective header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('OPTIONS preflight for a PUT /api/preferences/:key returns allowed methods', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/preferences/some-key',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    // 204 No Content is the Fastify-CORS default for successful preflight.
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers['access-control-allow-methods']).toMatch(/PUT/);
    expect(res.headers['access-control-allow-origin']).toBe('tauri://localhost');
  });

  it('does NOT set Access-Control-Allow-Credentials (credentials:false policy)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'tauri://localhost' },
    });
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
