// Migration runner — loads SQL files in lexical order, applied atomically
// on first launch. Per ARCHITECTURE_SPEC v1.2 §3, subsequent launches detect
// existing database via the migrations table and skip already-applied files.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  INTEGER NOT NULL
  );
`;

export interface MigrationFile {
  name: string;
  path: string;
  sql: string;
}

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      path: join(dir, name),
      sql: readFileSync(join(dir, name), 'utf8'),
    }));
}

export function applyMigrations(db: Database.Database, dir = MIGRATIONS_DIR): string[] {
  db.exec(MIGRATIONS_TABLE);
  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );
  const newlyApplied: string[] = [];
  const record = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  // Apply each migration in its own transaction. Stop on first failure.
  for (const m of listMigrations(dir)) {
    if (applied.has(m.name)) continue;
    const runTx = db.transaction(() => {
      db.exec(m.sql);
      record.run(m.name, Date.now());
    });
    runTx();
    newlyApplied.push(m.name);
  }

  return newlyApplied;
}
