import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Code, Terminal, FileText, CheckCircle2, Search, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '@commander/shared';
import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

type StatusState =
  | { kind: 'idle' }
  | { kind: 'thinking'; label: string; startedAt: number }
  | { kind: 'writing'; filename: string; startedAt: number }
  | { kind: 'running'; startedAt: number }
  | { kind: 'reading'; filename: string; startedAt: number }
  | { kind: 'searching'; startedAt: number }
  | { kind: 'delegating'; startedAt: number }
  | { kind: 'composing'; startedAt: number }
  | { kind: 'done'; durationMs: number; tokens: number };

interface StatusStripProps {
  messages: ChatMessage[];
  sessionStatus?: string;
}

const LiveTimer = ({ startedAt }: { startedAt: number }) => {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startedAt);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startedAt]);

  const secs = Math.floor(elapsed / 1000);
  return (
    <span className="font-mono-stats text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
      {secs}s
    </span>
  );
};

const getToolStatusLabel = (toolName: string): string => {
  switch (toolName) {
    case 'Read': return 'Reading';
    case 'Edit': return 'Editing';
    case 'Write': return 'Writing';
    case 'Bash': return 'Running command...';
    case 'Grep': case 'Glob': return 'Searching...';
    case 'Agent': return 'Delegating to agent...';
    default: return 'Working...';
  }
};

const deriveStatus = (messages: ChatMessage[], sessionStatus?: string): StatusState => {
  if (messages.length === 0) return { kind: 'idle' };

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return { kind: 'idle' };

  // If session is 'working', detect what the agent is currently doing
  if (sessionStatus === 'working') {
    const blocks = lastMsg.content;
    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock) {
      const startedAt = new Date(lastMsg.timestamp).getTime();

      // Active thinking
      if (lastBlock.type === 'thinking') {
        return { kind: 'thinking', label: 'Cogitating...', startedAt };
      }

      // Active tool use
      if (lastBlock.type === 'tool_use') {
        const toolName = lastBlock.name;

        if (toolName === 'Bash') {
          return { kind: 'running', startedAt };
        }
        if (toolName === 'Write' || toolName === 'Edit') {
          const fp = typeof lastBlock.input.file_path === 'string'
            ? lastBlock.input.file_path.split('/').pop() ?? ''
            : '';
          return { kind: 'writing', filename: fp, startedAt };
        }
        if (toolName === 'Read') {
          const fp = typeof lastBlock.input.file_path === 'string'
            ? lastBlock.input.file_path.split('/').pop() ?? ''
            : '';
          return { kind: 'reading', filename: fp, startedAt };
        }
        if (toolName === 'Grep' || toolName === 'Glob') {
          return { kind: 'searching', startedAt };
        }
        if (toolName === 'Agent') {
          return { kind: 'delegating', startedAt };
        }

        // Default to working for unknown tools
        return { kind: 'thinking', label: 'Working...', startedAt };
      }

      // Text being streamed
      if (lastBlock.type === 'text') {
        return { kind: 'composing', startedAt };
      }
    }

    // Working but can't determine exact action
    return { kind: 'thinking', label: 'Reasoning...', startedAt: new Date(lastMsg.timestamp).getTime() };
  }

  // Session just stopped working — show completion for last assistant message
  if (lastMsg.role === 'assistant' && sessionStatus !== 'working') {
    // Find the most recent user message before this assistant response
    let userTimestamp: string | undefined;
    for (let i = messages.length - 2; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') {
        userTimestamp = m.timestamp;
        break;
      }
    }

    if (userTimestamp) {
      const startTime = new Date(userTimestamp).getTime();
      const endTime = new Date(lastMsg.timestamp).getTime();
      const duration = endTime - startTime;

      if (duration > 0) {
        const tokens = lastMsg.usage
          ? lastMsg.usage.inputTokens + lastMsg.usage.outputTokens
          : 0;
        return { kind: 'done', durationMs: duration, tokens };
      }
    }
  }

  return { kind: 'idle' };
};

export const StatusStrip = ({ messages, sessionStatus }: StatusStripProps) => {
  const status = deriveStatus(messages, sessionStatus);
  const [showDone, setShowDone] = useState(false);
  const prevStatusRef = useRef<string>('idle');
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // When transitioning from active → done, show the done state for 8 seconds then hide
  useEffect(() => {
    const wasActive = prevStatusRef.current !== 'idle' && prevStatusRef.current !== 'done';
    const isDone = status.kind === 'done';

    if (isDone && wasActive) {
      setShowDone(true);
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = setTimeout(() => setShowDone(false), 8000);
    } else if (isDone && !wasActive) {
      // Page load with done state — don't show
      setShowDone(false);
    } else if (status.kind !== 'idle' && status.kind !== 'done') {
      // Active state — clear done
      setShowDone(false);
      clearTimeout(doneTimerRef.current);
    }

    prevStatusRef.current = status.kind;
    return () => clearTimeout(doneTimerRef.current);
  }, [status.kind]);

  // Timeout fallback: if status has been "thinking/working" for 10s with no new messages, clear
  const [timedOut, setTimedOut] = useState(false);
  const lastMsgCountRef = useRef(messages.length);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (messages.length !== lastMsgCountRef.current) {
      lastMsgCountRef.current = messages.length;
      setTimedOut(false);
      clearTimeout(timeoutRef.current);
    }

    const isActive = status.kind !== 'idle' && status.kind !== 'done';
    if (isActive) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setTimedOut(true), 10000);
    } else {
      clearTimeout(timeoutRef.current);
      setTimedOut(false);
    }

    return () => clearTimeout(timeoutRef.current);
  }, [messages.length, status.kind]);

  // Determine visibility
  const isActive = status.kind !== 'idle' && status.kind !== 'done';
  const visible = (isActive && !timedOut) || (status.kind === 'done' && showDone);

  if (!visible) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status.kind}
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 36 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' as const }}
        className="shrink-0 flex items-center gap-2 px-4 lg:px-6 glass-nav status-pulse"
        style={{
          fontFamily: M,
          height: 36,
          borderTop: '1px solid rgba(255, 255, 255, 0.04)',
        }}
      >
        {status.kind === 'thinking' && (
          <>
            <div
              className="w-2 h-2 rounded-full shrink-0 animate-pulse"
              style={{ background: 'var(--color-accent)' }}
            />
            <BrainCircuit size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {status.label}
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'composing' && (
          <>
            <div
              className="w-2 h-2 rounded-full shrink-0 animate-pulse"
              style={{ background: 'var(--color-accent)' }}
            />
            <Code size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Composing response...
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'writing' && (
          <>
            <Code size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Editing {status.filename || 'file'}
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'running' && (
          <>
            <Terminal size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Running command...
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'reading' && (
          <>
            <FileText size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Reading {status.filename || 'file'}
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'searching' && (
          <>
            <Search size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Searching...
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'delegating' && (
          <>
            <Users size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Delegating to agent...
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'done' && (
          <>
            <CheckCircle2 size={14} style={{ color: 'var(--color-working)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {'\u2713'} Completed in {Math.round(status.durationMs / 1000)}s
              {status.tokens > 0 && ` \u00B7 ${formatTokens(status.tokens)} tokens`}
            </span>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
