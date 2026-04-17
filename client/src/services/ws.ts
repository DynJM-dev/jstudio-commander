import type { WSEvent, WSCommand } from '@commander/shared';

type EventHandler = (event: WSEvent) => void;

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

let socket: WebSocket | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

const handlers = new Set<EventHandler>();
const statusHandlers = new Set<(connected: boolean) => void>();

const getWsUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${proto}//${window.location.host}/ws`;
  try {
    const pin = sessionStorage.getItem('commander-pin');
    if (pin) url += `?pin=${encodeURIComponent(pin)}`;
  } catch {
    // sessionStorage unavailable
  }
  return url;
};

const notifyStatus = (connected: boolean): void => {
  for (const handler of statusHandlers) {
    handler(connected);
  }
};

const connect = (): void => {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  try {
    socket = new WebSocket(getWsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    // Phase P.3 L1 — DEV-only noise. `[ws] Connected` fires on every
    // reconnect after hot-reload + tab switch; shipping it in prod
    // clutters the console for no diagnostic benefit.
    if (import.meta.env.DEV) console.log('[ws] Connected');
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    notifyStatus(true);
  };

  socket.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WSEvent;
      for (const handler of handlers) {
        handler(event);
      }
    } catch {
      // Malformed message
    }
  };

  socket.onclose = () => {
    notifyStatus(false);
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  socket.onerror = () => {
    // onclose will fire after onerror
  };
};

const scheduleReconnect = (): void => {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
};

export const wsClient = {
  connect(): void {
    intentionalClose = false;
    connect();
  },

  disconnect(): void {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    socket?.close();
    socket = null;
  },

  send(cmd: WSCommand): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(cmd));
    }
  },

  subscribe(channels: string[]): void {
    this.send({ type: 'subscribe', channels });
  },

  unsubscribe(channels: string[]): void {
    this.send({ type: 'unsubscribe', channels });
  },

  onEvent(handler: EventHandler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },

  onStatusChange(handler: (connected: boolean) => void): () => void {
    statusHandlers.add(handler);
    return () => statusHandlers.delete(handler);
  },

  get connected(): boolean {
    return socket?.readyState === WebSocket.OPEN;
  },
};
