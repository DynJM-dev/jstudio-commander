import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.0 — regression guard for the Stop-hook → idle flip.
//
// The production path lives in hook-event.routes.processHook. It consults
// getDb() and eventBus; we mirror the SQL behavior here against an
// in-memory DB so the invariant (Stop hook flips status to idle) is
// pinned without booting Fastify.
//
// Invariants:
//   1. A session currently 'working' whose Stop hook resolves → flipped to 'idle'.
//   2. Non-Stop events (PostToolUse, etc.) do NOT flip status (only the
//      existing hook processing applies).
//   3. When resolveOwner returns null (unroutable event), the flip
//      is skipped — no DB write, no exceptions.
//   4. The update writes updated_at, not just status, so the row shows
//      fresh in list queries.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT '2000-01-01 00:00:00'
    );
  `);
};

// Mirrors the Stop-hook branch added to processHook. Takes a resolved
// session id (or null to simulate resolveOwner failure) and the hook
// event name; returns {flipped} so tests can assert the DB state.
const stopHookFlip = (
  db: Database.Database,
  event: string,
  resolvedId: string | null,
): { flipped: boolean } => {
  if (event !== 'Stop') return { flipped: false };
  if (!resolvedId) return { flipped: false };
  const result = db.prepare(
    "UPDATE sessions SET status = 'idle', updated_at = datetime('now') WHERE id = ?",
  ).run(resolvedId);
  return { flipped: result.changes > 0 };
};

describe('Stop hook → idle — Phase N.0', () => {
  test("Stop event on a 'working' session flips status to 'idle'", () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'working')").run('pm-1');

    const r = stopHookFlip(db, 'Stop', 'pm-1');
    assert.equal(r.flipped, true);

    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-1') as { status: string };
    assert.equal(row.status, 'idle');
    db.close();
  });

  test("Stop event on a 'waiting' session flips to 'idle' (turn ended mid-prompt)", () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'waiting')").run('pm-2');

    stopHookFlip(db, 'Stop', 'pm-2');
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-2') as { status: string };
    assert.equal(row.status, 'idle');
    db.close();
  });

  test('non-Stop hook events do NOT touch status via this branch', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'working')").run('pm-3');

    const r = stopHookFlip(db, 'PostToolUse', 'pm-3');
    assert.equal(r.flipped, false);
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-3') as { status: string };
    assert.equal(row.status, 'working');
    db.close();
  });

  test('Stop event with unresolved owner (null id) is a no-op, no throw', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'working')").run('pm-4');

    const r = stopHookFlip(db, 'Stop', null);
    assert.equal(r.flipped, false);
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-4') as { status: string };
    assert.equal(row.status, 'working');
    db.close();
  });

  test("Stop flip bumps updated_at so list queries show the row as fresh", () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, status, updated_at) VALUES (?, 'working', '2020-01-01 00:00:00')",
    ).run('pm-5');

    stopHookFlip(db, 'Stop', 'pm-5');
    const row = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get('pm-5') as { updated_at: string };
    // datetime('now') is a current-timestamp ISO-like string; ensure it's
    // not the stale 2020 value and is a plausible 10+-char datetime.
    assert.notEqual(row.updated_at, '2020-01-01 00:00:00');
    assert.ok(row.updated_at.length >= 10);
    db.close();
  });
});
