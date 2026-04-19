import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { ChatMessage } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { jsonlParserService } from '../services/jsonl-parser.service.js';
import { tokenTrackerService } from '../services/token-tracker.service.js';

// Transcript list is stored as JSON text in the sessions table; parse + drop
// any paths whose file doesn't exist on disk anymore (handles manually-
// deleted JSONLs without crashing the chat endpoint). Returns both the
// validated list and a flag telling the client we haven't seen a hook yet.
interface ResolvedTranscripts {
  paths: string[];
  awaitingFirstTurn: boolean;
}

const resolveTranscripts = (rawJson: string | null | undefined): ResolvedTranscripts => {
  if (!rawJson) return { paths: [], awaitingFirstTurn: true };
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); } catch { return { paths: [], awaitingFirstTurn: true }; }
  if (!Array.isArray(parsed)) return { paths: [], awaitingFirstTurn: true };
  const filtered = parsed.filter((p): p is string => typeof p === 'string' && existsSync(p));

  // Issue 11 — dedup by basename at read time too. Pre-fix rows may
  // carry two case-diverged paths pointing at the same JSONL
  // (see sessionService.appendTranscriptPath). Reading both would
  // double every message in chat. First basename wins; equivalent
  // paths are dropped. Legitimate rotation (different UUIDs per
  // file) is unaffected.
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const p of filtered) {
    const b = basename(p);
    if (seen.has(b)) continue;
    seen.add(b);
    paths.push(p);
  }
  return { paths, awaitingFirstTurn: paths.length === 0 };
};

// Exported test hook — the dedup behavior is unit-tested against the
// pure function. Not part of the public API.
export const resolveTranscriptsForTest = resolveTranscripts;

const concatTranscripts = (paths: string[]): ChatMessage[] => {
  const out: ChatMessage[] = [];
  for (const p of paths) {
    try {
      const msgs = jsonlParserService.parseFile(p);
      for (const m of msgs) out.push(m);
    } catch {
      // A single corrupt file shouldn't take down the whole stream.
      console.warn(`[chat] failed to parse transcript ${p}`);
    }
  }
  return out;
};

export const chatRoutes = async (app: FastifyInstance) => {
  // Chat messages — concatenates every JSONL this session owns in order.
  // ?since=<msgId> (#216) returns only messages strictly AFTER the message
  // with that id; the client uses this for tail-delta polling so a
  // 200-message session no longer ships the full transcript every 1.5s.
  // Unknown id falls back to the tail-window default — assumes the client
  // is stale and a full re-sync is the safe response.
  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string; since?: string };
  }>('/api/chat/:sessionId', { logLevel: 'warn' as const }, async (request, reply) => {
    const { sessionId } = request.params;
    const limit = parseInt(request.query.limit ?? '200', 10);
    const offset = parseInt(request.query.offset ?? '0', 10);
    const since = request.query.since;

    const db = getDb();
    const session = db.prepare(
      'SELECT project_path, transcript_paths FROM sessions WHERE id = ?'
    ).get(sessionId) as { project_path: string | null; transcript_paths: string | null } | undefined;

    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const { paths, awaitingFirstTurn } = resolveTranscripts(session.transcript_paths);
    if (paths.length === 0) {
      return { messages: [], total: 0, awaitingFirstTurn };
    }

    const all = concatTranscripts(paths);
    const total = all.length;

    if (since) {
      const idx = all.findIndex((m) => m.id === since);
      if (idx >= 0) {
        // Strictly after the cursor message. Empty array is the steady
        // state when nothing has happened since the last poll.
        return { messages: all.slice(idx + 1), total, awaitingFirstTurn };
      }
      // Unknown cursor → fall through to default tail behavior so the
      // client recovers from a stale id with a clean full re-sync.
    }

    // offset=0 default returns the LAST `limit` messages (tail) so realtime
    // chat shows the freshest tool calls/responses. load-older uses offset.
    const paginated = offset === 0 && total > limit
      ? all.slice(total - limit)
      : all.slice(offset, offset + limit);

    return { messages: paginated, total, awaitingFirstTurn };
  });

  // Token/cost stats. contextTokens resets past the last compact_boundary.
  app.get<{ Params: { sessionId: string } }>(
    '/api/chat/:sessionId/stats',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const { sessionId } = request.params;

      const db = getDb();
      const session = db.prepare(
        'SELECT id, transcript_paths FROM sessions WHERE id = ?'
      ).get(sessionId) as { id: string; transcript_paths: string | null } | undefined;

      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const { paths } = resolveTranscripts(session.transcript_paths);
      if (paths.length === 0) {
        return { totalTokens: 0, totalCost: 0, contextTokens: 0, contextCost: 0, byModel: {} };
      }

      const allMessages = concatTranscripts(paths);

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
