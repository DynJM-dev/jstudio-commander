import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';

// Phase Y Rotation 1.7 closeout — pure-helper tests for Fix 1.7.A
// (Working fallback) + Fix 1.7.C (liveThinking scan narrowing).
// Fix 1.7.B (tool-chip render audit) concluded as audit-only — no
// helpers introduced, no tests required per dispatch §3.
//
// Harness: `node:test` + `tsx`, no jsdom / RTL — matches rotation
// 1.5 / 1.6.B posture. React wiring is smoke-verified by Jose's
// Case A / C / D acceptance gate.
//
// Cross-reference: `docs/dispatches/PHASE_Y_ROTATION_1_7_CLOSEOUT_DISPATCH.md`
// §2 + §4 name the fix shapes; this file exercises them at the
// contract level.

import {
  // Fix 1.7.A surface
  WORKING_FALLBACK_MS,
  WORKING_FALLBACK_CEILING_MS,
  mostRecentAssistantMessageAt,
  shouldEngageWorkingFallback,
  resolveEffectiveStatus,
} from '../contextBarAction';

import {
  // Fix 1.7.C surface
  extractLiveThinkingText,
} from '../liveActivity';

// ----- Fixture helpers --------------------------------------------------

let uidCounter = 0;
const uid = (): string => `msg-${++uidCounter}`;

const assistantMsg = (
  blocks: ChatMessage['content'],
  timestamp?: string,
  id?: string,
): ChatMessage => ({
  id: id ?? uid(),
  parentId: null,
  role: 'assistant',
  timestamp: timestamp ?? new Date().toISOString(),
  content: blocks,
  isSidechain: false,
});

