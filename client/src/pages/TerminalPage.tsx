import { useState, useEffect, useCallback } from 'react';
import { TerminalSquare } from 'lucide-react';
import type { Session } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { TerminalTabs } from '../components/terminal/TerminalTabs';
import { TerminalPanel } from '../components/terminal/TerminalPanel';
import { CreateSessionModal } from '../components/sessions/CreateSessionModal';
import { api } from '../services/api';

const M = 'Montserrat, sans-serif';

export const TerminalPage = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Session[]>('/sessions').then((data) => {
      setSessions(data);
      const active = data.filter((s) => s.status !== 'stopped');
      if (active.length > 0 && !activeId) {
        setActiveId(active[0]!.id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');

  const handleCreate = useCallback(async (opts: { name?: string; projectPath?: string; model?: string }) => {
    const session = await api.post<Session>('/sessions', opts);
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ fontFamily: M }}>
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading sessions...</span>
      </div>
    );
  }

  if (activeSessions.length === 0) {
    return (
      <div className="flex flex-col h-full pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass-card w-full max-w-md">
            <EmptyState
              icon={TerminalSquare}
              title="No active sessions"
              description="Create a session to access the terminal."
              action={{ label: 'New Session', onClick: () => setModalOpen(true) }}
            />
          </div>
        </div>
        <CreateSessionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreate={handleCreate}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pb-24 lg:pb-6" style={{ fontFamily: M }}>
      <TerminalTabs
        sessions={activeSessions}
        activeSessionId={activeId}
        onSelect={setActiveId}
        onNew={() => setModalOpen(true)}
      />

      {activeId ? (
        <TerminalPanel sessionId={activeId} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Select a session tab above
          </span>
        </div>
      )}

      <CreateSessionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
};
