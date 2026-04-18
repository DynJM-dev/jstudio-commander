import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CircleGauge,
  FileText,
  PenTool,
  Terminal,
  Search,
  Zap,
  Brain,
  BookOpen,
  MessageCircle,
  RotateCw,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage, SessionActivity, SessionTick } from '@commander/shared';
import { formatTokens, formatCost } from '../../utils/format';
import { getActivePlan } from '../../utils/plans';
import { api } from '../../services/api';
import { getContextLimit } from '@commander/shared';
import { useSessions } from '../../hooks/useSessions';

const M = 'Montserrat, sans-serif';

interface ActionInfo {
  label: string;
  icon: LucideIcon | null;
}

const getActionInfo = (messages: ChatMessage[]): ActionInfo | null => {
  if (messages.length === 0) return null;
  let lastMsg: ChatMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') { lastMsg = messages[i]; break; }
  }
  if (!lastMsg) return null;

  const blocks = lastMsg.content;
  const lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return null;

  if (lastBlock.type === 'thinking') return { label: 'Cogitating...', icon: Brain };
  if (lastBlock.type === 'text') return { label: 'Composing response...', icon: null };

  if (lastBlock.type === 'tool_use') {
    const name = lastBlock.name;
    const fp = typeof lastBlock.input.file_path === 'string'
      ? lastBlock.input.file_path.split('/').pop() ?? ''
      : '';
    if (name === 'Read') {
      const path = typeof lastBlock.input.file_path === 'string' ? lastBlock.input.file_path : '';
      if (/\/\.claude\/skills\//.test(path)) return { label: `Reading skill ${fp || ''}...`, icon: Brain };
      if (/\/memory\/[^/]+\.md$/.test(path) || /\b(CODER_BRAIN|PM_HANDOFF|STATE|CLAUDE|MEMORY)\.md$/.test(path)) {
        return { label: `Reading ${fp}...`, icon: BookOpen };
      }
      return { label: fp ? `Reading ${fp}...` : 'Reading file...', icon: FileText };
    }
    if (name === 'Edit') return { label: fp ? `Editing ${fp}...` : 'Editing file...', icon: PenTool };
    if (name === 'Write') return { label: fp ? `Writing ${fp}...` : 'Writing file...', icon: PenTool };
    if (name === 'Bash') return { label: 'Running command...', icon: Terminal };
    if (name === 'Grep' || name === 'Glob') return { label: 'Searching...', icon: Search };
    if (name === 'Agent') return { label: 'Spawning agent...', icon: Zap };
    if (name === 'Skill') return { label: 'Loading skill...', icon: Brain };
    if (name === 'SendMessage') return { label: 'Messaging teammate...', icon: MessageCircle };
    return { label: 'Working...', icon: null };
  }

  return null;
};

const getActionLabel = (messages: ChatMessage[]): string | null => getActionInfo(messages)?.label ?? null;

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
  activeTeammateCount: number,
  workingTeammateCount: number,
): StatusInfo => {
  if (sessionStatus === 'working') {
    return {
      label: actionLabel ?? 'Working...',
      dotColor: 'var(--color-accent)',
      pulse: true,
    };
  }
  if (sessionStatus === 'waiting') {
    // Only call it "Waiting for input" when there's a real actionable
    // prompt OR no teammates are running. A PM that's just paused for
    // its coders to finish is "monitoring", not awaiting a click —
    // labeling that as "Waiting for input" with a yellow glow is the
    // false-positive Phase G.1 closes.
    if (hasPrompt) {
      return { label: 'Waiting for approval', dotColor: 'var(--color-idle)', pulse: true };
    }
    if (activeTeammateCount > 0) {
      // Light-blue dot for teammate-active state even on `waiting` rows —
      // the pane may have entered the `waiting` branch via an ambiguous
      // footer match while teammates are still churning. Blue signals
      // "productive, no action needed".
      return {
        label: `Monitoring ${activeTeammateCount} teammate${activeTeammateCount === 1 ? '' : 's'}`,
        dotColor: workingTeammateCount > 0 ? 'var(--color-teammate-active)' : 'var(--color-accent)',
        pulse: true,
      };
    }
    return { label: 'Waiting for input', dotColor: 'var(--color-idle)', pulse: true };
  }
  // idle / stopped / undefined — surface teammate-active when the PM is
  // genuinely idle but a teammate is working. The session is productive;
  // don't paint it with the stopped-grey that means "nothing happening".
  if (sessionStatus === 'idle' && workingTeammateCount > 0) {
    return {
      label: `Monitoring ${activeTeammateCount} teammate${activeTeammateCount === 1 ? '' : 's'}`,
      dotColor: 'var(--color-teammate-active)',
      pulse: true,
    };
  }
  return {
    label: 'Idle — Waiting for instructions',
    dotColor: 'var(--color-stopped)',
    pulse: false,
  };
};

