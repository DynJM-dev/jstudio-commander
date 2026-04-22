// Zustand store for pure client state per ARCHITECTURE_SPEC v1.2 §4.1.
// Server state (sessions list, session details) lives in TanStack Query cache.

import { create } from 'zustand';

interface SessionStoreState {
  activeSessionId: string | null;
  sidebarCollapsed: boolean;
  newSessionModalOpen: boolean;
  preferencesOpen: boolean;
  setActiveSessionId: (id: string | null) => void;
  toggleSidebar: () => void;
  openNewSessionModal: () => void;
  closeNewSessionModal: () => void;
  openPreferences: () => void;
  closePreferences: () => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  activeSessionId: null,
  sidebarCollapsed: false,
  newSessionModalOpen: false,
  preferencesOpen: false,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openNewSessionModal: () => set({ newSessionModalOpen: true }),
  closeNewSessionModal: () => set({ newSessionModalOpen: false }),
  openPreferences: () => set({ preferencesOpen: true }),
  closePreferences: () => set({ preferencesOpen: false }),
}));
