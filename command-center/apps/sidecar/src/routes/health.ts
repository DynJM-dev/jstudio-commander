import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { SidecarConfig } from '../config';
import { countTables, listTableNames } from '../db/client';

export interface HealthRouteOpts {
  config: SidecarConfig;
  raw: Database;
  firstPaintOk: () => boolean;
}

/**
 * GET /health is the only authenticated-free route in N1. Webview calls it via
 * actual `fetch()` from the Tauri origin — NOT curl (SMOKE_DISCIPLINE §4.2
 * explicitly forbids the N2.1 curl anti-pattern). Response shape matches the
 * `{ ok, data }` envelope per ARCHITECTURE_SPEC §7.2.
 */
export const healthRoute: FastifyPluginAsync<HealthRouteOpts> = async (
  app: FastifyInstance,
  opts,
) => {
  app.get('/health', async () => {
    const tableCount = countTables(opts.raw);
    const tableNames = listTableNames(opts.raw);
    return {
      ok: true,
      data: {
        status: 'ok',
        version: opts.config.version,
        port: opts.config.port,
        tableCount,
        tableNames,
        firstPaintInstrumented: opts.firstPaintOk(),
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
  });
};
