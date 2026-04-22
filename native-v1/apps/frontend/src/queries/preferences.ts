// Preference CRUD via TanStack Query + sidecar HTTP.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';

export interface PreferenceRow {
  key: string;
  value: string;
  scope: 'global' | 'session' | 'project';
  scopeId: string | null;
  updatedAt: string;
}

export function usePreference(key: string) {
  return useQuery({
    queryKey: ['preferences', key] as const,
    queryFn: async () => {
      try {
        return await httpJson<PreferenceRow>(`/api/preferences/${encodeURIComponent(key)}`);
      } catch (err) {
        // Treat 404 as "no preference set" rather than propagating an error.
        if ((err as Error).message.includes('404')) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

export function useSetPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      httpJson<{ ok: true; key: string }>(`/api/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value, scope: 'global' },
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['preferences', variables.key] });
    },
  });
}
