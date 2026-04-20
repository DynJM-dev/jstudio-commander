import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';
import { getActionInfo, getStatusInfo } from '../../components/chat/ContextBar.js';
import {
  resolveActionLabel,
  shouldSuppressComposingLabel,
  STALE_ACTIVITY_MS,
} from '../contextBarAction.js';

// Issue 15.3 Tier A Item 1 — reverse-scan of the assistant-run in
// `getActionInfo` so the rich tool label survives Claude emitting
// text/thinking blocks after a still-unmatched tool_use.
//
// All assertions pin USER-OBSERVABLE DOM strings — the string the user
// sees in the ContextBar status bar at `<span>{status.label}</span>`
// (`ContextBar.tsx:535`). Derivation helper below mirrors the exact
// five-step chain ContextBar runs per render so a regression in any
// step surfaces here.
//
// §20.LL-L10: no internal function-return assertions. Every `assert.equal`
// compares a string the user can read on screen.

const deriveStatusLabel = (opts: {
  messages: ChatMessage[];
  sessionStatus: string | undefined;
  userJustSent?: boolean;
  isWorkingOverride?: boolean;
  terminalHint?: string | null;
  lastActivityAt?: number;
  nowMs?: number;
  hasPrompt?: boolean;
}): string => {
  const {
    messages,
    sessionStatus,
    userJustSent = false,
    isWorkingOverride,
    terminalHint = null,
    lastActivityAt,
    nowMs,
    hasPrompt = false,
  } = opts;

  const isWorking = isWorkingOverride ?? (sessionStatus === 'working' || userJustSent);
  const rawJsonlAction = isWorking ? getActionInfo(messages) : null;
  // Mirrors ContextBar.tsx:343–347 — stale "Composing response..."
  // suppression. Tool-based labels pass through unchanged because
  // `shouldSuppressComposingLabel` returns false for non-composing
  // labels (see `contextBarAction.ts:40–48`).
  const suppressComposing = shouldSuppressComposingLabel(
    rawJsonlAction?.label,
    lastActivityAt,
    nowMs,
  ) && !userJustSent;
  const jsonlAction = suppressComposing ? null : rawJsonlAction;
  const actionLabel = resolveActionLabel({
    isWorking,
    jsonlLabel: jsonlAction?.label ?? null,
    terminalHint,
    sessionState: null,
  });
  const effectiveStatus = isWorking && sessionStatus !== 'working' ? 'working' : sessionStatus;
  const effectiveAction = actionLabel ?? (userJustSent ? 'Processing...' : null);
  return getStatusInfo(effectiveStatus, effectiveAction, hasPrompt, 0, 0).label;
};

// Shared message shapes.
const userMsg: ChatMessage = {
  id: 'u1', parentId: null, role: 'user',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'text', text: 'read X.md' }],
  isSidechain: false,
};

const mkAssistantToolUse = (id: string, name: string, input: Record<string, unknown>): ChatMessage => ({
  id, parentId: null, role: 'assistant',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'tool_use', id: `tu_${id}`, name, input }],
  isSidechain: false,
});

const mkAssistantText = (id: string, text: string): ChatMessage => ({
  id, parentId: null, role: 'assistant',
  timestamp: '2026-04-20T00:00:00.000Z',
  content: [{ type: 'text', text }],
  isSidechain: false,
});

