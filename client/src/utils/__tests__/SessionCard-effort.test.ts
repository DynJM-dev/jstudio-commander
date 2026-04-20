import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { EffortLevel } from '@commander/shared';
import { EFFORT_LEVELS } from '@commander/shared';
import {
  effortCommandPath,
  effortCommandBody,
  effortPatchPath,
  effortPatchBody,
  shouldRenderEffortBadge,
} from '../../components/sessions/effortCard.js';

// M8 — click-to-adjust effort on SessionCard. Pure helpers pin the
// API-call-shape contract. DOM click behavior (open dropdown, visual
// highlight, optimistic badge update) is verified by Jose's browser
// smoke per self-dogfood gate — this harness (node:test + tsx) has
// no JSDOM renderer for React rendering assertions.

describe('M8 — effortCommandPath / effortCommandBody (POST /command contract)', () => {
  test('path includes the session id literally', () => {
    assert.equal(effortCommandPath('sess-abc'), '/sessions/sess-abc/command');
    assert.equal(effortCommandPath('uuid-1234-5678'), '/sessions/uuid-1234-5678/command');
  });

  test('body carries the /effort slash command with the chosen level', () => {
    assert.deepEqual(effortCommandBody('low'), { command: '/effort low' });
    assert.deepEqual(effortCommandBody('medium'), { command: '/effort medium' });
    assert.deepEqual(effortCommandBody('high'), { command: '/effort high' });
    assert.deepEqual(effortCommandBody('xhigh'), { command: '/effort xhigh' });
    assert.deepEqual(effortCommandBody('max'), { command: '/effort max' });
  });

  test('body for every EFFORT_LEVELS entry round-trips to a command string', () => {
    // Regression pin: if a new level is ever added to EFFORT_LEVELS, this
    // test exercises it via the shared constant so the contract stays
    // exhaustive without manual enumeration.
    for (const level of EFFORT_LEVELS) {
      const body = effortCommandBody(level);
      assert.equal(body.command, `/effort ${level}`);
    }
  });
});

describe('M8 — effortPatchPath / effortPatchBody (PATCH persistence contract)', () => {
  test('patch path points at the session endpoint (no subpath)', () => {
    assert.equal(effortPatchPath('sess-abc'), '/sessions/sess-abc');
  });

  test('patch body carries { effortLevel: level }', () => {
    const level: EffortLevel = 'high';
    assert.deepEqual(effortPatchBody(level), { effortLevel: 'high' });
  });

  test('patch body shape mirrors the session row schema (effortLevel is the sole field)', () => {
    // Non-regression guard: if the shape drifts (e.g. someone adds other
    // fields to the PATCH from this helper), this test fails and we
    // re-review.
    const body = effortPatchBody('max') as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['effortLevel']);
  });
});

describe('M8 — shouldRenderEffortBadge (non-regression of display-only path)', () => {
  test('session with effortLevel present → true (render the badge)', () => {
    assert.equal(shouldRenderEffortBadge({ effortLevel: 'medium' }), true);
    assert.equal(shouldRenderEffortBadge({ effortLevel: 'max' }), true);
  });

  test('session with effortLevel null → false (hide the badge)', () => {
    assert.equal(shouldRenderEffortBadge({ effortLevel: null }), false);
  });

  test('session with effortLevel undefined → false', () => {
    assert.equal(shouldRenderEffortBadge({ effortLevel: undefined }), false);
  });

  test('session with empty-string effortLevel → false (defensive)', () => {
    assert.equal(shouldRenderEffortBadge({ effortLevel: '' }), false);
  });
});

describe('M8 — regression anchor: ContextBar helper path unchanged', () => {
  test('SessionCard helpers return IDENTICAL API shapes to what ContextBar.tsx dispatches inline', () => {
    // ContextBar.tsx:313-324 does:
    //   api.post(`/sessions/${sessionId}/command`, { command: `/effort ${level}` });
    //   api.patch(`/sessions/${sessionId}`, { effortLevel: level });
    // SessionCard routes through the effortCard helpers. They MUST produce
    // the identical URL + body — that's the single-source-of-truth
    // contract. If this test ever fails, the SessionCard and ContextBar
    // adjust UIs have drifted and a consolidation rotation is needed.
    const sessionId = 'sess-xyz';
    const level: EffortLevel = 'xhigh';
    assert.equal(effortCommandPath(sessionId), `/sessions/${sessionId}/command`);
    assert.deepEqual(effortCommandBody(level), { command: `/effort ${level}` });
    assert.equal(effortPatchPath(sessionId), `/sessions/${sessionId}`);
    assert.deepEqual(effortPatchBody(level), { effortLevel: level });
  });
});
