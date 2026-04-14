import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';

export const teammatesRoutes = async (app: FastifyInstance) => {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/teammates',
    { logLevel: 'warn' as const },
    async (request) => {
      return sessionService.listTeammates(request.params.id);
    },
  );
};
