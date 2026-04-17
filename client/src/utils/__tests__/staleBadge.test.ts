import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@commander/shared';
import {
  shouldShowStaleBadge,
  STALE_BADGE_THRESHOLD_S,
} from '../../components/sessions/SessionCard.js';

// Phase U Patch 3 — routing-gap visibility chip truth table.
//
// The chip appears ONLY when:
//   rawStatus === 'working'  AND  secondsAgo > 60
//
// This test pins that contract without mounting React. Every other
// status / second combination must NOT surface the chip — if any cell
// in the table flips we want the test to fail loudly.

describe('shouldShowStaleBadge — Phase U Patch 3', () => {
  test('threshold constant pinned to 60s', () => {
    assert.equal(STALE_BADGE_THRESHOLD_S, 60);
  });

  test('working + >60s → true', () => {
    assert.equal(shouldShowStaleBadge('working', 61), true);
    assert.equal(shouldShowStaleBadge('working', 120), true);
    assert.equal(shouldShowStaleBadge('working', 999), true);
  });

  test('working + exactly 60s → false (strictly >)', () => {
    // 60 is the boundary; only >60 surfaces the chip so a freshly-minted
    // 60s-old row doesn't flash-warn between polls.
    assert.equal(shouldShowStaleBadge('working', 60), false);
  });

  test('working + <=60s → false', () => {
    assert.equal(shouldShowStaleBadge('working', 0), false);
    assert.equal(shouldShowStaleBadge('working', 30), false);
    assert.equal(shouldShowStaleBadge('working', 59), false);
  });

  test('non-working statuses → always false, regardless of secondsAgo', () => {
    // The chip is meaningful only when the server insists we're working.
    // For idle/waiting/stopped the "age" number carries no implication of
    // a routing gap so no warning is shown.
    const statuses: Session['status'][] = ['idle', 'waiting', 'stopped', 'error'];
    for (const s of statuses) {
      assert.equal(shouldShowStaleBadge(s, 0), false, `${s} @ 0s`);
      assert.equal(shouldShowStaleBadge(s, 120), false, `${s} @ 120s`);
      assert.equal(shouldShowStaleBadge(s, 999), false, `${s} @ 999s`);
    }
  });
});
