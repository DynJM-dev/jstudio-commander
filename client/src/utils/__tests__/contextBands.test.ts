import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandForPercentage,
  isWarningCrossing,
  bandColor,
  bandRank,
  CTX_GREEN_MAX,
  CTX_YELLOW_MAX,
  CTX_ORANGE_MAX,
  type ContextBand,
} from '../contextBands.js';

describe('bandForPercentage — Phase M Bundle 2', () => {
  test('null / undefined / NaN → unknown', () => {
    assert.equal(bandForPercentage(null), 'unknown');
    assert.equal(bandForPercentage(undefined), 'unknown');
    assert.equal(bandForPercentage(Number.NaN), 'unknown');
  });

  test('0 / 49 → green (below CTX_GREEN_MAX)', () => {
    assert.equal(bandForPercentage(0), 'green');
    assert.equal(bandForPercentage(49), 'green');
    assert.equal(bandForPercentage(CTX_GREEN_MAX - 1), 'green');
  });

  test('50 / 79 → yellow (CTX_GREEN_MAX..CTX_YELLOW_MAX inclusive)', () => {
    assert.equal(bandForPercentage(CTX_GREEN_MAX), 'yellow');
    assert.equal(bandForPercentage(65), 'yellow');
    assert.equal(bandForPercentage(CTX_YELLOW_MAX), 'yellow');
  });

  test('80 / 89 → orange', () => {
    assert.equal(bandForPercentage(CTX_YELLOW_MAX + 1), 'orange');
    assert.equal(bandForPercentage(85), 'orange');
    assert.equal(bandForPercentage(CTX_ORANGE_MAX), 'orange');
  });

  test('90 / 99 / 100 → red', () => {
    assert.equal(bandForPercentage(CTX_ORANGE_MAX + 1), 'red');
    assert.equal(bandForPercentage(95), 'red');
    assert.equal(bandForPercentage(100), 'red');
  });
});

describe('isWarningCrossing', () => {
  test('green → yellow → orange → red chain', () => {
    assert.equal(isWarningCrossing('green', 'yellow'), false);
    assert.equal(isWarningCrossing('yellow', 'orange'), true);
    assert.equal(isWarningCrossing('orange', 'red'), true);
  });

  test('red → green (post-/compact) does NOT warn', () => {
    assert.equal(isWarningCrossing('red', 'green'), false);
    assert.equal(isWarningCrossing('orange', 'green'), false);
    assert.equal(isWarningCrossing('red', 'yellow'), false);
  });

  test('same band → no warning (avoids stuck-state double-fire)', () => {
    const bands: ContextBand[] = ['unknown', 'green', 'yellow', 'orange', 'red'];
    for (const b of bands) assert.equal(isWarningCrossing(b, b), false);
  });

  test('unknown → green (first tick arrives) does NOT warn', () => {
    assert.equal(isWarningCrossing('unknown', 'green'), false);
    assert.equal(isWarningCrossing('unknown', 'yellow'), false);
  });

  test('unknown → orange / red (first tick already in warning zone) WARNS', () => {
    assert.equal(isWarningCrossing('unknown', 'orange'), true);
    assert.equal(isWarningCrossing('unknown', 'red'), true);
  });

  test('yellow → red (skipped orange, rapid context fill) warns', () => {
    assert.equal(isWarningCrossing('yellow', 'red'), true);
  });
});

describe('bandRank / bandColor — coverage', () => {
  test('rank is monotonic', () => {
    assert.ok(bandRank('unknown') < bandRank('green'));
    assert.ok(bandRank('green') < bandRank('yellow'));
    assert.ok(bandRank('yellow') < bandRank('orange'));
    assert.ok(bandRank('orange') < bandRank('red'));
  });

  test('every band has a distinct non-empty color string', () => {
    const colors = (['unknown', 'green', 'yellow', 'orange', 'red'] as const).map(bandColor);
    for (const c of colors) assert.ok(c.length > 0);
    const set = new Set(colors);
    assert.equal(set.size, colors.length);
  });
});
