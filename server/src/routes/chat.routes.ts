import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { jsonlParserService } from '../services/jsonl-parser.service.js';
import { jsonlDiscoveryService } from '../services/jsonl-discovery.service.js';
import { tokenTrackerService } from '../services/token-tracker.service.js';

export const chatRoutes = async (app: FastifyInstance) => {
  // Get parsed chat messages for a session
  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string; offset?: string };
  }>('/api/chat/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const limit = parseInt(request.query.limit ?? '200', 10);
    const offset = parseInt(request.query.offset ?? '0', 10);

    const db = getDb();
    const session = db.prepare('SELECT project_path, transcript_path FROM sessions WHERE id = ?')
      .get(sessionId) as { project_path: string | null; transcript_path: string | null } | undefined;

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (!session.project_path) {
      return reply.status(400).send({ error: 'Session has no project path — cannot locate JSONL files' });
    }

    // Use stored transcript_path from hooks (exact file), fall back to discovery
    const jsonlFile = session.transcript_path ?? jsonlDiscoveryService.findLatestSessionFile(session.project_path);
    if (!jsonlFile) {
      return { messages: [], total: 0 };
    }

    const allMessages = jsonlParserService.parseFile(jsonlFile);
    const total = allMessages.length;
    const paginated = allMessages.slice(offset, offset + limit);

    return { messages: paginated, total };
  });

  // Token/cost stats for a session's conversation
  app.get<{ Params: { sessionId: string } }>(
    '/api/chat/:sessionId/stats',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const { sessionId } = request.params;

      const db = getDb();
      const session = db.prepare('SELECT id, project_path, transcript_path FROM sessions WHERE id = ?')
        .get(sessionId) as { id: string; project_path: string | null; transcript_path: string | null } | undefined;

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      if (!session.project_path) {
        return { totalTokens: 0, totalCost: 0, byModel: {} };
      }

      const jsonlFile = session.transcript_path ?? jsonlDiscoveryService.findLatestSessionFile(session.project_path);
      if (!jsonlFile) {
        return { totalTokens: 0, totalCost: 0, byModel: {} };
      }

      const allMessages = jsonlParserService.parseFile(jsonlFile);
      const usageEntries = tokenTrackerService.extractUsage(allMessages);

      const byModel: Record<string, { tokens: number; cost: number }> = {};
      let totalTokens = 0;
      let totalCost = 0;

      for (const entry of usageEntries) {
        const tokens = entry.usage.inputTokens + entry.usage.outputTokens;
        const cost = tokenTrackerService.calculateCost(entry.model, entry.usage);
        totalTokens += tokens;
        totalCost += cost;

        if (!byModel[entry.model]) byModel[entry.model] = { tokens: 0, cost: 0 };
        byModel[entry.model]!.tokens += tokens;
        byModel[entry.model]!.cost += cost;
      }

      return { totalTokens, totalCost, byModel };
    },
  );
};
