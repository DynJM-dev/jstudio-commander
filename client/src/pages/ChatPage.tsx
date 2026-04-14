import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, SendHorizontal, Check } from 'lucide-react';
import type { Session } from '@commander/shared';
import type { ChatMessage } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { StatusBadge } from '../components/shared/StatusBadge';
import { ChatThread } from '../components/chat/ChatThread';
import { SessionTerminalPreview } from '../components/chat/SessionTerminalPreview';
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
  const [command, setCommand] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [localCommands, setLocalCommands] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const sendCommand = useCallback(async () => {
    if (!sessionId || !command.trim() || sending) return;
    const cmdText = command.trim();
    setSending(true);
    try {
      await api.post(`/sessions/${sessionId}/command`, { command: cmdText });

      // Add as a local message so it appears immediately in chat
      const localMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        parentId: null,
        role: 'user',
        timestamp: new Date().toISOString(),
        content: [{ type: 'text', text: cmdText }],
        isSidechain: false,
      };
      setLocalCommands((prev) => [...prev, localMsg]);

      setCommand('');
      setSent(true);
      setTimeout(() => setSent(false), 1500);
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }, [sessionId, command, sending]);

  // Clear local commands when switching sessions
  useEffect(() => {
    setLocalCommands([]);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) { setSession(null); return; }
    api.get<Session>(`/sessions/${sessionId}`).then(setSession).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
  }, []);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const totalTokens = stats ? (stats.totalInputTokens ?? 0) + (stats.totalOutputTokens ?? 0) : 0;

  // Merge JSONL messages with local commands
  const allMessages = [...messages, ...localCommands];

  // No session selected
  if (!sessionId) {
    return (
      <div className="flex flex-col h-full pb-24 lg:pb-0" style={{ fontFamily: M }}>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="glass-card w-full max-w-lg">
            <EmptyState
              icon={MessageSquare}
              title="Select a session"
              description={activeSessions.length > 0
                ? 'Pick a session from the top bar to view its conversation.'
                : 'Create a session first from the Sessions page.'
              }
              action={{ label: 'View All Sessions', onClick: () => navigate('/sessions') }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pb-24 lg:pb-0 overflow-hidden" style={{ fontFamily: M }}>

      {/* Session info bar */}
      <div
        className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-2"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {session && (
            <>
              <StatusBadge status={session.status} showLabel size="sm" />
              <span
                className="text-xs px-2 py-0.5 rounded-full hidden sm:inline-block"
                style={{ background: 'rgba(255, 255, 255, 0.06)', color: 'var(--color-text-tertiary)' }}
              >
                {session.model?.replace('claude-', '')}
              </span>
              {session.projectPath && (
                <span
                  className="font-mono-stats text-xs truncate max-w-[250px] hidden md:inline-block"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {session.projectPath.replace(/^\/Users\/[^/]+\//, '~/')}
                </span>
              )}
            </>
          )}
        </div>

        {stats && (
          <div className="flex items-center gap-3 font-mono-stats text-xs shrink-0">
            <span style={{ color: 'var(--color-accent-light)' }}>
              {formatTokens(totalTokens)} tokens
            </span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
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
            <p className="text-sm text-center" style={{ color: 'var(--color-error)' }}>{error}</p>
          </div>
        </div>
      ) : allMessages.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <SessionTerminalPreview
            sessionId={sessionId}
            onSendKeys={async (keys) => {
              await api.post(`/sessions/${sessionId}/command`, { command: keys });
            }}
          />
        </div>
      ) : (
        <ChatThread messages={allMessages} hasMore={hasMore} onLoadMore={loadMore} />
      )}

      {/* Command input bar */}
      {session && session.status !== 'stopped' && (
        <div
          className="shrink-0 px-3 lg:px-6 py-2.5"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendCommand();
                }
              }}
              placeholder="Type your prompt..."
              disabled={sending}
              className="flex-1 rounded-lg px-4 py-2.5 text-base outline-none transition-colors"
              style={{
                fontFamily: M,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--color-text-primary)',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'; }}
            />
            <button
              onClick={sendCommand}
              disabled={!command.trim() || sending}
              className="shrink-0 flex items-center justify-center rounded-lg transition-all"
              style={{
                width: 42,
                height: 42,
                background: command.trim() ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.04)',
                color: command.trim() ? '#fff' : 'var(--color-text-tertiary)',
                cursor: command.trim() ? 'pointer' : 'default',
              }}
            >
              {sent ? <Check size={18} /> : <SendHorizontal size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
