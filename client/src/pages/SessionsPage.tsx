import { useState, useCallback, useMemo } from 'react';
import type { SessionType } from '@commander/shared';
import { Monitor, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import { SessionCard } from '../components/sessions/SessionCard';
import { CreateSessionModal } from '../components/sessions/CreateSessionModal';
import { useSessions } from '../hooks/useSessions';
import { useSessionTree } from '../hooks/useSessionTree';
import { buildDisplayNameMap } from '../utils/sessionDisplay';

const M = 'Montserrat, sans-serif';

export const SessionsPage = () => {
  const {
    sessions,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    createSession,
    deleteSession,
    sendCommand,
    updateSession,
  } = useSessions();
  const [modalOpen, setModalOpen] = useState(false);
  const [stoppedOpen, setStoppedOpen] = useState(false);
  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const stoppedSessions = useMemo(
    () => sessions
      .filter((s) => s.status === 'stopped' && !s.parentSessionId)
      .sort((a, b) => new Date(b.stoppedAt ?? b.updatedAt).getTime() - new Date(a.stoppedAt ?? a.updatedAt).getTime()),
    [sessions],
  );
  // Disambiguator map covers active + stopped so a live session and its
  // dead namesake both render with the · <id> suffix.
  const displayNames = useMemo(() => buildDisplayNameMap(sessions), [sessions]);

  // Parent → teammates derivation lives in useSessionTree (#221) so
  // SessionsPage and CityScene share one memoization per session list.
  const { topLevel, teammatesByParent } = useSessionTree(activeSessions);

  const handleCreate = useCallback(async (opts: { name?: string; projectPath?: string; model?: string; sessionType?: SessionType }) => {
    await createSession(opts);
  }, [createSession]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteSession(id);
  }, [deleteSession]);

  const handleCommand = useCallback(async (id: string, command: string) => {
    await sendCommand(id, command);
  }, [sendCommand]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await updateSession(id, { name });
  }, [updateSession]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <div className="flex items-center justify-between mb-6">
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Sessions
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <h1
          className="text-xl font-semibold mb-6"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Sessions
        </h1>
        <div className="glass-card p-5">
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Error loading sessions: {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-xl font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Sessions
        </h1>
        <button
          onClick={() => setModalOpen(true)}
          className="cta-btn-primary"
          style={{ fontFamily: M }}
        >
          <Plus size={16} strokeWidth={2.2} />
          New Session
        </button>
      </div>

      {/* Empty state */}
      {sessions.length === 0 && (
        <div className="glass-card">
          <EmptyState
            icon={Monitor}
            title="No active sessions"
            description="Create a new Claude Code session to get started."
            action={{ label: 'New Session', onClick: () => setModalOpen(true) }}
          />
        </div>
      )}

      {/* Active sessions grid — top-level parents with teammates nested */}
      {topLevel.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {topLevel.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              teammates={teammatesByParent.get(session.id)}
              displayName={displayNames.get(session.id)}
              onCommand={handleCommand}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))}
        </div>
      )}

      {/* Stopped fold — collapsed by default so dead sessions don't crowd
          the list. Keeps them reachable for restart or cleanup without
          demanding attention. */}
      {stoppedSessions.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-3">
          <button
            onClick={() => setStoppedOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
          >
            {stoppedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Stopped
            <span
              className="px-1.5 py-0.5 rounded-full text-[11px] font-mono-stats"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {stoppedSessions.length}
            </span>
          </button>
          {/* Issue 13 — archived-session toggle. When off (default) the
              list excludes stopped rows older than 24h; when on, the
              API returns the full history. Per-session-mount state;
              does not persist across reloads. */}
          <button
            onClick={() => setIncludeArchived(!includeArchived)}
            className="text-xs px-2 py-0.5 rounded-md transition-colors"
            style={{
              fontFamily: M,
              background: includeArchived ? 'rgba(14,124,123,0.1)' : 'transparent',
              color: includeArchived ? 'var(--color-accent-light)' : 'var(--color-text-tertiary)',
              border: '1px solid rgba(14,124,123,0.2)',
            }}
            title={includeArchived ? 'Hide stopped sessions older than 24h' : 'Show stopped sessions older than 24h'}
            aria-pressed={includeArchived}
          >
            {includeArchived ? 'Hide archived' : 'Show archived'}
          </button>
          </div>
          {stoppedOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
              {stoppedSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  displayName={displayNames.get(session.id)}
                  onCommand={handleCommand}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      <CreateSessionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
};
