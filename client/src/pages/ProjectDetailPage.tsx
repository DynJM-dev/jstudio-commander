import { useParams } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
      <h1
        className="text-xl font-semibold mb-6"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Project: {id}
      </h1>
      <div className="glass-card">
        <EmptyState
          icon={FolderKanban}
          title="Project detail"
          description="Phase tracking, handoff parsing, and session mapping coming soon."
        />
      </div>
    </div>
  );
};
