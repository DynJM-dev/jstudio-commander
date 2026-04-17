import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { eventBus } from './event-bus.js';
import { rooms } from './rooms.js';
import { registerWebSocketHandler, stopWebSocketTimers } from './handler.js';

export { eventBus } from './event-bus.js';
export { rooms } from './rooms.js';
export { stopWebSocketTimers } from './handler.js';

export const setupWebSocket = async (app: FastifyInstance): Promise<void> => {
  // Register WebSocket plugin
  await app.register(websocket);

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
