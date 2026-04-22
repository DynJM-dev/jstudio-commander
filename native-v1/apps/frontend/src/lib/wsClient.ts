// WebSocket client per ARCHITECTURE_SPEC v1.2 §7.3 + N2 §1.9.
//
// Responsibilities:
//   - Exactly one open connection per tab. Reopen-on-close with exponential
//     backoff (1s / 3s / 9s, max 3 retries in a rolling 60s window).
//   - Subscribe / unsubscribe round-trips to the sidecar per §7.3 model.
//   - Heartbeat: client-initiated ping every 15s; if no pong within 5s, treat
//     the connection as dead and force reconnect.
//   - On reconnect: re-run discoverSidecarUrl (re-probing ports 11002..11011
//     in case the sidecar respawned on a different port), reopen WS, replay
//     every subscription against the fresh socket from the local registry.
//   - Expose a connection-state store so UI can render a "Disconnected" banner
//     after max retries exhaust. Zustand store at `wsStatusStore`.
//
// TanStack Query cache writes are performed by consumers (queries/sessions.ts,
// components/TerminalPane.tsx) — the WS client is transport + routing, not cache.

import type { WsEvent } from '@jstudio-commander/shared';
import { discoverSidecarUrl, resetSidecarUrlCache, websocketUrlFor } from './sidecarUrl.js';
import { create } from 'zustand';

export type ChannelName = 'global' | `session:${string}` | `project:${string}` | 'workspace';
export type WsListener = (event: WsEvent) => void;

export type WsConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; nextDelayMs: number }
  | { kind: 'disconnected'; reason: string };

interface WsStatusState {
  status: WsConnectionStatus;
  setStatus: (s: WsConnectionStatus) => void;
}

export const useWsStatus = create<WsStatusState>((set) => ({
  status: { kind: 'idle' },
  setStatus: (status) => set({ status }),
}));

const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const RETRY_WINDOW_MS = 60_000;
const BACKOFFS_MS = [1_000, 3_000, 9_000];

interface Subscription {
  channel: ChannelName;
  listeners: Set<WsListener>;
}

class WsClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly subs = new Map<ChannelName, Subscription>();
  private pendingFrames: string[] = [];
  private attemptTimestamps: number[] = []; // for rolling 60s retry cap
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return this.socket;
    if (this.connecting) return this.connecting;

    useWsStatus.getState().setStatus({ kind: 'connecting' });
    this.connecting = this.openSocket();
    try {
      this.socket = await this.connecting;
      return this.socket;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * User-initiated reconnect — clears the retry counter + status banner and
   * attempts a fresh connection. Called from the "Disconnected — click to
   * reconnect" UI affordance.
   */
  manualReconnect(): void {
    this.attemptTimestamps = [];
    resetSidecarUrlCache();
    void this.connect().catch((err: Error) => {
      console.error('[ws] manual reconnect failed', err.message);
    });
  }

  private async openSocket(): Promise<WebSocket> {
    const base = await discoverSidecarUrl();
    const url = websocketUrlFor(base);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        useWsStatus.getState().setStatus({ kind: 'connected' });
        // Replay every subscription against the fresh socket. This is the
        // "subscription registry is source of truth" pattern — sidecar does
        // not need to remember subscriptions across restart.
        for (const channel of this.subs.keys()) {
          ws.send(JSON.stringify({ type: 'subscribe', channel }));
        }
        // Flush frames queued before the socket was ready.
        for (const frame of this.pendingFrames) ws.send(frame);
        this.pendingFrames = [];
        this.startHeartbeat();
        resolve(ws);
      });
      ws.addEventListener('message', (ev: MessageEvent) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const event = parsed as WsEvent;
        if (event.type === 'pong') {
          // Heartbeat alive; clear the pending pong timeout.
          if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
          }
          return;
        }
        this.dispatch(event);
      });
      ws.addEventListener('close', () => {
        this.stopHeartbeat();
        this.socket = null;
        this.scheduleReconnect('socket closed');
      });
      ws.addEventListener('error', (e) => {
        if (this.socket !== ws) reject(new Error(`WS error on ${url}`));
        console.error('[ws] error', e);
      });
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      // If a pong doesn't arrive within the timeout, the connection is stale
      // (e.g. network partition the browser didn't detect). Force close.
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        console.warn('[ws] pong timeout — forcing reconnect');
        try {
          this.socket?.close(4000, 'pong-timeout');
        } catch {
          /* browser may have already flipped state */
        }
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.subs.size === 0) {
      // No active subscriptions → let socket stay closed; next subscribe() or
      // sendPtyInput() will trigger a fresh connect.
      useWsStatus.getState().setStatus({ kind: 'idle' });
      return;
    }
    const now = Date.now();
    this.attemptTimestamps = this.attemptTimestamps.filter(
      (t) => now - t < RETRY_WINDOW_MS,
    );
    if (this.attemptTimestamps.length >= BACKOFFS_MS.length) {
      useWsStatus.getState().setStatus({
        kind: 'disconnected',
        reason: `sidecar unreachable after ${BACKOFFS_MS.length} retries`,
      });
      return;
    }
    const delayMs = BACKOFFS_MS[this.attemptTimestamps.length]!;
    this.attemptTimestamps.push(now);
    useWsStatus.getState().setStatus({
      kind: 'reconnecting',
      attempt: this.attemptTimestamps.length,
      nextDelayMs: delayMs,
    });
    // Reset the URL cache so the next connect re-probes the port range —
    // handles the case where sidecar respawned on a different port.
    resetSidecarUrlCache();
    setTimeout(() => {
      void this.connect().catch((err: Error) => {
        console.error(`[ws] reconnect failed (${reason}):`, err.message);
      });
    }, delayMs);
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
