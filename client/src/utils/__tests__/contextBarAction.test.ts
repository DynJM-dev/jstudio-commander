import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';
import {
  STALE_ACTIVITY_MS,
  isActivityStale,
  shouldSuppressComposingLabel,
  getComposingLabelIfApplicable,
  resolveActionLabel,
} from '../contextBarAction.js';

const asstMsg = (lastBlockType: string, text = ''): ChatMessage => ({
  id: 'm1',
  parentId: null,
  role: 'assistant',
  timestamp: '2026-04-18T23:00:00.000Z',
  content: lastBlockType === 'text'
    ? [{ type: 'text', text: text || 'hello' }]
    : lastBlockType === 'tool_use'
      ? [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }]
      : lastBlockType === 'thinking'
        ? [{ type: 'thinking', text: 'pondering' }]
        : [],
  isSidechain: false,
});

describe('Issue 8.1 Part 2 — isActivityStale', () => {
  test('undefined / 0 → not stale (fresh session, no timestamp yet)', () => {
    assert.equal(isActivityStale(undefined, 1_000_000), false);
    assert.equal(isActivityStale(0, 1_000_000), false);
  });

  test('within STALE_ACTIVITY_MS → not stale', () => {
    const now = 1_000_000_000_000;
    assert.equal(isActivityStale(now - (STALE_ACTIVITY_MS - 1), now), false);
  });

  test('exactly at threshold → not stale (strict >)', () => {
    const now = 1_000_000_000_000;
    assert.equal(isActivityStale(now - STALE_ACTIVITY_MS, now), false);
  });

  test('past threshold → stale', () => {
    const now = 1_000_000_000_000;
    assert.equal(isActivityStale(now - (STALE_ACTIVITY_MS + 1), now), true);
  });

  test('non-finite / negative → not stale (defensive)', () => {
    const now = 1_000_000_000_000;
    assert.equal(isActivityStale(NaN, now), false);
    assert.equal(isActivityStale(-1, now), false);
  });
});

describe('Issue 8.1 Part 2 — shouldSuppressComposingLabel', () => {
  test('non-"Composing response..." label → never suppressed', () => {
    const now = 1_000_000_000_000;
    assert.equal(shouldSuppressComposingLabel('Running command...', now - 999_999, now), false);
    assert.equal(shouldSuppressComposingLabel(null, undefined, now), false);
    assert.equal(shouldSuppressComposingLabel('', undefined, now), false);
  });

  test('"Composing response..." + fresh activity → not suppressed', () => {
    const now = 1_000_000_000_000;
    assert.equal(
      shouldSuppressComposingLabel('Composing response...', now - 5_000, now),
      false,
    );
  });

  test('"Composing response..." + stale activity → suppressed', () => {
    const now = 1_000_000_000_000;
    assert.equal(
      shouldSuppressComposingLabel('Composing response...', now - (STALE_ACTIVITY_MS + 1_000), now),
      true,
    );
  });

  test('"Composing response..." + no timestamp → NOT suppressed', () => {
    // Defensive: a fresh session may not have emitted activity yet.
    // Don't suppress the label just because we have no data.
    assert.equal(shouldSuppressComposingLabel('Composing response...', undefined), false);
  });
});

describe('Issue 8.1 Part 2 — getComposingLabelIfApplicable', () => {
  test('empty messages → null', () => {
    assert.equal(getComposingLabelIfApplicable([]), null);
  });

  test('last assistant block is text → "Composing response..."', () => {
    assert.equal(
      getComposingLabelIfApplicable([asstMsg('text', 'partial reply...')]),
      'Composing response...',
    );
  });

  test('last assistant block is tool_use → null (tool path handles label)', () => {
    assert.equal(getComposingLabelIfApplicable([asstMsg('tool_use')]), null);
  });

  test('last assistant block is thinking → null', () => {
    assert.equal(getComposingLabelIfApplicable([asstMsg('thinking')]), null);
  });

  test('finds most-recent assistant, ignoring trailing user/system messages', () => {
    const asst = asstMsg('text');
    const user: ChatMessage = {
      id: 'u1', parentId: null, role: 'user', timestamp: '',
      content: [{ type: 'text', text: 'next prompt' }], isSidechain: false,
    };
    assert.equal(getComposingLabelIfApplicable([asst, user]), 'Composing response...');
  });
});

