import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Phase T hotfix (Fix Z) — `usePreference` same-tab multi-instance
// sync pub-sub. The production fix adds a module-level
// Map<key, Set<listener>>; each hook instance subscribes its own
// setValue on mount, unsubscribes on unmount, and `update()`
// notifies every peer except the caller.
//
// These tests exercise the subscribe + notifyPeers helpers directly
// via the exported __usePreferenceTestSupport surface — no React
// renderer needed, no jsdom/RTL harness added (dispatch rejection
// trigger (d)). Covers the three invariants pinned in the dispatch
// §Tests: peer sync on update, subscriber cleanup on unmount, and
// different-keys isolation.

import { __usePreferenceTestSupport } from '../../hooks/usePreference';

const { subscribe, notifyPeers, peekSubscriberCount, reset } =
  __usePreferenceTestSupport;

describe('Phase T hotfix — usePreference same-tab pub-sub', () => {
  beforeEach(() => { reset(); });

  test('peer sync on update — notifyPeers wakes every non-self listener', () => {
    const calls: Array<{ who: string; value: unknown }> = [];
    const listenerA = (v: unknown): void => { calls.push({ who: 'A', value: v }); };
    const listenerB = (v: unknown): void => { calls.push({ who: 'B', value: v }); };
    const listenerC = (v: unknown): void => { calls.push({ who: 'C', value: v }); };

    subscribe('k', listenerA);
    subscribe('k', listenerB);
    subscribe('k', listenerC);

    // Instance A is the writer; notifyPeers skips A, wakes B + C.
    notifyPeers('k', { mirrorVisible: false }, listenerA);

    assert.equal(calls.length, 2, 'exactly 2 peers woken (A skipped as self)');
    assert.deepEqual(
      calls.map((c) => c.who).sort(),
      ['B', 'C'],
      'A is self-skipped; B and C both see the update',
    );
    assert.deepEqual(calls[0]!.value, { mirrorVisible: false });
    assert.deepEqual(calls[1]!.value, { mirrorVisible: false });
  });

  test('peer sync — self: null wakes every subscriber (e.g. WS path)', () => {
    let aCalls = 0;
    let bCalls = 0;
    subscribe('k', () => { aCalls += 1; });
    subscribe('k', () => { bCalls += 1; });

    // Passing null as self means "no caller to skip" — both fire.
    notifyPeers('k', 'v', null);
    assert.equal(aCalls, 1);
    assert.equal(bCalls, 1);
  });

  test('subscriber cleanup — Map entry deleted when last instance unmounts', () => {
    const listenerA = (): void => {};
    const listenerB = (): void => {};

    const unsubA = subscribe('k', listenerA);
    const unsubB = subscribe('k', listenerB);
    assert.equal(peekSubscriberCount('k'), 2, 'two subscribers present');

    unsubB();
    assert.equal(peekSubscriberCount('k'), 1, 'B unmount drops size to 1');

    unsubA();
    assert.equal(
      peekSubscriberCount('k'),
      null,
      'last-instance unmount deletes the Map entry (no leak)',
    );
  });

  test('subscriber cleanup — re-subscribe after full unmount reconstructs the set', () => {
    const l = (): void => {};
    const unsub = subscribe('k', l);
    unsub();
    assert.equal(peekSubscriberCount('k'), null, 'cleared');
    subscribe('k', l);
    assert.equal(peekSubscriberCount('k'), 1, 'fresh Set created on re-subscribe');
  });

  test('different-keys isolation — notifyPeers for key-a does not wake key-b peers', () => {
    let aFires = 0;
    let bFires = 0;
    subscribe('key-a', () => { aFires += 1; });
    subscribe('key-b', () => { bFires += 1; });

    notifyPeers('key-a', 'hello', null);
    assert.equal(aFires, 1, 'key-a subscriber fires');
    assert.equal(bFires, 0, 'key-b subscriber UNTOUCHED (cross-key pollution guard)');

    notifyPeers('key-b', 'world', null);
    assert.equal(aFires, 1);
    assert.equal(bFires, 1);
  });

  test('notifyPeers on unknown key is a safe no-op (no throw)', () => {
    // Writer calls notifyPeers before any peer has subscribed — hits
    // the `if (!peers) return;` early exit. This guards against a
    // crash on very-first-render update().
    assert.doesNotThrow(() => notifyPeers('never-subscribed', 'v', null));
  });
});
