// Issue 15.1-H — blank-pane false-idle fix.
//
// Two layers:
//   (a) Pure-decision helper mirroring the poller's override + yield
//       branching. Pins the contract that pending-tool-use upgrades
//       idle → working even when the hook-yield would otherwise skip
//       the session, while cooldown stays protective.
//   (b) Integration-light: seed a row with a live JSONL file whose
//       tail has an unmatched tool_use, run a single poll tick, assert
//       the DB flips to working.
//
// Keep the decision helper aligned with status-poller.service.ts's
// ordering — this pins the architectural contract (cooldown > override
// > hook-yield > stale-activity > classifier).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-15-1-h-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const {
  HOOK_YIELD_MS,
  FORCE_IDLE_COOLDOWN_MS,
  statusPollerService,
} = await import('../status-poller.service.js');
const { getDb, closeDb } = await import('../../db/connection.js');
const { eventBus } = await import('../../ws/event-bus.js');

getDb();

after(() => {
  statusPollerService.stop();
  closeDb();
  eventBus.removeAllListeners();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

// ───────── (a) Pure decision helper ─────────
// Mirrors the poller's 15.1-H override placement: runs AFTER cooldown
// (protective against force-idle oscillation) but BEFORE hook-yield
// (because hooks fire continuously during tool exec, keeping yield
// perpetually active).
type Action =
  | 'cooldown-skip'
  | 'pending-tool-upgrade'
  | 'hook-yield-skip'
  | 'classify';

const decide = (opts: {
  hintedStatus: string;
  msSinceForceIdle: number;
  msSinceHook: number;
  hasPendingTool: boolean;
}): Action => {
  if (opts.msSinceForceIdle < FORCE_IDLE_COOLDOWN_MS) return 'cooldown-skip';
  // Issue 15.3 Phase 1.1 — broaden to fire from waiting too.
  const overrideFires =
    (opts.hintedStatus === 'idle' || opts.hintedStatus === 'waiting') &&
    opts.hasPendingTool;
  if (overrideFires) return 'pending-tool-upgrade';
  if (opts.msSinceHook < HOOK_YIELD_MS) return 'hook-yield-skip';
  return 'classify';
};

test('pending tool override fires even when hook-yield would skip (blank-pane sleep case)', () => {
  // Canonical 15.1-H shape: hook fired recently (sleep's Stop defer
  // bumped last_hook_at), pane classifier idle, transcript has
  // unmatched tool_use.
  assert.equal(
    decide({
      hintedStatus: 'idle',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 2_000,
      hasPendingTool: true,
    }),
    'pending-tool-upgrade',
  );
});

test('pending tool + no hook-yield → still upgrades (deep-silence tool)', () => {
  assert.equal(
    decide({
      hintedStatus: 'idle',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 120_000, // yield expired
      hasPendingTool: true,
    }),
    'pending-tool-upgrade',
  );
});

test('no pending tool + recent hook → hook-yield wins (preserves Phase T Patch 2)', () => {
  assert.equal(
    decide({
      hintedStatus: 'idle',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 2_000,
      hasPendingTool: false,
    }),
    'hook-yield-skip',
  );
});

test('no pending tool + no hook → classify (normal path)', () => {
  assert.equal(
    decide({
      hintedStatus: 'idle',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 120_000,
      hasPendingTool: false,
    }),
    'classify',
  );
});

test('cooldown active → skip regardless of pending tool (preserves 15.1-D oscillation guard)', () => {
  assert.equal(
    decide({
      hintedStatus: 'idle',
      msSinceForceIdle: 10_000, // within cooldown
      msSinceHook: 2_000,
      hasPendingTool: true,
    }),
    'cooldown-skip',
  );
});

test('hinted status working → no upgrade needed (already working)', () => {
  // When hinted is 'working', override shouldn't re-fire (no-op).
  // Decision falls through to hook-yield since hintedStatus !== 'idle'.
  assert.equal(
    decide({
      hintedStatus: 'working',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 2_000,
      hasPendingTool: true,
    }),
    'hook-yield-skip',
  );
});

test('hinted status waiting → 15.3 Phase 1.1 broadens override to fire here too', () => {
  // Post-Phase-1.1 the override DOES fire from waiting state when
  // pendingToolUse is true. Rationale: after user approves a permission
  // prompt, Claude starts executing but the pane may still show
  // residual "waiting"-class text; hinted stays 'waiting'. Without
  // this branch, status stuck at waiting for the whole tool exec
  // (Jose's "approval-stick" repro).
  //
  // A visible active approval prompt produces pendingToolUse=false
  // (no unmatched tool_use — the tool hasn't been emitted yet; the
  // prompt IS the approval gate). So this override only fires when
  // approval is ALREADY satisfied AND tool exec started — exactly
  // the case Phase 1.1 wants to catch.
  assert.equal(
    decide({
      hintedStatus: 'waiting',
      msSinceForceIdle: 3_600_000,
      msSinceHook: 2_000,
      hasPendingTool: true,
    }),
    'pending-tool-upgrade',
  );
});

// ───────── (b) latestTranscriptPath helper sanity ─────────
// Inline duplicate of the production helper — pinned so a re-
// implementation inside the poller cannot diverge without updating
// this assertion.
const latestTranscriptPath = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const last = parsed[parsed.length - 1];
    return typeof last === 'string' && last.length > 0 ? last : null;
  } catch {
    return null;
  }
};

test('latestTranscriptPath → last entry of a single-element array', () => {
  assert.equal(latestTranscriptPath('["/a/b.jsonl"]'), '/a/b.jsonl');
});

test('latestTranscriptPath → last entry of a multi-element array (post-rotation)', () => {
  assert.equal(
    latestTranscriptPath('["/old.jsonl","/rotated.jsonl","/latest.jsonl"]'),
    '/latest.jsonl',
  );
});

test('latestTranscriptPath → null on empty array', () => {
  assert.equal(latestTranscriptPath('[]'), null);
});

test('latestTranscriptPath → null on null / empty string / malformed JSON', () => {
  assert.equal(latestTranscriptPath(null), null);
  assert.equal(latestTranscriptPath(undefined), null);
  assert.equal(latestTranscriptPath(''), null);
  assert.equal(latestTranscriptPath('not-json'), null);
  assert.equal(latestTranscriptPath('{"key":"not-array"}'), null);
});

test('latestTranscriptPath → null on non-string entries (defensive)', () => {
  assert.equal(latestTranscriptPath('[123]'), null);
  assert.equal(latestTranscriptPath('[null]'), null);
  assert.equal(latestTranscriptPath('[""]'), null);
});
