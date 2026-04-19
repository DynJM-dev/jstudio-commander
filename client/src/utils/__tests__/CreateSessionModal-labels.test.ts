import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { priceDetail, MODEL_OPTIONS } from '../../components/sessions/CreateSessionModal.js';

// Issue 16.1.1 — integration coverage for the modal's per-variant
// context-label contract. The shared-layer assertion
// (`getContextLimit('claude-opus-4-7[1m]') === 1_000_000`) was green
// but the modal label still read "200K ctx" for every `[1m]` row
// because the bug lived at the call site, not the lookup: the old
// `priceDetail` did a raw `MODEL_CONTEXT_LIMITS[modelId]` lookup and
// every `[1m]` MODEL_OPTIONS row passed the base id. Both drifts are
// covered here.

describe('priceDetail — per-variant ctx label', () => {
  test('base Opus 4.7 → 200K ctx', () => {
    const d = priceDetail('claude-opus-4-7');
    assert.match(d, /^200K ctx · \$15(\.\d+)?\/\$75(\.\d+)?$/);
  });

  test('Opus 4.7 [1m] suffix → 1M ctx (pricing unchanged)', () => {
    const d = priceDetail('claude-opus-4-7[1m]');
    assert.match(d, /^1M ctx · \$15(\.\d+)?\/\$75(\.\d+)?$/);
  });

  test('base Sonnet 4.6 → 200K ctx', () => {
    const d = priceDetail('claude-sonnet-4-6');
    assert.match(d, /^200K ctx · \$3(\.\d+)?\/\$15(\.\d+)?$/);
  });

  test('Sonnet 4.6 [1m] → 1M ctx', () => {
    const d = priceDetail('claude-sonnet-4-6[1m]');
    assert.match(d, /^1M ctx · \$3(\.\d+)?\/\$15(\.\d+)?$/);
  });

  test('Haiku 4.5 → 200K ctx (no [1m] variant exposed)', () => {
    const d = priceDetail('claude-haiku-4-5');
    assert.match(d, /^200K ctx · \$0\.8\/\$4$/);
  });

  test('Opus 4.6 legacy base → 200K ctx', () => {
    const d = priceDetail('claude-opus-4-6');
    assert.match(d, /^200K ctx · \$15(\.\d+)?\/\$75(\.\d+)?$/);
  });

  test('Opus 4.6 [1m] legacy → 1M ctx', () => {
    const d = priceDetail('claude-opus-4-6[1m]');
    assert.match(d, /^1M ctx · \$15(\.\d+)?\/\$75(\.\d+)?$/);
  });

  test('unknown model id → no price, renders only ctx fallback', () => {
    const d = priceDetail('gpt-future-9000');
    // Unknown model: MODEL_PRICING miss → ctx-only branch. getContextLimit
    // returns DEFAULT_CONTEXT_LIMIT (200K) for unknowns.
    assert.equal(d, '200K ctx');
  });
});

describe('MODEL_OPTIONS — integration labels', () => {
  const byValue = Object.fromEntries(MODEL_OPTIONS.map((o) => [o.value, o]));

  test('every [1m] variant exposes "1M ctx" in its detail', () => {
    for (const o of MODEL_OPTIONS) {
      if (!o.value.includes('[1m]')) continue;
      assert.match(
        o.detail,
        /^1M ctx/,
        `${o.value} should start with "1M ctx", got: "${o.detail}"`,
      );
    }
  });

  test('every non-[1m] entry exposes "200K ctx" in its detail', () => {
    for (const o of MODEL_OPTIONS) {
      if (o.value.includes('[1m]')) continue;
      assert.match(
        o.detail,
        /^200K ctx/,
        `${o.value} should start with "200K ctx", got: "${o.detail}"`,
      );
    }
  });

  test('Opus 4.7 pair: base 200K, [1m] 1M', () => {
    assert.match(byValue['claude-opus-4-7']!.detail, /^200K ctx/);
    assert.match(byValue['claude-opus-4-7[1m]']!.detail, /^1M ctx/);
  });

  test('Sonnet 4.6 pair: base 200K, [1m] 1M', () => {
    assert.match(byValue['claude-sonnet-4-6']!.detail, /^200K ctx/);
    assert.match(byValue['claude-sonnet-4-6[1m]']!.detail, /^1M ctx/);
  });

  test('Opus 4.6 legacy pair: base 200K, [1m] 1M', () => {
    assert.match(byValue['claude-opus-4-6']!.detail, /^200K ctx/);
    assert.match(byValue['claude-opus-4-6[1m]']!.detail, /^1M ctx/);
  });
});
