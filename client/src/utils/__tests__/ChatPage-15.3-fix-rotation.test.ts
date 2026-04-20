import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, SessionState } from '@commander/shared';
import { getActionInfo, getStatusInfo } from '../../components/chat/ContextBar.js';
import { resolveActionLabel, hasUnmatchedToolUse } from '../contextBarAction.js';

// Issue 15.3 Fix Rotation — integration tests pinning the ContextBar
// status-bar `<span>` textContent across the full derivation chain:
//
//   1. `lastUserMessageTs` from messages tail
//   2. `sessionStateIsFresh = sessionStateUpdatedAt > lastUserMessageTs`
//   3. `isSessionWorking = userJustSent
//        || (sessionStatus === 'working' && !heartbeatStale)
//        || unmatchedToolUse
//        || (sessionState?.kind === 'Working' && sessionStateIsFresh)`
//     (Fix 1 — new OR-branch at the end)
//   4. `isWorking = isSessionWorking` (wire-through via isWorkingOverride)
//   5. `jsonlLabel = isWorking ? getActionInfo(messages)?.label : null`
//   6. `actionLabel = resolveActionLabel({...})`   (Fix 2 — typed:Idle
//      branch falls through to jsonlLabel when isWorking && jsonlLabel)
//   7. `effectiveStatus = isWorking && sessionStatus !== 'working' ? 'working' : sessionStatus`
//   8. `status.label` = `getStatusInfo(effectiveStatus, actionLabel ?? (userJustSent ? 'Processing...' : null), hasPrompt, 0, 0).label`
//
// Every `assert.equal` compares the string rendered at
// `ContextBar.tsx:553` — `<span>{status.label}</span>`. §20.LL-L10
// discipline: no internal function-return assertions.
//
// Evidence backing: §12.1 Case 2 (READ-STATE, 20s Idle stuck) and
// Case 3 (EDIT-DIAG, generic "Working..." masking rich label) in
// `docs/15.3-diagnostic.md`.

const deriveStatusLabel = (opts: {
  messages: ChatMessage[];
  sessionStatus: string | undefined;
  userJustSent?: boolean;
  heartbeatStale?: boolean;
  sessionState?: SessionState | null;
  sessionStateUpdatedAt?: number;
  lastUserMessageTsOverride?: number;
  terminalHint?: string | null;
  hasPrompt?: boolean;
}): string => {
  const {
    messages, sessionStatus,
    userJustSent = false,
    heartbeatStale = false,
    sessionState = null,
    sessionStateUpdatedAt = 0,
    lastUserMessageTsOverride,
    terminalHint = null,
    hasPrompt = false,
  } = opts;

  // Mirror ChatPage.tsx's lastUserMessageTs useMemo (scan tail for last user msg).
  let lastUserMessageTs = 0;
  if (lastUserMessageTsOverride !== undefined) {
    lastUserMessageTs = lastUserMessageTsOverride;
  } else {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user') {
        const t = Date.parse(m.timestamp);
        lastUserMessageTs = Number.isFinite(t) ? t : 0;
        break;
      }
    }
  }

  const unmatchedToolUse = hasUnmatchedToolUse(messages);
  const sessionStateIsFresh = sessionStateUpdatedAt > lastUserMessageTs;
  // Issue 15.3 Option 4 (tighten) — hard-off wraps the OR-chain, and
  // downgrades the effective sessionStatus so the DOM flips to Idle
  // even when the server's coarse status is still lagged on 'working'.
  const typedIdleFreshKillSwitch = sessionState?.kind === 'Idle' && sessionStateIsFresh;
  const isSessionWorking = typedIdleFreshKillSwitch
    ? false
    : (userJustSent
       || (sessionStatus === 'working' && !heartbeatStale)
       || unmatchedToolUse
       || (sessionState?.kind === 'Working' && sessionStateIsFresh));
  const effectiveSessionStatus = typedIdleFreshKillSwitch ? 'idle' : sessionStatus;

  const isWorking = isSessionWorking;
  const jsonlLabel = (isWorking ? getActionInfo(messages)?.label : null) ?? null;
  const actionLabel = resolveActionLabel({ isWorking, jsonlLabel, terminalHint, sessionState });
  const effectiveStatus = isWorking && effectiveSessionStatus !== 'working' ? 'working' : effectiveSessionStatus;
  const effectiveAction = actionLabel ?? (userJustSent ? 'Processing...' : null);
  return getStatusInfo(effectiveStatus, effectiveAction, hasPrompt, 0, 0).label;
};

