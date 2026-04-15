import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';

export const maintenanceRoutes = async (app: FastifyInstance): Promise<void> => {
  app.delete('/api/sessions/cleanup', async (_request, reply) => {
    try {
      const deleted = sessionService.cleanupStaleTeammates();
      return reply.send({ deleted });
    } catch (err) {
      app.log.error({ err }, '[maintenance] cleanupStaleTeammates failed');
      return reply.status(500).send({ error: 'cleanup_failed' });
    }
  });
};
