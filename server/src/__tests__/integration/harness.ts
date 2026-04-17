// Phase P.4 Patch 5 — Fastify HTTP integration harness.
//
// This is the first test layer in Commander that BOOTS A REAL FASTIFY
// and hits the route handlers via `app.inject()`. Every existing test
// in `server/src/services/__tests__/` either mirrors SQL against an
// in-memory DB or tests a pure function — none of them exercise the
// route handler, CORS setup, request parsing, or the eventBus emit
// path. That left regressions like "the route swallows a 500 into a
// 200" or "the loopback gate mis-parses IPv6-mapped addresses"
// untested. This harness fills that gap.
//
// Contract:
//   - Callers MUST set `COMMANDER_DATA_DIR` BEFORE importing this
//     module (use top-level await + dynamic import in the test file).
//     Otherwise config.ts evaluates once against `~/.jstudio-commander`
//     and the test touches your dev DB. See any of the *.test.ts
//     files in this dir for the canonical pattern.
//   - `app.inject()` defaults `remoteAddress` to `127.0.0.1` so
//     loopback-only routes (hook-event, session-tick) accept the
//     request without any extra config. Non-loopback tests pass
//     `remoteAddress: '8.8.8.8'` explicitly.
//   - No WebSocket server. Routes still emit to the in-process
//     eventBus; tests subscribe there to assert WS-shape events
//     without the socket-server plumbing.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import { CORS_ORIGINS } from '../../config.js';
import { sessionRoutes } from '../../routes/session.routes.js';
import { systemRoutes } from '../../routes/system.routes.js';
import { chatRoutes } from '../../routes/chat.routes.js';
import { hookEventRoutes } from '../../routes/hook-event.routes.js';
import { sessionTickRoutes } from '../../routes/session-tick.routes.js';
import { uploadRoutes } from '../../routes/upload.routes.js';
import { preCompactRoutes } from '../../routes/pre-compact.routes.js';
import { getDb, closeDb } from '../../db/connection.js';
import { eventBus } from '../../ws/event-bus.js';

export const buildTestApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: CORS_ORIGINS });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 0 },
  });
  await app.register(systemRoutes);
  await app.register(sessionRoutes);
  await app.register(chatRoutes);
  await app.register(hookEventRoutes);
  await app.register(sessionTickRoutes);
  await app.register(uploadRoutes);
  await app.register(preCompactRoutes);
  // Force DB init up front so the test can assume a working schema.
  getDb();
  return app;
};

// Full cleanup — close the Fastify instance, drop the DB handle, and
// wipe any eventBus listeners tests subscribed during the run. Calling
// this in `after(...)` keeps the node-test runner from emitting open-
// handle warnings.
export const cleanupTestApp = async (app: FastifyInstance): Promise<void> => {
  await app.close();
  closeDb();
  eventBus.removeAllListeners();
};

// Subscribe to a single eventBus event with a predicate and resolve
// with the payload once it fires. Times out so a never-firing event
// doesn't deadlock the test runner. Used to assert WS-shape events
// without running a real WebSocket.
export const waitForBusEvent = <T = unknown>(
  eventName: string,
  predicate: (...args: unknown[]) => boolean = () => true,
  timeoutMs = 2000,
): Promise<T[]> => {
  return new Promise<T[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.off(eventName, handler);
      reject(new Error(`timed out waiting for eventBus '${eventName}'`));
    }, timeoutMs);
    const handler = (...args: unknown[]): void => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      eventBus.off(eventName, handler);
      resolve(args as T[]);
    };
    eventBus.on(eventName, handler);
  });
};
