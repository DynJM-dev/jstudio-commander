// Issue 15.3 — canonical SessionState classifier.
//
// Composes the signal sources Commander already maintains into a single
// typed `SessionState` event. Every UI surface (ContextBar label,
// status bar, LiveActivityRow, Plan widget) subscribes to the typed
// state and switches on `kind` + `subtype` instead of re-deriving from
// scattered signals (pane text + timestamps + JSONL tail + approval
// regexes + compact-boundary presence). Six+ pattern-match class-of-
// bugs grew out of that scattered re-derivation — the refactor moves
// all policy into ONE pure function.
//
// Dual-emit migration: the poller writes the legacy `status` column
// AND emits this typed state on the same `session:status` WS event.
// Clients read `state` when present, fall back to deriving from
// `status` when absent. Surfaces migrate one at a time in follow-up
// rotations; deprecating the legacy derivation paths waits until
// every surface has moved.
//
// ── PATTERN-MATCHING CONSTRAINT (§24, for this file) ──
// This classifier composes ALREADY-DERIVED signals. It does NOT run
// its own regex against the pane. Every input that arrived here
// already passed through its own semantic gate:
//   - `paneStatus` / `paneEvidence` — from `classifyStatusFromPane`
//     (Issue 8 P0 verb-sanity + Phase J.1 IDLE_VERBS + Phase L past-
//     tense gating all applied upstream)
//   - `hintedStatus` — from `applyActivityHints` (Issue 15 M1 allowlist
//     at 15.1-D; only `fallthrough → idle` upgrades)
//   - `pendingToolUse` — from `hasPendingToolUseInTranscript` (Issue
//     15 Stop-gate structured tool_use/tool_result pairing)
//   - `waitingPromptKind` — from `detectPrompts` (Issue 9 P2 explicit
//     approval-token branches)
//   - `preCompactState` — from `preCompactService` (Phase Q warn →
//     compacting → reset state machine)
// Priority ordering below determines which signal wins when two
// disagree — structured signals (tool_use pairing, compacting state,
// explicit approval tokens) outrank pane text in every case.

import type {
  SessionState,
  IdleSubtype,
  WorkingSubtype,
  WaitingSubtype,
  StoppedReason,
} from '@commander/shared';
import { IDLE_JUST_FINISHED_MS, IDLE_POST_COMPACT_MS } from '@commander/shared';
import type { SessionStatus, SessionActivity } from '@commander/shared';

// Optional shape the caller passes per session per poll tick. Every
// field is optional so a partial set still produces a sensible state
// (Working:Generic / Idle:Generic fallbacks). Callers populate what
// they cheaply have; richer subtyping kicks in as more signals flow.
export interface SessionStateInputs {
  /** Output of `classifyStatusFromPane` — the pane-only verdict. */
  paneStatus: SessionStatus;
  /** Evidence string from the pane classifier. Used for subtype inference. */
  paneEvidence: string;
  /** Parsed pane activity (spinner + verb + elapsed) or null. */
  paneActivity?: SessionActivity | null;

  /** Output of `applyActivityHints`. Post-upgrade status. */
  hintedStatus: SessionStatus;
  /** Evidence from applyActivityHints (may prefix "activity-hint upgrade"). */
  hintedEvidence: string;

  /** From `hasPendingToolUseInTranscript`. Issue 15.1-H authoritative signal. */
  pendingToolUse?: boolean;
  /** Tool name from the latest unmatched tool_use, when known. */
  pendingToolName?: string;

  /** Detected approval-prompt type (Issue 9 P2). */
  waitingPromptKind?: WaitingSubtype | null;
  /** Short human-readable context for the waiting prompt (first line, trimmed). */
  waitingContext?: string;

  /** pre-compact state-machine snapshot for this session. */
  preCompactState?: 'idle' | 'warned' | 'compacting';

  /** Active (non-stopped) teammate count whose parent is this session. */
  activeTeammateCount?: number;

  /** Epoch-ms of last Stop hook for this session, or 0 if never. */
  lastStopAt?: number;
  /** Epoch-ms of the most recent `compact_boundary` in transcript, or 0. */
  lastCompactBoundaryAt?: number;

  /** Stopped-row reason. Only consulted when paneStatus === 'stopped'. */
  stoppedReason?: StoppedReason;

  /** Test-only override. Defaults to Date.now(). */
  nowMs?: number;
}

// Known live-thinking verbs Claude Code emits as the pane footer verb.
// Presence of one (Issue 8 P0's morphology filter guarantees `-ing`)
// promotes a Working state to Working:Thinking. Kept narrow — only
// verbs we've directly observed drawing a live spinner. Unknown verbs
// fall through to Working:Generic (default = render, never vanish).
const THINKING_VERBS = new Set([
  'Thinking', 'Ruminating', 'Cogitating', 'Pondering', 'Mulling',
  'Brewing', 'Doodling', 'Nesting', 'Composing', 'Crunching',
  'Stewing', 'Percolating', 'Hullaballooing', 'Tomfoolering',
  'Flibbertigibbeting',
]);