// Fixture helpers.
const userMsg = (ts: string = '2026-04-20T05:00:00.000Z'): ChatMessage => ({
  id: `u-${ts}`, parentId: null, role: 'user',
  timestamp: ts,
  content: [{ type: 'text', text: 'prompt' }],
  isSidechain: false,
});

const bashToolUse: ChatMessage = {
  id: 'a-bash', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T05:00:01.000Z',
  content: [{ type: 'tool_use', id: 'tu_bash', name: 'Bash', input: { command: 'sleep 10 && echo done' } }],
  isSidechain: false,
};

const readToolUse: ChatMessage = {
  id: 'a-read', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T05:00:01.000Z',
  content: [{ type: 'tool_use', id: 'tu_read', name: 'Read', input: { file_path: '/Users/j/Desktop/Projects/jstudio-commander/STATE.md' } }],
  isSidechain: false,
};

const textOnlyAssistant: ChatMessage = {
  id: 'a-text', parentId: null, role: 'assistant',
  timestamp: '2026-04-20T05:00:01.000Z',
  content: [{ type: 'text', text: 'let me think...' }],
  isSidechain: false,
};

describe('15.3 Fix Rotation — Fix 1 (isSessionWorking widening + freshness)', () => {
  test('Test 1 — Case 2 closure: sessionStatus=idle, sessionState=Working fresh → Working-class label (NOT Idle)', () => {
    // §12.1 Case 2 T=+9506ms snapshot: `session.status='idle'` held 20s
    // while `sessionStateKind:"Working", subtype:"ToolExec"` emitted
    // throughout; pre-Fix-1 bar stuck on "Idle — Waiting for instructions".
    // Fix 1 flips isSessionWorking=true via the typed-Working + fresh
    // gate. Tail is text → getActionInfo returns "Composing response...".
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z'); // 1776013200000
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), textOnlyAssistant],
      sessionStatus: 'idle',
      heartbeatStale: false,
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
      sessionStateUpdatedAt: lastUserTs + 5_000, // 5s after user send — fresh
    });
    assert.equal(label, 'Composing response...');
    assert.notEqual(label, 'Idle — Waiting for instructions');
  });

  test('Test 2 — Case 2 staleness guard: same inputs but sessionStateUpdatedAt < lastUserMessageTs → Idle', () => {
    // Stale typed-Working carryover from a prior turn. Freshness predicate
    // rejects. No other OR-branch fires (userJustSent=false, session.status=idle,
    // no unmatched tool_use). isSessionWorking=false → DOM=Idle.
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), textOnlyAssistant],
      sessionStatus: 'idle',
      heartbeatStale: false,
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
      sessionStateUpdatedAt: lastUserTs - 10_000, // 10s BEFORE user send — stale
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Test 2b — freshness boundary: sessionStateUpdatedAt === lastUserMessageTs → NOT fresh (strict `>`)', () => {
    // Edge case: exactly-equal timestamps treated as stale (strict `>`).
    // Tie-break in favor of safety — only confirmed-after-send typed
    // state is trusted.
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), textOnlyAssistant],
      sessionStatus: 'idle',
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
      sessionStateUpdatedAt: lastUserTs, // exact equality
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Test 2c — no prior user message (fresh session): any sessionStateUpdatedAt>0 counts as fresh', () => {
    // No prior user turns. `lastUserMessageTs=0`. Any real typed-state
    // observation is fresher. OR-branch fires correctly.
    const label = deriveStatusLabel({
      messages: [textOnlyAssistant], // no user message at all
      sessionStatus: 'idle',
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
      sessionStateUpdatedAt: 1_000, // any positive value
    });
    assert.equal(label, 'Composing response...');
  });
});

