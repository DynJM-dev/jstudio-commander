import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, SendHorizontal, Check, Paperclip } from 'lucide-react';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendCommand = useCallback(async () => {
    if (!sessionId || !command.trim() || sending) return;
    const cmdText = command.trim();
    setSending(true);
    try {
      await api.post(`/sessions/${sessionId}/command`, { command: cmdText });

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
      // Reset textarea height
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
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

  // Auto-resize textarea
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommand(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCommand();
    }
  }, [sendCommand]);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const totalTokens = stats ? (stats.totalInputTokens ?? 0) + (stats.totalOutputTokens ?? 0) : 0;

  // Clear local commands once real JSONL messages arrive
  const allMessages = messages.length > 0 ? messages : localCommands;

  // Estimate context usage (rough approximation based on total tokens)
  const contextPercent = totalTokens > 0 ? Math.min(Math.round((totalTokens / 200000) * 100), 100) : 0;

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

      {/* VS Code-style input bar */}
      {session && session.status !== 'stopped' && (
        <div
          className="shrink-0 px-3 lg:px-6 py-2.5"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          {/* Input row */}
          <div
            className="flex items-end gap-2 rounded-lg px-3 py-2 transition-colors"
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {/* Paperclip button (placeholder for v2 image upload) */}
            <button
              className="shrink-0 flex items-center justify-center rounded p-1 mb-0.5 transition-colors"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
              title="Image upload coming in v2"
              onClick={() => {}}
            >
              <Paperclip size={16} />
            </button>

            {/* Auto-growing textarea */}
            <textarea
              ref={textareaRef}
              value={command}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={sending}
              rows={1}
              className="chat-input flex-1 text-base outline-none bg-transparent leading-relaxed"
              style={{
                fontFamily: M,
                color: 'var(--color-text-primary)',
              }}
            />

            {/* Send button */}
            <button
              onClick={sendCommand}
              disabled={!command.trim() || sending}
              className="shrink-0 flex items-center justify-center rounded-lg transition-all mb-0.5"
              style={{
                width: 36,
                height: 36,
                background: command.trim() ? 'var(--color-accent)' : 'transparent',
                color: command.trim() ? '#fff' : 'var(--color-text-tertiary)',
                cursor: command.trim() ? 'pointer' : 'default',
              }}
            >
              {sent ? <Check size={16} /> : <SendHorizontal size={16} />}
            </button>
          </div>

          {/* Status bar */}
          <div className="flex items-center gap-3 mt-1.5 px-1">
            <span
              className="font-mono-stats text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {session.model?.replace('claude-', '') ?? 'Unknown'}
            </span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            <span
              className="font-mono-stats text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {formatTokens(totalTokens)} tokens
            </span>

            {/* Context usage mini bar */}
            <div className="flex items-center gap-1.5 ml-auto">
              <span
                className="font-mono-stats text-xs"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Context:
              </span>
              <div
                className="w-16 h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(255, 255, 255, 0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${contextPercent}%`,
                    background: contextPercent > 80
                      ? 'var(--color-error)'
                      : contextPercent > 50
                        ? 'var(--color-idle)'
                        : 'var(--color-accent)',
                  }}
                />
              </div>
              <span
                className="font-mono-stats text-xs"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {contextPercent}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
