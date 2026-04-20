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

// Issue 15.3 §6.2 — client-side unmatched-tool_use detector. JSONL
// goes quiet between tool_use dispatch and tool_result return (empirically
// 10+ seconds for a `sleep 10`). During that window the server status
// may already say 'working' but heartbeat ticks also have a floor, so
// the OR-gate uses the ChatMessage tail as an independent signal: if
// the latest tool_use has no matching tool_result yet, a tool is
// executing right now, regardless of what heartbeats say.
//
// Bounded scan — walks the last `window` messages (default 8) for
// speed. Matches by tool_use `id` ↔ tool_result `toolUseId` per the
// parser's verbatim preservation.
export const hasUnmatchedToolUse = (
  messages: ChatMessage[],
  window = 8,
): boolean => {
  if (messages.length === 0) return false;
  const start = Math.max(0, messages.length - window);
  const toolUseIds = new Set<string>();
  const resultIds = new Set<string>();
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use' && b.id) toolUseIds.add(b.id);
      else if (b.type === 'tool_result' && b.toolUseId) resultIds.add(b.toolUseId);
    }
  }
  for (const id of toolUseIds) if (!resultIds.has(id)) return true;
  return false;
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

// Issue 15.1 Symptom A — action-label precedence for compaction state.
//
// `/compact` doesn't emit a new assistant text block, so
// `getComposingLabelIfApplicable` stays pinned on the PREVIOUS turn's
// text reply and returns "Composing response..." for the whole
// duration of the compaction + after it completes. Claude Code's pane
// shows "Compacting..." while the slash command runs, which the
// client's parseTerminalHint maps to the literal string
// 'Compacting context...'.
//
// Compaction is a discrete lifecycle state, not regular composition —
// promote the compacting hint above the jsonl-derived label when the
// session is working and the terminal-hint says compacting. Other
// terminal hints stay lower-priority (less specific than jsonl-derived
// labels, which usually name the exact tool or action).
//
// Pure function — used by ContextBar's actionLabel derivation. Tests
// cover the precedence matrix without rendering React.
//
// Issue 15.3 — when the server has emitted a canonical `SessionState`
// via `session:status`, the typed state's subtype + hintLabel are the
// authoritative source for the action label. Falls back to the
// legacy derivation (jsonl-derived `jsonlLabel` / `terminalHint`)
// when the canonical state is absent (pre-migration clients + gap
// between session open and first status emit).
import type { SessionState } from '@commander/shared';

export const resolveActionLabel = (opts: {
  isWorking: boolean;
  jsonlLabel: string | null;
  terminalHint: string | null;
  /** Canonical typed state from the server. When present takes priority. */
  sessionState?: SessionState | null;
}): string | null => {
  const { isWorking, jsonlLabel, terminalHint, sessionState } = opts;

  // Issue 15.3 — typed-state path. The server has decided the state;
  // render the user-facing label from its kind + subtype. Falls
  // through to the legacy derivation below when `sessionState` is
  // absent (client is pre-migration or no event has arrived yet).
  if (sessionState) {
    switch (sessionState.kind) {
      case 'Compacting':
        return 'Compacting context...';
      case 'WaitingForInput':
        switch (sessionState.subtype) {
          case 'Approval': return 'Waiting for approval';
          case 'TrustFolder': return 'Trust this folder?';
          case 'NumberedChoice': return 'Choose an option';
          case 'YesNo': return 'Confirm (y/n)';
          case 'Generic': return 'Waiting for input';
        }
        break;
      case 'Working':
        // Issue 15.3 §6.1 — Working-path inversion. The client's
        // getActionInfo derives rich, specific labels from ChatMessage
        // content ("Reading STATE.md…", "Editing file.ts…", "Running
        // command…"). The server's typed Working:ToolExec currently
        // lacks a populated toolName (hasPendingToolUseInTranscript
        // returns a boolean), so the typed path degrades to a generic
        // "Running tool…" that overrides the richer jsonlLabel. Invert:
        // for the Working coarse status, prefer jsonlLabel first, then
        // fall back to typed subtype hints. Stopped/Error/Waiting/
        // Compacting/Idle keep the typed-state authority above.
        if (jsonlLabel) return jsonlLabel;
        switch (sessionState.subtype) {
          case 'ToolExec':
            return sessionState.toolName ? `Running ${sessionState.toolName}…` : 'Running tool…';
          case 'Thinking':
            return sessionState.hintLabel ?? 'Thinking…';
          case 'Composing':
            return 'Composing response...';
          case 'Generic':
            // Fall through to terminal-hint legacy path.
            break;
        }
        break;
      case 'Idle':
        // Issue 15.3 Fix 2 — stale-typed-Idle can clobber a live
        // jsonlLabel during a fresh Working turn (§12.3 Cause 2; §12.1
        // Case 3: `A-return {branch:"tool_use:Bash", label:"Running
        // command..."}` at T+5948ms with `sessionStateKind:"Idle"`
        // stale → pre-fix returned null → DOM fell to generic
        // "Working...").
        //
        // When the bar is actively working (isWorking=true from Fix 1's
        // OR-chain including the typed-Working freshness branch) and we
        // have a rich jsonlLabel from getActionInfo, extend the §6.1
        // Working-path inversion to cover stale-Idle — return the
        // jsonlLabel rather than null. Preserves true-idle render when
        // no Working signal is present: if isWorking=false OR jsonlLabel
        // is null, falls through to `return null` exactly as before.
        if (isWorking && jsonlLabel) return jsonlLabel;
        return null;
      case 'Stopped':
      case 'Error':
        return null;
    }
  }

  // Legacy path (unchanged from pre-15.3): compaction hint > jsonl
  // label > terminal-hint fallback. Runs when sessionState is absent
  // OR when Working:Generic fell through above.
  if (isWorking && terminalHint === 'Compacting context...') {
    return terminalHint;
  }
  if (jsonlLabel) return jsonlLabel;
  if (isWorking && terminalHint) return terminalHint;
  return null;
};
