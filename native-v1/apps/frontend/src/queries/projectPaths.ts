// TanStack Query hooks backing the ProjectPathPicker sections.

import { useQuery } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';

export interface ScannedProject {
  name: string;
  path: string;
  detectedType: string | null;
  mtime: number;
}

interface ScanResponse {
  root: string;
  entries: ScannedProject[];
  exists: boolean;
}

export function useProjectsScan(root = '~/Desktop/Projects/') {
  return useQuery({
    queryKey: ['projects', 'scan', root] as const,
    queryFn: () =>
      httpJson<ScanResponse>(`/api/projects/scan?root=${encodeURIComponent(root)}`),
    staleTime: 60_000, // rescanning every picker-open is wasteful
  });
}

export interface RecentPathEntry {
  path: string;
  lastUsedAt: number;
}

export function useRecentProjectPaths() {
  return useQuery({
    queryKey: ['preferences', 'recentProjectPaths'] as const,
    queryFn: async () => {
      try {
        const row = await httpJson<{ value: string } | null>(
          '/api/preferences/recentProjectPaths',
        );
        if (!row || typeof row.value !== 'string') return [] as RecentPathEntry[];
        const parsed = JSON.parse(row.value);
        return Array.isArray(parsed) ? (parsed as RecentPathEntry[]) : [];
      } catch (err) {
        if ((err as Error).message.includes('404')) return [] as RecentPathEntry[];
        throw err;
      }
    },
    staleTime: 10_000,
  });
}
