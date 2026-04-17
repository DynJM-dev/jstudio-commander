import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisibleCtxPct, bandForPercentage } from '../contextBands.js';

// Phase N.0 — ctx% suppression when Commander has inferred a /compact
// rotation. The persisted tick still carries the PRE-compact value
// (typically 100%); resolveVisibleCtxPct returns null in that case so
// downstream band/toast/strip logic treats it as "no tick yet" instead
// of claiming the context is full.

describe('resolveVisibleCtxPct — Phase N.0', () => {
  test('postCompact=true with stale 100% tick → null (suppresses stale figure)', () => {
    assert.equal(resolveVisibleCtxPct(100, true), null);
  });

  test('postCompact=true with any real number → null regardless of value', () => {
    assert.equal(resolveVisibleCtxPct(45, true), null);
    assert.equal(resolveVisibleCtxPct(0, true), null);
  });

  test('postCompact=false with real tick → passthrough', () => {
    assert.equal(resolveVisibleCtxPct(72, false), 72);
    assert.equal(resolveVisibleCtxPct(0, false), 0);
  });

  test('postCompact=false with null/undefined/NaN → null', () => {
    assert.equal(resolveVisibleCtxPct(null, false), null);
    assert.equal(resolveVisibleCtxPct(undefined, false), null);
    assert.equal(resolveVisibleCtxPct(Number.NaN, false), null);
  });

  test('band derivation composes: postCompact=true always yields `unknown` band', () => {
    // Regression: earlier version used `postCompact ? null : tick...`
    // inline; extracting the helper + composing with bandForPercentage
    // must keep the same net effect — post-compact sessions render the
    // muted-grey "unknown" band, never green/yellow/orange/red.
    assert.equal(bandForPercentage(resolveVisibleCtxPct(100, true)), 'unknown');
    assert.equal(bandForPercentage(resolveVisibleCtxPct(45, true)), 'unknown');
  });

  test('band derivation composes: postCompact=false passes through to the real band', () => {
    assert.equal(bandForPercentage(resolveVisibleCtxPct(30, false)), 'green');
    assert.equal(bandForPercentage(resolveVisibleCtxPct(72, false)), 'yellow');
    assert.equal(bandForPercentage(resolveVisibleCtxPct(85, false)), 'orange');
    assert.equal(bandForPercentage(resolveVisibleCtxPct(95, false)), 'red');
  });
});
