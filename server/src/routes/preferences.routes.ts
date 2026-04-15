import type { FastifyInstance } from 'fastify';
import { preferencesService } from '../services/preferences.service.js';
import { rooms } from '../ws/rooms.js';

interface KeyParams { key: string }
interface ValueBody { value: unknown }

export const preferencesRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Params: KeyParams }>('/api/preferences/:key', async (request, reply) => {
    const value = preferencesService.get(request.params.key);
    if (value === null) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ key: request.params.key, value });
  });

  app.put<{ Params: KeyParams; Body: ValueBody }>('/api/preferences/:key', async (request, reply) => {
    if (!request.body || !('value' in request.body)) {
      return reply.status(400).send({ error: 'missing_value' });
    }
    preferencesService.set(request.params.key, request.body.value);
    rooms.broadcastAll({
      type: 'preference:changed',
      key: request.params.key,
      value: request.body.value,
    });
    return reply.send({ key: request.params.key, value: request.body.value });
  });

  app.delete<{ Params: KeyParams }>('/api/preferences/:key', async (request, reply) => {
    preferencesService.delete(request.params.key);
    rooms.broadcastAll({
      type: 'preference:changed',
      key: request.params.key,
      value: null,
    });
    return reply.send({ deleted: true });
  });
};