describe('Tier A Item 1 — reverse-scan surfaces rich tool label past trailing prose', () => {
  test('Test 1 — [user, assistant(tool_use Read X.md), assistant(text "I see...")] → "Reading X.md..." (E0.2 pin)', () => {
    // Regression pin: pre-Tier-A, getActionInfo read only the tail
    // assistant message's tail block, which was `text("I see...")` →
    // returned "Composing response..." → stale-suppressed → null →
    // ContextBar DOM fell to generic "Working...". Reverse-scan of
    // the assistant-run (Read's assistant msg + text's assistant msg)
    // finds the Read.
    const messages: ChatMessage[] = [
      userMsg,
      mkAssistantToolUse('a1', 'Read', { file_path: '/tmp/X.md' }),
      mkAssistantText('a2', 'I see...'),
    ];
    const label = deriveStatusLabel({
      messages,
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Reading X.md...');
  });

  test('Test 2 — parallel tool_uses [Read A, Read B] in one assistant message → "Reading B..." (Codeman last-write-wins)', () => {
    // Reverse-scan halts at the first tool_use encountered (right-to-left),
    // which is the most-recently-dispatched one — matches Codeman's
    // `state.currentTool` last-write-wins semantics (§6.6).
    const twoParallel: ChatMessage = {
      id: 'a-par', parentId: null, role: 'assistant',
      timestamp: '2026-04-20T00:00:00.000Z',
      content: [
        { type: 'tool_use', id: 'tu_A', name: 'Read', input: { file_path: '/tmp/A.md' } },
        { type: 'tool_use', id: 'tu_B', name: 'Read', input: { file_path: '/tmp/B.md' } },
      ],
      isSidechain: false,
    };
    const label = deriveStatusLabel({
      messages: [userMsg, twoParallel],
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Reading B.md...');
  });

  test('Test 3 — [tool_use(Edit foo.ts), thinking("...")] in one message → "Editing foo.ts..." (E0.3 pin)', () => {
    // Pre-Tier-A scan read the last block (thinking) → returned
    // "Cogitating..." instead of the tool label. Reverse-scan skips
    // the thinking tail and finds the Edit.
    const assistant: ChatMessage = {
      id: 'a-edit', parentId: null, role: 'assistant',
      timestamp: '2026-04-20T00:00:00.000Z',
      content: [
        { type: 'tool_use', id: 'tu_e', name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { type: 'thinking', text: 'pondering the edit...' },
      ],
      isSidechain: false,
    };
    const label = deriveStatusLabel({
      messages: [userMsg, assistant],
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Editing foo.ts...');
  });

  test('Test 4 — stale lastActivityAt (>30s) + unmatched tool_use → rich label held (E0.3 stale-suppress regression guard)', () => {
    // Staleness suppressor at ContextBar.tsx:343–347 only suppresses
    // the literal "Composing response..." label; tool labels pass
    // through unchanged per `shouldSuppressComposingLabel` contract.
    // This test pins that invariant for a 74s+ tool window (matching
    // E0.2's observed Reading PHASE_V_BRIEF.md · 74s window that
    // E0.3 then regressed from).
    const now = 1_700_000_000_000;
    const staleAt = now - (STALE_ACTIVITY_MS + 44_000); // 74s stale — mirrors E0.2 window
    const assistant: ChatMessage = {
      id: 'a-long', parentId: null, role: 'assistant',
      timestamp: '2026-04-20T00:00:00.000Z',
      content: [
        { type: 'tool_use', id: 'tu_l', name: 'Read', input: { file_path: '/tmp/PHASE_V_BRIEF.md' } },
      ],
      isSidechain: false,
    };
    const label = deriveStatusLabel({
      messages: [userMsg, assistant],
      sessionStatus: 'idle',
      isWorkingOverride: true,
      lastActivityAt: staleAt,
      nowMs: now,
    });
    assert.equal(label, 'Reading PHASE_V_BRIEF.md...');
  });

  test('Test 5 — Bash Case 1 non-regression [user, assistant(tool_use Bash)] → "Running command..."', () => {
    // Anchor: the ONLY pre-Tier-A case Jose saw green in live smoke.
    // Must hold before AND after the reverse-scan change — a regression
    // here would revert the only shipped win.
    const messages: ChatMessage[] = [
      userMsg,
      mkAssistantToolUse('a-bash', 'Bash', { command: 'sleep 10 && echo done' }),
    ];
    const label = deriveStatusLabel({
      messages,
      sessionStatus: 'idle',
      isWorkingOverride: true,
    });
    assert.equal(label, 'Running command...');
  });

  test('Non-regression — Bash Case 1 with raw sessionStatus=working (legacy path, override absent)', () => {
    // Mirrors the backward-compat path: if a caller omits
    // `isWorkingOverride`, the legacy derivation `sessionStatus ===
    // 'working' || userJustSent` still drives isWorking. The reverse-scan
    // must work identically in that path.
    const messages: ChatMessage[] = [
      userMsg,
      mkAssistantToolUse('a-bash', 'Bash', { command: 'sleep 10' }),
    ];
    const label = deriveStatusLabel({
      messages,
      sessionStatus: 'working',
    });
    assert.equal(label, 'Running command...');
  });

  test('Non-regression — idle without any assistant activity → "Idle — Waiting for instructions"', () => {
    // Pure idle case: no assistant messages, no override. Reverse-scan
    // returns null → actionLabel null → getStatusInfo falls to idle
    // branch. Must NOT false-fire a working label.
    const label = deriveStatusLabel({
      messages: [userMsg],
      sessionStatus: 'idle',
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Non-regression — assistant text-only tail (no tool_use anywhere in run) → "Composing response..."', () => {
    // With no tool_use in the assistant-run, the tail-block thinking/
    // text fallback must still fire. This path is Composing (live text
    // streaming) and is what Claude sees during prose reply.
    const messages: ChatMessage[] = [
      userMsg,
      mkAssistantText('a-txt', 'here is my answer...'),
    ];
    const label = deriveStatusLabel({
      messages,
      sessionStatus: 'working',
    });
    assert.equal(label, 'Composing response...');
  });

  test('Non-regression — assistant thinking-only tail → "Cogitating..."', () => {
    // Thinking-only fallback branch.
    const assistant: ChatMessage = {
      id: 'a-think', parentId: null, role: 'assistant',
      timestamp: '2026-04-20T00:00:00.000Z',
      content: [{ type: 'thinking', text: 'pondering...' }],
      isSidechain: false,
    };
    const label = deriveStatusLabel({
      messages: [userMsg, assistant],
      sessionStatus: 'working',
    });
    assert.equal(label, 'Cogitating...');
  });

  test('Scope guard — reverse-scan STOPS at non-assistant message (completed tool across a user turn does NOT surface)', () => {
    // If a Read was dispatched in a PRIOR turn (tool_result then new
    // user turn then fresh assistant text), the stale Read must NOT
    // drive the current label — the walk-back halts at the user
    // message between the turns.
    const priorAssistant = mkAssistantToolUse('a-prior', 'Read', { file_path: '/tmp/old.md' });
    const priorResult: ChatMessage = {
      id: 'u-result', parentId: null, role: 'user',
      timestamp: '2026-04-20T00:00:00.000Z',
      content: [{ type: 'tool_result', toolUseId: 'tu_a-prior', content: 'ok' }],
      isSidechain: false,
    };
    const nextUser: ChatMessage = {
      id: 'u-new', parentId: null, role: 'user',
      timestamp: '2026-04-20T00:00:01.000Z',
      content: [{ type: 'text', text: 'follow up' }],
      isSidechain: false,
    };
    const currentAssistant = mkAssistantText('a-curr', 'sure, here goes...');
    const label = deriveStatusLabel({
      messages: [priorAssistant, priorResult, nextUser, currentAssistant],
      sessionStatus: 'working',
    });
    // Assistant-run scan starts at tail, finds currentAssistant (text),
    // tries to walk back → hits nextUser (user role) → stops. No
    // tool_use in the run → falls to text → "Composing response...".
    // A naive multi-message scan that ignored role boundaries would
    // wrongly surface "Reading old.md..." here.
    assert.equal(label, 'Composing response...');
  });
});
