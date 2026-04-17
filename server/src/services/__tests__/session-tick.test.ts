import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { StatuslineRawPayload } from '@commander/shared';
import { normalizeTick } from '../session-tick.service.js';

// Phase M B1 — normalizer contract. Exercises the camelCase mapping,
// optional-chaining fallbacks for fields older Claude Code versions
// omit, and the `null` convention that keeps client renderers from
// deref'ing `undefined` on a field that never shipped in their version.

const mkPayload = (overrides: Partial<StatuslineRawPayload> = {}): StatuslineRawPayload => ({
  hook_event_name: 'Status',
  session_id: '1449747a-4ff1-48f5-a49f-210405c1cfe5',
  transcript_path: '/Users/test/.claude/projects/x/abc.jsonl',
  cwd: '/Users/test/codeman-cases/JLFamily',
  version: '2.1.112',
  model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7' },
  workspace: { git_worktree: 'feature-payments' },
  cost: {
    total_cost_usd: 0.42,
    total_duration_ms: 120000,
    total_api_duration_ms: 2300,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
  context_window: {
    total_input_tokens: 15234,
    total_output_tokens: 4521,
    context_window_size: 200000,
    used_percentage: 8,
    remaining_percentage: 92,
    current_usage: {
      input_tokens: 8500,
      output_tokens: 1200,
      cache_creation_input_tokens: 5000,
      cache_read_input_tokens: 2000,
    },
  },
  exceeds_200k_tokens: false,
  rate_limits: {
    five_hour: { used_percentage: 38, resets_at: '2026-04-17T16:30:00Z' },
    seven_day: { used_percentage: 87, resets_at: '2026-04-24T09:15:00Z' },
  },
  ...overrides,
});

describe('normalizeTick — Phase M B1', () => {
  test('happy path: every major field mapped', () => {
    const tick = normalizeTick('commander-session-1', mkPayload(), '2026-04-17T05:00:00.000Z');
    assert.equal(tick.commanderSessionId, 'commander-session-1');
    assert.equal(tick.claudeSessionId, '1449747a-4ff1-48f5-a49f-210405c1cfe5');
    assert.equal(tick.receivedAt, '2026-04-17T05:00:00.000Z');
    assert.equal(tick.model.id, 'claude-opus-4-7');
    assert.equal(tick.model.displayName, 'Opus 4.7');
    assert.equal(tick.contextWindow.usedPercentage, 8);
    assert.equal(tick.contextWindow.remainingPercentage, 92);
    assert.equal(tick.contextWindow.contextWindowSize, 200000);
    assert.equal(tick.contextWindow.totalInputTokens, 15234);
    assert.equal(tick.contextWindow.exceeds200k, false);
    assert.equal(tick.cost.totalCostUsd, 0.42);
    assert.equal(tick.cost.totalLinesAdded, 156);
    assert.equal(tick.rateLimits.fiveHour.usedPercentage, 38);
    assert.equal(tick.rateLimits.fiveHour.resetsAt, '2026-04-17T16:30:00Z');
    assert.equal(tick.rateLimits.sevenDay.usedPercentage, 87);
    assert.equal(tick.workspace.worktree, 'feature-payments');
    assert.equal(tick.workspace.cwd, '/Users/test/codeman-cases/JLFamily');
    assert.equal(tick.version, '2.1.112');
  });

  test('rate_limits absent (pre-v1.2.80) → null fields, no throw', () => {
    const raw = mkPayload({ rate_limits: undefined });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.rateLimits.fiveHour.usedPercentage, null);
    assert.equal(tick.rateLimits.fiveHour.resetsAt, null);
    assert.equal(tick.rateLimits.sevenDay.usedPercentage, null);
    assert.equal(tick.rateLimits.sevenDay.resetsAt, null);
  });

  test('current_usage null (first tick before API call) → context fields still populated', () => {
    const raw = mkPayload({
      context_window: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        context_window_size: 200000,
        used_percentage: 0,
        remaining_percentage: 100,
        current_usage: null,
      },
    });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.contextWindow.usedPercentage, 0);
    assert.equal(tick.contextWindow.totalInputTokens, 0);
  });

  test('exceeds_200k = true surfaces as boolean', () => {
    const raw = mkPayload({ exceeds_200k_tokens: true });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.contextWindow.exceeds200k, true);
  });

  test('missing model fields → string null (not empty string)', () => {
    const raw = mkPayload({ model: undefined });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.model.id, null);
    assert.equal(tick.model.displayName, null);
  });

  test('NaN / Infinity on numeric fields → null (forward-safe fallback)', () => {
    const raw = mkPayload({
      context_window: {
        used_percentage: Number.NaN as unknown as number,
        remaining_percentage: Number.POSITIVE_INFINITY,
      },
    });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.contextWindow.usedPercentage, null);
    // Infinity is finite=false → also null.
    assert.equal(tick.contextWindow.remainingPercentage, null);
  });

  test('empty-string workspace.git_worktree → null (typed as "no worktree")', () => {
    const raw = mkPayload({ workspace: { git_worktree: '' } });
    const tick = normalizeTick('s1', raw, 'now');
    assert.equal(tick.workspace.worktree, null);
  });
});
