import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';
import { statusPollerService } from '../services/status-poller.service.js';

export const teammatesRoutes = async (app: FastifyInstance) => {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/teammates',
    { logLevel: 'warn' as const },
    async (request) => {
      // Phase J — attach the poller's last cached activity per teammate so
      // split-pane / sidebar renders get live "Ruminating 1m 49s · 430 tokens"
      // without a fresh tmux capture-pane per teammate per request.
      const teammates = sessionService.listTeammates(request.params.id);
      return teammates.map((t) => ({
        ...t,
        activity: statusPollerService.getCachedActivity(t.id) ?? null,
      }));
    },
  );
};
