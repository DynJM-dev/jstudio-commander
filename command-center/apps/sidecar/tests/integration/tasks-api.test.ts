import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../../src/config';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { projects } from '../../src/db/schema';
import { createServer } from '../../src/server';

const TOKEN = 'n4-tasks-api-integration-token';

describe('N4 tasks HTTP API', () => {
  let raw: Database;
  let server: FastifyInstance;
  let baseUrl: string;
  const config: SidecarConfig = {
    bearerToken: TOKEN,
    port: 0,
    version: '0.1.0-n4-test',
    updatedAt: new Date().toISOString(),
  };

  const authHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };

  let scratchProjectDir: string;
  let seededProjectId: string;

  beforeAll(async () => {
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    const db = drizzle(raw, { schema });

    // State isolation §3.4.2: seed a project row at canonical form pointing
    // at a mkdtemp-allocated scratch dir. This short-circuits the POST
    // /api/tasks "auto-create from process.cwd()" fallback which would
    // otherwise write `.commander.json` to the repo root.
    scratchProjectDir = await mkdtemp(join(tmpdir(), 'n4-tasks-api-'));
    seededProjectId = 'p-tasks-api-seed';
    await db.insert(projects).values({
      id: seededProjectId,
      name: 'tasks-api-seed',
      identityFilePath: join(scratchProjectDir, '.commander.json'),
    });

    server = createServer({ config, raw, db, logLevel: 'silent' });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await server.close();
    raw.close();
    await rm(scratchProjectDir, { recursive: true, force: true });
  });

  it('POST /api/tasks with no project_id resolves to the first existing project', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'first task', instructions_md: 'do the thing' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { id: string; projectId: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data?.projectId).toBe(seededProjectId);
  });

  it('GET /api/tasks returns all tasks (no filter)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { count: number; tasks: { title: string }[] };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.count).toBeGreaterThanOrEqual(1);
    expect(body.data?.tasks.some((t) => t.title === 'first task')).toBe(true);
  });

  it('GET /api/tasks?status=todo filters by status', async () => {
    // Seed an in_progress task to prove filtering works.
    await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'in-flight', status: 'in_progress', instructions_md: '' }),
    });

    const todoRes = await fetch(`${baseUrl}/api/tasks?status=todo`, { headers: authHeaders });
    const todoBody = (await todoRes.json()) as { data: { tasks: { status: string }[] } };
    expect(todoBody.data.tasks.every((t) => t.status === 'todo')).toBe(true);

    const progRes = await fetch(`${baseUrl}/api/tasks?status=in_progress`, {
      headers: authHeaders,
    });
    const progBody = (await progRes.json()) as { data: { tasks: { status: string }[] } };
    expect(progBody.data.tasks.every((t) => t.status === 'in_progress')).toBe(true);
    expect(
      progBody.data.tasks.some((t) => (t as unknown as { title: string }).title === 'in-flight'),
    ).toBe(true);
  });

  it('GET /api/tasks rejects unknown status silently (returns all)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?status=bogus`, { headers: authHeaders });
    const body = (await res.json()) as { data: { count: number } };
    expect(body.data.count).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /api/tasks/:id updates status (kanban move)', async () => {
    const createRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'move-me', instructions_md: '' }),
    });
    const created = (await createRes.json()) as { data: { id: string; status: string } };
    expect(created.data.status).toBe('todo');

    const patchRes = await fetch(`${baseUrl}/api/tasks/${created.data.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'done' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { data: { status: string } };
    expect(patched.data.status).toBe('done');

    const getRes = await fetch(`${baseUrl}/api/tasks/${created.data.id}`, { headers: authHeaders });
    const got = (await getRes.json()) as { data: { status: string } };
    expect(got.data.status).toBe('done');
  });

  it('PATCH /api/tasks/:id with unknown id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('POST /api/tasks rejects missing title with 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ instructions_md: 'no title here' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('INVALID_ARG');
  });

  it('GET /api/tasks/with-latest-run returns tasks with null latestRun if no agent_run', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/with-latest-run?status=todo`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { tasks: { title: string; latestRun: unknown }[] };
    };
    expect(body.data.tasks.length).toBeGreaterThan(0);
    expect(body.data.tasks.every((t) => t.latestRun === null)).toBe(true);
  });

  it('unauthed request to /api/tasks is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
