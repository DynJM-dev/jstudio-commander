import type { WebSocket } from 'ws';
import type { WSEvent } from '@commander/shared';

// Channel → set of subscribed WebSocket clients
const channels = new Map<string, Set<WebSocket>>();
// Client → set of subscribed channels (for cleanup on disconnect)
const clientChannels = new Map<WebSocket, Set<string>>();

const send = (ws: WebSocket, event: WSEvent): void => {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // Client gone — will be cleaned up on close
    }
  }
};

export const rooms = {
  subscribe(ws: WebSocket, channel: string): void {
    if (!channels.has(channel)) {
      channels.set(channel, new Set());
    }
    channels.get(channel)!.add(ws);

    if (!clientChannels.has(ws)) {
      clientChannels.set(ws, new Set());
    }
    clientChannels.get(ws)!.add(channel);
  },

  unsubscribe(ws: WebSocket, channel: string): void {
    channels.get(channel)?.delete(ws);
    if (channels.get(channel)?.size === 0) {
      channels.delete(channel);
    }
    clientChannels.get(ws)?.delete(channel);
  },

  unsubscribeAll(ws: WebSocket): void {
    const subs = clientChannels.get(ws);
    if (subs) {
      for (const channel of subs) {
        channels.get(channel)?.delete(ws);
        if (channels.get(channel)?.size === 0) {
          channels.delete(channel);
        }
      }
    }
    clientChannels.delete(ws);
  },

  broadcast(channel: string, event: WSEvent): void {
    const subscribers = channels.get(channel);
    if (!subscribers) return;
    for (const ws of subscribers) {
      send(ws, event);
    }
  },

  broadcastAll(event: WSEvent): void {
    // Send to every unique connected client
    const seen = new Set<WebSocket>();
    for (const subscribers of channels.values()) {
      for (const ws of subscribers) {
        if (!seen.has(ws)) {
          seen.add(ws);
          send(ws, event);
        }
      }
    }
  },

  getSubscribers(channel: string): Set<WebSocket> {
    return channels.get(channel) ?? new Set();
  },

  getClientCount(): number {
    const unique = new Set<WebSocket>();
    for (const subscribers of channels.values()) {
      for (const ws of subscribers) {
        unique.add(ws);
      }
    }
    return unique.size;
  },

  getChannelCount(): number {
    return channels.size;
  },
};
