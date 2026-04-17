import type { SessionTick, StatuslineRawPayload } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { resolveOwner } from '../routes/hook-event.routes.js';
import { eventBus } from '../ws/event-bus.js';

// Phase M — in-memory dedup of rapid-fire ticks. Claude Code throttles
// at 300ms so we're primarily guarding against a misbehaving forwarder
// that fires faster. Map entries auto-rotate as new sessions tick; we
// never prune explicitly (size is bounded by active-session count).
const DEDUP_WINDOW_MS = 250;
const lastTickAt = new Map<string, number>();

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const bool = (v: unknown): boolean => v === true;

// Convert Claude Code's snake-cased StatuslineRawPayload into Commander's
// camelCased SessionTick, filling every absent field with null so client
// renderers never hit `undefined` deref on missing versions.
export const normalizeTick = (
  commanderSessionId: string,
  raw: StatuslineRawPayload,
  receivedAt: string,
): SessionTick => ({
  commanderSessionId,
  claudeSessionId: str(raw.session_id),
  receivedAt,
  updatedAtMs: Date.now(),
  model: {
    id: str(raw.model?.id),
    displayName: str(raw.model?.display_name),
  },
  contextWindow: {
    usedPercentage: num(raw.context_window?.used_percentage),
    remainingPercentage: num(raw.context_window?.remaining_percentage),
    contextWindowSize: num(raw.context_window?.context_window_size),
    totalInputTokens: num(raw.context_window?.total_input_tokens),
    totalOutputTokens: num(raw.context_window?.total_output_tokens),
    exceeds200k: bool(raw.exceeds_200k_tokens),
  },
  cost: {
    totalCostUsd: num(raw.cost?.total_cost_usd),
    totalDurationMs: num(raw.cost?.total_duration_ms),
    totalApiDurationMs: num(raw.cost?.total_api_duration_ms),
    totalLinesAdded: num(raw.cost?.total_lines_added),
    totalLinesRemoved: num(raw.cost?.total_lines_removed),
  },
  rateLimits: {
    fiveHour: {
      usedPercentage: num(raw.rate_limits?.five_hour?.used_percentage),
      resetsAt: str(raw.rate_limits?.five_hour?.resets_at),
    },
    sevenDay: {
      usedPercentage: num(raw.rate_limits?.seven_day?.used_percentage),
      resetsAt: str(raw.rate_limits?.seven_day?.resets_at),
    },
  },
  workspace: {
    worktree: str(raw.workspace?.git_worktree),
    cwd: str(raw.cwd),
  },
  version: str(raw.version),
});

