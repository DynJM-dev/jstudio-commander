import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, SplitSquareHorizontal, Zap } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import type { Session } from '@commander/shared';
import { GlassCard } from '../shared/GlassCard';
import { StatusBadge } from '../shared/StatusBadge';
import { HeartbeatDot } from '../shared/HeartbeatDot';
import { CommandInput } from './CommandInput';
import { SessionActions } from './SessionActions';
import { TeammateRow } from './TeammateRow';
import { getDisplayStatus } from '../../utils/sessionDisplay';
import { useHeartbeat } from '../../hooks/useHeartbeat';

// Phase N.0 Patch 3 — when a session hasn't heartbeated in >30s, force
// the visual badge to `idle` regardless of stored status. DOES NOT
// mutate the DB; the server remains authoritative. Guards against the
// case where the pane-regex classifier is wedged on `working` /
// `waiting` for a session that is actually quiescent.
const applyStaleOverride = (rawStatus: Session['status'], isStale: boolean): Session['status'] => {
  if (!isStale) return rawStatus;
  if (rawStatus === 'working' || rawStatus === 'waiting') return 'idle';
  return rawStatus;
};

const M = 'Montserrat, sans-serif';

interface SessionCardProps {
  session: Session;
  teammates?: Session[];
  onCommand: (id: string, command: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  // Optional disambiguated label (e.g. "PM - OvaGas · e16a1c") — caller
  // computes per-list to tell same-named sessions apart. Falls back to
  // the raw name when omitted so the card still works standalone.
  displayName?: string;
  // Optional richer info — caller passes when available; card renders
  // gracefully without. Keeps SessionCard pure and testable while
  // enabling SessionsPage to pass live data when an aggregator endpoint
  // exists.
  tokensToday?: number;
  lastMessagePreview?: string;
}

const formatUptime = (createdAt: string, stoppedAt: string | null): string => {
  const start = new Date(createdAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const diffMs = end - start;

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
};

const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
};

const shortenPath = (path: string | null): string => {
  if (!path) return 'No project';
  return path.replace(/^\/Users\/[^/]+/, '~');
};

// Compact, sortable model label — strips the "claude-" prefix and any
// [1m] context suffix so cards show "opus-4-6" / "sonnet-4-6" instead of
// the full identifier.
const shortModel = (model: string | null | undefined): string => {
  if (!model) return '—';
  return model.replace(/^claude-/, '').replace(/\[.*?\]$/, '');
};

// Time-since helper for "last activity" hints. Returns "5m ago" / "2h ago"
// / "yesterday" — short enough for the metadata row.
const timeSince = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
};

