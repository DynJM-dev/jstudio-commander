// GET /api/session-types — consumed by the frontend NewSessionModal dropdown.
// Data is read from the session_types seed table (0002_seed_session_types.sql).

import type { FastifyPluginAsync } from 'fastify';
import type { InitializedDb } from '@jstudio-commander/db';
import { sessionTypes } from '@jstudio-commander/db';

export const sessionTypesRoutes = (db: InitializedDb): FastifyPluginAsync => async (app) => {
  app.get('/api/session-types', async () => {
    const rows = await db.drizzle.select().from(sessionTypes).orderBy(sessionTypes.sortOrder);
    return { sessionTypes: rows };
  });
};