// Issue 8 Part 2 — selector shows the full `claude --effort` ladder
// now (low, medium, high, xhigh, max). Pre-Issue-8 Commander omitted
// `low` and `medium` from the dropdown based on an older matrix; the
// CLI has always accepted both, Jose uses them live, and hiding them
// created a drift between the chat bar and the actual underlying
// command Claude runs. Order is low→max; labels match CLI spelling
// (no marketing renames) except xhigh gets a humanized "x-high" to
// match the convention used in the Commander UI since phase M1.
import type { EffortLevel as SharedEffortLevel } from '@commander/shared';
import { EFFORT_LEVELS as SHARED_EFFORT_LEVELS } from '@commander/shared';
const EFFORT_LEVELS = SHARED_EFFORT_LEVELS;
type EffortLevel = SharedEffortLevel;

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'x-high',
  max: 'max',
};

// Issue 8 Part 2 — accept the full CLI ladder. Anything outside it
// falls back to xhigh (Commander's feature-work default) rather than
// silently corrupting the selector state.
const normalizeEffort = (raw?: string): EffortLevel => {
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw;
  return 'xhigh';
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
  // Phase J — live pane-activity snapshot parsed from the Claude Code footer
  // ("✽ Ruminating (1m 49s · 430 tokens · thinking with xhigh effort)"). Null
  // when nothing parses; we then fall back to the existing generic labels.
  activity?: SessionActivity | null;
  sessionId?: string;
  terminalHint?: string | null;
  hasPrompt?: boolean;
  messagesQueued?: boolean;
  effortLevel?: string;
  userJustSent?: boolean;
  onInterrupt?: () => void;
  // True while an interrupt is being delivered — button shows "Stopping..."
  interrupting?: boolean;
  // User-triggered force re-sync (#237). Refetches chat + stats,
  // clears any client-side dedup cache, and POSTs /sessions/:id/rescan
  // for a server-side status re-probe (fire-and-forget; silently
  // ignores 404 if endpoint is absent).
  onRefresh?: () => Promise<void> | void;
  // Phase S.1 Patch 4 — single-source-of-truth ctx%. When present, the
  // bar renders tick.contextWindow.usedPercentage as the authoritative
  // percentage (same feed LiveActivityRow and the band rail read from).
  // Absent-or-null falls back to the legacy token/contextLimit ratio so
  // pre-Phase-M sessions still render something sensible.
  sessionTick?: SessionTick | null;
}

// Phase S.1 Patch 4 — tick-first ctx% resolver. Exported so unit tests
// can exercise the tick-vs-fallback branch without rendering React.
// When the tick has arrived we render its `usedPercentage` verbatim so
// this bar, LiveActivityRow, the band rail, and ContextLowToast all
// display the same number. Fallback path (no tick or null percentage)
// keeps the legacy `tokens / contextLimit` ratio so pre-Phase-M
// sessions still render a sensible value.
export const resolveContextPercent = (
  tick: SessionTick | null | undefined,
  displayTokens: number,
  contextLimit: number,
): number => {
  const tickPct = tick?.contextWindow.usedPercentage ?? null;
  if (tickPct !== null) return Math.min(Math.round(tickPct), 100);
  if (displayTokens <= 0 || contextLimit <= 0) return 0;
  return Math.min(Math.round((displayTokens / contextLimit) * 100), 100);
};

