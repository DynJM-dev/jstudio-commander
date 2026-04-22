// GET /api/projects/:id/file?name=STATE.md — read one of the four canonical
// files for a project (STATE.md / DECISIONS.md / PROJECT_DOCUMENTATION.md /
// CLAUDE.md). File-absent returns 200 with {exists: false} so the drawer can
// render a placeholder without treating it as an error.
//
// Name is constrained to the four-file allowlist — no arbitrary path read,
// no traversal.

import type { FastifyPluginAsync } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import type { InitializedDb } from '@jstudio-commander/db';
import { projects } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';

export const ALLOWED_PROJECT_FILES = [
  'STATE.md',
  'DECISIONS.md',
  'PROJECT_DOCUMENTATION.md',
  'CLAUDE.md',
] as const;
export type ProjectFileName = (typeof ALLOWED_PROJECT_FILES)[number];

export const projectRoutes = (db: InitializedDb): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string }; Querystring: { name?: string } }>(
    '/api/projects/:id/file',
    async (req, reply) => {
      const name = req.query.name;
      if (!name || !ALLOWED_PROJECT_FILES.includes(name as ProjectFileName)) {
        reply.code(400);
        return { error: 'invalid_name', allowed: ALLOWED_PROJECT_FILES };
      }
      const row = await db.drizzle
        .select()
        .from(projects)
        .where(eq(projects.id, req.params.id))
        .get();
      if (!row) {
        reply.code(404);
        return { error: 'not_found' };
      }
      // normalize guards against any trailing slash oddity; name is constrained
      // to the allowlist so no traversal vector.
      const absolute = normalize(join(row.path, name));
      try {
        const st = await stat(absolute);
        const content = await readFile(absolute, 'utf8');
        return {
          exists: true,
          name,
          path: absolute,
          content,
          mtime: st.mtimeMs,
          size: st.size,
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return { exists: false, name, path: absolute };
        }
        throw err;
      }
    },
  );

  app.get('/api/projects', async () => {
    const rows = await db.drizzle.select().from(projects);
    return { projects: rows };
  });
};
