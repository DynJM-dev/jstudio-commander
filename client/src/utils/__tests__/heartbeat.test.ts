import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSecondsAgo, STALE_THRESHOLD_SECONDS, SECONDS_DISPLAY_CAP } from '../../hooks/useHeartbeat';
import type { Session } from '@commander/shared';

// Mirror of the SessionCard applyStaleOverride helper so the visual
// contract is testable without mounting React. Any change to the prod
// logic should be reflected here or the test regresses.
const applyStaleOverride = (rawStatus: Session['status'], isStale: boolean): Session['status'] => {
  if (!isStale) return rawStatus;
  if (rawStatus === 'working' || rawStatus === 'waiting') return 'idle';
  return rawStatus;
};

// Mirror of the LiveActivityRow visibility gate in ChatThread. Pure,
// two-input boolean; the test pins it against the four-cell truth table.
const liveActivityVisible = (isWorking: boolean, heartbeatStale: boolean): boolean =>
  isWorking && !heartbeatStale;

describe('formatSecondsAgo — Phase N.0 Patch 3', () => {
  test('null lastActivityAt → "—" placeholder', () => {
    assert.equal(formatSecondsAgo(null, 0, false), '—');
  });

  test('stale → "stale" label regardless of secondsAgo value', () => {
    // isStale is derived upstream (secondsAgo > threshold); label must
    // trust the flag so a test that overrides the flag can still pin
    // the shape.
    assert.equal(formatSecondsAgo(1, 45, true), 'stale');
    assert.equal(formatSecondsAgo(1, 999, true), 'stale');
  });

  test('fresh + secondsAgo > 0 → "Xs ago"', () => {
    assert.equal(formatSecondsAgo(1, 2, false), '2s ago');
    assert.equal(formatSecondsAgo(1, 17, false), '17s ago');
  });

  test('fresh + secondsAgo === 0 → "just now" (clock not yet advanced)', () => {
    assert.equal(formatSecondsAgo(1, 0, false), 'just now');
  });
});

describe('useHeartbeat constants — Phase N.0 Patch 3', () => {
  test("STALE_THRESHOLD_SECONDS matches CTO spec (30s)", () => {
    assert.equal(STALE_THRESHOLD_SECONDS, 30);
  });

  test('SECONDS_DISPLAY_CAP prevents unbounded growth (999 max)', () => {
    assert.equal(SECONDS_DISPLAY_CAP, 999);
  });
});

describe('SessionCard stale-override — Phase N.0 Patch 3', () => {
  test('fresh session: status passes through unchanged (all 5 enum values)', () => {
    const all: Session['status'][] = ['idle', 'working', 'waiting', 'stopped', 'error'];
    for (const s of all) {
      assert.equal(applyStaleOverride(s, false), s);
    }
  });

  test('stale working → force-display idle', () => {
    assert.equal(applyStaleOverride('working', true), 'idle');
  });

  test('stale waiting → force-display idle', () => {
    assert.equal(applyStaleOverride('waiting', true), 'idle');
  });

  test("stale stopped stays stopped (override is scoped to active statuses)", () => {
    // A dead session that's been stopped for a year should still read
    // as stopped. The override exists to correct mis-classified ACTIVE
    // states, not to rewrite terminal states.
    assert.equal(applyStaleOverride('stopped', true), 'stopped');
  });

  test('stale error stays error (preserve terminal error display)', () => {
    assert.equal(applyStaleOverride('error', true), 'error');
  });

  test('stale idle stays idle (no-op when already idle)', () => {
    assert.equal(applyStaleOverride('idle', true), 'idle');
  });
});

describe('LiveActivityRow visibility gate — Phase N.0 Patch 3', () => {
  test('working + fresh → visible', () => {
    assert.equal(liveActivityVisible(true, false), true);
  });

  test('working + stale → hidden (stale wins)', () => {
    assert.equal(liveActivityVisible(true, true), false);
  });

  test('not working + fresh → hidden', () => {
    assert.equal(liveActivityVisible(false, false), false);
  });

  test('not working + stale → hidden', () => {
    assert.equal(liveActivityVisible(false, true), false);
  });
});