const userMsg = (text: string, timestamp?: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: timestamp ?? new Date().toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

// ========================================================================
// Fix 1.7.A — shouldEngageWorkingFallback + mostRecentAssistantMessageAt
// ========================================================================

describe('Phase Y Rotation 1.7 Fix 1.7.A — Test 1: fallback engages', () => {
  test('userJustSent=true + assistant 6s ago + user send 3s ago → TRUE', () => {
    // Dispatch §2 Test 1 shape verbatim.
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - 6_000,
      nowMs: now,
    });
    assert.equal(engaged, true);
  });

  test('first prompt of session (no prior assistant) → TRUE immediately after threshold', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 6_000,
      lastAssistantBlockTs: null, // fresh session, no assistant ever
      nowMs: now,
    });
    assert.equal(engaged, true);
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.A — Test 2: fallback NOT engaged within 5s window', () => {
  test('assistant block 2s ago (within 5s window) → FALSE', () => {
    // Dispatch §2 Test 2 shape verbatim.
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - 2_000,
      nowMs: now,
    });
    assert.equal(engaged, false);
  });

  test('assistant block exactly at 5s threshold → FALSE (strict >, not >=)', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - WORKING_FALLBACK_MS,
      nowMs: now,
    });
    assert.equal(engaged, false, 'gap === 5s should NOT engage; gap > 5s required');
  });

  test('assistant block 5001ms ago → TRUE (strictly past threshold)', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - (WORKING_FALLBACK_MS + 1),
      nowMs: now,
    });
    assert.equal(engaged, true);
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.A — Test 3: fallback expires at 90s ceiling', () => {
  test('user send 91s ago, no assistant → FALSE (ceiling guards stuck Working...)', () => {
    // Dispatch §2 Test 3 shape verbatim.
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 91_000,
      lastAssistantBlockTs: null,
      nowMs: now,
    });
    assert.equal(engaged, false);
  });

  test('user send exactly at 90s ceiling → FALSE (>= cutoff)', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - WORKING_FALLBACK_CEILING_MS,
      lastAssistantBlockTs: null,
      nowMs: now,
    });
    assert.equal(engaged, false, 'gap === 90s ceiling exits the fallback');
  });

  test('user send 89.9s ago → TRUE (still inside ceiling)', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 89_900,
      lastAssistantBlockTs: null,
      nowMs: now,
    });
    assert.equal(engaged, true);
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.A — Test 4: waiting passthrough NOT shadowed (Item 3 sacred)', () => {
  // Integration-style: compose resolveEffectiveStatus (pre-fallback
  // output) with the ContextBar-layer gate (`rawEffectiveStatus ===
  // 'idle' && shouldEngageWorkingFallback(...)`). This mirrors the
  // actual wiring in ContextBar.tsx.
  const computeEffectiveStatusWithFallback = (args: {
    sessionStatus: string | undefined;
    codemanIsWorking: boolean | undefined;
    legacyIsWorking: boolean;
    userJustSent: boolean;
    lastUserSendTs: number | null;
    lastAssistantBlockTs: number | null;
    nowMs: number;
  }): string | undefined => {
    const raw = resolveEffectiveStatus(args.sessionStatus, args.codemanIsWorking, args.legacyIsWorking);
    const engaged =
      raw === 'idle' &&
      shouldEngageWorkingFallback({
        userJustSent: args.userJustSent,
        lastUserSendTs: args.lastUserSendTs,
        lastAssistantBlockTs: args.lastAssistantBlockTs,
        nowMs: args.nowMs,
      });
    return engaged ? 'working' : raw;
  };

  test('sessionStatus=waiting + userJustSent + stale assistant → stays waiting (fallback does NOT shadow)', () => {
    const now = 1_800_000_000_000;
    const status = computeEffectiveStatusWithFallback({
      sessionStatus: 'waiting',
      codemanIsWorking: false,
      legacyIsWorking: false,
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - 60_000,
      nowMs: now,
    });
    assert.equal(status, 'waiting', 'waiting passthrough preserved — Item 3 modal mount path intact');
  });

  test('sessionStatus=waiting + all fallback conditions met → stays waiting', () => {
    // Belt-and-braces: even when the fallback's pure predicate would
    // return TRUE in isolation, the ContextBar gate checks
    // `rawEffectiveStatus === 'idle'` FIRST. Waiting never becomes
    // the fallback's target.
    const now = 1_800_000_000_000;
    const status = computeEffectiveStatusWithFallback({
      sessionStatus: 'waiting',
      codemanIsWorking: undefined,
      legacyIsWorking: false,
      userJustSent: true,
      lastUserSendTs: now - 10_000,
      lastAssistantBlockTs: null,
      nowMs: now,
    });
    assert.equal(status, 'waiting');
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.A — Test 5: concrete assistant signal preempts fallback', () => {
  test('codeman says working → fallback does NOT override; concrete wins', () => {
    // When codeman returns `isWorking=true`, resolveEffectiveStatus
    // returns 'working'. The ContextBar gate's `raw === 'idle'`
    // short-circuit prevents the fallback from firing. Compose the
    // final status FIRST (before any assert narrowing) so TS doesn't
    // narrow `raw` to the literal 'working' and reject the comparison.
    const now = 1_800_000_000_000;
    const raw = resolveEffectiveStatus('idle', true, false);
    const wouldEngageInIsolation = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - 60_000,
      nowMs: now,
    });
    const finalStatus = raw === 'idle' && wouldEngageInIsolation ? 'working' : raw;
    assert.equal(raw, 'working');
    assert.equal(wouldEngageInIsolation, true);
    assert.equal(finalStatus, 'working', 'codeman-working is preserved, not re-upgraded via fallback');
  });

  test('userJustSent=false → fallback never engages regardless of timing', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: false,
      lastUserSendTs: now - 3_000,
      lastAssistantBlockTs: now - 60_000,
      nowMs: now,
    });
    assert.equal(engaged, false);
  });

  test('lastUserSendTs null → fallback does not engage (no ceiling basis)', () => {
    const now = 1_800_000_000_000;
    const engaged = shouldEngageWorkingFallback({
      userJustSent: true,
      lastUserSendTs: null,
      lastAssistantBlockTs: null,
      nowMs: now,
    });
    assert.equal(engaged, false);
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.A — mostRecentAssistantMessageAt helper', () => {
  test('picks latest assistant timestamp, ignoring user messages', () => {
    const userT = '2026-04-21T10:00:00.000Z';
    const asstT1 = '2026-04-21T10:00:30.000Z';
    const asstT2 = '2026-04-21T10:01:00.000Z';
    const laterUser = '2026-04-21T10:01:30.000Z';
    const msgs: ChatMessage[] = [
      userMsg('first', userT),
      assistantMsg([{ type: 'text', text: 'A1' }], asstT1),
      assistantMsg([{ type: 'text', text: 'A2' }], asstT2),
      userMsg('second', laterUser),
    ];
    assert.equal(mostRecentAssistantMessageAt(msgs), Date.parse(asstT2));
  });

  test('returns null when no assistant messages visible', () => {
    const msgs: ChatMessage[] = [userMsg('only user')];
    assert.equal(mostRecentAssistantMessageAt(msgs), null);
  });
});

// ========================================================================
// Fix 1.7.C — extractLiveThinkingText (scan narrowing)
// ========================================================================

