import { useNavigate } from 'react-router-dom';
import type { Session } from '@commander/shared';
import { GlassCard } from '../shared/GlassCard';
import { StatusBadge } from '../shared/StatusBadge';
import { CommandInput } from './CommandInput';
import { SessionActions } from './SessionActions';

const M = 'Montserrat, sans-serif';

interface SessionCardProps {
  session: Session;
  onCommand: (id: string, command: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
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

export const SessionCard = ({ session, onCommand, onDelete, onRename }: SessionCardProps) => {
  const navigate = useNavigate();
  const isStopped = session.status === 'stopped';

  const handleCardClick = () => {
    navigate(`/chat/${session.id}`);
  };

  return (
    <div style={{ opacity: isStopped ? 0.6 : 1 }}>
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

        {/* Slug name */}
        <div
          className="cursor-pointer"
          onClick={handleCardClick}
        >
          <h3
            className="text-lg font-semibold leading-tight"
            style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
          >
            {session.name}
          </h3>
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
            currentName={session.name}
            onDelete={async (id) => { await onDelete(id); }}
            onRename={async (id, name) => { await onRename(id, name); }}
          />
        </div>
      </GlassCard>
    </div>
  );
};
