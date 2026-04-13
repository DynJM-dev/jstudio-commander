import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../middleware/pin-auth.js';

export const authRoutes = async (app: FastifyInstance) => {
  app.post<{ Body: { pin: string } }>('/api/auth/verify-pin', async (request) => {
    const { pin } = request.body ?? {};
    const config = loadConfig();

    if (!config.pin) {
      return { valid: true };
    }

    return { valid: pin === config.pin };
  });
};
