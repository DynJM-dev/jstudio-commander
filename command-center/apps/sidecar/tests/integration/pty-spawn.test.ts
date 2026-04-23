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

const TEST_TOKEN = 'n3-pty-spawn-test-token';

async function mcpCall(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}> {
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
    error?: { code: number; message: string };
  };
  if (body.error) {
    return { ok: false, error: { code: String(body.error.code), message: body.error.message } };
  }
  const text = body.result?.content?.[0]?.text;
  if (!text)
    return { ok: false, error: { code: 'NO_CONTENT', message: 'tool returned no content' } };
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (body.result?.isError) {
    return {
      ok: false,
      error: ('error' in parsed ? parsed.error : parsed) as { code: string; message: string },
    };
  }
  return { ok: true, data: parsed };
}

async function pollAgentRunRow(
  raw: Database,
  runId: string,
  until: (row: {
    status: string;
    exit_reason: string | null;
    ended_at: string | null;
    wall_clock_seconds: number;
  }) => boolean,
  timeoutMs: number,
): Promise<{
  status: string;
  exit_reason: string | null;
  ended_at: string | null;
  wall_clock_seconds: number;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = raw
      .query<
        {
          status: string;
          exit_reason: string | null;
          ended_at: string | null;
          wall_clock_seconds: number;
        },
        [string]
      >('SELECT status, exit_reason, ended_at, wall_clock_seconds FROM agent_runs WHERE id = ?')
      .get(runId);
    if (row && until(row)) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pollAgentRunRow timed out after ${timeoutMs}ms (runId=${runId})`);
}

describe('N3 T10 — pty-spawn integration', () => {
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

    // Synthetic git project as the worktree target.
    projectRoot = await mkdtemp(join(tmpdir(), 'n3-pty-project-'));
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

  it('spawn → running → completed with exit-code-0, pty_pid populated', async () => {
    const spawn = await mcpCall(
      baseUrl,
      'spawn_agent_run',
      { command: 'echo hello-from-n3', cwd_hint: projectRoot },
      1,
    );
    expect(spawn.ok).toBe(true);
    const run = spawn.data as {
      id: string;
      status: string;
      started_at?: string | null;
    };
    expect(run.status).toBe('running');

    // Verify pty_pid + session_id on the DB row.
    const dbRow = raw
      .query<
        { pty_pid: number | null; session_id: string; worktree_path: string | null },
        [string]
      >(
        'SELECT s.pty_pid as pty_pid, a.session_id as session_id, a.worktree_path as worktree_path FROM agent_runs a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.id = ?',
      )
      .get(run.id);
    expect(typeof dbRow?.pty_pid).toBe('number');
    expect(dbRow?.pty_pid).toBeGreaterThan(0);
    expect(dbRow?.session_id.length).toBeGreaterThan(0);
    expect(dbRow?.worktree_path).toContain('.worktrees/run-');

    // Poll until completed.
    const final = await pollAgentRunRow(raw, run.id, (r) => r.status === 'completed', 3_000);
    expect(final.status).toBe('completed');
    expect(final.exit_reason).toBe('exit-code-0');
    expect(final.ended_at).not.toBeNull();
    expect(final.wall_clock_seconds).toBeGreaterThanOrEqual(0);
  });

  it('spawn captures stdout bytes in sessions.scrollback_blob (base64)', async () => {
    const spawn = await mcpCall(
      baseUrl,
      'spawn_agent_run',
      { command: 'echo captured-bytes-12345', cwd_hint: projectRoot },
      2,
    );
    const run = spawn.data as { id: string };
    await pollAgentRunRow(raw, run.id, (r) => r.status === 'completed', 3_000);

    // Give the scrollback-flush a tick to land after the exit callback fires.
    await new Promise((r) => setTimeout(r, 100));

    const sessionRow = raw
      .query<{ scrollback_blob: string | null }, [string]>(
        'SELECT scrollback_blob FROM sessions WHERE id = (SELECT session_id FROM agent_runs WHERE id = ?)',
      )
      .get(run.id);
    expect(typeof sessionRow?.scrollback_blob).toBe('string');
    const decoded = Buffer.from(sessionRow?.scrollback_blob ?? '', 'base64').toString('utf8');
    expect(decoded).toContain('captured-bytes-12345');
  });
});
