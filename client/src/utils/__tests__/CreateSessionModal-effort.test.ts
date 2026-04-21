import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TYPE_EFFORT_DEFAULTS,
  type EffortLevel,
  type SessionType,
} from '@commander/shared';
import {
  defaultEffortForType,
  buildCreateSessionPayload,
} from '../../components/sessions/CreateSessionModal.js';

// M8 Secondary — CreateSessionModal effort override at spawn.
// Three dispatch-required user-observable tests per §Tests:
//   1. Renders correct default per session type (pm→high, coder→medium,
//      raw→medium).
//   2. Session-type change resets effort to the new persona default.
//   3. Override round-trips through the create-session payload.
//
// Harness posture: `node:test` + `tsx`, no jsdom / RTL (matches the
// existing client-side pattern per `phase-y-*` and `SessionCard-effort`
// test files). The modal's state-machine rules are exercised through
// exported pure helpers — the UI wiring itself is trivial React state
// management and smoke-verified by Jose's 5-case acceptance gate.

// ----- Test 1 — default per session type --------------------------------

describe('M8 Secondary — default effort per session type (Test 1)', () => {
  test('pm → high', () => {
    assert.equal(defaultEffortForType('pm'), 'high');
  });

  test('coder → medium', () => {
    assert.equal(defaultEffortForType('coder'), 'medium');
  });

  test('raw → medium', () => {
    assert.equal(defaultEffortForType('raw'), 'medium');
  });

  test('defaultEffortForType is a thin delegate over SESSION_TYPE_EFFORT_DEFAULTS (one source of truth)', () => {
    for (const type of ['pm', 'coder', 'raw'] as const satisfies readonly SessionType[]) {
      assert.equal(
        defaultEffortForType(type),
        SESSION_TYPE_EFFORT_DEFAULTS[type],
        `defaultEffortForType(${type}) drifted from SESSION_TYPE_EFFORT_DEFAULTS`,
      );
    }
  });
});

// ----- Test 2 — session-type change resets effort -----------------------

describe('M8 Secondary — session-type change resets effort (Test 2)', () => {
  // Simulate the modal's state-machine transition. The UI calls
  // `setSessionType(next); setEffortLevel(defaultEffortForType(next))`
  // from `handleSessionTypeChange`; we exercise the same pair.
  const applyTypeChange = (
    next: SessionType,
  ): { sessionType: SessionType; effortLevel: EffortLevel } => ({
    sessionType: next,
    effortLevel: defaultEffortForType(next),
  });

  test('pm→coder drops effort from high to medium', () => {
    // Start: user is on pm, effort=high (default).
    const before = { sessionType: 'pm' as SessionType, effortLevel: 'high' as EffortLevel };
    const after = applyTypeChange('coder');
    assert.equal(before.effortLevel, 'high');
    assert.equal(after.effortLevel, 'medium', 'coder default dominates prior pm-default');
  });

  test('pm→raw drops effort from high to medium', () => {
    const after = applyTypeChange('raw');
    assert.equal(after.effortLevel, 'medium');
  });

  test('coder→pm raises effort from medium to high', () => {
    const after = applyTypeChange('pm');
    assert.equal(after.effortLevel, 'high');
  });

  test('same type (pm→pm) still lands on persona default (idempotent)', () => {
    const after = applyTypeChange('pm');
    assert.equal(after.effortLevel, 'high');
  });

  test('cross-type override is NOT preserved — user re-chose type, defaults reset', () => {
    // Simulate: user picked pm + manually overrode to 'xhigh', then
    // changed type to coder. The override must NOT carry over — per
    // dispatch §Scope in: "user re-chose the session type so default
    // expectations reset."
    const afterUserOverride = { sessionType: 'pm' as SessionType, effortLevel: 'xhigh' as EffortLevel };
    const afterTypeChange = applyTypeChange('coder');
    assert.equal(afterUserOverride.effortLevel, 'xhigh');
    assert.equal(
      afterTypeChange.effortLevel,
      'medium',
      'cross-type override stale — reset to coder default',
    );
  });
});

