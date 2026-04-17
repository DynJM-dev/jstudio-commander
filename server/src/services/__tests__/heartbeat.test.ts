import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.0 Patch 3 — regression guard for the heartbeat column +
// bumpLastActivity semantics.
//
// Production: sessionService.bumpLastActivity writes `Date.now()` to
// sessions.last_activity_at and emits `session:heartbeat` via eventBus.
// We mirror the SQL here against in-memory SQLite; the emit channel is
// proven by stubbing a mini bus.
//
// Invariants:
//   1. Migration adds the column with DEFAULT 0 (matches connection.ts).
//   2. bumpLastActivity UPDATEs the column for an existing row.
//   3. bumpLastActivity is a no-op on a missing row (doesn't throw, WS
//      emit still fires so subscribers reconcile via REST).
//   4. rowToSession exposes lastActivityAt as Number(row.last_activity_at).
//   5. Poller yield does NOT bump — the yield branch returns before
//      the bumpLastActivity call in status-poller.service.ts.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity_at INTEGER NOT NULL DEFAULT 0
    );
  `);
};

// Mirror of sessionService.bumpLastActivity using the caller-supplied
// event bus. Lets tests assert the DB write AND the WS emit from a
// single entrypoint.
const bumpMirror = (
  db: Database.Database,
  sessionId: string,
  emits: Array<{ sessionId: string; ts: number }>,
): number => {
  const ts = Date.now();
  db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(ts, sessionId);
  emits.push({ sessionId, ts });
  return ts;
};

// Mirror of the poller yield decision (status-poller.service.ts).
// Returns true iff the poller would SKIP writing AND therefore skip
// the bumpLastActivity call.
const shouldYield = (row: { status: string; ms_since_update: number }): boolean =>
  row.status === 'idle' && row.ms_since_update < 10_000;

describe('heartbeat column + bumper — Phase N.0 Patch 3', () => {
  test('fresh insert has last_activity_at = 0 (schema default)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'idle')").run('s1');
    const row = db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get('s1') as {
      last_activity_at: number;
    };
    assert.equal(row.last_activity_at, 0);
    db.close();
  });

  test('bumpLastActivity writes Date.now() + emits heartbeat event', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status) VALUES (?, 'idle')").run('s2');
    const emits: Array<{ sessionId: string; ts: number }> = [];

    const before = Date.now();
    const ts = bumpMirror(db, 's2', emits);
    const after = Date.now();

    assert.ok(ts >= before && ts <= after);
    const row = db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get('s2') as {
      last_activity_at: number;
    };
    assert.equal(row.last_activity_at, ts);
    assert.equal(emits.length, 1);
    assert.equal(emits[0]!.sessionId, 's2');
    assert.equal(emits[0]!.ts, ts);
    db.close();
  });

  test('bumpLastActivity on missing row is a no-op on DB, emit still fires', () => {
    // Rationale: the WS emit is client-reconcilable (client sees event
    // for an unknown id, refetches, finds nothing, moves on) so we
    // favor consistency-of-emit-contract over pre-select validation.
    const db = new Database(':memory:');
    createSchema(db);
    const emits: Array<{ sessionId: string; ts: number }> = [];

    const ts = bumpMirror(db, 'nonexistent', emits);
    assert.ok(ts > 0);
    assert.equal(emits.length, 1);
    // DB row count unchanged.
    const count = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    assert.equal(count.c, 0);
    db.close();
  });

  test('row readout exposes lastActivityAt as a number (Number() coercion)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const ts = 1_700_000_000_000;
    db.prepare("INSERT INTO sessions (id, last_activity_at) VALUES (?, ?)").run('s3', ts);
    const raw = db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get('s3') as {
      last_activity_at: unknown;
    };
    // Mirror of rowToSession's `Number(row.last_activity_at ?? 0)`.
    const coerced = Number(raw.last_activity_at ?? 0);
    assert.equal(typeof coerced, 'number');
    assert.equal(coerced, ts);
    db.close();
  });

  test('poller yield branch does NOT bump — fresh idle row returns before UPDATE', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const originalTs = 12345;
    db.prepare("INSERT INTO sessions (id, status, last_activity_at) VALUES (?, 'idle', ?)").run('s4', originalTs);
    const emits: Array<{ sessionId: string; ts: number }> = [];

    // Mirror one poll iteration — the poller queries ms_since_update,
    // determines it should yield, and returns without bumping.
    const pollerIteration = (sessionId: string, row: { status: string; ms_since_update: number }) => {
      if (shouldYield(row)) return; // no bump
      bumpMirror(db, sessionId, emits);
    };

    pollerIteration('s4', { status: 'idle', ms_since_update: 5_000 });
    // DB column unchanged, no emit.
    const after = db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get('s4') as {
      last_activity_at: number;
    };
    assert.equal(after.last_activity_at, originalTs);
    assert.equal(emits.length, 0);
    db.close();
  });

  test('poller non-yield path DOES bump (stale idle or any non-idle transition)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, status, last_activity_at) VALUES (?, 'idle', 0)").run('s5');
    const emits: Array<{ sessionId: string; ts: number }> = [];

    // Stale idle → yield=false → bumper fires.
    const pollerIteration = (sessionId: string, row: { status: string; ms_since_update: number }) => {
      if (shouldYield(row)) return;
      bumpMirror(db, sessionId, emits);
    };

    pollerIteration('s5', { status: 'idle', ms_since_update: 30_000 });
    const after = db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get('s5') as {
      last_activity_at: number;
    };
    assert.ok(after.last_activity_at > 0);
    assert.equal(emits.length, 1);
    db.close();
  });
});
