import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, SendHorizontal, Check, Paperclip } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@commander/shared';
import type { ChatMessage } from '@commander/shared';
import { EmptyState } from '../components/shared/EmptyState';
import { ChatThread } from '../components/chat/ChatThread';
import { ContextBar } from '../components/chat/ContextBar';
import { PermissionPrompt } from '../components/chat/PermissionPrompt';
import { SessionTerminalPreview } from '../components/chat/SessionTerminalPreview';
import { useChat } from '../hooks/useChat';
import { usePromptDetection } from '../hooks/usePromptDetection';
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
  const [session, setSession] = useState<Session | null>(null);
  const { messages, loading, error, hasMore, stats, loadMore } = useChat(sessionId, session?.status);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [command, setCommand] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [localCommands, setLocalCommands] = useState<ChatMessage[]>([]);
  const [userJustSent, setUserJustSent] = useState(false);
  const msgCountAtSendRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendCommand = useCallback(() => {
    if (!sessionId || !command.trim() || sending) return;
    const cmdText = command.trim();

    // Show the message IMMEDIATELY — synchronous state updates
    const localMsg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    setUserJustSent(true);
    msgCountAtSendRef.current = messages.length;
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setTimeout(() => setSent(false), 2000);

    // Send to server in background — NOT awaited, so state updates flush immediately
    setSending(true);
    api.post(`/sessions/${sessionId}/command`, { command: cmdText })
      .catch(() => {})
      .finally(() => setSending(false));
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

  // Clear optimistic "working" state when new messages arrive or session goes idle
  useEffect(() => {
    if (!userJustSent) return;
    // Clear if session confirmed working (real status caught up)
    if (session?.status === 'working') {
      setUserJustSent(false);
      return;
    }
    // Clear if we got new assistant messages since sending
    if (messages.length > msgCountAtSendRef.current) {
      const hasNewAssistant = messages.slice(msgCountAtSendRef.current).some((m) => m.role === 'assistant');
      if (hasNewAssistant) setUserJustSent(false);
    }
  }, [userJustSent, session?.status, messages.length]);

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

  const interruptSession = useCallback(() => {
    if (!sessionId) return;
    api.post(`/sessions/${sessionId}/key`, { key: 'Escape' }).catch(() => {});
  }, [sessionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCommand();
    }
    // Escape interrupts Claude when input is empty
    if (e.key === 'Escape' && !command.trim()) {
      e.preventDefault();
      interruptSession();
    }
  }, [sendCommand, command, interruptSession]);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const totalTokens = stats?.totalTokens ?? 0;

  // Keep local commands until JSONL contains a user message with matching text
  // This ensures the local bubble stays visible until the real message appears
  const jsonlUserTexts = new Set(
    messages
      .filter((m) => m.role === 'user')
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text.trim())
  );
  const pendingLocal = localCommands.filter(
    (lc) => {
      const text = lc.content[0]?.type === 'text' ? lc.content[0].text.trim() : '';
      return !jsonlUserTexts.has(text);
    }
  );
  const allMessages = [...messages, ...pendingLocal];

  // Prompt detection — only when JSONL messages exist (SessionTerminalPreview handles fresh sessions)
  const { prompt, terminalHint, messagesQueued, clearPrompt } = usePromptDetection(
    sessionId,
    session?.status,
    allMessages.length,
    userJustSent,
  );

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

      {/* Chat area — full height, no header bars */}
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
        <ChatThread
          messages={allMessages}
          hasMore={hasMore}
          onLoadMore={loadMore}
          isWorking={session?.status === 'working' || userJustSent}
          actionLabel={terminalHint}
        />
      )}

      {/* ContextBar — above input */}
      <ContextBar
        model={session?.model}
        totalTokens={totalTokens}
        totalCost={stats?.totalCost ?? 0}
        messages={allMessages}
        sessionStatus={session?.status}
        sessionId={sessionId}
        terminalHint={terminalHint}
        hasPrompt={!!prompt}
        messagesQueued={messagesQueued}
        userJustSent={userJustSent}
        effortLevel={session?.effortLevel}
        onInterrupt={interruptSession}
      />

      {/* Permission prompt — when Claude is waiting for input */}
      <AnimatePresence>
        {prompt && allMessages.length > 0 && sessionId && (
          <PermissionPrompt
            sessionId={sessionId}
            prompt={prompt}
            onResponded={clearPrompt}
          />
        )}
      </AnimatePresence>

      {/* Input area — glass surface, fixed bottom */}
      {session && session.status !== 'stopped' && (
        <div
          className="shrink-0 px-3 lg:px-6 py-2.5"
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

          {/* Sent confirmation — shows "Queued" when Claude is busy */}
          <AnimatePresence>
            {sent && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1 mt-1.5 ml-1"
              >
                <Check size={12} style={{ color: session?.status === 'working' ? 'var(--color-idle)' : 'var(--color-working)' }} />
                <span
                  className="text-xs"
                  style={{ color: session?.status === 'working' ? 'var(--color-idle)' : 'var(--color-working)', fontFamily: M }}
                >
                  {session?.status === 'working' ? 'Queued — Claude is still working' : 'Sent'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
