import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { projects } from '../db/schema';

export interface ProjectRow {
  id: string;
  name: string;
  identityFilePath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Find or create a project row keyed by the cwd of a Claude Code session.
 *
 * N2 uses cwd as `identity_file_path` stand-in — real `.commander.json`
 * identity-file creation lands N4 per KB-P1.5. For now the field uniquely
 * identifies a project by its absolute working-directory path. Migration is
 * a one-shot UPDATE once the identity file lands; the column stays the same.
 *
 * Returns the row — caller needn't branch on create-vs-found.
 */
export async function ensureProjectByCwd(db: CommanderDb, cwd: string): Promise<ProjectRow> {
  const existing = await db.query.projects.findFirst({
    where: eq(projects.identityFilePath, cwd),
  });
  if (existing) return existing as ProjectRow;

  const id = randomUUID();
  const name = basename(cwd) || cwd;
  await db.insert(projects).values({
    id,
    name,
    identityFilePath: cwd,
  });

  const created = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!created) throw new Error(`project insert for cwd=${cwd} returned no row`);
  return created as ProjectRow;
}

export async function listProjects(db: CommanderDb): Promise<ProjectRow[]> {
  const rows = await db.query.projects.findMany();
  return rows as ProjectRow[];
}

export async function getProjectById(db: CommanderDb, id: string): Promise<ProjectRow | null> {
  const row = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  return (row as ProjectRow | undefined) ?? null;
}
