// Unit tests for appendRecentPath — move-to-front + 10-entry cap per N2.1 §2.3.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase, preferences } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';
import { appendRecentPath } from './sessions.js';

describe('appendRecentPath', () => {
  let tmp: string;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'recent-'));
    db = initDatabase({ dbPath: join(tmp, 'test.db') });
  });
  afterEach(() => {
    db.raw.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const readList = (): Array<{ path: string; lastUsedAt: number }> => {
    const row = db.drizzle
      .select()
      .from(preferences)
      .where(eq(preferences.key, 'recentProjectPaths'))
      .get();
    if (!row) return [];
    return JSON.parse(row.value) as Array<{ path: string; lastUsedAt: number }>;
  };

  it('inserts first path to a fresh row', async () => {
    await appendRecentPath(db, '/Users/foo/Projects/alpha');
    const list = readList();
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe('/Users/foo/Projects/alpha');
    expect(list[0]!.lastUsedAt).toBeGreaterThan(0);
  });

  it('moves an existing path to the front on repeat use', async () => {
    await appendRecentPath(db, '/a');
    await appendRecentPath(db, '/b');
    await appendRecentPath(db, '/c');
    await appendRecentPath(db, '/a'); // re-touch /a
    const list = readList();
    expect(list.map((e) => e.path)).toEqual(['/a', '/c', '/b']);
  });

  it('caps at 10 entries, dropping the oldest', async () => {
    for (let i = 0; i < 12; i++) {
      await appendRecentPath(db, `/p${i}`);
    }
    const list = readList();
    expect(list).toHaveLength(10);
    // most recent spawn was /p11 → front; oldest two (/p0 and /p1) dropped.
    expect(list[0]!.path).toBe('/p11');
    expect(list[9]!.path).toBe('/p2');
  });

  it('skips empty-string paths silently', async () => {
    await appendRecentPath(db, '');
    expect(readList()).toHaveLength(0);
  });

  it('survives a corrupt existing value without throwing', async () => {
    // Seed a malformed JSON payload.
    db.raw
      .prepare(`INSERT INTO preferences (key, value, scope, updated_at) VALUES (?, ?, 'global', ?)`)
      .run('recentProjectPaths', 'not-json-at-all', Date.now());
    await appendRecentPath(db, '/foo');
    const list = readList();
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe('/foo');
  });
});
