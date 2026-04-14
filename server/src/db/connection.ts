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