export const SessionCard = ({
  session,
  teammates,
  onCommand,
  onDelete,
  onRename,
  displayName,
  tokensToday,
  lastMessagePreview,
}: SessionCardProps) => {
  const label = displayName ?? session.name;
  const navigate = useNavigate();
  const isStopped = session.status === 'stopped';
  // Phase N.0 Patch 3 — apply stale-override BEFORE computing any
  // status-derived visual state. If no heartbeat in 30s, we pretend
  // working/waiting are idle for ALL downstream derivations (status
  // badge, halos, activity row).
  const { isStale: heartbeatStale } = useHeartbeat(session.id, session.lastActivityAt);
  const effectiveStatus = applyStaleOverride(session.status, heartbeatStale);
  // Glow the parent card yellow when its teammate needs attention — makes
  // the "someone is waiting on you" signal bubble up to the top of the list.
  const anyTeammateWaiting = teammates?.some((t) => t.status === 'waiting') ?? false;
  const isWaiting = effectiveStatus === 'waiting' || anyTeammateWaiting;
  // Light-blue "teammate-active" halo when the PM pane is idle but a
  // teammate is actively working. Only renders when NOT already glowing
  // yellow for waiting — waiting is higher priority (user must act).
  const displayStatus = getDisplayStatus(
    { ...session, status: effectiveStatus },
    teammates ?? null,
  );
  const isTeammateActive = !isWaiting && displayStatus === 'teammate-active';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session.id, trimmed);
    }
    setEditing(false);
  }, [editValue, session.name, session.id, onRename]);

  const handleCardClick = () => {
    if (!editing) navigate(`/chat/${session.id}`);
  };

  return (
    <div
      className={isWaiting ? 'waiting-glow' : ''}
      style={{
        opacity: isStopped ? 0.6 : 1,
        ...(isTeammateActive ? {
          borderRadius: 20,
          boxShadow: '0 0 0 1px var(--color-teammate-active-border), 0 0 14px -4px color-mix(in srgb, var(--color-teammate-active) 40%, transparent)',
        } : null),
      }}
    >
      <GlassCard
        hover={!isStopped}
        padding="p-5 sm:p-6"
        className={isStopped ? 'hover:border-[rgba(255,255,255,0.08)] hover:shadow-[var(--shadow-glass)]' : ''}
      >
        {/* Header: Status + tmux name */}
        <div
          className="flex items-center justify-between mb-2 cursor-pointer"
          onClick={handleCardClick}
        >
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge status={effectiveStatus} showLabel size="sm" />
            <HeartbeatDot sessionId={session.id} initialTs={session.lastActivityAt} />
          </div>
          <span
            className="font-mono-stats text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {session.tmuxSession}
          </span>
        </div>

        {/* Session name — inline editable */}
        <div className="flex items-center gap-2 group">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit(); }
                if (e.key === 'Escape') { setEditValue(session.name); setEditing(false); }
              }}
              onBlur={handleRenameSubmit}
              className="text-lg font-semibold leading-tight rounded px-1 -ml-1 outline-none flex-1"
              style={{
                fontFamily: M,
                color: 'var(--color-text-primary)',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid var(--color-accent)',
              }}
            />
          ) : (
            <>
              <h3
                className="text-lg font-semibold leading-tight cursor-pointer flex-1 min-w-0 truncate"
                style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
                onClick={handleCardClick}
                title={session.teamName ? `${label} · ${session.teamName}` : label}
              >
                {label}
                {session.sessionType === 'pm' && (
                  <span
                    className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full align-middle"
                    style={{
                      fontFamily: M,
                      color: 'var(--color-accent-light)',
                      background: 'rgba(42, 183, 182, 0.12)',
                      border: '1px solid rgba(42, 183, 182, 0.22)',
                      fontWeight: 600,
                    }}
                  >
                    PM
                  </span>
                )}
                {session.teamName && (
                  <span
                    className="ml-1.5 font-normal text-sm"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    · {session.teamName}
                  </span>
                )}
              </h3>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditValue(session.name);
                  setEditing(true);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded"
                style={{ width: 24, height: 24, color: 'var(--color-text-tertiary)' }}
                title="Rename session"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>

        {/* Project path */}
        <p
          className="font-mono-stats text-xs mt-1 truncate cursor-pointer"
          style={{ color: 'var(--color-text-tertiary)' }}
          onClick={handleCardClick}
          title={session.projectPath ?? undefined}
        >
          {shortenPath(session.projectPath)}
        </p>

        {/* Pill row — model + effort. */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span
            className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-mono-stats"
            style={{
              fontFamily: M,
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--color-text-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.04)',
            }}
            title={session.model ?? undefined}
          >
            {shortModel(session.model)}
          </span>
          {session.effortLevel && (
            <span
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                fontFamily: M,
                background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                color: 'var(--color-accent-light)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
                fontWeight: 600,
              }}
              title={`Effort: ${session.effortLevel}`}
            >
              <Zap size={10} strokeWidth={2.4} />
              {session.effortLevel}
            </span>
          )}
        </div>

        {/* Phase J — live pane activity, Claude Code's own footer verb
            (e.g. "✽ Ruminating 1m 49s · 430 tokens"). Hidden when nothing
            parses; falls back to the lastMessagePreview path below when
            activity is absent so quiet sessions still get a preview line. */}
        {session.activity && effectiveStatus === 'working' && (
          <p
            className="text-xs mt-2 line-clamp-1"
            style={{ color: 'var(--color-accent-light)', fontFamily: M }}
            title={session.activity.raw}
          >
            {session.activity.spinner ? `${session.activity.spinner} ` : ''}
            {session.activity.verb}
            {session.activity.elapsed ? ` ${session.activity.elapsed}` : ''}
            {typeof session.activity.tokens === 'number' ? ` · ${session.activity.tokens.toLocaleString('en-US')} tokens` : ''}
          </p>
        )}

        {/* Last message preview — caller-supplied; muted single line. */}
        {lastMessagePreview && !(session.activity && effectiveStatus === 'working') && (
          <p
            className="text-xs mt-2 line-clamp-1 italic"
            style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
            title={lastMessagePreview}
          >
            {lastMessagePreview}
          </p>
        )}

        {/* Divider */}
        <div
          className="my-3"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        />

        {/* Stats row — tokens (when known), uptime, last-activity. */}
        <div className="flex items-center gap-2 font-mono-stats text-xs mb-3 flex-wrap">
          {typeof tokensToday === 'number' && (
            <>
              <span style={{ color: 'var(--color-accent-light)' }}>
                {formatTokens(tokensToday)} today
              </span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            </>
          )}
          <span style={{ color: 'var(--color-text-secondary)' }}>
            up {formatUptime(session.createdAt, isStopped ? session.stoppedAt : null)}
          </span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>
            {isStopped ? `stopped ${timeSince(session.stoppedAt ?? session.updatedAt)}` : timeSince(session.updatedAt)}
          </span>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2">
          {!isStopped && (
            <div className="flex-1 min-w-0">
              <CommandInput
                sessionId={session.id}
                onSend={onCommand}
                disabled={isStopped}
              />
            </div>
          )}
          {!isStopped && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/chat/${session.id}`); }}
              className="flex items-center justify-center rounded-lg transition-colors shrink-0"
              style={{
                width: 32,
                height: 32,
                color: 'var(--color-text-tertiary)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-accent-light)';
                e.currentTarget.style.background = 'rgba(42, 183, 182, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
                e.currentTarget.style.background = 'transparent';
              }}
              title="Open in split view"
              aria-label="Open in split view"
            >
              <SplitSquareHorizontal size={14} />
            </button>
          )}
          <SessionActions
            sessionId={session.id}
            isStopped={isStopped}
            onDelete={async (id) => { await onDelete(id); }}
          />
        </div>

        {/* Teammates — nested under the PM, connected visually by a thin
            vertical tree line. Clicking a row opens /chat/<pm> with the
            split already primed to that teammate. */}
        {teammates && teammates.length > 0 && (
          <div
            className="mt-3 pl-3 space-y-0.5"
            style={{ borderLeft: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            <AnimatePresence initial={false}>
              {teammates.map((t) => (
                <TeammateRow
                  key={t.id}
                  teammate={t}
                  parentId={session.id}
                  onOpen={() => navigate(`/chat/${session.id}`)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </GlassCard>
    </div>
  );
};
