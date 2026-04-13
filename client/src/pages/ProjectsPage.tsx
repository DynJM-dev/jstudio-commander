import { useState, useMemo } from 'react';
import { FolderKanban, RefreshCw } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import { ProjectCard } from '../components/projects/ProjectCard';
import { useProjects } from '../hooks/useProjects';

const M = 'Montserrat, sans-serif';

type Filter = 'all' | 'active' | 'with-plan' | 'no-plan';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'with-plan', label: 'With Plan' },
  { key: 'no-plan', label: 'No Plan' },
];

export const ProjectsPage = () => {
  const { projects, loading, error, rescan, scanning } = useProjects();
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    let result = [...projects];

    switch (filter) {
      case 'active':
        result = result.filter((p) => p.currentPhaseStatus === 'in_progress');
        break;
      case 'with-plan':
        result = result.filter((p) => p.hasStateMd || p.hasHandoffMd);
        break;
      case 'no-plan':
        result = result.filter((p) => !p.hasStateMd && !p.hasHandoffMd);
        break;
    }

    // Sort: projects with STATE.md first, then alphabetical
    result.sort((a, b) => {
      if (a.hasStateMd && !b.hasStateMd) return -1;
      if (!a.hasStateMd && b.hasStateMd) return 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [projects, filter]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Projects
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <LoadingSkeleton variant="card" count={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Projects
          </h1>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {projects.length}
          </span>
        </div>
        <button
          onClick={rescan}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          style={{
            fontFamily: M,
            background: 'rgba(255, 255, 255, 0.04)',
            color: 'var(--color-text-secondary)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            opacity: scanning ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          Rescan
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              fontFamily: M,
              background: filter === f.key ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.04)',
              color: filter === f.key ? '#fff' : 'var(--color-text-secondary)',
              border: `1px solid ${filter === f.key ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.06)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="glass-card p-5 mb-4">
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            Error: {error}
          </p>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="glass-card">
          <EmptyState
            icon={FolderKanban}
            title={filter === 'all' ? 'No projects found' : 'No matching projects'}
            description={
              filter === 'all'
                ? 'Projects will appear after the initial scan completes.'
                : 'Try a different filter to see more projects.'
            }
            action={filter === 'all' ? { label: 'Scan Now', onClick: rescan } : undefined}
          />
        </div>
      )}

      {/* Project grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};