export const ContextBar = ({ model, totalTokens, totalCost, contextTokens, contextCost, messages, sessionStatus, activity = null, sessionId, terminalHint, hasPrompt = false, messagesQueued = false, effortLevel = 'xhigh', userJustSent = false, onInterrupt, interrupting = false, onRefresh, sessionTick = null }: ContextBarProps) => {
  const contextLimit = getContextLimit(model);
  const displayTokens = contextTokens ?? totalTokens;
  const displayCost = contextCost ?? totalCost;
  const compacted = contextTokens !== undefined && contextTokens !== totalTokens;
  const contextPercent = resolveContextPercent(sessionTick, displayTokens, contextLimit);

  const barColor = contextPercent > 85
    ? 'var(--color-error)'
    : contextPercent > 60
      ? 'var(--color-idle)'
      : 'var(--color-accent)';

  const showWarning = contextPercent > 85;

  // Effort level selector
  const [effort, setEffort] = useState<EffortLevel>(normalizeEffort(effortLevel));
  const [effortOpen, setEffortOpen] = useState(false);
  const effortRef = useRef<HTMLDivElement>(null);

  // Manual refresh (#237) — tracks the spin + a brief checkmark-toast.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const handleRefresh = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally {
      setRefreshing(false);
      setRefreshedAt(Date.now());
      setTimeout(() => setRefreshedAt(0), 1000);
    }
  }, [onRefresh, refreshing]);

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
  const jsonlAction = isWorking ? getActionInfo(messages) : null;
  const actionLabel = jsonlAction?.label ?? (isWorking ? terminalHint : null) ?? null;
  const ActionIcon = jsonlAction?.icon ?? null;

  // Active-teammate count for the current session — drives the
  // "Monitoring N teammates" label so a paused PM with running coders
  // doesn't get the misleading "Waiting for input" yellow-glow card.
  // Mirrors the keying from TopCommandBar's bot badge: parent_session_id
  // on a teammate row may match either the Commander UUID or the
  // claudeSessionId, so we count both.
  const { sessions } = useSessions();
  const { activeTeammateCount, workingTeammateCount } = useMemo(() => {
    if (!sessionId) return { activeTeammateCount: 0, workingTeammateCount: 0 };
    const me = sessions.find((s) => s.id === sessionId);
    const claudeId = me?.claudeSessionId;
    let active = 0;
    let working = 0;
    for (const s of sessions) {
      if (!s.parentSessionId || s.status === 'stopped') continue;
      const matches = s.parentSessionId === sessionId
        || (claudeId ? s.parentSessionId === claudeId : false);
      if (!matches) continue;
      active += 1;
      if (s.status === 'working') working += 1;
    }
    return { activeTeammateCount: active, workingTeammateCount: working };
  }, [sessions, sessionId]);

  // Status info (always shown)
  const effectiveStatus = userJustSent && sessionStatus !== 'working' ? 'working' : sessionStatus;
  const effectiveAction = actionLabel ?? (userJustSent ? 'Processing...' : null);
  const statusInfo = getStatusInfo(effectiveStatus, effectiveAction, hasPrompt, activeTeammateCount, workingTeammateCount);
  // Drives the bar-teammate-active CSS class: only when the PM pane is idle
  // AND a teammate is working AND no user-actionable prompt is pending.
  const isTeammateActiveDisplay =
    !isWorking && !hasPrompt && workingTeammateCount > 0 && (effectiveStatus === 'idle' || effectiveStatus === 'waiting');
  const status = messagesQueued && isWorking
    ? { ...statusInfo, label: `${statusInfo.label} (queued)` }
    : statusInfo;

  // Token-rate sampler — ring buffer of the last 10 (tokens, timestamp)
  // observations. Every stats update pushes a sample; the rate is computed
  // as the delta between oldest and newest, smoothed by 2-sample averaging.
  // Capped at 10 entries to prevent unbounded growth.
  const tokenSamplesRef = useRef<Array<{ tokens: number; ts: number }>>([]);
  const [tokenRate, setTokenRate] = useState<number>(0);
  useEffect(() => {
    if (!isWorking) {
      tokenSamplesRef.current = [];
      setTokenRate(0);
      return;
    }
    const buf = tokenSamplesRef.current;
    const now = Date.now();
    // Dedup consecutive identical token counts (polling returned no growth)
    const last = buf[buf.length - 1];
    if (!last || last.tokens !== totalTokens) {
      buf.push({ tokens: totalTokens, ts: now });
      if (buf.length > 10) buf.shift();
    }
    if (buf.length >= 2) {
      const oldest = buf[0]!;
      const newest = buf[buf.length - 1]!;
      const dt = (newest.ts - oldest.ts) / 1000;
      if (dt > 0) {
        const raw = (newest.tokens - oldest.tokens) / dt;
        // 2-sample moving average against the previous reported rate
        setTokenRate((prev) => prev > 0 ? Math.round((prev + raw) / 2) : Math.round(raw));
      }
    }
  }, [totalTokens, isWorking]);

  // Long-running detection — ticks once per second while working, flips to
  // true past 60s elapsed so we can surface a "Long task" badge. setInterval
  // rather than rAF so the cadence is cheap; cleaned up on unmount/stop.
  const [elapsedSecs, setElapsedSecs] = useState(0);

  // Active-plan progress readout for the Long-task pill. Computed from the
  // same getActivePlan pipeline the StickyPlanWidget uses so the counter
  // stays in lockstep with the plan card.
  const planProgress = useMemo(() => {
    const active = getActivePlan(messages);
    if (!active || active.plan.length === 0) return null;
    const done = active.plan.filter((t) => t.status === 'completed').length;
    return { done, total: active.plan.length };
  }, [messages]);

  // Token-rate tone — green when healthy, amber after 15s of underspeed.
  const underspeedSinceRef = useRef<number>(0);
  const tokenRateTone = useMemo(() => {
    if (!isWorking || tokenRate <= 0) { underspeedSinceRef.current = 0; return 'neutral'; }
    if (tokenRate >= 8) { underspeedSinceRef.current = 0; return 'healthy'; }
    if (tokenRate < 3) {
      if (underspeedSinceRef.current === 0) underspeedSinceRef.current = Date.now();
      return Date.now() - underspeedSinceRef.current > 15_000 ? 'slow' : 'neutral';
    }
    underspeedSinceRef.current = 0;
    return 'neutral';
  }, [tokenRate, isWorking]);
  const rateColor =
    tokenRateTone === 'healthy' ? 'var(--color-working)'
    : tokenRateTone === 'slow' ? 'var(--color-idle)'
    : 'var(--color-text-tertiary)';

  // Track response start time
  const responseStartRef = useRef<number>(0);

  // Cheap 1s ticker — drives the Long-task threshold (60s) without hammering
  // re-renders. Cleared when isWorking flips off so no stuck state.
  useEffect(() => {
    if (!isWorking) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      const started = responseStartRef.current;
      setElapsedSecs(started > 0 ? Math.floor((Date.now() - started) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [isWorking]);
  const isLongTask = isWorking && elapsedSecs >= 60;

  // Reset the elapsed reference to the latest turn boundary on every message
  // change — NOT just when isWorking toggles. A turn boundary is:
  //   1. A user message (including tool_result-only echoes during a tool loop)
  //   2. The FIRST assistant message after a user message (start-of-compose)
  // Prior implementation pinned the reference only to the last user message,
  // which drifted stale across a long compose: the ContextBar kept reading
  // "300s" while the Claude Code pane's own counter had already reset on the
  // current tool/compose phase. Walking forward and snapping on each boundary
  // keeps our display in lockstep with pane semantics.
  //
  // Also resets when userJustSent flips on — pre-server-confirm we use the
  // current wallclock so the counter starts from 0, not from the stale prior
  // reference, even before the optimistic user message lands in `messages`.
  const lastBoundaryTs = useMemo(() => {
    let ref = 0;
    let sawUserSinceLastAssistant = false;
    for (const msg of messages) {
      const ts = Date.parse(msg.timestamp);
      if (!ts || Number.isNaN(ts)) continue;
      if (msg.role === 'user') {
        ref = ts;
        sawUserSinceLastAssistant = true;
      } else if (msg.role === 'assistant' && sawUserSinceLastAssistant) {
        ref = ts;
        sawUserSinceLastAssistant = false;
      }
    }
    return ref;
  }, [messages]);

  useEffect(() => {
    if (!isWorking) return;
    if (userJustSent) {
      // Optimistic send — the message may not be in `messages` yet. Anchor
      // to wallclock so the counter starts at 0 on the new turn.
      const now = Date.now();
      if (responseStartRef.current === 0 || responseStartRef.current < now - 250) {
        responseStartRef.current = now;
      }
      return;
    }
    if (lastBoundaryTs > 0) responseStartRef.current = lastBoundaryTs;
  }, [isWorking, userJustSent, lastBoundaryTs]);

  return (
    <div
      className={`shrink-0 flex items-center gap-2 px-4 lg:px-6 glass-nav ${isWorking ? 'bar-working' : ''} ${effectiveStatus === 'waiting' && !isTeammateActiveDisplay ? 'bar-waiting' : ''} ${isTeammateActiveDisplay ? 'bar-teammate-active' : ''}`}
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
        {ActionIcon && (
          <ActionIcon
            size={13}
            className="shrink-0"
            style={{ color: 'var(--color-accent-light)' }}
          />
        )}
        <span
          className="text-sm font-medium truncate max-w-[220px]"
          style={{ color: isWorking ? 'var(--color-accent-light)' : 'var(--color-text-secondary)' }}
        >
          {status.label}
        </span>
        {/* Live pane-activity verb + metadata — swaps in for the generic
            status string when the footer parsed something, so the user
            sees the same "✽ Ruminating 1m 49s · 430 tokens" that the pane
            shows. Renders a dot separator between it and the status label
            so they read as one line without a layout jump. */}
        {isWorking && activity && (
          <>
            <span className="text-xs shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            <span
              className="text-xs shrink-0 truncate max-w-[260px]"
              style={{ color: 'var(--color-accent-light)', fontFamily: M }}
              title={activity.raw}
            >
              {activity.spinner ? `${activity.spinner} ` : ''}
              {activity.verb}
              {activity.elapsed ? ` ${activity.elapsed}` : ''}
              {typeof activity.tokens === 'number' ? ` · ${activity.tokens.toLocaleString('en-US')} tokens` : ''}
            </span>
          </>
        )}
      </div>

      {/* Elapsed timer — only once we've seen a working transition */}
      {isWorking && responseStartRef.current > 0 && (
        <>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>
          <LiveElapsed startedAt={responseStartRef.current} />
          {isLongTask && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                fontFamily: M,
                color: 'var(--color-accent-light)',
                background: 'rgba(42, 183, 182, 0.1)',
                border: '1px solid rgba(42, 183, 182, 0.22)',
              }}
              title={planProgress ? `Plan progress: ${planProgress.done}/${planProgress.total}` : 'Long-running response'}
            >
              {planProgress ? `Step ${planProgress.done}/${planProgress.total}` : 'Long task'}
            </span>
          )}
        </>
      )}

      {/* Stop button — visible whenever Claude may still be running. Status
          polling has up to 1.5s lag, so we err on the side of keeping the
          button reachable rather than hiding it momentarily. `interrupting`
          keeps it up while feedback plays. */}
      {onInterrupt && (isWorking || hasPrompt || interrupting) && (
        <motion.button
          onClick={onInterrupt}
          disabled={interrupting}
          whileTap={{ scale: 0.96 }}
          animate={interrupting ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={interrupting ? { duration: 0.4, repeat: Infinity } : { duration: 0.15 }}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ml-2"
          style={{
            color: 'var(--color-error)',
            background: interrupting ? 'rgba(239, 68, 68, 0.22)' : 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            fontFamily: M,
            cursor: interrupting ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => { if (!interrupting) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
          onMouseLeave={(e) => { if (!interrupting) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
          title="Interrupt Claude (Esc or Cmd+.)"
        >
          {interrupting ? 'Stopping…' : 'Stop'}
        </motion.button>
      )}

      {/* Manual refresh (#237) — user-driven re-sync for suspected stale
          chat state. 1s checkmark toast replaces the icon on success.
          Issue 8 Part 4: matches Stop's sizing (px-2 py-0.5 text-xs)
          so the two buttons read as one control surface. The Phase P.2
          C4 44×44 hit area is retained via touch-action fallback on
          mobile without enlarging the desktop visual. */}
      {onRefresh && (
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ml-2"
          style={{
            fontFamily: M,
            color: refreshedAt ? 'var(--color-working)' : 'var(--color-accent-light)',
            background: refreshedAt ? 'rgba(34, 197, 94, 0.12)' : 'rgba(42, 183, 182, 0.08)',
            border: '1px solid rgba(42, 183, 182, 0.2)',
            cursor: refreshing ? 'default' : 'pointer',
            opacity: refreshing && !refreshedAt ? 0.6 : 1,
          }}
          onMouseEnter={(e) => { if (!refreshing && !refreshedAt) e.currentTarget.style.background = 'rgba(42, 183, 182, 0.15)'; }}
          onMouseLeave={(e) => { if (!refreshing && !refreshedAt) e.currentTarget.style.background = 'rgba(42, 183, 182, 0.08)'; }}
          title={refreshedAt ? 'Refreshed' : 'Refresh chat (force re-sync)'}
          aria-label={refreshedAt ? 'Refreshed' : 'Refresh chat'}
        >
          {refreshedAt ? (
            <Check size={12} strokeWidth={2.4} />
          ) : (
            <RotateCw size={12} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
          )}
        </button>
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

      {/* Streaming token rate — only while working and we've collected at
          least two samples. Color reflects tone (healthy/neutral/slow). */}
      {isWorking && tokenRate > 0 && (
        <span
          className="font-mono-stats text-xs shrink-0 hidden sm:inline"
          style={{ color: rateColor }}
          title={
            tokenRateTone === 'slow'
              ? 'Rate has been below 3 tok/s for > 15s — Claude may be stuck'
              : `${tokenRate} tokens/sec`
          }
        >
          · {tokenRate}/s
        </span>
      )}

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
            data-escape-owner="effort-dropdown"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEffortOpen(false);
              }
            }}
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
