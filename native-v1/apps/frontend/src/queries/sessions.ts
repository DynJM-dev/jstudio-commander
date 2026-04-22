// TanStack Query hooks for sessions CRUD per ARCHITECTURE_SPEC v1.2 §4.1 +
// §7.4. WebSocket-driven updates (pty:data, session:status) are routed by
// components to their own local state — the cache here stores the catalog
// of sessions (id, status, metadata), not streamed output.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';
import type { SessionEffort, SessionStatus, SessionTypeId } from '@jstudio-commander/shared';

export interface SessionRecord {
  id: string;
  projectId: string;
  sessionTypeId: SessionTypeId;
  effort: SessionEffort;
  status: SessionStatus;
  cwd: string;
  ptyPid: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  projectPath: string;
  projectName?: string;
  sessionTypeId: SessionTypeId;
  effort: SessionEffort;
  displayName?: string;
}

export interface CreateSessionResponse {
  session: SessionRecord;
  channel: string;
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'] as const,
    queryFn: () => httpJson<{ sessions: SessionRecord[] }>('/api/sessions'),
    select: (data) => data.sessions,
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['sessions', id] as const,
    queryFn: () => httpJson<SessionRecord>(`/api/sessions/${id}`),
    enabled: id !== null,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) =>
      httpJson<CreateSessionResponse>('/api/sessions', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useStopSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      httpJson<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
