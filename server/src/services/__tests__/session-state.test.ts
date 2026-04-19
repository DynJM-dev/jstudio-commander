// Issue 15.3 — canonical SessionState classifier test suite.
//
// Pins the priority ordering (structured signals > pane) plus every
// subtype transition. Each test names the preservation invariant it
// protects (8 P0, 9 P2, 15.1-D, 15.1-H, Phase U.1, Candidates 20/21).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSessionState,
  type SessionStateInputs,
} from '../session-state.service.js';
import { IDLE_JUST_FINISHED_MS, IDLE_POST_COMPACT_MS } from '@commander/shared';

const NOW = 1_700_000_000_000;

const inputs = (overrides: Partial<SessionStateInputs> = {}): SessionStateInputs => ({
  paneStatus: 'idle',
  paneEvidence: 'fallthrough → idle',
  hintedStatus: 'idle',
  hintedEvidence: 'fallthrough → idle',
  nowMs: NOW,
  ...overrides,
});

describe('computeSessionState — priority ordering', () => {
  test('error pane → Error kind (highest priority)', () => {
    const s = computeSessionState(inputs({ paneStatus: 'error', paneEvidence: 'error pattern: FATAL' }));
    assert.equal(s.kind, 'Error');
    if (s.kind === 'Error') assert.match(s.message, /error pattern|FATAL/);
  });

  test('stopped pane → Stopped kind', () => {
    const s = computeSessionState(inputs({ paneStatus: 'stopped', hintedStatus: 'stopped', paneEvidence: 'no tmux session' }));
    assert.equal(s.kind, 'Stopped');
  });

  test('preCompactState=compacting overrides everything else → Compacting', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'working',
      hintedStatus: 'working',
      pendingToolUse: true,
      preCompactState: 'compacting',
    }));
    assert.equal(s.kind, 'Compacting');
  });
});

describe('computeSessionState — WaitingForInput (Candidate 21)', () => {
  test('explicit waitingPromptKind → WaitingForInput with that subtype', () => {
    const s = computeSessionState(inputs({
      waitingPromptKind: 'Approval',
      waitingContext: 'Do you want to proceed?',
    }));
    assert.equal(s.kind, 'WaitingForInput');
    if (s.kind === 'WaitingForInput') {
      assert.equal(s.subtype, 'Approval');
      assert.equal(s.context, 'Do you want to proceed?');
    }
  });

  test('pane says waiting with numbered-choice evidence → NumberedChoice subtype', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'waiting',
      paneEvidence: 'numbered-choice prompt',
    }));
    assert.equal(s.kind, 'WaitingForInput');
    if (s.kind === 'WaitingForInput') assert.equal(s.subtype, 'NumberedChoice');
  });

  test('pane says waiting with (y/n) evidence → YesNo subtype', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'waiting',
      paneEvidence: 'waiting pattern: \\(y\\/n\\)',
    }));
    assert.equal(s.kind, 'WaitingForInput');
    if (s.kind === 'WaitingForInput') assert.equal(s.subtype, 'YesNo');
  });

  test('pane says waiting with trust-folder evidence → TrustFolder subtype', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'waiting',
      paneEvidence: 'waiting pattern: trust this folder',
    }));
    assert.equal(s.kind, 'WaitingForInput');
    if (s.kind === 'WaitingForInput') assert.equal(s.subtype, 'TrustFolder');
  });

  test('pane waiting with unknown evidence → Generic', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'waiting',
      paneEvidence: 'waiting pattern: something-else',
    }));
    assert.equal(s.kind, 'WaitingForInput');
    if (s.kind === 'WaitingForInput') assert.equal(s.subtype, 'Generic');
  });
});

describe('computeSessionState — Working subtypes', () => {
  test('pendingToolUse=true → Working:ToolExec (Issue 15.1-H authoritative)', () => {
    // Even when pane says idle — pending tool_use is authoritative.
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'idle ❯ prompt visible',
      hintedStatus: 'idle',
      pendingToolUse: true,
      pendingToolName: 'Bash',
    }));
    assert.equal(s.kind, 'Working');
    if (s.kind === 'Working') {
      assert.equal(s.subtype, 'ToolExec');
      assert.equal(s.toolName, 'Bash');
    }
  });

  test('working pane with Thinking-class verb → Working:Thinking', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'working',
      paneEvidence: 'active-indicator in tail',
      paneActivity: { verb: 'Ruminating', spinner: '✻', raw: '✻ Ruminating…' },
    }));
    assert.equal(s.kind, 'Working');
    if (s.kind === 'Working') {
      assert.equal(s.subtype, 'Thinking');
      assert.equal(s.hintLabel, 'Ruminating…');
    }
  });

  test('working pane with unknown verb → Working:Generic', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'working',
      paneEvidence: 'active-indicator in tail',
      paneActivity: { verb: 'Whatevering', spinner: '✻', raw: '✻ Whatevering…' },
    }));
    assert.equal(s.kind, 'Working');
    if (s.kind === 'Working') assert.equal(s.subtype, 'Generic');
  });

  test('hintedStatus=working (M1 upgrade) → Working:Generic', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'fallthrough → idle',
      hintedStatus: 'working',
      hintedEvidence: 'activity-hint upgrade',
    }));
    assert.equal(s.kind, 'Working');
    if (s.kind === 'Working') assert.equal(s.subtype, 'Generic');
  });
});

