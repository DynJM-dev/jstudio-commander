import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MessageSquare, ArrowLeft, ChevronDown, Loader2 } from 'lucide-react';
import type { Session } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { StatusBadge } from '../components/shared/StatusBadge';
import { ChatThread } from '../components/chat/ChatThread';
import { useChat } from '../hooks/useChat';
import { api } from '../services/api';
import { formatTokens, formatCost } from '../utils/format';

const M = 'Montserrat, sans-serif';

export const ChatPage = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { messages, loading, error, hasMore, stats, loadMore } = useChat(sessionId);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);

  // Fetch current session details
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    api.get<Session>(`/sessions/${sessionId}`).then(setSession).catch(() => {});
  }, [sessionId]);

  // Fetch all sessions for selector
  useEffect(() => {
    api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
  }, []);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const totalTokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0;

  // No session selected
  if (!sessionId) {
    return (
      <div className="flex flex-col h-full pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <div className="p-4 lg:p-6">
          <h1
            className="text-xl font-semibold mb-6"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Chat
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass-card w-full max-w-lg">
            <EmptyState
              icon={MessageSquare}
              title="Select a session"
              description="Choose an active session to view its conversation."
              action={
                activeSessions.length > 0
                  ? { label: `View ${activeSessions[0]!.name}`, onClick: () => navigate(`/chat/${activeSessions[0]!.id}`) }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pb-24 lg:pb-6" style={{ fontFamily: M }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 lg:px-6 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/sessions"
            className="shrink-0 flex items-center justify-center rounded-lg transition-colors"
            style={{ width: 32, height: 32, color: 'var(--color-text-tertiary)' }}
          >
            <ArrowLeft size={18} />
          </Link>

          {session && (
            <>
              <StatusBadge status={session.status} size="sm" />
              <div className="min-w-0">
                <h2
                  className="text-base font-semibold truncate"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {session.name}
                </h2>
              </div>
              <span
                className="hidden sm:inline-block text-xs px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {session.model}
              </span>
            </>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="hidden sm:flex items-center gap-3 font-mono-stats text-xs shrink-0">
            <span style={{ color: 'var(--color-accent-light)' }}>
              {formatTokens(totalTokens)}
            </span>
            <span style={{ color: 'var(--color-working)' }}>
              {formatCost(stats.totalCostUsd)}
            </span>
          </div>
        )}
      </div>

      {/* Chat area */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass-card p-5 max-w-md w-full">
            <p className="text-sm text-center" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass-card w-full max-w-md">
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description="Waiting for activity in this session..."
            />
          </div>
        </div>
      ) : (
        <ChatThread
          messages={messages}
          hasMore={hasMore}
          onLoadMore={loadMore}
        />
      )}

      {/* Footer: session selector + stats */}
      <div
        className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-2"
        style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        {/* Session selector */}
        <div className="relative">
          <button
            onClick={() => setSelectorOpen(!selectorOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              fontFamily: M,
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--color-text-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <span className="truncate max-w-[200px]">
              {session?.name ?? 'Select session'}
            </span>
            <ChevronDown size={14} />
          </button>

          {selectorOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setSelectorOpen(false)}
              />
              <div
                className="absolute bottom-full left-0 mb-1 z-50 w-64 rounded-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{
                  background: 'rgba(15, 20, 25, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                {sessions.filter((s) => s.status !== 'stopped').map((s) => (
                  <button
                    key={s.id}
                    className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors"
                    style={{
                      fontFamily: M,
                      color: s.id === sessionId ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
                      background: s.id === sessionId ? 'rgba(14, 124, 123, 0.1)' : 'transparent',
                    }}
                    onClick={() => {
                      navigate(`/chat/${s.id}`);
                      setSelectorOpen(false);
                    }}
                    onMouseEnter={(e) => {
                      if (s.id !== sessionId) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (s.id !== sessionId) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <StatusBadge status={s.status} size="sm" />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
                {sessions.filter((s) => s.status !== 'stopped').length === 0 && (
                  <div
                    className="px-3 py-2 text-xs"
                    style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
                  >
                    No active sessions
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mobile stats */}
        {stats && (
          <div className="sm:hidden flex items-center gap-2 font-mono-stats text-xs">
            <span style={{ color: 'var(--color-accent-light)' }}>
              {formatTokens(totalTokens)}
            </span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            <span style={{ color: 'var(--color-working)' }}>
              {formatCost(stats.totalCostUsd)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
