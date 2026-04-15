import { useState, useCallback, useMemo } from 'react';
import { Monitor, Plus } from 'lucide-react';
import type { Session } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import { SessionCard } from '../components/sessions/SessionCard';
import { CreateSessionModal } from '../components/sessions/CreateSessionModal';
import { useSessions } from '../hooks/useSessions';

const M = 'Montserrat, sans-serif';

export const SessionsPage = () => {
  const { sessions, loading, error, createSession, deleteSession, sendCommand, updateSession } = useSessions();
  const [modalOpen, setModalOpen] = useState(false);
  const activeSessions = sessions.filter((s) => s.status !== 'stopped');

  // Build a parent → teammates map, then a top-level list excluding teammates.
  // Sessions link to parents by either Commander UUID (parentSessionId matches
  // another session.id) or by Claude's leadSessionId (matches claudeSessionId
  // on a Commander row) — match both forms so the tree holds either way.
  const { topLevel, teammatesByParent } = useMemo(() => {
    const byCommanderId = new Map<string, Session>();
    const byClaudeId = new Map<string, Session>();
    for (const s of activeSessions) {
      byCommanderId.set(s.id, s);
      if (s.claudeSessionId) byClaudeId.set(s.claudeSessionId, s);
    }

    const childIds = new Set<string>();
    const childrenOf = new Map<string, Session[]>();

    for (const s of activeSessions) {
      if (!s.parentSessionId) continue;
      const parent = byCommanderId.get(s.parentSessionId) ?? byClaudeId.get(s.parentSessionId);
      if (!parent) continue;
      childIds.add(s.id);
      const bucket = childrenOf.get(parent.id) ?? [];
      bucket.push(s);
      childrenOf.set(parent.id, bucket);
    }

    const top = activeSessions
      .filter((s) => !childIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Sort each bucket by role then name for stable rendering.
    for (const bucket of childrenOf.values()) {
      bucket.sort((a, b) => (a.agentRole ?? '').localeCompare(b.agentRole ?? '') || a.name.localeCompare(b.name));
    }

    return { topLevel: top, teammatesByParent: childrenOf };
  }, [activeSessions]);

  const handleCreate = useCallback(async (opts: { name?: string; projectPath?: string; model?: string; sessionType?: 'pm' | 'raw' }) => {
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
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            fontFamily: M,
            background: 'var(--color-accent)',
            color: '#fff',
          }}
        >
          <Plus size={16} />
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
              onCommand={handleCommand}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))}
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
