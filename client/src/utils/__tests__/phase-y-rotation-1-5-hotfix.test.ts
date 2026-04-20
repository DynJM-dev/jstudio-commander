import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Phase Y Rotation 1.5 hotfix tests — Fix A (effectiveStatus override)
// and Fix B (label leak suppression). The helpers are exported from
// `contextBarAction.ts` specifically so these shape-contract tests can
// exercise the precedence logic without standing up a React renderer
// (dispatch §Test coverage; no jsdom added per rejection trigger
// posture — see Rotation 1 Test 8b for the structural substitute).
//
// Cross-reference — JSONL evidence at
// `~/.jstudio-commander/codeman-diff.jsonl`:
//   - Class 2 entries 6, 7, 9, 10, 13 → Fix B targets.
//   - Class 3 entry 11 → Fix A targets.

import {
  resolveEffectiveStatus,
  resolveActionLabelForParallelRun,
} from '../contextBarAction';

// ----- Fix A — effectiveStatus precedence (3 cases per dispatch) --------

describe('Phase Y Rotation 1.5 Fix A — resolveEffectiveStatus precedence', () => {
  test('Case A1 — codeman working, legacy forced idle (Class 3 closure)', () => {
    // Entry 11 shape: codemanIsWorking=true, sessionStatus='idle' (from
    // ChatPage's typedIdleFreshKillSwitch downgrade), legacy composite
    // false. Pre-hotfix: `isWorking && sessionStatus !== 'working'`
    // upgrade *should* have fired but user visually saw "Idle". Fix A
    // makes codeman's verdict UNAMBIGUOUSLY dominate — guaranteed
    // 'working' regardless of legacy's state.
    const status = resolveEffectiveStatus(
      /* sessionStatus */ 'idle',
      /* codemanIsWorking */ true,
      /* legacyIsWorking */ false,
    );
    assert.equal(status, 'working');
  });

  test('Case A2 — codeman idle, legacy stuck working (getStatusInfo renders "Idle — Waiting for instructions")', () => {
    // Entries 6, 7, 9, 10, 13 shape: codemanIsWorking=false,
    // legacyIsWorking=true, legacyActionLabel='Composing...' or
    // 'Running command...'. With Fix A, effectiveStatus='idle' so
    // getStatusInfo takes the idle branch; with Fix B (tested below),
    // actionLabel is also null, combining to "Idle — Waiting for
    // instructions" — the correct UX.
    const status = resolveEffectiveStatus(
      /* sessionStatus */ 'working', // legacy's raw (pane classifier stuck)
      /* codemanIsWorking */ false,
      /* legacyIsWorking */ true,
    );
    assert.equal(status, 'idle', 'codeman confident-idle dominates');
  });

  test('Case A3 — sessionStatus===waiting passthrough (Item 3 approval modal sacred)', () => {
    // Rejection trigger (f): if waiting gets shadowed by codeman's
    // idle verdict, the PermissionPrompt mount condition breaks and
    // tool approvals regress. Waiting MUST sit at the top of the
    // precedence chain.
    const status = resolveEffectiveStatus(
      /* sessionStatus */ 'waiting',
      /* codemanIsWorking */ false, // codeman doesn't model waiting
      /* legacyIsWorking */ false,
    );
    assert.equal(status, 'waiting', 'Item 3 approval-modal path preserved');
  });

  test('Case A3b — waiting wins even when codeman says working', () => {
    // Extreme corner: codeman miscategorizes mid-approval as working.
    // Waiting must still dominate so modal mount is unaffected.
    const status = resolveEffectiveStatus('waiting', true, true);
    assert.equal(status, 'waiting');
  });

  test('Case A4 — pre-bootstrap (codemanIsWorking=undefined) falls through to legacy upgrade', () => {
    // First render before `useToolExecutionState` emits — codemanState
    // is null, so codemanIsWorking is undefined. Behavior must match
    // pre-Y ContextBar exactly: legacy `isWorking && sessionStatus
    // !== 'working' ? 'working' : sessionStatus`.
    assert.equal(
      resolveEffectiveStatus('idle', undefined, true),
      'working',
      'legacy upgrade fires',
    );
    assert.equal(
      resolveEffectiveStatus('idle', undefined, false),
      'idle',
      'legacy no-upgrade passes sessionStatus through',
    );
    assert.equal(
      resolveEffectiveStatus('working', undefined, true),
      'working',
      'already-working passes through',
    );
  });

  test('Case A5 — stopped sessionStatus passes through when codeman undefined', () => {
    assert.equal(resolveEffectiveStatus('stopped', undefined, false), 'stopped');
  });
});

