import type { FastifyPluginAsync } from 'fastify';
import type { CommanderDb } from '../db/client';
import { requireBearerOrTauriOrigin } from '../middleware/auth';
import { lastHookEvent, recentHookEvents } from '../services/hook-events';
import { runHookPipeline } from '../services/hook-pipeline';
import type { WsBus } from '../services/ws-bus';

export interface ApiRoutesOpts {
  db: CommanderDb;
  bus: WsBus;
  expectedToken: string;
}

/**
 * Frontend-facing API surface for the Preferences Debug + Plugin tabs.
 *
 * - `GET  /api/recent-events` — returns the most recent N hook events for the
 *   Debug tab. Powers acceptance 2.2 ("Recent hook events" panel) + 2.7
 *   ("Plugin detected" status flip — a row within the last 10 min = detected).
 * - `POST /api/events/replay` — smoke-only button per dispatch §2.3. Fetches
 *   the last persisted hook event and re-posts it through the same pipeline;
 *   de-dupe must block the insert, so the total row count stays unchanged
 *   (verified by the Debug panel's recent-count not growing).
 *
 * Bearer auth required unless origin is a Tauri webview (default behavior in
 * the running `Command Center.app`). Auth check via shared middleware.
 */
export const apiRoutes: FastifyPluginAsync<ApiRoutesOpts> = async (app, opts) => {
  const auth = requireBearerOrTauriOrigin({ expectedToken: opts.expectedToken });

  await app.register(async (scoped) => {
    scoped.addHook('preHandler', auth);

    scoped.get('/api/recent-events', async (req) => {
      const query = req.query as Record<string, unknown>;
      const rawLimit = query.limit;
      const rawSince = query.since;
      const limit =
        typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(500, Number.parseInt(rawLimit, 10))
          : 50;
      const sinceIso = typeof rawSince === 'string' ? rawSince : undefined;

      const rows = await recentHookEvents(opts.db, { limit, sinceIso });
      return {
        ok: true,
        data: {
          count: rows.length,
          events: rows,
        },
      };
    });

    scoped.post('/api/events/replay', async (_req, reply) => {
      const last = await lastHookEvent(opts.db);
      if (!last) {
        reply.status(404);
        return {
          ok: false,
          error: {
            code: 'NO_EVENTS',
            message: 'hook_events table is empty — trigger at least one event first',
          },
        };
      }
      // Feed the exact raw payload back through the pipeline. De-dupe should
      // block the insert (acceptance 2.3) — we return the pipeline response
      // so the caller can see the typical `{continue:true}` envelope.
      const response = await runHookPipeline(
        { db: opts.db, bus: opts.bus, logger: app.log },
        last.eventName,
        last.payloadJson,
      );
      return {
        ok: true,
        data: {
          replayedEventId: last.id,
          replayedEventName: last.eventName,
          pipelineResponse: response,
        },
      };
    });
  });
};
