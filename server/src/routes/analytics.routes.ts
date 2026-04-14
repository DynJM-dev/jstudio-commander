import type { FastifyInstance } from 'fastify';
import { tokenTrackerService } from '../services/token-tracker.service.js';

export const analyticsRoutes = async (app: FastifyInstance) => {
  // Today's aggregate stats (polled frequently — suppress logs)
  app.get('/api/analytics/today', { logLevel: 'warn' as const }, async () => {
    return tokenTrackerService.aggregateDaily();
  });

  // Daily stats for last N days
  app.get<{ Querystring: { days?: string } }>('/api/analytics/daily', async (request) => {
    const days = parseInt(request.query.days ?? '30', 10);
    return tokenTrackerService.getDailyRange(days);
  });

  // Per-session cost breakdown
  app.get('/api/analytics/sessions', async () => {
    return tokenTrackerService.getSessionCosts();
  });

  // Per-project cost breakdown
  app.get('/api/analytics/projects', async () => {
    return tokenTrackerService.getProjectCosts();
  });
};
