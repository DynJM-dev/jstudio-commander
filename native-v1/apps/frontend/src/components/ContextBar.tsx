// ContextBar — per-session live header. ARCHITECTURE_SPEC v1.2 §4 + N2 §1.2.
// Subscribes to session:state via wsClient; reads effort + cwd from TanStack
// Query; mutates effort via PATCH + invalidates cache.
//
// N2 scope choice (documented in PHASE_N2_REPORT §4): token / cost / context
// % surfaces are rendered structurally (placeholder dashes) because no event
// stream writes to cost_entries in N1-N2. Claude JSONL parsing that populates
// cost_entries + tool_events is N3 work (renderer registry). ContextBar
// shape is complete; data arrives in N3.

import { useEffect } from 'react';
import {
  resolveActionLabel,
  stateKindToColor,
  type SessionEffort,
  type SessionState,
} from '@jstudio-commander/shared';
import { useSessionStateStore } from '../stores/sessionStateStore.js';
import { wsClient } from '../lib/wsClient.js';
import { useSession, useUpdateSession, useStopSession } from '../queries/sessions.js';
import { useQueryClient } from '@tanstack/react-query';
import { httpJson } from '../lib/http.js';

const M = 'Montserrat, system-ui, sans-serif';
const EFFORTS: SessionEffort[] = ['low', 'medium', 'high', 'xhigh'];

interface Props {
  sessionId: string;
}

export function ContextBar({ sessionId }: Props) {
  const sessionQuery = useSession(sessionId);
  const stateFromStore = useSessionStateStore((s) => s.states[sessionId]);
  const setState = useSessionStateStore((s) => s.setState);
  const updateMutation = useUpdateSession();
  const stopMutation = useStopSession();
  const qc = useQueryClient();

  useEffect(() => {
    const off = wsClient.subscribe(`session:${sessionId}`, (event) => {
      if (event.type === 'session:state' && event.sessionId === sessionId) {
        setState(sessionId, event.state);
      }
    });
    return off;
  }, [sessionId, setState]);

  const session = sessionQuery.data;
  const state: SessionState = stateFromStore ?? {
    kind: session?.status === 'stopped' ? 'stopped' : 'active',
    since: Date.now(),
    exitCode: null,
    at: Date.now(),
  } as SessionState;

  const color = stateKindToColor(state.kind);
  const dotColor = colorToCssVar(color);
  const isWorking = state.kind === 'working';

  const onInterrupt = async () => {
    try {
      await httpJson(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' });
    } catch (err) {
      console.error('[contextbar] interrupt failed:', (err as Error).message);
    }
  };

  const onStop = () => stopMutation.mutate(sessionId);

  const onEffortChange = (next: SessionEffort) => {
    updateMutation.mutate({ id: sessionId, patch: { effort: next } });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 14px',
        fontFamily: M,
        fontSize: 12,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        color: 'var(--color-foreground)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 120 }}>
        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
          {state.kind}
        </span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{resolveActionLabel(state)}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0, opacity: 0.55, fontSize: 11 }}>
        {session?.cwd ?? ''}
      </div>

      <select
        aria-label="Effort"
        value={session?.effort ?? 'medium'}
        onChange={(e) => onEffortChange(e.target.value as SessionEffort)}
        disabled={updateMutation.isPending}
        style={{
          fontFamily: M,
          fontSize: 11,
          padding: '4px 8px',
          background: 'var(--color-muted)',
          color: 'var(--color-foreground)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 6,
        }}
      >
        {EFFORTS.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>

      {isWorking ? (
        <button
          type="button"
          onClick={() => void onInterrupt()}
          title="Send Ctrl+C to running command"
          style={miniButtonStyle('danger')}
        >
          Stop
        </button>
      ) : null}

      {state.kind !== 'stopped' ? (
        <button
          type="button"
          onClick={onStop}
          title="Terminate session (kills shell)"
          style={miniButtonStyle('neutral')}
        >
          End
        </button>
      ) : null}

      <span style={countersStyle}>
        tok <span style={{ opacity: 0.55 }}>—</span>
      </span>
      <span style={countersStyle}>
        cost <span style={{ opacity: 0.55 }}>—</span>
      </span>
      <span style={countersStyle}>
        ctx <span style={{ opacity: 0.55 }}>—</span>
      </span>

      <button
        type="button"
        onClick={() => {
          void qc.invalidateQueries({ queryKey: ['sessions', sessionId] });
        }}
        title="Refresh session data"
        style={miniButtonStyle('neutral')}
      >
        ↻
      </button>
    </div>
  );
}

function colorToCssVar(
  color: 'neutral' | 'active' | 'success' | 'warning' | 'danger',
): string {
  switch (color) {
    case 'neutral':
      return 'rgba(255, 255, 255, 0.45)';
    case 'active':
      return 'var(--color-primary)';
    case 'success':
      return '#4ade80';
    case 'warning':
      return '#ffbd3d';
    case 'danger':
      return 'var(--color-danger)';
  }
}

function miniButtonStyle(kind: 'neutral' | 'danger'): React.CSSProperties {
  return {
    fontFamily: M,
    fontSize: 11,
    padding: '4px 10px',
    background: kind === 'danger' ? 'var(--color-danger)' : 'var(--color-muted)',
    color:
      kind === 'danger' ? 'var(--color-primary-foreground)' : 'var(--color-foreground)',
    border:
      kind === 'danger'
        ? '1px solid var(--color-danger)'
        : '1px solid var(--color-border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
  };
}

const countersStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: M,
  opacity: 0.85,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'var(--color-muted)',
};
