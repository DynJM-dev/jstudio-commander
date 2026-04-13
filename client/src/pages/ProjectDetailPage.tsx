import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, FolderKanban, Loader2 } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
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
      <div className="p-4 lg:p-6 pb-24 lg:pb-6 flex items-center justify-center min-h-[50vh]" style={{ fontFamily: M }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 mb-4 text-sm transition-colors"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <ArrowLeft size={16} />
          Back to Projects
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

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 mb-3 text-sm transition-colors"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          <ArrowLeft size={16} />
          Back to Projects
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-xl font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {project.name}
            </h1>
            <p
              className="font-mono-stats text-xs mt-1"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {shortenPath(project.path)}
            </p>
          </div>

          {project.totalPhases > 0 && (
            <span
              className="text-sm font-medium shrink-0"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Phase {project.completedPhases} of {project.totalPhases}
            </span>
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
            className="flex items-center justify-between w-full px-5 py-4 sm:px-6 transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              PM_HANDOFF.md
            </h2>
            {handoffExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
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
