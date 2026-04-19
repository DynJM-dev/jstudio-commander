import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_MODEL,
  normalizeModelId,
  getContextLimit,
} from '../constants/models.js';

describe('MODEL_CONTEXT_LIMITS', () => {
  test('claude-opus-4-7 → 1M context window', () => {
    assert.equal(MODEL_CONTEXT_LIMITS['claude-opus-4-7'], 1_000_000);
  });

  test('claude-opus-4-6 → 1M (backward compat)', () => {
    assert.equal(MODEL_CONTEXT_LIMITS['claude-opus-4-6'], 1_000_000);
  });

  test('claude-sonnet-4-6 → 1M context window', () => {
    assert.equal(MODEL_CONTEXT_LIMITS['claude-sonnet-4-6'], 1_000_000);
  });

  test('claude-haiku-4-5 → 200k context window', () => {
    assert.equal(MODEL_CONTEXT_LIMITS['claude-haiku-4-5'], 200_000);
  });

  test('claude-haiku-4-5-20251001 → 200k context window', () => {
    assert.equal(MODEL_CONTEXT_LIMITS['claude-haiku-4-5-20251001'], 200_000);
  });
});

describe('normalizeModelId', () => {
  test('strips [1m] suffix to yield base id', () => {
    assert.equal(normalizeModelId('claude-opus-4-6[1m]'), 'claude-opus-4-6');
  });

  test('strips bracketed suffix with whitespace', () => {
    assert.equal(normalizeModelId('claude-sonnet-4-6 [beta]'), 'claude-sonnet-4-6');
  });

  test('resolves short alias "opus" to 4.7', () => {
    assert.equal(normalizeModelId('opus'), 'claude-opus-4-7');
  });

  test('resolves short alias "sonnet" to canonical id', () => {
    assert.equal(normalizeModelId('sonnet'), 'claude-sonnet-4-6');
  });

  test('resolves short alias "haiku" to canonical id', () => {
    assert.equal(normalizeModelId('haiku'), 'claude-haiku-4-5');
  });

  test('passes through claude-opus-4-7 unchanged', () => {
    assert.equal(normalizeModelId('claude-opus-4-7'), 'claude-opus-4-7');
  });

  test('passes unknown ids through unchanged', () => {
    assert.equal(normalizeModelId('some-future-model'), 'some-future-model');
  });
});

describe('getContextLimit', () => {
  test('claude-opus-4-7 → 1M', () => {
    assert.equal(getContextLimit('claude-opus-4-7'), 1_000_000);
  });

  test('claude-opus-4-6[1m] → 1M (suffix opts in)', () => {
    assert.equal(getContextLimit('claude-opus-4-6[1m]'), 1_000_000);
  });

  test('claude-opus-4-6 → 1M (backward compat)', () => {
    assert.equal(getContextLimit('claude-opus-4-6'), 1_000_000);
  });

  test('opus short form → resolves to 4.7 → 1M', () => {
    assert.equal(getContextLimit('opus'), 1_000_000);
  });

  test('claude-sonnet-4-6 → 1M', () => {
    assert.equal(getContextLimit('claude-sonnet-4-6'), 1_000_000);
  });

  test('claude-haiku-4-5-20251001 → 200k', () => {
    assert.equal(getContextLimit('claude-haiku-4-5-20251001'), 200_000);
  });

  test('haiku short form → 200k', () => {
    assert.equal(getContextLimit('haiku'), 200_000);
  });

  test('unknown model string → fallback 200k', () => {
    assert.equal(getContextLimit('gpt-future-9000'), DEFAULT_CONTEXT_LIMIT);
    assert.equal(getContextLimit('gpt-future-9000'), 200_000);
  });

  test('null → fallback 200k', () => {
    assert.equal(getContextLimit(null), 200_000);
  });

  test('undefined → fallback 200k', () => {
    assert.equal(getContextLimit(undefined), 200_000);
  });

  test('empty string → fallback 200k', () => {
    assert.equal(getContextLimit(''), 200_000);
  });

  test('haiku with [1m] suffix → 1M (suffix wins over base default)', () => {
    assert.equal(getContextLimit('claude-haiku-4-5[1m]'), 1_000_000);
  });

  test('case-insensitive [1M] suffix', () => {
    assert.equal(getContextLimit('claude-opus-4-6[1M]'), 1_000_000);
  });
});

// Issue 16 — Commander-spawned sessions default to the 1M-context variant.
describe('DEFAULT_MODEL — Issue 16', () => {
  test('default id is the [1m] variant of opus 4.7', () => {
    assert.equal(DEFAULT_MODEL, 'claude-opus-4-7[1m]');
  });

  test('getContextLimit(DEFAULT_MODEL) → 1M', () => {
    assert.equal(getContextLimit(DEFAULT_MODEL), 1_000_000);
  });
});
