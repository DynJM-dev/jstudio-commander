import { useSessions } from '../hooks/useSessions';
import { CityScene } from '../components/city/CityScene';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import '../components/city/city.css';

const M = 'Montserrat, sans-serif';

export const CityPage = () => {
  const { sessions, loading, error } = useSessions();

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          City
        </h1>
        <span className="text-xs font-mono-stats" style={{ color: 'var(--color-text-tertiary)' }}>
          {sessions.filter((s) => s.status !== 'stopped').length} buildings lit
        </span>
      </div>
      {loading && <LoadingSkeleton variant="chart" />}
      {error && (
        <div className="glass-card p-5">
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}
      {!loading && !error && <CityScene sessions={sessions} />}
      <p
        className="mt-3 text-xs"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
      >
        Each building is a session. Windows light up when working. A yellow
        "!" means a permission prompt is open. Click a building to open its
        chat.
      </p>
    </div>
  );
};
