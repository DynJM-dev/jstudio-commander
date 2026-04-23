import type { Database } from 'bun:sqlite';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SidecarConfig } from './config';
import type { CommanderDb } from './db/client';
import { mcpServer } from './mcp/server';
import { requireBearerOrTauriOrigin } from './middleware/auth';
import { apiRoutes } from './routes/api';
import { healthRoute } from './routes/health';
import { hookRoutes } from './routes/hooks';
import { wsRoute } from './routes/ws';
import { WsBus } from './services/ws-bus';

export interface CreateServerOpts {
  config: SidecarConfig;
  raw: Database;
  db: CommanderDb;
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
    bodyLimit: 1_048_576, // 1 MB — N2 hook payloads are small; N3+ may raise
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

  // Shared pub/sub bus for per-session WS topics (KB-P1.13). Created once here
  // and handed to the hook pipeline + the /ws route + /api replay so they all
  // share topic state.
  const bus = new WsBus(app.log);

  // /health is publicly reachable (liveness probe, no bearer).
  app.register(async (scoped) => {
    await scoped.register(healthRoute, {
      config: opts.config,
      raw: opts.raw,
      firstPaintOk: () => true,
    });
  });

  // WebSocket support — must be registered before the /ws route.
  app.register(fastifyWebsocket, {
    options: {
      maxPayload: 256 * 1024, // 256 KB frame cap; N2 frames are small JSON envelopes
    },
  });

  // Bearer-authed routes.
  app.register(async (scoped) => {
    scoped.addHook(
      'preHandler',
      requireBearerOrTauriOrigin({ expectedToken: opts.config.bearerToken }),
    );
    await scoped.register(hookRoutes, { db: opts.db, bus });
  });

  // MCP server on /mcp (JSON-RPC POST), registered as its own plugin so its
  // catch-all /mcp/* route doesn't collide with /hooks or /api prefixes.
  // bus + logger threaded through so spawn_agent_run/cancel_agent_run tool
  // handlers can publish status/pty events + log lifecycle transitions.
  app.register(mcpServer, {
    db: opts.db,
    bus,
    logger: app.log,
    expectedToken: opts.config.bearerToken,
  });

  // Frontend-facing /api/* surface (recent events + replay button).
  app.register(apiRoutes, {
    db: opts.db,
    bus,
    expectedToken: opts.config.bearerToken,
  });

  // WebSocket /ws route — bearer auth on handshake; subscribe/unsubscribe
  // protocol for `hook:<session_id>` topics (N2) and scaffolded for other
  // per-session topics (pty/status/approval/tool-result in N3+).
  app.register(wsRoute, { bus, expectedToken: opts.config.bearerToken });

  return app;
}
