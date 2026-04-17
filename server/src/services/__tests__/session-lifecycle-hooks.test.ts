import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.0 Patch 4 — SessionStart + SessionEnd hook handlers.
//
// Production: hook-event.routes.processHook handles three lifecycle
// events (Stop → idle, SessionStart → working, SessionEnd → stopped)
// by going through resolveOwner + direct DB UPDATE + emitSessionStatus
// + bumpLastActivity. We mirror the SQL behavior here against an
// in-memory DB so each event's write semantics are pinned without
// booting Fastify.
//
// Invariants:
//   1. SessionStart on a known session → status='working' + updated_at bumped.
//   2. SessionStart on unknown session → no DB write (graceful skip).
//   3. SessionEnd on known session → status='stopped' + stopped_at set.
//   4. Neither event touches rows that don't match resolveOwner.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT '2000-01-01 00:00:00',
      stopped_at TEXT
    );
  `);
};

// Mirrors the SessionStart branch.
const sessionStartHandler = (
  db: Database.Database,
  resolvedId: string | null,
): { flipped: boolean } => {
  if (!resolvedId) return { flipped: false };
  const result = db.prepare(
    "UPDATE sessions SET status = 'working', updated_at = datetime('now') WHERE id = ?",
  ).run(resolvedId);
  return { flipped: result.changes > 0 };
};

// Mirrors the SessionEnd branch.
const sessionEndHandler = (
  db: Database.Database,
  resolvedId: string | null,
): { flipped: boolean } => {
  if (!resolvedId) return { flipped: false };
  const result = db.prepare(
    "UPDATE sessions SET status = 'stopped', stopped_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(resolvedId);
  return { flipped: result.changes > 0 };
};

describe('SessionStart hook — Phase N.0 Patch 4', () => {
  test('known session → status flips to working + updated_at bumped', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'idle')").run('pm-1');

    const r = sessionStartHandler(db, 'pm-1');
    assert.equal(r.flipped, true);

    const row = db.prepare('SELECT status, updated_at FROM sessions WHERE id = ?').get('pm-1') as {
      status: string;
      updated_at: string;
    };
    assert.equal(row.status, 'working');
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
    db.close();
  });

  test('unknown session (resolveOwner returns null) → no DB write', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'idle')").run('pm-2');

    const r = sessionStartHandler(db, null);
    assert.equal(r.flipped, false);
    // Untouched row stays idle.
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-2') as { status: string };
    assert.equal(row.status, 'idle');
    db.close();
  });
});

describe('SessionEnd hook — Phase N.0 Patch 4', () => {
  test('known session → status=stopped + stopped_at set + updated_at bumped', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status, stopped_at) VALUES (?, 'working', NULL)").run('pm-3');

    const r = sessionEndHandler(db, 'pm-3');
    assert.equal(r.flipped, true);

    const row = db.prepare('SELECT status, stopped_at, updated_at FROM sessions WHERE id = ?').get('pm-3') as {
      status: string;
      stopped_at: string | null;
      updated_at: string;
    };
    assert.equal(row.status, 'stopped');
    assert.ok(row.stopped_at !== null && row.stopped_at.length >= 10);
    assert.notEqual(row.updated_at, '2000-01-01 00:00:00');
    db.close();
  });

  test('SessionEnd on a waiting session still flips → stopped (any live → stopped)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'waiting')").run('pm-4');

    sessionEndHandler(db, 'pm-4');
    const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('pm-4') as { status: string };
    assert.equal(row.status, 'stopped');
    db.close();
  });

  test('unknown session (resolveOwner returns null) → no DB write, no throw', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const r = sessionEndHandler(db, null);
    assert.equal(r.flipped, false);
    db.close();
  });

  test('SessionStart then SessionEnd for the same id → full lifecycle persisted', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status, stopped_at) VALUES (?, 'idle', NULL)").run('pm-5');

    sessionStartHandler(db, 'pm-5');
    let row = db.prepare('SELECT status, stopped_at FROM sessions WHERE id = ?').get('pm-5') as {
      status: string;
      stopped_at: string | null;
    };
    assert.equal(row.status, 'working');
    assert.equal(row.stopped_at, null);

    sessionEndHandler(db, 'pm-5');
    row = db.prepare('SELECT status, stopped_at FROM sessions WHERE id = ?').get('pm-5') as {
      status: string;
      stopped_at: string | null;
    };
    assert.equal(row.status, 'stopped');
    assert.ok(row.stopped_at !== null);
    db.close();
  });
});
