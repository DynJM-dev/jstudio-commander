import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionActivity, SessionTick } from '@commander/shared';
import { buildLiveActivityParts } from '../../components/chat/LiveActivityRow.js';

const mkTick = (overrides: Partial<SessionTick['contextWindow']> = {}): SessionTick => ({
  commanderSessionId: 's1',
  claudeSessionId: null,
  receivedAt: '',
  updatedAtMs: 0,
  model: { id: null, displayName: null },
  contextWindow: {
    usedPercentage: null,
    remainingPercentage: null,
    contextWindowSize: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    exceeds200k: false,
    ...overrides,
  },
  cost: {
    totalCostUsd: null,
    totalDurationMs: null,
    totalApiDurationMs: null,
    totalLinesAdded: null,
    totalLinesRemoved: null,
  },
  rateLimits: {
    fiveHour: { usedPercentage: null, resetsAt: null },
    sevenDay: { usedPercentage: null, resetsAt: null },
  },
  workspace: { worktree: null, cwd: null },
  version: null,
});

const mkActivity = (overrides: Partial<SessionActivity> = {}): SessionActivity => ({
  spinner: '✻',
  verb: 'Ruminating',
  elapsed: '1m 49s',
  tokens: 430,
  effort: 'xhigh',
  raw: '✻ Ruminating… (1m 49s)',
  ...overrides,
});

describe('buildLiveActivityParts — Phase M Bundle 3', () => {
  test('activity-only (no tick) → spinner + verb + elapsed + tokens + effort', () => {
    const { parts, ctxPct } = buildLiveActivityParts(mkActivity(), null);
    assert.deepEqual(parts, ['✻ Ruminating', '1m 49s', '430 tokens', 'xhigh']);
    assert.equal(ctxPct, null);
  });

  test('tick prefers its own tokens over activity.tokens (authoritative)', () => {
    const tick = mkTick({ totalInputTokens: 9999 });
    const { parts } = buildLiveActivityParts(mkActivity({ tokens: 430 }), tick);
    // 9999 > 430 → tick wins regardless of magnitude.
    const tokensPart = parts.find((p) => /tokens/.test(p));
    assert.equal(tokensPart, '9,999 tokens');
  });

  test('tick with null totalInputTokens falls back to activity.tokens', () => {
    const { parts } = buildLiveActivityParts(mkActivity({ tokens: 430 }), mkTick());
    const tokensPart = parts.find((p) => /tokens/.test(p));
    assert.equal(tokensPart, '430 tokens');
  });

  test('neither source has tokens → token segment omitted', () => {
    const { parts } = buildLiveActivityParts(mkActivity({ tokens: undefined }), mkTick());
    assert.equal(parts.some((p) => /tokens/.test(p)), false);
  });

  test('ctxPct pulled from tick.contextWindow.usedPercentage', () => {
    const tick = mkTick({ usedPercentage: 72 });
    const { ctxPct } = buildLiveActivityParts(null, tick);
    assert.equal(ctxPct, 72);
  });

  test('no activity + no tick → empty parts list', () => {
    const { parts, ctxPct } = buildLiveActivityParts(null, null);
    assert.deepEqual(parts, []);
    assert.equal(ctxPct, null);
  });

  test('activity with no spinner emits verb alone (no leading space)', () => {
    const { parts } = buildLiveActivityParts(mkActivity({ spinner: '' }), null);
    // First element is the verb — no leading "  " from the spinner prefix.
    assert.equal(parts[0], 'Ruminating');
  });

  test('elapsed missing → elapsed segment omitted but tokens/effort remain', () => {
    const { parts } = buildLiveActivityParts(
      mkActivity({ elapsed: undefined }),
      mkTick({ totalInputTokens: 100 }),
    );
    assert.equal(parts.includes('1m 49s'), false);
    assert.equal(parts.some((p) => /tokens/.test(p)), true);
    assert.equal(parts.includes('xhigh'), true);
  });
});
