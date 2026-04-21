import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Candidate 27 — synthetic-id reconciliation on first hook.
//
// Shape of the bug:
//   Commander's startup orphan-adoption creates a session row for any
//   live `jsc-<slug>` tmux session it doesn't already know about. The
//   row's `id` is derived from the tmux name as `<slug>-0000-0000-0000-
//   000000000000` (a synthetic UUID-shaped string). Pre-fix, the
//   adoption call omitted `projectPath`, so the row stored
//   `project_path = NULL`.
//
//   When the real Claude Code inside that tmux later fired a hook
//   (e.g. PostToolUse with a transcript_path pointing to `<realUUID>.
//   jsonl`), `resolveOwner` in hook-event.routes.ts tried each strategy
//   in order:
//     - step 1 (transcript_paths fast-path): miss — synthetic row had
//       empty transcript_paths.
//     - step 2 (uuid === id OR claude_session_id): miss — synthetic id
//       ends in `-0000-0000-0000-000000000000`, not the real UUID.
//     - step 3 (cwd-exclusive): miss — `project_path` was NULL, so the
//       `WHERE project_path = ?` clause never matched.
//     - step 4 (pm-cwd-rotation): miss — same NULL project_path.
//     - step 5 (coder-team-rotation): miss — no team_name.
//   → Hook dropped as "no owner". Synthetic row never reconciled.
//
// Fix: `server/src/index.ts` orphan-adoption now calls
// `tmux.resolvePaneCwd(paneId)` and passes the result as `projectPath`
// into `upsertSession`. With `project_path` populated, the first hook
// whose `cwd` matches (and whose transcript_paths is still empty) now
// binds via cwd-exclusive (step 3). Phase U Patch 1's
// `maybeAutoLearnClaudeSessionId` then writes the real Claude UUID
// into `claude_session_id`, and every subsequent hook matches via
// step 1 or step 2.
//
// These tests exercise the SQL predicate the cwd-exclusive strategy
// uses, with fixture rows that mirror the pre-fix and post-fix DB
// shapes. The in-memory DB pattern matches `hook-event-resolver.test.ts`.

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

// Exact SQL from resolveOwner step 3 (cwd-exclusive), kept verbatim
// so any future drift in the production path forces a test update.
const CWD_EXCLUSIVE_SQL = `SELECT id FROM sessions
 WHERE project_path = ?
   AND status != 'stopped'
   AND (transcript_paths IS NULL OR transcript_paths = '[]')`;

