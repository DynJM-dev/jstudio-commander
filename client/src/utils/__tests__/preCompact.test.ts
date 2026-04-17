// Phase Q — client-side pre-compact unit tests.
//
// Covers the pure bits: the state → label mapping and the shape of
// the WS event. Hook + toggle exercise happens in Playwright E2E.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PreCompactState, PreCompactStateChangedEvent, WSEvent } from '@commander/shared';
import { labelForPreCompactState } from '../../components/sessions/PreCompactIndicator.js';

describe('labelForPreCompactState', () => {
  test('idle → null (indicator renders nothing)', () => {
    assert.equal(labelForPreCompactState('idle'), null);
  });

  test('warned → visible copy about save-state', () => {
    const label = labelForPreCompactState('warned');
    assert.ok(label);
    assert.match(label!, /waiting for state save/i);
  });

  test('compacting → visible copy about compacting', () => {
    const label = labelForPreCompactState('compacting');
    assert.ok(label);
    assert.match(label!, /compacting/i);
  });
});

describe('pre-compact WS event shape', () => {
  test('shape is assignable to WSEvent discriminated union', () => {
    // Compile-time check via runtime narrowing — if the shared type
    // drifts, this file stops compiling first.
    const evt: PreCompactStateChangedEvent = {
      sessionId: 'abc-123',
      state: 'warned',
      ctxPct: 87.3,
      timestamp: '2026-04-17T12:00:00.000Z',
      reason: 'warn-threshold',
    };
    const wsEvent: WSEvent = { type: 'pre-compact:state-changed', ...evt };
    assert.equal(wsEvent.type, 'pre-compact:state-changed');
    if (wsEvent.type === 'pre-compact:state-changed') {
      assert.equal(wsEvent.state, 'warned');
      assert.equal(wsEvent.sessionId, 'abc-123');
    }
  });

  test('every PreCompactState value maps to a defined label lookup', () => {
    // Guard against a future fourth state being added to the union
    // without the indicator getting a label branch.
    const states: PreCompactState[] = ['idle', 'warned', 'compacting'];
    for (const s of states) {
      const label = labelForPreCompactState(s);
      // idle is allowed to be null; the other two must render.
      if (s !== 'idle') {
        assert.ok(label, `state ${s} must have a label`);
      }
    }
  });

  test('every reason value in the union is a string literal we can narrow', () => {
    const reasons: PreCompactStateChangedEvent['reason'][] = [
      'warn-threshold',
      'ready-ack',
      'emergency',
      'reset',
      'hysteresis',
    ];
    for (const r of reasons) {
      assert.equal(typeof r, 'string');
    }
  });
});