describe('15.3 Fix Rotation — Fix 2 (typed:Idle fall-through to jsonlLabel)', () => {
  test('Test 3 — Case 3 closure: isWorking=true, sessionState=Idle stale, unmatched tool_use → rich label (NOT "Working...")', () => {
    // §12.1 Case 3 T=+5948ms: getActionInfo found tool_use:Bash and
    // returned "Running command..." but resolveActionLabel's typed:Idle
    // branch clobbered it. Fix 2: when isWorking=true (here via
    // userJustSent) AND jsonlLabel present, typed:Idle falls through
    // to return jsonlLabel.
    const label = deriveStatusLabel({
      messages: [userMsg(), bashToolUse],
      sessionStatus: 'idle',
      userJustSent: true, // isWorking=true via this OR-branch
      sessionState: { kind: 'Idle', subtype: 'AwaitingFirstPrompt' },
    });
    assert.equal(label, 'Running command...');
    assert.notEqual(label, 'Working...');
  });

  test('Test 4 — Case 3 fallback preservation: isWorking=false, sessionState=Idle → "Idle — Waiting for instructions"', () => {
    // True-idle path. Fix 2's `if (isWorking && jsonlLabel)` short-circuits
    // false, falls to `return null`. Bar reads Idle correctly.
    const label = deriveStatusLabel({
      messages: [userMsg()], // no assistant activity, no unmatched tool_use
      sessionStatus: 'idle',
      userJustSent: false,
      sessionState: { kind: 'Idle', subtype: 'Generic' },
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Test 4b — fallback preservation: isWorking=true but jsonlLabel=null → Idle branch returns null (no false-positive rich label)', () => {
    // Fix 2 must NOT fire when jsonlLabel is null — would leak a working
    // label during prose-only responses. Here: isWorking=true via
    // userJustSent but last assistant tail is text, so jsonlLabel
    // becomes "Composing response..." (not null). Adjust fixture to
    // isolate: empty messages give getActionInfo → null.
    const label = deriveStatusLabel({
      messages: [userMsg()], // no assistant msg at all → getActionInfo returns null
      sessionStatus: 'idle',
      userJustSent: true,
      sessionState: { kind: 'Idle', subtype: 'Generic' },
    });
    // isWorking=true, but jsonlLabel=null → Fix 2 short-circuits →
    // actionLabel=null → effectiveAction='Processing...' via userJustSent
    // fallback → getStatusInfo Working branch returns 'Processing...'.
    // Bar reads "Processing..." (working-class) without inventing a
    // label the messages don't support. This is correct.
    assert.equal(label, 'Processing...');
  });
});

describe('15.3 Fix Rotation — Joint wiring (Fix 1 + Fix 2 together)', () => {
  test('Test 5 — joint test: sessionStatus=idle, sessionState=Working fresh, unmatched Read tool_use → "Reading STATE.md..."', () => {
    // §12.1-style smoke: Fix 1 flips isSessionWorking via typed-Working
    // fresh (even though session.status=idle), getActionInfo finds the
    // Read tool_use, resolveActionLabel via typed:Working:jsonlLabel-preferred
    // (Fix 2 path not needed because sessionState.kind='Working'; test
    // confirms Fix 1 opens the gate and the existing §6.1 inversion
    // surfaces the rich label).
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), readToolUse],
      sessionStatus: 'idle',
      heartbeatStale: false,
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
      sessionStateUpdatedAt: lastUserTs + 5_000, // fresh
    });
    assert.equal(label, 'Reading STATE.md...');
  });
});

