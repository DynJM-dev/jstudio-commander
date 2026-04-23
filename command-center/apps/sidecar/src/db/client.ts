import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { CONFIG_DIR, DB_FILE } from '../config';
import * as schema from './schema';
import { BOOT_SCHEMA_SQL } from './schema';

export type CommanderDb = BunSQLiteDatabase<typeof schema>;

export function openDb(): { db: CommanderDb; raw: Database } {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const raw = new Database(DB_FILE);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA synchronous = NORMAL;');
  const db = drizzle(raw, { schema });
  return { db, raw };
}

/**
 * Idempotent boot-time schema materialization. ARCHITECTURE_SPEC §3.3 requires
 * migrations run on sidecar boot BEFORE any query path; migration failure must
 * exit the sidecar with a logged error. Caller invokes this from `main` and
 * handles the throw → process.exit path.
 */
export function runMigrations(raw: Database): void {
  raw.exec(BOOT_SCHEMA_SQL);
}

export function countTables(raw: Database): number {
  const row = raw
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  return row?.n ?? 0;
}

export function listTableNames(raw: Database): string[] {
  const rows = raw
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return rows.map((r) => r.name);
}
