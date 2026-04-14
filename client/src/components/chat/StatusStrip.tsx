import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Code, Terminal, FileText, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '@commander/shared';
import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

type StatusState =
  | { kind: 'idle' }
  | { kind: 'thinking'; startedAt: number }
  | { kind: 'writing'; filename: string; startedAt: number }
  | { kind: 'running'; startedAt: number }
  | { kind: 'reading'; filename: string; startedAt: number }
  | { kind: 'done'; durationMs: number; tokens: number; thinkingMs: number };

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

const deriveStatus = (messages: ChatMessage[], sessionStatus?: string): StatusState => {
  if (messages.length === 0) return { kind: 'idle' };

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return { kind: 'idle' };

  // If session is 'working', detect what the agent is currently doing
  if (sessionStatus === 'working') {
    const blocks = lastMsg.content;
    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock) {
      // Active thinking
      if (lastBlock.type === 'thinking') {
        return { kind: 'thinking', startedAt: new Date(lastMsg.timestamp).getTime() };
      }

      // Active tool use
      if (lastBlock.type === 'tool_use') {
        const startedAt = new Date(lastMsg.timestamp).getTime();
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

        // Default to thinking for other tools
        return { kind: 'thinking', startedAt };
      }
    }

    // Working but can't determine exact action
    return { kind: 'thinking', startedAt: new Date(lastMsg.timestamp).getTime() };
  }

  // Session just stopped working — check if the last assistant message just completed
  if (lastMsg.role === 'assistant' && sessionStatus !== 'working') {
    // Check if we have a previous user message to calculate duration
    const prevUserIdx = [...messages].reverse().findIndex((m, i) => i > 0 && m.role === 'user');
    if (prevUserIdx > 0) {
      const userMsg = messages[messages.length - 1 - prevUserIdx];
      if (userMsg) {
        const startTime = new Date(userMsg.timestamp).getTime();
        const endTime = new Date(lastMsg.timestamp).getTime();
        const duration = endTime - startTime;

        // Only show "done" for recent completions (within 10s)
        if (duration > 0 && Date.now() - endTime < 10000) {
          const tokens = lastMsg.usage
            ? lastMsg.usage.inputTokens + lastMsg.usage.outputTokens
            : 0;
          return { kind: 'done', durationMs: duration, tokens, thinkingMs: 0 };
        }
      }
    }
  }

  return { kind: 'idle' };
};

export const StatusStrip = ({ messages, sessionStatus }: StatusStripProps) => {
  const status = deriveStatus(messages, sessionStatus);

  if (status.kind === 'idle') return null;

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
              Thinking...
            </span>
            <span className="flex-1" />
            <LiveTimer startedAt={status.startedAt} />
          </>
        )}

        {status.kind === 'writing' && (
          <>
            <Code size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Writing {status.filename || 'code'}
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

        {status.kind === 'done' && (
          <>
            <CheckCircle2 size={14} style={{ color: 'var(--color-working)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Completed in {Math.round(status.durationMs / 1000)}s
              {status.tokens > 0 && ` \u00B7 ${formatTokens(status.tokens)} tokens`}
            </span>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
