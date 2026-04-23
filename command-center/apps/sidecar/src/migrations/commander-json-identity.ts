import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from '@commander/shared';
import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { projects } from '../db/schema';

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
  failed: number;
  failures: Array<{ projectId: string; path: string; error: string }>;
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
    failed: 0,
    failures: [],
  };

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
      failed: summary.failed,
    },
    summary.failed === 0
      ? 'identity migration: complete'
      : 'identity migration: completed with failures',
  );
  return summary.failed === 0;
}
