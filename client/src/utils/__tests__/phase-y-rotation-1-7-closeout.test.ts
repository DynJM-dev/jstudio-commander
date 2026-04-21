import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';

// Phase Y Rotation 1.7 closeout — pure-helper tests for Fix 1.7.C
// (liveThinking scan narrowing).
//
// Fix 1.7.A (Working fallback) deleted in Commander Finalizer FINAL:
// the timestamp-based `shouldEngageWorkingFallback` predicate was
// replaced by `useSessionPaneActivity` driving `paneActivelyChanging`
// from Phase T pane capture as the ground-truth input to
// `resolveEffectiveStatus`. Tests for the deleted predicate are
// removed; the new hook has its own test file.
//
// Fix 1.7.B (tool-chip render audit) concluded as audit-only — no
// helpers introduced, no tests required per dispatch §3.
//
// Harness: `node:test` + `tsx`, no jsdom / RTL — matches rotation
// 1.5 / 1.6.B posture.

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
    const msg = assistantMsg([
      { type: 'text', text: 'start' },
      { type: 'thinking', text: 'mid-response reasoning' },
      { type: 'text', text: 'finish' },
    ]);
    assert.equal(extractLiveThinkingText(msg), 'mid-response reasoning');
  });

  test('[text, thinking, text, thinking] → null (trailing thinking still suppressed)', () => {
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
