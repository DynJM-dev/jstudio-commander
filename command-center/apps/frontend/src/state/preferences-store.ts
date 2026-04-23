import { create } from 'zustand';

interface PreferencesStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: 'general' | 'debug';
  setActiveTab: (tab: 'general' | 'debug') => void;
}

// Zustand for pure UI state per ARCHITECTURE_SPEC §4. No server state here —
// health data comes from TanStack Query.
export const usePreferencesStore = create<PreferencesStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  activeTab: 'general',
  setActiveTab: (activeTab) => set({ activeTab }),
}));
