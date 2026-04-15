import type { FastifyInstance } from 'fastify';
import { cityStateService } from '../services/city-state.service.js';

export const cityRoutes = async (app: FastifyInstance): Promise<void> => {
  // Single-shot snapshot for the gamified city view (#214). Cheap one-DB-hit
  // aggregation — pair with the existing session/teammate WS events for
  // push-driven refreshes instead of polling.
  app.get('/api/city/state', async (_request, reply) => {
    const snapshot = cityStateService.getSnapshot();
    return reply.send(snapshot);
  });
};
