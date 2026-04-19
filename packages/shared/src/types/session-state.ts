// Issue 15.3 — canonical SessionState typed event.
//
// The legacy `SessionStatus` enum (`idle | working | waiting | stopped |
// error`) was too coarse: every UI surface that cared about WHY a
// session was in a given state had to re-derive it from scratch (pane
// text, JSONL tail, activity timestamps, approval-token matches,
// compact-boundary presence). Six+ pattern-match class-of-bugs grew
// out of that scattered re-derivation — 8 P0, 8.1, 9 P2, 15 M2, 15 M1
// original, 15.1-D — plus Candidates 20/21/22.
//
// `SessionState` is the typed, canonical shape. The server computes it
// ONCE per poll tick / hook event and emits it as an additional
// field on `session:status`. Every UI surface subscribes and switches
// on `kind` + `subtype`. No more ad-hoc derivation.
//
// Migration posture: dual-emit during Phase 1 (this rotation). UI
// surfaces read `state` when present, fall back to deriving from
// `status` when absent (backward-compat for any stale WS messages
// that slip through a restart). Once every surface has migrated, the
// legacy derivation paths get deleted (not in this rotation).

export type SessionStateKind =
  | 'Idle'
  | 'Working'
  | 'WaitingForInput'
  | 'Stopped'
  | 'Compacting'
  | 'Error';

// Idle subtypes surface "why idle" so UI can render richer labels
// than just "Idle — Waiting for instructions". Issue 15.4's polish
// target for the status bar lives here.
export type IdleSubtype =
  | 'AwaitingFirstPrompt'   // session has never had a turn (no Stop hook ever fired)
  | 'JustFinished'          // Stop fired within IDLE_JUST_FINISHED_MS (30s)
  | 'PostCompact'           // compact_boundary landed recently
  | 'MonitoringSubagents'   // parent session idle but has active teammates (PM pattern)
  | 'Generic';              // idle, no richer context available

// Working subtypes carry the "what kind of work" discriminator. Order
// of specificity: ToolExec (authoritative structured signal) > Thinking
// (visible live-spinner verb from pane) > Composing (last assistant
// block is text) > Generic (pane says working but we can't narrow).
export type WorkingSubtype =
  | 'ToolExec'              // pending tool_use in JSONL (Issue 15.1-H signal)
  | 'Thinking'              // live spinner verb from pane (Ruminating / Cogitating / ...)
  | 'Composing'             // last assistant block is text, still streaming
  | 'Generic';              // paneStatus === 'working' but no narrower signal

// WaitingForInput subtypes enforce Candidate 21 fix: every emit must
// be gated on an EXPLICIT approval-token match, never on loose pane
// pattern shape. Approval-token sources live in
// `server/src/services/prompt-detector.service.ts` (Issue 9 P2).
export type WaitingSubtype =
  | 'Approval'              // "Do you want to proceed"-class prompts
  | 'TrustFolder'           // "trust this folder" prompt
  | 'NumberedChoice'        // ❯ 1. / 2. / 3. numbered-choice blocks
  | 'YesNo'                 // (y/n) / [Y/n] / [y/N]
  | 'Generic';              // pane said waiting but we couldn't narrow

export type StoppedReason = 'UserInitiated' | 'ProcessExit' | 'Crashed' | 'Unknown';

export type SessionState =
  | { kind: 'Idle'; subtype: IdleSubtype; since?: number }
  | { kind: 'Working'; subtype: WorkingSubtype; hintLabel?: string; toolName?: string }
  | { kind: 'WaitingForInput'; subtype: WaitingSubtype; context?: string }
  | { kind: 'Stopped'; reason: StoppedReason }
  | { kind: 'Compacting' }
  | { kind: 'Error'; message: string };

// Time windows that drive Idle subtyping. Exported so tests + client
// fallback logic use the exact same thresholds.
export const IDLE_JUST_FINISHED_MS = 30_000;
export const IDLE_POST_COMPACT_MS = 60_000;

// Derive the legacy SessionStatus from a typed SessionState. Used by
// any client code path that needs the coarse status (e.g. existing
// boolean `isWorking` checks) but wants to read from the new typed
// field. Keeps the backward-compat story trivial — if the client
// doesn't recognize the new `state` field it falls back to reading
// `status` directly from the WS payload.
export const sessionStateToStatus = (
  state: SessionState,
): 'idle' | 'working' | 'waiting' | 'stopped' | 'error' => {
  switch (state.kind) {
    case 'Idle': return 'idle';
    case 'Working': return 'working';
    case 'WaitingForInput': return 'waiting';
    case 'Stopped': return 'stopped';
    case 'Compacting': return 'working'; // compaction is active work
    case 'Error': return 'error';
  }
};
