import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';

export const sessionRoutes = async (app: FastifyInstance) => {
  // List all sessions
  app.get('/api/sessions', async () => {
    return sessionService.listSessions();
  });

  // Get single session
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionService.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Create session
  app.post<{ Body: { name?: string; projectPath?: string; model?: string } }>(
    '/api/sessions',
    async (request, reply) => {
      try {
        const session = sessionService.createSession(request.body ?? {});
        return reply.status(201).send(session);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create session';
        return reply.status(500).send({ error: message });
      }
    },
  );

  // Delete session
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionService.deleteSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Send command to session
  app.post<{ Params: { id: string }; Body: { command: string } }>(
    '/api/sessions/:id/command',
    async (request, reply) => {
      const { command } = request.body ?? {};
      if (!command) {
        return reply.status(400).send({ error: 'command is required' });
      }

      const result = sessionService.sendCommand(request.params.id, command);
      if (!result.success) {
        const status = result.error === 'Session not found' ? 404 : 400;
        return reply.status(status).send({ error: result.error });
      }
      return { success: true };
    },
  );

  // Get live session status
  app.get<{ Params: { id: string } }>('/api/sessions/:id/status', async (request, reply) => {
    const result = sessionService.getSessionStatus(request.params.id);
    if (!result) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return result;
  });

  // Update session (rename, change model)
  app.patch<{ Params: { id: string }; Body: { name?: string; model?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const session = sessionService.updateSession(request.params.id, request.body ?? {});
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return session;
    },
  );
};
