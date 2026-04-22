import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from './init.js';

describe('db/init — first-run migration + seed', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jstudio-db-test-'));
    dbPath = join(tmpDir, 'commander.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates DB dir if missing and opens file', () => {
    const db = initDatabase({ dbPath });
    expect(db.dbPath).toBe(dbPath);
    db.raw.close();
  });

  it('applies both migrations on first launch and records them in _migrations', () => {
    const db = initDatabase({ dbPath });
    expect(db.migrationsApplied).toEqual(['0001_init.sql', '0002_seed_session_types.sql']);
    const rows = db.raw.prepare('SELECT name FROM _migrations ORDER BY name').all();
    expect(rows).toEqual([{ name: '0001_init.sql' }, { name: '0002_seed_session_types.sql' }]);
    db.raw.close();
  });

  it('is idempotent — second launch applies nothing', () => {
    initDatabase({ dbPath }).raw.close();
    const second = initDatabase({ dbPath });
    expect(second.migrationsApplied).toEqual([]);
    second.raw.close();
  });

  it('creates every table from ARCHITECTURE_SPEC v1.2 §10 (plus _migrations bookkeeping)', () => {
    const db = initDatabase({ dbPath });
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'session_events_fts%'")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(tables).toEqual([
      '_migrations',
      'approval_prompts',
      'cost_entries',
      'preferences',
      'projects',
      'session_events',
      'session_types',
      'sessions',
      'three_role_links',
      'tool_events',
      'workspace_panes',
      'workspaces',
    ].sort());
    db.raw.close();
  });

  it('creates PM v1.2 fold indexes: idx_session_events_session_type + uidx_workspace_pane_slot', () => {
    const db = initDatabase({ dbPath });
    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indexes).toContain('idx_session_events_session_type');
    expect(indexes).toContain('uidx_workspace_pane_slot');
    expect(indexes).toContain('uidx_cost_session_turn');
    expect(indexes).toContain('idx_sessions_active_status'); // partial index
    db.raw.close();
  });

  it('creates FTS5 virtual table for session_events.payload', () => {
    const db = initDatabase({ dbPath });
    const row = db.raw
      .prepare("SELECT sql FROM sqlite_master WHERE name='session_events_fts'")
      .get() as { sql: string } | undefined;
    expect(row?.sql).toMatch(/fts5/i);
    expect(row?.sql).toMatch(/payload/);
    db.raw.close();
  });

  it('FTS5 sync triggers mirror session_events inserts', () => {
    const db = initDatabase({ dbPath });
    // Seed a minimal parent chain so the FK passes.
    const now = Date.now();
    db.raw.prepare(
      'INSERT INTO projects (id,name,path,type,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).run('p1', 'probe', '/tmp/p1', 'other', now, now);
    db.raw.prepare(
      'INSERT INTO sessions (id,project_id,session_type_id,effort,status,cwd,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run('s1', 'p1', 'pm', 'high', 'active', '/tmp/p1', now, now);
    db.raw.prepare(
      'INSERT INTO session_events (id,session_id,event_type,payload,timestamp,created_at) VALUES (?,?,?,?,?,?)',
    ).run('e1', 's1', 'pty:data', 'unique_fts_probe_token_azalea', now, now);
    const hits = db.raw
      .prepare("SELECT id FROM session_events_fts WHERE session_events_fts MATCH 'unique_fts_probe_token_azalea'")
      .all();
    expect(hits).toHaveLength(1);
    db.raw.close();
  });

  it('seeds session_types with canonical pm/coder/raw rows', () => {
    const db = initDatabase({ dbPath });
    const rows = db.raw
      .prepare('SELECT id, label, bootstrap_path, effort_default, sort_order FROM session_types ORDER BY sort_order')
      .all() as Array<{ id: string; label: string; bootstrap_path: string | null; effort_default: string; sort_order: number }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'pm', label: 'PM', effort_default: 'high', sort_order: 1 });
    expect(rows[0]?.bootstrap_path).toMatch(/pm-session-bootstrap\.md$/);
    expect(rows[1]).toMatchObject({ id: 'coder', label: 'Coder', effort_default: 'medium', sort_order: 2 });
    expect(rows[1]?.bootstrap_path).toMatch(/coder-session-bootstrap\.md$/);
    expect(rows[2]).toMatchObject({ id: 'raw', label: 'Raw', bootstrap_path: null, effort_default: 'medium', sort_order: 3 });
    db.raw.close();
  });

  it('UNIQUE (session_id, turn_index) constraint on cost_entries blocks duplicates', () => {
    const db = initDatabase({ dbPath });
    const now = Date.now();
    db.raw.prepare('INSERT INTO projects (id,name,path,type,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('p1', 'probe', '/tmp/p1', 'other', now, now);
    db.raw.prepare('INSERT INTO sessions (id,project_id,session_type_id,effort,status,cwd,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('s1', 'p1', 'pm', 'high', 'active', '/tmp/p1', now, now);
    db.raw.prepare('INSERT INTO cost_entries (id,session_id,model,cost_usd,turn_index,timestamp,created_at) VALUES (?,?,?,?,?,?,?)').run('c1', 's1', 'claude-opus-4-7', 0.1, 1, now, now);
    expect(() =>
      db.raw.prepare('INSERT INTO cost_entries (id,session_id,model,cost_usd,turn_index,timestamp,created_at) VALUES (?,?,?,?,?,?,?)').run('c2', 's1', 'claude-opus-4-7', 0.2, 1, now, now),
    ).toThrow(/UNIQUE/i);
    db.raw.close();
  });

  it('UNIQUE (workspace_id, pane_index) blocks duplicate pane slots', () => {
    const db = initDatabase({ dbPath });
    const now = Date.now();
    db.raw.prepare('INSERT INTO workspaces (id,name,layout_json,is_current,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('w1', 'default', '{}', 1, now, now);
    db.raw.prepare('INSERT INTO workspace_panes (id,workspace_id,pane_index) VALUES (?,?,?)').run('wp1', 'w1', 0);
    expect(() =>
      db.raw.prepare('INSERT INTO workspace_panes (id,workspace_id,pane_index) VALUES (?,?,?)').run('wp2', 'w1', 0),
    ).toThrow(/UNIQUE/i);
    db.raw.close();
  });
});
