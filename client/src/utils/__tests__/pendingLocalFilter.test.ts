import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';

// Candidate 38/41 — pending-local message filter extracted from
// ChatPage.tsx. Tests pin the retention rules closing the four
// observed failure modes:
//   Mode 1 — slash commands never match jsonlUserTexts (system
//     local_command records, not user-role)
//   Mode 2 — transcript pipeline lag leaves sessionStatus='idle'
//     during the turn, preventing the 10s+sessionAck valve
//   Mode 3 — api.post failure (no server record ever lands)
//   Mode 4 — refresh-driven disappearance (mitigated by bounded
//     stick-time, not fully closed — full fix requires server-ack-
//     before-display, out of scope)
//
// Harness: `node:test` + `tsx`, matches rotation-1.5 through -1.7
// posture. Contract-level shape tests.

import {
  buildJsonlUserTextsSet,
  normalizePendingLocalText,
  shouldKeepPendingLocalEntry,
  PENDING_LOCAL_ACK_AGE_MS,
  PENDING_LOCAL_MAX_AGE_MS,
} from '../pendingLocalFilter';

// ----- Fixture helpers --------------------------------------------------

let uidCounter = 0;
const uid = (): string => `local-${Date.now()}-test-${++uidCounter}`;

const localEntry = (text: string, atMs: number): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: new Date(atMs).toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

const userTextMsg = (text: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: new Date().toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

// ========================================================================
// Gate 1 — canonical text match → drop
// ========================================================================

describe('pendingLocalFilter — Gate 1: canonical text match drops entry', () => {
  test('exact text match → drop', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello world', now - 1_000);
    const jsonlUserTexts = buildJsonlUserTextsSet([userTextMsg('hello world')]);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts,
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, false);
  });

  test('case+whitespace drift still matches (#224 hardening)', () => {
    // Server mangled case + collapsed newlines — normalization
    // bridges the drift. Verifies the #224 invariant survives the
    // helper extraction.
    const now = 1_800_000_000_000;
    const entry = localEntry('  Hello\n\nWorld  ', now - 1_000);
    const jsonlUserTexts = buildJsonlUserTextsSet([userTextMsg('hello world')]);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts,
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, false);
  });

  test('different text → keep', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('distinct message', now - 1_000);
    const jsonlUserTexts = buildJsonlUserTextsSet([userTextMsg('something else')]);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts,
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, true);
  });
});

// ========================================================================
// Gate 2 — unconditional max-age ceiling → drop
// ========================================================================

describe('pendingLocalFilter — Gate 2: unconditional hard ceiling', () => {
  test('entry older than PENDING_LOCAL_MAX_AGE_MS → drop regardless of sessionStatus', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('/effort high', now - (PENDING_LOCAL_MAX_AGE_MS + 1_000));
    const jsonlUserTexts = new Set<string>(); // nothing matched — Mode 1 shape
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts,
      sessionStatus: 'idle', // Mode 1 / Mode 2: session stays idle
      nowMs: now,
    });
    assert.equal(keep, false, 'hard ceiling fires regardless of sessionStatus=idle');
  });

  test('exactly at PENDING_LOCAL_MAX_AGE_MS → drop (>= cutoff)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('whatever', now - PENDING_LOCAL_MAX_AGE_MS);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, false);
  });

  test('one ms before ceiling → keep', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('whatever', now - (PENDING_LOCAL_MAX_AGE_MS - 1));
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, true);
  });

  test('past ceiling + sessionStatus=working → drop (both gates agree)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('anything', now - 120_000);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'working',
      nowMs: now,
    });
    assert.equal(keep, false);
  });
});

// ========================================================================
// Gate 3 — ack-based safety valve (pre-existing, preserved)
// ========================================================================

