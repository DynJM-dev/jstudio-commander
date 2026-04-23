import type { FastifyReply, FastifyRequest } from 'fastify';

// Accepted origins that bypass bearer-auth. The webview runs at
// `tauri://localhost` in release builds and `http://localhost:5173` under
// `bun run dev`. Safe because the sidecar binds to 127.0.0.1 only — any
// origin-header spoof requires local-process access, which is already
// equivalent to breached trust boundary in a single-user local-first app.
const TAURI_ORIGINS = new Set<string>([
  'tauri://localhost',
  'https://tauri.localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export interface BearerAuthOptions {
  expectedToken: string;
  /** Extra origin values to bypass (e.g. for tests). */
  extraAllowedOrigins?: string[];
}

/**
 * Shared Fastify preHandler: require `Authorization: Bearer <token>` matching
 * the sidecar bearer, OR a recognized Tauri webview origin. 401 on miss or
 * mismatch per ARCHITECTURE_SPEC §7.2 + dispatch §2 T7.
 *
 * Apply as a route-level `preHandler` on `/hooks/*` and `/mcp/*`. `/health`
 * stays fully unauthed (liveness probe) by NOT registering this hook.
 */
export function requireBearerOrTauriOrigin(opts: BearerAuthOptions) {
  const allowed = new Set([...TAURI_ORIGINS, ...(opts.extraAllowedOrigins ?? [])]);
  const expected = opts.expectedToken;

  return async function preHandler(req: FastifyRequest, reply: FastifyReply) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowed.has(origin)) return;

    // 1. Authorization: Bearer header (HTTP clients — plugin hooks, curl).
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token.length > 0 && token === expected) return;
      return reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid bearer token' },
      });
    }

    // 2. ?access_token=<token> query param (WebSocket clients — WHATWG
    //    WebSocket API has no custom-header escape hatch, this is the
    //    standard workaround for WS auth). Same bearer, different carrier.
    const query = req.query as Record<string, unknown> | undefined;
    const qsToken = query?.access_token;
    if (typeof qsToken === 'string' && qsToken.length > 0 && qsToken === expected) return;

    return reply.status(401).send({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' },
    });
  };
}
