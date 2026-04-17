// Phase Q — pre-compact service unit tests.
//
// Tests exercise the state machine against a real in-memory DB
// (mkdtemp-scoped via COMMANDER_DATA_DIR). tmuxService.hasSession
// returns false in a no-tmux-server environment, so
// injectIntoPane cleanly short-circuits without needing a stubbed
// tmux — the state transitions fire and emit events all the same.

import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-pre-compact-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { preCompactService, WARN_THRESHOLD, EMERGENCY_THRESHOLD, RESET_THRESHOLD, HYSTERESIS_FLOOR, READY_PHRASE } =
  await import('../pre-compact.service.js');
const { sessionService } = await import('../session.service.js');
const { getDb, closeDb } = await import('../../db/connection.js');
const { eventBus } = await import('../../ws/event-bus.js');

after(() => {
  closeDb();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

beforeEach(() => {
  preCompactService._resetForTests();
  eventBus.removeAllListeners('pre-compact:state-changed');
});

interface Transition {
  sessionId: string;
  state: string;
  ctxPct: number | null;
  reason: string;
}

const captureTransitions = (): Transition[] => {
  const captured: Transition[] = [];
  eventBus.on('pre-compact:state-changed', (evt: Transition) => {
    captured.push(evt);
  });
  return captured;
};

const seedSession = (overrides: Partial<{ autoCompactEnabled: boolean; agentRole: string; status: string }> = {}): string => {
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'pre-compact-test',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: (overrides.status as 'idle' | 'working') ?? 'working',
    agentRole: overrides.agentRole ?? null,
    autoCompactEnabled: overrides.autoCompactEnabled ?? true,
  });
  return id;
};

test('idle → warned at the WARN threshold + emits warn-threshold transition', () => {
  const transitions = captureTransitions();
  const id = seedSession();

  preCompactService.onTickReceived(id, WARN_THRESHOLD);

  assert.equal(preCompactService.getSessionState(id), 'warned');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.sessionId, id);
  assert.equal(transitions[0]!.state, 'warned');
  assert.equal(transitions[0]!.reason, 'warn-threshold');
});

test('idle → compacting at the EMERGENCY threshold (skips warned) + reason=emergency', () => {
  const transitions = captureTransitions();
  const id = seedSession();

  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD);

  assert.equal(preCompactService.getSessionState(id), 'compacting');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.state, 'compacting');
  assert.equal(transitions[0]!.reason, 'emergency');
});

test('warned → compacting on READY_TO_COMPACT chat message (case-sensitive)', () => {
  const transitions = captureTransitions();
  const id = seedSession();

  preCompactService.onTickReceived(id, WARN_THRESHOLD + 2);
  assert.equal(preCompactService.getSessionState(id), 'warned');
  transitions.length = 0;

  // Mixed content + the exact phrase — the substring match fires.
  preCompactService.onChatMessageReceived(id, 'All durable findings saved.\n\nREADY_TO_COMPACT');

  assert.equal(preCompactService.getSessionState(id), 'compacting');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.reason, 'ready-ack');
});

test('warned does NOT transition on lowercased `ready_to_compact` — guard is case-sensitive', () => {
  const id = seedSession();
  preCompactService.onTickReceived(id, WARN_THRESHOLD + 1);
  assert.equal(preCompactService.getSessionState(id), 'warned');

  preCompactService.onChatMessageReceived(id, 'i am ready_to_compact now');
  assert.equal(preCompactService.getSessionState(id), 'warned');

  // Sanity: the proper phrase still works after the miss.
  preCompactService.onChatMessageReceived(id, `ok ${READY_PHRASE}`);
  assert.equal(preCompactService.getSessionState(id), 'compacting');
});

test('compacting → idle when ctx falls below RESET threshold', () => {
  const transitions = captureTransitions();
  const id = seedSession();
  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD + 1);
  assert.equal(preCompactService.getSessionState(id), 'compacting');
  transitions.length = 0;

  preCompactService.onTickReceived(id, RESET_THRESHOLD - 5);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.reason, 'reset');
});

