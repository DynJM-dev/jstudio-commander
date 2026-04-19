import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';

// Issue 13 — stopped-session retention. Auto-purge top-level sessions
// that have been in `status='stopped'` for more than `retentionDays`
// days. Teammate rows (parent_session_id IS NOT NULL) are purged by
// the existing `cleanupStaleTeammates` path (7-day cadence) and MUST
// NOT be double-handled here.
//
// §23.3 invariants enforced:
//   - Only status='stopped' eligible (never delete live sessions).
//   - Only parent_session_id IS NULL (top-level) eligible.
//   - Only stopped_at < now - retentionDays days eligible.
//   - NULL stopped_at → NOT eligible (defensive; leave for boot heal).
//
// Cascade gap (documented in PHASE_REPORT audit table): three child
// tables use ON DELETE SET NULL instead of CASCADE (cost_entries,
// skill_usage, notifications) and session_ticks has no FK at all.
// Hand-rolled DELETE for those tables runs inside the same
// transaction as the session DELETE so cascade-gap orphans don't
// accrete after purge.
//
// Safety: the optional `backupPath` argument writes each purged row
// to an NDJSON file BEFORE the transaction commits. Caller is
// responsible for choosing a path; real boot wiring uses
// `~/.jstudio-commander/purge-backup-<ISO>.jsonl`. Dry-run writes no
// backup (nothing to back up).
//
// Idempotent: running twice leaves the second run a no-op because
// the first run removed the eligible rows.

export interface PurgeOptions {
  retentionDays: number;
  dryRun: boolean;
  backupPath?: string;
}

export interface PurgeResult {
  dryRun: boolean;
  wouldDelete: number;
  deleted: number;
}

// Tables with session_id FKs that DO NOT CASCADE on parent delete.
// Hand-roll their cleanup before deleting the session row. This list
// should stay in sync with the schema audit; a comment block in
// server/src/db/schema.sql flags the tables as "cleaned by retention."
const HAND_ROLLED_CLEANUP_TABLES = [
  'cost_entries',
  'skill_usage',
  'notifications',
  'session_ticks',
  'hook_events',
] as const;

const findCandidates = (retentionDays: number): Array<{ id: string; row: string }> => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM sessions
     WHERE status = 'stopped'
       AND parent_session_id IS NULL
       AND stopped_at IS NOT NULL
       AND stopped_at < datetime('now', ?)`,
  ).all(`-${retentionDays} days`) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: r.id as string, row: JSON.stringify(r) }));
};

export const retentionService = {
  purgeStopped(opts: PurgeOptions): PurgeResult {
    const db = getDb();
    const candidates = findCandidates(opts.retentionDays);

    if (opts.dryRun) {
      return { dryRun: true, wouldDelete: candidates.length, deleted: 0 };
    }

    if (candidates.length === 0) {
      return { dryRun: false, wouldDelete: 0, deleted: 0 };
    }

    // Backup FIRST — writing the file is rollback evidence if the
    // DELETE transaction fails after partial child cleanup, and
    // it's cheap on a ~1MB-per-1000-rows scale.
    if (opts.backupPath) {
      mkdirSync(dirname(opts.backupPath), { recursive: true });
      const ndjson = candidates.map((c) => c.row).join('\n') + '\n';
      writeFileSync(opts.backupPath, ndjson);
    }

    // Hand-rolled child cleanup + session DELETE in one transaction
    // so a mid-purge crash leaves the DB consistent (either all rows
    // for a given session go, or none).
    let deleted = 0;
    const tx = db.transaction((ids: string[]) => {
      for (const id of ids) {
        for (const table of HAND_ROLLED_CLEANUP_TABLES) {
          try {
            db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
          } catch {
            // Table may not exist in older schemas; skip. Audit in
            // PHASE_REPORT lists which tables this is defensive about.
          }
        }
        // Cascade-covered children (session_events, token_usage,
        // file_watch_state, agent_relationships) drop automatically
        // via ON DELETE CASCADE when this row goes.
        const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
        if (result.changes > 0) deleted++;
      }
    });
    tx(candidates.map((c) => c.id));

    return { dryRun: false, wouldDelete: candidates.length, deleted };
  },

  // Wrapper used by boot + the 24h interval. Reads env config, picks
  // default backup path, formats the summary log line.
  runScheduled(): PurgeResult {
    const retentionDays = Number.parseInt(
      process.env.COMMANDER_RETENTION_DAYS ?? '30',
      10,
    );
    const dryRun = process.env.COMMANDER_RETENTION_DRY_RUN === '1';
    const backupPath = dryRun
      ? undefined
      : `${config.dataDir}/purge-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

    const result = this.purgeStopped({
      retentionDays: Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : 30,
      dryRun,
      ...(backupPath !== undefined ? { backupPath } : {}),
    });

    const suffix = dryRun ? '[DRY-RUN]' : '';
    if (result.wouldDelete > 0 || result.deleted > 0) {
      console.log(
        `[retention] ${suffix} retentionDays=${retentionDays} wouldDelete=${result.wouldDelete} deleted=${result.deleted}` +
        (backupPath ? ` backup=${backupPath}` : ''),
      );
    }
    return result;
  },
};