describe('pendingLocalFilter — Gate 3: ack-based safety valve', () => {
  test('age > 10s + sessionStatus=working → drop', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - (PENDING_LOCAL_ACK_AGE_MS + 100));
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'working',
      nowMs: now,
    });
    assert.equal(keep, false);
  });

  test('age > 10s + sessionStatus=waiting → drop', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - (PENDING_LOCAL_ACK_AGE_MS + 100));
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'waiting',
      nowMs: now,
    });
    assert.equal(keep, false);
  });

  test('age > 10s + sessionStatus=idle → keep (NOT yet at max ceiling)', () => {
    // Mode 1 / Mode 2 case: slash command OR classifier-lagged turn.
    // The ack valve does NOT fire. Entry survives until hard ceiling.
    const now = 1_800_000_000_000;
    const entry = localEntry('/effort high', now - (PENDING_LOCAL_ACK_AGE_MS + 100));
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'idle',
      nowMs: now,
    });
    assert.equal(keep, true, 'classifier-lagged pure-text turn keeps local until hard ceiling');
  });

  test('age < 10s + sessionStatus=working → keep (within ack grace)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - 5_000);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'working',
      nowMs: now,
    });
    assert.equal(keep, true);
  });

  test('age exactly at 10s + sessionStatus=working → keep (strict >, not >=)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - PENDING_LOCAL_ACK_AGE_MS);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'working',
      nowMs: now,
    });
    assert.equal(keep, true, 'ack valve requires strictly > 10s, matching pre-fix behavior');
  });

  test('age > 10s + sessionStatus=stopped → keep (only working/waiting trigger valve)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - 15_000);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: 'stopped',
      nowMs: now,
    });
    assert.equal(keep, true);
  });

  test('age > 10s + sessionStatus=undefined → keep (no ack)', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('hello', now - 15_000);
    const keep = shouldKeepPendingLocalEntry({
      entry,
      jsonlUserTexts: new Set(),
      sessionStatus: undefined,
      nowMs: now,
    });
    assert.equal(keep, true);
  });
});

// ========================================================================
// Normalization helper
// ========================================================================

describe('pendingLocalFilter — normalizePendingLocalText', () => {
  test('lowercase + trim + collapse whitespace runs', () => {
    assert.equal(normalizePendingLocalText('  Hello World  '), 'hello world');
    assert.equal(normalizePendingLocalText('Hello\n\nWorld'), 'hello world');
    assert.equal(normalizePendingLocalText('Hello\tWorld'), 'hello world');
    assert.equal(normalizePendingLocalText('  MIXED   Case\n\tHere  '), 'mixed case here');
  });

  test('empty string → empty string', () => {
    assert.equal(normalizePendingLocalText(''), '');
  });

  test('whitespace-only → empty string', () => {
    assert.equal(normalizePendingLocalText('   \n\n\t  '), '');
  });
});

// ========================================================================
// buildJsonlUserTextsSet
// ========================================================================

describe('pendingLocalFilter — buildJsonlUserTextsSet', () => {
  test('builds set from user-role text blocks only', () => {
    const msgs: ChatMessage[] = [
      userTextMsg('first'),
      {
        id: 'm2',
        parentId: null,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        content: [{ type: 'text', text: 'assistant reply — should NOT be in set' }],
        isSidechain: false,
      },
      userTextMsg('second'),
      {
        id: 'm4',
        parentId: null,
        role: 'system',
        timestamp: new Date().toISOString(),
        content: [{ type: 'local_command', stream: 'stdout', text: 'slash output' }],
        isSidechain: false,
      },
    ];
    const set = buildJsonlUserTextsSet(msgs);
    assert.equal(set.size, 2);
    assert.equal(set.has('first'), true);
    assert.equal(set.has('second'), true);
    assert.equal(set.has('assistant reply — should not be in set'), false);
    assert.equal(set.has('slash output'), false);
  });

  test('ignores user messages with non-text blocks (tool_result)', () => {
    const msgs: ChatMessage[] = [
      {
        id: 'm1',
        parentId: null,
        role: 'user',
        timestamp: new Date().toISOString(),
        content: [{ type: 'tool_result', toolUseId: 'tu-1', content: 'result' }],
        isSidechain: false,
      },
    ];
    const set = buildJsonlUserTextsSet(msgs);
    assert.equal(set.size, 0);
  });

  test('normalizes text when building set (consumer gets a normalized lookup)', () => {
    const msgs: ChatMessage[] = [userTextMsg('  HELLO\n\tWorld  ')];
    const set = buildJsonlUserTextsSet(msgs);
    assert.equal(set.has('hello world'), true);
    assert.equal(set.has('  HELLO\n\tWorld  '), false);
  });

  test('empty messages → empty set', () => {
    assert.equal(buildJsonlUserTextsSet([]).size, 0);
  });
});

// ========================================================================
// Mode-specific canonical scenarios (integration-style)
// ========================================================================

