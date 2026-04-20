import type { FastifyInstance } from 'fastify';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isLoopbackIp } from '../config.js';

// Phase Y Rotation 1 — TEMPORARY parallel-run diff persistence endpoint.
// Accepts `[codeman-diff]` payloads from the client and appends each
// as one JSONL line to `~/.jstudio-commander/codeman-diff.jsonl`.
//
// Durability purpose (CTO Amendment 1): DevTools console alone is
// fragile across tab crashes, devtools close events, hard reloads.
// File storage survives those and gives rotation 2's audit a
// grep/parse-able evidence stream.
//
// Loopback-only + explicitly marked TEMPORARY. The entire surface
// (endpoint, route file, JSONL file) is deleted in Phase Y Rotation 2
// per dispatch §2.6 strip verification.

const JSONL_PATH = join(homedir(), '.jstudio-commander', 'codeman-diff.jsonl');

export const debugRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post('/api/debug/codeman-diff', async (request, reply) => {
    if (!isLoopbackIp(request.ip)) {
      return reply.status(403).send({ error: 'loopback only' });
    }
    const payload = request.body;
    if (payload === null || typeof payload !== 'object') {
      return reply.status(400).send({ error: 'payload must be an object' });
    }
    try {
      mkdirSync(dirname(JSONL_PATH), { recursive: true });
      appendFileSync(JSONL_PATH, JSON.stringify(payload) + '\n');
    } catch (err) {
      // Don't fail the request on disk errors — the console emit
      // path remains live and tests assert append behavior; this
      // is a best-effort durability layer.
      console.warn('[codeman-diff] append failed:', (err as Error).message);
    }
    return reply.status(204).send();
  });
};
