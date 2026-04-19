import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';
import {
  STALE_ACTIVITY_MS,
  isActivityStale,
  shouldSuppressComposingLabel,
  getComposingLabelIfApplicable,
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
