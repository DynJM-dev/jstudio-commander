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
    const session = db.prepare('SELECT project_path FROM sessions WHERE id = ?')
      .get(sessionId) as { project_path: string | null } | undefined;

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    if (!session.project_path) {
      return reply.status(400).send({ error: 'Session has no project path — cannot locate JSONL files' });
    }

    const jsonlFile = jsonlDiscoveryService.findLatestSessionFile(session.project_path);
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
    async (request, reply) => {
      const { sessionId } = request.params;

      const db = getDb();
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?')
        .get(sessionId) as { id: string } | undefined;

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return tokenTrackerService.aggregateBySession(sessionId);
    },
  );
};
