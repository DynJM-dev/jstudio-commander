// Phase T — E2E-light integration: simulate a full spawn → hook →
// poller-yield cycle without tmux or a real Claude Code process.
//
// What's covered here and NOT in the unit tests:
//   - The Fastify route path actually writes last_hook_at when the
//     Stop hook matches (wiring between handler and sessionService).
//   - The poller's SELECT-and-yield decision fires correctly against
//     a real row written by the integration harness (not a mock).
//   - resolveOwner's primary strategy (sessionId-as-row) lands on a
//     row that the route then updates through the shared code path.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-int-phase-t-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { buildTestApp, cleanupTestApp } = await import('./harness.js');
const { sessionService } = await import('../../services/session.service.js');
const { getDb } = await import('../../db/connection.js');

const app = await buildTestApp();

after(async () => {
  await cleanupTestApp(app);
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seed = (status: 'working' | 'idle' = 'working') => {
  const id = randomUUID();
  return sessionService.upsertSession({
    id,
    name: 'phase-t-target',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status,
  });
};

// Mirrors the production poller decision. Duplicated deliberately so
// the test pins the contract (SELECT shape + `<` gate) rather than
// importing a helper that could drift without failing this assertion.
const HOOK_YIELD_MS = 60_000;
const pollerWouldYield = (sessionId: string, now: number): boolean => {
  const row = getDb().prepare(
    `SELECT last_hook_at FROM sessions WHERE id = ?`,
  ).get(sessionId) as { last_hook_at: number } | undefined;
  if (!row) return false;
  return now - Number(row.last_hook_at ?? 0) < HOOK_YIELD_MS;
};

test('Stop hook writes last_hook_at → poller yields for 60s', async () => {
  const session = seed('working');
  // Fresh row: last_hook_at defaults to 0, so the poller should NOT
  // yield yet — proves the gate starts closed.
  assert.equal(pollerWouldYield(session.id, Date.now()), false);

  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: session.id, data: { cwd: '/tmp' } },
  });
  assert.equal(res.statusCode, 200);

  // Row is now fresh-hooked — within the 60s window the poller must
  // yield. Using Date.now() (not a mocked clock) keeps the test honest:
  // in real execution, the column was written milliseconds ago.
  assert.equal(pollerWouldYield(session.id, Date.now()), true);
  // And 61s in the future, the gate re-opens.
  assert.equal(pollerWouldYield(session.id, Date.now() + 61_000), false);
});

test('last_hook_at bump is status-agnostic (works on idle rows too)', async () => {
  // The revision dropped the `status === 'idle'` predicate; the hook
  // is authoritative regardless. A Stop fired against an already-idle
  // row still arms the yield.
  const session = seed('idle');
  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: session.id, data: { cwd: '/tmp' } },
  });
  assert.equal(res.statusCode, 200);

  const row = getDb().prepare(
    'SELECT status, last_hook_at FROM sessions WHERE id = ?',
  ).get(session.id) as { status: string; last_hook_at: number };
  assert.equal(row.status, 'idle');
  assert.ok(row.last_hook_at > 0, 'last_hook_at should be bumped even for already-idle');
  assert.equal(pollerWouldYield(session.id, Date.now()), true);
});

test('Unknown-session hook does NOT fabricate a row (no side effect)', async () => {
  // If resolveOwner returns null the handler must not write anywhere —
  // in particular it must not seed a row with a spurious last_hook_at.
  const beforeCount = (getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  const ghost = randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/api/hook-event',
    payload: { event: 'Stop', sessionId: ghost, data: { cwd: '/nowhere' } },
  });
  assert.equal(res.statusCode, 200);
  const afterCount = (getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  assert.equal(afterCount, beforeCount);
});
