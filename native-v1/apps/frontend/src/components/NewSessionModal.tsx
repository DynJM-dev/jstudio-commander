import { useEffect, useState } from 'react';
import type { SessionEffort, SessionTypeId } from '@jstudio-commander/shared';
import { useSessionTypes } from '../queries/sessionTypes.js';
import { useCreateSession } from '../queries/sessions.js';
import { useSessionStore } from '../stores/sessionStore.js';

const EFFORTS: SessionEffort[] = ['low', 'medium', 'high', 'xhigh'];
const M = 'Montserrat, system-ui, sans-serif';

export function NewSessionModal() {
  const open = useSessionStore((s) => s.newSessionModalOpen);
  const close = useSessionStore((s) => s.closeNewSessionModal);
  const setActive = useSessionStore((s) => s.setActiveSessionId);
  const typesQuery = useSessionTypes();
  const createMutation = useCreateSession();

  const [projectPath, setProjectPath] = useState('');
  const [sessionTypeId, setSessionTypeId] = useState<SessionTypeId>('pm');
  const [effort, setEffort] = useState<SessionEffort>('high');

  // Reset form when opened, and snap effort default to selected session type.
  useEffect(() => {
    if (open) {
      createMutation.reset();
      setProjectPath('');
    }
  }, [open, createMutation]);

  useEffect(() => {
    const match = typesQuery.data?.find((t) => t.id === sessionTypeId);
    if (match) setEffort(match.effortDefault);
  }, [sessionTypeId, typesQuery.data]);

  if (!open) return null;

  const submit = async () => {
    if (!projectPath.trim()) return;
    const res = await createMutation.mutateAsync({
      projectPath: projectPath.trim(),
      sessionTypeId,
      effort,
    });
    setActive(res.session.id);
    close();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          fontFamily: M,
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: 24,
          width: 440,
          maxWidth: '92vw',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.55)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>New Session</h2>
        <p style={{ margin: '6px 0 18px', fontSize: 13, opacity: 0.65 }}>
          Spawn a Commander session on a project directory.
        </p>

        <label style={{ display: 'block', fontSize: 12, marginBottom: 4, opacity: 0.75 }}>
          Project path
        </label>
        <input
          type="text"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="/Users/you/Desktop/Projects/..."
          style={inputStyle}
          autoFocus
        />

        <label style={{ display: 'block', fontSize: 12, margin: '14px 0 4px', opacity: 0.75 }}>
          Session type
        </label>
        <select
          value={sessionTypeId}
          onChange={(e) => setSessionTypeId(e.target.value as SessionTypeId)}
          style={inputStyle}
        >
          {typesQuery.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.id})
            </option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: 12, margin: '14px 0 4px', opacity: 0.75 }}>
          Effort
        </label>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value as SessionEffort)}
          style={inputStyle}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        {createMutation.isError ? (
          <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 12 }}>
            {(createMutation.error as Error).message}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={close} style={btnSecondaryStyle} type="button">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={createMutation.isPending || !projectPath.trim()}
            style={btnPrimaryStyle}
            type="button"
          >
            {createMutation.isPending ? 'Spawning…' : 'Spawn session'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: M,
  background: 'var(--color-muted)',
  color: 'var(--color-foreground)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 8,
  outline: 'none',
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontFamily: M,
  background: 'transparent',
  color: 'var(--color-foreground)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontFamily: M,
  fontWeight: 600,
  background: 'var(--color-primary)',
  color: 'var(--color-primary-foreground)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};
