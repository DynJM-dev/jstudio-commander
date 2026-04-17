import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectActivity, classifyStatusFromPane, parseElapsedSeconds } from '../agent-status.service.js';

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

describe('classifyStatusFromPane — Phase J.1 IDLE_VERBS override', () => {
  test('✻ Idle in tail → idle, NOT working (spinner-glyph hoist suppressed)', () => {
    const pane = [
      '⏺ Standing by — coder mid-task.',
      '✻ Idle · teammates running',
      '⏵⏵ bypass permissions on · 1 teammate',
    ].join('\n');
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /verb=Idle overrides spinner hoist/);
  });

  test('✻ Waiting verb → idle (PM monitoring teammates, not user input)', () => {
    const pane = '✻ Waiting · 2 teammates working';
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /verb=Waiting/);
  });

  test('✻ Ruminating still classifies as working (regression guard)', () => {
    const pane = '✻ Ruminating… (1m 49s · ↓ 430 tokens · thinking with xhigh effort)';
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'working');
    assert.equal(result.evidence, 'active-indicator in tail');
  });

  test('numbered-choice prompt outranks IDLE_VERBS (waiting wins)', () => {
    // A pane with both `✻ Idle` chrome and a numbered-choice prompt
    // should still classify as waiting — numbered-choice runs above the
    // active-indicator branch and is the strongest signal.
    const pane = [
      '✻ Idle · paused',
      '❯ 1. Yes',
      '  2. No',
      '  3. Cancel',
    ].join('\n');
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'waiting');
    assert.equal(result.evidence, 'numbered-choice prompt');
  });
});

// ============================================================================
// Phase L — past-tense completion verbs + stale-elapsed gate + multi-line
// footer elapsed extraction.
// ============================================================================

describe('parseElapsedSeconds — Phase L', () => {
  test('pure seconds', () => {
    assert.equal(parseElapsedSeconds('21261s'), 21261);
    assert.equal(parseElapsedSeconds('30s'), 30);
  });
  test('pure minutes', () => {
    assert.equal(parseElapsedSeconds('5m'), 300);
  });
  test('minutes + seconds', () => {
    assert.equal(parseElapsedSeconds('2m 30s'), 150);
    assert.equal(parseElapsedSeconds('1m 49s'), 109);
  });
  test('null / undefined / garbage → null', () => {
    assert.equal(parseElapsedSeconds(undefined), null);
    assert.equal(parseElapsedSeconds(null), null);
    assert.equal(parseElapsedSeconds('abc'), null);
  });
});

describe('classifyStatusFromPane — Phase L past-tense + stale-elapsed', () => {
  test('✻ Cooked alone → idle (past-tense verb)', () => {
    const result = classifyStatusFromPane('✻ Cooked');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /past-tense verb=Cooked/);
  });

  test('✻ Crunched alone → idle', () => {
    const result = classifyStatusFromPane('✻ Crunched');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /past-tense verb=Crunched/);
  });

  test('✻ Finished alone → idle', () => {
    const result = classifyStatusFromPane('✻ Finished');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /past-tense verb=Finished/);
  });

  test('✻ Brewing (present-tense) → working (regression guard)', () => {
    const result = classifyStatusFromPane('✻ Brewing');
    assert.equal(result.status, 'working');
    assert.equal(result.evidence, 'active-indicator in tail');
  });

  test('✻ Ruminating (30s) → working (live turn)', () => {
    const result = classifyStatusFromPane('✻ Ruminating… (30s · ↓ 120 tokens)');
    assert.equal(result.status, 'working');
    assert.equal(result.evidence, 'active-indicator in tail');
  });

  test('✻ Ruminating (620s) → idle (stale-elapsed override)', () => {
    const result = classifyStatusFromPane('✻ Ruminating… (620s · ↓ 120 tokens)');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /stale elapsed 620s/);
  });

  test('multi-line footer: ✻ Cooked / · / 21261s → idle (both gates fire, past-tense wins first)', () => {
    const pane = [
      'Claude',
      'Thinking deeply...',
      'Composing response...',
      '·',
      '✻ Cooked',
      '·',
      '21261s',
      'Step 1/1',
    ].join('\n');
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'idle');
    // Past-tense verb fires before stale-elapsed, so evidence reads "past-tense verb=Cooked".
    assert.match(result.evidence, /past-tense verb=Cooked/);
  });

  test('future past-tense verb (Schlepped) caught by /ed$/ fallback', () => {
    const result = classifyStatusFromPane('✻ Schlepped');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /past-tense verb=Schlepped/);
  });
});

describe('detectActivity — Phase L multi-line elapsed', () => {
  test('verb with no paren, elapsed on a line two rows below → extracted', () => {
    const pane = [
      '✻ Cooked',
      '·',
      '21261s',
      'Step 1/1',
    ].join('\n');
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.verb, 'Cooked');
    assert.equal(activity!.elapsed, '21261s');
  });

  test('verb with no paren, no elapsed below → elapsed stays undefined', () => {
    const pane = '✻ Cooked';
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.verb, 'Cooked');
    assert.equal(activity!.elapsed, undefined);
  });

  test('multi-line scan stops at ❯ prompt — does not slurp a later frame', () => {
    // The `30s` below belongs to a later frame we should NOT harvest.
    const pane = [
      '✻ Cooked',
      '❯ user typed something',
      '30s',
    ].join('\n');
    const activity = detectActivity(pane);
    assert.ok(activity);
    assert.equal(activity!.elapsed, undefined);
  });
});
