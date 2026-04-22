// TanStack Query wrapper for GET /api/projects/:id/file?name=<allowed>.

import { useQuery } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';

export type ProjectFileName =
  | 'STATE.md'
  | 'DECISIONS.md'
  | 'PROJECT_DOCUMENTATION.md'
  | 'CLAUDE.md';

export interface ProjectFileExists {
  exists: true;
  name: ProjectFileName;
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export interface ProjectFileMissing {
  exists: false;
  name: ProjectFileName;
  path: string;
}

export type ProjectFileResponse = ProjectFileExists | ProjectFileMissing;

export function useProjectFile(
  projectId: string | null | undefined,
  name: ProjectFileName,
) {
  return useQuery({
    queryKey: ['projectFile', projectId, name] as const,
    queryFn: () =>
      httpJson<ProjectFileResponse>(
        `/api/projects/${encodeURIComponent(projectId!)}/file?name=${encodeURIComponent(name)}`,
      ),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
