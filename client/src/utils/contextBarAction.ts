import type { ChatMessage } from '@commander/shared';

// Issue 8.1 Part 2 — ContextBar action-label derivation, extracted
// from ContextBar.tsx so the "Composing response..." fresh-activity
// gate is unit-testable. See `shouldSuppressTextLabel` below for the
// defense-in-depth rationale.

// Matches ContextBar's staleness threshold (mirror of Phase U.1
// STALE_ACTIVITY_MS on the server; kept in sync so the client
// never claims "Composing response..." past the point the server
// would force-idle).
export const STALE_ACTIVITY_MS = 30_000;

// Pure predicate. Returns true when the last known activity bump is
// older than the stale threshold AND we have a real timestamp to
// compare against. Missing / zero timestamps are treated as
// "unknown → not stale" so we don't suppress labels on fresh
// sessions that haven't emitted a first activity yet.
export const isActivityStale = (
  lastActivityAt: number | undefined,
  nowMs: number = Date.now(),
): boolean => {
  if (typeof lastActivityAt !== 'number') return false;
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return false;
  return nowMs - lastActivityAt > STALE_ACTIVITY_MS;
};

// Issue 8.1 Part 2 — the "Composing response..." label is the
// highest-stakes jsonl-derived label: it implies Claude is actively
// typing. Issue 8 P0 removed the primary trigger (tmux-pane false
// positives); this gate adds defense-in-depth against ANY future
// code path that might flip session.status to 'working' while the
// last assistant block happens to be text. If the activity event
// stream went stale >STALE_ACTIVITY_MS ago, suppress the label.
//
// Only the composing label is suppressed — tool-based labels (`Reading
// X`, `Running command`, etc.) are driven by tool_use blocks whose
// staleness story is handled by tool_result append timing. Narrow
// scope limits the blast radius of the defense.
export const shouldSuppressComposingLabel = (
  label: string | undefined | null,
  lastActivityAt: number | undefined,
  nowMs: number = Date.now(),
): boolean => {
  if (!label) return false;
  if (label !== 'Composing response...') return false;
  return isActivityStale(lastActivityAt, nowMs);
};

// Pure version of ContextBar's `getActionInfo`. Scans backward
// for the last assistant message and derives an action label from
// its last content block. Returns null when no assistant message is
// visible or the last block's type isn't one we tag.
//
// NB: the caller is responsible for gating this against staleness
// via `shouldSuppressComposingLabel`. Keeping gating in ContextBar
// lets this helper stay pure + trivial to test.
export const getComposingLabelIfApplicable = (messages: ChatMessage[]): string | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== 'assistant') continue;
    const last = m.content[m.content.length - 1];
    if (!last) return null;
    return last.type === 'text' ? 'Composing response...' : null;
  }
  return null;
};
