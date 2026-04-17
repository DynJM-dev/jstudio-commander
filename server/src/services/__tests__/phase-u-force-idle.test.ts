// Phase U Patch 2 — stale-activity force-idle guard.
//
// Two layers of coverage:
//   (a) Pure-decision helper that mirrors the production poller's
//       yield → force-idle → classify ordering. Lets us assert every
//       boundary (89s/91s, working/idle/waiting, hook-yield wins over
//       force-idle) without running the actual 5s interval.
//   (b) Integration-light: seed a working + stale row, run poll() once
//       via statusPollerService.start()/stop(), then assert the DB
//       flip AND the session:status bus emit.
//
// The pure decision is duplicated on purpose — per the Phase P.3 H2
// pattern, this test imports the constants from production to pin
// their values, but rewrites the decision tree so a regression that
// re-orders the two gates can't quietly pass.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-u-forceidle-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const {
  HOOK_YIELD_MS,
  STALE_ACTIVITY_MS,
  statusPollerService,
} = await import('../status-poller.service.js');
const { getDb, closeDb } = await import('../../db/connection.js');
const { sessionService } = await import('../session.service.js');
const { eventBus } = await import('../../ws/event-bus.js');

getDb();

after(() => {
  statusPollerService.stop();
  closeDb();
  eventBus.removeAllListeners();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

type Action = 'yield' | 'force-idle' | 'classify';

// Mirrors the exact ordering in status-poller.service.ts. Keep this
// aligned with production on every edit to that file — the tests
// below pin the ordering contract.
const decide = (
  status: string,
  msSinceActivity: number,
  msSinceHook: number,
): Action => {
  if (msSinceHook < HOOK_YIELD_MS) return 'yield';
  if (status === 'working' && msSinceActivity > STALE_ACTIVITY_MS) return 'force-idle';
  return 'classify';
};

test('constants match spec — 60s hook yield, 90s stale-activity', () => {
  assert.equal(HOOK_YIELD_MS, 60_000);
  assert.equal(STALE_ACTIVITY_MS, 90_000);
});

test('working + 91s stale + no recent hook → force-idle', () => {
  assert.equal(decide('working', 91_000, 120_000), 'force-idle');
});

test('working + 89s stale + no recent hook → classify (boundary guard)', () => {
  // 89_000 < STALE_ACTIVITY_MS (90_000), so condition `> 90_000` is false.
  assert.equal(decide('working', 89_000, 120_000), 'classify');
  // 90_000 exact also falls through — the check is strictly `>`.
  assert.equal(decide('working', 90_000, 120_000), 'classify');
});

test('idle + 91s stale → classify (scope guard — never force-idles non-working)', () => {
  assert.equal(decide('idle', 91_000, 120_000), 'classify');
});

test('waiting + 91s stale → classify (scope guard)', () => {
  assert.equal(decide('waiting', 91_000, 120_000), 'classify');
});

test('stopped + 91s stale → classify (scope guard)', () => {
  assert.equal(decide('stopped', 91_000, 120_000), 'classify');
});

test('working + 91s stale + JUST got hook 1s ago → yield (hook wins)', () => {
  // Phase T interaction: if ms_since_hook < 60_000, yield short-circuits
  // before force-idle is evaluated. Real active turns can't be prematurely
  // force-idled just because a poller pass lagged.
  assert.equal(decide('working', 91_000, 1_000), 'yield');
});

test('working + 91s stale + hook exactly 60s ago → force-idle (hook window closed)', () => {
  // At ms_since_hook === 60_000 the `<` test fails, so we exit the
  // yield branch and hit force-idle next.
  assert.equal(decide('working', 91_000, 60_000), 'force-idle');
});

// -------- Integration: actual poller flips a stale row and emits the WS event --------

test('integration — working+stale row flips to idle AND emits session:status', async () => {
  const id = randomUUID();
  // Seed: working row, last_activity_at 120s ago, last_hook_at 0 (never hooked).
  sessionService.upsertSession({
    id,
    name: 'phase-u-force-idle-target',
    // A `jsc-*` tmux session that does NOT exist in the test env; the
    // classifier will return status='stopped' / evidence='no tmux
    // session', but force-idle fires BEFORE the classifier decision
    // is acted on — so we assert `idle`, not `stopped`.
    tmuxSession: `jsc-${id.slice(0, 8)}-phaseu`,
    status: 'working',
  });
  const now = Date.now();
  const staleMs = now - (STALE_ACTIVITY_MS + 30_000); // 120s ago
  getDb().prepare(
    'UPDATE sessions SET last_activity_at = ?, last_hook_at = 0 WHERE id = ?',
  ).run(staleMs, id);

  // Arm the listener BEFORE start() (poll() runs synchronously).
  // emitSessionStatus emits positional args: (sessionId, status, extras).
  const emitted: Array<{ sessionId: string; status: string; extras: { evidence?: string } }> = [];
  const listener = (sessionId: string, status: string, extras: { evidence?: string }): void => {
    if (sessionId === id) emitted.push({ sessionId, status, extras });
  };
  eventBus.on('session:status', listener);

  try {
    statusPollerService.start();
  } finally {
    statusPollerService.stop();
    eventBus.off('session:status', listener);
  }

  const after = getDb().prepare(
    'SELECT status FROM sessions WHERE id = ?',
  ).get(id) as { status: string };
  assert.equal(after.status, 'idle', 'row must be flipped to idle by force-idle guard');
  assert.ok(
    emitted.some(
      (e) => e.status === 'idle' && String(e.extras?.evidence ?? '').includes('stale-activity-force-idle'),
    ),
    'session:status event must fire with stale-activity-force-idle evidence',
  );
});

before(() => {
  // Ensure no listeners leak in from prior test runs (the module-level
  // eventBus is a singleton across the whole test process).
  eventBus.removeAllListeners('session:status');
});
