import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { WSEvent } from '@commander/shared';

// M7 MVP — WS event payload shape + filter logic for `useProjectStateMd`.
// Pure predicate tests pinning the dispatch contract: the hook only
// reacts to `project:state-md-updated` events matching the current
// sessionId, and ignores everything else (subscription firewall).

// Mirror of the filter the hook applies internally. Extracted for
// unit testing since the full hook requires React + WS context.
const shouldApplyEvent = (
  event: WSEvent | null,
  sessionId: string | undefined,
): boolean => {
  if (!sessionId) return false;
  if (!event) return false;
  if (event.type !== 'project:state-md-updated') return false;
  if (event.sessionId !== sessionId) return false;
  return true;
};

describe('M7 MVP — project:state-md-updated event shape contract', () => {
  test('event carries { type, sessionId, projectPath, content } with content string', () => {
    const event: WSEvent = {
      type: 'project:state-md-updated',
      sessionId: 'sess-abc',
      projectPath: '/Users/j/proj',
      content: '# STATE\n\ncurrent phase: M7',
    };
    assert.equal(event.type, 'project:state-md-updated');
    assert.equal(event.sessionId, 'sess-abc');
    assert.equal(event.projectPath, '/Users/j/proj');
    assert.equal(event.content, '# STATE\n\ncurrent phase: M7');
  });

  test('content may be null (file removed / unreadable) — not a string "null"', () => {
    const event: WSEvent = {
      type: 'project:state-md-updated',
      sessionId: 'sess-abc',
      projectPath: '/Users/j/proj',
      content: null,
    };
    assert.equal(event.content, null);
  });
});

describe('M7 MVP — useProjectStateMd filter (subscription firewall)', () => {
  test('matching sessionId + event type → true (apply)', () => {
    const event: WSEvent = {
      type: 'project:state-md-updated',
      sessionId: 'sess-A',
      projectPath: '/p',
      content: 'body',
    };
    assert.equal(shouldApplyEvent(event, 'sess-A'), true);
  });

  test('different sessionId on the same event type → false (split-view isolation)', () => {
    // Pane A and pane B share the same WSProvider; pane A's hook must
    // ignore pane B's events. This is the split-view-independence
    // guarantee from dispatch acceptance test 3.
    const event: WSEvent = {
      type: 'project:state-md-updated',
      sessionId: 'sess-B',
      projectPath: '/p',
      content: 'body',
    };
    assert.equal(shouldApplyEvent(event, 'sess-A'), false);
  });

  test('chat:message event on matching sessionId → false (firewall against chat channel)', () => {
    // Subscription firewall: even if a chat event carries the same
    // sessionId, the STATE.md hook must ignore it — it filters on
    // event.type FIRST.
    const chatEvent: WSEvent = {
      type: 'chat:message',
      sessionId: 'sess-A',
      message: {
        id: 'm1', parentId: null, role: 'assistant',
        timestamp: '2026-04-20T00:00:00.000Z',
        content: [{ type: 'text', text: 'hi' }],
        isSidechain: false,
      },
    };
    assert.equal(shouldApplyEvent(chatEvent, 'sess-A'), false);
  });

  test('session:status event → false (firewall against session status churn)', () => {
    // 15.3-thread status events must not trigger STATE.md re-render.
    const statusEvent: WSEvent = {
      type: 'session:status',
      sessionId: 'sess-A',
      status: 'working',
    };
    assert.equal(shouldApplyEvent(statusEvent, 'sess-A'), false);
  });

  test('null event → false (defensive)', () => {
    assert.equal(shouldApplyEvent(null, 'sess-A'), false);
  });

  test('undefined sessionId → false (hook unmounted / not-yet-loaded)', () => {
    const event: WSEvent = {
      type: 'project:state-md-updated',
      sessionId: 'sess-A',
      projectPath: '/p',
      content: 'body',
    };
    assert.equal(shouldApplyEvent(event, undefined), false);
  });
});

describe('M7 MVP — per-session channel naming contract', () => {
  test('channel follows `project-state:<sessionId>` convention', () => {
    // Matches the server-side rooms.broadcast target and the client
    // hook's subscribe() call. Independent from `chat:<sessionId>`
    // (subscription firewall per dispatch).
    const sessionId = 'sess-xyz-123';
    const channel = `project-state:${sessionId}`;
    assert.equal(channel, 'project-state:sess-xyz-123');
    assert.notEqual(channel, `chat:${sessionId}`);
    assert.notEqual(channel, 'sessions');
    assert.notEqual(channel, 'projects');
  });
});