describe('computeSessionState — Idle subtypes (Candidate 20 + 15.4 polish)', () => {
  test('active teammates + idle → Idle:MonitoringSubagents (Candidate 20)', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'idle ❯ prompt visible',
      activeTeammateCount: 3,
      lastStopAt: NOW - 10_000,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') {
      assert.equal(s.subtype, 'MonitoringSubagents');
      assert.equal(s.since, NOW - 10_000);
    }
  });

  test('MonitoringSubagents takes precedence over JustFinished', () => {
    // A PM that just finished a turn with teammates active should
    // surface the monitoring state, not "just finished".
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      activeTeammateCount: 1,
      lastStopAt: NOW - 5_000, // within just-finished window
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'MonitoringSubagents');
  });

  test('recent compact_boundary → Idle:PostCompact', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastCompactBoundaryAt: NOW - 10_000,
      lastStopAt: NOW - 20_000,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'PostCompact');
  });

  test('PostCompact window boundary — just inside = PostCompact', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastCompactBoundaryAt: NOW - (IDLE_POST_COMPACT_MS - 1),
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'PostCompact');
  });

  test('PostCompact window boundary — past threshold = not PostCompact', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastCompactBoundaryAt: NOW - IDLE_POST_COMPACT_MS,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.notEqual(s.subtype, 'PostCompact');
  });

  test('recent Stop + no teammates + no compact → Idle:JustFinished', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastStopAt: NOW - 5_000,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'JustFinished');
  });

  test('JustFinished boundary — just inside', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastStopAt: NOW - (IDLE_JUST_FINISHED_MS - 1),
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'JustFinished');
  });

  test('JustFinished boundary — past threshold', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastStopAt: NOW - IDLE_JUST_FINISHED_MS,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.notEqual(s.subtype, 'JustFinished');
  });

  test('lastStopAt=0 → Idle:AwaitingFirstPrompt (brand-new session)', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastStopAt: 0,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'AwaitingFirstPrompt');
  });

  test('lastStopAt undefined → Idle:AwaitingFirstPrompt', () => {
    const s = computeSessionState(inputs({ paneStatus: 'idle' }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'AwaitingFirstPrompt');
  });

  test('old Stop + no recent events → Idle:Generic', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      lastStopAt: NOW - 600_000, // 10min ago
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'Generic');
  });
});

describe('computeSessionState — preservation invariants (no regression)', () => {
  test('Issue 15.1-D: tick-driven fresh activity on idle ❯ pane + no pending tool → stays Idle', () => {
    // Session ticks bump activity every ~15s; without pendingToolUse
    // this is exactly the 15.1-D P0 shape. Must NOT flip to Working.
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'idle ❯ prompt visible',
      hintedStatus: 'idle', // M1's allowlist didn't upgrade (correct)
      pendingToolUse: false,
    }));
    assert.equal(s.kind, 'Idle');
  });

  test('Issue 15.1-H: pending tool_use beats pane-idle → Working:ToolExec', () => {
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'idle ❯ prompt visible',
      hintedStatus: 'idle',
      pendingToolUse: true,
    }));
    assert.equal(s.kind, 'Working');
    if (s.kind === 'Working') assert.equal(s.subtype, 'ToolExec');
  });

  test('Phase J.1: IDLE_VERBS override on working pane → classifier already flipped to idle', () => {
    // The pane classifier already applied Phase J.1. By the time
    // inputs reach computeSessionState, paneStatus is 'idle' with
    // the override evidence. No second-guessing here.
    const s = computeSessionState(inputs({
      paneStatus: 'idle',
      paneEvidence: 'verb=Idle overrides spinner hoist',
      activeTeammateCount: 2,
    }));
    assert.equal(s.kind, 'Idle');
    if (s.kind === 'Idle') assert.equal(s.subtype, 'MonitoringSubagents');
  });
});
