import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Phase T Patch 2 revision — regression guard for the poller's
// "hook-authoritative yield" gate.
//
// Production: status-poller.service.poll runs every 5s. For each row
// it SELECTs `last_hook_at` (epoch ms, written by hook-event routes
// that resolved an owner). If the difference between `Date.now()` and
// the stored timestamp is less than HOOK_YIELD_MS (60_000), the
// poller skips pane-regex reclassification entirely — the hook is
// authoritative.
//
// Revision note: previous Phase N.0 Patch 2 (cfd1e65) gated on
// `status = 'idle'` AND `ms_since_update < 10_000` (julianday math
// against updated_at). That was too narrow — append-only transcript
// writes never bumped updated_at, so active turns could slip outside
// the window and let a stale pane-regex flip a just-stopped row back
// to working. The rev drops the status predicate and widens the
// window to 60s, using a dedicated column.
//
// Invariants:
//   1. Recent hook (last_hook_at within 60s) → yield (any status).
//   2. Stale hook (last_hook_at > 60s ago) → NO yield (poller proceeds).
//   3. Never-hooked row (last_hook_at = 0) → NO yield.
//   4. Yield is independent of status: fresh hook on 'working' AND
//      fresh hook on 'idle' both skip the poller.

const HOOK_YIELD_MS = 60_000;

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      tmux_session TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_hook_at INTEGER NOT NULL DEFAULT 0
    );
  `);
};

// Mirrors the poller SELECT post-revision.
const POLLER_SELECT = `SELECT id, tmux_session, status, last_hook_at
FROM sessions
WHERE status != 'stopped'`;

// Mirrors the yield decision in the poll loop. Returns true iff the
// poller would SKIP reclassifying this session. `now` is injected so
// tests are deterministic — production calls Date.now() inline.
const shouldYield = (
  row: { last_hook_at: number },
  now: number,
): boolean => now - Number(row.last_hook_at ?? 0) < HOOK_YIELD_MS;

describe('poller yield (Phase T Patch 2 revision) — hook-authoritative', () => {
  test('recent hook (within 60s) → yield fires regardless of status', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const now = 10_000_000;
    const recent = now - 5_000; // 5s ago — well within 60s
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'idle', ?)",
    ).run('pm-idle', 't1', recent);
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'working', ?)",
    ).run('pm-working', 't2', recent);

    const rows = db.prepare(POLLER_SELECT).all() as Array<{ last_hook_at: number }>;
    for (const r of rows) {
      assert.equal(shouldYield(r, now), true);
    }
    db.close();
  });

  test('stale hook (>60s ago) → no yield, poller proceeds', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const now = 10_000_000;
    const stale = now - 75_000; // 75s ago — past the 60s window
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'idle', ?)",
    ).run('pm-stale', 't1', stale);

    const row = db.prepare(POLLER_SELECT).get() as { last_hook_at: number };
    assert.equal(shouldYield(row, now), false);
    db.close();
  });

  test('never-hooked row (last_hook_at = 0 default) → no yield', () => {
    // A row that was never matched by any hook has last_hook_at=0 (the
    // migration default). `Date.now() - 0` is enormous, so the gate must
    // let the poller run normally. Without this behavior, freshly-booted
    // sessions would be stuck yielding until the first hook fires.
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status) VALUES (?, ?, 'working')",
    ).run('fresh', 't1');

    const row = db.prepare(POLLER_SELECT).get() as { last_hook_at: number };
    assert.equal(row.last_hook_at, 0);
    assert.equal(shouldYield(row, Date.now()), false);
    db.close();
  });

  test('yield is status-agnostic: stale hook on idle AND working alike', () => {
    // Key invariant the revision encodes: the hook, when recent, is
    // authoritative — not the cached status. When the hook is stale,
    // neither status value should influence the decision.
    const db = new Database(':memory:');
    createSchema(db);
    const now = 10_000_000;
    const stale = now - 70_000;
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'idle', ?)",
    ).run('a', 't1', stale);
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'working', ?)",
    ).run('b', 't2', stale);
    db.prepare(
      "INSERT INTO sessions (id, tmux_session, status, last_hook_at) VALUES (?, ?, 'waiting', ?)",
    ).run('c', 't3', stale);

    const rows = db.prepare(POLLER_SELECT).all() as Array<{ last_hook_at: number }>;
    for (const r of rows) {
      assert.equal(shouldYield(r, now), false);
    }
    db.close();
  });

  test('boundary: exactly at the 60s edge resolves to NO yield', () => {
    // shouldYield uses strict `<`, so a diff of exactly HOOK_YIELD_MS
    // falls outside the window. Guard against off-by-one regressions.
    const now = 10_000_000;
    const onEdge = { last_hook_at: now - HOOK_YIELD_MS };
    assert.equal(shouldYield(onEdge, now), false);
    const justInside = { last_hook_at: now - (HOOK_YIELD_MS - 1) };
    assert.equal(shouldYield(justInside, now), true);
  });
});
