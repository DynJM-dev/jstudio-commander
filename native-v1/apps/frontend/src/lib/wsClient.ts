// WebSocket client per ARCHITECTURE_SPEC v1.2 §7.3. Exactly one open
// connection per tab; event bus dispatches typed WsEvent frames to listeners
// subscribed by channel name. Subscriptions explicitly round-trip subscribe/
// unsubscribe frames so the sidecar's per-socket filter can honor them.
//
// TanStack Query cache writes are done by the consumers (queries/sessions.ts,
// components/TerminalPane.tsx) — the WS client is transport, not cache.

import type { WsEvent } from '@jstudio-commander/shared';
import { discoverSidecarUrl, websocketUrlFor } from './sidecarUrl.js';

export type ChannelName = 'global' | `session:${string}` | `project:${string}` | 'workspace';

export type WsListener = (event: WsEvent) => void;

interface Subscription {
  channel: ChannelName;
  listeners: Set<WsListener>;
}

class WsClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly subs = new Map<ChannelName, Subscription>();
  private pendingFrames: string[] = [];
  private reconnectAttempts = 0;

  async connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return this.socket;
    if (this.connecting) return this.connecting;
    this.connecting = this.openSocket();
    try {
      this.socket = await this.connecting;
      return this.socket;
    } finally {
      this.connecting = null;
    }
  }

  private async openSocket(): Promise<WebSocket> {
    const base = await discoverSidecarUrl();
    const url = websocketUrlFor(base);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        this.reconnectAttempts = 0;
        // Re-send subscribe frames for any surviving subscriptions (e.g. after
        // a reconnect). New subscriptions opened during the lifetime of this
        // socket will flush normally via sendFrame().
        for (const channel of this.subs.keys()) {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        }
        // Flush frames queued before the socket was ready.
        for (const frame of this.pendingFrames) ws.send(frame);
        this.pendingFrames = [];
        resolve(ws);
      });
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const event = JSON.parse(String(ev.data)) as WsEvent;
          this.dispatch(event);
        } catch {
          /* drop malformed frame */
        }
      });
      ws.addEventListener('close', () => {
        this.socket = null;
        this.scheduleReconnect();
      });
      ws.addEventListener('error', (e) => {
        // The `open` promise rejects only if error fires before any open.
        if (this.socket !== ws) reject(new Error(`WS error on ${url}`));
        console.error('[ws] error', e);
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.subs.size === 0) return;
    const backoffMs = Math.min(30_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    setTimeout(() => {
      void this.connect().catch((err: Error) => {
        console.error('[ws] reconnect failed', err.message);
      });
    }, backoffMs);
  }

  subscribe(channel: ChannelName, listener: WsListener): () => void {
    let sub = this.subs.get(channel);
    if (!sub) {
      sub = { channel, listeners: new Set() };
      this.subs.set(channel, sub);
      this.sendFrame({ type: 'subscribe', channel });
    }
    sub.listeners.add(listener);
    return () => this.unsubscribe(channel, listener);
  }

  private unsubscribe(channel: ChannelName, listener: WsListener): void {
    const sub = this.subs.get(channel);
    if (!sub) return;
    sub.listeners.delete(listener);
    if (sub.listeners.size === 0) {
      this.subs.delete(channel);
      this.sendFrame({ type: 'unsubscribe', channel });
    }
  }

  sendPtyInput(sessionId: string, data: string): void {
    this.sendFrame({ type: 'pty:input', sessionId, data });
  }

  private sendFrame(frame: unknown): void {
    const payload = JSON.stringify(frame);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.pendingFrames.push(payload);
      void this.connect().catch((err: Error) => {
        console.error('[ws] connect failed', err.message);
      });
    }
  }

  private dispatch(event: WsEvent): void {
    // Dispatch to every subscriber whose channel matches event.sessionId (if
    // present). For global events, dispatch to the 'global' channel. We
    // mirror the server's routing rules here so subscribers can rely on the
    // sessionId filter.
    const sessionId = (event as { sessionId?: string }).sessionId;
    if (sessionId) {
      const sub = this.subs.get(`session:${sessionId}` as ChannelName);
      if (sub) for (const l of sub.listeners) l(event);
    } else {
      const sub = this.subs.get('global');
      if (sub) for (const l of sub.listeners) l(event);
    }
  }
}

export const wsClient = new WsClient();