// Pure function. Takes all signals the caller has gathered, returns
// the canonical typed state. ORDER MATTERS — the first matching branch
// wins. Structured signals checked before pane-derived ones.
export const computeSessionState = (inputs: SessionStateInputs): SessionState => {
  const now = inputs.nowMs ?? Date.now();

  // 1. Error — pane classifier detected an error pattern.
  if (inputs.paneStatus === 'error') {
    return { kind: 'Error', message: inputs.paneEvidence || 'unknown error' };
  }

  // 2. Stopped — highest-certainty terminal state.
  if (inputs.paneStatus === 'stopped' || inputs.hintedStatus === 'stopped') {
    return { kind: 'Stopped', reason: inputs.stoppedReason ?? 'Unknown' };
  }

  // 3. Compacting — the pre-compact state machine is the authoritative
  //    signal that `/compact` is in flight. Overrides pane-derived
  //    working/idle for the full operation duration.
  if (inputs.preCompactState === 'compacting') {
    return { kind: 'Compacting' };
  }

  // 4. WaitingForInput — explicit approval-token match wins when
  //    available. Candidate 21's canonical fix is to route through
  //    `waitingPromptKind` (the Issue 9 P2 explicit-token detector).
  //    When the detector hasn't been plumbed (Phase 1 poller doesn't
  //    yet run `detectPrompts` per tick), fall back to the pane's own
  //    `waiting` verdict — the pane's WAITING_INDICATORS list is itself
  //    already narrowed to explicit tokens (#236 removed the bare
  //    trailing-`?` match), so `paneStatus === 'waiting'` is a
  //    structurally-gated signal. Emit Generic subtype with the
  //    evidence carried across as context until the plumb-through
  //    lands in a follow-up rotation.
  if (inputs.waitingPromptKind) {
    return {
      kind: 'WaitingForInput',
      subtype: inputs.waitingPromptKind,
      ...(inputs.waitingContext ? { context: inputs.waitingContext } : {}),
    };
  }
  if (inputs.paneStatus === 'waiting' || inputs.hintedStatus === 'waiting') {
    // Infer a richer subtype from the evidence string when possible.
    const ev = inputs.paneEvidence;
    let subtype: WaitingSubtype = 'Generic';
    // Evidence string carries the matched classifier pattern's `source`
    // (with backslash-escapes like `\(y\/n\)`), plus readable words
    // like "numbered-choice". Match on both forms.
    if (/numbered-choice/i.test(ev)) subtype = 'NumberedChoice';
    else if (/trust this folder/i.test(ev)) subtype = 'TrustFolder';
    else if (/y[\\/]?[\\/]?n/i.test(ev)) subtype = 'YesNo';
    else if (/allow.*deny|approv|proceed/i.test(ev)) subtype = 'Approval';
    return {
      kind: 'WaitingForInput',
      subtype,
      ...(inputs.waitingContext ? { context: inputs.waitingContext } : {}),
    };
  }

  // 5. Working:ToolExec — Issue 15.1-H structured-signal authoritative.
  //    If the JSONL tail contains an unmatched tool_use, Claude IS
  //    running a tool regardless of what the pane shows.
  if (inputs.pendingToolUse === true) {
    return {
      kind: 'Working',
      subtype: 'ToolExec',
      ...(inputs.pendingToolName ? { toolName: inputs.pendingToolName } : {}),
    };
  }

  // 6. Working — pane or hinted says working. Narrow subtype by
  //    inspecting the live verb.
  const working =
    inputs.paneStatus === 'working' ||
    inputs.hintedStatus === 'working';
  if (working) {
    const verb = inputs.paneActivity?.verb;
    if (verb && THINKING_VERBS.has(verb)) {
      return {
        kind: 'Working',
        subtype: 'Thinking',
        hintLabel: `${verb}…`,
      };
    }
    // Composing subtype requires last-assistant-block-is-text knowledge
    // which isn't plumbed in this Phase 1 ship. Left as a follow-up
    // once a JSONL-tail extractor is available; falls through to
    // Generic for now (matches current UI behavior — ContextBar's
    // getComposingLabelIfApplicable derives Composing from a client-
    // side JSONL read, so no regression vs today).
    return { kind: 'Working', subtype: 'Generic' };
  }

  // 7. Idle — decide the subtype from recency + teammate count.
  // Candidate 20: if this session has active teammates, emit
  // MonitoringSubagents (a PM pattern) instead of Generic.
  if ((inputs.activeTeammateCount ?? 0) > 0) {
    return {
      kind: 'Idle',
      subtype: 'MonitoringSubagents',
      ...(inputs.lastStopAt ? { since: inputs.lastStopAt } : {}),
    };
  }

  // PostCompact: compact_boundary landed recently. Takes precedence
  // over JustFinished because the Stop hook that produced "just
  // finished" is usually older than the compact_boundary in this case.
  const msSinceCompact = now - (inputs.lastCompactBoundaryAt ?? 0);
  if (
    inputs.lastCompactBoundaryAt &&
    inputs.lastCompactBoundaryAt > 0 &&
    msSinceCompact < IDLE_POST_COMPACT_MS
  ) {
    return {
      kind: 'Idle',
      subtype: 'PostCompact',
      since: inputs.lastCompactBoundaryAt,
    };
  }

  // JustFinished: Stop hook fired recently.
  const msSinceStop = now - (inputs.lastStopAt ?? 0);
  if (
    inputs.lastStopAt &&
    inputs.lastStopAt > 0 &&
    msSinceStop < IDLE_JUST_FINISHED_MS
  ) {
    return {
      kind: 'Idle',
      subtype: 'JustFinished',
      since: inputs.lastStopAt,
    };
  }

  // AwaitingFirstPrompt: lastStopAt absent OR zero → session has
  // never emitted a Stop. Either brand-new or post-SessionStart
  // pre-first-turn. Zero-timestamp treatment matches the server's
  // storage default.
  if (!inputs.lastStopAt || inputs.lastStopAt === 0) {
    return { kind: 'Idle', subtype: 'AwaitingFirstPrompt' };
  }

  // Generic idle — has had prior turns but nothing recent.
  return {
    kind: 'Idle',
    subtype: 'Generic',
    ...(inputs.lastStopAt ? { since: inputs.lastStopAt } : {}),
  };
};

// Re-export so downstream callers import from one service file.
export type { SessionState, IdleSubtype, WorkingSubtype, WaitingSubtype, StoppedReason };