// Issue 15.1 Symptom A — compaction label precedence.
describe('resolveActionLabel — compaction precedence', () => {
  test('working + compacting terminal hint → compacting wins over jsonl label', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: 'Compacting context...',
    });
    assert.equal(out, 'Compacting context...');
  });

  test('working + no terminalHint → jsonl label wins', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
    });
    assert.equal(out, 'Composing response...');
  });

  test('working + other terminal hint (non-compacting) → jsonl label wins', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: 'Exploring codebase...',
    });
    assert.equal(out, 'Composing response...');
  });

  test('working + no jsonl label + terminalHint (non-compacting) → terminalHint fallback', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: null,
      terminalHint: 'Running subagent...',
    });
    assert.equal(out, 'Running subagent...');
  });

  test('not working → terminalHint suppressed even if present', () => {
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: null,
      terminalHint: 'Compacting context...',
    });
    assert.equal(out, null);
  });

  test('not working + jsonl label → label still returned (jsonl path is status-independent by design)', () => {
    // ContextBar derives jsonlLabel only when isWorking; passing a label
    // here means the caller explicitly chose to surface it. Preserve
    // that by returning it — the helper doesn't second-guess its input.
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
    });
    assert.equal(out, 'Composing response...');
  });

  test('all null/false → null', () => {
    const out = resolveActionLabel({ isWorking: false, jsonlLabel: null, terminalHint: null });
    assert.equal(out, null);
  });
});

// Issue 15.3 — typed SessionState path. When the server emits a
// canonical `state`, resolveActionLabel reads it directly; missing
// state falls through to the legacy jsonl + terminal-hint path.
describe('resolveActionLabel — Issue 15.3 typed SessionState path', () => {
  test('Compacting state → "Compacting context..." (overrides any jsonl label)', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
      sessionState: { kind: 'Compacting' },
    });
    assert.equal(out, 'Compacting context...');
  });

  test('WaitingForInput:Approval → "Waiting for approval"', () => {
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'WaitingForInput', subtype: 'Approval' },
    });
    assert.equal(out, 'Waiting for approval');
  });

  test('WaitingForInput:NumberedChoice → "Choose an option"', () => {
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'WaitingForInput', subtype: 'NumberedChoice' },
    });
    assert.equal(out, 'Choose an option');
  });

  test('Working:ToolExec with jsonlLabel → jsonlLabel wins (§6.1 inversion)', () => {
    // User-observable behavior: when the client's getActionInfo has
    // derived a specific label like "Reading STATE.md…" from the
    // ChatMessage tail, the ContextBar must display that rich label
    // — NOT the generic "Running Bash…" from the typed state.
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Reading STATE.md…',
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'ToolExec', toolName: 'Bash' },
    });
    assert.equal(out, 'Reading STATE.md…');
  });

  test('Working:ToolExec with toolName, no jsonlLabel → "Running <tool>…"', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'ToolExec', toolName: 'Bash' },
    });
    assert.equal(out, 'Running Bash…');
  });

  test('Working:ToolExec without toolName or jsonlLabel → "Running tool…"', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'ToolExec' },
    });
    assert.equal(out, 'Running tool…');
  });

  test('Working:Thinking with jsonlLabel → jsonlLabel wins (§6.1 inversion)', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Pondering…',
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'Thinking', hintLabel: 'Thinking…' },
    });
    assert.equal(out, 'Pondering…');
  });

  test('Working:Thinking with hintLabel, no jsonlLabel → hintLabel value', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'Thinking', hintLabel: 'Ruminating…' },
    });
    assert.equal(out, 'Ruminating…');
  });

  test('Working:Generic falls through to legacy path', () => {
    // Generic means "we know it is working but have no narrower
    // subtype" — the client should use jsonlLabel or terminalHint
    // for more specificity.
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
      sessionState: { kind: 'Working', subtype: 'Generic' },
    });
    assert.equal(out, 'Composing response...');
  });

  test('Idle state → null (LiveActivityRow unmounts)', () => {
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: 'Composing response...',  // stale — should not show
      terminalHint: null,
      sessionState: { kind: 'Idle', subtype: 'Generic' },
    });
    assert.equal(out, null);
  });

  test('Idle:MonitoringSubagents → null (ContextBar doesn\'t render this subtype)', () => {
    // ContextBar's actionLabel stays null for idle states; the
    // status-bar component (not this path) is what renders the
    // "Monitoring N teammates" line.
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'Idle', subtype: 'MonitoringSubagents' },
    });
    assert.equal(out, null);
  });

  test('Stopped → null', () => {
    const out = resolveActionLabel({
      isWorking: false,
      jsonlLabel: null,
      terminalHint: null,
      sessionState: { kind: 'Stopped', reason: 'UserInitiated' },
    });
    assert.equal(out, null);
  });

  test('sessionState absent → legacy path (backward compat preserved)', () => {
    // Client just opened a chat and no WS event has landed yet.
    // resolveActionLabel MUST fall back to the legacy derivation
    // (this test is the whole point of dual-emit migration).
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
      sessionState: null,
    });
    assert.equal(out, 'Composing response...');
  });

  test('sessionState undefined → legacy path', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: null,
    });
    assert.equal(out, 'Composing response...');
  });

  test('Compacting takes precedence over terminalHint + jsonl', () => {
    const out = resolveActionLabel({
      isWorking: true,
      jsonlLabel: 'Composing response...',
      terminalHint: 'Compacting context...',
      sessionState: { kind: 'Compacting' },
    });
    assert.equal(out, 'Compacting context...');
  });
});
