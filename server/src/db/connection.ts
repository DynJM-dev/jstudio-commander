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
