import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectActivity } from '../agent-status.service.js';

describe('detectActivity — Phase J pane-footer parser', () => {
  test('full line → spinner + verb + elapsed + tokens + effort', () => {
    const pane = [
      'some prior output',
      '',
      '✽ Ruminating… (1m 49s · ↓ 430 tokens · thinking with xhigh effort)',
      '> ',
    ].join('\n');
    const activity = detectActivity(pane);
    assert.ok(activity, 'expected a parsed activity');
    assert.equal(activity!.spinner, '✽');
    assert.equal(activity!.verb, 'Ruminating');
    assert.equal(activity!.elapsed, '1m 49s');
    assert.equal(activity!.tokens, 430);
    assert.equal(activity!.effort, 'xhigh');
    assert.match(activity!.raw, /Ruminating/);
  });

  test('verb only, no parenthetical → still parsed', () => {
    const pane = '✻ Doodling…';
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.verb, 'Doodling');
    assert.equal(activity!.elapsed, undefined);
    assert.equal(activity!.tokens, undefined);
  });

  test('tokens without the ↓ glyph parse too', () => {
    const pane = '⏺ Cogitating (3s · 1,234 tokens)';
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.tokens, 1234);
    assert.equal(activity!.elapsed, '3s');
  });

  test('no spinner glyph anywhere → null', () => {
    const pane = 'Claude is loading...\nStandby.';
    assert.equal(detectActivity(pane), null);
  });

  test('empty input → null without throwing', () => {
    assert.equal(detectActivity(''), null);
  });

  test('picks the MOST RECENT spinner line when two are visible', () => {
    // Claude sometimes stacks a prior frame above the current one within
    // the capture window. Older frame ("Composing") must lose to the
    // newer frame ("Ruminating") on the line below it.
    const pane = [
      '✶ Composing… (2s)',
      '✽ Ruminating… (5s · 12 tokens · thinking with high effort)',
    ].join('\n');
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.verb, 'Ruminating');
    assert.equal(activity!.tokens, 12);
    assert.equal(activity!.effort, 'high');
  });

  test('malformed tokens string → tokens undefined, other fields intact', () => {
    const pane = '✻ Brewing (4s · ↓ abc tokens)';
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.verb, 'Brewing');
    assert.equal(activity!.elapsed, '4s');
    assert.equal(activity!.tokens, undefined);
  });
});
