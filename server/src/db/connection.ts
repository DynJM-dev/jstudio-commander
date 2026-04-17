import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export const getDb = (): Database.Database => {
  if (db) return db;

  // Ensure data directory exists
  mkdirSync(config.dataDir, { recursive: true });

  db = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'transcript_path')) {
    db.exec('ALTER TABLE sessions ADD COLUMN transcript_path TEXT');
    console.log('[db] Migration: added transcript_path column to sessions');
  }
  if (!cols.some((c) => c.name === 'effort_level')) {
    db.exec("ALTER TABLE sessions ADD COLUMN effort_level TEXT DEFAULT 'xhigh'");
    console.log('[db] Migration: added effort_level column to sessions');
  }
  if (!cols.some((c) => c.name === 'parent_session_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN parent_session_id TEXT');
    console.log('[db] Migration: added parent_session_id column to sessions');
  }
  if (!cols.some((c) => c.name === 'team_name')) {
    db.exec('ALTER TABLE sessions ADD COLUMN team_name TEXT');
    console.log('[db] Migration: added team_name column to sessions');
  }
  if (!cols.some((c) => c.name === 'session_type')) {
    db.exec("ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'raw'");
    console.log('[db] Migration: added session_type column to sessions');
  }
  if (!cols.some((c) => c.name === 'transcript_paths')) {
    db.exec("ALTER TABLE sessions ADD COLUMN transcript_paths TEXT NOT NULL DEFAULT '[]'");
    console.log('[db] Migration: added transcript_paths column to sessions');
  }
  // Phase N.0 Patch 3 — heartbeat timestamp (epoch ms). Every inbound
  // signal (hook event, statusline tick, chokidar JSONL append, status-
  // poller write) bumps this via sessionService.bumpLastActivity so the
  // UI can render a "Xs ago" proof-of-life + force-display idle after
  // the 30s stale threshold.
  if (!cols.some((c) => c.name === 'last_activity_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0');
    console.log('[db] Migration: added last_activity_at column to sessions');
  }

  // #230 — project tech-stack pills + recent commits persistence.
  const projCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projCols.some((c) => c.name === 'stack_json')) {
    db.exec("ALTER TABLE projects ADD COLUMN stack_json TEXT NOT NULL DEFAULT '[]'");
    console.log('[db] Migration: added stack_json column to projects');
  }
  if (!projCols.some((c) => c.name === 'recent_commits_json')) {
    db.exec("ALTER TABLE projects ADD COLUMN recent_commits_json TEXT NOT NULL DEFAULT '[]'");
    console.log('[db] Migration: added recent_commits_json column to projects');
  }

  // Phase E heal: promote ALL sessions whose effort is still at the
  // pre-migration 'low' / 'medium' to 'xhigh' — SKILL.md's effort
  // matrix is now high|xhigh|max, and the narrowed EffortLevel type
  // can't represent the legacy values. Earlier 24h-bounded heal was
  // superseded; any remaining rows from that era get swept here.
  // Idempotent: once a row is flipped it won't match the predicate
  // on subsequent boots.
  const healed = db.prepare(
    `UPDATE sessions
     SET effort_level = 'xhigh'
     WHERE effort_level IN ('medium','low')
        OR effort_level IS NULL`,
  ).run();
  if (healed.changes > 0) {
    console.log(`[db] Migration: healed ${healed.changes} legacy session(s) to effort=xhigh`);
  }

  // Key/value preference store — replaces ad-hoc localStorage on the
  // client so layout, sidebar, and split-pane state survive across
  // browsers and devices.
  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Phase M — per-session telemetry ticks from Claude Code's statusline.
  // One row per Commander session id (upsert-latest-wins); raw_json is
  // retained so forward-compat fields can be surfaced without a schema
  // migration. `session_id` is the Commander session.id (joined from the
  // claude_session_id via the resolveOwner cascade before insert), NOT
  // the raw Claude UUID.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_ticks (
      session_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      claude_session_id TEXT,
      context_used_pct REAL,
      context_window_size INTEGER,
      remaining_pct REAL,
      cost_usd REAL,
      total_duration_ms INTEGER,
      total_api_duration_ms INTEGER,
      total_lines_added INTEGER,
      total_lines_removed INTEGER,
      total_input_tokens INTEGER,
      total_output_tokens INTEGER,
      model_id TEXT,
      model_display_name TEXT,
      worktree TEXT,
      cwd TEXT,
      five_hour_pct REAL,
      five_hour_resets_at TEXT,
      seven_day_pct REAL,
      seven_day_resets_at TEXT,
      exceeds_200k INTEGER,
      version TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_ticks_updated_at ON session_ticks(updated_at);
  `);

  console.log(`[db] SQLite database ready at ${config.dbPath}`);
  return db;
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
    console.log('[db] Database connection closed');
  }
};
