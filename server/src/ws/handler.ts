import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { WSCommand } from '@commander/shared';
import { rooms } from './rooms.js';
import { sessionService } from '../services/session.service.js';

const HEARTBEAT_INTERVAL = 15_000; // 15s
const PING_INTERVAL = 30_000; // 30s
const PONG_TIMEOUT = 10_000; // 10s

// Track alive state for ping/pong
const aliveClients = new Map<WebSocket, boolean>();

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

const handleMessage = (ws: WebSocket, raw: string): void => {
  let cmd: WSCommand;
  try {
    cmd = JSON.parse(raw) as WSCommand;
  } catch {
    return; // Ignore malformed messages
  }

  switch (cmd.type) {
    case 'subscribe':
      for (const channel of cmd.channels) {
        rooms.subscribe(ws, channel);
      }
      break;

    case 'unsubscribe':
      for (const channel of cmd.channels) {
        rooms.unsubscribe(ws, channel);
      }
      break;

    case 'session:command':
      sessionService.sendCommand(cmd.sessionId, cmd.command);
      break;

    // terminal:input and terminal:resize — Phase 9
    default:
      break;
  }
};

const handleClose = (ws: WebSocket): void => {
  rooms.unsubscribeAll(ws);
  aliveClients.delete(ws);
};

export const registerWebSocketHandler = (app: FastifyInstance): void => {
  app.get('/ws', { websocket: true }, (socket) => {
    const ws = socket as unknown as WebSocket;

    // Auto-subscribe to default channels
    rooms.subscribe(ws, 'sessions');
    rooms.subscribe(ws, 'system');

    // Mark as alive for ping/pong
    aliveClients.set(ws, true);

    ws.on('message', (data: Buffer | string) => {
      handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      handleClose(ws);
    });

    ws.on('error', () => {
      handleClose(ws);
    });

    ws.on('pong', () => {
      aliveClients.set(ws, true);
    });
  });

  // Heartbeat: send timestamp to all clients every 15s
  heartbeatTimer = setInterval(() => {
    rooms.broadcastAll({
      type: 'system:heartbeat',
      timestamp: new Date().toISOString(),
    });
  }, HEARTBEAT_INTERVAL);

  // Ping/pong: detect dead connections every 30s
  pingTimer = setInterval(() => {
    for (const [ws, alive] of aliveClients.entries()) {
      if (!alive) {
        // No pong received since last ping — terminate
        ws.terminate();
        handleClose(ws);
        continue;
      }
      aliveClients.set(ws, false);
      ws.ping();
    }
  }, PING_INTERVAL);
};

export const stopWebSocketTimers = (): void => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
};
