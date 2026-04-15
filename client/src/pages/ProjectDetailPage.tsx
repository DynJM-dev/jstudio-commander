import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, FolderKanban } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import { PhaseTimeline } from '../components/projects/PhaseTimeline';
import { ModuleMap } from '../components/projects/ModuleMap';
import { StateViewer } from '../components/projects/StateViewer';
import { GlassCard } from '../components/shared/GlassCard';
import { api } from '../services/api';
import type { ProjectDetail } from '../hooks/useProjects';

const M = 'Montserrat, sans-serif';

const shortenPath = (path: string): string =>
  path.replace(/^\/Users\/[^/]+/, '~');

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [stateContent, setStateContent] = useState<string | null>(null);
  const [handoffContent, setHandoffContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handoffExpanded, setHandoffExpanded] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchAll = async () => {
      setLoading(true);
      setError(null);
      try {
        const [projectData, stateRes, handoffRes] = await Promise.all([
          api.get<ProjectDetail>(`/projects/${id}`),
          api.get<{ content: string }>(`/projects/${id}/state`).catch(() => null),
          api.get<{ content: string }>(`/projects/${id}/handoff`).catch(() => null),
        ]);

        setProject(projectData);
        setStateContent(stateRes?.content ?? null);
        setHandoffContent(handoffRes?.content ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [id]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <Link
          to="/projects"
          className="nav-btn nav-btn--muted mb-4"
          style={{ fontFamily: M, height: 28, padding: '0 10px', display: 'inline-flex' }}
        >
          <ArrowLeft size={14} />
          <span className="text-xs font-medium">Back to Projects</span>
        </Link>
        <div className="glass-card">
          <EmptyState
            icon={FolderKanban}
            title="Project not found"
            description={error ?? 'This project could not be loaded.'}
          />
        </div>
      </div>
    );
  }

  // Build enriched phases from handoff + project completion data
  const phases = project.handoff?.phases.map((p) => ({
    ...p,
    complete: p.number < (project.completedPhases + 1),
  })) ?? [];

  const currentPhaseNumber = project.completedPhases + 1;

  const progress = project.totalPhases > 0
    ? (project.completedPhases / project.totalPhases) * 100
    : 0;

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/projects"
          className="nav-btn nav-btn--muted mb-4"
          style={{ fontFamily: M, height: 28, padding: '0 10px', display: 'inline-flex' }}
        >
          <ArrowLeft size={14} />
          <span className="text-xs font-medium">Back to Projects</span>
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1
              className="text-2xl font-semibold leading-tight"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {project.name}
            </h1>
            <p
              className="font-mono-stats text-xs mt-1 truncate"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={project.path}
            >
              {shortenPath(project.path)}
            </p>
          </div>

          {project.totalPhases > 0 && (
            <div className="shrink-0 min-w-[180px]">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                  Progress
                </span>
                <span className="text-xs font-mono-stats" style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}>
                  {project.completedPhases}/{project.totalPhases} · {Math.round(progress)}%
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'rgba(255, 255, 255, 0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, var(--color-accent-dark), var(--color-accent-light))',
                    boxShadow: '0 0 8px var(--color-accent-glow)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phase Timeline */}
      {phases.length > 0 && (
        <GlassCard padding="p-5 sm:p-6" className="mb-4">
          <h2
            className="text-base font-semibold mb-3"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Phase Timeline
          </h2>
          <PhaseTimeline phases={phases} currentPhase={currentPhaseNumber} />
        </GlassCard>
      )}

      {/* Module Map */}
      {project.handoff && project.handoff.modules.length > 0 && (
        <GlassCard padding="p-5 sm:p-6" className="mb-4">
          <h2
            className="text-base font-semibold mb-3"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Module Map
          </h2>
          <ModuleMap modules={project.handoff.modules} />
        </GlassCard>
      )}

      {/* STATE.md viewer */}
      <GlassCard padding="p-5 sm:p-6" className="mb-4">
        <h2
          className="text-base font-semibold mb-3"
          style={{ color: 'var(--color-text-primary)' }}
        >
          STATE.md
        </h2>
        <StateViewer content={stateContent ?? ''} />
      </GlassCard>

      {/* PM_HANDOFF.md (collapsible) */}
      {handoffContent && (
        <GlassCard padding="p-0" className="overflow-hidden">
          <button
            onClick={() => setHandoffExpanded(!handoffExpanded)}
            className="flex items-center justify-between w-full px-5 py-4 sm:px-6 transition-colors group"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-expanded={handoffExpanded}
          >
            <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
              <span
                className="inline-flex items-center justify-center rounded-md transition-transform"
                style={{
                  width: 22, height: 22,
                  background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
                  color: 'var(--color-accent-light)',
                  transform: handoffExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                }}
              >
                <ChevronDown size={14} strokeWidth={2.2} />
              </span>
              PM_HANDOFF.md
            </h2>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {handoffExpanded ? 'Hide' : 'Show'}
            </span>
          </button>

          {handoffExpanded && (
            <div className="px-5 pb-5 sm:px-6 sm:pb-6" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)' }}>
              <StateViewer content={handoffContent} />
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
};
