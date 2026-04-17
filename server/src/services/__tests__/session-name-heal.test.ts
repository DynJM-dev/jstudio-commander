// Phase S.1 Patch 2 regression — mirror of
// sessionService.healLegacySessionNameTmuxTargets against an
// in-memory SQLite with an injectable paneResolver, matching the
// sentinel-collision-heal pattern. No tmux server required.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const createSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      tmux_session TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'idle',
      stopped_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

// Mirrors healLegacySessionNameTmuxTargets with a swap-in pane
// resolver so the test can script the outcome per tmux_session.
const healTmuxTargets = (
  db: Database.Database,
  resolvePaneId: (sessionName: string) => string | null,
): { healed: string[]; stopped: string[] } => {
  const rows = db.prepare(
    `SELECT id, name, tmux_session FROM sessions
     WHERE status != 'stopped'
       AND tmux_session NOT LIKE '\\%%' ESCAPE '\\'
       AND tmux_session NOT LIKE 'retired:%'
       AND tmux_session NOT LIKE 'agent:%'`,
  ).all() as Array<{ id: string; name: string; tmux_session: string }>;
  const healed: string[] = [];
  const stopped: string[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    const paneId = resolvePaneId(r.tmux_session);
    if (paneId) {
      db.prepare('UPDATE sessions SET tmux_session = ?, updated_at = ? WHERE id = ?')
        .run(paneId, now, r.id);
      healed.push(r.id);
    } else {
      db.prepare(
        "UPDATE sessions SET status = 'stopped', stopped_at = COALESCE(stopped_at, ?), updated_at = ? WHERE id = ?",
      ).run(now, now, r.id);
      stopped.push(r.id);
    }
  }
  return { healed, stopped };
};

describe('healLegacySessionNameTmuxTargets', () => {
  test('session-name rows with live panes are healed → pane id', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('a', 'ovagas-pm', 'jsc-aaaa1111', 'working')").run();
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('b', 'other-pm',  'jsc-bbbb2222', 'idle')").run();

    // Scripted resolver: both sessions have panes.
    const resolver = (name: string): string | null =>
      name === 'jsc-aaaa1111' ? '%58' : name === 'jsc-bbbb2222' ? '%72' : null;

    const result = healTmuxTargets(db, resolver);
    assert.deepEqual(result.healed.sort(), ['a', 'b']);
    assert.deepEqual(result.stopped, []);

    const rows = db.prepare('SELECT id, tmux_session, status FROM sessions ORDER BY id').all() as Array<{
      id: string; tmux_session: string; status: string;
    }>;
    assert.equal(rows[0]!.tmux_session, '%58');
    assert.equal(rows[1]!.tmux_session, '%72');
    assert.ok(rows.every((r) => r.status !== 'stopped'));
    db.close();
  });

  test('session-name rows with no live pane → stopped (tmux session gone)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('gone', 'ghost', 'jsc-gggg3333', 'idle')").run();

    const result = healTmuxTargets(db, () => null);
    assert.deepEqual(result.healed, []);
    assert.deepEqual(result.stopped, ['gone']);

    const row = db.prepare('SELECT tmux_session, status, stopped_at FROM sessions WHERE id = ?').get('gone') as {
      tmux_session: string; status: string; stopped_at: string | null;
    };
    // tmux_session is preserved (historical record) — the row is just
    // flipped to stopped so the poller won't keep probing a ghost.
    assert.equal(row.tmux_session, 'jsc-gggg3333');
    assert.equal(row.status, 'stopped');
    assert.ok(row.stopped_at);
    db.close();
  });

  test('skips rows already in pane-id / retired: / agent: shape', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('p', 'pane', '%99', 'idle')").run();
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('r', 'retired', 'retired:zzz', 'stopped')").run();
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('a', 'agent', 'agent:qqq', 'idle')").run();

    let resolverCalls = 0;
    const result = healTmuxTargets(db, () => { resolverCalls += 1; return null; });
    assert.equal(resolverCalls, 0, 'resolver should not fire for already-valid shapes');
    assert.deepEqual(result.healed, []);
    assert.deepEqual(result.stopped, []);

    const rows = db.prepare('SELECT id, tmux_session, status FROM sessions ORDER BY id').all() as Array<{
      id: string; tmux_session: string; status: string;
    }>;
    assert.deepEqual(rows.map((r) => `${r.id}=${r.tmux_session}`).sort(), [
      'a=agent:qqq',
      'p=%99',
      'r=retired:zzz',
    ]);
    db.close();
  });

  test('skips already-stopped rows even when the value looks healable', () => {
    // A stopped row with a legacy `jsc-*` tmux_session is historical
    // state — the pane may be dead and we don't want the heal flipping
    // its tmux_session mid-stop. (Matches the `status != 'stopped'`
    // filter in the production query.)
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('dead', 'x', 'jsc-zzzz0000', 'stopped')").run();

    const resolver = () => '%42'; // even if resolver returns a pane,
    const result = healTmuxTargets(db, resolver);
    assert.deepEqual(result.healed, []);
    assert.deepEqual(result.stopped, []);

    const row = db.prepare('SELECT tmux_session, status FROM sessions WHERE id = ?').get('dead') as {
      tmux_session: string; status: string;
    };
    assert.equal(row.tmux_session, 'jsc-zzzz0000');
    assert.equal(row.status, 'stopped');
    db.close();
  });

  test('idempotent — second run finds nothing to heal', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, name, tmux_session, status) VALUES ('a', 'x', 'jsc-11112222', 'working')").run();

    const first = healTmuxTargets(db, () => '%58');
    assert.deepEqual(first.healed, ['a']);

    // Second call — the row's tmux_session is now `%58`, which matches
    // the NOT LIKE '%%' ESCAPE clause and is excluded from the heal
    // candidate set. Resolver must not be invoked.
    let calls = 0;
    const second = healTmuxTargets(db, () => { calls += 1; return null; });
    assert.equal(calls, 0);
    assert.deepEqual(second.healed, []);
    assert.deepEqual(second.stopped, []);
    db.close();
  });
});
