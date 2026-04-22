// Scrollback route tests — GET + PATCH + 5MB truncation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { sessions, projects } from '@jstudio-commander/db';
import { EventBus } from '../ws/event-bus.js';
import { UnimplementedOrchestrator } from './sessions.js';
import { createServer } from '../server.js';
import { MAX_SCROLLBACK_BYTES } from './scrollback.js';

function seedSession(db: ReturnType<typeof initDatabase>, id = 's1'): void {
  const now = new Date();
  db.raw.prepare(
    `INSERT INTO projects (id, name, path, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('p1', 'proj', '/tmp/p', 'other', now.getTime(), now.getTime());
  db.drizzle.insert(sessions).values({
    id,
    projectId: 'p1',
    sessionTypeId: 'raw',
    effort: 'medium',
    status: 'active',
    cwd: '/tmp/p',
    createdAt: now,
    updatedAt: now,
  }).run();
  void projects; // silence unused import lint
}

describe('scrollback routes', () => {
  let tmp: string;
  let db: ReturnType<typeof initDatabase>;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'scrollback-test-'));
    db = initDatabase({ dbPath: join(tmp, 'test.db') });
    app = createServer({ db, bus: new EventBus(), orchestrator: new UnimplementedOrchestrator() });
    await app.ready();
    seedSession(db);
  });

  afterEach(async () => {
    await app.close();
    db.raw.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('GET returns null blob when nothing stored', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/scrollback' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ blob: null });
  });

  it('PATCH stores blob and GET round-trips it', async () => {
    const payload = 'hello\nworld\n\x1b[31mred\x1b[0m';
    const encoded = Buffer.from(payload, 'utf8').toString('base64');
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/s1/scrollback',
      payload: { blob: encoded },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ ok: true, truncated: false, bytes: payload.length });

    const get = await app.inject({ method: 'GET', url: '/api/sessions/s1/scrollback' });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { blob: string; bytes: number };
    expect(Buffer.from(body.blob, 'base64').toString('utf8')).toBe(payload);
    expect(body.bytes).toBe(payload.length);
  });

  it('truncates blobs over MAX_SCROLLBACK_BYTES, keeping the tail', async () => {
    const total = MAX_SCROLLBACK_BYTES + 1024;
    const payload = Buffer.alloc(total, 'x');
    // Put a sentinel at the END so we can verify tail retention after truncate.
    payload.write('TAIL_SENTINEL', total - 'TAIL_SENTINEL'.length);
    const encoded = payload.toString('base64');
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/s1/scrollback',
      payload: { blob: encoded },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({
      ok: true,
      truncated: true,
      bytes: MAX_SCROLLBACK_BYTES,
    });

    const get = await app.inject({ method: 'GET', url: '/api/sessions/s1/scrollback' });
    const body = get.json() as { blob: string; bytes: number };
    const stored = Buffer.from(body.blob, 'base64');
    expect(stored.length).toBe(MAX_SCROLLBACK_BYTES);
    expect(stored.subarray(-'TAIL_SENTINEL'.length).toString('utf8')).toBe('TAIL_SENTINEL');
  });

  it('returns 404 on unknown session id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/does-not-exist/scrollback' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects PATCH without a blob', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/s1/scrollback',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
