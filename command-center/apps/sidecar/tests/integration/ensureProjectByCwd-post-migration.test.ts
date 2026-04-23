import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { projects } from '../../src/db/schema';
import { ensureProjectByCwd } from '../../src/services/projects';

/**
 * N4a.1 H2 — ensureProjectByCwd dual-form lookup + canonical insert.
 *
 * Coverage gap that let Debt 24 reach Jose's smoke (PHASE_N4_REPORT §4 D3):
 * prior ensureProjectByCwd tests only exercised the first-call insert path.
 * Nothing verified that a SECOND call against a cwd whose row has already
 * gone through T1 migration (column flipped to `.commander.json` form)
 * returns the existing row instead of creating a duplicate.
 */

describe('N4a.1 H2 — ensureProjectByCwd post-migration dual-form lookup', () => {
  let raw: Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let scratchRoot: string;

  beforeEach(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    db = drizzle(raw, { schema });
    scratchRoot = await mkdtemp(join(tmpdir(), 'n4a1-h2-'));
  });

  afterEach(async () => {
    raw.close();
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('post-migration row (canonical form): second call returns existing row, no duplicate insert', async () => {
    const cwd = join(scratchRoot, 'already-migrated');
    await mkdir(cwd, { recursive: true });

    // Seed a post-migration row directly (simulating prior T1 run).
    await db.insert(projects).values({
      id: 'p-canonical-1',
      name: 'already-migrated',
      identityFilePath: join(cwd, '.commander.json'),
    });

    const before = (await db.query.projects.findMany()).length;
    expect(before).toBe(1);

    const row = await ensureProjectByCwd(db, cwd);
    expect(row.id).toBe('p-canonical-1');
    expect(row.identityFilePath).toBe(join(cwd, '.commander.json'));

    const after = (await db.query.projects.findMany()).length;
    expect(after).toBe(1); // no duplicate created
  });

  it('pre-migration row (raw-cwd form): second call returns existing row via fallback lookup', async () => {
    const cwd = join(scratchRoot, 'pre-migrated');
    await mkdir(cwd, { recursive: true });

    await db.insert(projects).values({
      id: 'p-legacy-1',
      name: 'pre-migrated',
      identityFilePath: cwd, // raw-cwd form (legacy N2/N3 shape)
    });

    const row = await ensureProjectByCwd(db, cwd);
    expect(row.id).toBe('p-legacy-1');
    expect(row.identityFilePath).toBe(cwd); // unchanged

    const all = await db.query.projects.findMany();
    expect(all.length).toBe(1);
  });

  it('first-call insert (cwd exists): creates canonical row + writes .commander.json', async () => {
    const cwd = join(scratchRoot, 'fresh');
    await mkdir(cwd, { recursive: true });

    const row = await ensureProjectByCwd(db, cwd);
    expect(row.identityFilePath).toBe(join(cwd, '.commander.json'));
    expect(row.name).toBe('fresh');
    expect(existsSync(join(cwd, '.commander.json'))).toBe(true);

    // File body matches the DB row's project_id.
    const body = JSON.parse(readFileSync(join(cwd, '.commander.json'), 'utf8'));
    expect(body.project_id).toBe(row.id);
    expect(body.schema_version).toBe(1);
  });

  it('first-call insert (cwd does NOT exist): falls back to raw-cwd form, no disk write', async () => {
    // Synthetic path that doesn't exist on disk — e.g. a fabricated hook
    // payload in tests or a stale session pointing at a deleted dir.
    const cwd = join(scratchRoot, 'definitely-missing');
    // NB: we deliberately do NOT mkdir(cwd).

    const row = await ensureProjectByCwd(db, cwd);
    expect(row.identityFilePath).toBe(cwd); // raw-cwd form
    expect(existsSync(cwd)).toBe(false); // we did NOT resurrect the dir
    expect(existsSync(join(cwd, '.commander.json'))).toBe(false);
  });

  it('concurrent ensureProjectByCwd(same cwd) calls: both succeed + return same row', async () => {
    const cwd = join(scratchRoot, 'concurrent');
    await mkdir(cwd, { recursive: true });

    // Promise.all triggers the UNIQUE-constraint race path on second INSERT.
    // Race guard catches + re-queries + returns winner's row.
    const [a, b] = await Promise.all([ensureProjectByCwd(db, cwd), ensureProjectByCwd(db, cwd)]);
    expect(a.id).toBe(b.id); // both calls returned the same row
    expect(a.identityFilePath).toBe(join(cwd, '.commander.json'));

    const all = await db.query.projects.findMany();
    expect(all.length).toBe(1);

    // File exists + content matches the winning row's id.
    const body = JSON.parse(readFileSync(join(cwd, '.commander.json'), 'utf8'));
    expect(body.project_id).toBe(a.id);
  });
});
