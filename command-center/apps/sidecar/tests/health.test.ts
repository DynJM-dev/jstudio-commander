import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../src/config';
import { countTables, listTableNames, runMigrations } from '../src/db/client';
import { createServer } from '../src/server';

describe('sidecar health + schema', () => {
  let raw: Database;
  let server: FastifyInstance;
  const config: SidecarConfig = {
    bearerToken: 'test-token-not-secret',
    port: 11002,
    version: '0.1.0-n1-test',
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    // In-memory sqlite so tests leave no trace.
    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    server = createServer({ config, raw, logLevel: 'silent' });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    raw.close();
  });

  it('migrates all 9 tables idempotently', () => {
    runMigrations(raw); // second call should be no-op under IF NOT EXISTS
    expect(countTables(raw)).toBe(9);
    const names = listTableNames(raw);
    expect(names).toEqual([
      'agent_runs',
      'agents',
      'hook_events',
      'knowledge_entries',
      'onboarding_state',
      'projects',
      'sessions',
      'tasks',
      'workspaces',
    ]);
  });

  it('GET /health returns ok envelope with version + port + tableCount', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toBe('0.1.0-n1-test');
    expect(body.data.port).toBe(11002);
    expect(body.data.tableCount).toBe(9);
    expect(body.data.tableNames).toHaveLength(9);
  });

  it('OPTIONS preflight returns 204 with permissive CORS headers', async () => {
    const res = await server.inject({ method: 'OPTIONS', url: '/health' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });
});
