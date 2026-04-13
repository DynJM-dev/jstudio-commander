const M = 'Montserrat, sans-serif';

interface Module {
  name: string;
  priority: string;
  description: string;
}

interface ModuleMapProps {
  modules: Module[];
}

const priorityColor = (priority: string): string => {
  switch (priority) {
    case 'P0': return 'var(--color-accent-light)';
    case 'P1': return 'var(--color-waiting)';
    case 'P2': return 'var(--color-text-tertiary)';
    default: return 'var(--color-text-tertiary)';
  }
};

export const ModuleMap = ({ modules }: ModuleMapProps) => {
  if (modules.length === 0) {
    return (
      <p
        className="text-sm italic"
        style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
      >
        No module map available
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {modules.map((mod) => (
        <div
          key={mod.name}
          className="glass-card p-3"
          style={{ cursor: 'default' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-sm font-semibold truncate"
              style={{ fontFamily: M, color: 'var(--color-text-primary)' }}
            >
              {mod.name}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ml-1"
              style={{
                fontFamily: M,
                color: priorityColor(mod.priority),
                background: `${priorityColor(mod.priority)}15`,
              }}
            >
              {mod.priority}
            </span>
          </div>
          <p
            className="text-xs line-clamp-2"
            style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
          >
            {mod.description}
          </p>
        </div>
      ))}
    </div>
  );
};
