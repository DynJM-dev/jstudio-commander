import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session, SessionType, WSEvent } from '@commander/shared';
import { api } from '../services/api';
import { useWebSocket } from './useWebSocket';

interface UseSessionsReturn {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  // Issue 13 — controls whether the initial fetch includes archived
  // (stopped >24h) rows. Default false: the UI starts on the active +
  // recent view; a "Show archived" toggle flips it per-mount.
  includeArchived: boolean;
  setIncludeArchived: (v: boolean) => void;
  createSession: (opts: { name?: string; projectPath?: string; model?: string; sessionType?: SessionType }) => Promise<Session>;
  deleteSession: (id: string) => Promise<Session>;
  sendCommand: (id: string, command: string) => Promise<void>;
  updateSession: (id: string, updates: { name?: string; model?: string }) => Promise<Session>;
}

export const useSessions = (): UseSessionsReturn => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();
  const mountedRef = useRef(true);

  // Fetch sessions whenever the archived toggle changes.
  useEffect(() => {
    mountedRef.current = true;
    const fetchSessions = async () => {
      try {
        const qs = includeArchived ? '?includeArchived=true' : '';
        const data = await api.get<Session[]>(`/sessions${qs}`);
        if (mountedRef.current) {
          setSessions(data);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
          setLoading(false);
        }
      }
    };

    fetchSessions();
    return () => { mountedRef.current = false; };
  }, [includeArchived]);

  // Subscribe to sessions channel
  useEffect(() => {
    subscribe(['sessions']);
    return () => unsubscribe(['sessions']);
  }, [subscribe, unsubscribe]);

  // Handle WebSocket events
  useEffect(() => {
    if (!lastEvent) return;

    const event = lastEvent as WSEvent;

    switch (event.type) {
      case 'session:created':
        setSessions((prev) => {
          if (prev.some((s) => s.id === event.session.id)) return prev;
          return [event.session, ...prev];
        });
        break;
      case 'session:updated':
        // Upsert: team-config emits session:updated for newly-detected
        // teammates too, so a pure map() would drop them. Append if
        // we've never seen this id.
        setSessions((prev) => {
          const exists = prev.some((s) => s.id === event.session.id);
          return exists
            ? prev.map((s) => (s.id === event.session.id ? event.session : s))
            : [event.session, ...prev];
        });
        break;
      case 'session:deleted':
        setSessions((prev) => prev.filter((s) => s.id !== event.sessionId));
        break;
      case 'session:status':
        setSessions((prev) =>
          prev.map((s) =>
            s.id === event.sessionId ? { ...s, status: event.status } : s
          )
        );
        break;
    }
  }, [lastEvent]);

  const createSession = useCallback(
    async (opts: { name?: string; projectPath?: string; model?: string; sessionType?: SessionType }): Promise<Session> => {
      const session = await api.post<Session>('/sessions', opts);
      return session;
    },
    []
  );

  const deleteSession = useCallback(async (id: string): Promise<Session> => {
    const session = await api.del<Session>(`/sessions/${id}`);
    return session;
  }, []);

  const sendCommand = useCallback(async (id: string, command: string): Promise<void> => {
    await api.post(`/sessions/${id}/command`, { command });
  }, []);

  const updateSession = useCallback(
    async (id: string, updates: { name?: string; model?: string }): Promise<Session> => {
      const session = await api.patch<Session>(`/sessions/${id}`, updates);
      return session;
    },
    []
  );

  return {
    sessions,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    createSession,
    deleteSession,
    sendCommand,
    updateSession,
  };
};
