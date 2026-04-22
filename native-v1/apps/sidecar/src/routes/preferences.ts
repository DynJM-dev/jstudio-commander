// GET/PUT /api/preferences/:key — typed key/value store per ARCHITECTURE_SPEC
// v1.2 §10 preferences table. Scope defaults to 'global' on writes that don't
// specify a scope.

import type { FastifyPluginAsync } from 'fastify';
import type { InitializedDb } from '@jstudio-commander/db';
import { preferences } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';

interface PrefPut {
  value: string;
  scope?: 'global' | 'session' | 'project';
  scopeId?: string;
}

export const preferencesRoutes = (db: InitializedDb): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { key: string } }>('/api/preferences/:key', async (req, reply) => {
    const row = await db.drizzle
      .select()
      .from(preferences)
      .where(eq(preferences.key, req.params.key))
      .get();
    if (!row) {
      reply.code(404);
      return { error: 'not_found', key: req.params.key };
    }
    return row;
  });

  app.put<{ Params: { key: string }; Body: PrefPut }>('/api/preferences/:key', async (req) => {
    const now = Date.now();
    const row = {
      key: req.params.key,
      value: req.body.value,
      scope: req.body.scope ?? ('global' as const),
      scopeId: req.body.scopeId ?? null,
      updatedAt: new Date(now),
    };
    await db.drizzle
      .insert(preferences)
      .values(row)
      .onConflictDoUpdate({
        target: preferences.key,
        set: { value: row.value, scope: row.scope, scopeId: row.scopeId, updatedAt: row.updatedAt },
      });
    return { ok: true, key: req.params.key };
  });
};