test('warned → idle when ctx drops below HYSTERESIS floor (transient spike)', () => {
  const transitions = captureTransitions();
  const id = seedSession();
  preCompactService.onTickReceived(id, WARN_THRESHOLD + 1);
  transitions.length = 0;

  preCompactService.onTickReceived(id, HYSTERESIS_FLOOR - 1);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.reason, 'hysteresis');
});

test('opt-out: autoCompactEnabled=false sessions never transition', () => {
  const transitions = captureTransitions();
  const id = seedSession({ autoCompactEnabled: false });

  preCompactService.onTickReceived(id, WARN_THRESHOLD + 5);
  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 0);
});

test('PM role rows default to opt-out via the DB migration heal', () => {
  // Simulate the migration heal: insert a PM session then flip the
  // column manually (the real heal runs once at boot; we do it per-
  // test to avoid dependencies on boot ordering).
  const id = seedSession({ agentRole: 'pm' });
  const db = getDb();
  db.prepare('UPDATE sessions SET auto_compact_enabled = 0 WHERE id = ?').run(id);

  const transitions = captureTransitions();
  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD + 2);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 0);
});

test('double-fire protection: two 85%+ ticks in a row do not re-emit', () => {
  const transitions = captureTransitions();
  const id = seedSession();

  preCompactService.onTickReceived(id, WARN_THRESHOLD + 1);
  preCompactService.onTickReceived(id, WARN_THRESHOLD + 3);
  preCompactService.onTickReceived(id, WARN_THRESHOLD + 5);

  assert.equal(transitions.length, 1, 'only the idle → warned transition should emit');
  assert.equal(preCompactService.getSessionState(id), 'warned');
});

test('warned → compacting on emergency escalation when AI never replies', () => {
  // Edge case: session stays in `warned` while ctx keeps climbing.
  // At 95%+ we escalate without waiting for the ack.
  const transitions = captureTransitions();
  const id = seedSession();
  preCompactService.onTickReceived(id, WARN_THRESHOLD + 2);
  assert.equal(preCompactService.getSessionState(id), 'warned');
  transitions.length = 0;

  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD + 1);

  assert.equal(preCompactService.getSessionState(id), 'compacting');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.reason, 'emergency');
});

test('stopped sessions skip every transition', () => {
  const transitions = captureTransitions();
  const id = seedSession({ status: 'idle' });
  // Flip to stopped before any tick.
  const db = getDb();
  db.prepare("UPDATE sessions SET status = 'stopped' WHERE id = ?").run(id);

  preCompactService.onTickReceived(id, EMERGENCY_THRESHOLD + 2);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 0);
});

test('null ctxPct ticks are no-ops (forward-compat for ticks without context_window)', () => {
  const transitions = captureTransitions();
  const id = seedSession();

  preCompactService.onTickReceived(id, null);

  assert.equal(preCompactService.getSessionState(id), 'idle');
  assert.equal(transitions.length, 0);
});

test('getSnapshot returns opt-in flag pulled from the live DB row', () => {
  const idA = seedSession({ autoCompactEnabled: true });
  const idB = seedSession({ autoCompactEnabled: false });

  // Populate state entries for both so they appear in the snapshot.
  preCompactService.onTickReceived(idA, 10);  // populates lastCtxPct, stays idle
  preCompactService.onTickReceived(idB, 50);  // populates lastCtxPct, opt-out so no transition

  const snap = preCompactService.getSnapshot();
  const a = snap.find((s) => s.sessionId === idA);
  const b = snap.find((s) => s.sessionId === idB);
  // idB is opt-out so onTickReceived returns early BEFORE populating
  // state — only idA appears in the in-memory map. That's the right
  // semantic: we only track sessions we'd actually auto-compact.
  assert.ok(a, 'opted-in session should appear in snapshot');
  assert.equal(a!.autoCompactEnabled, true);
  assert.equal(a!.state, 'idle');
  assert.equal(a!.lastCtxPct, 10);
  assert.equal(b, undefined);
});
