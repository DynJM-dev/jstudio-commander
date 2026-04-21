import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ContentBlock } from '@commander/shared';

// Phase Y Rotation 1.6.B hotfix — pure-helper tests for Fix D
// (role-stability tuple reconciler) and Fix E (active-poll window
// post user-send). Harness is `node:test` + `tsx` — no jsdom / RTL
// added per rejection trigger (a) + Rotation 1.5 posture. The hook's
// React-lifecycle wiring is a thin wrapper over these helpers and is
// smoke-verified by Jose's Case 1 acceptance gate.
//
// Cross-reference: `docs/phase-y-rotation-1-6-diagnostic.md` §4 names
// the fix shapes; this file exercises them at the contract level.

import {
  // Fix D surface
  computeTailSignature,
  reconcileStreamingState,
  INITIAL_STREAMING_SNAPSHOT,
  type StreamingSnapshot,
  // Fix E surface
  ACTIVE_AFTER_SEND_MS,
  ACTIVE_POLL_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  computeActivePollWindow,
  selectPollInterval,
  mostRecentUserMessageAt,
} from '../../hooks/useChat';

// ----- Fixture helpers --------------------------------------------------

let uidCounter = 0;
const uid = (): string => `msg-${++uidCounter}`;

const assistantText = (text: string, id?: string): ChatMessage => ({
  id: id ?? uid(),
  parentId: null,
  role: 'assistant',
  timestamp: new Date().toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

const assistantTextThenToolUse = (text: string, toolName: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'assistant',
  timestamp: new Date().toISOString(),
  content: [
    { type: 'text', text },
    { type: 'tool_use', id: 'tu-1', name: toolName, input: {} },
  ],
  isSidechain: false,
});

const userText = (text: string, at?: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: at ?? new Date().toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

// ========================================================================
// Fix D — role-stability tuple reconciler
// ========================================================================

describe('Phase Y Rotation 1.6.B Fix D — Test 1: role transition terminates composing immediately', () => {
  test('assistant/text tail → user/text tail returns clear directive (non-assistant branch)', () => {
    // Simulate one reconciliation cycle where the prev snapshot
    // captured an assistant/text tail, and the current tail is a
    // user/text message. Old behavior would have relied on the 3s
    // stability timer to eventually flip streamingAssistantId null;
    // Fix D clears immediately.
    const prevAssistant = assistantText('streaming…', 'a-1');
    const prevSig = computeTailSignature(prevAssistant);
    const prevSnapshot: StreamingSnapshot = {
      id: prevAssistant.id,
      hash: JSON.stringify(prevAssistant.content),
      tupleSig: prevSig,
    };
    const currentTail = userText('next user prompt');

    const directive = reconcileStreamingState(currentTail, prevSnapshot);
    assert.equal(directive.kind, 'clear');
    if (directive.kind === 'clear') {
      assert.equal(directive.reason, 'non-assistant');
      assert.equal(directive.snapshot.id, null);
      assert.equal(directive.snapshot.hash, '');
      assert.equal(directive.snapshot.tupleSig, computeTailSignature(currentTail));
    }
  });

  test('prev assistant/text then undefined/empty-tail → clear', () => {
    const prevAssistant = assistantText('x', 'a-2');
    const prevSnapshot: StreamingSnapshot = {
      id: prevAssistant.id,
      hash: JSON.stringify(prevAssistant.content),
      tupleSig: computeTailSignature(prevAssistant),
    };
    const directive = reconcileStreamingState(undefined, prevSnapshot);
    assert.equal(directive.kind, 'clear');
    if (directive.kind === 'clear') assert.equal(directive.reason, 'non-assistant');
  });
});

describe('Phase Y Rotation 1.6.B Fix D — Test 2: block transition within same assistant message terminates composing', () => {
  test('assistant/text tail → assistant/tool_use tail (same message id) returns clear directive', () => {
    // Block transition WITHIN the same assistant message: the tail
    // grows a tool_use block after emitting text. Under rotation 1.5
    // this was handled by the lastBlock.type !== 'text' early-exit,
    // but the tuple signature captures it explicitly as a non-text
    // clear regardless of whether id/hash would also have changed.
    const prevAssistant = assistantText('thinking about this...', 'a-3');
    const prevSnapshot: StreamingSnapshot = {
      id: prevAssistant.id,
      hash: JSON.stringify(prevAssistant.content),
      tupleSig: computeTailSignature(prevAssistant),
    };
    const nextTail: ChatMessage = {
      id: 'a-3',
      parentId: null,
      role: 'assistant',
      timestamp: prevAssistant.timestamp,
      content: [
        { type: 'text', text: 'thinking about this...' },
        { type: 'tool_use', id: 'tu-x', name: 'Read', input: { file_path: '/a.ts' } },
      ],
      isSidechain: false,
    };

    const directive = reconcileStreamingState(nextTail, prevSnapshot);
    assert.equal(directive.kind, 'clear');
    if (directive.kind === 'clear') {
      assert.equal(directive.reason, 'non-text');
    }
  });

  test('tuple signature captures (id, role, lastBlock.type) tuple', () => {
    const a = assistantText('hi', 'same');
    const aToolUse: ChatMessage = {
      id: 'same',
      parentId: null,
      role: 'assistant',
      timestamp: a.timestamp,
      content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} }],
      isSidechain: false,
    };
    assert.notEqual(
      computeTailSignature(a),
      computeTailSignature(aToolUse),
      'block type flip with identical id must produce a distinct tuple signature',
    );
  });
});

