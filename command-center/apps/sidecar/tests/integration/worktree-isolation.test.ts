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
import { createServer } from '../../src/server';

const TEST_TOKEN = 'n3-worktree-test-token';

async function spawnRun(
  baseUrl: string,
  args: Record<string, unknown>,
  id: number,
): Promise<{ id: string; status: string; session_id?: string }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'spawn_agent_run', arguments: args },
      id,
    }),
  });
  const body = (await res.json()) as {
    result?: { content?: Array<{ text: string }> };
  };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
    id: string;
    status: string;
    session_id?: string;
  };
}

describe('N3 T10 — worktree isolation', () => {
  let raw: Database;
  let server: FastifyInstance;
  let baseUrl: string;
  let projectRoot: string;

  const config: SidecarConfig = {
    bearerToken: TEST_TOKEN,
    port: 0,
    version: '0.1.0-n3-test',
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    const db = drizzle(raw, { schema });
    server = createServer({ config, raw, db, logLevel: 'silent' });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    projectRoot = await mkdtemp(join(tmpdir(), 'n3-worktree-project-'));
    await $`git init -q`.cwd(projectRoot).nothrow();
    await $`git config user.email "test@n3.local"`.cwd(projectRoot).nothrow();
    await $`git config user.name  "n3-test"`.cwd(projectRoot).nothrow();
    await writeFile(join(projectRoot, 'README.md'), '# test project\n');
    await $`git add . && git commit -q -m init`.cwd(projectRoot).nothrow();
  });

  afterAll(async () => {
    await server.close();
    raw.close();
    // Clean up any leftover worktrees from prior test runs + the project dir.
    await $`git worktree prune`.cwd(projectRoot).nothrow();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('two concurrent spawns against same project produce distinct worktrees', async () => {
    // Spawn two runs simultaneously, each with a command that lists files.
    const [a, b] = await Promise.all([
      spawnRun(baseUrl, { command: 'sleep 1', cwd_hint: projectRoot }, 1),
      spawnRun(baseUrl, { command: 'sleep 1', cwd_hint: projectRoot }, 2),
    ]);

    expect(a.id).not.toBe(b.id);

    // Both rows should have distinct, non-null worktree paths.
    const rows = raw
      .query<{ id: string; worktree_path: string | null }, []>(
        'SELECT id, worktree_path FROM agent_runs',
      )
      .all();
    const runA = rows.find((r) => r.id === a.id);
    const runB = rows.find((r) => r.id === b.id);

    expect(runA?.worktree_path).toMatch(/\.worktrees\/run-/);
    expect(runB?.worktree_path).toMatch(/\.worktrees\/run-/);
    expect(runA?.worktree_path).not.toBe(runB?.worktree_path);
    // Paths contain the agent_run id suffix (run-<uuid>).
    expect(runA?.worktree_path).toContain(a.id);
    expect(runB?.worktree_path).toContain(b.id);

    // Wait for both to complete before cleanup teardown.
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const pendingRows = raw
        .query<{ n: number }, []>("SELECT COUNT(*) as n FROM agent_runs WHERE status = 'running'")
        .get();
      if (pendingRows && pendingRows.n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});
