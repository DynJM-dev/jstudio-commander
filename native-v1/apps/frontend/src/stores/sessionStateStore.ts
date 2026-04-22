// Zustand store mirroring per-session SessionState, driven by WS session:state
// events. Keyed by sessionId. Components subscribe via selectors.
//
// Server state for session metadata (effort, status, cwd, etc.) lives in
// TanStack Query — this store is purely client state for the state-machine
// kind + timestamps, which stream via WS and aren't worth a query round-trip.

import { create } from 'zustand';
import type { SessionState } from '@jstudio-commander/shared';

interface SessionStateStore {
  states: Record<string, SessionState>;
  setState: (sessionId: string, state: SessionState) => void;
  clear: (sessionId: string) => void;
}

export const useSessionStateStore = create<SessionStateStore>((set) => ({
  states: {},
  setState: (sessionId, state) =>
    set((prev) => ({ states: { ...prev.states, [sessionId]: state } })),
  clear: (sessionId) =>
    set((prev) => {
      const next = { ...prev.states };
      delete next[sessionId];
      return { states: next };
    }),
}));