describe('Phase Y Rotation 1.6.B Fix D — Test 3: sustained assistant-text growth keeps streamingAssistantId', () => {
  test('hash change with same id+role+type returns set directive with reason=hash-changed', () => {
    // Simulate Claude's text streaming: same tail message, content
    // grew (hash diff), tuple sig identical. Expected: keep
    // streamingAssistantId === tail.id, re-arm timer, reason tags
    // the diagnostic as hash-only change (NOT a tuple flip).
    const firstPass = assistantText('starting to respond', 'a-4');
    const prevSnapshot: StreamingSnapshot = {
      id: firstPass.id,
      hash: JSON.stringify(firstPass.content),
      tupleSig: computeTailSignature(firstPass),
    };
    const grownPass: ChatMessage = {
      ...firstPass,
      content: [{ type: 'text', text: 'starting to respond, more content here' }],
    };

    const directive = reconcileStreamingState(grownPass, prevSnapshot);
    assert.equal(directive.kind, 'set');
    if (directive.kind === 'set') {
      assert.equal(directive.id, firstPass.id);
      assert.equal(directive.armTimer, true);
      assert.equal(directive.reason, 'hash-changed');
      assert.equal(directive.snapshot.tupleSig, computeTailSignature(grownPass));
    }
  });

  test('stable tail (identical id+hash+tupleSig) returns stable — no state churn, timer keeps running', () => {
    const t = assistantText('final response', 'a-5');
    const snapshot: StreamingSnapshot = {
      id: t.id,
      hash: JSON.stringify(t.content),
      tupleSig: computeTailSignature(t),
    };
    const directive = reconcileStreamingState(t, snapshot);
    assert.equal(directive.kind, 'stable');
  });

  test('brand-new assistant/text tail from INITIAL_STREAMING_SNAPSHOT returns set with reason=tail-changed', () => {
    const fresh = assistantText('first turn response', 'a-6');
    const directive = reconcileStreamingState(fresh, INITIAL_STREAMING_SNAPSHOT);
    assert.equal(directive.kind, 'set');
    if (directive.kind === 'set') {
      assert.equal(directive.id, fresh.id);
      assert.equal(directive.armTimer, true);
      assert.equal(directive.reason, 'tail-changed');
    }
  });
});

// ========================================================================
// Fix E — active-poll window post user-send
// ========================================================================

