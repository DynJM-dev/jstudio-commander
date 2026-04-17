// Phase M — per-session telemetry tick payloads.
//
// Claude Code pipes a `Status` JSON object to the user-registered
// statusline command every ~300ms. Commander's statusline forwarder
// POSTs that object to `/api/session-tick`; the server normalizes it
// into `SessionTick` (the type clients consume over the WS feed) and
// persists a row in the `session_ticks` table.
//
// Fields match the Claude Code statusline schema (see
// COMMANDER_IDE_RESEARCH.md §1.2) with Commander-specific additions:
//   - `commanderSessionId` — the Commander `sessions.id` bound via
//     resolveOwner. Clients subscribe to `session:<commanderSessionId>`.
//   - `receivedAt` — server wall-clock at ingest; lets the client
//     render freshness ("updated 2s ago") even when claude_session_id
//     + tick intervals drift.
//
// Every numeric field is optional: Claude Code versions < 1.2.80 omit
// `rate_limits` entirely, and `current_usage` is null before the first
// API call of a session.

export interface StatuslineRawPayload {
  hook_event_name?: string;
  session_id?: string;
  session_name?: string;
  transcript_path?: string;
  cwd?: string;
  version?: string;
  model?: { id?: string; display_name?: string };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
    git_worktree?: string;
  };
  output_style?: { name?: string };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    used_percentage?: number;
    remaining_percentage?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  exceeds_200k_tokens?: boolean;
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: string };
    seven_day?: { used_percentage?: number; resets_at?: string };
  };
}

export interface SessionTick {
  commanderSessionId: string;
  claudeSessionId: string | null;
  receivedAt: string;
  updatedAtMs: number;
  model: { id: string | null; displayName: string | null };
  contextWindow: {
    usedPercentage: number | null;
    remainingPercentage: number | null;
    contextWindowSize: number | null;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    exceeds200k: boolean;
  };
  cost: {
    totalCostUsd: number | null;
    totalDurationMs: number | null;
    totalApiDurationMs: number | null;
    totalLinesAdded: number | null;
    totalLinesRemoved: number | null;
  };
  rateLimits: {
    fiveHour: { usedPercentage: number | null; resetsAt: string | null };
    sevenDay: { usedPercentage: number | null; resetsAt: string | null };
  };
  workspace: { worktree: string | null; cwd: string | null };
  version: string | null;
}
