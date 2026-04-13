import { useState } from 'react';

const M = 'Montserrat, sans-serif';

interface Phase {
  number: number;
  name: string;
  complete: boolean;
}

interface PhaseTimelineProps {
  phases: Phase[];
  currentPhase?: number;
}

export const PhaseTimeline = ({ phases, currentPhase }: PhaseTimelineProps) => {
  const [hoveredPhase, setHoveredPhase] = useState<number | null>(null);

  if (phases.length === 0) {
    return (
      <p
        className="text-sm italic"
        style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
      >
        No phase timeline available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-0 min-w-max px-2">
        {phases.map((phase, i) => {
          const isComplete = phase.complete || (currentPhase !== undefined && phase.number < currentPhase);
          const isCurrent = phase.number === currentPhase;
          const isHovered = hoveredPhase === phase.number;

          return (
            <div key={phase.number} className="flex items-start">
              {/* Dot + label column */}
              <div
                className="flex flex-col items-center relative"
                style={{ width: 40 }}
                onMouseEnter={() => setHoveredPhase(phase.number)}
                onMouseLeave={() => setHoveredPhase(null)}
              >
                {/* Dot */}
                <div
                  className="rounded-full shrink-0 transition-all"
                  style={{
                    width: 12,
                    height: 12,
                    background: isComplete
                      ? 'var(--color-accent)'
                      : isCurrent
                        ? 'transparent'
                        : 'transparent',
                    border: isCurrent
                      ? '2px solid var(--color-accent)'
                      : isComplete
                        ? 'none'
                        : '2px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: isCurrent ? '0 0 8px var(--color-accent-glow)' : undefined,
                    animation: isCurrent ? 'pulse-slow 2.5s ease-in-out infinite' : undefined,
                  }}
                />

                {/* Phase number */}
                <span
                  className="text-xs mt-1"
                  style={{
                    fontFamily: M,
                    color: isComplete || isCurrent
                      ? 'var(--color-text-secondary)'
                      : 'var(--color-text-tertiary)',
                  }}
                >
                  {phase.number}
                </span>

                {/* Tooltip */}
                {isHovered && (
                  <div
                    className="absolute top-full mt-4 px-2 py-1 rounded text-xs whitespace-nowrap z-10"
                    style={{
                      fontFamily: M,
                      background: 'rgba(15, 20, 25, 0.95)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {phase.name}
                  </div>
                )}
              </div>

              {/* Connecting line */}
              {i < phases.length - 1 && (
                <div
                  className="shrink-0 mt-[5px]"
                  style={{
                    width: 20,
                    height: 2,
                    background: isComplete
                      ? 'var(--color-accent)'
                      : 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 1,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
