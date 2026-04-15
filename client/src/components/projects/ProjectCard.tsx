import { useNavigate } from 'react-router-dom';
import { Check, X, FileText, Sparkles, Clock } from 'lucide-react';
import type { Project, Session } from '@commander/shared';
import { GlassCard } from '../shared/GlassCard';

const M = 'Montserrat, sans-serif';

interface ProjectCardProps {
  project: Project;
  // Sessions whose projectPath matches this project — surfaced as small
  // status dots so the user can see "this project has 2 live sessions"
  // at a glance and click through. SessionsPage cross-references and
  // passes the matched list; card renders gracefully if omitted.
  linkedSessions?: Session[];
}

const shortenPath = (path: string): string =>
  path.replace(/^\/Users\/[^/]+/, '~');

const getStatusColor = (status: string | null): string => {
  switch (status) {
    case 'in_progress': return 'var(--color-accent-light)';
    case 'complete': return 'var(--color-working)';
    case 'blocked': return 'var(--color-error)';
    default: return 'var(--color-text-tertiary)';
  }
};

const getStatusLabel = (status: string | null): string => {
  switch (status) {
    case 'in_progress': return 'In Progress';
    case 'complete': return 'Complete';
    case 'blocked': return 'Blocked';
    default: return 'Pending';
  }
};

const sessionDotColor = (status: string): string => {
  if (status === 'working') return 'var(--color-accent-light)';
  if (status === 'waiting') return 'var(--color-idle)';
  if (status === 'stopped') return 'var(--color-text-tertiary)';
  return 'var(--color-text-secondary)';
};

const timeSince = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export const ProjectCard = ({ project, linkedSessions }: ProjectCardProps) => {
  const navigate = useNavigate();
  const hasPhaseData = project.totalPhases > 0;
  const progress = hasPhaseData ? (project.completedPhases / project.totalPhases) * 100 : 0;
  const liveSessions = (linkedSessions ?? []).filter((s) => s.status !== 'stopped');
  const inProgress = project.currentPhaseStatus === 'in_progress';

  return (
    <GlassCard
      hover
      padding="p-5 sm:p-6"
      onClick={() => navigate(`/projects/${project.id}`)}
      className="cursor-pointer"
    >
      {/* Header — name + linked-sessions cluster */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3
          className="text-lg font-semibold leading-tight min-w-0 truncate"
          style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
        >
          {project.name}
        </h3>
        {liveSessions.length > 0 && (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
            }}
            title={`${liveSessions.length} active session${liveSessions.length === 1 ? '' : 's'}`}
          >
            {liveSessions.slice(0, 4).map((s) => (
              <span
                key={s.id}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: sessionDotColor(s.status) }}
              />
            ))}
            <span className="text-[10px] font-mono-stats ml-0.5" style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}>
              {liveSessions.length}
            </span>
          </div>
        )}
      </div>

      {/* Path */}
      <p
        className="font-mono-stats text-xs truncate mb-3"
        style={{ color: 'var(--color-text-tertiary)' }}
        title={project.path}
      >
        {shortenPath(project.path)}
      </p>

      {/* Phase progress */}
      {hasPhaseData ? (
        <div className="mb-3">
          <div className="flex items-baseline justify-between mb-1.5 gap-2">
            <span
              className="text-sm min-w-0 truncate"
              style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
            >
              Phase {project.completedPhases} of {project.totalPhases}
              {project.currentPhase && (
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {' '}· {project.currentPhase}
                </span>
              )}
            </span>
            <span
              className="text-xs font-mono-stats shrink-0"
              style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}
            >
              {Math.round(progress)}%
            </span>
          </div>

          {/* Progress bar — animated shimmer when actively in_progress */}
          <div
            className="h-2 rounded-full overflow-hidden relative"
            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, var(--color-accent-dark), var(--color-accent-light))',
                boxShadow: inProgress ? '0 0 8px var(--color-accent-glow)' : 'none',
              }}
            />
          </div>

          {/* Status chip */}
          {project.currentPhaseStatus && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1"
                style={{
                  fontFamily: M,
                  color: getStatusColor(project.currentPhaseStatus),
                  background: `color-mix(in srgb, ${getStatusColor(project.currentPhaseStatus)} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${getStatusColor(project.currentPhaseStatus)} 25%, transparent)`,
                }}
              >
                {inProgress && <Sparkles size={10} strokeWidth={2.4} />}
                {getStatusLabel(project.currentPhaseStatus)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p
          className="text-sm italic mb-3"
          style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
        >
          No phase data
        </p>
      )}

      {/* Footer — file indicators + last-scanned */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[11px]"
            style={{
              fontFamily: M,
              color: project.hasStateMd ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
              opacity: project.hasStateMd ? 1 : 0.55,
            }}
          >
            {project.hasStateMd
              ? <Check size={11} style={{ color: 'var(--color-working)' }} />
              : <X size={11} style={{ color: 'var(--color-text-tertiary)' }} />}
            <FileText size={10} strokeWidth={1.8} />
            STATE
          </span>
          <span
            className="inline-flex items-center gap-1 text-[11px]"
            style={{
              fontFamily: M,
              color: project.hasHandoffMd ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
              opacity: project.hasHandoffMd ? 1 : 0.55,
            }}
          >
            {project.hasHandoffMd
              ? <Check size={11} style={{ color: 'var(--color-working)' }} />
              : <X size={11} style={{ color: 'var(--color-text-tertiary)' }} />}
            <FileText size={10} strokeWidth={1.8} />
            HANDOFF
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono-stats"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={`Last scanned: ${new Date(project.lastScannedAt).toLocaleString()}`}
        >
          <Clock size={9} strokeWidth={2} />
          {timeSince(project.lastScannedAt)}
        </span>
      </div>
    </GlassCard>
  );
};
