// First-run DB initialization: creates ~/.jstudio-commander-v1/ if missing,
// opens commander.db, runs migrations, seeds session_types.
// ARCHITECTURE_SPEC v1.2 §3.1 + dispatch §3 Task 3 acceptance.

import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { applyMigrations } from './migrations/index.js';

export const DEFAULT_DB_DIR = join(homedir(), '.jstudio-commander-v1');
export const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'commander.db');

export interface InitializedDb {
  raw: Database.Database;
  drizzle: BetterSQLite3Database<typeof schema>;
  migrationsApplied: string[];
  dbPath: string;
}

export interface InitOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export function initDatabase(opts: InitOptions = {}): InitializedDb {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
  }

  const raw = new Database(dbPath);
  raw.pragma('foreign_keys = ON');
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');

  const migrationsApplied = applyMigrations(raw, opts.migrationsDir);

  return {
    raw,
    drizzle: drizzle(raw, { schema }),
    migrationsApplied,
    dbPath,
  };
}

export { schema };
