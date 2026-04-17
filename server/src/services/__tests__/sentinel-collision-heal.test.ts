import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.2 — regression guard for the sentinel-collision class that
// crashed server boot:
//   SqliteError: UNIQUE constraint failed: sessions.tmux_session
//
// Root cause: resolveSentinelTargets() claimed a real tmux pane (%NN)
// for an orphan sentinel whose team config had been removed from disk,
// then the LIVE team-config reconcile tried to upsertTeammateSession
// with the same %NN → UNIQUE collision on INSERT.
//
// Fix (Option A — positive check): resolveSentinelTargets skips sentinel
// rows whose team_name references a team directory that no longer exists
// on disk. Pairs with healOrphanedTeamSessions (boot-time one-shot) that
// retires already-resolved orphan rows and frees their pane so live
// members can claim them on the next reconcile.
//
// The SQL behaviors are mirrored here against an in-memory DB with an
// injectable `teamExists` predicate so we don't have to touch the real
// `~/.claude/teams/` directory.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      tmux_session TEXT NOT NULL UNIQUE,
      project_path TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      stopped_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      team_name TEXT
    );
  `);
};

// Mirrors the post-N.2 resolveSentinelTargets gate. Simplified to the
// team-existence filter — pane matching + claimed-set logic is unchanged
// from the production path and not on the regression surface here.
const resolveSentinels = (
  db: Database.Database,
  panesByCwd: Map<string, string>, // cwd → paneId
  teamExists: (teamName: string | null) => boolean,
): { resolved: string[]; skipped: string[] } => {
  const sentinels = db.prepare(
    "SELECT id, project_path, team_name FROM sessions WHERE tmux_session LIKE 'agent:%' AND project_path IS NOT NULL"
  ).all() as Array<{ id: string; project_path: string; team_name: string | null }>;
  const claimed = new Set(
    (db.prepare("SELECT tmux_session FROM sessions WHERE tmux_session LIKE '\\%%' ESCAPE '\\'").all() as Array<{ tmux_session: string }>)
      .map((r) => r.tmux_session),
  );
  const resolved: string[] = [];
  const skipped: string[] = [];
  for (const s of sentinels) {
    if (s.team_name && !teamExists(s.team_name)) {
      skipped.push(s.id);
      continue;
    }
    const paneId = panesByCwd.get(s.project_path);
    if (!paneId || claimed.has(paneId)) continue;
    db.prepare("UPDATE sessions SET tmux_session = ?, updated_at = datetime('now') WHERE id = ?")
      .run(paneId, s.id);
    claimed.add(paneId);
    resolved.push(s.id);
  }
  return { resolved, skipped };
};

// Mirrors the post-N.2 healOrphanedTeamSessions boot-time one-shot.
const healOrphans = (
  db: Database.Database,
  teamExists: (teamName: string | null) => boolean,
): { healed: string[] } => {
  const rows = db.prepare(
    "SELECT id, team_name, tmux_session, status FROM sessions WHERE team_name IS NOT NULL AND team_name != ''"
  ).all() as Array<{ id: string; team_name: string; tmux_session: string; status: string }>;
  const healed: string[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    if (teamExists(r.team_name)) continue;
    if (r.status === 'stopped' && r.tmux_session.startsWith('retired:')) continue;
    const freedPane = r.tmux_session.startsWith('%') ? `retired:${r.id}` : r.tmux_session;
    db.prepare(
      `UPDATE sessions
       SET team_name = NULL,
           status = 'stopped',
           stopped_at = COALESCE(stopped_at, ?),
           updated_at = ?,
           tmux_session = ?
       WHERE id = ?`
    ).run(now, now, freedPane, r.id);
    healed.push(r.id);
  }
  return { healed };
};

describe('resolveSentinelTargets — Phase N.2 team-exists gate', () => {
  test('sentinel whose team config exists → resolves to the matching pane', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, team_name) VALUES (?, ?, ?, ?, ?)"
    ).run('live-1', 'coder', 'agent:live-1', '/repo/live', 'live-team');

    const panes = new Map<string, string>([['/repo/live', '%42']]);
    const { resolved, skipped } = resolveSentinels(db, panes, (t) => t === 'live-team');

    assert.deepEqual(resolved, ['live-1']);
    assert.deepEqual(skipped, []);
    const row = db.prepare('SELECT tmux_session FROM sessions WHERE id = ?').get('live-1') as { tmux_session: string };
    assert.equal(row.tmux_session, '%42');
    db.close();
  });

  test('sentinel whose team config is missing on disk → skipped, pane left free', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, team_name) VALUES (?, ?, ?, ?, ?)"
    ).run('orphan-1', 'zombie', 'agent:orphan-1', '/repo/shared', 'ovagas-ui');

    const panes = new Map<string, string>([['/repo/shared', '%59']]);
    const { resolved, skipped } = resolveSentinels(db, panes, (_t) => false);

    assert.deepEqual(resolved, []);
    assert.deepEqual(skipped, ['orphan-1']);
    const row = db.prepare('SELECT tmux_session FROM sessions WHERE id = ?').get('orphan-1') as { tmux_session: string };
    assert.equal(row.tmux_session, 'agent:orphan-1'); // unchanged
    db.close();
  });

  test('UNIQUE-collision regression: orphan gated out → live sentinel can claim the shared pane without crash', () => {
    const db = new Database(':memory:');
    createSchema(db);
    // Two rows, same project_path, both sentinels. The orphan belongs to a
    // deleted team; the live row belongs to an existing team. Pre-N.2, the
    // orphan would claim %59 first and the live row's subsequent upsert
    // would UNIQUE-collide on tmux_session='%59'.
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, team_name) VALUES (?, ?, ?, ?, ?)"
    ).run('orphan-2', 'zombie', 'agent:orphan-2', '/repo/ovagas', 'ovagas-ui');
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, team_name) VALUES (?, ?, ?, ?, ?)"
    ).run('live-2', 'coder', 'agent:live-2', '/repo/ovagas', 'ovagas-r2');

    const panes = new Map<string, string>([['/repo/ovagas', '%59']]);
    const teamExists = (t: string | null) => t === 'ovagas-r2';

    // No throw — Option A gates the orphan out, so the live row claims %59.
    assert.doesNotThrow(() => resolveSentinels(db, panes, teamExists));

    const orphan = db.prepare('SELECT tmux_session FROM sessions WHERE id = ?').get('orphan-2') as { tmux_session: string };
    const live = db.prepare('SELECT tmux_session FROM sessions WHERE id = ?').get('live-2') as { tmux_session: string };
    assert.equal(orphan.tmux_session, 'agent:orphan-2'); // untouched
    assert.equal(live.tmux_session, '%59'); // resolved cleanly
    db.close();
  });
});

describe('healOrphanedTeamSessions — Phase N.2 boot-time cleanup', () => {
  test('orphan row with real pane → team_name NULL, status stopped, pane freed (retired:<id>)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, status, team_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('orphan-3', 'dead-coder', '%59', '/repo/old', 'idle', 'deleted-team');

    const { healed } = healOrphans(db, (_t) => false);
    assert.deepEqual(healed, ['orphan-3']);

    const row = db.prepare(
      'SELECT team_name, status, stopped_at, tmux_session FROM sessions WHERE id = ?'
    ).get('orphan-3') as {
      team_name: string | null;
      status: string;
      stopped_at: string | null;
      tmux_session: string;
    };
    assert.equal(row.team_name, null);
    assert.equal(row.status, 'stopped');
    assert.ok(row.stopped_at);
    assert.equal(row.tmux_session, 'retired:orphan-3');
    db.close();
  });

  test('live team row (config exists on disk) → untouched (negative case)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, status, team_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('live-3', 'active-coder', '%12', '/repo/active', 'working', 'live-team');

    const { healed } = healOrphans(db, (t) => t === 'live-team');
    assert.deepEqual(healed, []);

    const row = db.prepare(
      'SELECT team_name, status, tmux_session FROM sessions WHERE id = ?'
    ).get('live-3') as { team_name: string | null; status: string; tmux_session: string };
    assert.equal(row.team_name, 'live-team');
    assert.equal(row.status, 'working');
    assert.equal(row.tmux_session, '%12');
    db.close();
  });

  test('orphan whose pane is still a sentinel → team_name NULL + stopped but tmux_session preserved (no real pane to free)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, status, team_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('orphan-4', 'unresolved', 'agent:orphan-4', '/repo/old', 'stopped', 'deleted-team');

    const { healed } = healOrphans(db, (_t) => false);
    assert.deepEqual(healed, ['orphan-4']);

    const row = db.prepare(
      'SELECT team_name, status, tmux_session FROM sessions WHERE id = ?'
    ).get('orphan-4') as { team_name: string | null; status: string; tmux_session: string };
    assert.equal(row.team_name, null);
    assert.equal(row.status, 'stopped');
    assert.equal(row.tmux_session, 'agent:orphan-4'); // sentinel not touched
    db.close();
  });

  test('idempotent — first heal retires the row, second heal is a no-op', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, name, tmux_session, project_path, status, team_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('orphan-5', 'past-life', '%71', '/repo/gone', 'idle', 'deleted-team');

    const { healed: first } = healOrphans(db, (_t) => false);
    assert.deepEqual(first, ['orphan-5']);

    // After the first heal: team_name NULL, status stopped, tmux retired:orphan-5.
    // The early-exit condition (status=stopped + retired: prefix) now fires
    // regardless of the lingering team_name, so the second pass is a no-op.
    const { healed: second } = healOrphans(db, (_t) => false);
    assert.deepEqual(second, []);

    const row = db.prepare(
      'SELECT team_name, status, tmux_session FROM sessions WHERE id = ?'
    ).get('orphan-5') as { team_name: string | null; status: string; tmux_session: string };
    assert.equal(row.team_name, null);
    assert.equal(row.status, 'stopped');
    assert.equal(row.tmux_session, 'retired:orphan-5');
    db.close();
  });
});
