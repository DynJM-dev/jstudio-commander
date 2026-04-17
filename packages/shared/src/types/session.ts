export type SessionStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';

// Commander effort matrix per ~/.claude/skills/jstudio-pm/SKILL.md.
// Legacy rows ('low', 'medium') are healed to 'xhigh' on boot —
// any fresh write from Commander must land in this union.
export const EFFORT_LEVELS = ['high', 'xhigh', 'max'] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];

// Live pane-activity line, parsed from the Claude Code footer. Example:
//   "✽ Ruminating… (1m 49s · ↓ 430 tokens · thinking with xhigh effort)"
// spinner is the leading glyph; verb the gerund; elapsed the as-printed
// duration; tokens the int; effort the matched effort keyword. `raw` is
// the full matched line, kept so the UI can forward-compat unknown
// shapes without the server needing a schema bump.
export interface SessionActivity {
  verb: string;
  spinner: string;
  elapsed?: string;
  tokens?: number;
  effort?: EffortLevel;
  raw: string;
}

// Evidence string used by the poller when it logs a status flip and by
// the WS `session:status` payload so the client can toast the transition
// with a short human-readable rationale.
export interface StatusFlip {
  at: string;
  from: SessionStatus;
  to: SessionStatus;
  evidence: string;
}

export interface Session {
  id: string;
  name: string;
  tmuxSession: string;
  projectPath: string | null;
  claudeSessionId: string | null;
  status: SessionStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  stationId: string | null;
  agentRole: string | null;
  effortLevel: EffortLevel;
  parentSessionId: string | null;
  teamName: string | null;
  // 'pm' sessions auto-invoke /pm after Claude boots. 'raw' sessions are
  // plain Claude Code — no bootstrap. Defaults to 'raw' for rows created
  // before this field existed.
  sessionType: 'pm' | 'raw';
  // Ordered list of JSONL transcript absolute paths this session owns.
  // Appended once per hook event. Chat rendering concatenates messages
  // across every path in this list in order — so /compact, /clear, model
  // switches, or any other rotation produces additional entries here
  // rather than replacing the previous transcript.
  transcriptPaths: string[];
  // Phase N.0 Patch 3 — epoch-ms of the last inbound signal (hook
  // event, statusline tick, chokidar JSONL append, or an actual
  // status-poller write that changed the row). 0 when never
  // heartbeated — brand-new sessions or pre-Patch-3 rows. Clients
  // render "Xs ago" from `Date.now() - lastActivityAt` and force-
  // display idle after a 30s stale threshold regardless of `status`.
  lastActivityAt: number;
  // Phase Q — when true, Commander watches this session's context-window
  // percentage and injects a warning message at 85% + auto-compacts
  // at 95% (or after the session's AI responds READY_TO_COMPACT).
  // Defaults on for coder/teammate rows, off for lead-pm/pm rows
  // (PMs compact more carefully — they own durable handoff state).
  autoCompactEnabled: boolean;
  // Live pane activity — populated on route boundaries (GET /sessions/:id
  // and the teammates list) by re-capturing the tmux pane tail. Null when
  // nothing parses, when the session is stopped, or when the list endpoint
  // skipped activity to avoid N tmux-capture shellouts per poll. Never
  // persisted to the DB — activity is strictly derived.
  activity?: SessionActivity | null;
}

export interface Teammate {
  sessionId: string;
  sessionName: string;
  role: string;
  teamName: string;
  parentSessionId: string;
  color?: string;
  tmuxPaneId?: string;
}

export interface SessionEvent {
  id: number;
  sessionId: string;
  event: 'created' | 'started' | 'stopped' | 'killed' | 'command_sent' | 'error';
  detail: string | null;
  timestamp: string;
}
