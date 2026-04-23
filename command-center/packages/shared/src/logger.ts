// Shared Logger type bridging Pino's Logger (standalone sidecar boot logging
// in `index.ts`) with Fastify's `FastifyBaseLogger` (request-scoped logging
// inside route handlers + plugins). Both shapes expose the same four-method
// surface we actually use — debug / info / warn / error — with overloaded
// signatures compatible with our call sites.
//
// Replaces the N2.1 `as unknown as Parameters<...>[1]` type-assertion bridge
// in `apps/sidecar/src/index.ts:21` (Debt 16). Consumers now import this type
// directly; both Pino `Logger` instances and Fastify's `app.log` structurally
// satisfy it without cast.

/**
 * Minimal logger shape used across the sidecar. Intentionally narrower than
 * Pino's full `Logger` or Fastify's `FastifyBaseLogger`; both those types
 * are supersets, so either can be passed where this is expected.
 *
 * Method signatures mirror Pino's overloads: `(msg, ...args)` for a plain
 * string message, `(obj, msg?)` for a structured record with an optional
 * message. Child loggers are NOT part of this surface — callers that want
 * `.child()` should keep the concrete Pino or Fastify type at the boundary.
 */
export interface Logger {
  debug: LoggerMethod;
  info: LoggerMethod;
  warn: LoggerMethod;
  error: LoggerMethod;
}

export interface LoggerMethod {
  (msg: string, ...args: unknown[]): void;
  (obj: Record<string, unknown> | unknown, msg?: string, ...args: unknown[]): void;
}
