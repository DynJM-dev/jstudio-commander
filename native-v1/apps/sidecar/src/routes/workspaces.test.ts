// Workspace route tests — default-seed on first GET, round-trip on PUT,
// validation of layoutJson payload.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { EventBus } from '../ws/event-bus.js';
import { UnimplementedOrchestrator } from './sessions.js';
import { createServer } from '../server.js';

describe('workspace routes', () => {
  let tmp: string;
  let db: ReturnType<typeof initDatabase>;
  let app: ReturnType<typeof createServer>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'workspace-test-'));
    db = initDatabase({ dbPath: join(tmp, 'test.db') });
    app = createServer({ db, bus: new EventBus(), orchestrator: new UnimplementedOrchestrator() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.raw.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('GET /api/workspaces/current seeds a default on first call', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/current' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workspace: { name: string; layoutJson: string; isCurrent: boolean } };
    expect(body.workspace.name).toBe('default');
    expect(body.workspace.isCurrent).toBe(true);
    const parsed = JSON.parse(body.workspace.layoutJson);
    expect(parsed.panes).toHaveLength(1);
    expect(parsed.ratios).toEqual([1]);
  });

  it('PUT /api/workspaces/current persists layoutJson and round-trips on GET', async () => {
    const nextLayout = {
      panes: [{ sessionId: 'a' }, { sessionId: 'b' }],
      ratios: [0.5, 0.5],
      focusedIndex: 1,
    };
    const put = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/current',
      payload: { layoutJson: JSON.stringify(nextLayout) },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/workspaces/current' });
    const body = get.json() as { workspace: { layoutJson: string } };
    expect(JSON.parse(body.workspace.layoutJson)).toEqual(nextLayout);
  });

  it('rejects malformed layoutJson', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/current',
      payload: { layoutJson: '{not-json' },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json()).toMatchObject({ error: 'layoutJson_invalid' });
  });

  it('rejects PUT missing layoutJson', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/current',
      payload: {},
    });
    expect(put.statusCode).toBe(400);
  });
});
