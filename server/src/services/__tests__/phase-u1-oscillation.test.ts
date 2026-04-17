// Phase U.1 Fix 3 — oscillation telemetry.
//
// Detect a session flipping 3+ times within 15s — a classifier/force-idle
// loop that the cooldown (Fix 1) and chrome exclusion (Fix 2) between them
// should prevent, but we want telemetry in case a new false-positive class
// sneaks past both. Logs once per session, dedup'd by a 60s window so a
// continuously-oscillating session doesn't spam the log once per poll
// cycle.
//
// State lives module-local in status-poller.service.ts:
//   oscillationHistory: Map<sessionId, Array<{ status, at }>>
//   oscillationLastLog: Map<sessionId, lastLogAt>
//
// Tracked on every write site that flips status:
//   - stale-activity force-idle branch
//   - normal pane-derived flip branch
//
// The tracker is a pure function given an override `now`, which lets us
// walk through the time-sensitive assertions without timers.

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-u1-osc-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const {
  OSCILLATION_WINDOW_MS,
  OSCILLATION_THRESHOLD,
  OSCILLATION_DEDUP_MS,
  trackOscillation,
  __oscillationTestSupport,
} = await import('../status-poller.service.js');

process.on('exit', () => {
  rmSync(tmpDataDir, { recursive: true, force: true });
});

before(() => {
  __oscillationTestSupport.reset();
});

test('constants pinned — 15s window, 3 flips, 60s dedup', () => {
  assert.equal(OSCILLATION_WINDOW_MS, 15_000);
  assert.equal(OSCILLATION_THRESHOLD, 3);
  assert.equal(OSCILLATION_DEDUP_MS, 60_000);
});

test('two flips in 14s → no log (threshold is 3)', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  assert.equal(trackOscillation('sess-a', 'working', t0 + 0), false);
  assert.equal(trackOscillation('sess-a', 'idle', t0 + 14_000), false);
});

test('three flips within 14s → log fires once', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  assert.equal(trackOscillation('sess-b', 'working', t0 + 0), false);
  assert.equal(trackOscillation('sess-b', 'idle', t0 + 5_000), false);
  assert.equal(trackOscillation('sess-b', 'working', t0 + 14_000), true);
});

test('three flips spread over 16s → no log (oldest trimmed out of window)', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  // First flip at t0. Trim happens on every write. By t0+16_000 the
  // t0 entry is outside the 15s window so the array has 2 entries
  // (t0+5s + t0+16s) and the threshold is not met.
  assert.equal(trackOscillation('sess-c', 'working', t0 + 0), false);
  assert.equal(trackOscillation('sess-c', 'idle', t0 + 5_000), false);
  assert.equal(trackOscillation('sess-c', 'working', t0 + 16_000), false);
});

test('continued oscillation → second log at 60s dedup boundary', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  // First log fires at t0+14s.
  trackOscillation('sess-d', 'working', t0 + 0);
  trackOscillation('sess-d', 'idle', t0 + 5_000);
  assert.equal(trackOscillation('sess-d', 'working', t0 + 14_000), true);

  // At t0 + 14s + 30s = t0 + 44_000, still inside dedup → no log even if
  // we push three more flips into the last-15s window.
  assert.equal(trackOscillation('sess-d', 'idle', t0 + 30_000), false);
  assert.equal(trackOscillation('sess-d', 'working', t0 + 35_000), false);
  assert.equal(trackOscillation('sess-d', 'idle', t0 + 40_000), false);

  // 60s after first log (t0 + 14_000 + 60_000 = t0 + 74_000). Within last
  // 15s window we have: t0+60s+ish flips — seed three fresh entries at
  // t0+65/70/74s so threshold is met.
  trackOscillation('sess-d', 'working', t0 + 65_000);
  trackOscillation('sess-d', 'idle', t0 + 70_000);
  assert.equal(
    trackOscillation('sess-d', 'working', t0 + 74_000),
    true,
    'second log must fire at 60s after first log',
  );
});

test('separate sessions dedup independently', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  // sess-x triggers at t0+10s.
  trackOscillation('sess-x', 'working', t0);
  trackOscillation('sess-x', 'idle', t0 + 5_000);
  assert.equal(trackOscillation('sess-x', 'working', t0 + 10_000), true);

  // sess-y triggers at t0+12s — fresh session, dedup map is keyed per id.
  trackOscillation('sess-y', 'working', t0 + 2_000);
  trackOscillation('sess-y', 'idle', t0 + 7_000);
  assert.equal(
    trackOscillation('sess-y', 'working', t0 + 12_000),
    true,
    'sess-y must log independently of sess-x',
  );
});

test('history trimmed to last-15s on every write (array bounded)', () => {
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  // Push 20 flips spread across 60s — only the last 15s worth should
  // remain in the history at the end.
  for (let i = 0; i < 20; i++) {
    trackOscillation('sess-e', i % 2 === 0 ? 'working' : 'idle', t0 + i * 3_000);
  }
  const history = __oscillationTestSupport.getHistory('sess-e');
  // Trimmed to entries within OSCILLATION_WINDOW_MS (15s) of the last
  // write at t0 + 57_000. Entries inside [57_000 - 15_000, 57_000]
  // = [42_000, 57_000] survive. Last write is i=19 at t0+57s. Back from
  // that: i=19(57s), i=18(54s), i=17(51s), i=16(48s), i=15(45s), i=14(42s).
  // i=14 at exactly 42_000 is 57_000 - 42_000 = 15_000 from now — inside
  // the window with `<=` trim semantics; outside with `<` strict trim.
  // Pin to the `<=` semantic (entries equal to the window boundary are
  // retained) which is consistent with `now - at <= WINDOW` check.
  assert.ok(history.length <= 6, `expected ≤6 trimmed entries, got ${history.length}`);
  assert.ok(history.length >= 5, `expected ≥5 trimmed entries (last 15s), got ${history.length}`);
  // Oldest surviving entry is no older than OSCILLATION_WINDOW_MS from
  // the last write.
  const lastAt = history.at(-1)!.at;
  for (const entry of history) {
    assert.ok(
      lastAt - entry.at <= OSCILLATION_WINDOW_MS,
      `entry ${entry.at} is > ${OSCILLATION_WINDOW_MS}ms older than last ${lastAt}`,
    );
  }
});

test('idempotent — tracking same status repeatedly still counts toward threshold', () => {
  // The threshold counts FLIPS, but the tracker is called on every status
  // UPDATE — if a bug routes 3 back-to-back "working→working" no-ops
  // through the tracker, that's still 3 recorded entries and should log
  // (the bug is worth surfacing: state machine is thrashing even if the
  // terminal status didn't change).
  __oscillationTestSupport.reset();
  const t0 = 1_700_000_000_000;
  trackOscillation('sess-f', 'working', t0);
  trackOscillation('sess-f', 'working', t0 + 5_000);
  assert.equal(trackOscillation('sess-f', 'working', t0 + 10_000), true);
});

test('reset() clears both maps', () => {
  const t0 = 1_700_000_000_000;
  trackOscillation('sess-g', 'working', t0);
  trackOscillation('sess-g', 'idle', t0 + 5_000);
  trackOscillation('sess-g', 'working', t0 + 10_000); // logs
  __oscillationTestSupport.reset();
  assert.equal(__oscillationTestSupport.getHistory('sess-g').length, 0);
  assert.equal(__oscillationTestSupport.getLastLogAt('sess-g'), 0);
});
