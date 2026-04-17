// Phase P.4 Patch 5 — integration test for POST /api/hook-event.
//
// Exercises the full hook pipeline without a real tmux pane:
//   Fastify route + loopback guard →
//   resolveOwner (sessionId-as-row strategy) →
//   sessions UPDATE + bumpLastActivity →
//   eventBus.emitSessionStatus with correct evidence field.
//
// Closes the C-2 gap at the integration layer (the Playwright spec
// covers it E2E). These tests avoid tmux entirely by seeding rows
// directly via sessionService.upsertSession — no createSession → no
// tmux.createSession → no waitForClaudeReady timer chain.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-int-hook-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { buildTestApp, cleanupTestApp, waitForBusEvent } = await import('./harness.js');
const { sessionService } = await import('../../services/session.service.js');
const { getDb } = await import('../../db/connection.js');

const app = await buildTestApp();

after(async () => {
  await cleanupTestApp(app);
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seedSession = (overrides: Partial<{ id: string; name: string; status: string }> = {}) => {
  const id = overrides.id ?? randomUUID();
  return sessionService.upsertSession({
    id,
    name: overrides.name ?? 'int-hook-target',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: (overrides.status as 'working' | 'idle' | 'stopped') ?? 'working',
  });
};

test('POST /api/hook-event Stop flips session to idle + emits session:status', async () => {
  const session = seedSession({ status: 'working' });
  assert.equal(session.status, 'working');

  const eventPromise = waitForBusEvent<[string, string]>(
    'session:status',
    (id, status) => id === session.id && status === 'idle',
    3000,
  );

  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: session.id, data: { cwd: '/tmp' } },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  // DB flipped
  const db = getDb();
  const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get(session.id) as { status: string };
  assert.equal(row.status, 'idle');

  // eventBus emit
  const [emittedId, emittedStatus] = await eventPromise;
  assert.equal(emittedId, session.id);
  assert.equal(emittedStatus, 'idle');
});

test('POST /api/hook-event SessionEnd flips session to stopped', async () => {
  const session = seedSession({ status: 'idle' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'SessionEnd', sessionId: session.id, data: {} },
  });
  assert.equal(res.statusCode, 200);

  const db = getDb();
  const row = db.prepare('SELECT status, stopped_at FROM sessions WHERE id = ?').get(session.id) as {
    status: string;
    stopped_at: string | null;
  };
  assert.equal(row.status, 'stopped');
  assert.ok(row.stopped_at, 'stopped_at should be set');
});

test('POST /api/hook-event non-loopback → 403', async () => {
  // Phase P.1 C1 — the loopback gate in hook-event.routes.ts refuses
  // anything whose request.ip isn't 127.0.0.1 / ::1 / ::ffff:127.0.0.1.
  // Fastify's app.inject() lets us forge the remote address to exercise
  // the refused-path without opening a real remote socket.
  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: 'fake' },
    remoteAddress: '8.8.8.8',
  });
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body) as { error: string };
  assert.match(body.error, /loopback/i);
});

test('POST /api/hook-event unknown session → 200 ok (drop silently)', async () => {
  // Unknown session ids are a routine condition — Claude Code's hook
  // fires BEFORE a session has registered transcript_paths with
  // Commander. The route logs + emits a system:event but returns ok.
  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: randomUUID(), data: { cwd: '/nowhere' } },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('POST /api/hook-event queue cap — 503 + Retry-After when depth already at HOOK_QUEUE_MAX', async () => {
  // Phase R M5 — HOOK_QUEUE_MAX guards against runaway queue growth
  // under a downstream stall. Simulating true concurrency with
  // Promise.all(inject×21) is racy because processHook finishes
  // between enqueues; instead we use `_setHookQueueDepthForTests`
  // to deterministically saturate the queue with stalled promises,
  // then verify the next POST is shed.
  const { _setHookQueueDepthForTests, HOOK_QUEUE_MAX } = await import(
    '../../routes/hook-event.routes.js'
  );
  const { release } = _setHookQueueDepthForTests(HOOK_QUEUE_MAX);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/hook-event',
      payload: { event: 'Stop', sessionId: randomUUID(), data: { cwd: '/tmp' } },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['retry-after'], '1');
    const body = JSON.parse(res.body) as { error: string };
    assert.match(body.error, /queue full/i);
  } finally {
    release();
  }
});

test('POST /api/hook-event queue — accepts when depth is HOOK_QUEUE_MAX - 1 (boundary)', async () => {
  // At exactly one below the cap, a new POST enqueues (bringing
  // depth to HOOK_QUEUE_MAX) BEFORE the gate rejects. We release
  // the stall before awaiting so the handler's chain resolves and
  // we can observe the 200.
  const { _setHookQueueDepthForTests, HOOK_QUEUE_MAX } = await import(
    '../../routes/hook-event.routes.js'
  );
  const { release } = _setHookQueueDepthForTests(HOOK_QUEUE_MAX - 1);
  const session = seedSession({ status: 'working' });
  const injectPromise = app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: session.id, data: { cwd: '/tmp' } },
  });
  // Release the stall so the chain (including our new inject) drains.
  release();
  const res = await injectPromise;
  assert.equal(res.statusCode, 200);
});
