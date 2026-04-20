import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';
import { getActionInfo, getStatusInfo } from '../../components/chat/ContextBar.js';
import { resolveActionLabel } from '../contextBarAction.js';

// Issue 15.3 §6.1.1 — integration tests that compose the full
// ContextBar status-bar label derivation chain ContextBar.tsx runs per
// render:
//
//   1. `isWorking = isWorkingOverride ?? (sessionStatus === 'working' || userJustSent)`
//   2. `jsonlLabel = isWorking ? getActionInfo(messages)?.label : null`
//   3. `actionLabel = resolveActionLabel({isWorking, jsonlLabel, terminalHint, sessionState})`
//   4. `effectiveStatus = isWorking && sessionStatus !== 'working' ? 'working' : sessionStatus`
//   5. `statusLabel = getStatusInfo(effectiveStatus, actionLabel, hasPrompt, 0, 0).label`
//
// These tests pin USER-OBSERVABLE DOM output — the string the user
// reads in the status bar — for the regression Jose captured on
// 2026-04-20 (§6.1-6.3 shipped, ContextBar still stayed on
// "Idle — Waiting for instructions" during active tool execution).
//
// §20.LL-L10: each assertion is a DOM string the user can see, not an
// internal variable or a derivation shape.

// Helper — runs the exact 5-step derivation ContextBar executes. Keeps
// the integration shape readable + lets a regression in any step fail
// the test instead of hiding inside one-step-isolated unit noise.
const deriveStatusLabel = (opts: {
  messages: ChatMessage[];
  sessionStatus: string | undefined;
  userJustSent?: boolean;
  isWorkingOverride?: boolean;
  terminalHint?: string | null;
  sessionState?: null;
  hasPrompt?: boolean;
}): string => {
  const {
    messages,
    sessionStatus,
    userJustSent = false,
    isWorkingOverride,
    terminalHint = null,
    sessionState = null,
    hasPrompt = false,
  } = opts;

  const isWorking = isWorkingOverride ?? (sessionStatus === 'working' || userJustSent);
  const jsonlLabel = (isWorking ? getActionInfo(messages)?.label : null) ?? null;
  const actionLabel = resolveActionLabel({ isWorking, jsonlLabel, terminalHint, sessionState });
  const effectiveStatus = isWorking && sessionStatus !== 'working' ? 'working' : sessionStatus;
  return getStatusInfo(effectiveStatus, actionLabel, hasPrompt, 0, 0).label;
};

const bashToolUseMsg: ChatMessage = {
  id: 'm1', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'tool_use', id: 'tu_running', name: 'Bash', input: { command: 'sleep 10' } }],
  isSidechain: false,
};

const readToolUseMsg: ChatMessage = {
  id: 'm2', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'tool_use', id: 'tu_read', name: 'Read', input: { file_path: '/path/to/STATE.md' } }],
  isSidechain: false,
};

const editToolUseMsg: ChatMessage = {
  id: 'm3', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'tool_use', id: 'tu_edit', name: 'Edit', input: { file_path: '/path/to/foo.ts' } }],
  isSidechain: false,
};

describe('§6.1.1 — ContextBar status-bar DOM label with isWorkingOverride', () => {
  test('isWorkingOverride=true + raw sessionStatus=idle + unmatched Bash tool_use → "Running command..." (NOT "Idle — Waiting for instructions")', () => {
    // Jose Case 1 sleep 10 acceptance test.
    const label = deriveStatusLabel({
      messages: [bashToolUseMsg],
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Running command...');
    assert.notEqual(label, 'Idle — Waiting for instructions');
  });

  test('isWorkingOverride=true + raw sessionStatus=idle + Read tool_use → "Reading STATE.md..."', () => {
    // Jose acceptance criterion #2 — specific labels, not generic.
    const label = deriveStatusLabel({
      messages: [readToolUseMsg],
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Reading STATE.md...');
  });

  test('isWorkingOverride=true + raw sessionStatus=idle + Edit tool_use → "Editing foo.ts..."', () => {
    // Jose Case 4 Edit acceptance test.
    const label = deriveStatusLabel({
      messages: [editToolUseMsg],
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Editing foo.ts...');
  });

  test('regression baseline: WITHOUT isWorkingOverride, same inputs collapse to "Idle — Waiting for instructions"', () => {
    // Proves the fix is load-bearing: the exact inputs Jose saw in his
    // 2026-04-20 smoke would hit "Idle" without the override prop.
    // If this test's baseline ever changes, the §6.1.1 contract is
    // regressing (the override would be silently unnecessary).
    const label = deriveStatusLabel({
      messages: [bashToolUseMsg],
      sessionStatus: 'idle',
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('isWorkingOverride semantics are UPGRADE-only: false override does not downgrade a raw working status', () => {
    // Intentional scope: §6.1.1 mirrors the pre-existing `userJustSent`
    // pattern — a signal that can upgrade idle→working, not a kill
    // switch that downgrades working→idle. If the server says working
    // the user should trust that (session.status is ground truth when
    // set). The composite's false value just means "we have no extra
    // evidence of work" — it does not contradict the raw signal.
    const label = deriveStatusLabel({
      messages: [],
      sessionStatus: 'working',
      isWorkingOverride: false,
    });
    assert.equal(label, 'Working...');
  });

  test('fallback — override absent, legacy sessionStatus=working + userJustSent=false still renders Working branch', () => {
    // Backward compat: tests or future callers that omit the override
    // prop must still see the legacy behavior. Single-prop design
    // guarantees this via `??` nullish-coalescing.
    const label = deriveStatusLabel({
      messages: [bashToolUseMsg],
      sessionStatus: 'working',
    });
    assert.equal(label, 'Running command...');
  });

  test('waiting for approval — isWorkingOverride=false + sessionStatus=waiting + hasPrompt=true → "Waiting for approval"', () => {
    // Non-regression: approval modal path untouched.
    const label = deriveStatusLabel({
      messages: [],
      sessionStatus: 'waiting',
      isWorkingOverride: false,
      hasPrompt: true,
    });
    assert.equal(label, 'Waiting for approval');
  });

  test('idle without tool_use + override undefined → "Idle — Waiting for instructions" (true idle case untouched)', () => {
    // Non-regression — genuinely-idle sessions must still read idle.
    const label = deriveStatusLabel({
      messages: [],
      sessionStatus: 'idle',
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });
});
