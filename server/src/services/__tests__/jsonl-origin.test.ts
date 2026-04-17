import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseOriginFromLines, isCoderJsonl } from '../jsonl-origin.service.js';

describe('parseOriginFromLines — Phase L B2 refinement', () => {
  test('coder JSONL first record → agentName + teamName extracted', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        teamName: 'jlp-patrimonio',
        agentName: 'coder',
        sessionId: '1449747a-4ff1-48f5-a49f-210405c1cfe5',
        cwd: '/Users/test/codeman-cases/JLFamily',
      }),
    ];
    const origin = parseOriginFromLines(lines);
    assert.ok(origin);
    assert.equal(origin!.agentName, 'coder');
    assert.equal(origin!.teamName, 'jlp-patrimonio');
    assert.equal(origin!.claudeSessionId, '1449747a-4ff1-48f5-a49f-210405c1cfe5');
    assert.equal(origin!.cwd, '/Users/test/codeman-cases/JLFamily');
  });

  test('PM JSONL → agentName is null, teamName present', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        teamName: 'jstudio-commander',
        sessionId: '6073138e-507d-4adb-a253-cf7d1f9bea03',
        cwd: '/Users/test/codeman-cases/JStudioCommand',
      }),
    ];
    const origin = parseOriginFromLines(lines);
    assert.ok(origin);
    assert.equal(origin!.agentName, null);
    assert.equal(origin!.teamName, 'jstudio-commander');
  });

  test('malformed first line → falls through to second', () => {
    const lines = [
      '{broken json',
      JSON.stringify({ type: 'user', agentName: 'coder' }),
    ];
    const origin = parseOriginFromLines(lines);
    assert.ok(origin);
    assert.equal(origin!.agentName, 'coder');
  });

  test('all lines malformed → null', () => {
    assert.equal(parseOriginFromLines(['{nope', 'also bad', 'not json']), null);
  });

  test('empty input → null', () => {
    assert.equal(parseOriginFromLines([]), null);
  });

  test('scan cap: stops at first parseable record even if later lines have more fields', () => {
    // First record has partial fields; second record has the full set.
    // We do NOT continue scanning past the first parseable line — the
    // first record's header fields define the origin.
    const lines = [
      JSON.stringify({ type: 'user', teamName: 'a' }),
      JSON.stringify({ type: 'user', teamName: 'b', agentName: 'coder' }),
    ];
    const origin = parseOriginFromLines(lines);
    assert.ok(origin);
    assert.equal(origin!.teamName, 'a');
    assert.equal(origin!.agentName, null);
  });
});

describe('isCoderJsonl', () => {
  test('origin with agentName → true', () => {
    assert.equal(isCoderJsonl({ agentName: 'coder', teamName: 't', claudeSessionId: null, cwd: null }), true);
  });
  test('origin with no agentName → false', () => {
    assert.equal(isCoderJsonl({ agentName: null, teamName: 't', claudeSessionId: null, cwd: null }), false);
  });
  test('null origin → false', () => {
    assert.equal(isCoderJsonl(null), false);
  });
});

// ============================================================================
// Phase L B2 refinement — coder-team-rotation SQL binds coder events to
// the right session when the cwd is shared with a PM.
// ============================================================================

const CODER_TEAM_ROTATION_SQL = `SELECT id FROM sessions
 WHERE project_path = ?
   AND status != 'stopped'
   AND team_name = ?
   AND (agent_role IS NULL OR agent_role != 'lead-pm')`;

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      team_name TEXT,
      agent_role TEXT,
      claude_session_id TEXT,
      transcript_paths TEXT NOT NULL DEFAULT '[]'
    );
  `);
};

describe('coder-team-rotation SQL — Phase L B2 refinement', () => {
  test('PM + single coder in cwd → cwd fallback binds to CODER (not PM)', () => {
    // The cross-session-leak scenario the user reported: coder tool_use
    // events land in the PM's chat view because cwd-fallback picks the
    // first row (often the PM) regardless of the JSONL origin. This test
    // encodes the REGRESSION GUARD: with the role-scoped query, a coder
    // JSONL never resolves to the lead-pm row.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/codeman-cases/JStudioCommand';
    const insert = db.prepare(
      "INSERT INTO sessions (id, project_path, status, team_name, agent_role) VALUES (?, ?, 'idle', ?, ?)",
    );
    insert.run('6073138e-507d-4adb-a253-cf7d1f9bea03', cwd, 'jstudio-commander', 'lead-pm');
    insert.run('coder-11@jstudio-commander', cwd, 'jstudio-commander', 'general-purpose');

    const rows = db.prepare(CODER_TEAM_ROTATION_SQL).all(cwd, 'jstudio-commander') as Array<{ id: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'coder-11@jstudio-commander');
    db.close();
  });

  test('multiple coders in team → 2 matches (caller drops to skip for safety)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/shared';
    const insert = db.prepare(
      "INSERT INTO sessions (id, project_path, status, team_name, agent_role) VALUES (?, ?, 'idle', ?, ?)",
    );
    insert.run('coder-11@team', cwd, 'team', 'general-purpose');
    insert.run('coder-12@team', cwd, 'team', 'general-purpose');
    insert.run('lead@team', cwd, 'team', 'lead-pm');

    const rows = db.prepare(CODER_TEAM_ROTATION_SQL).all(cwd, 'team') as Array<{ id: string }>;
    assert.equal(rows.length, 2);
    db.close();
  });

  test('team_name mismatch → 0 matches', () => {
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/shared';
    const insert = db.prepare(
      "INSERT INTO sessions (id, project_path, status, team_name, agent_role) VALUES (?, ?, 'idle', ?, ?)",
    );
    insert.run('coder-1@team-a', cwd, 'team-a', 'general-purpose');

    const rows = db.prepare(CODER_TEAM_ROTATION_SQL).all(cwd, 'team-b') as Array<{ id: string }>;
    assert.equal(rows.length, 0);
    db.close();
  });

  test('legacy rows with NULL agent_role → eligible (treated as coder-eligible)', () => {
    // Back-compat: rows created before agent_role column existed have
    // NULL. These should NOT be excluded by the role filter — the
    // predicate reads `agent_role IS NULL OR agent_role != 'lead-pm'`.
    const db = new Database(':memory:');
    createSchema(db);
    const cwd = '/Users/test/legacy';
    const insert = db.prepare(
      "INSERT INTO sessions (id, project_path, status, team_name, agent_role) VALUES (?, ?, 'idle', ?, ?)",
    );
    insert.run('legacy@team', cwd, 'team', null);

    const rows = db.prepare(CODER_TEAM_ROTATION_SQL).all(cwd, 'team') as Array<{ id: string }>;
    assert.equal(rows.length, 1);
    db.close();
  });
});
