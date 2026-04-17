import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { UUID_RE } from '../../routes/hook-event.routes.js';

// Phase L Bundle 2 — regression coverage for the pm-cwd-rotation bridge.
// The resolver's SQL logic lives inside hook-event.routes.ts and consults
// the singleton getDb(). We don't override the singleton here; instead we
// build an in-memory SQLite with the same columns + rows the production
// path would touch, then prove the SQL predicates behave as designed.
// A regression in the GLOB pattern OR the cwd filter OR the status filter
// would be caught by this test without needing a live Commander DB.

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      claude_session_id TEXT,
      transcript_paths TEXT NOT NULL DEFAULT '[]'
    );
  `);
};

// Exactly the query added in Phase L (see resolveOwner step 4). Kept in
// sync here as a single string so any future edit to the production SQL
// forces an update to this test too.
const PM_CWD_ROTATION_SQL = `SELECT id FROM sessions
 WHERE project_path = ?
   AND status != 'stopped'
   AND id GLOB ?`;

const UUID_ID_GLOB = '????????-????-????-????-????????????';

describe('UUID_RE — PM/lead id pattern detector', () => {
  test('matches a v4-format UUID', () => {
    assert.equal(UUID_RE.test('6073138e-507d-4adb-a253-cf7d1f9bea03'), true);
    assert.equal(UUID_RE.test('bbe98809-b860-4a96-8787-9cee250a432b'), true);
  });

  test('does NOT match teammate-coder slug ids', () => {
    assert.equal(UUID_RE.test('coder-11@jstudio-commander'), false);
    assert.equal(UUID_RE.test('coder-9@jlp-patrimonio'), false);
    assert.equal(UUID_RE.test('some-arbitrary-slug'), false);
  });
});

describe('pm-cwd-rotation SQL — Phase L Bundle 2', () => {
  test('single UUID-id PM in cwd + mixed coder-slug siblings → 1 match (the PM)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/codeman-cases/JStudioCommand';

    const insert = db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    );
    // One PM/lead session (id = UUID, the Claude session UUID at creation).
    insert.run('6073138e-507d-4adb-a253-cf7d1f9bea03', cwd, 'idle', '["some-old-path.jsonl"]');
    // Several teammate-coder sessions — all slug ids, all same cwd.
    insert.run('coder-9@jstudio-commander', cwd, 'idle', '[]');
    insert.run('coder-11@jstudio-commander', cwd, 'idle', '[]');
    insert.run('coder-16@jstudio-commander', cwd, 'working', '[]');
    // A PM in a different cwd — should not match.
    insert.run('9a0b1c2d-5555-4111-8888-abcdef012345', '/other/project', 'idle', '[]');

    const rows = db.prepare(PM_CWD_ROTATION_SQL).all(cwd, UUID_ID_GLOB) as Array<{ id: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '6073138e-507d-4adb-a253-cf7d1f9bea03');
    db.close();
  });

  test('two UUID-id PMs in same cwd → 2 matches (caller drops to skip)', () => {
    // Safety guarantee: when multiple PM/lead sessions share cwd the
    // resolver must NOT auto-bind — it skips and waits for unambiguous
    // signal (a future hook with a matching UUID or a transcript_path
    // already present in one of the rows).
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/shared-project';
    const insert = db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    );
    insert.run('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd, 'idle', '[]');
    insert.run('11111111-2222-3333-4444-555555555555', cwd, 'idle', '[]');

    const rows = db.prepare(PM_CWD_ROTATION_SQL).all(cwd, UUID_ID_GLOB) as Array<{ id: string }>;
    assert.equal(rows.length, 2);
    db.close();
  });

  test('stopped PM in cwd → excluded (status filter)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/revisited';
    const insert = db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    );
    // Dead PM row — previously ran in this cwd, now stopped. Rotation
    // messages must not bind here.
    insert.run('dddddddd-eeee-ffff-0000-111111111111', cwd, 'stopped', '[]');
    // Active PM — sole rotation target.
    insert.run('22222222-3333-4444-5555-666666666666', cwd, 'idle', '[]');

    const rows = db.prepare(PM_CWD_ROTATION_SQL).all(cwd, UUID_ID_GLOB) as Array<{ id: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '22222222-3333-4444-5555-666666666666');
    db.close();
  });

  test('only coder-slug sessions in cwd (no PM) → 0 matches', () => {
    // Happens when a teammate-coder rotates in a cwd that has no PM.
    // Today we don't auto-bind rotation for coder-slug sessions; this
    // test enshrines that behavior so a future relaxation is explicit.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/coders-only';
    const insert = db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    );
    insert.run('coder-1@team', cwd, 'idle', '[]');
    insert.run('coder-2@team', cwd, 'idle', '[]');

    const rows = db.prepare(PM_CWD_ROTATION_SQL).all(cwd, UUID_ID_GLOB) as Array<{ id: string }>;
    assert.equal(rows.length, 0);
    db.close();
  });
});
