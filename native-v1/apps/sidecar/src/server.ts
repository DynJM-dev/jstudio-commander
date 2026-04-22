// Fastify HTTP + WebSocket server for the Commander v1 sidecar.
// Per ARCHITECTURE_SPEC v1.2 §7 (three IPC layers) and §8 (process model).
//
// Wiring shape:
//   - HTTP /api/* — request/response queries (sessions CRUD, preferences,
//     session-types, health).
//   - WS /ws — streaming events, subscription-multiplexed per §7.3. The
//     WsEvent discriminated union is the only payload shape; no catch-all.
//   - Port discovery: bind from 11002 upward, retry until 11011.
//
// Task 5 lands the server skeleton + lifecycle. Tasks 6 + 7 + 9 attach
// PtyManager / PtyPool / bootstrap injector via the `orchestrator` dep without
// touching route scaffolding.

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { InitializedDb } from '@jstudio-commander/db';

import { EventBus } from './ws/event-bus.js';
import { attachWsConnection } from './ws/ws-handler.js';
import { healthRoutes } from './routes/health.js';
import { sessionTypesRoutes } from './routes/session-types.js';
import { preferencesRoutes } from './routes/preferences.js';
import { sessionRoutes, type SessionOrchestrator } from './routes/sessions.js';
import { scrollbackRoutes } from './routes/scrollback.js';
import { projectRoutes } from './routes/projects.js';
import { workspaceRoutes } from './routes/workspaces.js';

export const DEFAULT_PORT_START = 11002;
export const DEFAULT_PORT_END = 11011;

// 8 MB — covers MAX_SCROLLBACK_BYTES (5 MB decoded) plus base64 overhead
// (~33%) plus the JSON envelope. Raised from Fastify's 1 MB default.
const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

export interface ServerDeps {
  db: InitializedDb;
  bus: EventBus;
  orchestrator: SessionOrchestrator;
}

export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.JSTUDIO_LOG_LEVEL ?? 'info' },
    // Raised from Fastify's 1 MB default to accommodate scrollback payloads
    // (≤5 MB decoded per MAX_SCROLLBACK_BYTES + ~33% base64 overhead).
    bodyLimit: MAX_JSON_BODY_BYTES,
  });

  app.register(fastifyWebsocket);
  app.register(healthRoutes);
  app.register(sessionTypesRoutes(deps.db));
  app.register(preferencesRoutes(deps.db));
  app.register(sessionRoutes(deps.db, deps.bus, deps.orchestrator));
  app.register(scrollbackRoutes(deps.db, deps.bus));
  app.register(projectRoutes(deps.db));
  app.register(workspaceRoutes(deps.db));

  app.register(async (inst) => {
    inst.get('/ws', { websocket: true }, (socket) => {
      attachWsConnection(socket, {
        bus: deps.bus,
        onPtyInput: (sessionId, data) => deps.orchestrator.writeInput(sessionId, data),
      });
    });
  });

  return app;
}

export async function bindWithPortDiscovery(
  app: FastifyInstance,
  start = DEFAULT_PORT_START,
  end = DEFAULT_PORT_END,
): Promise<number> {
  let lastErr: unknown = null;
  for (let port = start; port <= end; port++) {
    try {
      await app.listen({ host: '127.0.0.1', port });
      return port;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'EADDRINUSE') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Could not bind sidecar to any port in [${start}..${end}]; last error: ${String(lastErr)}`,
  );
}
