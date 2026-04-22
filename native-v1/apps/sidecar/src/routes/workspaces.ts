// GET + PUT /api/workspaces/current — read/write the user's current
// workspace layout per N2 §1.5. Named workspaces deferred to N4 (schema
// already supports them via workspaces.name + isCurrent).
//
// Layout is stored as a single JSON blob in workspaces.layoutJson rather
// than materialized into workspace_panes rows for N2. Rationale in
// PHASE_N2_REPORT §4: the N2 layout model is a flat panes[]+ratios[]
// structure (Task 4); 1-3 rows in workspace_panes would duplicate what fits
// cleanly in one JSON field with no query benefit. workspace_panes remains
// available for any N3+ feature that needs relational access to pane slots
// (e.g., bulk drawer-state query across panes).

import type { FastifyPluginAsync } from 'fastify';
import type { InitializedDb } from '@jstudio-commander/db';
import { workspaces } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';

interface PutWorkspaceBody {
  layoutJson: string; // serialized WorkspaceLayout from the frontend store
}

export const workspaceRoutes = (db: InitializedDb): FastifyPluginAsync => async (app) => {
  app.get('/api/workspaces/current', async () => {
    const row = await db.drizzle
      .select()
      .from(workspaces)
      .where(eq(workspaces.isCurrent, true))
      .get();
    if (row) {
      return { workspace: row };
    }
    // First launch — seed a default workspace so subsequent writes have a
    // target. layoutJson left as JSON of the default 1-pane layout; the
    // frontend treats empty panes as "pane exists, no session yet."
    const now = new Date();
    const seed = {
      id: crypto.randomUUID(),
      name: 'default',
      layoutJson: JSON.stringify({ panes: [{ sessionId: null }], ratios: [1], focusedIndex: 0 }),
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.drizzle.insert(workspaces).values(seed).run();
    return { workspace: seed };
  });

  app.put<{ Body: PutWorkspaceBody }>('/api/workspaces/current', async (req, reply) => {
    const { layoutJson } = req.body ?? {};
    if (typeof layoutJson !== 'string') {
      reply.code(400);
      return { error: 'layoutJson_required' };
    }
    // Validate it parses — never store malformed JSON in the column.
    try {
      JSON.parse(layoutJson);
    } catch {
      reply.code(400);
      return { error: 'layoutJson_invalid' };
    }
    const current = await db.drizzle
      .select()
      .from(workspaces)
      .where(eq(workspaces.isCurrent, true))
      .get();
    if (!current) {
      // First write without a prior GET — seed then update.
      const now = new Date();
      const seed = {
        id: crypto.randomUUID(),
        name: 'default',
        layoutJson,
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      };
      await db.drizzle.insert(workspaces).values(seed).run();
      return { workspace: seed };
    }
    const now = new Date();
    await db.drizzle
      .update(workspaces)
      .set({ layoutJson, updatedAt: now })
      .where(eq(workspaces.id, current.id))
      .run();
    return { workspace: { ...current, layoutJson, updatedAt: now } };
  });
};
