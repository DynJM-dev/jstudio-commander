import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { hookEvents, projects, tasks } from '../../src/db/schema';
import {
  SYSTEM_BOOT_SESSION_ID,
  migrateIdentityFiles,
} from '../../src/migrations/commander-json-identity';

/**
 * N4a.1 H3 — T1 migration UNIQUE-collision dedup + forensic trail.
 *
 * Mirrors the production scenario that caused Jose's smoke boot-halt:
 * pre-N4a.1 `ensureProjectByCwd` inserted duplicate rows at raw-cwd form
 * after a prior migration had already created a `.commander.json` canonical
 * row. Next boot's migration would hit `UNIQUE constraint failed` on
 * `projects_identity_path_unique` → exit code 4.
 *
 * Codified behavior:
 *   - Zero-dependent duplicate → safe DELETE + forensic hook_events row + summary.deduplicated++.
 *   - Duplicate with dependents → summary.failed++ (halt) + NO dedup + NO forensic row.
 */

describe('N4a.1 H3 — migration dedup UNIQUE collision handling', () => {
  let raw: Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let scratchRoot: string;

  beforeEach(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    db = drizzle(raw, { schema });
    scratchRoot = await mkdtemp(join(tmpdir(), 'n4a1-dedup-'));
  });

  afterEach(async () => {
    raw.close();
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('zero-dependent duplicate: drops duplicate, keeps canonical, emits forensic event', async () => {
    const cwd = join(scratchRoot, 'dedup-zero-deps');
    await mkdir(cwd, { recursive: true });

    // Pre-existing canonical row (from a prior migration run).
    await db.insert(projects).values({
      id: 'p-canonical',
      name: 'canonical',
      identityFilePath: join(cwd, '.commander.json'),
    });
    // File on disk (would have been written by prior migration).
    await writeFile(
      join(cwd, '.commander.json'),
      `${JSON.stringify({ project_id: 'p-canonical', schema_version: 1 }, null, 2)}\n`,
    );

    // Duplicate row at raw-cwd form (from pre-N4a.1 ensureProjectByCwd bug).
    await db.insert(projects).values({
      id: 'p-duplicate-zero',
      name: 'dedup-zero-deps',
      identityFilePath: cwd,
    });

    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(2);
    expect(summary.already_migrated).toBe(1); // canonical
    expect(summary.deduplicated).toBe(1); // duplicate dropped
    expect(summary.migrated).toBe(0);
    expect(summary.failed).toBe(0);

    // Duplicate row gone.
    const rows = await db.query.projects.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe('p-canonical');

    // Forensic trail row exists.
    const events = await db.query.hookEvents.findMany({
      where: eq(hookEvents.eventName, 'system:migration-dedup'),
    });
    expect(events.length).toBe(1);
    const payload = events[0]?.payloadJson as {
      dropped_project_id: string;
      cwd: string;
      canonical_project_id: string;
      reason: string;
    };
    expect(payload.dropped_project_id).toBe('p-duplicate-zero');
    expect(payload.canonical_project_id).toBe('p-canonical');
    expect(payload.cwd).toBe(cwd);
    expect(payload.reason).toContain('ensureProjectByCwd');

    // Sentinel session was seeded.
    const sentinel = await db.query.sessions.findFirst({
      where: (s, { eq: e }) => e(s.id, SYSTEM_BOOT_SESSION_ID),
    });
    expect(sentinel).toBeDefined();
    expect(sentinel?.cwd).toBe('<system>');
  });

  it('duplicate WITH dependent tasks: halts, no dedup, no forensic row', async () => {
    const cwd = join(scratchRoot, 'dedup-has-deps');
    await mkdir(cwd, { recursive: true });

    await db.insert(projects).values({
      id: 'p-canonical-2',
      name: 'canonical-2',
      identityFilePath: join(cwd, '.commander.json'),
    });
    await db.insert(projects).values({
      id: 'p-dup-with-deps',
      name: 'dup-has-deps',
      identityFilePath: cwd,
    });
    // Attach a dependent task to the duplicate — manual merge required.
    await db.insert(tasks).values({
      id: 't-on-duplicate',
      projectId: 'p-dup-with-deps',
      title: 'task on duplicate project',
      instructionsMd: 'blocks auto-dedup',
    });

    const summary = await migrateIdentityFiles(db);
    expect(summary.total_rows).toBe(2);
    expect(summary.already_migrated).toBe(1);
    expect(summary.deduplicated).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.projectId).toBe('p-dup-with-deps');
    expect(summary.failures[0]?.error).toContain('manual merge');
    expect(summary.failures[0]?.error).toContain('p-dup-with-deps');
    expect(summary.failures[0]?.error).toContain('p-canonical-2');

    // Both rows still present — no auto-delete.
    const rows = await db.query.projects.findMany();
    expect(rows.length).toBe(2);

    // NO forensic row for this collision (nothing was dropped).
    const events = await db.query.hookEvents.findMany({
      where: eq(hookEvents.eventName, 'system:migration-dedup'),
    });
    expect(events.length).toBe(0);
  });

  it('sentinel session is idempotent across reruns', async () => {
    await migrateIdentityFiles(db);
    const firstCount = (
      await db.query.sessions.findMany({
        where: (s, { eq: e }) => e(s.id, SYSTEM_BOOT_SESSION_ID),
      })
    ).length;
    await migrateIdentityFiles(db);
    const secondCount = (
      await db.query.sessions.findMany({
        where: (s, { eq: e }) => e(s.id, SYSTEM_BOOT_SESSION_ID),
      })
    ).length;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
  });
});
