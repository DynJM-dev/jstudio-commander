import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectActivity,
  classifyStatusFromPane,
  parseElapsedSeconds,
  applyActivityHints,
  IDLE_UPGRADE_MS,
} from '../agent-status.service.js';

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

  // Issue 8 Part 3 — Claude Code v2.x uses `⏺` as the REPLY-BULLET glyph
  // (prefix of every assistant response line). It is NOT a live-spinner
  // glyph. Treating it as one caused the classifier to extract the
  // first word of Claude's reply as the "verb" — "Opus", "Model",
  // "Processing", whatever Claude said first — and lock the session
  // into a stuck `working` state until the reply scrolled out of the
  // tail scan (or never, if the session was quiet).
  //
  // Fix: remove `⏺` from SPINNER_CHARS so hasActiveInTail no longer
  // treats it as spinner evidence, AND tighten detectActivity to
  // require the verb to look active (`-ing` / `-ed` suffix) so a
  // reply like `⏺ Opus 4.7 (claude-opus-4-7)` never produces a
  // verb regardless of glyph.
  test('Issue 8 P3 — Claude reply-bullet line does NOT classify session as working', () => {
    // Exact repro of Jose's stuck state. Claude's reply-bullet line
    // plus Commander statusline chrome, no idle-❯ in the tail 8 lines.
    // Pre-fix this returned working with verb="Opus".
    const pane = [
      '❯ what model are you using and your effort level?',
      '',
      '⏺ Opus 4.7 (claude-opus-4-7), effort level: medium.',
      '',
      'Opus 4.7 │ ctx 15% │ 5h 10% │ 7d 59% │ $0.09',
    ].join('\n');
    const result = classifyStatusFromPane(pane);
    assert.equal(result.status, 'idle', `expected idle, got ${result.status} (${result.evidence})`);
  });

  test('Issue 8 P3 — reply-bullet line with "Model" first word produces no active-verb activity', () => {
    const pane = '⏺ Model: Claude Opus 4.7';
    const activity = detectActivity(pane);
    // Either null, OR a non-active verb that downstream classifier
    // will treat as not-working. The key invariant: no false verb
    // leaks into the UI chip.
    if (activity) {
      assert.ok(
        /ing$|ed$/.test(activity.verb),
        `expected -ing/-ed verb filter, got verb=${activity.verb}`,
      );
    }
  });

  test('Issue 8 P3 — reply starting with non-verb word → no activity', () => {
    const pane = '⏺ The answer is yes.';
    const activity = detectActivity(pane);
    assert.equal(activity, null, 'junk reply words must not produce activity');
  });

  test('Issue 8 P3 — genuine live thinking still detected (regression guard)', () => {
    // The fix must NOT break real active-state detection.
    const a1 = detectActivity('⏺ Cogitating (3s · 1,234 tokens)');
    assert.ok(a1, 'Cogitating with meta must still parse');
    assert.equal(a1!.verb, 'Cogitating');

    const a2 = detectActivity('✻ Ruminating… (1m 49s · ↓ 430 tokens · thinking with xhigh effort)');
    assert.ok(a2);
    assert.equal(a2!.verb, 'Ruminating');

    const a3 = detectActivity('✻ Cooked');
    assert.ok(a3, 'Cooked completion verb must still parse');
    assert.equal(a3!.verb, 'Cooked');
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

  // Issue 15 — inverted invariant. Phase L's stale-elapsed guard
  // originally fired on ANY elapsed > 10min, assuming the footer was
  // frozen. Reality: Claude Code's long reasoning/verification runs
  // legitimately go 10–30min with a live `-ing` verb + cycling
  // spinner. The guard was giving a false-idle on Jose's 10+-min
  // Gesticulating during a verification summary.
  //
  // Fix: stale-elapsed only fires when the verb is a completion
  // (past-tense) verb that slipped past COMPLETION_VERBS allowlist —
  // belt-and-suspenders for frozen footers, NOT a hammer on live
  // `-ing` turns.
  test('Issue 15 — ✻ Ruminating (620s) → working (live long-generation, NOT stale)', () => {
    const result = classifyStatusFromPane('✻ Ruminating… (620s · ↓ 120 tokens)');
    assert.equal(result.status, 'working', `expected live working, got ${result.status} (${result.evidence})`);
  });

  test('Issue 15 — ✻ Gesticulating (12m 45s) → working (Jose\'s repro shape)', () => {
    const result = classifyStatusFromPane('✻ Gesticulating… (12m 45s · ↓ 890 tokens)');
    assert.equal(result.status, 'working');
  });

  test('Issue 15 — future unknown `-ed` verb past threshold still goes idle (Phase L guard retained)', () => {
    // Phase L's original concern: a future Claude verb slips past the
    // COMPLETION_VERBS allowlist but still has `-ed` morphology + huge
    // elapsed = frozen footer. The completion-verb check at line 390
    // catches it via the `/ed$/` fallback in isCompletionVerb, BEFORE
    // the stale-elapsed check ever runs. Leaving this test pinned so
    // the `-ed` path stays honest.
    const result = classifyStatusFromPane('✻ Schlepped (21261s)');
    assert.equal(result.status, 'idle');
    assert.match(result.evidence, /past-tense verb=Schlepped/);
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

// Issue 15 M1 — additive structured-signal upgrade over pane
// classification. Proof-of-life timestamp (watcher-bridge JSONL append
// + hook feed) upgrades an ambiguous `idle` pane read to `working`.
describe('applyActivityHints — Issue 15 M1 structured-signal upgrade', () => {
  const NOW = 1_700_000_000_000;

  test('idle + fresh activity (<15s) → upgrade to working', () => {
    const pane = classifyStatusFromPane('some tool output scrolling\nno spinner verb');
    assert.equal(pane.status, 'idle');
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 5_000, nowMs: NOW });
    assert.equal(result.status, 'working');
    assert.match(result.evidence, /activity-hint upgrade/);
    assert.match(result.evidence, /5s since jsonl/);
  });

  test('idle + stale activity (>=15s) → stays idle', () => {
    const pane = classifyStatusFromPane('some tool output scrolling\nno spinner verb');
    const result = applyActivityHints(pane, {
      lastActivityAt: NOW - IDLE_UPGRADE_MS,
      nowMs: NOW,
    });
    assert.equal(result.status, 'idle');
    assert.equal(result.evidence, pane.evidence);
  });

  test('idle + no hint → passthrough', () => {
    const pane = classifyStatusFromPane('scrollback without any signal');
    const result = applyActivityHints(pane);
    assert.deepEqual(result, pane);
  });

  test('idle + lastActivityAt=0 (never bumped) → passthrough', () => {
    const pane = classifyStatusFromPane('scrollback without any signal');
    const result = applyActivityHints(pane, { lastActivityAt: 0, nowMs: NOW });
    assert.deepEqual(result, pane);
  });

  test('working + fresh activity → untouched', () => {
    const pane = classifyStatusFromPane('✻ Brewing… (3s)');
    assert.equal(pane.status, 'working');
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 1_000, nowMs: NOW });
    assert.equal(result.status, 'working');
    assert.equal(result.evidence, pane.evidence);
  });

  test('waiting + fresh activity → untouched (never downgrade urgency)', () => {
    // Synthetic: force a waiting result via the numbered-choice branch.
    const pane = classifyStatusFromPane('❯ 1. Yes\n  2. No');
    assert.equal(pane.status, 'waiting');
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 1_000, nowMs: NOW });
    assert.equal(result.status, 'waiting');
  });

  test('IDLE_VERBS override ("✻ Idle · teammates running") + fresh activity → stays idle', () => {
    // PM panes show `✻ Idle` while teammates work. The PM's own
    // last_activity_at would not bump from teammate work, but be
    // defensive: explicit-idle evidence must not upgrade even if the
    // caller hands a fresh timestamp in error.
    const pane = classifyStatusFromPane('✻ Idle · 2 teammates running');
    assert.equal(pane.status, 'idle');
    assert.match(pane.evidence, /overrides spinner hoist/);
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 1_000, nowMs: NOW });
    assert.equal(result.status, 'idle');
  });

  test('past-tense verb ("✻ Cooked") + fresh activity → stays idle', () => {
    // After a Stop hook the pane may briefly read `✻ Cooked` with
    // last_activity_at fresh from the Stop bump. Poller's 60s hook-
    // yield is the primary defense; this evidence-exclusion is the
    // belt-and-suspenders guard.
    const pane = classifyStatusFromPane('✻ Cooked');
    assert.equal(pane.status, 'idle');
    assert.match(pane.evidence, /past-tense verb=/);
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 1_000, nowMs: NOW });
    assert.equal(result.status, 'idle');
  });

  test('idle fallthrough (no spinner, no ❯) + fresh activity → upgrade', () => {
    // The canonical Issue 15 M1 shape: tool UI without a verb footer.
    const pane = classifyStatusFromPane([
      '⏺ Bash(ls -la)',
      '  └─ drwxr-xr-x  12 jose  staff   384 Apr 19 04:01 .',
      '  └─ -rw-r--r--   1 jose  staff  1234 Apr 19 04:00 README.md',
    ].join('\n'));
    assert.equal(pane.status, 'idle');
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 2_000, nowMs: NOW });
    assert.equal(result.status, 'working');
    assert.match(result.evidence, /activity-hint upgrade/);
  });

  test('idle ❯ prompt + fresh activity → upgrade (user typing branch)', () => {
    // A `❯ ` prompt means the user has finished a turn. If activity is
    // fresh within 15s, the Stop-hook must have just fired — and the
    // poller's hook-yield would have pre-gated. In prod this combo is
    // unreachable; in isolation the helper still upgrades because the
    // `idle ❯ prompt visible` evidence is not on the exclusion list.
    // Documenting the semantics keeps future edits honest.
    const pane = classifyStatusFromPane('❯ \n');
    assert.equal(pane.status, 'idle');
    assert.match(pane.evidence, /idle ❯/);
    const result = applyActivityHints(pane, { lastActivityAt: NOW - 1_000, nowMs: NOW });
    assert.equal(result.status, 'working');
  });
});