describe('pendingLocalFilter — Mode scenarios (integration-style)', () => {
  test('Mode 1 — slash command typed in chat, session stays idle, hard ceiling fires at 60s', () => {
    const sendTs = 1_800_000_000_000;
    const entry = localEntry('/effort high', sendTs);
    const jsonlUserTexts = new Set<string>(); // slash command NEVER echoes as user-role

    // At T+1s — keep (fresh).
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts,
        sessionStatus: 'idle',
        nowMs: sendTs + 1_000,
      }),
      true,
    );
    // At T+30s — still keep (hard ceiling not reached, ack valve never fires).
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts,
        sessionStatus: 'idle',
        nowMs: sendTs + 30_000,
      }),
      true,
    );
    // At T+60s — drop (hard ceiling fires). Pre-fix: stuck forever.
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts,
        sessionStatus: 'idle',
        nowMs: sendTs + PENDING_LOCAL_MAX_AGE_MS,
      }),
      false,
    );
  });

  test('Mode 2 — pure-text turn with classifier lag, JSONL lands at turn-end, normal drop', () => {
    // Happy path with transcript pipeline arriving late but eventually.
    const sendTs = 1_800_000_000_000;
    const entry = localEntry('Walk me through X', sendTs);

    // At T+5s: server hasn't echoed yet, session still idle. Keep.
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: sendTs + 5_000,
      }),
      true,
    );
    // At T+25s: server JSONL echoed the user record. Drop via Gate 1.
    const jsonlUserTexts = buildJsonlUserTextsSet([userTextMsg('Walk me through X')]);
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts,
        sessionStatus: 'idle',
        nowMs: sendTs + 25_000,
      }),
      false,
    );
  });

  test('Mode 3 — api.post failure pre-fix simulation: entry persists, hard ceiling eventually drops', () => {
    // Server never got the message. Session stays idle. No JSONL match.
    // Pre-1.7-followup: stuck forever. Post-hard-ceiling: drops at 60s.
    const sendTs = 1_800_000_000_000;
    const entry = localEntry('failed send', sendTs);

    // At T+59s — still keep.
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: sendTs + 59_000,
      }),
      true,
    );
    // At T+60s — drop.
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: sendTs + 60_000,
      }),
      false,
    );
  });

  test('Fast path — healthy send clears within a couple seconds', () => {
    // User sends, Claude acks, JSONL lands at T+1.5s. Local drops via
    // Gate 1 well before any age-based gate fires.
    const sendTs = 1_800_000_000_000;
    const entry = localEntry('hi claude', sendTs);
    const jsonlUserTexts = buildJsonlUserTextsSet([userTextMsg('hi claude')]);
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts,
        sessionStatus: 'working',
        nowMs: sendTs + 1_500,
      }),
      false,
    );
  });
});

// ========================================================================
// Edge cases
// ========================================================================

describe('pendingLocalFilter — edge cases', () => {
  test('entry with no text block → normalized to empty; drops IF jsonl set has empty string (degenerate), keeps otherwise', () => {
    const now = 1_800_000_000_000;
    const entry: ChatMessage = {
      id: uid(),
      parentId: null,
      role: 'user',
      timestamp: new Date(now - 1_000).toISOString(),
      content: [{ type: 'tool_result', toolUseId: 'tu-1', content: 'x' }],
      isSidechain: false,
    };
    // Empty jsonl set → keeps (Gate 1 doesn't match, age fresh, no ack).
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: now,
      }),
      true,
    );
  });

  test('unparseable timestamp → age computed as 0, keeps', () => {
    const now = 1_800_000_000_000;
    const entry: ChatMessage = {
      id: uid(),
      parentId: null,
      role: 'user',
      timestamp: 'not-a-valid-iso-string',
      content: [{ type: 'text', text: 'hello' }],
      isSidechain: false,
    };
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: now,
      }),
      true,
      'unparseable timestamp treated as age=0 so the entry is never age-dropped; Gate 1 match still works normally',
    );
  });

  test('timestamp in the future (clock skew) → age computed as negative, entry kept', () => {
    const now = 1_800_000_000_000;
    const entry = localEntry('fresh', now + 5_000);
    assert.equal(
      shouldKeepPendingLocalEntry({
        entry,
        jsonlUserTexts: new Set(),
        sessionStatus: 'idle',
        nowMs: now,
      }),
      true,
    );
  });
});
