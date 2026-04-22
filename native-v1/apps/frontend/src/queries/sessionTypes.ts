import { useQuery } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';
import type { SessionEffort, SessionTypeId } from '@jstudio-commander/shared';

export interface SessionTypeRow {
  id: SessionTypeId;
  label: string;
  bootstrapPath: string | null;
  effortDefault: SessionEffort;
  clientBinary: string;
  sortOrder: number;
}

export function useSessionTypes() {
  return useQuery({
    queryKey: ['session-types'] as const,
    queryFn: () => httpJson<{ sessionTypes: SessionTypeRow[] }>('/api/session-types'),
    staleTime: 60_000,
    select: (data) => data.sessionTypes,
  });
}
