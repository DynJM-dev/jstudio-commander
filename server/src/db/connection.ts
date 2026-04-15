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
    db.exec("ALTER TABLE sessions ADD COLUMN effort_level TEXT DEFAULT 'medium'");
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

  // #188 one-time heal: promote recently-active sessions whose effort was
  // left at 'medium' / 'low' to 'max' so they benefit from the new default
  // without stomping user-chosen values on older rows. Idempotent — once
  // a row is flipped it won't match the predicate on subsequent boots.
  const healed = db.prepare(
    `UPDATE sessions
     SET effort_level = 'max'
     WHERE effort_level IN ('medium','low')
       AND updated_at > datetime('now','-24 hours')`,
  ).run();
  if (healed.changes > 0) {
    console.log(`[db] Migration: promoted ${healed.changes} recent session(s) to effort=max`);
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
