import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { WSEvent } from '@commander/shared';
import { wsClient } from '../services/ws';

interface WebSocketContextValue {
  connected: boolean;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  send: typeof wsClient.send;
  lastEvent: WSEvent | null;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export const WebSocketProvider = ({ children }: { children: ReactNode }) => {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    wsClient.connect();

    const unsubStatus = wsClient.onStatusChange((status) => {
      if (mountedRef.current) setConnected(status);
    });

    const unsubEvent = wsClient.onEvent((event) => {
      if (mountedRef.current) setLastEvent(event);
    });

    return () => {
      mountedRef.current = false;
      unsubStatus();
      unsubEvent();
      wsClient.disconnect();
    };
  }, []);

  const subscribe = useCallback((channels: string[]) => wsClient.subscribe(channels), []);
  const unsubscribe = useCallback((channels: string[]) => wsClient.unsubscribe(channels), []);
  const send = useCallback((...args: Parameters<typeof wsClient.send>) => wsClient.send(...args), []);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe, unsubscribe, send, lastEvent }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = (): WebSocketContextValue => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
};
