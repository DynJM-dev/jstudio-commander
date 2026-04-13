import { FolderKanban } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const ProjectsPage = () => (
  <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
    <h1
      className="text-xl font-semibold mb-6"
      style={{ color: 'var(--color-text-primary)' }}
    >
      Projects
    </h1>
    <div className="glass-card">
      <EmptyState
        icon={FolderKanban}
        title="No projects found"
        description="Projects will appear after the initial scan completes."
      />
    </div>
  </div>
);
