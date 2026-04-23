import { create } from 'zustand';

export type PreferencesTab = 'general' | 'plugin' | 'debug';

interface PreferencesStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: PreferencesTab;
  setActiveTab: (tab: PreferencesTab) => void;
  /**
   * ID of the agent_run currently being viewed in the RunViewer modal.
   * Null = viewer closed. Lives in this store because multiple surfaces
   * trigger it (Preferences → Debug → Recent agent runs + N4 kanban).
   */
  viewingRunId: string | null;
  setViewingRunId: (runId: string | null) => void;
}

// Zustand for pure UI state per ARCHITECTURE_SPEC §4. No server state here —
// health data comes from TanStack Query.
export const usePreferencesStore = create<PreferencesStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  activeTab: 'general' as PreferencesTab,
  setActiveTab: (activeTab) => set({ activeTab }),
  viewingRunId: null,
  setViewingRunId: (viewingRunId) => set({ viewingRunId }),
}));
