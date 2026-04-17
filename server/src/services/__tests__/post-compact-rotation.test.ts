import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.0 — regression coverage for the post-compact inference flag.
//
// The production path lives in sessionService.appendTranscriptPath +
// clearPostCompactFlag (see server/src/services/session.service.ts). Those
// methods consult the singleton getDb(); we mirror the SQL logic here
// against an in-memory DB so the invariants are pinned without needing
// the live Commander DB.
//
// Invariants:
//   1. Append that is a rotation (existing.length > 0) + prior tick ≥ 90
//      → post_compact_until_next_tick flips to 1.
//   2. Append that is a rotation but prior tick < 90 → flag stays 0
//      (false-positive guard; user manually /cleared early).
//   3. Append that is the FIRST transcript (existing.length === 0) →
//      flag stays 0 even if a prior tick somehow exists.
//   4. clearPostCompactFlag flips 1 → 0 and returns true; returns false
//      when the row was already at 0 so the caller can skip the
//      WS broadcast.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      transcript_paths TEXT NOT NULL DEFAULT '[]',
      post_compact_until_next_tick INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_ticks (
      session_id TEXT PRIMARY KEY,
      context_used_pct REAL
    );
  `);
};

// Mirrors appendTranscriptPath's post-compact branch — any change to the
// production logic should be reflected here or the test regresses.
const appendMirror = (
  db: Database.Database,
  sessionId: string,
  path: string,
): { appended: boolean; flagRaised: boolean } => {
  const row = db.prepare('SELECT transcript_paths FROM sessions WHERE id = ?').get(sessionId) as
    | { transcript_paths: string }
    | undefined;
  if (!row) return { appended: false, flagRaised: false };
  const existing = JSON.parse(row.transcript_paths) as string[];
  if (existing.includes(path)) return { appended: false, flagRaised: false };
  const next = [...existing, path];

  const isRotation = existing.length > 0;
  if (isRotation) {
    const priorTick = db.prepare(
      'SELECT context_used_pct FROM session_ticks WHERE session_id = ?',
    ).get(sessionId) as { context_used_pct: number | null } | undefined;
    const priorPct = priorTick?.context_used_pct;
    if (priorPct !== undefined && priorPct !== null && priorPct >= 90) {
      db.prepare(
        "UPDATE sessions SET transcript_paths = ?, post_compact_until_next_tick = 1 WHERE id = ?",
      ).run(JSON.stringify(next), sessionId);
      return { appended: true, flagRaised: true };
    }
  }

  db.prepare('UPDATE sessions SET transcript_paths = ? WHERE id = ?').run(JSON.stringify(next), sessionId);
  return { appended: true, flagRaised: false };
};

const clearFlagMirror = (db: Database.Database, sessionId: string): boolean => {
  const row = db.prepare(
    'SELECT post_compact_until_next_tick FROM sessions WHERE id = ?',
  ).get(sessionId) as { post_compact_until_next_tick: number | null } | undefined;
  if (!row) return false;
  if ((row.post_compact_until_next_tick ?? 0) === 0) return false;
  db.prepare('UPDATE sessions SET post_compact_until_next_tick = 0 WHERE id = ?').run(sessionId);
  return true;
};

describe('post-compact rotation inference — Phase N.0', () => {
  test('rotation + prior tick ≥ 90% → flag flips to 1', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)').run(
      'pm-1',
      JSON.stringify(['/old.jsonl']),
    );
    db.prepare('INSERT INTO session_ticks (session_id, context_used_pct) VALUES (?, ?)').run('pm-1', 100);

    const result = appendMirror(db, 'pm-1', '/new.jsonl');
    assert.equal(result.appended, true);
    assert.equal(result.flagRaised, true);

    const row = db.prepare(
      'SELECT post_compact_until_next_tick, transcript_paths FROM sessions WHERE id = ?',
    ).get('pm-1') as { post_compact_until_next_tick: number; transcript_paths: string };
    assert.equal(row.post_compact_until_next_tick, 1);
    assert.deepEqual(JSON.parse(row.transcript_paths), ['/old.jsonl', '/new.jsonl']);
    db.close();
  });

  test('rotation + prior tick < 90% → flag stays 0 (early /clear false-positive guard)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)').run(
      'pm-2',
      JSON.stringify(['/old.jsonl']),
    );
    db.prepare('INSERT INTO session_ticks (session_id, context_used_pct) VALUES (?, ?)').run('pm-2', 45.5);

    const result = appendMirror(db, 'pm-2', '/new.jsonl');
    assert.equal(result.appended, true);
    assert.equal(result.flagRaised, false);

    const row = db.prepare('SELECT post_compact_until_next_tick FROM sessions WHERE id = ?').get('pm-2') as {
      post_compact_until_next_tick: number;
    };
    assert.equal(row.post_compact_until_next_tick, 0);
    db.close();
  });

  test('first transcript (existing.length === 0) → flag stays 0 even if a tick exists', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)').run('pm-3', '[]');
    // A tick at 100 that somehow predates the first transcript: not a
    // rotation, so no inference. Guards against stale-tick leaks when a
    // session re-registers.
    db.prepare('INSERT INTO session_ticks (session_id, context_used_pct) VALUES (?, ?)').run('pm-3', 100);

    const result = appendMirror(db, 'pm-3', '/first.jsonl');
    assert.equal(result.appended, true);
    assert.equal(result.flagRaised, false);
    db.close();
  });

  test('no prior tick → flag stays 0 (rotation alone is not enough)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)').run(
      'pm-4',
      JSON.stringify(['/old.jsonl']),
    );
    // No session_ticks row — a rotation with nothing to compare can't be
    // inferred as post-compact.

    const result = appendMirror(db, 'pm-4', '/new.jsonl');
    assert.equal(result.appended, true);
    assert.equal(result.flagRaised, false);
    db.close();
  });

  test('dedup: appending the same path twice is a no-op, no flag change', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, transcript_paths, post_compact_until_next_tick) VALUES (?, ?, 0)').run(
      'pm-5',
      JSON.stringify(['/a.jsonl', '/b.jsonl']),
    );
    db.prepare('INSERT INTO session_ticks (session_id, context_used_pct) VALUES (?, ?)').run('pm-5', 99);

    const first = appendMirror(db, 'pm-5', '/b.jsonl');
    assert.equal(first.appended, false);
    assert.equal(first.flagRaised, false);

    const row = db.prepare('SELECT post_compact_until_next_tick FROM sessions WHERE id = ?').get('pm-5') as {
      post_compact_until_next_tick: number;
    };
    assert.equal(row.post_compact_until_next_tick, 0);
    db.close();
  });
});

describe('clearPostCompactFlag — Phase N.0', () => {
  test('flag raised → clear returns true and flips to 0', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, post_compact_until_next_tick) VALUES (?, 1)').run('pm-6');

    assert.equal(clearFlagMirror(db, 'pm-6'), true);
    const row = db.prepare('SELECT post_compact_until_next_tick FROM sessions WHERE id = ?').get('pm-6') as {
      post_compact_until_next_tick: number;
    };
    assert.equal(row.post_compact_until_next_tick, 0);
    db.close();
  });

  test('flag already 0 → clear returns false (caller skips redundant broadcast)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare('INSERT INTO sessions (id, post_compact_until_next_tick) VALUES (?, 0)').run('pm-7');

    assert.equal(clearFlagMirror(db, 'pm-7'), false);
    db.close();
  });

  test('missing row → clear returns false (no throw)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    assert.equal(clearFlagMirror(db, 'nonexistent'), false);
    db.close();
  });
});
