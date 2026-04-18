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

  test('activity.tokens wins over tick.totalInputTokens — label means turn delta', () => {
    // Issue 4: tick.totalInputTokens is cumulative context (20x inflated vs
    // the "tokens" label, which implies per-turn delta like Codeman shows).
    // Activity.tokens is the pane-parsed turn delta — that's the one the
    // label refers to, so it must win even when tick has a bigger number.
    const tick = mkTick({ totalInputTokens: 44146 });
    const { parts } = buildLiveActivityParts(mkActivity({ tokens: 2200 }), tick);
    const tokensPart = parts.find((p) => /tokens/.test(p));
    assert.equal(tokensPart, '2,200 tokens');
  });

  test('activity.tokens present + no tick → still activity.tokens', () => {
    const { parts } = buildLiveActivityParts(mkActivity({ tokens: 430 }), mkTick());
    const tokensPart = parts.find((p) => /tokens/.test(p));
    assert.equal(tokensPart, '430 tokens');
  });

  test('activity.tokens null → omit segment even when tick has cumulative', () => {
    // Issue 4: refuse to show tick.totalInputTokens under the "tokens"
    // label — the cumulative number belongs to a different counter
    // (HeaderStatsWidget, PHASE_REPORT view). Omitting is the honest
    // fallback; mislabeling cumulative as turn delta is the original bug.
    const { parts } = buildLiveActivityParts(
      mkActivity({ tokens: undefined }),
      mkTick({ totalInputTokens: 44146 }),
    );
    assert.equal(parts.some((p) => /tokens/.test(p)), false);
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
