// Issue 13 — stopped-session retention service.
//
// Contract pinned here:
//   - Only top-level sessions (`parent_session_id IS NULL`) are
//     purge-eligible. Teammate rows are handled by the existing
//     cleanupStaleTeammates path (7-day cadence).
//   - Only `status='stopped' AND stopped_at < now - RETENTION_DAYS`
//     sessions are candidates. Every other status is untouched.
//   - Dry-run mode counts-only; must not write any DELETE.
//   - Hand-roll cleanup of child tables that are ON DELETE SET NULL
//     rather than CASCADE (cost_entries, skill_usage, notifications,
//     session_ticks). Cascade coverage gap documented in PHASE_REPORT.
//   - Backup NDJSON file written before real deletes so the action
//     is rollback-able via `sqlite3 -cmd "... INSERT ..."` reapply.
//   - Idempotent: running twice leaves the second run a no-op.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-retention-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { getDb, closeDb } = await import('../../db/connection.js');
const { sessionService } = await import('../session.service.js');
const { retentionService } = await import('../retention.service.js');

getDb();

after(() => {
  closeDb();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seedSession = (opts: { status?: string; stoppedDaysAgo?: number; parent?: string }) => {
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'retention-test',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: (opts.status ?? 'stopped') as 'idle' | 'working' | 'waiting' | 'stopped' | 'error',
    ...(opts.parent !== undefined ? { parentSessionId: opts.parent } : {}),
  });
  // Seed stopped_at retroactively via raw SQL since upsertSession
  // doesn't take it.
  if (opts.stoppedDaysAgo !== undefined) {
    getDb().prepare(
      "UPDATE sessions SET stopped_at = datetime('now', ?) WHERE id = ?",
    ).run(`-${opts.stoppedDaysAgo} days`, id);
  }
  return id;
};

const wipe = () => {
  const db = getDb();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM session_events').run();
};

test('dry-run: reports what WOULD delete, makes no changes', () => {
  wipe();
  const oldId = seedSession({ stoppedDaysAgo: 45 });
  const newId = seedSession({ stoppedDaysAgo: 5 });
  const activeId = seedSession({ status: 'idle', stoppedDaysAgo: 100 /* ignored since not stopped */ });

  const result = retentionService.purgeStopped({ retentionDays: 30, dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.wouldDelete, 1, 'only the 45-day stopped session is purge-eligible');
  assert.equal(result.deleted, 0);
  // All rows still present
  assert.ok(sessionService.getSession(oldId), 'dry-run keeps the candidate');
  assert.ok(sessionService.getSession(newId));
  assert.ok(sessionService.getSession(activeId));
});

test('real purge: removes only stopped sessions older than retentionDays', () => {
  wipe();
  const toDeleteId = seedSession({ stoppedDaysAgo: 45 });
  const toKeepRecentId = seedSession({ stoppedDaysAgo: 10 });
  const activeId = seedSession({ status: 'idle' });
  const workingOldId = seedSession({ status: 'working', stoppedDaysAgo: 90 });

  const result = retentionService.purgeStopped({ retentionDays: 30, dryRun: false });

  assert.equal(result.deleted, 1);
  assert.equal(sessionService.getSession(toDeleteId), null, 'old stopped → gone');
  assert.ok(sessionService.getSession(toKeepRecentId), 'recent stopped → kept');
  assert.ok(sessionService.getSession(activeId), 'active → untouched');
  assert.ok(sessionService.getSession(workingOldId), 'working (non-stopped) → untouched regardless of age');
});

test('teammate rows excluded (parent_session_id IS NOT NULL → skip)', () => {
  // Issue 13 is about top-level session accumulation. Teammate rows
  // are handled by cleanupStaleTeammates elsewhere; retention must
  // not double-purge them (different cadence = 7 days vs. 30 days).
  wipe();
  const parentId = seedSession({ status: 'idle' }); // active parent
  const teammateId = seedSession({ stoppedDaysAgo: 45, parent: parentId });

  const result = retentionService.purgeStopped({ retentionDays: 30, dryRun: false });

  assert.equal(result.deleted, 0, 'teammate not touched by top-level purge');
  assert.ok(sessionService.getSession(teammateId));
});

test('idempotent: second run is a no-op', () => {
  wipe();
  seedSession({ stoppedDaysAgo: 45 });
  seedSession({ stoppedDaysAgo: 45 });

  const first = retentionService.purgeStopped({ retentionDays: 30, dryRun: false });
  assert.equal(first.deleted, 2);

  const second = retentionService.purgeStopped({ retentionDays: 30, dryRun: false });
  assert.equal(second.deleted, 0, 'nothing left to purge');
});

test('writes backup NDJSON before hard delete (real-mode only)', () => {
  wipe();
  const id = seedSession({ stoppedDaysAgo: 45 });

  const result = retentionService.purgeStopped({
    retentionDays: 30,
    dryRun: false,
    backupPath: join(tmpDataDir, 'purge.jsonl'),
  });
  assert.equal(result.deleted, 1);
  assert.ok(existsSync(join(tmpDataDir, 'purge.jsonl')));
  const backup = readFileSync(join(tmpDataDir, 'purge.jsonl'), 'utf-8');
  const lines = backup.trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]!);
  assert.equal(row.id, id);
});

test('dry-run writes NO backup file', () => {
  wipe();
  seedSession({ stoppedDaysAgo: 45 });
  const backupPath = join(tmpDataDir, 'dryrun.jsonl');
  retentionService.purgeStopped({ retentionDays: 30, dryRun: true, backupPath });
  assert.equal(existsSync(backupPath), false);
});

test('retentionDays=0 purges even 1-day-old stopped (edge, still respects status)', () => {
  // Edge: some operator wants "clean every stopped row on boot". 0
  // retention with a row that stopped >0 days ago qualifies. Active
  // rows still untouched regardless.
  wipe();
  const stoppedYesterday = seedSession({ stoppedDaysAgo: 1 });
  const active = seedSession({ status: 'idle' });
  retentionService.purgeStopped({ retentionDays: 0, dryRun: false });
  assert.equal(sessionService.getSession(stoppedYesterday), null);
  assert.ok(sessionService.getSession(active));
});

test('candidate rows with NULL stopped_at treated as "unknown → not eligible"', () => {
  // Defensive: a row stuck at status='stopped' but no stopped_at
  // shouldn't get purged on faith. Leave it for the boot-heal path
  // to investigate.
  wipe();
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'no-stopped-at',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'stopped',
  });
  // stopped_at stays NULL — no UPDATE

  const result = retentionService.purgeStopped({ retentionDays: 0, dryRun: false });
  assert.equal(result.deleted, 0);
  assert.ok(sessionService.getSession(id));
});
