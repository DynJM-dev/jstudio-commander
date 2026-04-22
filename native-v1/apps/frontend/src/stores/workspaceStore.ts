// Workspace layout — 1 to 3 horizontally-split panes. Each pane references a
// sessionId (or null for an empty pane). Ratios sum to 1 and determine width
// distribution. Focused pane receives keyboard routing.
//
// Persistence happens in workspaceSync.ts (Task 5) — this store is pure
// client state. Updates flow through actions; the sync hook observes and
// debounces writes to the sidecar.

import { create } from 'zustand';

export interface PaneRef {
  sessionId: string | null;
}

export interface WorkspaceLayout {
  panes: PaneRef[]; // 1-3 panes
  ratios: number[]; // sums to 1, length === panes.length
  focusedIndex: number;
}

export const MIN_PANES = 1;
export const MAX_PANES = 3;
export const MIN_PANE_RATIO = 0.15;

interface WorkspaceStore {
  layout: WorkspaceLayout;
  hydrated: boolean;
  setLayout: (layout: WorkspaceLayout) => void;
  setPaneSession: (index: number, sessionId: string | null) => void;
  addPane: () => void;
  removePane: (index: number) => void;
  setRatios: (ratios: number[]) => void;
  focusPane: (index: number) => void;
  cycleFocus: (direction: 1 | -1) => void;
  markHydrated: () => void;
}

function defaultLayout(): WorkspaceLayout {
  return { panes: [{ sessionId: null }], ratios: [1], focusedIndex: 0 };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  layout: defaultLayout(),
  hydrated: false,

  setLayout: (layout) => set({ layout }),
  markHydrated: () => set({ hydrated: true }),

  setPaneSession: (index, sessionId) =>
    set((prev) => {
      const panes = prev.layout.panes.map((p, i) => (i === index ? { sessionId } : p));
      return { layout: { ...prev.layout, panes } };
    }),

  addPane: () =>
    set((prev) => {
      if (prev.layout.panes.length >= MAX_PANES) return prev;
      const panes = [...prev.layout.panes, { sessionId: null }];
      const ratios = equalizeRatios(panes.length);
      return {
        layout: { panes, ratios, focusedIndex: panes.length - 1 },
      };
    }),

  removePane: (index) =>
    set((prev) => {
      if (prev.layout.panes.length <= MIN_PANES) return prev;
      const panes = prev.layout.panes.filter((_, i) => i !== index);
      const ratios = equalizeRatios(panes.length);
      const focusedIndex = Math.min(prev.layout.focusedIndex, panes.length - 1);
      return { layout: { panes, ratios, focusedIndex } };
    }),

  setRatios: (ratios) =>
    set((prev) => {
      // Enforce MIN_PANE_RATIO on every entry; rebalance by clipping and
      // redistributing the delta proportionally to the remaining panes.
      const clipped = ratios.map((r) => Math.max(MIN_PANE_RATIO, r));
      const total = clipped.reduce((a, b) => a + b, 0);
      const normalized = clipped.map((r) => r / total);
      return { layout: { ...prev.layout, ratios: normalized } };
    }),

  focusPane: (index) =>
    set((prev) => ({ layout: { ...prev.layout, focusedIndex: index } })),

  cycleFocus: (direction) => {
    const { layout } = get();
    const n = layout.panes.length;
    if (n <= 1) return;
    const next = (layout.focusedIndex + direction + n) % n;
    set({ layout: { ...layout, focusedIndex: next } });
  },
}));

export function equalizeRatios(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}
