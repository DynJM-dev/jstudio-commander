// GET /api/projects/:id/file?name=STATE.md — read one of the four canonical
// files for a project (STATE.md / DECISIONS.md / PROJECT_DOCUMENTATION.md /
// CLAUDE.md). File-absent returns 200 with {exists: false} so the drawer can
// render a placeholder without treating it as an error.
//
// GET /api/projects/scan?root=~/Desktop/Projects/ — N2.1 — one-level-deep
// directory listing + a lightweight project-type heuristic; backs the
// ProjectPathPicker's "Projects" section.
//
// Name is constrained to the four-file allowlist — no arbitrary path read,
// no traversal.

import type { FastifyPluginAsync } from 'fastify';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

  app.get<{ Querystring: { root?: string } }>('/api/projects/scan', async (req, reply) => {
    const root = expandHome(req.query.root ?? '~/Desktop/Projects/');
    if (!existsSync(root)) {
      return { root, entries: [], exists: false };
    }
    try {
      const names = await readdir(root);
      const entries: ScannedProject[] = [];
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const absolute = join(root, name);
        let s;
        try {
          s = await stat(absolute);
        } catch {
          continue;
        }
        if (!s.isDirectory()) continue;
        entries.push({
          name,
          path: absolute,
          detectedType: detectProjectType(absolute),
          mtime: s.mtimeMs,
        });
      }
      entries.sort((a, b) => b.mtime - a.mtime);
      return { root, entries, exists: true };
    } catch (err) {
      reply.code(500);
      return { error: 'scan_failed', message: (err as Error).message };
    }
  });
};

interface ScannedProject {
  name: string;
  path: string;
  detectedType: string | null;
  mtime: number;
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

// Best-effort project-type heuristic. Returns a short label or null.
// Intentionally cheap — one readFile on package.json, a few existsSync
// checks. No deep traversal. Aligns with dispatch §3 Task 3 "keep it simple".
export function detectProjectType(projectPath: string): string | null {
  if (existsSync(join(projectPath, 'supabase'))) return 'Supabase';
  if (existsSync(join(projectPath, 'firebase.json'))) return 'Firebase';
  if (existsSync(join(projectPath, 'src-tauri'))) return 'Tauri';
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next']) return 'Next.js';
      if (deps['react']) return 'React';
      if (deps['vue']) return 'Vue';
      if (deps['@sveltejs/kit'] || deps['svelte']) return 'Svelte';
      if (deps['express'] || deps['fastify']) return 'Node API';
      return 'Node';
    } catch {
      return null;
    }
  }
  if (existsSync(join(projectPath, 'Cargo.toml'))) return 'Rust';
  if (existsSync(join(projectPath, 'pyproject.toml'))) return 'Python';
  if (existsSync(join(projectPath, 'go.mod'))) return 'Go';
  return null;
}
