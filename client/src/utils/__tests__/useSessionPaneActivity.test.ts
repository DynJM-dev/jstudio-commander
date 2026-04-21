import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Commander Finalizer FINAL — `useSessionPaneActivity` is a React
// hook, but the load-bearing contracts live in the pure helpers it
// composes with. These tests exercise those helpers at the predicate
// level (no jsdom / RTL, matching the project's posture for hook
// tests that have exportable pure surface — Candidate 38 / 39 / Phase
// Y 1.7 precedents). The hook's WS plumbing (subscribe / unsubscribe /
// lastEvent filter) is smoke-verified by Jose's acceptance gate.

import {
  PANE_ACTIVITY_WINDOW_MS,
  paneActivityShouldBeActive,
} from '../../hooks/useSessionPaneActivity';

import { resolveEffectiveStatus } from '../contextBarAction';

// ========================================================================
// Pane-activity window predicate
// ========================================================================

describe('useSessionPaneActivity — paneActivityShouldBeActive window', () => {
  test('lastChangeTs within window → TRUE', () => {
    const now = 1_800_000_000_000;
    assert.equal(
      paneActivityShouldBeActive({ lastChangeTs: now - 1_000, nowMs: now }),
      true,
      '1s ago is well within the 3s window',
    );
  });

  test('lastChangeTs exactly at window boundary → TRUE (<=)', () => {
    const now = 1_800_000_000_000;
    assert.equal(
      paneActivityShouldBeActive({
        lastChangeTs: now - PANE_ACTIVITY_WINDOW_MS,
        nowMs: now,
      }),
      true,
      'boundary is inclusive so a final tick at T-window still counts',
    );
  });

  test('lastChangeTs past window → FALSE (flips to idle)', () => {
    const now = 1_800_000_000_000;
    assert.equal(
      paneActivityShouldBeActive({
        lastChangeTs: now - (PANE_ACTIVITY_WINDOW_MS + 1),
        nowMs: now,
      }),
      false,
    );
  });

  test('lastChangeTs = 0 (never observed change) → FALSE', () => {
    const now = 1_800_000_000_000;
    assert.equal(
      paneActivityShouldBeActive({ lastChangeTs: 0, nowMs: now }),
      false,
      'hook has never seen a pane capture; can\'t be "actively changing"',
    );
  });

  test('custom windowMs override honored', () => {
    const now = 1_800_000_000_000;
    assert.equal(
      paneActivityShouldBeActive({
        lastChangeTs: now - 5_000,
        nowMs: now,
        windowMs: 10_000,
      }),
      true,
      'broader window catches the 5s-ago change',
    );
    assert.equal(
      paneActivityShouldBeActive({
        lastChangeTs: now - 5_000,
        nowMs: now,
        windowMs: 1_000,
      }),
      false,
      'narrower window discards the 5s-ago change',
    );
  });
});

// ========================================================================
// resolveEffectiveStatus precedence — paneActive integration
// ========================================================================

describe('resolveEffectiveStatus — paneActive integration', () => {
  test('paneActive=true + codeman idle → "working" (pane ground truth wins)', () => {
    // The scenario Jose\'s status-bar reframe targets: during a silent
    // pure-text turn, codeman\'s transcript-derived verdict says idle
    // because no tool_use / thinking block has landed, but the pane
    // IS changing. Pane delta promotes to working.
    assert.equal(
      resolveEffectiveStatus('idle', false, false, true),
      'working',
    );
  });

  test('paneActive=true + codeman working → "working" (no degradation)', () => {
    assert.equal(
      resolveEffectiveStatus('working', true, true, true),
      'working',
    );
  });

  test('paneActive=false + codeman idle → "idle" (no false-positive upgrade)', () => {
    assert.equal(
      resolveEffectiveStatus('idle', false, false, false),
      'idle',
    );
  });

  test('paneActive default (omitted) → legacy behavior preserved', () => {
    // Backward compat: callers that haven\'t wired paneActive yet get
    // the original precedence chain.
    assert.equal(
      resolveEffectiveStatus('idle', false, false),
      'idle',
      'codeman idle with default paneActive=false stays idle',
    );
    assert.equal(
      resolveEffectiveStatus('idle', true, false),
      'working',
      'codeman working still wins',
    );
  });

  test('WAITING-PASSTHROUGH SACRED: paneActive=true + sessionStatus=waiting → stays waiting', () => {
    // Rejection trigger (g) — Item 3 approval modal path MUST NOT be
    // shadowed by paneActive. waiting sits at the top of precedence.
    assert.equal(
      resolveEffectiveStatus('waiting', true, true, true),
      'waiting',
      'waiting passthrough dominates even when pane is changing',
    );
  });

  test('WAITING-PASSTHROUGH SACRED: paneActive=true + sessionStatus=waiting + codeman=true → stays waiting', () => {
    // Belt-and-braces — another shape of the same invariant.
    assert.equal(
      resolveEffectiveStatus('waiting', true, false, true),
      'waiting',
    );
  });

  test('paneActive=true overrides codeman=false (Phase Y silent-turn closure)', () => {
    // This is the exact signal shape that broke Gate 1 in Finalizer
    // Part 1 smoke: codeman returns false (transcript has no new
    // evidence), legacy returns false (same), pane DELTA says yes.
    // Pre-reframe: effectiveStatus='idle' → Stop invisible.
    // Post-reframe: effectiveStatus='working' → Stop visible.
    assert.equal(
      resolveEffectiveStatus('idle', false, false, true),
      'working',
    );
  });
});

