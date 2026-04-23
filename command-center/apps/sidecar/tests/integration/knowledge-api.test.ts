import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../../src/config';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { createServer } from '../../src/server';

const TOKEN = 'n4-knowledge-integration-token';

describe('N4 T7 — knowledge HTTP API (KB-P1.3 append-only)', () => {
  let raw: Database;
  let server: FastifyInstance;
  let baseUrl: string;
  let taskId = '';
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

    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'knowledge-host', instructions_md: '' }),
    });
    const task = (await taskRes.json()) as { data: { id: string } };
    taskId = task.data.id;
  });

  afterAll(async () => {
    await server.close();
    raw.close();
  });

  it('GET /api/tasks/:taskId/knowledge on a new task returns empty list', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { count: number; entries: unknown[] } };
    expect(body.data.count).toBe(0);
    expect(body.data.entries).toEqual([]);
  });

  it('POST /api/tasks/:taskId/knowledge appends + returns the row', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content_md: 'first-insight' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; taskId: string; contentMd: string; timestamp: string };
    };
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.taskId).toBe(taskId);
    expect(body.data.contentMd).toBe('first-insight');
  });

  it('appended entries show up in the GET list in chronological order', async () => {
    await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content_md: 'second-insight' }),
    });
    await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content_md: 'third-insight' }),
    });
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, { headers: authHeaders });
    const body = (await res.json()) as {
      data: { count: number; entries: { contentMd: string; timestamp: string }[] };
    };
    expect(body.data.count).toBe(3);
    expect(body.data.entries[0]?.contentMd).toBe('first-insight');
    expect(body.data.entries[2]?.contentMd).toBe('third-insight');
    // Non-decreasing timestamps (SQLite strftime may produce equal values on
    // fast writes; >= is the right invariant).
    const e0 = body.data.entries[0];
    const e2 = body.data.entries[2];
    if (!e0 || !e2) throw new Error('expected 3 entries');
    const t0 = Date.parse(e0.timestamp);
    const t2 = Date.parse(e2.timestamp);
    expect(t2).toBeGreaterThanOrEqual(t0);
  });

  it('POST with empty content_md returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content_md: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe('INVALID_ARG');
  });

  it('GET on unknown task returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/00000000-0000-0000-0000-000000000000/knowledge`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('unauthed request is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/knowledge`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
