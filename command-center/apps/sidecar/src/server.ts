import type { Database } from 'bun:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SidecarConfig } from './config';
import { healthRoute } from './routes/health';

export interface CreateServerOpts {
  config: SidecarConfig;
  raw: Database;
  logLevel?: string;
}

export function createServer(opts: CreateServerOpts): FastifyInstance {
  // Fastify 5 types are narrower with `loggerInstance` — pass config and let
  // Fastify own its Pino child. Boot-time logging in index.ts uses its own
  // multistream Pino instance for file-destination writes before Fastify
  // starts listening. Deviation noted in PHASE_REPORT §4.
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    trustProxy: false,
    disableRequestLogging: false,
    bodyLimit: 1_048_576, // 1 MB — N1 has no heavy upload routes
  });

  // N1 baseline — permissive CORS is fine because the sidecar binds to 127.0.0.1
  // only and the webview origin is `tauri://localhost`. CSP in tauri.conf.json
  // is the real gate (ARCHITECTURE_SPEC §7.2). Returning the reply from the
  // async hook is Fastify 5's short-circuit contract.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // /health is publicly reachable (liveness probe, no bearer). Authenticated
  // routes arrive in N2 forward; scaffold hook added then.

  app.register(async (scoped) => {
    await scoped.register(healthRoute, {
      config: opts.config,
      raw: opts.raw,
      firstPaintOk: () => true,
    });
  });

  return app;
}
