import { create } from 'zustand';

export type PreferencesTab = 'general' | 'plugin' | 'debug';

interface PreferencesStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: PreferencesTab;
  setActiveTab: (tab: PreferencesTab) => void;
}

// Zustand for pure UI state per ARCHITECTURE_SPEC §4. No server state here —
// health data comes from TanStack Query.
export const usePreferencesStore = create<PreferencesStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  activeTab: 'general' as PreferencesTab,
  setActiveTab: (activeTab) => set({ activeTab }),
}));
