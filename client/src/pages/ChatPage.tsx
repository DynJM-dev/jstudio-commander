import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, SendHorizontal, Check, Paperclip } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@commander/shared';
import type { ChatMessage } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { StatusBadge } from '../components/shared/StatusBadge';
import { ChatThread } from '../components/chat/ChatThread';
import { ContextBar } from '../components/chat/ContextBar';
import { StatusStrip } from '../components/chat/StatusStrip';
import { SessionTerminalPreview } from '../components/chat/SessionTerminalPreview';
import { useChat } from '../hooks/useChat';
import { api } from '../services/api';

const M = 'Montserrat, sans-serif';

const SLASH_COMMANDS = [
  { cmd: '/compact', desc: 'Compact conversation context' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear conversation' },
];

export const ChatPage = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { messages, loading, error, hasMore, stats, loadMore } = useChat(sessionId);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [command, setCommand] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
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
      setShowSlashMenu(false);
      setSent(true);
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

  // Poll session status
  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const s = await api.get<Session>(`/sessions/${sessionId}`);
        setSession(s);
      } catch { /* ignore */ }
    };
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
  }, []);

  // Auto-resize textarea
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCommand(val);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;

    // Show slash menu when typing /
    setShowSlashMenu(val === '/' || (val.startsWith('/') && val.length < 10 && !val.includes(' ')));
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
      </div>

      {/* Context bar — fixed top */}
      {stats && (
        <ContextBar
          model={session?.model}
          totalTokens={totalTokens}
          totalCost={stats.totalCostUsd}
        />
      )}

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

      {/* Status strip — above input when working */}
      <StatusStrip messages={allMessages} sessionStatus={session?.status} />

      {/* Input area — glass surface, fixed bottom */}
      {session && session.status !== 'stopped' && (
        <div
          className="shrink-0 px-3 lg:px-6 py-2.5"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          {/* Slash command dropdown */}
          <AnimatePresence>
            {showSlashMenu && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="mb-2 rounded-lg overflow-hidden"
                style={{
                  background: 'rgba(15, 20, 25, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }}
              >
                {SLASH_COMMANDS
                  .filter((c) => c.cmd.startsWith(command))
                  .map((c) => (
                    <button
                      key={c.cmd}
                      className="flex items-center gap-3 w-full px-3 py-2 text-left transition-colors"
                      style={{ fontFamily: M }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      onClick={() => {
                        setCommand(c.cmd + ' ');
                        setShowSlashMenu(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span
                        className="font-mono-stats text-xs font-medium"
                        style={{ color: 'var(--color-accent-light)' }}
                      >
                        {c.cmd}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        {c.desc}
                      </span>
                    </button>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input row */}
          <div
            className="flex items-end gap-2 rounded-lg px-3 py-2 transition-colors glass-surface"
            style={{
              borderRadius: 12,
            }}
          >
            {/* Paperclip button */}
            <button
              className="shrink-0 flex items-center justify-center rounded p-1 mb-0.5 transition-colors"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
              title="Image upload — coming in v2"
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

            {/* Character count (only when > 100 chars, hidden on mobile) */}
            {command.length > 100 && (
              <span
                className="text-xs shrink-0 mb-1 hidden sm:inline-block"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {command.length}
              </span>
            )}

            {/* Send button */}
            <button
              onClick={sendCommand}
              disabled={!command.trim() || sending}
              className="shrink-0 flex items-center justify-center rounded-lg transition-all mb-0.5"
              style={{
                width: 36,
                height: 36,
                minWidth: 36,
                minHeight: 36,
                background: command.trim() ? 'var(--color-accent)' : 'transparent',
                color: command.trim() ? '#fff' : 'var(--color-text-tertiary)',
                cursor: command.trim() ? 'pointer' : 'default',
                boxShadow: command.trim() ? '0 0 12px rgba(14, 124, 123, 0.3)' : 'none',
              }}
            >
              {sent ? <Check size={16} /> : <SendHorizontal size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
