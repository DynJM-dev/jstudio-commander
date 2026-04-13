import type { FastifyInstance } from 'fastify';
import { tunnelService } from '../services/tunnel.service.js';

export const tunnelRoutes = async (app: FastifyInstance) => {
  app.post('/api/tunnel/start', async (_request, reply) => {
    try {
      const url = await tunnelService.start();
      return { url };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start tunnel';
      return reply.status(500).send({ error: message });
    }
  });

  app.post('/api/tunnel/stop', async () => {
    tunnelService.stop();
    return { success: true };
  });

  app.get('/api/tunnel/status', async () => {
    return tunnelService.getStatus();
  });
};
