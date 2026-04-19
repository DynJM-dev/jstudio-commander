import { useEffect, useState } from 'react';
import type { SessionState, WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';

// Issue 15.3 — per-session canonical SessionState subscription.
//
// The server dual-emits `state: SessionState` on every `session:status`
// WS event (alongside the legacy coarse `status`). This hook listens
// for updates scoped to the given `sessionId` and returns the latest
// typed state, or `null` when no event has arrived since mount.
//
// Returning `null` is a legitimate starting state: callers should
// treat it as "no canonical state yet, fall back to deriving from
// session.status" exactly as Commander did pre-15.3. The dual-emit
// migration contract is "clients that recognize `state` prefer it;
// clients that don't (or haven't received one yet) keep working".
//
// Reset on sessionId change so opening a different chat doesn't
// carry the prior session's state across the switch.
export const useSessionState = (sessionId: string | undefined): SessionState | null => {
  const [state, setState] = useState<SessionState | null>(null);
  const { lastEvent } = useWebSocket();

  useEffect(() => {
    setState(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'session:status') return;
    if (event.sessionId !== sessionId) return;
    if (!event.state) return;
    setState(event.state);
  }, [lastEvent, sessionId]);

  return state;
};
