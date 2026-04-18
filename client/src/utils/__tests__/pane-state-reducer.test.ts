import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PANE_STATE, type PaneState } from '@commander/shared';
import { paneStateReducer } from '../pane-state-reducer.js';

// Phase W — invariants the UI relies on. These are the load-bearing
// rules of the pane pin model; if any break, the chrome either shows
// an impossible state ({left:null, right:X}) or loses user intent
// (focus drifting to an unpinned session on re-render).

describe('Phase W — paneStateReducer', () => {
  test('pin empty → sessionId becomes left, focused', () => {
    const next = paneStateReducer(DEFAULT_PANE_STATE, { type: 'pin', sessionId: 'A' });
    assert.equal(next.left, 'A');
    assert.equal(next.right, null);
    assert.equal(next.focusedSessionId, 'A');
  });

  test('pin second → becomes right, newly-pinned focused', () => {
    const s1: PaneState = { left: 'A', right: null, dividerRatio: 0.5, focusedSessionId: 'A' };
    const s2 = paneStateReducer(s1, { type: 'pin', sessionId: 'B' });
    assert.equal(s2.left, 'A');
    assert.equal(s2.right, 'B');
    assert.equal(s2.focusedSessionId, 'B');
  });

  test('pin already-pinned → no-op (preserves current focus)', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'pin', sessionId: 'A' });
    assert.strictEqual(next, s);
  });

  test('pin third when 2 already pinned → no-op (max 2 invariant)', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'pin', sessionId: 'C' });
    assert.strictEqual(next, s);
    assert.equal(next.left, 'A');
    assert.equal(next.right, 'B');
  });

  test('unpin right → right becomes null, focus falls to left if was focused', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'unpin', sessionId: 'B' });
    assert.equal(next.left, 'A');
    assert.equal(next.right, null);
    assert.equal(next.focusedSessionId, 'A');
  });

  test('unpin left WITH right set → right promotes to left (no orphan right)', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.6, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'unpin', sessionId: 'A' });
    // Invariant: right-only is NEVER a valid state. Promotion upholds it.
    assert.equal(next.left, 'B');
    assert.equal(next.right, null);
    assert.equal(next.dividerRatio, 0.6);
    assert.equal(next.focusedSessionId, 'B');
  });

  test('unpin left WITHOUT right set → empty state', () => {
    const s: PaneState = { left: 'A', right: null, dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'unpin', sessionId: 'A' });
    assert.equal(next.left, null);
    assert.equal(next.right, null);
    assert.equal(next.focusedSessionId, null);
  });

  test('unpin unfocused → focus preserved', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'unpin', sessionId: 'B' });
    assert.equal(next.focusedSessionId, 'A');
  });

  test('unpin session that is not pinned → no-op', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'unpin', sessionId: 'C' });
    assert.strictEqual(next, s);
  });

  test('focus left or right → sets focusedSessionId', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'focus', sessionId: 'B' });
    assert.equal(next.focusedSessionId, 'B');
    assert.equal(next.left, 'A');
    assert.equal(next.right, 'B');
  });

  test('focus an unpinned session → no-op (silently ignored)', () => {
    // A stale click on a session that just got unpinned must not crash
    // or produce an impossible focusedSessionId.
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'focus', sessionId: 'C' });
    assert.strictEqual(next, s);
  });

  test('focus same session → returns same reference (no persist trigger)', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'focus', sessionId: 'A' });
    assert.strictEqual(next, s);
  });

  test('set-divider clamps below MIN_DIVIDER_RATIO', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: 0.1 });
    assert.equal(next.dividerRatio, 0.3);
  });

  test('set-divider clamps above MAX_DIVIDER_RATIO', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: 0.99 });
    assert.equal(next.dividerRatio, 0.7);
  });

  test('set-divider same value → returns same reference', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: 0.5 });
    assert.strictEqual(next, s);
  });

  test('set-divider NaN → falls back to 0.5 (safe default, no crash)', () => {
    const s: PaneState = { left: 'A', right: 'B', dividerRatio: 0.6, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: NaN });
    assert.equal(next.dividerRatio, 0.5);
  });
});
