// Issue Candidate 19 — split-view cross-pane interrupt guard.
//
// PaneContainer (`client/src/pages/PaneContainer.tsx:151`) stamps each
// pane's root element with `data-pane-session-id={sessionId}`. Multiple
// ChatPage instances can be live simultaneously in split view, each
// registering its own `window`-level ESC / Cmd+. keydown handler. Without
// a guard, every handler fires on every keystroke, so ESC interrupts
// ALL active sessions instead of just the one the user is focused in.
//
// This predicate returns true when the currently-focused element is
// inside a DIFFERENT pane than the caller's `thisSessionId`. Caller
// skips the handler when true, so only the focused pane's handler runs.
//
// Returns false (= allow handler to proceed) when:
//  - No active element (defensive).
//  - Caller has no sessionId (fresh-session path — no pane to disambiguate).
//  - Active element is NOT inside any pane (e.g. focus in a global nav
//    or modal). Falls back to pre-fix behavior where all panes fire;
//    we don't silently swallow ESC when focus is genuinely outside panes.
//  - Active element IS inside THIS pane.
//
// Typed loosely on the element interface so the predicate is unit-testable
// with a plain object mock (no JSDOM required). Runtime accepts any real
// HTMLElement.
export const isActiveInDifferentPane = (
  activeElement: {
    closest?: (selector: string) => { getAttribute?: (name: string) => string | null } | null;
  } | null | undefined,
  thisSessionId: string | undefined,
): boolean => {
  if (!activeElement) return false;
  if (!thisSessionId) return false;
  const focusedPane = activeElement.closest?.('[data-pane-session-id]');
  if (!focusedPane) return false;
  const owner = focusedPane.getAttribute?.('data-pane-session-id');
  if (owner === undefined || owner === null) return false;
  return owner !== thisSessionId;
};
