import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../../src/config';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { createServer } from '../../src/server';

const TEST_TOKEN = 'n3-wall-clock-test-token';

describe('N3 T10 — wall-clock-bound integration (KB-P6.15 deterministic)', () => {
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

    projectRoot = await mkdtemp(join(tmpdir(), 'n3-wallclock-project-'));
    await $`git init -q`.cwd(projectRoot).nothrow();
    await $`git config user.email "test@n3.local"`.cwd(projectRoot).nothrow();
    await $`git config user.name  "n3-test"`.cwd(projectRoot).nothrow();
    await $`touch README.md && git add . && git commit -q -m init`.cwd(projectRoot).nothrow();
  });

  afterAll(async () => {
    await server.close();
    raw.close();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('sleep 30 with max_wall_clock_seconds=2 → timed-out within 8s', async () => {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'spawn_agent_run',
          arguments: {
            command: 'sleep 30',
            cwd_hint: projectRoot,
            max_wall_clock_seconds: 2,
          },
        },
        id: 1,
      }),
    });
    const body = (await res.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    const run = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
      id: string;
      status: string;
    };
    expect(run.status).toBe('running');

    // Poll for the terminal state. Budget: 2s bound + 5s grace + 1s slack = 8s.
    const deadline = Date.now() + 8_000;
    let finalStatus: string | null = null;
    let exitReason: string | null = null;
    while (Date.now() < deadline) {
      const row = raw
        .query<{ status: string; exit_reason: string | null }, [string]>(
          'SELECT status, exit_reason FROM agent_runs WHERE id = ?',
        )
        .get(run.id);
      if (row && row.status !== 'running') {
        finalStatus = row.status;
        exitReason = row.exit_reason;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const elapsed = Date.now() - t0;

    expect(finalStatus).toBe('timed-out');
    expect(exitReason).toContain('timed-out-wall-clock');
    // The bound was 2s; SIGTERM should resolve sleep within the grace.
    // Full termination within 8s gives comfortable overhead for CI jitter.
    expect(elapsed).toBeLessThan(8_000);
    // And more than the bound itself (2s) by definition.
    expect(elapsed).toBeGreaterThanOrEqual(2_000);
  });
});