export const sessionTickService = {
  // Returns `null` when the tick is dropped (dedup window or unresolvable
  // owner), the persisted tick otherwise. Caller (route handler) emits
  // the WS event only when the return is non-null.
  ingest(raw: StatuslineRawPayload): SessionTick | null {
    const transcriptPath = str(raw.transcript_path);
    const cwd = str(raw.cwd);
    const claudeSessionId = str(raw.session_id);

    const match = resolveOwner({
      event: 'session-tick',
      sessionId: claudeSessionId ?? undefined,
      data: {
        transcript_path: transcriptPath ?? undefined,
        cwd: cwd ?? undefined,
      },
    });
    if (!match) return null;

    const now = Date.now();
    const last = lastTickAt.get(match.id);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return null;
    lastTickAt.set(match.id, now);

    const receivedAt = new Date(now).toISOString();
    const tick = normalizeTick(match.id, raw, receivedAt);

    const db = getDb();
    db.prepare(
      `INSERT INTO session_ticks (
        session_id, updated_at, claude_session_id,
        context_used_pct, context_window_size, remaining_pct,
        cost_usd, total_duration_ms, total_api_duration_ms,
        total_lines_added, total_lines_removed,
        total_input_tokens, total_output_tokens,
        model_id, model_display_name, worktree, cwd,
        five_hour_pct, five_hour_resets_at,
        seven_day_pct, seven_day_resets_at,
        exceeds_200k, version, raw_json
      ) VALUES (
        @session_id, @updated_at, @claude_session_id,
        @context_used_pct, @context_window_size, @remaining_pct,
        @cost_usd, @total_duration_ms, @total_api_duration_ms,
        @total_lines_added, @total_lines_removed,
        @total_input_tokens, @total_output_tokens,
        @model_id, @model_display_name, @worktree, @cwd,
        @five_hour_pct, @five_hour_resets_at,
        @seven_day_pct, @seven_day_resets_at,
        @exceeds_200k, @version, @raw_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        claude_session_id = excluded.claude_session_id,
        context_used_pct = excluded.context_used_pct,
        context_window_size = excluded.context_window_size,
        remaining_pct = excluded.remaining_pct,
        cost_usd = excluded.cost_usd,
        total_duration_ms = excluded.total_duration_ms,
        total_api_duration_ms = excluded.total_api_duration_ms,
        total_lines_added = excluded.total_lines_added,
        total_lines_removed = excluded.total_lines_removed,
        total_input_tokens = excluded.total_input_tokens,
        total_output_tokens = excluded.total_output_tokens,
        model_id = excluded.model_id,
        model_display_name = excluded.model_display_name,
        worktree = excluded.worktree,
        cwd = excluded.cwd,
        five_hour_pct = excluded.five_hour_pct,
        five_hour_resets_at = excluded.five_hour_resets_at,
        seven_day_pct = excluded.seven_day_pct,
        seven_day_resets_at = excluded.seven_day_resets_at,
        exceeds_200k = excluded.exceeds_200k,
        version = excluded.version,
        raw_json = excluded.raw_json`,
    ).run({
      session_id: tick.commanderSessionId,
      updated_at: tick.updatedAtMs,
      claude_session_id: tick.claudeSessionId,
      context_used_pct: tick.contextWindow.usedPercentage,
      context_window_size: tick.contextWindow.contextWindowSize,
      remaining_pct: tick.contextWindow.remainingPercentage,
      cost_usd: tick.cost.totalCostUsd,
      total_duration_ms: tick.cost.totalDurationMs,
      total_api_duration_ms: tick.cost.totalApiDurationMs,
      total_lines_added: tick.cost.totalLinesAdded,
      total_lines_removed: tick.cost.totalLinesRemoved,
      total_input_tokens: tick.contextWindow.totalInputTokens,
      total_output_tokens: tick.contextWindow.totalOutputTokens,
      model_id: tick.model.id,
      model_display_name: tick.model.displayName,
      worktree: tick.workspace.worktree,
      cwd: tick.workspace.cwd,
      five_hour_pct: tick.rateLimits.fiveHour.usedPercentage,
      five_hour_resets_at: tick.rateLimits.fiveHour.resetsAt,
      seven_day_pct: tick.rateLimits.sevenDay.usedPercentage,
      seven_day_resets_at: tick.rateLimits.sevenDay.resetsAt,
      exceeds_200k: tick.contextWindow.exceeds200k ? 1 : 0,
      version: tick.version,
      raw_json: JSON.stringify(raw),
    });

    eventBus.emitSessionTick(tick.commanderSessionId, tick);
    return tick;
  },

  getLatestForSession(sessionId: string): SessionTick | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT raw_json, session_id, updated_at, claude_session_id FROM session_ticks WHERE session_id = ?',
    ).get(sessionId) as
      | { raw_json: string; session_id: string; updated_at: number; claude_session_id: string | null }
      | undefined;
    if (!row) return null;
    try {
      const raw = JSON.parse(row.raw_json) as StatuslineRawPayload;
      return normalizeTick(row.session_id, raw, new Date(row.updated_at).toISOString());
    } catch {
      return null;
    }
  },

  // Exposed for tests so dedup state doesn't leak across cases.
  _clearDedupForTests(): void {
    lastTickAt.clear();
  },
};
