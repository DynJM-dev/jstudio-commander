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

const TEST_TOKEN = 'n3-cancel-test-token';

async function mcpCall(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id,
    }),
  });
  const body = (await res.json()) as {
    result?: { isError?: boolean; content?: Array<{ text: string }> };
  };
  const text = body.result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

async function pollRow(
  raw: Database,
  id: string,
  match: (status: string) => boolean,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = raw
      .query<{ status: string; exit_reason: string | null }, [string]>(
        'SELECT status, exit_reason FROM agent_runs WHERE id = ?',
      )
      .get(id);
    if (row && match(row.status)) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pollRow timed out (${timeoutMs}ms)`);
}

describe('N3 T10 — cancel-run integration', () => {
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

    projectRoot = await mkdtemp(join(tmpdir(), 'n3-cancel-project-'));
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

  it('cancel of sleep 30 exits via SIGTERM within the 5s grace window', async () => {
    const t0 = Date.now();
    const spawn = await mcpCall(
      baseUrl,
      'spawn_agent_run',
      { command: 'sleep 30', cwd_hint: projectRoot },
      1,
    );
    const run = spawn as { id: string; status: string };
    expect(run.status).toBe('running');

    // Let the process settle briefly, then cancel.
    await new Promise((r) => setTimeout(r, 300));
    const cancelResp = await mcpCall(baseUrl, 'cancel_agent_run', { id: run.id }, 2);
    expect(cancelResp.status).toBeDefined();

    const final = await pollRow(raw, run.id, (s) => s === 'cancelled', 8_000);
    const elapsed = Date.now() - t0;

    expect(final.status).toBe('cancelled');
    // `sleep` respects SIGTERM → process exits within grace, exit_reason
    // records the SIGTERM path.
    expect(final.exit_reason).toBe('cancelled-sigterm');
    // Full cancel flow (signal + settle + DB write) should complete well
    // under the 5s grace window for a cooperating process.
    expect(elapsed).toBeLessThan(6_000);
  });

  it('cancel of queued-only row marks cancelled without a live signal', async () => {
    // This path is exercised when a run is in the queued state BEFORE it
    // transitions to running (race-narrow; tests the idempotent shape).
    // We simulate by inserting a queued row directly — the cancel service
    // layer should degrade gracefully when the RUNNING map misses.
    // Dual-form lookup tolerates pre- and post-N4a.1 ensureProjectByCwd
    // row shapes (raw cwd OR <cwd>/.commander.json).
    const project = raw
      .query<{ id: string }, [string, string]>(
        'SELECT id FROM projects WHERE identity_file_path = ? OR identity_file_path = ?',
      )
      .get(projectRoot, `${projectRoot}/.commander.json`);
    expect(project).not.toBeNull();

    // Create a task
    const createTask = await mcpCall(
      baseUrl,
      'create_task',
      {
        project_id: project?.id,
        title: 'Queued-only cancel test',
        instructions_md: 'placeholder',
      },
      3,
    );
    const task = createTask as { id: string };

    // Insert an agent_run directly at 'queued' (bypass spawn).
    const runId = 'queued-only-test-abc';
    raw
      .prepare('INSERT INTO agent_runs (id, task_id, status) VALUES (?, ?, ?)')
      .run(runId, task.id, 'queued');

    const cancelResp = await mcpCall(baseUrl, 'cancel_agent_run', { id: runId }, 4);
    const row = cancelResp as { status: string };
    expect(row.status).toBe('cancelled');
  });

  it('cancel of a terminal row is idempotent', async () => {
    // Spawn echo → completes fast → call cancel on the already-terminal row.
    const spawn = await mcpCall(
      baseUrl,
      'spawn_agent_run',
      { command: 'echo already-done', cwd_hint: projectRoot },
      5,
    );
    const run = spawn as { id: string };
    await pollRow(raw, run.id, (s) => s === 'completed', 3_000);
    const cancelResp = await mcpCall(baseUrl, 'cancel_agent_run', { id: run.id }, 6);
    // Expect the same completed row back — no state change.
    const row = cancelResp as { status: string };
    expect(row.status).toBe('completed');
  });
});
