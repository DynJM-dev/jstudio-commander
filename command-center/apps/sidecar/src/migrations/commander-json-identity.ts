import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from '@commander/shared';
import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { hookEvents, projects, sessions, tasks, workspaces } from '../db/schema';

/**
 * T1 migration — KB-P1.5 identity-file pattern.
 *
 * **Before N4:** `projects.identity_file_path` stored the project's cwd as a
 * naked directory path (e.g. `/Users/jose/Desktop/test-proj`). Fine for N2's
 * auto-create-by-cwd but KB-P1.5 specifies a proper identity file at
 * `<project-root>/.commander.json` containing the project UUID. Survives
 * folder renames / moves / machine transfers because the file is inside the
 * project.
 *
 * **After N4:** identity_file_path points at `<cwd>/.commander.json` and the
 * file on disk contains `{"project_id": "<uuid>"}`. Frontend + future
 * "Open Folder" flow read the file to resolve the existing project.
 *
 * **Discipline (OS §20.LL-L16 persist-before-destructive-action, MUST per
 * dispatch §4):** per-row atomic write via tmp + rename(2). If the write
 * fails we do NOT update the DB column — the row stays at the pre-migration
 * shape and next boot retries. DB + filesystem never disagree.
 *
 * **Idempotent:** a row whose identity_file_path already ends in
 * `.commander.json` is skipped. Safe to re-run on every boot.
 *
 * **Deleted-on-disk handling** (dispatch §7 — DB row for a cwd that no
 * longer exists): we cannot create `.commander.json` inside a missing
 * directory without resurrecting the dir (surprise side-effect). Skip
 * these rows + log warn + count in the summary. Idempotent-in-outcome:
 * the row stays at old shape across boots. **Noted as deviation §4 D1
 * from dispatch §7's "mark with deleted_on_disk flag OR schema-preserving
 * equivalent"** — the schema-preserving equivalent I chose is "leave
 * unchanged" since any sentinel-in-column approach (e.g. `DELETED:<path>`)
 * would require every consumer of identity_file_path to know about the
 * sentinel, which is worse than just leaving the path unchanged and
 * filtering at the query layer if needed.
 */

export interface CommanderIdentityFile {
  project_id: string;
  schema_version: 1;
}

export interface MigrationSummary {
  total_rows: number;
  migrated: number;
  already_migrated: number;
  skipped_deleted_on_disk: number;
  /**
   * **N4a.1 H3 addition.** Count of rows that collided with an already-
   * migrated canonical row (same cwd) AND had zero dependents (tasks +
   * workspaces). These duplicates were DELETED during migration — a safe
   * cleanup of the pre-N4a.1 `ensureProjectByCwd` bug that could create
   * post-migration raw-cwd rows. A forensic `system:migration-dedup` row
   * is appended to `hook_events` for each dedup.
   */
  deduplicated: number;
  failed: number;
  failures: Array<{ projectId: string; path: string; error: string }>;
}

/** Sentinel session ID for system-origin hook_events (migration dedup forensics, etc). */
export const SYSTEM_BOOT_SESSION_ID = 'system-boot';

/**
 * Seed the `system-boot` sentinel session row idempotently. `hook_events`
 * has a NOT NULL FK to `sessions(id)` — system-origin events (like the
 * migration-dedup forensic trail) need a valid session to reference. One
 * sentinel per DB lifetime, created on first migration run, persists across
 * boots.
 */
export async function ensureSystemBootSession(db: CommanderDb): Promise<void> {
  await db
    .insert(sessions)
    .values({
      id: SYSTEM_BOOT_SESSION_ID,
      cwd: '<system>',
      status: 'completed',
    })
    .onConflictDoNothing();
}

/**
 * Append a system-origin hook event referencing the sentinel session.
 * Used for forensic trails (migration dedup, future system-level events).
 * Caller is responsible for ensuring `ensureSystemBootSession` has run.
 */
async function appendSystemEvent(
  db: CommanderDb,
  eventName: string,
  payload: unknown,
): Promise<void> {
  await db.insert(hookEvents).values({
    id: randomUUID(),
    sessionId: SYSTEM_BOOT_SESSION_ID,
    eventName,
    payloadJson: payload,
  });
}

/**
 * Run the migration to completion. Returns a summary. On any atomic-write
 * failure, that row's failure is recorded but the migration proceeds with
 * the next row. Caller (index.ts boot) decides whether to halt based on
 * summary.failed > 0 + the context.
 */