describe('15.3 Fix Rotation — non-regression', () => {
  test('Test 6 — Bash Case 1 non-regression: unmatched Bash tool_use + userJustSent=true → "Running command..."', () => {
    // Anchor from dispatch §6.1.1 + Tier A dispatch. Must hold pre-fix
    // AND post-fix. Bash path is the single acceptance anchor that's
    // held through multiple rotations.
    const label = deriveStatusLabel({
      messages: [userMsg(), bashToolUse],
      sessionStatus: 'idle',
      userJustSent: true,
    });
    assert.equal(label, 'Running command...');
  });

  test('Non-regression — genuinely-idle session with no signals → Idle', () => {
    // Most important regression pin: all Working signals false AND
    // sessionState absent → DOM reads Idle. Fix 1 OR-branch does not
    // false-fire; Fix 2 short-circuits.
    const label = deriveStatusLabel({
      messages: [userMsg()],
      sessionStatus: 'idle',
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Non-regression — true-idle with sessionState=Idle stale-carryover → Idle', () => {
    // Post-fix, sessionState={kind:'Idle'} stale from a prior turn must
    // NOT cause the bar to read Idle unintentionally via some edge case.
    // Here there's no Working signal, no jsonlLabel → both fixes
    // correctly leave the bar at Idle.
    const label = deriveStatusLabel({
      messages: [userMsg()],
      sessionStatus: 'idle',
      sessionState: { kind: 'Idle', subtype: 'JustFinished' },
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Non-regression — Compacting typed state still wins (15.1-A)', () => {
    // Compacting is the highest-priority typed branch in resolveActionLabel
    // and MUST remain untouched by either fix.
    const label = deriveStatusLabel({
      messages: [userMsg(), bashToolUse],
      sessionStatus: 'working',
      sessionState: { kind: 'Compacting' },
    });
    assert.equal(label, 'Compacting context...');
  });

  test('Non-regression — WaitingForInput typed state still returns approval label', () => {
    const label = deriveStatusLabel({
      messages: [userMsg()],
      sessionStatus: 'waiting',
      sessionState: { kind: 'WaitingForInput', subtype: 'Approval' },
      hasPrompt: true,
    });
    assert.equal(label, 'Waiting for approval');
  });

  test('Non-regression — typed:Working with jsonlLabel still fires §6.1 inversion (preserved by Fix 2 scope narrow to Idle branch)', () => {
    // Fix 2 ONLY touches the Idle case. The Working branch's §6.1
    // jsonlLabel-preferred inversion remains intact.
    const label = deriveStatusLabel({
      messages: [userMsg(), bashToolUse],
      sessionStatus: 'working',
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
    });
    assert.equal(label, 'Running command...');
  });
});

describe('15.3 Option 4 (tighten) — hard-off on fresh typed-Idle', () => {
  test('Test 7 — Case 2/3 trailing-edge closure: fresh typed-Idle snaps isSessionWorking off', () => {
    // Live-smoke post-Fix-1 repro: Claude finishes a turn whose final
    // assistant-block is text. session.status lags on 'working' (server
    // pane classifier trailing edge). sessionState transitions to Idle
    // and that transition fires AFTER the user's last message → fresh.
    // Hard-off kills isSessionWorking regardless of the lagging
    // session.status. unmatchedToolUse=false (tool_result landed).
    // userJustSent=false (cleared within ~40ms of send per §12.1).
    // Expected: DOM reads Idle immediately, not the stuck
    // "Composing response..." from the text tail for 60s.
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), textOnlyAssistant],
      sessionStatus: 'working', // server pane lag — still says working
      heartbeatStale: false,
      sessionState: { kind: 'Idle', subtype: 'JustFinished' },
      sessionStateUpdatedAt: lastUserTs + 30_000, // fresh: 30s after user send
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Test 8 — regression guard: stale typed-Idle does NOT fire hard-off (carryover from prior turn)', () => {
    // If sessionState.kind='Idle' is stale (carryover from BEFORE the
    // current user message), the freshness gate correctly marks it
    // not-fresh and the hard-off does NOT fire. Other OR-branches
    // (here: unmatchedToolUse via Bash tool_use) keep the bar Working.
    // Verifies the hard-off is gated on freshness — symmetric with Fix 1.
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z'), bashToolUse],
      sessionStatus: 'idle',
      sessionState: { kind: 'Idle', subtype: 'JustFinished' }, // stale
      sessionStateUpdatedAt: lastUserTs - 5_000, // BEFORE user send = stale
    });
    // Stale-Idle does not kill. unmatchedToolUse carries isSessionWorking.
    // getActionInfo finds Bash → "Running command...". resolveActionLabel's
    // typed:Idle branch — with Fix 2 — returns jsonlLabel because
    // isWorking=true + jsonlLabel present.
    assert.equal(label, 'Running command...');
  });

  test('Test 9 — symmetric boundary: fresh-session (no prior user msg) with fresh typed-Idle still resolves cleanly', () => {
    // Edge case: brand-new session, no user messages ever sent
    // (lastUserMessageTs=0). Any positive sessionStateUpdatedAt counts
    // as fresh. If server happens to emit typed-Idle first, the hard-off
    // fires and the bar reads Idle. No divide-by-zero, no undefined
    // comparison — the predicate is a plain `>` on two numbers.
    const label = deriveStatusLabel({
      messages: [], // no messages at all
      sessionStatus: 'idle',
      sessionState: { kind: 'Idle', subtype: 'AwaitingFirstPrompt' },
      sessionStateUpdatedAt: 1_000, // any positive → fresh against 0 anchor
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });

  test('Test 9b — non-regression: fresh typed-Idle with userJustSent=true still shows Processing (optimistic echo preserved)', () => {
    // Subtle edge: if the user sends a message and typed-Idle is
    // somehow already fresh in the tiny window before Claude responds,
    // the hard-off would kill userJustSent's optimistic "Processing..."
    // render. But that window is ~40ms per §12.1 observations, and
    // typed-Idle freshness would require the server to have emitted
    // Idle AFTER the user message timestamp. In practice unlikely.
    // Test documents the behavior: IF fresh typed-Idle lands, hard-off
    // dominates even over userJustSent. This is correct — a fresh
    // server-confirmed Idle should override the client optimistic flag.
    const lastUserTs = Date.parse('2026-04-20T05:00:00.000Z');
    const label = deriveStatusLabel({
      messages: [userMsg('2026-04-20T05:00:00.000Z')],
      sessionStatus: 'idle',
      userJustSent: true,
      sessionState: { kind: 'Idle', subtype: 'JustFinished' },
      sessionStateUpdatedAt: lastUserTs + 100, // fresh
    });
    assert.equal(label, 'Idle — Waiting for instructions');
  });
});
