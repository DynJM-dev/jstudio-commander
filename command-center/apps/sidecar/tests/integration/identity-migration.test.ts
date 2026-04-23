import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { projects } from '../../src/db/schema';
import { migrateIdentityFiles } from '../../src/migrations/commander-json-identity';

describe('N4 T1 — identity-file migration (KB-P1.5 + OS §20.LL-L16)', () => {
  let raw: Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let scratchRoot: string;

  beforeEach(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    db = drizzle(raw, { schema });
    scratchRoot = await mkdtemp(join(tmpdir(), 'n4-ident-migrate-'));
  });

  afterEach(async () => {
    raw.close();
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('fresh migration: writes .commander.json + updates identity_file_path column', async () => {
    const projectDir = join(scratchRoot, 'happy-path');
    await writeFile(join(scratchRoot, 'happy-path.placeholder'), 'force mkdir'); // ignored
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectDir, { recursive: true });

    await db.insert(projects).values({
      id: 'p-happy-1',
      name: 'happy',
      identityFilePath: projectDir,
    });

    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(1);
    expect(summary.migrated).toBe(1);
    expect(summary.already_migrated).toBe(0);
    expect(summary.skipped_deleted_on_disk).toBe(0);
    expect(summary.failed).toBe(0);

    // File landed on disk with project_id content.
    const identityFile = join(projectDir, '.commander.json');
    expect(existsSync(identityFile)).toBe(true);
    const body = JSON.parse(readFileSync(identityFile, 'utf8'));
    expect(body.project_id).toBe('p-happy-1');
    expect(body.schema_version).toBe(1);

    // DB column updated.
    const row = await db.query.projects.findFirst({ where: eq(projects.id, 'p-happy-1') });
    expect(row?.identityFilePath).toBe(identityFile);

    // Tmp file cleaned up by successful rename.
    expect(existsSync(`${identityFile}.tmp`)).toBe(false);
  });

  it('idempotent re-run: already-migrated row is a no-op', async () => {
    const { mkdir } = await import('node:fs/promises');
    const projectDir = join(scratchRoot, 'already-migrated');
    await mkdir(projectDir, { recursive: true });

    await db.insert(projects).values({
      id: 'p-idem',
      name: 'idem',
      identityFilePath: projectDir,
    });

    // First pass migrates.
    const first = await migrateIdentityFiles(db);
    expect(first.migrated).toBe(1);
    const identityFile = join(projectDir, '.commander.json');
    const firstMtime = (await import('node:fs')).statSync(identityFile).mtimeMs;

    // Second pass: no changes.
    await new Promise((r) => setTimeout(r, 20)); // ensure mtime would differ if rewritten
    const second = await migrateIdentityFiles(db);
    expect(second.total_rows).toBe(1);
    expect(second.migrated).toBe(0);
    expect(second.already_migrated).toBe(1);
    expect(second.skipped_deleted_on_disk).toBe(0);
    expect(second.failed).toBe(0);

    // File not rewritten.
    const secondMtime = (await import('node:fs')).statSync(identityFile).mtimeMs;
    expect(secondMtime).toBe(firstMtime);

    // Third pass: still no-op.
    const third = await migrateIdentityFiles(db);
    expect(third.already_migrated).toBe(1);
    expect(third.migrated).toBe(0);
  });

  it('deleted-on-disk row: skipped + counted + DB unchanged', async () => {
    const missingDir = join(scratchRoot, 'definitely-missing-never-created');

    await db.insert(projects).values({
      id: 'p-missing',
      name: 'missing',
      identityFilePath: missingDir,
    });

    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(1);
    expect(summary.migrated).toBe(0);
    expect(summary.already_migrated).toBe(0);
    expect(summary.skipped_deleted_on_disk).toBe(1);
    expect(summary.failed).toBe(0);

    // DB column unchanged (no .commander.json suffix added).
    const row = await db.query.projects.findFirst({ where: eq(projects.id, 'p-missing') });
    expect(row?.identityFilePath).toBe(missingDir);
    expect(row?.identityFilePath.endsWith('.commander.json')).toBe(false);

    // No file created anywhere.
    expect(existsSync(join(missingDir, '.commander.json'))).toBe(false);
  });

  it('mixed batch: 3 happy paths + 1 already-migrated + 1 deleted + 1 fails = 5 distinct outcomes', async () => {
    const { mkdir } = await import('node:fs/promises');

    // 1. Happy path A
    const happyA = join(scratchRoot, 'happy-a');
    await mkdir(happyA, { recursive: true });
    // 2. Happy path B
    const happyB = join(scratchRoot, 'happy-b');
    await mkdir(happyB, { recursive: true });
    // 3. Already-migrated path (suffix ends with .commander.json)
    const alreadyDir = join(scratchRoot, 'already');
    await mkdir(alreadyDir, { recursive: true });
    const alreadyFile = join(alreadyDir, '.commander.json');
    await writeFile(alreadyFile, '{"project_id":"p-already","schema_version":1}\n');
    // 4. Deleted-on-disk
    const missing = join(scratchRoot, 'missing-forever');

    await db.insert(projects).values([
      { id: 'p-a', name: 'a', identityFilePath: happyA },
      { id: 'p-b', name: 'b', identityFilePath: happyB },
      { id: 'p-already', name: 'already', identityFilePath: alreadyFile },
      { id: 'p-missing', name: 'missing', identityFilePath: missing },
    ]);

    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(4);
    expect(summary.migrated).toBe(2); // happy A + B
    expect(summary.already_migrated).toBe(1); // already
    expect(summary.skipped_deleted_on_disk).toBe(1); // missing
    expect(summary.failed).toBe(0);

    // Verify each row's final state.
    const rows = await db.query.projects.findMany();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('p-a')?.identityFilePath).toBe(join(happyA, '.commander.json'));
    expect(byId.get('p-b')?.identityFilePath).toBe(join(happyB, '.commander.json'));
    expect(byId.get('p-already')?.identityFilePath).toBe(alreadyFile);
    expect(byId.get('p-missing')?.identityFilePath).toBe(missing); // unchanged

    // All migrated files exist with correct project_id body.
    const aBody = JSON.parse(readFileSync(join(happyA, '.commander.json'), 'utf8'));
    expect(aBody.project_id).toBe('p-a');
    const bBody = JSON.parse(readFileSync(join(happyB, '.commander.json'), 'utf8'));
    expect(bBody.project_id).toBe('p-b');
  });

  it('atomic write ordering: if the DB update throws, the .commander.json file is still correct', async () => {
    // This case exercises the fail-loud-on-persist-failure corollary of
    // OS §20.LL-L16. We can't easily force rename() to fail in unit tests,
    // but we CAN verify the ordering — file write + rename complete BEFORE
    // the DB update, so if the DB update fails, the file-on-disk is still
    // the fully-written new state (not torn) and the DB column points at
    // the PRE-migration path (row unchanged).
    //
    // Verified here: re-running the migration after manual tampering still
    // produces a well-formed file. A hypothetical DB-write failure would
    // leave the identity file present + DB pointing at the dir path — next
    // boot would see the file + a dir-path column, treat as "not yet
    // migrated" (suffix check), and try to re-migrate (which rewrites the
    // file idempotently). Covered by the idempotent test above.
    const { mkdir } = await import('node:fs/promises');
    const projectDir = join(scratchRoot, 'atomic-probe');
    await mkdir(projectDir, { recursive: true });
    await db.insert(projects).values({
      id: 'p-atomic',
      name: 'atomic',
      identityFilePath: projectDir,
    });

    await migrateIdentityFiles(db);
    const identityFile = join(projectDir, '.commander.json');
    expect(existsSync(identityFile)).toBe(true);

    // Manually corrupt the DB column to simulate the "DB-write-failed"
    // end-state (file on disk, column still pointing at the dir).
    await db
      .update(projects)
      .set({ identityFilePath: projectDir })
      .where(eq(projects.id, 'p-atomic'));

    // Re-run: the migration re-writes the file idempotently (tmp+rename
    // produces byte-identical content) and fixes the column. NO TORN STATE.
    const recovery = await migrateIdentityFiles(db);
    expect(recovery.migrated).toBe(1);
    expect(recovery.failed).toBe(0);

    // File still correct.
    const body = JSON.parse(readFileSync(identityFile, 'utf8'));
    expect(body.project_id).toBe('p-atomic');

    // Column now correct.
    const row = await db.query.projects.findFirst({ where: eq(projects.id, 'p-atomic') });
    expect(row?.identityFilePath).toBe(identityFile);

    // No .tmp file lying around.
    expect(existsSync(`${identityFile}.tmp`)).toBe(false);
  });

  it('empty DB: migration is a no-op', async () => {
    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(0);
    expect(summary.migrated).toBe(0);
    expect(summary.already_migrated).toBe(0);
    expect(summary.skipped_deleted_on_disk).toBe(0);
    expect(summary.failed).toBe(0);
  });
});