export async function migrateIdentityFiles(
  db: CommanderDb,
  logger?: Logger,
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    total_rows: 0,
    migrated: 0,
    already_migrated: 0,
    skipped_deleted_on_disk: 0,
    deduplicated: 0,
    failed: 0,
    failures: [],
  };

  // H3: seed the sentinel session once before any per-row work so the
  // forensic hook_events insert in the dedup branch can't fail on FK.
  await ensureSystemBootSession(db);

  const rows = await db.query.projects.findMany();
  summary.total_rows = rows.length;

  for (const row of rows) {
    const currentPath = row.identityFilePath;

    // Idempotent short-circuit: already points at an .commander.json file.
    if (currentPath.endsWith('/.commander.json') || basename(currentPath) === '.commander.json') {
      summary.already_migrated += 1;
      continue;
    }

    // currentPath is a directory. Check if it exists on disk.
    if (!existsSync(currentPath)) {
      summary.skipped_deleted_on_disk += 1;
      logger?.warn(
        { projectId: row.id, path: currentPath },
        'identity migration: directory missing — skipping (row unchanged, next boot retries)',
      );
      continue;
    }

    // Build the target file path + identity body.
    const targetFile = join(currentPath, '.commander.json');

    // H3 pre-collision check: does a canonical row already exist at
    // targetFile? If yes, we're in a dedup scenario — a prior migration
    // created the canonical, then the pre-N4a.1 `ensureProjectByCwd` bug
    // inserted a duplicate at raw-cwd form. Handle without touching disk
    // (the .commander.json on disk retains canonical's project_id + body).
    const canonical = await db.query.projects.findFirst({
      where: eq(projects.identityFilePath, targetFile),
    });
    if (canonical && canonical.id !== row.id) {
      const depTasks = await db.query.tasks.findMany({
        where: eq(tasks.projectId, row.id),
      });
      const depWorkspaces = await db.query.workspaces.findMany({
        where: eq(workspaces.projectId, row.id),
      });
      const dependentCount = depTasks.length + depWorkspaces.length;

      if (dependentCount === 0) {
        // Safe dedup: drop the zero-dependent duplicate, keep canonical.
        await db.delete(projects).where(eq(projects.id, row.id));
        await appendSystemEvent(db, 'system:migration-dedup', {
          dropped_project_id: row.id,
          cwd: currentPath,
          canonical_project_id: canonical.id,
          reason: 'post-migration-duplicate-from-ensureProjectByCwd-pre-N4a.1',
        });
        summary.deduplicated += 1;
        logger?.warn(
          { droppedId: row.id, canonicalId: canonical.id, cwd: currentPath },
          'identity migration: deduplicated zero-dependent duplicate row',
        );
      } else {
        // Dependents present — manual merge required. Record as failure;
        // caller halts on summary.failed > 0. We do NOT auto-merge because
        // merging tasks/workspaces across project IDs needs human judgment.
        summary.failed += 1;
        const message = `UNIQUE collision with dependents — manual merge required: dropped=${row.id} canonical=${canonical.id}`;
        summary.failures.push({ projectId: row.id, path: currentPath, error: message });
        logger?.error(
          {
            droppedId: row.id,
            canonicalId: canonical.id,
            cwd: currentPath,
            depTasks: depTasks.length,
            depWorkspaces: depWorkspaces.length,
          },
          'identity migration: UNIQUE collision WITH dependents — halt required',
        );
      }
      continue;
    }

    const identity: CommanderIdentityFile = { project_id: row.id, schema_version: 1 };
    const body = `${JSON.stringify(identity, null, 2)}\n`;
    const tmpFile = `${targetFile}.tmp`;

    // Atomic write per OS §20.LL-L16: write tmp → rename → update DB.
    // A failure in any step aborts this row without torn state on disk
    // (rename is atomic on POSIX) or in DB (we only update AFTER the
    // file write landed successfully).
    try {
      // Ensure parent dir exists (should, since existsSync passed, but
      // defensive against race with concurrent deletion).
      await mkdir(currentPath, { recursive: true });
      await writeFile(tmpFile, body, 'utf8');
      await rename(tmpFile, targetFile);

      await db
        .update(projects)
        .set({ identityFilePath: targetFile })
        .where(eq(projects.id, row.id));

      summary.migrated += 1;
      logger?.info(
        { projectId: row.id, from: currentPath, to: targetFile },
        'identity migration: row migrated',
      );
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.failures.push({ projectId: row.id, path: currentPath, error: message });
      logger?.error(
        { err, projectId: row.id, path: currentPath },
        'identity migration: atomic write failed — row NOT updated (next boot retries)',
      );
      // Best-effort tmp cleanup — if rename failed, tmp may still exist.
      // Ignore cleanup errors.
      try {
        await mkdir(currentPath, { recursive: true }); // ensure parent still there
        const tmpExists = existsSync(tmpFile);
        if (tmpExists) {
          const { unlink } = await import('node:fs/promises');
          await unlink(tmpFile).catch(() => undefined);
        }
      } catch {
        // noop
      }
    }
  }

  return summary;
}

/**
 * Boot-time entry point. Runs the migration + logs the summary. Returns
 * true if the migration was successful (including idempotent no-ops and
 * skipped-deleted cases). Returns false if any row failed the atomic write
 * — caller decides whether to halt or continue.
 */
export async function migrateIdentityFilesOnBoot(
  db: CommanderDb,
  logger: Logger,
): Promise<boolean> {
  logger.info({}, 'identity migration: starting');
  const summary = await migrateIdentityFiles(db, logger);
  logger.info(
    {
      total: summary.total_rows,
      migrated: summary.migrated,
      already: summary.already_migrated,
      skipped_deleted: summary.skipped_deleted_on_disk,
      deduplicated: summary.deduplicated,
      failed: summary.failed,
    },
    summary.failed === 0
      ? 'identity migration: complete'
      : 'identity migration: completed with failures',
  );
  return summary.failed === 0;
}
