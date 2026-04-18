import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PANE_STATE, type PaneState } from '@commander/shared';
import { paneStateReducer } from '../pane-state-reducer.js';

// Phase W.2 invariants.

describe('Phase W.2 — paneStateReducer', () => {
  test('open-right when empty → rightSessionId set, focused', () => {
    const next = paneStateReducer(DEFAULT_PANE_STATE, {
      type: 'open-right', sessionId: 'B', currentLeft: 'A',
    });
    assert.equal(next.rightSessionId, 'B');
    assert.equal(next.focusedSessionId, 'B');
  });

  test('open-right when sessionId equals currentLeft → no-op', () => {
    const next = paneStateReducer(DEFAULT_PANE_STATE, {
      type: 'open-right', sessionId: 'A', currentLeft: 'A',
    });
    assert.strictEqual(next, DEFAULT_PANE_STATE);
  });

  test('open-right when already set to same id → no-op', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'open-right', sessionId: 'B', currentLeft: 'A' });
    assert.strictEqual(next, s);
  });

  test('open-right when different right already present → replaces', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'open-right', sessionId: 'C', currentLeft: 'A' });
    assert.equal(next.rightSessionId, 'C');
    assert.equal(next.focusedSessionId, 'C');
  });

  test('close-right → rightSessionId null, focus cleared if was on right', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'close-right' });
    assert.equal(next.rightSessionId, null);
    assert.equal(next.focusedSessionId, null);
  });

  test('close-right preserves focus if it was on left', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'close-right' });
    assert.equal(next.focusedSessionId, 'A');
  });

  test('close-right when already null → no-op', () => {
    const next = paneStateReducer(DEFAULT_PANE_STATE, { type: 'close-right' });
    assert.strictEqual(next, DEFAULT_PANE_STATE);
  });

  test('url-changed: new URL matches right → collapse right (no dup session)', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'url-changed', newLeft: 'B' });
    assert.equal(next.rightSessionId, null);
  });

  test('url-changed: focus survives when it equals new left', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'url-changed', newLeft: 'A' });
    assert.equal(next.focusedSessionId, 'A');
    assert.equal(next.rightSessionId, 'B'); // unchanged
  });

  test('url-changed: stale focus cleared when no longer matches left or right', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'OLD' };
    const next = paneStateReducer(s, { type: 'url-changed', newLeft: 'A' });
    assert.equal(next.focusedSessionId, null);
  });

  test('session-gone: rightSessionId cleared if matches', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'B' };
    const next = paneStateReducer(s, { type: 'session-gone', sessionId: 'B' });
    assert.equal(next.rightSessionId, null);
    assert.equal(next.focusedSessionId, null);
  });

  test('session-gone: focus cleared independently of right', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'session-gone', sessionId: 'A' });
    assert.equal(next.rightSessionId, 'B');
    assert.equal(next.focusedSessionId, null);
  });

  test('session-gone: no-op when id doesn\'t match', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const next = paneStateReducer(s, { type: 'session-gone', sessionId: 'C' });
    assert.strictEqual(next, s);
  });

  test('focus: only accepts left or right — otherwise no-op', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: 'A' };
    const left = paneStateReducer(s, { type: 'focus', sessionId: 'A', currentLeft: 'A' });
    assert.equal(left.focusedSessionId, 'A');
    const right = paneStateReducer(s, { type: 'focus', sessionId: 'B', currentLeft: 'A' });
    assert.equal(right.focusedSessionId, 'B');
    const other = paneStateReducer(s, { type: 'focus', sessionId: 'C', currentLeft: 'A' });
    assert.strictEqual(other, s);
  });

  test('set-divider clamps below MIN', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: null };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: 0.1 });
    assert.equal(next.dividerRatio, 0.3);
  });

  test('set-divider clamps above MAX', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.5, focusedSessionId: null };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: 0.99 });
    assert.equal(next.dividerRatio, 0.7);
  });

  test('set-divider NaN → 0.5 fallback', () => {
    const s: PaneState = { rightSessionId: 'B', dividerRatio: 0.6, focusedSessionId: null };
    const next = paneStateReducer(s, { type: 'set-divider', ratio: NaN });
    assert.equal(next.dividerRatio, 0.5);
  });
});
