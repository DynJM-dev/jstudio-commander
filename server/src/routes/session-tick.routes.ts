import type { FastifyInstance } from 'fastify';
import type { StatuslineRawPayload } from '@commander/shared';
import { sessionTickService } from '../services/session-tick.service.js';

// Phase M — `POST /api/session-tick`. Commander's statusline forwarder
// (see packages/statusline/statusline.mjs) pipes a Claude Code tick
// payload to this endpoint every ~300ms.
//
// Security: bound to 127.0.0.1 at the socket level via a per-request
// guard. Claude Code launches the forwarder from the user's own session,
// so loopback is the only origin we ever accept. We DON'T require PIN
// auth here — hooks execute with no session state and would fail the
// header check.
//
// Shape: permissive — Claude Code versions omit `rate_limits`
// (<v1.2.80), `exceeds_200k_tokens` (<v2.1.90), and rotate new keys in
// continuously. We accept any JSON object; `session-tick.service.ingest`
// normalizes it with optional-chaining fallbacks.
const isLoopback = (ip: string | undefined): boolean => {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

export const sessionTickRoutes = async (app: FastifyInstance) => {
  app.post<{ Body: unknown }>(
    '/api/session-tick',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      if (!isLoopback(request.ip)) {
        return reply.status(403).send({ error: 'loopback only' });
      }
      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'expected JSON object' });
      }
      const tick = sessionTickService.ingest(body as StatuslineRawPayload);
      if (!tick) return reply.status(202).send({ ok: true, dropped: true });
      return reply.send({ ok: true, sessionId: tick.commanderSessionId });
    },
  );

  // Convenience GET so the client can hydrate the latest tick on mount
  // without waiting for the next statusline fire (otherwise a freshly
  // opened tab sees nothing for up to 300ms).
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/tick',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const tick = sessionTickService.getLatestForSession(request.params.sessionId);
      if (!tick) return reply.status(404).send({ error: 'no tick yet' });
      return tick;
    },
  );
};
