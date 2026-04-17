// Phase S.1 Patch 4 / 5 — unit coverage for the ContextBar's ctx%
// resolver. The invariant is: when a SessionTick is present and its
// contextWindow.usedPercentage is non-null, the bar MUST render that
// value (same source LiveActivityRow, the band rail, and
// ContextLowToast read). The fallback token/contextLimit ratio only
// kicks in for pre-Phase-M or brand-new sessions that haven't emitted
// a statusline tick yet.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionTick } from '@commander/shared';

import { resolveContextPercent } from '../../components/chat/ContextBar.js';

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

describe('ContextBar.resolveContextPercent — tick-first source of truth', () => {
  test('tick present + usedPercentage set → renders tick value (rounded)', () => {
    const tick = mkTick({ usedPercentage: 72.4 });
    assert.equal(resolveContextPercent(tick, 100_000, 200_000), 72);
  });

  test('tick value wins even when the token ratio would suggest otherwise', () => {
    // Token ratio = 50/200 = 25%. Tick says 87%. ContextBar must
    // render 87 so it stays in sync with LiveActivityRow + band rail.
    const tick = mkTick({ usedPercentage: 87 });
    assert.equal(resolveContextPercent(tick, 50_000, 200_000), 87);
  });

  test('tick > 100 is clamped to 100', () => {
    const tick = mkTick({ usedPercentage: 142 });
    assert.equal(resolveContextPercent(tick, 0, 200_000), 100);
  });

  test('tick null → fallback to token/contextLimit ratio', () => {
    assert.equal(resolveContextPercent(null, 60_000, 200_000), 30);
  });

  test('tick present but usedPercentage null → fallback', () => {
    // Legacy payload shape: tick arrived but the statusline didn't
    // carry a context %. Fall back to token ratio.
    const tick = mkTick({ usedPercentage: null });
    assert.equal(resolveContextPercent(tick, 80_000, 200_000), 40);
  });

  test('zero tokens + no tick → 0%', () => {
    assert.equal(resolveContextPercent(null, 0, 200_000), 0);
  });

  test('zero context limit + no tick → 0% (no divide-by-zero)', () => {
    assert.equal(resolveContextPercent(null, 10_000, 0), 0);
  });
});
