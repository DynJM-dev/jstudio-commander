import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import type { Project } from '@commander/shared';
import { GlassCard } from '../shared/GlassCard';

const M = 'Montserrat, sans-serif';

interface ProjectCardProps {
  project: Project;
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

export const ProjectCard = ({ project }: ProjectCardProps) => {
  const navigate = useNavigate();
  const hasPhaseData = project.totalPhases > 0;
  const progress = hasPhaseData ? (project.completedPhases / project.totalPhases) * 100 : 0;

  return (
    <GlassCard
      hover
      padding="p-5 sm:p-6"
      onClick={() => navigate(`/projects/${project.id}`)}
      className="cursor-pointer"
    >
      {/* Project name */}
      <h3
        className="text-lg font-semibold leading-tight mb-1"
        style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
      >
        {project.name}
      </h3>

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
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-sm"
              style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
            >
              Phase {project.completedPhases} of {project.totalPhases}
              {project.currentPhase && (
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {' '}· {project.currentPhase}
                </span>
              )}
            </span>
          </div>

          {/* Progress bar */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, var(--color-accent-dark), var(--color-accent-light))',
              }}
            />
          </div>

          {/* Status badge */}
          {project.currentPhaseStatus && (
            <div className="mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  fontFamily: M,
                  color: getStatusColor(project.currentPhaseStatus),
                  background: `${getStatusColor(project.currentPhaseStatus)}15`,
                }}
              >
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

      {/* File indicators */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {project.hasStateMd ? (
            <Check size={12} style={{ color: 'var(--color-working)' }} />
          ) : (
            <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          )}
          <span
            className="text-xs"
            style={{
              fontFamily: M,
              color: project.hasStateMd ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
            }}
          >
            STATE.md
          </span>
        </div>
        <div className="flex items-center gap-1">
          {project.hasHandoffMd ? (
            <Check size={12} style={{ color: 'var(--color-working)' }} />
          ) : (
            <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          )}
          <span
            className="text-xs"
            style={{
              fontFamily: M,
              color: project.hasHandoffMd ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
            }}
          >
            PM_HANDOFF.md
          </span>
        </div>
      </div>
    </GlassCard>
  );
};
