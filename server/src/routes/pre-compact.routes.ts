// Phase Q — pre-compact assistant exposure.
//
// Two endpoints:
//   GET  /api/pre-compact/status              → full state snapshot
//   PATCH /api/pre-compact/sessions/:id       → update autoCompactEnabled
//
// Both are loopback-only for now — the state machine fires against
// live tmux panes, and we don't want any LAN caller toggling a PM's
// opt-out or listing every session's context %.

import type { FastifyInstance } from 'fastify';
import type { PreCompactStatusSnapshot } from '@commander/shared';
import { isLoopbackIp } from '../config.js';
import { preCompactService } from '../services/pre-compact.service.js';
import { sessionService } from '../services/session.service.js';

export const preCompactRoutes = async (app: FastifyInstance) => {
  app.get('/api/pre-compact/status', async (request, reply) => {
    if (!isLoopbackIp(request.ip)) {
      return reply.status(403).send({ error: 'loopback only' });
    }
    const snapshot: PreCompactStatusSnapshot = {
      sessions: preCompactService.getSnapshot(),
    };
    return snapshot;
  });

  app.patch<{ Params: { id: string }; Body: { autoCompactEnabled?: boolean } }>(
    '/api/pre-compact/sessions/:id',
    async (request, reply) => {
      if (!isLoopbackIp(request.ip)) {
        return reply.status(403).send({ error: 'loopback only' });
      }
      const { autoCompactEnabled } = request.body ?? {};
      if (typeof autoCompactEnabled !== 'boolean') {
        return reply.status(400).send({ error: 'autoCompactEnabled (boolean) is required' });
      }
      const existing = sessionService.getSession(request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const updated = sessionService.upsertSession({
        id: request.params.id,
        autoCompactEnabled,
      });
      return updated;
    },
  );
};
