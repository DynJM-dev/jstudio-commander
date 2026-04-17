import type { PreCompactState } from '@commander/shared';

const M = 'Montserrat, sans-serif';

interface Props {
  state: PreCompactState;
}

// Phase Q — tiny text indicator rendered under the HeartbeatDot on
// SessionCard. `idle` renders nothing; `warned` and `compacting`
// surface so the user can tell, at a glance, that Commander is
// managing the session's context window.

export const PreCompactIndicator = ({ state }: Props) => {
  if (state === 'idle') return null;

  const label = state === 'warned' ? '⚠ Waiting for state save' : '⟳ Compacting';
  const color = state === 'warned' ? 'var(--color-warning)' : 'var(--color-accent-light)';

  return (
    <span
      className="inline-block"
      style={{
        fontFamily: M,
        fontSize: 10,
        color,
        fontWeight: 500,
        letterSpacing: 0.2,
      }}
      data-testid="pre-compact-indicator"
      data-state={state}
    >
      {label}
    </span>
  );
};

// Exported for tests — pure label lookup.
export const labelForPreCompactState = (state: PreCompactState): string | null => {
  switch (state) {
    case 'warned':
      return '⚠ Waiting for state save';
    case 'compacting':
      return '⟳ Compacting';
    default:
      return null;
  }
};
