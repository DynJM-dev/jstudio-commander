import { useState, useEffect, useRef, useCallback } from 'react';
import { CircleGauge } from 'lucide-react';
import type { ChatMessage } from '@commander/shared';
import { formatTokens, formatCost } from '../../utils/format';
import { api } from '../../services/api';

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

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;
type EffortLevel = typeof EFFORT_LEVELS[number];

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'low',
  medium: 'med',
  high: 'high',
  max: 'max',
};

interface ContextBarProps {
  model?: string;
  totalTokens: number;
  totalCost: number;
  // In-window tokens/cost post-compaction (equals totalTokens when none). If
  // absent (older callers), we fall back to totalTokens — same behavior as
  // before compaction support landed.
  contextTokens?: number;
  contextCost?: number;
  messages: ChatMessage[];
  sessionStatus?: string;
  sessionId?: string;
  terminalHint?: string | null;
  hasPrompt?: boolean;
  messagesQueued?: boolean;
  effortLevel?: string;
  userJustSent?: boolean;
  onInterrupt?: () => void;
}

export const ContextBar = ({ model, totalTokens, totalCost, contextTokens, contextCost, messages, sessionStatus, sessionId, terminalHint, hasPrompt = false, messagesQueued = false, effortLevel = 'medium', userJustSent = false, onInterrupt }: ContextBarProps) => {
  const contextLimit = getContextLimit(model);
  const displayTokens = contextTokens ?? totalTokens;
  const displayCost = contextCost ?? totalCost;
  const compacted = contextTokens !== undefined && contextTokens !== totalTokens;
  const contextPercent = displayTokens > 0
    ? Math.min(Math.round((displayTokens / contextLimit) * 100), 100)
    : 0;

  const barColor = contextPercent > 85
    ? 'var(--color-error)'
    : contextPercent > 60
      ? 'var(--color-idle)'
      : 'var(--color-accent)';

  const showWarning = contextPercent > 85;

  // Effort level selector
  const [effort, setEffort] = useState<EffortLevel>((effortLevel as EffortLevel) || 'medium');
  const [effortOpen, setEffortOpen] = useState(false);
  const effortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (effortLevel) setEffort(effortLevel as EffortLevel);
  }, [effortLevel]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!effortOpen) return;
    const handle = (e: MouseEvent) => {
      if (effortRef.current && !effortRef.current.contains(e.target as Node)) setEffortOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [effortOpen]);

  const changeEffort = useCallback(async (level: EffortLevel) => {
    setEffort(level);
    setEffortOpen(false);
    if (sessionId) {
      // Await the command send to prevent collision with next user message
      try {
        await api.post(`/sessions/${sessionId}/command`, { command: `/effort ${level}` });
      } catch { /* ignore */ }
      // Persist per session in our DB
      api.patch(`/sessions/${sessionId}`, { effortLevel: level }).catch(() => {});
    }
  }, [sessionId]);

  // Derive action label — userJustSent provides instant "working" before server confirms
  const isWorking = sessionStatus === 'working' || userJustSent;
  const jsonlAction = isWorking ? getActionLabel(messages) : null;
  const actionLabel = jsonlAction ?? (isWorking ? terminalHint : null) ?? null;

  // Status info (always shown)
  const effectiveStatus = userJustSent && sessionStatus !== 'working' ? 'working' : sessionStatus;
  const effectiveAction = actionLabel ?? (userJustSent ? 'Processing...' : null);
  const statusInfo = getStatusInfo(effectiveStatus, effectiveAction, hasPrompt);
  const status = messagesQueued && isWorking
    ? { ...statusInfo, label: `${statusInfo.label} (queued)` }
    : statusInfo;

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
      className={`shrink-0 flex items-center gap-2 px-4 lg:px-6 glass-nav ${isWorking ? 'bar-working' : ''}`}
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
          style={{
            background: status.dotColor,
            boxShadow: effectiveStatus === 'waiting' || effectiveStatus === 'working'
              ? `0 0 6px ${status.dotColor}`
              : undefined,
          }}
        />
        <span
          className="text-sm font-medium truncate max-w-[220px]"
          style={{ color: isWorking ? 'var(--color-accent-light)' : 'var(--color-text-secondary)' }}
        >
          {status.label}
        </span>
      </div>

      {/* Elapsed timer + interrupt — only when working */}
      {isWorking && responseStartRef.current > 0 && (
        <>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>
          <LiveElapsed startedAt={responseStartRef.current} />
          {onInterrupt && (
            <button
              onClick={onInterrupt}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
              style={{
                color: 'var(--color-error)',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                fontFamily: M,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
              title="Interrupt Claude (Esc)"
            >
              Stop
            </button>
          )}
        </>
      )}

      <span className="flex-1" />

      {/* Token count — shows in-window after compaction; full total on hover. */}
      <span
        className="font-mono-stats text-xs shrink-0"
        style={{ color: 'var(--color-accent-light)' }}
        title={compacted
          ? `In-context: ${formatTokens(displayTokens)} · Total this session: ${formatTokens(totalTokens)}`
          : undefined}
      >
        {formatTokens(displayTokens)} tokens
      </span>

      <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>

      {/* Cost */}
      <span
        className="font-mono-stats text-xs shrink-0 hidden sm:inline"
        style={{ color: 'var(--color-working)' }}
        title={compacted
          ? `In-context: ${formatCost(displayCost)} · Total this session: ${formatCost(totalCost)}`
          : undefined}
      >
        {formatCost(displayCost)}
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

      {/* Effort level selector */}
      <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>
      <div ref={effortRef} className="relative shrink-0 hidden sm:block">
        <button
          onClick={() => setEffortOpen(!effortOpen)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
          style={{
            color: 'var(--color-text-secondary)',
            background: effortOpen ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
          onMouseLeave={(e) => { if (!effortOpen) e.currentTarget.style.background = 'transparent'; }}
        >
          <CircleGauge size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-xs font-mono-stats">{EFFORT_LABELS[effort]}</span>
        </button>

        {/* Dropdown */}
        {effortOpen && (
          <div
            className="absolute bottom-full right-0 mb-1 rounded-lg overflow-hidden py-1 z-50"
            style={{
              fontFamily: M,
              background: 'rgba(15, 20, 25, 0.98)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              minWidth: 100,
              boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)',
            }}
          >
            {EFFORT_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => changeEffort(level)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs transition-colors"
                style={{
                  fontFamily: M,
                  color: level === effort ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
                  background: level === effort ? 'rgba(14, 124, 123, 0.1)' : 'transparent',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = level === effort ? 'rgba(14, 124, 123, 0.15)' : 'rgba(255, 255, 255, 0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = level === effort ? 'rgba(14, 124, 123, 0.1)' : 'transparent'; }}
              >
                <span className="font-mono-stats">{level}</span>
                {level === effort && <span style={{ color: 'var(--color-accent)' }}>•</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
