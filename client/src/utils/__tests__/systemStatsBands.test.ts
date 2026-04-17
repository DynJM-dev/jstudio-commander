import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandForBudget,
  bandForMemory,
  formatBytes,
} from '../systemStatsBands';
import { formatResetsCountdown } from '../../hooks/useAggregateRateLimits';

// Phase O — HeaderStatsWidget pure-helper pins.
//
// The chips in the widget derive their color + secondary text from three
// pure helpers + the formatResetsCountdown exported by the rate-limits
// hook. The widget renders React so we don't mount it here, but we
// guard every band threshold + every countdown tier so a regression in
// the arithmetic surfaces loudly.

describe('bandForBudget — Phase O CPU + rate-limit coloring', () => {
  test('< 50 → green', () => {
    assert.equal(bandForBudget(0), 'green');
    assert.equal(bandForBudget(49.9), 'green');
  });
  test('50-79 → yellow', () => {
    assert.equal(bandForBudget(50), 'yellow');
    assert.equal(bandForBudget(79.9), 'yellow');
  });
  test('80-89 → orange', () => {
    assert.equal(bandForBudget(80), 'orange');
    assert.equal(bandForBudget(89.9), 'orange');
  });
  test('>= 90 → red', () => {
    assert.equal(bandForBudget(90), 'red');
    assert.equal(bandForBudget(999), 'red');
  });
  test('null / undefined / NaN → unknown (muted chip)', () => {
    assert.equal(bandForBudget(null), 'unknown');
    assert.equal(bandForBudget(undefined), 'unknown');
    assert.equal(bandForBudget(Number.NaN), 'unknown');
  });
});

describe('bandForMemory — OS memory pressure thresholds', () => {
  test('< 70 → green (headroom)', () => {
    assert.equal(bandForMemory(0), 'green');
    assert.equal(bandForMemory(69.9), 'green');
  });
  test('70-89 → yellow (tight but OK)', () => {
    assert.equal(bandForMemory(70), 'yellow');
    assert.equal(bandForMemory(89.9), 'yellow');
  });
  test('>= 90 → red (swap risk; no orange tier)', () => {
    assert.equal(bandForMemory(90), 'red');
    assert.equal(bandForMemory(100), 'red');
  });
  test('null / undefined / NaN → unknown', () => {
    assert.equal(bandForMemory(null), 'unknown');
    assert.equal(bandForMemory(undefined), 'unknown');
    assert.equal(bandForMemory(Number.NaN), 'unknown');
  });
});

describe('formatBytes — human-readable memory rendering', () => {
  test('GB rendering with one-decimal precision', () => {
    assert.equal(formatBytes(12 * 1024 * 1024 * 1024), '12.0 GB');
    assert.equal(formatBytes(Math.floor(12.345 * 1024 * 1024 * 1024)), '12.3 GB');
  });
  test('MB + KB tiers round without decimals', () => {
    assert.equal(formatBytes(820 * 1024 * 1024), '820 MB');
    assert.equal(formatBytes(450 * 1024), '450 KB');
  });
  test('very small values fall through to raw bytes', () => {
    assert.equal(formatBytes(500), '500 B');
    assert.equal(formatBytes(0), '0 B');
  });
  test('null / negative / NaN → "—"', () => {
    assert.equal(formatBytes(null), '—');
    assert.equal(formatBytes(undefined), '—');
    assert.equal(formatBytes(-1), '—');
    assert.equal(formatBytes(Number.NaN), '—');
  });
});

describe('formatResetsCountdown — Phase O countdown tiers', () => {
  const baseNow = Date.parse('2026-04-17T12:00:00Z');

  test('null resetsAt → "—"', () => {
    assert.equal(formatResetsCountdown(null, baseNow), '—');
  });

  test('unparseable ISO → "—"', () => {
    assert.equal(formatResetsCountdown('not-a-date', baseNow), '—');
  });

  test('past or <30s future → "resetting…"', () => {
    assert.equal(formatResetsCountdown('2026-04-17T11:59:00Z', baseNow), 'resetting…');
    assert.equal(
      formatResetsCountdown(new Date(baseNow + 20_000).toISOString(), baseNow),
      'resetting…',
    );
  });

  test('< 1h → "Xm Ys" format', () => {
    assert.equal(
      formatResetsCountdown(new Date(baseNow + 14 * 60_000 + 30_000).toISOString(), baseNow),
      '14m 30s',
    );
  });

  test('< 1d → "Xh Ym" format', () => {
    assert.equal(
      formatResetsCountdown(new Date(baseNow + 4 * 3_600_000 + 23 * 60_000).toISOString(), baseNow),
      '4h 23m',
    );
  });

  test('>= 1d → "Xd Yh" format (7d chip uses this path)', () => {
    assert.equal(
      formatResetsCountdown(new Date(baseNow + 2 * 86_400_000 + 14 * 3_600_000).toISOString(), baseNow),
      '2d 14h',
    );
  });
});
