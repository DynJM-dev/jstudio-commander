import type { FastifyInstance } from 'fastify';
import { basename } from 'node:path';
import { fileWatcherService } from '../services/file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';
import { sessionService } from '../services/session.service.js';

interface HookEventBody {
  event: string;
  sessionId?: string;
  data?: {
    transcript_path?: string;
    cwd?: string;
    tool_name?: string;
    [key: string]: unknown;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidFromTranscriptPath = (path: string): string | null => {
  const name = basename(path).replace(/\.jsonl$/i, '');
  return UUID_RE.test(name) ? name : null;
};

export type MatchStrategy =
  | 'claudeSessionId'
  | 'id-as-uuid'
  | 'transcriptUUID'
  | 'unclaimed-cwd'
  | 'rotation-detected'
  | 'skipped';

// Running counters for operational visibility — surfaced via /api/system/health.
// Lightweight and in-memory; reset on server restart.
export const hookMatchStats: Record<MatchStrategy, number> = {
  claudeSessionId: 0,
  'id-as-uuid': 0,
  transcriptUUID: 0,
  'unclaimed-cwd': 0,
  'rotation-detected': 0,
  skipped: 0,
};

// Resolve the Commander sessions row that owns this hook event. Tries four
// strategies in order so PM + teammate flows both converge on the correct
// row without a separate polling loop. Once matched, backfills
// claude_session_id + transcript_path on the row so future events match via
// the fast path (strategy 1).
const resolveSessionRow = (
  body: HookEventBody,
): { id: string; backfillClaudeId: string | null; strategy: Exclude<MatchStrategy, 'skipped'> } | null => {
  const db = getDb();
  const payloadClaudeId = body.sessionId ?? null;
  const transcriptClaudeId = body.data?.transcript_path ? uuidFromTranscriptPath(body.data.transcript_path) : null;
  const cwd = body.data?.cwd;

  // 1. Fast path — a row already knows its Claude UUID.
  const anyClaudeId = payloadClaudeId ?? transcriptClaudeId;
  if (anyClaudeId) {
    const row = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?').get(anyClaudeId) as { id: string } | undefined;
    if (row) return { id: row.id, backfillClaudeId: null, strategy: 'claudeSessionId' };
  }

  // 2. The session's Commander id IS the Claude UUID (PM pattern: leadSessionId
  // stored as sessions.id). Backfill so subsequent events hit strategy 1.
  if (anyClaudeId) {
    const row = db.prepare('SELECT id, claude_session_id FROM sessions WHERE id = ?').get(anyClaudeId) as
      | { id: string; claude_session_id: string | null }
      | undefined;
    if (row) {
      return {
        id: row.id,
        backfillClaudeId: row.claude_session_id ? null : anyClaudeId,
        strategy: 'id-as-uuid',
      };
    }
  }

  // 2b. Transcript path carries a different UUID than the payload sessionId —
  // rare, but possible during session rotation. Match the transcript UUID
  // against any sessions row whose id equals it.
  if (transcriptClaudeId && transcriptClaudeId !== payloadClaudeId) {
    const row = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ? OR id = ?').get(
      transcriptClaudeId,
      transcriptClaudeId,
    ) as { id: string } | undefined;
    if (row) return { id: row.id, backfillClaudeId: transcriptClaudeId, strategy: 'transcriptUUID' };
  }

  // 3. Unclaimed row in the same cwd — prefer teammate rows (parent_session_id
  // set) that have not yet been linked. If exactly one candidate remains after
  // filtering, claim it. Multi-candidate is ambiguous; we still claim but flag
  // it as a warning up the stack.
  if (cwd && anyClaudeId) {
    const candidates = db.prepare(
      `SELECT id, parent_session_id FROM sessions
       WHERE project_path = ? AND status != 'stopped' AND claude_session_id IS NULL
       ORDER BY parent_session_id IS NULL ASC, updated_at DESC`
    ).all(cwd) as Array<{ id: string; parent_session_id: string | null }>;

    if (candidates.length >= 1) {
      const teammate = candidates.find((c) => c.parent_session_id !== null);
      const pick = teammate ?? candidates[0]!;
      return { id: pick.id, backfillClaudeId: anyClaudeId, strategy: 'unclaimed-cwd' };
    }
  }

  return null;
};

export const hookEventRoutes = async (app: FastifyInstance) => {
  // Receive hook events from Claude Code
  // These bypass PIN auth (localhost only, fired by Claude Code process)
  app.post<{ Body: HookEventBody }>(
    '/api/hook-event',
    { logLevel: 'warn' as const },
    async (request) => {
      const body = request.body ?? ({} as HookEventBody);
      const event = body.event ?? 'unknown';
      const transcriptPath = body.data?.transcript_path;

      console.log(`[hook] ${event}${transcriptPath ? ` → ${transcriptPath.split('/').pop()}` : ''}`);

      if (transcriptPath && transcriptPath.endsWith('.jsonl')) {
        fileWatcherService.watchSpecificFile(transcriptPath);

        const match = resolveSessionRow(body);
        if (match) {
          hookMatchStats[match.strategy] += 1;
          const db = getDb();
          const sets: string[] = ['transcript_path = ?', "updated_at = datetime('now')"];
          const values: unknown[] = [transcriptPath];
          if (match.backfillClaudeId) {
            sets.push('claude_session_id = ?');
            values.push(match.backfillClaudeId);
          }
          values.push(match.id);

          const updated = db.prepare(
            `UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`,
          ).run(...values);

          const shortId = match.id.slice(0, 30);
          const transcriptName = transcriptPath.split('/').pop();
          const backfillNote = match.backfillClaudeId ? ' (backfilled claude_session_id)' : '';
          console.log(
            `[hook-event] session=${shortId} matched via ${match.strategy} transcript=${transcriptName}${backfillNote}`,
          );
          // The cwd-tiebreaker path is a last-resort guess; surface it as a
          // warning so ambiguous PM+teammate routing is visible in logs.
          if (match.strategy === 'unclaimed-cwd') {
            console.warn(
              `[hook-event] WARN: cwd-fallback for session=${shortId} — ambiguous match; backfilling claude_session_id=${match.backfillClaudeId}`,
            );
          }

          if (updated.changes > 0) {
            const session = sessionService.getSession(match.id);
            if (session) eventBus.emitSessionUpdated(session);
          }
        } else {
          hookMatchStats.skipped += 1;
          console.warn(
            `[hook-event] WARN: no match for hook event cwd=${body.data?.cwd ?? '?'} claudeSessionId=${body.sessionId ?? '?'} transcript=${transcriptPath.split('/').pop()}`,
          );
        }
      }

      eventBus.emitSystemEvent(`hook:${event}`, body);
      return { ok: true };
    },
  );
};
