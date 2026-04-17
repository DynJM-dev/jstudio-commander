// Phase R M6 — defensive math + boot-time audit coverage.
//
// Two invariants:
//   1. The poller's `strftime('%s')` ms-diff produces the same integer
//      ms as the pre-M6 `julianday` diff when both operands are
//      `datetime('now')`-format UTC strings. Without this equivalence
//      the switch would silently break downstream threshold checks
//      (e.g. 30s stale override).
//   2. The boot-time audit SQL catches the drift shapes the comment
//      calls out: AM/PM localized, ISO offsets `+HH:MM` / `-HH:MM`,
//      trailing Z. Clean `datetime('now')` output MUST NOT match.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

describe('poller ms_since_update — strftime vs julianday equivalence', () => {
  test('integer ms diff matches between the two formulas on UTC inputs', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE probe (updated_at TEXT)`);

    // Pick a fixed UTC timestamp 10 seconds before 'now'. Use a
    // datetime('now', modifier) so the row is in the same UTC frame
    // SQLite's `datetime('now')` emits in production writes.
    db.prepare(`INSERT INTO probe VALUES (datetime('now', '-10 seconds'))`).run();
    db.prepare(`INSERT INTO probe VALUES (datetime('now', '-1 minute'))`).run();
    db.prepare(`INSERT INTO probe VALUES (datetime('now', '-5 minutes'))`).run();

    const rows = db.prepare(
      `SELECT
        CAST((julianday('now') - julianday(updated_at)) * 86400000 AS INTEGER) AS julian_ms,
        (strftime('%s','now') - strftime('%s', updated_at)) * 1000 AS strftime_ms
       FROM probe`,
    ).all() as Array<{ julian_ms: number; strftime_ms: number }>;

    for (const row of rows) {
      // julianday is fractional; strftime('%s') is integer-second. The
      // two can differ by up to 999 ms inside any given wall-clock
      // second. Assert the gap is below that floor.
      assert.ok(Math.abs(row.julian_ms - row.strftime_ms) < 1000,
        `julian=${row.julian_ms} vs strftime=${row.strftime_ms} diverge by >= 1s`);
    }
    db.close();
  });
});

describe('boot-time UTC audit SQL', () => {
  const runAudit = (db: Database.Database): number => {
    return (db.prepare(
      `SELECT COUNT(*) AS n FROM sessions
       WHERE updated_at LIKE '%AM%'
          OR updated_at LIKE '%PM%'
          OR updated_at LIKE '%+__:__'
          OR updated_at LIKE '%-__:__'
          OR updated_at LIKE '%Z'`,
    ).get() as { n: number }).n;
  };

  const makeDb = (): Database.Database => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, updated_at TEXT)`);
    return db;
  };

  test('clean datetime(now) UTC rows → count 0', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions (id, updated_at) VALUES ('a', datetime('now'))`).run();
    db.prepare(`INSERT INTO sessions (id, updated_at) VALUES ('b', datetime('now', '-5 minutes'))`).run();
    assert.equal(runAudit(db), 0);
    db.close();
  });

  test('localized 12-hour string ("03:42 PM") → flagged', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions VALUES ('tz', '2026-04-17 03:42:00 PM')`).run();
    assert.equal(runAudit(db), 1);
    db.close();
  });

  test('ISO-8601 with positive offset ("+04:00") → flagged', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions VALUES ('+off', '2026-04-17T15:42:00+04:00')`).run();
    assert.equal(runAudit(db), 1);
    db.close();
  });

  test('ISO-8601 with negative offset ("-05:00") → flagged', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions VALUES ('-off', '2026-04-17T15:42:00-05:00')`).run();
    assert.equal(runAudit(db), 1);
    db.close();
  });

  test('ISO-8601 with trailing Z → flagged', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions VALUES ('z', '2026-04-17T15:42:00Z')`).run();
    assert.equal(runAudit(db), 1);
    db.close();
  });

  test('mixed rows — count matches only the non-UTC entries', () => {
    const db = makeDb();
    db.prepare(`INSERT INTO sessions VALUES ('ok1', datetime('now'))`).run();
    db.prepare(`INSERT INTO sessions VALUES ('ok2', datetime('now', '-10 minutes'))`).run();
    db.prepare(`INSERT INTO sessions VALUES ('bad1', '2026-04-17 03:42:00 PM')`).run();
    db.prepare(`INSERT INTO sessions VALUES ('bad2', '2026-04-17T15:42:00Z')`).run();
    assert.equal(runAudit(db), 2);
    db.close();
  });
});
