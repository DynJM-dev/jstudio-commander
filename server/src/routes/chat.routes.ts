import type { FastifyInstance } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import { getDb } from '../db/connection.js';
import { jsonlParserService } from '../services/jsonl-parser.service.js';
import { jsonlDiscoveryService } from '../services/jsonl-discovery.service.js';
import { tokenTrackerService } from '../services/token-tracker.service.js';
import { rotationDetectorService } from '../services/rotation-detector.service.js';

const STALE_TRANSCRIPT_MS = 30_000;

// When the stored transcript_path is missing or hasn't grown in >30s, run
// the rotation detector synchronously so the HTTP response reflects the
// newest JSONL. Idempotent — only triggers on staleness, never on default
// path. Returns the (possibly updated) JSONL path.
const fallForwardJsonl = (
  sessionId: string,
  projectPath: string,
  currentPath: string | null,
): string | null => {
  const isStale = !currentPath || !existsSync(currentPath) || Date.now() - statSync(currentPath).mtime.getTime() > STALE_TRANSCRIPT_MS;
  if (!isStale) return currentPath;

  const db = getDb();
  const row = db.prepare(
    'SELECT id, project_path, claude_session_id, transcript_path, status FROM sessions WHERE id = ?',
  ).get(sessionId) as
    | { id: string; project_path: string; claude_session_id: string | null; transcript_path: string | null; status: string }
    | undefined;
  if (!row) return currentPath;

  // Cheap short-circuit: nothing in the cwd to bind to.
  const files = jsonlDiscoveryService.findSessionFiles(projectPath);
  if (files.length === 0) return currentPath;
  // HTTP fall-forward opts out of the sweep's status gate AND its freshness
  // window — the user is actively requesting this session's chat right now,
  // so even a currently-dormant but most-recent transcript should bind.
  // checkOne owns all the ranking + guard logic so this path stays thin.
  rotationDetectorService.checkOne(row, { requireActive: false, freshnessWindowMs: Infinity });
  const fresh = db.prepare('SELECT transcript_path FROM sessions WHERE id = ?').get(sessionId) as
    | { transcript_path: string | null }
    | undefined;
  return fresh?.transcript_path ?? currentPath;
};