// ========================================================================
// Stop button visibility gate — integration shape
// ========================================================================

describe('Commander Finalizer FINAL — Stop button visibility with paneActive', () => {
  const stopVisible = (args: {
    paneActive: boolean;
    isWorking: boolean;
    hasPrompt: boolean;
    interrupting: boolean;
  }): boolean =>
    args.paneActive || args.isWorking || args.hasPrompt || args.interrupting;

  test('Stop visible when paneActive=true (primary signal)', () => {
    assert.equal(
      stopVisible({ paneActive: true, isWorking: false, hasPrompt: false, interrupting: false }),
      true,
      'pane ground truth drives Stop during silent pure-text turns',
    );
  });

  test('Stop hidden when all signals false', () => {
    assert.equal(
      stopVisible({ paneActive: false, isWorking: false, hasPrompt: false, interrupting: false }),
      false,
    );
  });

  test('Stop visible when isWorking=true (non-regression)', () => {
    assert.equal(
      stopVisible({ paneActive: false, isWorking: true, hasPrompt: false, interrupting: false }),
      true,
    );
  });

  test('Stop visible when interrupting (feedback retention)', () => {
    assert.equal(
      stopVisible({ paneActive: false, isWorking: false, hasPrompt: false, interrupting: true }),
      true,
    );
  });

  test('Stop visible when hasPrompt (approval modal path)', () => {
    assert.equal(
      stopVisible({ paneActive: false, isWorking: false, hasPrompt: true, interrupting: false }),
      true,
    );
  });
});

// ========================================================================
// Per-session isolation contract
// ========================================================================

describe('useSessionPaneActivity — per-session isolation (split-view)', () => {
  // The hook subscribes keyed to sessionId; `lastEvent` is shared
  // across all hook instances via the WS context. The hook MUST filter
  // by event.sessionId === sessionId to prevent pane-A captures from
  // marking pane-B active. This test pins the filter predicate.
  const shouldAcceptEvent = (args: {
    eventType: string;
    eventSessionId: string;
    mySessionId: string;
  }): boolean =>
    args.eventType === 'session:pane-capture' &&
    args.eventSessionId === args.mySessionId;

  test('event for my session → accepted', () => {
    assert.equal(
      shouldAcceptEvent({
        eventType: 'session:pane-capture',
        eventSessionId: 'sess-A-uuid',
        mySessionId: 'sess-A-uuid',
      }),
      true,
    );
  });

  test('event for sibling pane\'s session → rejected', () => {
    assert.equal(
      shouldAcceptEvent({
        eventType: 'session:pane-capture',
        eventSessionId: 'sess-B-uuid',
        mySessionId: 'sess-A-uuid',
      }),
      false,
      'Candidate 36 prevention — sibling events must not mark me active',
    );
  });

  test('unrelated event type → rejected even with matching sessionId', () => {
    assert.equal(
      shouldAcceptEvent({
        eventType: 'session:update',
        eventSessionId: 'sess-A-uuid',
        mySessionId: 'sess-A-uuid',
      }),
      false,
    );
  });
});
