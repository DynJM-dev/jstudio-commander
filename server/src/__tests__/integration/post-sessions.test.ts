// Phase P.4 Patch 5 — integration test for POST /api/sessions.
//
// Exercises: Fastify route → sessionService.createSession → tmuxService
// spawn → DB INSERT → eventBus emit. Matching the team-lead's scope:
// "create session, verify 201 + DB row + WS event emitted".
//
// Real tmux is required — this spec gates on `tmux -V` availability.
// Failing that we soft-skip rather than fail so the suite stays honest
// about test-host coupling. Cleanup via the DELETE route in `after()`.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-int-post-sessions-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { buildTestApp, cleanupTestApp, waitForBusEvent } = await import('./harness.js');
const app = await buildTestApp();

const tmuxAvailable = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
};

// Track tmux sessions we actually spawned so we can blow them away in
// `after()` even if an assertion killed the test mid-flow.
const SPAWNED_TMUX: string[] = [];

after(async () => {
  for (const name of SPAWNED_TMUX) {
    try {
      execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore', timeout: 2000 });
    } catch {
      /* already gone */
    }
  }
  await cleanupTestApp(app);
  rmSync(tmpDataDir, { recursive: true, force: true });
});

test('POST /api/sessions — 201 + DB row + session:created event', async (t) => {
  if (!tmuxAvailable()) {
    t.skip('tmux not available on this host');
    return;
  }

  // Subscribe before POST so the emit lands in the waiter.
  const eventPromise = waitForBusEvent<{ id: string; name: string; tmuxSession: string }>(
    'session:created',
    (session) => typeof (session as { name?: unknown }).name === 'string',
    3000,
  );

  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: `int-${Date.now()}`, sessionType: 'raw' },
  });

  assert.equal(res.statusCode, 201, `unexpected status: ${res.statusCode} ${res.body}`);
  const body = JSON.parse(res.body) as {
    id: string;
    name: string;
    status: string;
    tmuxSession: string;
  };
  assert.match(body.id, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof body.name, 'string');
  assert.match(body.tmuxSession, /^jsc-[0-9a-f]{8}$/);
  assert.ok(['working', 'idle'].includes(body.status), `status=${body.status}`);
  SPAWNED_TMUX.push(body.tmuxSession);

  // DB row check — read back via the list endpoint so the assertion
  // goes through the same code path as the UI does.
  const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
  assert.equal(listRes.statusCode, 200);
  const list = JSON.parse(listRes.body) as Array<{ id: string; name: string }>;
  const found = list.find((s) => s.id === body.id);
  assert.ok(found, 'newly created session should appear in GET /api/sessions');
  assert.equal(found!.name, body.name);

  // WS contract check — the eventBus emitted session:created with the
  // freshly created session. Shape must match ChatMessage-adjacent
  // surface (id + name + tmuxSession) at minimum.
  const [createdSession] = await eventPromise;
  assert.equal((createdSession as { id: string }).id, body.id);
  assert.equal((createdSession as { name: string }).name, body.name);
});

test('DELETE /api/sessions/:id — soft-stop + session:deleted event', async (t) => {
  if (!tmuxAvailable()) {
    t.skip('tmux not available on this host');
    return;
  }

  // Seed via POST so we have a known id + live tmux pane to kill.
  const seedRes = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: `int-del-${Date.now()}`, sessionType: 'raw' },
  });
  const seed = JSON.parse(seedRes.body) as { id: string; tmuxSession: string };
  SPAWNED_TMUX.push(seed.tmuxSession);

  const deletePromise = waitForBusEvent<string>(
    'session:deleted',
    (id) => id === seed.id,
    3000,
  );

  const delRes = await app.inject({ method: 'DELETE', url: `/api/sessions/${seed.id}` });
  assert.equal(delRes.statusCode, 200);
  const body = JSON.parse(delRes.body) as { id: string; status: string };
  assert.equal(body.id, seed.id);
  assert.equal(body.status, 'stopped', `expected soft-stop, got ${body.status}`);

  const [emittedId] = await deletePromise;
  assert.equal(emittedId, seed.id);
});

test('DELETE /api/sessions/:id — 404 for unknown id', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/sessions/00000000-0000-0000-0000-000000000000' });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body) as { error: string };
  assert.match(body.error, /not found/i);
});