// ----- Fix B — label leak suppression (2 cases per dispatch) ------------

describe('Phase Y Rotation 1.5 Fix B — resolveActionLabelForParallelRun', () => {
  test('Case B1 — codeman idle + legacy stuck label → null (leak suppressed)', () => {
    // Entries 6, 9, 13: codemanLabel=null while legacyLabel kept
    // emitting 'Composing response...'. Pre-hotfix `codemanLabel ??
    // legacyLabel` = `null ?? "Composing..."` = "Composing..." leaked
    // to UI. Post-hotfix: null.
    const label = resolveActionLabelForParallelRun(
      /* codemanIsWorking */ false,
      /* codemanLabel */ null,
      /* legacyActionLabel */ 'Composing response...',
    );
    assert.equal(label, null);
  });

  test('Case B1b — codeman idle + legacy stuck "Running command..." → null', () => {
    // Entries 7, 10 — same class, different stuck label.
    const label = resolveActionLabelForParallelRun(
      false,
      null,
      'Running command...',
    );
    assert.equal(label, null);
  });

  test('Case B2 — codeman undefined (pre-bootstrap) → legacy preserved', () => {
    // First-render window: codemanState===null → codemanIsWorking
    // is undefined. Legacy fallback MUST still render so the UI never
    // goes label-blank during bootstrap.
    const label = resolveActionLabelForParallelRun(
      undefined,
      null,
      'Composing response...',
    );
    assert.equal(label, 'Composing response...');
  });

  test('Case B3 — codeman working with label → codeman wins over legacy', () => {
    // Confirm codeman primary path: when codeman has a label, it
    // renders even if legacy also has one (different string).
    const label = resolveActionLabelForParallelRun(
      true,
      'Reading foo.ts',
      'Composing response...',
    );
    assert.equal(label, 'Reading foo.ts');
  });

  test('Case B4 — codeman working with null label (edge) → legacy fallback', () => {
    // Codeman says working but didn't produce a label (shouldn't
    // happen in practice, but defend the contract). Legacy fills in.
    const label = resolveActionLabelForParallelRun(
      true,
      null,
      'Running command...',
    );
    assert.equal(label, 'Running command...');
  });
});

// ----- Fix A + B coupling (Class 3 + Class 2 combined fix) --------------

describe('Phase Y Rotation 1.5 — Fix A + Fix B coupling (Class 2+3 full resolution)', () => {
  test('confident-idle codeman + stuck legacy → renders as clean idle end-to-end', () => {
    // Full pipeline shape: effectiveStatus = 'idle', actionLabel = null.
    // getStatusInfo('idle', null, ...) renders "Idle — Waiting for
    // instructions" — the user-observable correct UX.
    const effectiveStatus = resolveEffectiveStatus('working', false, true);
    const actionLabel = resolveActionLabelForParallelRun(false, null, 'Composing response...');
    assert.equal(effectiveStatus, 'idle');
    assert.equal(actionLabel, null);
  });

  test('codeman working + forced-idle legacy → renders as clean working (Class 3 closure)', () => {
    const effectiveStatus = resolveEffectiveStatus('idle', true, false);
    const actionLabel = resolveActionLabelForParallelRun(
      true,
      'Composing response...',
      null,
    );
    assert.equal(effectiveStatus, 'working');
    assert.equal(actionLabel, 'Composing response...');
  });
});
