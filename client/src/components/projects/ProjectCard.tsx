import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, FileText, Sparkles, Clock, GitCommit, ChevronDown, ChevronRight } from 'lucide-react';
import type { Project, Session, StackCategory, StackPill as StackPillType, RecentCommit } from '@commander/shared';
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

const MAX_PILLS = 6;
const COMMITS_COLLAPSED = 3;

// Category colors — framework/backend/database lean on existing theme
// vars so dark-mode inherits automatically; language (violet) and tool
// (slate) use literals since they're not in the palette.
const CATEGORY_COLOR: Record<StackCategory, string> = {
  framework: 'var(--color-accent-light)',
  language: '#8B5CF6',
  tool: '#94A3B8',
  backend: 'var(--color-working)',
  database: 'var(--color-idle)',
};

const CommitRow = ({ commit }: { commit: RecentCommit }) => (
  <li
    className="flex items-baseline gap-2 min-w-0"
    title={`${commit.sha} · ${new Date(commit.date).toLocaleString()}`}
  >
    <span
      className="text-[10px] font-mono-stats shrink-0"
      style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}
    >
      {commit.sha}
    </span>
    <span
      className="text-[11px] truncate min-w-0 flex-1"
      style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
    >
      {commit.subject}
    </span>
    <span
      className="text-[10px] font-mono-stats shrink-0"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      {timeSince(commit.date)}
    </span>
  </li>
);

const StackPillChip = ({ pill }: { pill: StackPillType }) => {
  const color = CATEGORY_COLOR[pill.category];
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{
        fontFamily: M,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
      }}
      title={`${pill.label} · ${pill.category}`}
    >
      <span
        className="w-1 h-1 rounded-full shrink-0"
        style={{ background: color }}
      />
      {pill.label}
    </span>
  );
};

export const ProjectCard = ({ project, linkedSessions }: ProjectCardProps) => {
  const navigate = useNavigate();
  const [showAllCommits, setShowAllCommits] = useState(false);
  const hasPhaseData = project.totalPhases > 0;
  const progress = hasPhaseData ? (project.completedPhases / project.totalPhases) * 100 : 0;
  const liveSessions = (linkedSessions ?? []).filter((s) => s.status !== 'stopped');
  const inProgress = project.currentPhaseStatus === 'in_progress';

  const stack = project.stack ?? [];
  const visiblePills = stack.slice(0, MAX_PILLS);
  const overflow = stack.slice(MAX_PILLS);
  const commits = project.recentCommits ?? [];
  const canCollapseCommits = commits.length > COMMITS_COLLAPSED;
  const visibleCommits = canCollapseCommits && !showAllCommits
    ? commits.slice(0, COMMITS_COLLAPSED)
    : commits;

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

      {/* Tech-stack pills — omit entirely when empty */}
      {stack.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {visiblePills.map((pill) => (
            <StackPillChip key={`${pill.category}:${pill.label}`} pill={pill} />
          ))}
          {overflow.length > 0 && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                fontFamily: M,
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
              title={overflow.map((p) => p.label).join(', ')}
            >
              +{overflow.length}
            </span>
          )}
        </div>
      )}

      {/* Recent commits — omit entirely when empty */}
      {commits.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <GitCommit size={11} strokeWidth={2} style={{ color: 'var(--color-text-tertiary)' }} />
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{ fontFamily: M, color: 'var(--color-text-tertiary)', fontWeight: 600 }}
            >
              Recent commits
            </span>
          </div>
          <ul className="space-y-0.5">
            {visibleCommits.map((c) => (
              <CommitRow key={c.sha} commit={c} />
            ))}
          </ul>
          {canCollapseCommits && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllCommits((v) => !v);
              }}
              className="mt-1 inline-flex items-center gap-1 text-[10px]"
              style={{ fontFamily: M, color: 'var(--color-text-secondary)', fontWeight: 600 }}
            >
              {showAllCommits
                ? <ChevronDown size={10} strokeWidth={2.4} />
                : <ChevronRight size={10} strokeWidth={2.4} />}
              {showAllCommits ? 'Show less' : `Show ${commits.length - COMMITS_COLLAPSED} more`}
            </button>
          )}
        </div>
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
