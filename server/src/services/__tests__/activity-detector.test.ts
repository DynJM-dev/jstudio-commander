import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectActivity, classifyStatusFromPane } from '../agent-status.service.js';

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
