import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase O — aggregate rate-limit aggregator logic.
//
// Production lives in sessionTickService.getAggregateRateLimits and uses
// getDb() so we can't swap the DB under it at unit scope. We mirror the
// SQL + the staleness computation here against an in-memory DB. Any
// change to the prod query must be reflected here or the test regresses.
//
// Invariants:
//   1. Freshest non-null tick wins (ORDER BY updated_at DESC).
//   2. sampleAgeMs > 10min → pcts + resetsAt forced to null (stale).
//   3. No qualifying tick → null pcts, sampleAgeMs = +Infinity, sourceSessionId = null.
//   4. Null-safe: seven_day-only rows still surface; ties broken by updated_at desc.

const STALE_MS = 10 * 60_000;

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle'
    );
    CREATE TABLE session_ticks (
      session_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      five_hour_pct REAL,
      five_hour_resets_at TEXT,
      seven_day_pct REAL,
      seven_day_resets_at TEXT
    );
  `);
};

// Seed a sessions row with a given status. Mirror tests must create
// one per tick they insert — the JOIN in the prod query requires a
// matching sessions row to consider the tick.
const seedSession = (db: Database.Database, id: string, status = 'working') => {
  db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run(id, status);
};

// Mirrors getAggregateRateLimits() against the given DB + nowMs.
// Phase R M4 — JOIN sessions + filter stopped.
const getAggregate = (db: Database.Database, nowMs: number) => {
  const row = db.prepare(
    `SELECT t.session_id AS session_id, t.updated_at AS updated_at,
            t.five_hour_pct AS five_hour_pct, t.five_hour_resets_at AS five_hour_resets_at,
            t.seven_day_pct AS seven_day_pct, t.seven_day_resets_at AS seven_day_resets_at
     FROM session_ticks t
     INNER JOIN sessions s ON s.id = t.session_id
     WHERE (t.five_hour_pct IS NOT NULL OR t.seven_day_pct IS NOT NULL)
       AND s.status != 'stopped'
     ORDER BY t.updated_at DESC
     LIMIT 1`
  ).get() as
    | {
        session_id: string;
        updated_at: number;
        five_hour_pct: number | null;
        five_hour_resets_at: string | null;
        seven_day_pct: number | null;
        seven_day_resets_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      fiveHour: { pct: null as number | null, resetsAt: null as string | null },
      sevenDay: { pct: null as number | null, resetsAt: null as string | null },
      sourceSessionId: null as string | null,
      sampleAgeMs: Number.POSITIVE_INFINITY,
    };
  }
  const sampleAgeMs = Math.max(0, nowMs - row.updated_at);
  const stale = sampleAgeMs > STALE_MS;
  return {
    fiveHour: {
      pct: stale ? null : row.five_hour_pct,
      resetsAt: stale ? null : row.five_hour_resets_at,
    },
    sevenDay: {
      pct: stale ? null : row.seven_day_pct,
      resetsAt: stale ? null : row.seven_day_resets_at,
    },
    sourceSessionId: row.session_id,
    sampleAgeMs,
  };
};

describe('getAggregateRateLimits — Phase O', () => {
  test('no ticks at all → null pcts, +Infinity age, null source', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const agg = getAggregate(db, 1_700_000_000_000);
    assert.equal(agg.fiveHour.pct, null);
    assert.equal(agg.sevenDay.pct, null);
    assert.equal(agg.sourceSessionId, null);
    assert.equal(agg.sampleAgeMs, Number.POSITIVE_INFINITY);
    db.close();
  });

  test('freshest non-null tick wins across multiple sessions', () => {
    const db = new Database(':memory:');
    createSchema(db);
    // Older session has 80% → should NOT win.
    seedSession(db, 'old');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('old', 1_699_999_999_000, 80, '2026-04-17T15:00:00Z', 50, '2026-04-24T00:00:00Z');
    // Newer session has 30% → SHOULD win.
    seedSession(db, 'fresh');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('fresh', 1_700_000_000_000, 30, '2026-04-17T16:00:00Z', 25, '2026-04-24T01:00:00Z');

    const agg = getAggregate(db, 1_700_000_001_000);
    assert.equal(agg.sourceSessionId, 'fresh');
    assert.equal(agg.fiveHour.pct, 30);
    assert.equal(agg.fiveHour.resetsAt, '2026-04-17T16:00:00Z');
    assert.equal(agg.sevenDay.pct, 25);
    assert.equal(agg.sampleAgeMs, 1000);
    db.close();
  });

  test('tick > 10 min old → pcts + resetsAt forced to null, sourceSessionId still set', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const now = 1_700_000_000_000;
    const tickAt = now - (11 * 60_000); // 11 min old
    seedSession(db, 'stale');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('stale', tickAt, 77, '2026-04-17T15:00:00Z', 40, '2026-04-24T00:00:00Z');

    const agg = getAggregate(db, now);
    assert.equal(agg.fiveHour.pct, null);
    assert.equal(agg.fiveHour.resetsAt, null);
    assert.equal(agg.sevenDay.pct, null);
    assert.equal(agg.sourceSessionId, 'stale');
    assert.ok(agg.sampleAgeMs > 10 * 60_000);
    db.close();
  });

  test('seven-day-only row (five-hour pct null) still qualifies as freshest', () => {
    const db = new Database(':memory:');
    createSchema(db);
    seedSession(db, 'seven-only');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, NULL, NULL, ?, ?)"
    ).run('seven-only', 1_700_000_000_000, 12, '2026-04-24T00:00:00Z');

    const agg = getAggregate(db, 1_700_000_000_500);
    assert.equal(agg.fiveHour.pct, null);
    assert.equal(agg.sevenDay.pct, 12);
    assert.equal(agg.sourceSessionId, 'seven-only');
    assert.equal(agg.sampleAgeMs, 500);
    db.close();
  });

  test('Phase R M4 — ticks from stopped sessions are excluded even when freshest', () => {
    const db = new Database(':memory:');
    createSchema(db);
    // Stopped session ticked LAST with distinctive 91%. The pre-M4
    // query would pick this row; post-M4 it's filtered out.
    seedSession(db, 'dead', 'stopped');
    seedSession(db, 'live', 'working');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('live', 1_700_000_000_000, 42, '2026-04-17T15:00:00Z', 20, '2026-04-24T00:00:00Z');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('dead', 1_700_000_000_500, 91, '2026-04-17T16:00:00Z', 88, '2026-04-24T01:00:00Z');

    const agg = getAggregate(db, 1_700_000_000_600);
    assert.equal(agg.sourceSessionId, 'live');
    assert.equal(agg.fiveHour.pct, 42);
    db.close();
  });

  test('Phase R M4 — when every tick belongs to a stopped session, null source', () => {
    const db = new Database(':memory:');
    createSchema(db);
    seedSession(db, 'dead-1', 'stopped');
    seedSession(db, 'dead-2', 'stopped');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('dead-1', 1_700_000_000_000, 60, '2026-04-17T15:00:00Z', 30, '2026-04-24T00:00:00Z');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('dead-2', 1_700_000_000_500, 70, '2026-04-17T16:00:00Z', 40, '2026-04-24T01:00:00Z');

    const agg = getAggregate(db, 1_700_000_000_600);
    assert.equal(agg.sourceSessionId, null);
    assert.equal(agg.fiveHour.pct, null);
    assert.equal(agg.sevenDay.pct, null);
    assert.equal(agg.sampleAgeMs, Number.POSITIVE_INFINITY);
    db.close();
  });

  test('rows where BOTH pcts are NULL are skipped — never picked as source', () => {
    const db = new Database(':memory:');
    createSchema(db);
    // This row has no rate-limit fields at all — shouldn't win over
    // the older one that does.
    seedSession(db, 'empty-fresh');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, NULL, NULL, NULL, NULL)"
    ).run('empty-fresh', 1_700_000_000_500);
    seedSession(db, 'has-fields');
    db.prepare(
      "INSERT INTO session_ticks (session_id, updated_at, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('has-fields', 1_700_000_000_000, 45, '2026-04-17T15:00:00Z', 22, '2026-04-24T00:00:00Z');

    const agg = getAggregate(db, 1_700_000_000_600);
    assert.equal(agg.sourceSessionId, 'has-fields');
    assert.equal(agg.fiveHour.pct, 45);
    db.close();
  });
});
