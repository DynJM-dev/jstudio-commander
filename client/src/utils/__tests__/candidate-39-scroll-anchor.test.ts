import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Candidate 39 — rapid-fire scroll-anchor. User-sent override at
// ChatThread.tsx auto-scroll gate: own submits ALWAYS scroll to
// bottom, regardless of prior scroll position. Incoming assistant /
// system messages still respect the isAtBottom gate (scroll-up
// reading mode stays intact).
//
// These tests pin the predicate behind the gate. React wiring is
// smoke-verified by Jose's acceptance gate (Case 2: send 3 messages
// rapidly → all three visible with breathing room above footer).

type MessageRole = 'user' | 'assistant' | 'system';

const shouldForceScrollToBottom = (args: {
  messagesGrew: boolean;
  newestRole: MessageRole | undefined;
  isAtBottom: boolean;
}): boolean => {
  if (!args.messagesGrew) return false;
  const isOwnSubmit = args.newestRole === 'user';
  return args.isAtBottom || isOwnSubmit;
};

const shouldShowNewMessagesBadge = (args: {
  messagesGrew: boolean;
  newestRole: MessageRole | undefined;
  isAtBottom: boolean;
}): boolean => {
  if (!args.messagesGrew) return false;
  const isOwnSubmit = args.newestRole === 'user';
  // Own submits never raise the badge — we force-scroll instead.
  if (isOwnSubmit) return false;
  // Incoming messages while user is scrolled up → badge.
  return !args.isAtBottom;
};

describe('Candidate 39 — rapid-fire user submit always scrolls to bottom', () => {
  test('user submit while scrolled up → force-scroll (the bug fix)', () => {
    // Canonical bug shape: Jose scrolls up to re-read a prior exchange,
    // then types a rapid-fire follow-up. Pre-fix: message lands
    // invisibly behind current viewport + "new messages" badge.
    // Post-fix: viewport jumps to bottom to show the new submit.
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: true,
        newestRole: 'user',
        isAtBottom: false,
      }),
      true,
    );
  });

  test('user submit already at bottom → scroll (non-regression)', () => {
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: true,
        newestRole: 'user',
        isAtBottom: true,
      }),
      true,
    );
  });

  test('rapid three-submit burst → all three trigger force-scroll', () => {
    // Simulates Jose's Case 2: send 3 messages rapidly. Each submit
    // is an independent messages.length increment; each must scroll.
    for (let i = 0; i < 3; i++) {
      assert.equal(
        shouldForceScrollToBottom({
          messagesGrew: true,
          newestRole: 'user',
          isAtBottom: i === 0 ? false : true, // first submit from scroll-up, subsequent already at bottom
        }),
        true,
        `burst submit ${i + 1} should force-scroll`,
      );
    }
  });
});

describe('Candidate 39 — incoming messages still respect isAtBottom gate', () => {
  test('assistant message while scrolled up → NO force-scroll (reading mode preserved)', () => {
    // Non-regression: user reading earlier history shouldn't get
    // yanked to the bottom just because Claude replied. That's what
    // the "new messages" badge is for.
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: true,
        newestRole: 'assistant',
        isAtBottom: false,
      }),
      false,
    );
  });

  test('assistant message at bottom → scroll (original auto-follow)', () => {
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: true,
        newestRole: 'assistant',
        isAtBottom: true,
      }),
      true,
    );
  });

  test('system message (tool_result echo) while scrolled up → NO force-scroll', () => {
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: true,
        newestRole: 'system',
        isAtBottom: false,
      }),
      false,
    );
  });

  test('messages did not grow → no scroll action regardless of state', () => {
    assert.equal(
      shouldForceScrollToBottom({
        messagesGrew: false,
        newestRole: 'user',
        isAtBottom: false,
      }),
      false,
    );
  });
});

describe('Candidate 39 — "new messages" badge suppression on own submit', () => {
  test('own submit from scroll-up → badge SUPPRESSED (force-scroll instead)', () => {
    // Badge and force-scroll are mutually exclusive for own submits.
    // Pre-fix: badge raised (wrong). Post-fix: scroll happens and
    // the badge stays down because the new row is now visible.
    assert.equal(
      shouldShowNewMessagesBadge({
        messagesGrew: true,
        newestRole: 'user',
        isAtBottom: false,
      }),
      false,
    );
  });

  test('assistant message from scroll-up → badge RAISED (non-regression)', () => {
    assert.equal(
      shouldShowNewMessagesBadge({
        messagesGrew: true,
        newestRole: 'assistant',
        isAtBottom: false,
      }),
      true,
    );
  });

  test('any new message at bottom → no badge (already visible)', () => {
    assert.equal(
      shouldShowNewMessagesBadge({
        messagesGrew: true,
        newestRole: 'assistant',
        isAtBottom: true,
      }),
      false,
    );
    assert.equal(
      shouldShowNewMessagesBadge({
        messagesGrew: true,
        newestRole: 'user',
        isAtBottom: true,
      }),
      false,
    );
  });
});