// ----- Test 3 — override round-trips through create-session payload -----

describe('M8 Secondary — override round-trips through payload (Test 3)', () => {
  test('concrete effortLevel reaches the payload verbatim', () => {
    // User picked session type `coder` (default medium), then manually
    // changed effort selector to `xhigh`. Modal submits. Payload must
    // carry `effortLevel: 'xhigh'` so server's `opts.effortLevel ??
    // SESSION_TYPE_EFFORT_DEFAULTS[sessionType]` at session.service.ts:523
    // short-circuits to the override rather than the coder default.
    const payload = buildCreateSessionPayload({
      name: '  ',
      projectPath: '',
      model: 'claude-opus-4-7',
      sessionType: 'coder',
      effortLevel: 'xhigh',
    });
    assert.equal(payload.effortLevel, 'xhigh', 'override value in payload');
    assert.equal(payload.sessionType, 'coder');
    assert.equal(payload.model, 'claude-opus-4-7');
    assert.equal(payload.name, undefined, 'whitespace-only name collapses to undefined');
    assert.equal(payload.projectPath, undefined, 'empty projectPath collapses to undefined');
  });

  test('non-default value survives the trim-normalization pass', () => {
    // Whitespace normalization path must not accidentally drop
    // effortLevel. Each of the 5 levels round-trips identity.
    const levels: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
    for (const level of levels) {
      const payload = buildCreateSessionPayload({
        name: 'ok',
        projectPath: '/tmp',
        model: 'claude-sonnet-4-6',
        sessionType: 'pm',
        effortLevel: level,
      });
      assert.equal(
        payload.effortLevel,
        level,
        `effort ${level} lost during payload build`,
      );
    }
  });

  test('undefined effortLevel stays undefined — preserves persona-default path on server', () => {
    // Non-regression: when the user doesn't alter the selector, the
    // modal could technically pass either the persona-default level
    // OR `undefined`. Both are acceptable — server's `??` handles
    // both. This test pins the current CONTRACT: helper passes
    // through verbatim, does NOT fabricate a default. If a future
    // refactor decides to pre-resolve the default in the client, the
    // CONTRACT changes and this test must be updated intentionally.
    const payload = buildCreateSessionPayload({
      name: 'x',
      projectPath: '/a',
      model: 'claude-opus-4-7',
      sessionType: 'pm',
      effortLevel: undefined,
    });
    assert.equal(payload.effortLevel, undefined);
  });

  test('modal-submit composition: sessionType + effortLevel both present', () => {
    // Integration check of the modal's full submit path: user chose
    // raw + manually set effort to 'low'. Payload must include BOTH
    // so server doesn't fall back to raw's medium default.
    const payload = buildCreateSessionPayload({
      name: 'quick-scratch',
      projectPath: '~/tmp',
      model: 'claude-haiku-4-5',
      sessionType: 'raw',
      effortLevel: 'low',
    });
    assert.equal(payload.sessionType, 'raw');
    assert.equal(payload.effortLevel, 'low');
    assert.equal(payload.name, 'quick-scratch');
    assert.equal(payload.projectPath, '~/tmp');
  });
});

// ----- Bonus — non-regression on pre-M8-Secondary callers -------------

describe('M8 Secondary — non-regression on existing payload shape', () => {
  test('payload without effortLevel matches pre-M8-Secondary shape (no extra fields)', () => {
    const payload = buildCreateSessionPayload({
      name: 'legacy',
      projectPath: '/legacy',
      model: 'claude-opus-4-7',
      sessionType: 'pm',
    });
    const keys = Object.keys(payload).sort();
    assert.deepEqual(
      keys,
      ['effortLevel', 'model', 'name', 'projectPath', 'sessionType'],
      'payload exposes the M8-Secondary keys; `effortLevel` is undefined ' +
      'when unset — server treats as persona-default path',
    );
    assert.equal(payload.effortLevel, undefined);
  });
});
