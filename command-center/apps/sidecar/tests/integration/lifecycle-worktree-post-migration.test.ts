import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../../src/config';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { projects, tasks } from '../../src/db/schema';
import { createServer } from '../../src/server';

const TEST_TOKEN = 'n4a1-lifecycle-worktree-token';

/**
 * N4a.1 H1 regression coverage — the end-to-end path that Jose's smoke
 * step 7 exercised: a project whose row has gone through T1 migration
 * (identity_file_path now points at `.commander.json`, not at a directory)
 * must still spawn runs with worktrees materializing under `<cwd>/.worktrees/`,
 * NOT `<cwd>/.commander.json/.worktrees/` (ENOTDIR).
 *
 * Covers the missing coverage explicitly named in §4 D3:
 *   "No test covers the end-to-end path SessionStart hook →
 *    ensureProjectByCwd → migration → spawn_agent_run → createWorktree
 *    on a project that has transitioned through the identity-file format
 *    flip."
 */

describe('N4a.1 H1 — lifecycle spawn uses resolveProjectRoot for migrated row', () => {
  let raw: Database;
  let server: FastifyInstance;
  let baseUrl: string;
  let projectRoot: string;
  let taskId: string;

  const config: SidecarConfig = {
    bearerToken: TEST_TOKEN,
    port: 0,
    version: '0.1.0-n4a1-test',
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    const db = drizzle(raw, { schema });

    // Real git repo at projectRoot so the happy-path `git worktree add`
    // branch is taken.
    projectRoot = await mkdtemp(join(tmpdir(), 'n4a1-lifecycle-'));
    await $`git init -q`.cwd(projectRoot).nothrow();
    await $`git config user.email "test@n4a1.local"`.cwd(projectRoot).nothrow();
    await $`git config user.name  "n4a1-test"`.cwd(projectRoot).nothrow();
    await writeFile(join(projectRoot, 'README.md'), '# n4a1\n');
    await $`git add . && git commit -q -m init`.cwd(projectRoot).nothrow();

    // Seed a project row at the POST-migration form directly (identity_file_path
    // ending in .commander.json). Mimics a row that T1 has already upgraded.
    await db.insert(projects).values({
      id: 'p-migrated-1',
      name: 'migrated-fixture',
      identityFilePath: join(projectRoot, '.commander.json'),
    });

    // Task against that project.
    await db.insert(tasks).values({
      id: 't-migrated-1',
      projectId: 'p-migrated-1',
      title: 'spawn-a-run-against-migrated-project',
      instructionsMd: 'N4a.1 H1 regression test',
    });
    taskId = 't-migrated-1';

    server = createServer({ config, raw, db, logLevel: 'silent' });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await server.close();
    raw.close();
    await $`git worktree prune`.cwd(projectRoot).nothrow();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('spawn_agent_run against task whose project is at .commander.json form succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ task_id: taskId, command: 'echo n4a1-h1-ok' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { id: string; status: string; worktreePath: string | null };
      error?: { code: string; message: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe('running');

    const wt = body.data?.worktreePath;
    expect(typeof wt).toBe('string');
    // Critical regression: worktree must be under projectRoot/.worktrees/,
    // NOT under projectRoot/.commander.json/.worktrees/ (the ENOTDIR bug).
    expect(wt).toContain(`${projectRoot}/.worktrees/run-`);
    expect(wt).not.toContain('/.commander.json/');

    // Wait for the PTY run to hit a terminal state BEFORE afterAll tears
    // down the in-memory DB. The PTY's onExit callback writes agent_runs —
    // if the test returns before that lands, the callback fires against a
    // closed DB (cross-test noise).
    const runId = body.data?.id as string;
    const deadline = Date.now() + 4_000;
    const db = drizzle(raw, { schema });
    while (Date.now() < deadline) {
      const row = await db.query.agentRuns.findFirst({
        where: (r, { eq }) => eq(r.id, runId),
      });
      if (row && row.status !== 'queued' && row.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 30));
    }
  });
});
