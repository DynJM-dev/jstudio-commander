import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isActiveInDifferentPane } from '../paneFocus.js';

// Candidate 19 — split-view cross-pane interrupt guard. Pure predicate
// mock-tested so the contract is pinned without needing JSDOM. Runtime
// usage (ChatPage.tsx ESC handler) passes `document.activeElement` as
// the first arg; these tests substitute a minimal mock satisfying the
// structural interface.

// Minimal mock element factory. `ownerPaneId` sets the closest
// matching `[data-pane-session-id]` ancestor's attribute; null means
// no pane ancestor exists.
const mockElement = (ownerPaneId: string | null) => ({
  closest: (selector: string) => {
    if (selector !== '[data-pane-session-id]') return null;
    if (ownerPaneId === null) return null;
    return {
      getAttribute: (name: string): string | null =>
        name === 'data-pane-session-id' ? ownerPaneId : null,
    };
  },
});

describe('Candidate 19 — isActiveInDifferentPane', () => {
  test('focus in the same pane → returns false (handler proceeds)', () => {
    const active = mockElement('sess-A');
    assert.equal(isActiveInDifferentPane(active, 'sess-A'), false);
  });

  test('focus in a DIFFERENT pane → returns true (handler skips — cross-pane guard)', () => {
    const active = mockElement('sess-B');
    assert.equal(isActiveInDifferentPane(active, 'sess-A'), true);
  });

  test('focus outside any pane (no ancestor with data-pane-session-id) → returns false (falls through, pre-fix behavior)', () => {
    const active = mockElement(null);
    assert.equal(isActiveInDifferentPane(active, 'sess-A'), false);
  });

  test('no active element (null) → returns false (defensive)', () => {
    assert.equal(isActiveInDifferentPane(null, 'sess-A'), false);
  });

  test('undefined active element → returns false', () => {
    assert.equal(isActiveInDifferentPane(undefined, 'sess-A'), false);
  });

  test('caller has no sessionId → returns false (fresh-session path, nothing to disambiguate)', () => {
    const active = mockElement('sess-B');
    assert.equal(isActiveInDifferentPane(active, undefined), false);
  });

  test('closest returns an element without getAttribute (malformed) → returns false', () => {
    const malformed = {
      closest: (selector: string) => selector === '[data-pane-session-id]' ? {} : null,
    };
    assert.equal(isActiveInDifferentPane(malformed, 'sess-A'), false);
  });

  test('regression: ESC handler cross-pane class — two panes A and B, focus in A, handler bound to B skips', () => {
    // Simulates the exact class the fix addresses. Pane B's ChatPage
    // registers a window-level keydown handler; when user is focused
    // in pane A and presses ESC, pane B's handler checks
    // isActiveInDifferentPane(focusOfPaneA, 'sess-B') → true → skips.
    const focusInPaneA = mockElement('sess-A');
    assert.equal(isActiveInDifferentPane(focusInPaneA, 'sess-B'), true);
  });
});
