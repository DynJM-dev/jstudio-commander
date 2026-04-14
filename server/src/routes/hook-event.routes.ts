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

// Resolve the Commander sessions row that owns this hook event. Tries four
// strategies in order so PM + teammate flows both converge on the correct
// row without a separate polling loop. Once matched, backfills
// claude_session_id + transcript_path on the row so future events match via
// the fast path (strategy 1).
const resolveSessionRow = (
  body: HookEventBody,
): { id: string; backfillClaudeId: string | null } | null => {
  const db = getDb();
  const claudeId =
    body.sessionId ?? (body.data?.transcript_path ? uuidFromTranscriptPath(body.data.transcript_path) : null);
  const cwd = body.data?.cwd;

  // 1. Fast path — a row already knows its Claude UUID.
  if (claudeId) {
    const row = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?').get(claudeId) as { id: string } | undefined;
    if (row) return { id: row.id, backfillClaudeId: null };
  }

  // 2. The session's Commander id IS the Claude UUID (pattern we use for the
  // PM: team config's leadSessionId is stored as sessions.id). Backfill
  // claude_session_id so subsequent events hit strategy 1.
  if (claudeId) {
    const row = db.prepare('SELECT id, claude_session_id FROM sessions WHERE id = ?').get(claudeId) as
      | { id: string; claude_session_id: string | null }
      | undefined;
    if (row) {
      return { id: row.id, backfillClaudeId: row.claude_session_id ? null : claudeId };
    }
  }

  // 3. Unclaimed row in the same cwd — prefer teammate rows (parent_session_id
  // set) that have not yet been linked. This is the path that lets coder-9's
  // hook finally attach to the coder-9 sessions row instead of colliding with
  // the PM's. If exactly one candidate remains after filtering, claim it.
  if (cwd && claudeId) {
    const candidates = db.prepare(
      `SELECT id, parent_session_id FROM sessions
       WHERE project_path = ? AND status != 'stopped' AND claude_session_id IS NULL
       ORDER BY parent_session_id IS NULL ASC, updated_at DESC`
    ).all(cwd) as Array<{ id: string; parent_session_id: string | null }>;

    if (candidates.length === 1) {
      return { id: candidates[0]!.id, backfillClaudeId: claudeId };
    }
    if (candidates.length > 1) {
      // Multiple unlinked teammates share this cwd — preserve the existing
      // cwd-based linkage for the first seen (legacy behavior) rather than
      // guess. On the next event we'll have one fewer candidate and match.
      const teammate = candidates.find((c) => c.parent_session_id !== null);
      if (teammate) return { id: teammate.id, backfillClaudeId: claudeId };
      return { id: candidates[0]!.id, backfillClaudeId: claudeId };
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

          if (updated.changes > 0) {
            console.log(
              `[hook] linked ${transcriptPath.split('/').pop()} → session ${match.id.slice(0, 30)}${match.backfillClaudeId ? ' (new claude_session_id)' : ''}`,
            );
            // Broadcast so the frontend sees the updated session row (and can
            // re-query chat/stats against the newly-linked transcript).
            const session = sessionService.getSession(match.id);
            if (session) eventBus.emitSessionUpdated(session);
          }
        } else {
          console.log(`[hook] no match for ${transcriptPath.split('/').pop()} (cwd=${body.data?.cwd ?? '?'})`);
        }
      }

      eventBus.emitSystemEvent(`hook:${event}`, body);
      return { ok: true };
    },
  );
};
