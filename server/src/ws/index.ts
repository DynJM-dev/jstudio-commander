import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { VerifyClientCallbackSync } from 'ws';
import { eventBus } from './event-bus.js';
import { rooms } from './rooms.js';
import { registerWebSocketHandler, stopWebSocketTimers } from './handler.js';
import { CORS_ORIGINS } from '../config.js';

// Phase P.1 H2 — WebSocket Origin allowlist. The WS path has no CORS
// enforcement (WebSocket handshake is a plain HTTP upgrade that browsers
// send the Origin header on, but they don't block it). Reuse the CORS
// allowlist so any cross-origin upgrade is refused with a 403 at
// handshake time — matches the server's HTTP posture exactly.
//
// `info.origin` can legitimately be undefined (non-browser callers like
// curl don't send the header); `ws` types it as `string`, so we widen
// here. Empty-string Origin is treated the same as missing.
export const isAllowedWsOrigin = (origin: string | undefined | null): boolean => {
  // Non-browser callers (Node process, curl) don't send an Origin
  // header. We allow those through because the PIN middleware + route
  // guards still apply on the ws upgrade HTTP request. Browser abuse
  // is the target of this check.
  if (!origin) return true;
  return CORS_ORIGINS.includes(origin);
};

export { eventBus } from './event-bus.js';
export { rooms } from './rooms.js';
export { stopWebSocketTimers } from './handler.js';

export const setupWebSocket = async (app: FastifyInstance): Promise<void> => {
  // Phase P.1 H2 — pass verifyClient into the underlying ws.Server so
  // the upgrade is rejected BEFORE any handler runs when Origin is
  // cross-origin. Non-browser callers (no Origin header) fall through
  // to the route-level + PIN checks.
  const verifyClient: VerifyClientCallbackSync<import('node:http').IncomingMessage> = (info) => {
    // `info.origin` is the already-extracted Origin header. When absent
    // (non-browser caller), isAllowedWsOrigin returns true. Return false
    // rejects the upgrade — ws returns 401 by default on false.
    return isAllowedWsOrigin(info.origin);
  };
  await app.register(websocket, { options: { verifyClient } });

  // Register WebSocket route handler
  registerWebSocketHandler(app);

  // Wire event bus → room broadcasts
  eventBus.on('session:created', (session) => {
    rooms.broadcast('sessions', { type: 'session:created', session });
  });

  eventBus.on('session:updated', (session) => {
    rooms.broadcast('sessions', { type: 'session:updated', session });
  });

  eventBus.on('session:status', (sessionId, status, extras) => {
    // `extras` already carries the Issue 15.3 `state` field when the
    // poller (or another emitter) attached one. Spread as-is so new
    // consumers read extras.state; legacy consumers continue to read
    // extras.status.
    rooms.broadcast('sessions', {
      type: 'session:status',
      sessionId,
      status,
      ...(extras ?? {}),
    });
  });

  eventBus.on('session:deleted', (sessionId) => {
    rooms.broadcast('sessions', { type: 'session:deleted', sessionId });
  });

  eventBus.on('chat:message', (sessionId, message) => {
    rooms.broadcast(`chat:${sessionId}`, { type: 'chat:message', sessionId, message });
  });

  eventBus.on('chat:messages', (sessionId, messages) => {
    rooms.broadcast(`chat:${sessionId}`, { type: 'chat:messages', sessionId, messages });
  });

  eventBus.on('project:updated', (project) => {
    rooms.broadcast('projects', { type: 'project:updated', project });
  });

  eventBus.on('project:scanned', (projects) => {
    rooms.broadcast('projects', { type: 'project:scanned', projects });
  });

  // M7 MVP — per-session STATE.md broadcast. Dedicated channel keeps
  // subscribers structurally isolated from chat channels (firewall).
  eventBus.on('project:state-md-updated', (sessionId, projectPath, content) => {
    rooms.broadcast(`project-state:${sessionId}`, {
      type: 'project:state-md-updated',
      sessionId,
      projectPath,
      content,
    });
  });

  eventBus.on('analytics:token', (entry) => {
    rooms.broadcast('analytics', { type: 'analytics:token', entry });
  });

  eventBus.on('tunnel:started', (url) => {
    rooms.broadcastAll({ type: 'tunnel:started', url });
  });

  eventBus.on('tunnel:stopped', () => {
    rooms.broadcastAll({ type: 'tunnel:stopped' });
  });

  eventBus.on('system:error', (error) => {
    rooms.broadcastAll({ type: 'system:error', error });
  });

  eventBus.on('teammate:spawned', (teammate) => {
    rooms.broadcast('sessions', { type: 'teammate:spawned', teammate });
  });

  eventBus.on('teammate:dismissed', (sessionId) => {
    rooms.broadcast('sessions', { type: 'teammate:dismissed', sessionId });
  });

  // Phase M — session ticks broadcast on BOTH the session-scoped chat
  // topic (so a chat view gets context %) AND the global sessions topic
  // (so SessionCard grids update without explicit per-session subscribe).
  eventBus.on('session:tick', (sessionId, tick) => {
    rooms.broadcast('sessions', { type: 'session:tick', sessionId, tick });
    rooms.broadcast(`chat:${sessionId}`, { type: 'session:tick', sessionId, tick });
  });

  // Phase N.0 Patch 3 — heartbeat pulse on every inbound signal. Broad-
  // cast on the global `sessions` topic so the SessionCard grid can
  // render a "Xs ago" proof-of-life across all visible cards without
  // per-session subscribes.
  eventBus.on('session:heartbeat', (sessionId, ts) => {
    rooms.broadcast('sessions', { type: 'session:heartbeat', sessionId, ts });
  });

  // Phase O — host stats + aggregate rate-limits on the global `system`
  // channel. The HeaderStatsWidget subscribes here; the payload shapes
  // are defined in @commander/shared/types/system-stats.
  eventBus.on('system:stats', (stats) => {
    rooms.broadcast('system', { type: 'system:stats', stats });
  });

  eventBus.on('system:rate-limits', (rateLimits) => {
    rooms.broadcast('system', { type: 'system:rate-limits', rateLimits });
  });

  // Phase Q — pre-compact state transitions fan out on the `sessions`
  // topic so every open SessionCard grid gets the indicator update
  // without needing a per-session subscribe.
  eventBus.on('pre-compact:state-changed', (evt) => {
    rooms.broadcast('sessions', { type: 'pre-compact:state-changed', ...evt });
  });

  // Health beacon: a separate cadence from the per-socket protocol
  // heartbeat in handler.ts. Clients use the absence of these for ~10s
  // as a signal that the server is restarting (typical during dev hot
  // reloads), so they can render a non-disruptive banner instead of
  // surfacing every queued request as an error.
  setInterval(() => {
    rooms.broadcastAll({ type: 'system:health', timestamp: new Date().toISOString() });
  }, 5000);

  console.log('[ws] WebSocket server ready at /ws');
};
