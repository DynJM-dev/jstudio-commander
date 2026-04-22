// WebSocket connection handler per ARCHITECTURE_SPEC v1.2 §7.3.
// Client frames are JSON messages of shape:
//   { type: 'subscribe', channel: '...' }
//   { type: 'unsubscribe', channel: '...' }
//   { type: 'pty:input', sessionId, data }
// Server pushes typed WsEvent frames on subscribed channels.

import type { WebSocket } from '@fastify/websocket';
import type { WsEvent } from '@jstudio-commander/shared';
import { EventBus, type ChannelName } from './event-bus.js';

export type ClientFrame =
  | { type: 'subscribe'; channel: ChannelName }
  | { type: 'unsubscribe'; channel: ChannelName }
  | { type: 'pty:input'; sessionId: string; data: string };

export interface WsHandlerDeps {
  bus: EventBus;
  onPtyInput: (sessionId: string, data: string) => void;
}

export function attachWsConnection(socket: WebSocket, deps: WsHandlerDeps): void {
  const unsubs = new Map<ChannelName, () => void>();

  const send = (event: WsEvent) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  };

  const subscribe = (channel: ChannelName) => {
    if (unsubs.has(channel)) return;
    const off = deps.bus.subscribe(channel, (_ch, ev) => send(ev));
    unsubs.set(channel, off);
  };

  const unsubscribe = (channel: ChannelName) => {
    const off = unsubs.get(channel);
    if (off) {
      off();
      unsubs.delete(channel);
    }
  };

  socket.on('message', (raw: Buffer) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString('utf8')) as ClientFrame;
    } catch {
      return; // silently drop malformed frames (client-visible error would be noisy)
    }
    switch (frame.type) {
      case 'subscribe':
        subscribe(frame.channel);
        break;
      case 'unsubscribe':
        unsubscribe(frame.channel);
        break;
      case 'pty:input':
        deps.onPtyInput(frame.sessionId, frame.data);
        break;
    }
  });

  socket.on('close', () => {
    for (const off of unsubs.values()) off();
    unsubs.clear();
  });
}
