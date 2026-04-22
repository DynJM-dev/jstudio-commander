// Smoke tests for Task 5 sidecar server surface.
//   - GET /api/health returns {status: 'ok', version}
//   - GET /api/session-types returns the three seeded rows
//   - Port discovery skips occupied ports
//   - runtime.json + lock file utilities round-trip

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, bindWithPortDiscovery } from './server.js';
import { EventBus } from './ws/event-bus.js';
import { UnimplementedOrchestrator } from './routes/sessions.js';
import { initDatabase } from '@jstudio-commander/db';
import Fastify from 'fastify';

function makeDeps(dbPath: string) {
  const db = initDatabase({ dbPath });
  const bus = new EventBus();
  const orchestrator = new UnimplementedOrchestrator();
  return { db, bus, orchestrator };
}

describe('sidecar server — Task 5', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sidecar-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/health returns ok + version', async () => {
    const deps = makeDeps(dbPath);
    const app = createServer(deps);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/\d+\.\d+\.\d+/);
    await app.close();
    deps.db.raw.close();
  });

  it('GET /api/session-types returns three seeded rows in sortOrder', async () => {
    const deps = makeDeps(dbPath);
    const app = createServer(deps);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/session-types' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionTypes: Array<{ id: string; sortOrder: number }> };
    expect(body.sessionTypes.map((r) => r.id)).toEqual(['pm', 'coder', 'raw']);
    await app.close();
    deps.db.raw.close();
  });

  it('POST /api/sessions rejects unknown session type', async () => {
    const deps = makeDeps(dbPath);
    const app = createServer(deps);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { projectPath: '/tmp/x', sessionTypeId: 'bogus', effort: 'medium' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unknown_session_type' });
    await app.close();
    deps.db.raw.close();
  });

  it('preferences PUT then GET round-trips', async () => {
    const deps = makeDeps(dbPath);
    const app = createServer(deps);
    await app.ready();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/preferences/pool.size',
      payload: { value: '2' },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/preferences/pool.size' });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ key: 'pool.size', value: '2' });
    await app.close();
    deps.db.raw.close();
  });

  it('port discovery skips occupied ports', async () => {
    const blocker = Fastify();
    blocker.get('/', async () => ({ ok: true }));
    await blocker.listen({ host: '127.0.0.1', port: 11100 });

    const deps = makeDeps(dbPath);
    const app = createServer(deps);
    // Bind with window that starts at the blocked port.
    const port = await bindWithPortDiscovery(app, 11100, 11102);
    expect(port).toBe(11101);

    await app.close();
    await blocker.close();
    deps.db.raw.close();
  });
});