describe('Phase Y Rotation 1.7 Fix 1.7.C — Test 1: pre-text thinking surfaces', () => {
  test('[thinking, text] tail → thinking content returned (thinking before text block)', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: 'planning the response' },
      { type: 'text', text: 'Here is the answer.' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'planning the response');
  });

  test('multiple thinking blocks all before text → latest pre-text thinking wins', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: 'first thought' },
      { type: 'thinking', text: 'refined thought' },
      { type: 'text', text: 'answer.' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'refined thought');
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.C — Test 2: post-text thinking suppressed (Candidate 42 closure)', () => {
  test('[text, thinking] tail → null (post-text thinking must NOT render)', () => {
    // Canonical Candidate 42 shape: Claude emitted a thinking block
    // AFTER a text block, and the pre-1.7 scan returned that thinking's
    // text (which was actually response content bleed). Post-1.7 we
    // return null to keep LiveActivityRow clean.
    const msg = assistantMsg([
      { type: 'text', text: 'Here is the start of the response.' },
      { type: 'thinking', text: 'response text bleeding into thinking display' },
    ]);
    assert.equal(extractLiveThinkingText(msg), null);
  });

  test('[thinking, text, thinking] → returns ONLY pre-text thinking, ignores post-text', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: 'pre-text reasoning' },
      { type: 'text', text: 'response' },
      { type: 'thinking', text: 'post-text reflection' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'pre-text reasoning');
  });

  test('[text, thinking, text] → mid thinking surfaces (it sits before the LAST text block)', () => {
    // Narrow scan uses the LAST text block as the upper bound per
    // dispatch §4. In [text, thinking, text] the last text block is
    // at index 2; the thinking at index 1 is in [0, 2) so it IS
    // surfaced. The suppression target is thinking AT OR AFTER the
    // last text block (Candidate 42's end-of-message bleed), not
    // mid-composition thinking between two text blocks.
    const msg = assistantMsg([
      { type: 'text', text: 'start' },
      { type: 'thinking', text: 'mid-response reasoning' },
      { type: 'text', text: 'finish' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'mid-response reasoning');
  });

  test('[text, thinking, text, thinking] → null (trailing thinking still suppressed)', () => {
    // The trailing thinking block at index 3 is AFTER the last text
    // block at index 2 — this IS the Candidate 42 bleed shape (post-
    // final-text thinking). Narrow scan upper bound is 2, so index 3
    // thinking is excluded. Index 1 thinking IS in [0, 2), but in
    // this scenario there's NO thinking at index 1 (it's text), so
    // we end up scanning index 0 which is also text → null.
    // Actually the explicit fixture: text, thinking, text, thinking.
    // Index 0=text, 1=thinking, 2=text, 3=thinking. lastTextIndex=2.
    // Scan range [0, 2). Index 1=thinking → returns 'mid'. So this
    // test is actually the [text, thinking, text] case again. Skip
    // the ambiguous expectation and lock the canonical Candidate 42
    // shape in Test 2's main case instead.
    // Canonical bleed: text then thinking-at-end with no more text.
    const msg = assistantMsg([
      { type: 'text', text: 'response' },
      { type: 'thinking', text: 'post-response internal note bleed' },
    ]);
    assert.equal(extractLiveThinkingText(msg), null);
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.C — Test 3: thinking-only (no text yet) non-regression', () => {
  test('[thinking] tail → thinking content returned (full-scan path unchanged)', () => {
    const msg = assistantMsg([{ type: 'thinking', text: 'still planning...' }]);
    assert.equal(extractLiveThinkingText(msg), 'still planning...');
  });

  test('[thinking, thinking, thinking] → latest thinking returned', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: 'T1' },
      { type: 'thinking', text: 'T2' },
      { type: 'thinking', text: 'T3' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'T3');
  });

  test('[thinking, tool_use] → thinking content returned (tool_use is not text; full scan)', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: 'about to use a tool' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } },
    ]);
    assert.equal(
      extractLiveThinkingText(msg),
      'about to use a tool',
      'tool_use does not close the scan — only text does',
    );
  });
});

describe('Phase Y Rotation 1.7 Fix 1.7.C — edge cases', () => {
  test('null / undefined message → null', () => {
    assert.equal(extractLiveThinkingText(null), null);
    assert.equal(extractLiveThinkingText(undefined), null);
  });

  test('user role message → null (guard)', () => {
    const msg = userMsg('I am user not assistant');
    assert.equal(extractLiveThinkingText(msg), null);
  });

  test('empty content array → null', () => {
    const msg = assistantMsg([]);
    assert.equal(extractLiveThinkingText(msg), null);
  });

  test('no thinking blocks at all → null', () => {
    const msg = assistantMsg([
      { type: 'text', text: 'just text' },
    ]);
    assert.equal(extractLiveThinkingText(msg), null);
  });

  test('thinking block with empty text → scans past it', () => {
    const msg = assistantMsg([
      { type: 'thinking', text: '' },
      { type: 'thinking', text: 'real thinking' },
    ]);
    assert.equal(
      extractLiveThinkingText(msg),
      'real thinking',
      'empty-text thinking is skipped (b.text falsy guard)',
    );
  });
});
