import { getDb } from '../db/connection.js';

// Values are stored JSON-stringified so the column can hold arbitrary
// shapes (booleans, numbers, objects, arrays) without per-key schema.

export const preferencesService = {
  get<T = unknown>(key: string): T | null {
    const db = getDb();
    const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      // Corrupted entry — treat as missing rather than crashing the request.
      return null;
    }
  },

  set<T = unknown>(key: string, value: T): void {
    const db = getDb();
    const serialized = JSON.stringify(value);
    db.prepare(`
      INSERT INTO preferences (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, serialized);
  },

  delete(key: string): void {
    const db = getDb();
    db.prepare('DELETE FROM preferences WHERE key = ?').run(key);
  },
};
