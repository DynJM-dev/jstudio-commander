import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { eq, or } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { projects } from '../db/schema';
import type { CommanderIdentityFile } from '../migrations/commander-json-identity';

export interface ProjectRow {
  id: string;
  name: string;
  identityFilePath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolve the project-root directory from a `projects.identity_file_path`
 * value (column semantic flipped in N4a T1). Back-compat for any row still
 * at pre-migration raw-cwd form: if the value doesn't end in
 * `.commander.json`, treat it as the dir itself. Keeps consumers (worktree
 * creation, cwd resolution, etc.) ignorant of the format flip.
 *
 * This is the preventative pattern for N4a.1 Debt 24 — anywhere we used to
 * read `project.identityFilePath` expecting a directory, route through
 * `resolveProjectRoot` so a future format flip doesn't trap us the same way.
 */
export function resolveProjectRoot(identityFilePath: string): string {
  if (basename(identityFilePath) === '.commander.json') {
    return dirname(identityFilePath);
  }
  return identityFilePath;
}

/**
 * Find or create a project row keyed by the cwd of a Claude Code session.
 *
 * **Post-N4a.1 dual-form lookup:** Look up by `<cwd>/.commander.json`
 * (post-migration canonical form) first; fall back to `<cwd>` (legacy
 * raw-cwd form) for any row that hasn't gone through T1 migration yet. This
 * is what prevents the "SessionStart in a migrated project creates a
 * duplicate row → next boot UNIQUE-violation halt" class of bug.
 *
 * **On create:** always insert at the canonical `<cwd>/.commander.json`
 * form AND atomically write the identity file on disk via tmp + rename
 * (OS §20.LL-L16). Ordering is file-first → DB-second (matches migration
 * semantics; DB never points at a non-existent file). If the DB insert
 * fails after the file write, a retry will overwrite the file with the new
 * project_id — no torn state (rename is atomic).
 *
 * Returns the row — caller needn't branch on create-vs-found.
 */
export async function ensureProjectByCwd(db: CommanderDb, cwd: string): Promise<ProjectRow> {
  const identityFile = join(cwd, '.commander.json');

  // Dual-form lookup: prefer post-migration canonical; fall back to legacy raw-cwd.
  const existing = await db.query.projects.findFirst({
    where: or(eq(projects.identityFilePath, identityFile), eq(projects.identityFilePath, cwd)),
  });
  if (existing) return existing as ProjectRow;

  const id = randomUUID();
  const name = basename(cwd) || cwd;

  // File-first atomic write per OS §20.LL-L16, **guarded on the cwd dir
  // already existing.** Do NOT auto-create `cwd` here — a non-existent cwd
  // means the caller handed us a synthetic path (fabricated hook payloads
  // in tests, stale session state, etc.) and resurrecting the dir would be
  // a surprise side-effect that breaks state isolation.
  //
  // Fallback for non-existent cwd: insert at raw-cwd form (legacy shape).
  // The T1 migration will upgrade this row to the canonical .commander.json
  // form on the next boot once the dir exists on disk. This matches the
  // migration's deleted-on-disk policy (§4 D1).
  //
  // **Concurrent-insert race guard:** two `ensureProjectByCwd(same-cwd)`
  // calls can both pass the initial SELECT (neither sees a row yet) and
  // both attempt to INSERT, hitting the UNIQUE constraint on
  // `projects_identity_path_unique`. On collision: re-query — the other
  // caller's row is now committed, return it. Idempotent in outcome.
  try {
    if (existsSync(cwd)) {
      const identity: CommanderIdentityFile = { project_id: id, schema_version: 1 };
      const body = `${JSON.stringify(identity, null, 2)}\n`;
      // Unique tmp per call — concurrent ensureProjectByCwd(sameCwd) calls
      // must not stomp each other's tmp file. Each call writes its own
      // `<identityFile>.<random>.tmp`, renames atomically to the shared
      // target. The LAST rename wins at the DB-insert race-guard layer.
      const tmpFile = `${identityFile}.${randomUUID()}.tmp`;

      await mkdir(cwd, { recursive: true }); // idempotent, defensive
      await writeFile(tmpFile, body, 'utf8');
      await rename(tmpFile, identityFile);

      await db.insert(projects).values({
        id,
        name,
        identityFilePath: identityFile,
      });
    } else {
      await db.insert(projects).values({
        id,
        name,
        identityFilePath: cwd,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/UNIQUE\s+constraint\s+failed.*identity_file_path/i.test(msg)) throw err;
    // Race lost: the other caller committed first. Re-query + return.
    const winner = await db.query.projects.findFirst({
      where: or(eq(projects.identityFilePath, identityFile), eq(projects.identityFilePath, cwd)),
    });
    if (!winner) throw err; // unexpected — surface the original error
    // File reconciliation: our writeFile+rename may have landed our id in
    // the `.commander.json` file while winner's DB row has a different id.
    // Re-write the file atomically with winner's id so disk matches DB.
    if (existsSync(cwd) && winner.identityFilePath.endsWith('/.commander.json')) {
      try {
        const winnerBody = `${JSON.stringify(
          { project_id: winner.id, schema_version: 1 } satisfies CommanderIdentityFile,
          null,
          2,
        )}\n`;
        const reconTmp = `${identityFile}.${randomUUID()}.tmp`;
        await writeFile(reconTmp, winnerBody, 'utf8');
        await rename(reconTmp, identityFile);
      } catch {
        // Best-effort reconciliation; migration will fix on next boot.
      }
    }
    return winner as ProjectRow;
  }

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
