import { useState, useEffect, useRef } from 'react';
import type { ChatMessage } from '@commander/shared';
import { formatTokens, formatCost } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-5-20251101': 1_000_000,
  'claude-sonnet-4-5-20241022': 200_000,
};

const getContextLimit = (model?: string): number => {
  if (!model) return 200_000;
  return MODEL_CONTEXT_LIMITS[model] ?? 200_000;
};

const getActionLabel = (messages: ChatMessage[]): string | null => {
  if (messages.length === 0) return null;
  let lastMsg: ChatMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') { lastMsg = messages[i]; break; }
  }
  if (!lastMsg) return null;

  const blocks = lastMsg.content;
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return null;

  if (lastBlock.type === 'thinking') return 'Cogitating...';
  if (lastBlock.type === 'text') return 'Composing response...';

  if (lastBlock.type === 'tool_use') {
    const name = lastBlock.name;
    if (name === 'Read') {
      const fp = typeof lastBlock.input.file_path === 'string'
        ? lastBlock.input.file_path.split('/').pop() ?? ''
        : '';
      return fp ? `Reading ${fp}...` : 'Reading file...';
    }
    if (name === 'Edit') {
      const fp = typeof lastBlock.input.file_path === 'string'
        ? lastBlock.input.file_path.split('/').pop() ?? ''
        : '';
      return fp ? `Editing ${fp}...` : 'Editing file...';
    }
    if (name === 'Write') {
      const fp = typeof lastBlock.input.file_path === 'string'
        ? lastBlock.input.file_path.split('/').pop() ?? ''
        : '';
      return fp ? `Writing ${fp}...` : 'Writing file...';
    }
    if (name === 'Bash') return 'Running command...';
    if (name === 'Grep' || name === 'Glob') return 'Searching...';
    if (name === 'Agent') return 'Delegating to agent...';
    return 'Working...';
  }

  return null;
};

const LiveElapsed = ({ startedAt }: { startedAt: number }) => {
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
    <span className="font-mono-stats text-xs shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
      {secs}s
    </span>
  );
};

interface StatusInfo {
  label: string;
  dotColor: string;
  pulse: boolean;
}

const getStatusInfo = (
  sessionStatus: string | undefined,
  actionLabel: string | null,
  hasPrompt: boolean,
): StatusInfo => {
  if (sessionStatus === 'working') {
    return {
      label: actionLabel ?? 'Working...',
      dotColor: 'var(--color-accent)',
      pulse: true,
    };
  }
  if (sessionStatus === 'waiting') {
    return {
      label: hasPrompt ? 'Waiting for approval' : 'Waiting for input',
      dotColor: 'var(--color-idle)',
      pulse: true,
    };
  }
  // idle, stopped, or undefined
  return {
    label: 'Idle — Waiting for instructions',
    dotColor: 'var(--color-stopped)',
    pulse: false,
  };
};

interface ContextBarProps {
  model?: string;
  totalTokens: number;
  totalCost: number;
  messages: ChatMessage[];
  sessionStatus?: string;
  terminalHint?: string | null;
  hasPrompt?: boolean;
}

export const ContextBar = ({ model, totalTokens, totalCost, messages, sessionStatus, terminalHint, hasPrompt = false }: ContextBarProps) => {
  const contextLimit = getContextLimit(model);
  const contextPercent = totalTokens > 0
    ? Math.min(Math.round((totalTokens / contextLimit) * 100), 100)
    : 0;

  const barColor = contextPercent > 85
    ? 'var(--color-error)'
    : contextPercent > 60
      ? 'var(--color-idle)'
      : 'var(--color-accent)';

  const showWarning = contextPercent > 85;

  // Derive action label
  const isWorking = sessionStatus === 'working';
  const jsonlAction = isWorking ? getActionLabel(messages) : null;
  const actionLabel = jsonlAction ?? (isWorking ? terminalHint : null) ?? null;

  // Status info (always shown)
  const status = getStatusInfo(sessionStatus, actionLabel, hasPrompt);

  // Track response start time
  const responseStartRef = useRef<number>(0);
  useEffect(() => {
    if (isWorking && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.role === 'user') {
          responseStartRef.current = new Date(m.timestamp).getTime();
          break;
        }
      }
    }
  }, [isWorking, messages.length]);

  return (
    <div
      className={`shrink-0 flex items-center gap-2 px-4 lg:px-6 glass-nav overflow-hidden ${isWorking ? 'bar-working' : ''}`}
      style={{
        fontFamily: M,
        height: 34,
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Status dot + label — always visible */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${status.pulse ? 'animate-pulse' : ''}`}
          style={{ background: status.dotColor }}
        />
        <span
          className="text-sm font-medium truncate max-w-[220px]"
          style={{ color: isWorking ? 'var(--color-accent-light)' : 'var(--color-text-secondary)' }}
        >
          {status.label}
        </span>
      </div>

      {/* Elapsed timer — only when working */}
      {isWorking && responseStartRef.current > 0 && (
        <>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>
          <LiveElapsed startedAt={responseStartRef.current} />
        </>
      )}

      <span className="flex-1" />

      {/* Token count */}
      <span
        className="font-mono-stats text-xs shrink-0"
        style={{ color: 'var(--color-accent-light)' }}
      >
        {formatTokens(totalTokens)} tokens
      </span>

      <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>

      {/* Cost */}
      <span
        className="font-mono-stats text-xs shrink-0 hidden sm:inline"
        style={{ color: 'var(--color-working)' }}
      >
        {formatCost(totalCost)}
      </span>

      <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>

      {/* Context progress bar */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="text-xs hidden sm:inline-block"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Context:
        </span>
        <div
          className="w-16 sm:w-20 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(255, 255, 255, 0.06)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${contextPercent}%`,
              background: barColor,
            }}
          />
        </div>
        <span
          className="font-mono-stats text-xs shrink-0"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {contextPercent}%
        </span>
      </div>

      {/* Warning */}
      {showWarning && (
        <span
          className="text-xs hidden md:inline-block shrink-0"
          style={{ color: 'var(--color-error)' }}
        >
          consider /compact
        </span>
      )}
    </div>
  );
};
