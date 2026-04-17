import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase N.0 Patch 2 — regression guard for the poller's "yield to recent
// hook write" gate.
//
// Production: status-poller.service.poll runs every 5s, SELECTs each
// active session + `ms_since_update` computed from julianday diff, then
// skips re-classifying when the row is `idle` AND `ms_since_update <
// HOOK_YIELD_MS`. The yield preserves hook-authored `idle` writes from
// being clobbered by the pane-regex classifier on the next tick.
//
// Invariants:
//   1. Fresh (ms_since_update < 10_000) `idle` row → yield (no write,
//      regardless of what the pane regex classified).
//   2. Stale (ms_since_update >= 10_000) `idle` row → NO yield (poller
//      proceeds to classify + write as usual).
//   3. Fresh `working` row → NO yield (the gate is scoped to `idle`
//      only; hook writes only set idle, and a stale working row must
//      not get frozen).
//   4. The julianday diff SQL correctly produces ms-scale integers for
//      rows updated ~now vs ~20s ago — proves the SELECT contract.

const HOOK_YIELD_MS = 10_000;

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      tmux_session TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
};

// Mirrors the poller SELECT added in Patch 2.
const PATCH_2_SELECT = `SELECT id, tmux_session, status,
       CAST((julianday('now') - julianday(updated_at)) * 86400000 AS INTEGER) AS ms_since_update
FROM sessions
WHERE status != 'stopped'`;

// Mirrors the yield decision in the poll loop. Returns true iff the
// poller would SKIP writing for this session.
const shouldYield = (row: { status: string; ms_since_update: number }): boolean =>
  row.status === 'idle' && row.ms_since_update < HOOK_YIELD_MS;

describe('poller yield to hook — Phase N.0 Patch 2', () => {
  test('fresh idle row (updated_at = now) → yield fires, poller skips', () => {
    const db = new Database(':memory:');
    createSchema(db);
    // datetime('now') writes UTC without trailing Z; the julianday math
    // handles it natively — no timezone parsing on our side.
    db.prepare("INSERT INTO sessions (id, tmux_session, status) VALUES (?, ?, 'idle')").run('pm-1', 't1');

    const row = db.prepare(PATCH_2_SELECT).get() as { status: string; ms_since_update: number };
    assert.equal(row.status, 'idle');
    assert.ok(row.ms_since_update < HOOK_YIELD_MS, `expected <${HOOK_YIELD_MS}, got ${row.ms_since_update}`);
    assert.equal(shouldYield(row), true);
    db.close();
  });

  test('stale idle row (updated_at = 20s ago) → no yield, poller proceeds', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, updated_at) VALUES (?, ?, 'idle', datetime('now', '-20 seconds'))",
    ).run('pm-2', 't2');

    const row = db.prepare(PATCH_2_SELECT).get() as { status: string; ms_since_update: number };
    // 20s back-dated → ms_since_update should be ≥ 20000 (julianday is
    // sub-second-precise but our CAST to INTEGER can land at 20000 exact).
    assert.ok(
      row.ms_since_update >= HOOK_YIELD_MS,
      `expected ≥${HOOK_YIELD_MS}, got ${row.ms_since_update}`,
    );
    assert.equal(shouldYield(row), false);
    db.close();
  });

  test('fresh working row → no yield (gate is scoped to idle only)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, tmux_session, status) VALUES (?, ?, 'working')").run('pm-3', 't3');

    const row = db.prepare(PATCH_2_SELECT).get() as { status: string; ms_since_update: number };
    assert.equal(row.status, 'working');
    assert.ok(row.ms_since_update < HOOK_YIELD_MS);
    // Even though the row IS fresh, status !== 'idle' so no yield.
    assert.equal(shouldYield(row), false);
    db.close();
  });

  test('fresh waiting row → no yield (gate is scoped to idle only)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, tmux_session, status) VALUES (?, ?, 'waiting')").run('pm-4', 't4');

    const row = db.prepare(PATCH_2_SELECT).get() as { status: string; ms_since_update: number };
    assert.equal(shouldYield(row), false);
    db.close();
  });

  test('ms_since_update SELECT contract: now vs -20s differ by ~20000', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, tmux_session, status) VALUES (?, ?, 'idle')").run('now-row', 'ta');
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, updated_at) VALUES (?, ?, 'idle', datetime('now', '-20 seconds'))",
    ).run('old-row', 'tb');

    const rows = db.prepare(PATCH_2_SELECT).all() as Array<{ id: string; ms_since_update: number }>;
    const now = rows.find((r) => r.id === 'now-row')!;
    const old = rows.find((r) => r.id === 'old-row')!;
    const delta = old.ms_since_update - now.ms_since_update;
    // Allow ±500ms jitter around the 20000ms target.
    assert.ok(delta >= 19_500 && delta <= 20_500, `expected ~20000ms delta, got ${delta}`);
    db.close();
  });
});