export const chatRoutes = async (app: FastifyInstance) => {
  // Get parsed chat messages for a session (polled frequently — suppress logs)
  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string };
  }>('/api/chat/:sessionId', { logLevel: 'warn' as const }, async (request, reply) => {
    const { sessionId } = request.params;
    const limit = parseInt(request.query.limit ?? '200', 10);
    const offset = parseInt(request.query.offset ?? '0', 10);

    const db = getDb();
    const session = db.prepare(
      'SELECT project_path, transcript_path, created_at, parent_session_id FROM sessions WHERE id = ?'
    ).get(sessionId) as { project_path: string | null; transcript_path: string | null; created_at: string; parent_session_id: string | null } | undefined;

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (!session.project_path) {
      return reply.status(400).send({ error: 'Session has no project path — cannot locate JSONL files' });
    }

    // Use stored transcript_path from hooks (exact JSONL file for THIS session)
    let jsonlFile = session.transcript_path;

    // Fall-forward: if the tracked transcript is stale/missing, try to
    // adopt a newer JSONL in the same cwd. Writes the new path back to the
    // sessions row so subsequent requests hit the fast path. Respects the
    // teammate guard — teammates share cwd with their parent, so we never
    // adopt via this shortcut unless claude_session_id already pinned one.
    if (!session.parent_session_id) {
      jsonlFile = fallForwardJsonl(sessionId, session.project_path, jsonlFile);
    }

    // Legacy fallback for brand-new sessions that never had a transcript_path
    // bound. Kept for pre-hook sessions; narrower than fall-forward because
    // it picks anything newer than session creation.
    if (!jsonlFile && !session.parent_session_id) {
      const sessionCreated = new Date(session.created_at).getTime() - 5000;
      const files = jsonlDiscoveryService.findSessionFiles(session.project_path);
      const recentFile = files.find((f) => f.modifiedAt.getTime() >= sessionCreated);
      if (recentFile) {
        jsonlFile = recentFile.filePath;
        db.prepare('UPDATE sessions SET transcript_path = ? WHERE id = ?')
          .run(recentFile.filePath, sessionId);
      }
    }

    if (!jsonlFile) {
      return { messages: [], total: 0 };
    }

    const allMessages = jsonlParserService.parseFile(jsonlFile);
    const total = allMessages.length;

    // When offset=0 (default), return the LAST `limit` messages (most recent)
    // This ensures real-time chat always shows the latest tool calls/responses
    // For "load older" requests (offset > 0), paginate from the start
    const paginated = offset === 0 && total > limit
      ? allMessages.slice(total - limit)
      : allMessages.slice(offset, offset + limit);

    return { messages: paginated, total };
  });

  // Token/cost stats for a session's conversation
  app.get<{ Params: { sessionId: string } }>(
    '/api/chat/:sessionId/stats',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const { sessionId } = request.params;

      const db = getDb();
      const session = db.prepare(
        'SELECT id, project_path, transcript_path, created_at, parent_session_id FROM sessions WHERE id = ?'
      ).get(sessionId) as { id: string; project_path: string | null; transcript_path: string | null; created_at: string; parent_session_id: string | null } | undefined;

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      if (!session.project_path) {
        return { totalTokens: 0, totalCost: 0, contextTokens: 0, contextCost: 0, byModel: {} };
      }

      // Use stored transcript_path. Fall-forward when stale so stats reflect
      // the post-rotation JSONL even if no hook has fired yet.
      let jsonlFile = session.transcript_path;
      if (!session.parent_session_id) {
        jsonlFile = fallForwardJsonl(sessionId, session.project_path, jsonlFile);
      }
      if (!jsonlFile && !session.parent_session_id) {
        const sessionCreated = new Date(session.created_at).getTime() - 5000;
        const files = jsonlDiscoveryService.findSessionFiles(session.project_path);
        const recentFile = files.find((f) => f.modifiedAt.getTime() >= sessionCreated);
        jsonlFile = recentFile?.filePath ?? null;
      }
      if (!jsonlFile) {
        return { totalTokens: 0, totalCost: 0, contextTokens: 0, contextCost: 0, byModel: {} };
      }

      const allMessages = jsonlParserService.parseFile(jsonlFile);

      // Find the most recent compact_boundary. Usage from messages before it
      // no longer sits in Claude's context window — only what followed counts
      // toward "how close am I to the boundary?"
      let lastCompactIdx = -1;
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i]!;
        if (msg.role === 'system' && msg.content.some((b) => b.type === 'compact_boundary')) {
          lastCompactIdx = i;
          break;
        }
      }

      const byModel: Record<string, { tokens: number; cost: number }> = {};
      let totalTokens = 0;
      let totalCost = 0;
      let contextTokens = 0;
      let contextCost = 0;

      for (let i = 0; i < allMessages.length; i++) {
        const msg = allMessages[i]!;
        if (msg.role !== 'assistant' || !msg.usage || !msg.model) continue;
        const tokens = msg.usage.inputTokens + msg.usage.outputTokens;
        const cost = tokenTrackerService.calculateCost(msg.model, msg.usage);
        totalTokens += tokens;
        totalCost += cost;
        if (i > lastCompactIdx) {
          contextTokens += tokens;
          contextCost += cost;
        }
        if (!byModel[msg.model]) byModel[msg.model] = { tokens: 0, cost: 0 };
        byModel[msg.model]!.tokens += tokens;
        byModel[msg.model]!.cost += cost;
      }

      return { totalTokens, totalCost, contextTokens, contextCost, byModel };
    },
  );
};
