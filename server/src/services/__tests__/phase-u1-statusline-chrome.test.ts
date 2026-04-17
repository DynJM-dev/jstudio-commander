import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyStatusFromPane, STATUSLINE_CHROME_MARKERS } from '../agent-status.service.js';

// Phase U.1 Fix 2 — Commander's own statusline chrome false-positive regression.
// Captured from live OvaGas coder pane (%59) that was oscillating idle↔working
// every 5s because "ctx 33% │ 5h 46% │ 7d 35%" matched /\d+%/ in ACTIVE_INDICATORS
// three times per poll cycle. Fix: skip chrome lines before running active check.

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/services/__tests__/ → repo root is ../../../..
const fixturePath = resolve(__dirname, '../../../..', 'audits/PHASE_U1_PANE_59_CAPTURE.txt');

test('captured idle pane with Commander statusline chrome → classifier returns idle', () => {
  const pane = readFileSync(fixturePath, 'utf8');
  const result = classifyStatusFromPane(pane);
  // Before the fix, evidence was "active-indicator in tail" + status "working".
  // After the fix, chrome is skipped, so the tail has no active indicators
  // → falls through to the ❯ idle-prompt branch or IDLE pattern fallthrough.
  assert.notEqual(result.status, 'working', `classifier must not flag idle pane as working; evidence=${result.evidence}`);
});

test('STATUSLINE_CHROME_MARKERS matches the known chrome shapes', () => {
  const samples = [
    '  Opus 4.7 │ ctx 33% │ 5h 46% │ 7d 35% │ $26.54',
    '  ⏵⏵ bypass permissions on · 1 shell',
    '  ⏵⏵ accept edits on (shift+tab to cycle)',
    '  Opus 4.7 │ ctx 99% │ 5h 87% │ 7d 39% │ $204.05',
  ];
  for (const line of samples) {
    const match = STATUSLINE_CHROME_MARKERS.some((re) => re.test(line));
    assert.equal(match, true, `chrome line should match: ${line}`);
  }
});

test('STATUSLINE_CHROME_MARKERS does NOT match real active-indicator lines', () => {
  const realActive = [
    'Running 3 tests...',
    'Reading 123 lines from src/main.ts',
    'Writing src/foo.ts',
    'Editing 5 files',
    'Thinking deeply...',
    '47% complete',  // NOT chrome (standalone %, not in ctx/5h pattern)
    'Step 3/10',
    '35 tool uses · 108.4k tokens',
  ];
  for (const line of realActive) {
    const match = STATUSLINE_CHROME_MARKERS.some((re) => re.test(line));
    assert.equal(match, false, `real active-indicator must not be skipped: ${line}`);
  }
});