describe('Phase Y Rotation 1.6.B Fix E — Test 4: userJustSent window opens active poll', () => {
  test('sessionStatus=idle + active-poll-window=true → ACTIVE_POLL_INTERVAL_MS', () => {
    const interval = selectPollInterval('idle', true);
    assert.equal(interval, ACTIVE_POLL_INTERVAL_MS);
    assert.equal(interval, 1_500);
  });

  test('computeActivePollWindow within 30s post-send → true', () => {
    const now = 1_800_000_000_000;
    const lastUserMessageAt = now - 5_000; // 5s ago
    assert.equal(computeActivePollWindow(lastUserMessageAt, now), true);
  });

  test('mostRecentUserMessageAt picks the latest user-role message', () => {
    // Scan from the tail; first user-role message found is the
    // timestamp we gate the window on.
    const t1 = '2026-04-21T10:00:00.000Z';
    const t2 = '2026-04-21T10:00:30.000Z';
    const msgs: ChatMessage[] = [
      userText('first user prompt', t1),
      assistantText('response', 'a-e1'),
      userText('second user prompt', t2),
    ];
    const parsed = mostRecentUserMessageAt(msgs);
    assert.equal(parsed, Date.parse(t2));
  });
});

describe('Phase Y Rotation 1.6.B Fix E — Test 5: userJustSent window expires', () => {
  test('computeActivePollWindow at exactly 30.001s post-send → false', () => {
    const now = 1_800_000_000_000;
    const lastUserMessageAt = now - (ACTIVE_AFTER_SEND_MS + 1);
    assert.equal(computeActivePollWindow(lastUserMessageAt, now), false);
  });

  test('sessionStatus=idle + active-poll-window=false → IDLE_POLL_INTERVAL_MS', () => {
    const interval = selectPollInterval('idle', false);
    assert.equal(interval, IDLE_POLL_INTERVAL_MS);
    assert.equal(interval, 5_000);
  });

  test('computeActivePollWindow handles null / zero / undefined gracefully', () => {
    const now = 1_800_000_000_000;
    assert.equal(computeActivePollWindow(null, now), false);
    assert.equal(computeActivePollWindow(0, now), false);
  });

  test('mostRecentUserMessageAt returns null when no user message visible', () => {
    const msgs: ChatMessage[] = [
      assistantText('assistant only', 'a-e2'),
    ];
    assert.equal(mostRecentUserMessageAt(msgs), null);
  });
});

describe('Phase Y Rotation 1.6.B Fix E — Test 6: sessionStatus=working overrides idle+no-send (non-regression)', () => {
  test('sessionStatus=working + active-poll-window=false → ACTIVE_POLL_INTERVAL_MS', () => {
    // Non-regression: pre-1.6.B behavior — when the server has
    // correctly classified working, the active-poll stays active
    // regardless of whether the post-send window is open. Covers
    // the mid-session tool-exec case where the user sent a prompt
    // >30s ago but Claude is still actively working (long tool).
    const interval = selectPollInterval('working', false);
    assert.equal(interval, ACTIVE_POLL_INTERVAL_MS);
  });

  test('sessionStatus=waiting + active-poll-window=false → ACTIVE_POLL_INTERVAL_MS', () => {
    // Item 3 approval-modal posture: server says waiting, we keep
    // active polling regardless. Helper must return ACTIVE, not
    // IDLE, to preserve the permission-prompt polling cadence.
    const interval = selectPollInterval('waiting', false);
    assert.equal(interval, ACTIVE_POLL_INTERVAL_MS);
  });

  test('sessionStatus=stopped + active-poll-window=false → IDLE (stopped session doesn\'t widen cadence)', () => {
    const interval = selectPollInterval('stopped', false);
    assert.equal(interval, IDLE_POLL_INTERVAL_MS);
  });

  test('sessionStatus=undefined + active-poll-window=false → IDLE (pre-bootstrap)', () => {
    const interval = selectPollInterval(undefined, false);
    assert.equal(interval, IDLE_POLL_INTERVAL_MS);
  });

  test('sessionStatus=undefined + active-poll-window=true → ACTIVE (post-send window wins at bootstrap)', () => {
    // Bootstrap race: useChat's first render can see
    // sessionStatus=undefined before the first session-status prop
    // arrives. If the user already hit Submit, we want to respect
    // the active-poll window immediately — don't miss the
    // Claude-response streaming just because we haven't been told
    // the session is working yet.
    const interval = selectPollInterval(undefined, true);
    assert.equal(interval, ACTIVE_POLL_INTERVAL_MS);
  });
});
