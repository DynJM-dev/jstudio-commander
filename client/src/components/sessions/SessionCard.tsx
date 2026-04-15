import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import type { Session } from '@commander/shared';
import { GlassCard } from '../shared/GlassCard';
import { StatusBadge } from '../shared/StatusBadge';
import { CommandInput } from './CommandInput';
import { SessionActions } from './SessionActions';
import { TeammateRow } from './TeammateRow';

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

export const SessionCard = ({ session, teammates, onCommand, onDelete, onRename, displayName }: SessionCardProps) => {
  const label = displayName ?? session.name;
  const navigate = useNavigate();
  const isStopped = session.status === 'stopped';
  // Glow the parent card yellow when its teammate needs attention — makes
  // the "someone is waiting on you" signal bubble up to the top of the list.
  const anyTeammateWaiting = teammates?.some((t) => t.status === 'waiting') ?? false;
  const isWaiting = session.status === 'waiting' || anyTeammateWaiting;
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
      style={{ opacity: isStopped ? 0.6 : 1 }}
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
          <StatusBadge status={session.status} showLabel size="sm" />
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

        {/* Model pill */}
        <div className="mt-2">
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily: M,
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {session.model}
          </span>
        </div>

        {/* Divider */}
        <div
          className="my-3"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        />

        {/* Stats row */}
        <div className="flex items-center gap-3 font-mono-stats text-sm mb-3">
          <span style={{ color: 'var(--color-accent-light)' }}>
            {formatTokens(0)} tokens
          </span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
          <span style={{ color: 'var(--color-working)' }}>$0.00</span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {isStopped ? `stopped ${formatUptime(session.stoppedAt ?? session.createdAt, null)} ago` : formatUptime(session.createdAt, null)}
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
