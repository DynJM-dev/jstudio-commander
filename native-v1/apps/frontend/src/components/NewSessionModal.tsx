// NewSessionModal — N2.1 rework. All four surfaces (path picker, session
// type, effort, submit) render unconditionally, with explicit loading /
// error / retry states for the session-types dependency (Task 4 defensive
// wiring).
//
// Path defaults:
//   - PM / Coder: no pre-fill; user must explicitly pick.
//   - Raw: pre-fills from preferences.rawSession.defaultCwd (default "~").

import { useEffect, useState } from 'react';
import type { SessionEffort, SessionTypeId } from '@jstudio-commander/shared';
import { useSessionTypes } from '../queries/sessionTypes.js';
import { useCreateSession } from '../queries/sessions.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useWorkspaceStore } from '../stores/workspaceStore.js';
import { usePreference } from '../queries/preferences.js';
import { ProjectPathPicker } from './path-picker/ProjectPathPicker.js';

const EFFORTS: SessionEffort[] = ['low', 'medium', 'high', 'xhigh'];
const M = 'Montserrat, system-ui, sans-serif';

export function NewSessionModal() {
  const open = useSessionStore((s) => s.newSessionModalOpen);
  const close = useSessionStore((s) => s.closeNewSessionModal);
  const setActive = useSessionStore((s) => s.setActiveSessionId);
  const setPaneSession = useWorkspaceStore((s) => s.setPaneSession);
  const focusedIndex = useWorkspaceStore((s) => s.layout.focusedIndex);
  const typesQuery = useSessionTypes();
  const createMutation = useCreateSession();
  const rawCwdPref = usePreference('rawSession.defaultCwd');

  const [projectPath, setProjectPath] = useState('');
  const [sessionTypeId, setSessionTypeId] = useState<SessionTypeId>('pm');
  const [effort, setEffort] = useState<SessionEffort>('high');

  // Reset on open. N2.1.2 fix: `createMutation` is intentionally absent
  // from the dep array. TanStack Query v5's useMutation returns a fresh
  // wrapper object on every render (see diagnostics/N2.1.2-modal-
  // selection-evidence.md §3), so including it here fired this effect on
  // EVERY render, re-wiping projectPath + sessionTypeId immediately after
  // the user picked them (Jose N2.1.1 smoke steps 8 + 9). We read
  // `createMutation.reset()` inside the body — the callback itself IS
  // stable — but must not depend on the outer wrapper's reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      createMutation.reset();
      setProjectPath('');
      setSessionTypeId('pm');
    }
  }, [open]);

  // Snap effort to the selected session type's default.
  useEffect(() => {
    const match = typesQuery.data?.find((t) => t.id === sessionTypeId);
    if (match) setEffort(match.effortDefault);
  }, [sessionTypeId, typesQuery.data]);

  // Raw session pre-fills default cwd; PM / Coder leaves empty.
  useEffect(() => {
    if (sessionTypeId === 'raw') {
      if (!projectPath) {
        const defaultCwd = rawCwdPref.data?.value ?? '~';
        setProjectPath(defaultCwd);
      }
    }
    // No effect on PM/Coder — user explicitly picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionTypeId, rawCwdPref.data?.value]);

  if (!open) return null;

  const submit = async () => {
    if (!projectPath.trim()) return;
    const res = await createMutation.mutateAsync({
      projectPath: projectPath.trim(),
      sessionTypeId,
      effort,
    });
    setActive(res.session.id);
    setPaneSession(focusedIndex, res.session.id);
    close();
  };

  const typesErrored = typesQuery.isError;
  const typesLoading = typesQuery.isLoading;
  const typesAvailable = (typesQuery.data ?? []).length > 0;
  const canSubmit = !!projectPath.trim() && typesAvailable && !createMutation.isPending;

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
          width: 520,
          maxWidth: '92vw',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.55)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>New Session</h2>
        <p style={{ margin: '6px 0 18px', fontSize: 13, opacity: 0.65 }}>
          Spawn a Commander session on a project directory.
        </p>

        <label style={labelStyle}>Project path</label>
        <ProjectPathPicker
          value={projectPath}
          onChange={setProjectPath}
          placeholder={sessionTypeId === 'raw' ? '~ (home)' : 'Pick a project path…'}
          autoFocus
        />

        <label style={{ ...labelStyle, marginTop: 14 }}>Session type</label>
        {typesErrored ? (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255, 80, 80, 0.08)',
              border: '1px solid var(--color-danger)',
              borderRadius: 8,
              color: 'var(--color-danger)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ flex: 1 }}>
              Failed to load session types — is the sidecar running? ({
                (typesQuery.error as Error).message
              })
            </span>
            <button
              type="button"
              onClick={() => void typesQuery.refetch()}
              style={retryBtnStyle}
            >
              Retry
            </button>
          </div>
        ) : (
          <select
            value={sessionTypeId}
            onChange={(e) => setSessionTypeId(e.target.value as SessionTypeId)}
            disabled={typesLoading || !typesAvailable}
            style={inputStyle}
          >
            {typesLoading ? (
              <option>Loading session types…</option>
            ) : !typesAvailable ? (
              <option>No session types available</option>
            ) : (
              typesQuery.data!.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.id})
                </option>
              ))
            )}
          </select>
        )}

        <label style={{ ...labelStyle, marginTop: 14 }}>Effort</label>
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
            disabled={!canSubmit}
            style={{
              ...btnPrimaryStyle,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            type="button"
          >
            {createMutation.isPending ? 'Spawning…' : 'Spawn session'}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  marginBottom: 4,
  opacity: 0.75,
};

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

const retryBtnStyle: React.CSSProperties = {
  fontFamily: M,
  fontSize: 11,
  padding: '4px 10px',
  background: 'var(--color-muted)',
  color: 'var(--color-foreground)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 4,
  cursor: 'pointer',
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