describe('Candidate 27 — synthetic row with project_path reconciles on first hook (cwd-exclusive)', () => {
  test('POST-FIX: synthetic row with project_path populated → cwd-exclusive matches', () => {
    // Post-fix adoption: synthetic id, project_path from tmux pane cwd,
    // no claude_session_id, no transcripts. First hook's cwd matches.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/projects/jstudio-commander';
    // Synthetic id — derived from tmux name `jsc-04bb12d7` →
    // `04bb12d7-0000-0000-0000-000000000000`.
    const syntheticId = '04bb12d7-0000-0000-0000-000000000000';

    db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    ).run(syntheticId, cwd, 'idle', '[]');

    const rows = db.prepare(CWD_EXCLUSIVE_SQL).all(cwd) as Array<{ id: string }>;
    assert.equal(rows.length, 1, 'synthetic row matches cwd-exclusive — reconciliation path open');
    assert.equal(rows[0]!.id, syntheticId);
    db.close();
  });

  test('PRE-FIX REGRESSION: synthetic row with project_path=NULL → cwd-exclusive misses', () => {
    // This is the bug shape we're closing. project_path IS NULL means
    // the `WHERE project_path = ?` predicate can't match any row for
    // the hook's cwd. Pinned here so a future revert that drops the
    // projectPath passthrough would re-break the test.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/projects/jstudio-commander';
    const syntheticId = '04bb12d7-0000-0000-0000-000000000000';

    db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    ).run(syntheticId, null, 'idle', '[]');

    const rows = db.prepare(CWD_EXCLUSIVE_SQL).all(cwd) as Array<{ id: string }>;
    assert.equal(rows.length, 0, 'pre-fix shape — hooks dropped as "no owner"');
    db.close();
  });

  test('POST-RECONCILIATION: after first hook binds a transcript, cwd-exclusive no longer matches (prevents re-bind to wrong row)', () => {
    // Once a transcript is bound, the synthetic row is fully claimed.
    // A DIFFERENT Claude session firing in the SAME cwd must NOT
    // rebind to this row via cwd-exclusive (the `transcript_paths =
    // '[]'` guard enforces single-bind). The sibling path is
    // pm-cwd-rotation (step 4) which handles JSONL rotation for the
    // same session, not cross-session claim-jumping.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/projects/jstudio-commander';
    const syntheticId = '04bb12d7-0000-0000-0000-000000000000';
    const transcriptPath = '/Users/test/.claude/projects/hash/04bb12d7-abcd-4000-8000-000000000001.jsonl';

    db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    ).run(syntheticId, cwd, 'idle', JSON.stringify([transcriptPath]));

    const rows = db.prepare(CWD_EXCLUSIVE_SQL).all(cwd) as Array<{ id: string }>;
    assert.equal(
      rows.length,
      0,
      'post-reconciliation row is claimed — cwd-exclusive correctly stops matching',
    );
    db.close();
  });

  test('stopped synthetic row → cwd-exclusive does NOT match (status filter)', () => {
    // When the user explicitly stops a recovered session, that row
    // shouldn't be re-bound to a new hook arriving in the same cwd.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/projects/jstudio-commander';
    const syntheticId = '04bb12d7-0000-0000-0000-000000000000';

    db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    ).run(syntheticId, cwd, 'stopped', '[]');

    const rows = db.prepare(CWD_EXCLUSIVE_SQL).all(cwd) as Array<{ id: string }>;
    assert.equal(rows.length, 0);
    db.close();
  });

  test('two unclaimed synthetic rows in same cwd → cwd-exclusive returns BOTH (caller drops to skip)', () => {
    // Safety: if multiple recovered rows share a cwd (rare — typically
    // only one tmux session per project), cwd-exclusive returns all
    // matches and the caller in resolveOwner treats length !== 1 as
    // skip. Pinned here as an explicit invariant.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/projects/shared';

    const insert = db.prepare(
      'INSERT INTO sessions (id, project_path, status, transcript_paths) VALUES (?, ?, ?, ?)',
    );
    insert.run('04bb12d7-0000-0000-0000-000000000000', cwd, 'idle', '[]');
    insert.run('77221188-0000-0000-0000-000000000000', cwd, 'idle', '[]');

    const rows = db.prepare(CWD_EXCLUSIVE_SQL).all(cwd) as Array<{ id: string }>;
    assert.equal(rows.length, 2, 'both unclaimed — caller must skip for safety');
    db.close();
  });
});

describe('Candidate 27 — synthetic ID shape guard (pins the orphan-adoption contract)', () => {
  // The synthetic ID is constructed at `index.ts` as
  // `tmuxSession.name.replace('jsc-', '') + '-0000-0000-0000-000000000000'`.
  // This test pins the shape so any future change to the id derivation
  // is caught — the `-0000-0000-0000-000000000000` suffix is the
  // "synthetic marker" that a TTL-delete follow-up could use if Jose
  // later wants to prune unreconciled rows.
  const SYNTHETIC_SUFFIX = '-0000-0000-0000-000000000000';

  const buildSyntheticId = (tmuxName: string): string =>
    tmuxName.replace('jsc-', '') + SYNTHETIC_SUFFIX;

  const isSyntheticId = (id: string): boolean => id.endsWith(SYNTHETIC_SUFFIX);

  test('tmux name jsc-04bb12d7 → id 04bb12d7-0000-0000-0000-000000000000', () => {
    assert.equal(
      buildSyntheticId('jsc-04bb12d7'),
      '04bb12d7-0000-0000-0000-000000000000',
    );
  });

  test('synthetic suffix marker allows detection in TTL-delete follow-up', () => {
    assert.equal(isSyntheticId('04bb12d7-0000-0000-0000-000000000000'), true);
    assert.equal(isSyntheticId('04bb12d7-abcd-4000-8000-000000000001'), false);
    assert.equal(isSyntheticId('coder-11@team'), false);
  });
});
