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

  eventBus.on('session:status', (sessionId, status) => {
    rooms.broadcast('sessions', { type: 'session:status', sessionId, status });
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

  console.log('[ws] WebSocket server ready at /ws');
};
