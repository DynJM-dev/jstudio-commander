// Debounced workspace-layout sync. Mount the hook once at app root; it:
//   - Fetches /api/workspaces/current on first render and hydrates the
//     Zustand workspaceStore (exactly once per app load).
//   - Subscribes to workspaceStore changes and PUTs the new layoutJson with
//     a 500ms trailing debounce — matches dispatch §3 Task 5 write path.
//   - Skips the first change-after-hydration that the hydrate itself
//     triggered (avoids a redundant write immediately after load).

import { useEffect } from 'react';
import { useWorkspaceStore, type WorkspaceLayout } from '../stores/workspaceStore.js';
import { httpJson } from './http.js';

const DEBOUNCE_MS = 500;

export function useWorkspaceSync(): void {
  useEffect(() => {
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPersistedJson: string | null = null;

    const hydrate = async () => {
      try {
        const res = await httpJson<{ workspace: { layoutJson: string } }>(
          '/api/workspaces/current',
        );
        if (cancelled) return;
        const layout = JSON.parse(res.workspace.layoutJson) as WorkspaceLayout;
        if (isValidLayout(layout)) {
          useWorkspaceStore.getState().setLayout(layout);
          lastPersistedJson = res.workspace.layoutJson;
        }
      } catch (err) {
        console.warn('[workspace-sync] hydrate failed:', (err as Error).message);
      } finally {
        useWorkspaceStore.getState().markHydrated();
      }
    };

    void hydrate();

    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      if (!state.hydrated) return; // ignore pre-hydration writes
      if (state.layout === prev.layout) return; // unchanged reference
      const json = JSON.stringify(state.layout);
      if (json === lastPersistedJson) return; // structurally identical
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void httpJson<{ workspace: unknown }>('/api/workspaces/current', {
          method: 'PUT',
          body: { layoutJson: json },
        })
          .then(() => {
            lastPersistedJson = json;
          })
          .catch((err: Error) => {
            console.warn('[workspace-sync] persist failed:', err.message);
          });
      }, DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, []);
}

function isValidLayout(l: unknown): l is WorkspaceLayout {
  if (!l || typeof l !== 'object') return false;
  const o = l as Record<string, unknown>;
  return (
    Array.isArray(o.panes) &&
    Array.isArray(o.ratios) &&
    typeof o.focusedIndex === 'number' &&
    o.panes.length === o.ratios.length &&
    o.panes.length >= 1 &&
    o.panes.length <= 3
  );
}
