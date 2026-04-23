// One pane within the workspace layout — header + ContextBar + TerminalPane
// + StateMdDrawer for a single sessionId. Empty pane shows a CTA to spawn or
// claim a session into this slot.

import { useState } from 'react';
import { ContextBar } from './ContextBar.js';
import { TerminalPane } from './TerminalPane.js';
import { StateMdDrawer } from './StateMdDrawer.js';
import { useWorkspaceStore, MAX_PANES } from '../stores/workspaceStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useSessions, useStopSession } from '../queries/sessions.js';

const M = 'Montserrat, system-ui, sans-serif';

interface Props {
  index: number;
  sessionId: string | null;
  focused: boolean;
}

export function SessionPane({ index, sessionId, focused }: Props) {
  const panesCount = useWorkspaceStore((s) => s.layout.panes.length);
  const removePane = useWorkspaceStore((s) => s.removePane);
  const focusPane = useWorkspaceStore((s) => s.focusPane);
  const setPaneSession = useWorkspaceStore((s) => s.setPaneSession);
  const openNewSession = useSessionStore((s) => s.openNewSessionModal);
  const killMutation = useStopSession();
  const [killConfirmOpen, setKillConfirmOpen] = useState(false);

  const confirmKill = async () => {
    if (!sessionId) return;
    // Optimistic UI: remove session from this pane immediately, server
    // reconciles via `/api/sessions` refetch (mutation onSuccess invalidates).
    setPaneSession(index, null);
    setKillConfirmOpen(false);
    try {
      await killMutation.mutateAsync(sessionId);
    } catch (err) {
      console.warn('[sessionpane] kill failed, reattaching:', (err as Error).message);
      setPaneSession(index, sessionId);
    }
  };

  return (
    <div
      onMouseDown={() => focusPane(index)}
      data-pane-index={index}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)',
        border: '1px solid',
        borderColor: focused ? 'var(--color-primary)' : 'transparent',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          fontSize: 10,
          opacity: 0.55,
          fontFamily: M,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span>Pane {index + 1}</span>
        <div style={{ flex: 1 }} />
        {sessionId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setKillConfirmOpen(true);
            }}
            title="Stop and remove session (terminates pty, deletes session + scrollback)"
            disabled={killMutation.isPending}
            style={{ ...paneHeaderBtn, color: 'var(--color-danger)' }}
          >
            {killMutation.isPending ? '…' : '🗑'}
          </button>
        ) : null}
        {panesCount > 1 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removePane(index);
            }}
            title="Close pane (session stays alive)"
            style={paneHeaderBtn}
          >
            ×
          </button>
        ) : null}
      </div>
      {killConfirmOpen && sessionId ? (
        <KillConfirmModal
          sessionId={sessionId}
          onCancel={() => setKillConfirmOpen(false)}
          onConfirm={confirmKill}
        />
      ) : null}

      {sessionId ? (
        <>
          <ContextBar sessionId={sessionId} />
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <TerminalPane key={sessionId} sessionId={sessionId} focused={focused} />
            <StateMdDrawer key={`drawer-${sessionId}`} sessionId={sessionId} />
          </div>
        </>
      ) : (
        <EmptyPaneBody
          onSpawn={openNewSession}
          onClaim={(id) => setPaneSession(index, id)}
        />
      )}

      {panesCount < MAX_PANES && index === panesCount - 1 ? <AddPaneButton /> : null}
    </div>
  );
}

function EmptyPaneBody({
  onSpawn,
  onClaim,
}: {
  onSpawn: () => void;
  onClaim: (sessionId: string) => void;
}) {
  const sessions = useSessions();
  const available = (sessions.data ?? []).filter((s) => s.status !== 'stopped');
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 16,
        textAlign: 'center',
        fontFamily: M,
      }}
    >
      <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>
        Empty pane. Spawn a new session or attach an existing one.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onSpawn}
          style={{
            fontFamily: M,
            fontSize: 12,
            padding: '6px 12px',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          New session
        </button>
      </div>
      {available.length > 0 ? (
        <div
          style={{
            marginTop: 12,
            maxHeight: 200,
            overflowY: 'auto',
            width: '100%',
            maxWidth: 360,
          }}
        >
          <div style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
            Or attach an active session
          </div>
          {available.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onClaim(s.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 8px',
                fontSize: 11,
                fontFamily: M,
                background: 'var(--color-muted)',
                color: 'var(--color-foreground)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 4,
                marginBottom: 4,
                cursor: 'pointer',
              }}
            >
              {s.sessionTypeId} · {s.effort} · {s.cwd.slice(-40)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddPaneButton() {
  const addPane = useWorkspaceStore((s) => s.addPane);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        addPane();
      }}
      title="Add a new pane to the right"
      style={{
        position: 'absolute',
        right: 8,
        top: 4,
        fontFamily: M,
        fontSize: 10,
        padding: '2px 8px',
        background: 'var(--color-muted)',
        color: 'var(--color-foreground)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 4,
        cursor: 'pointer',
        opacity: 0.8,
      }}
    >
      + Pane
    </button>
  );
}

const paneHeaderBtn: React.CSSProperties = {
  fontFamily: M,
  fontSize: 12,
  padding: '0 6px',
  background: 'transparent',
  color: 'var(--color-foreground)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 4,
  cursor: 'pointer',
  lineHeight: '16px',
};

// N2.1.6 Task 3 kill-confirmation modal. Overlays the pane; click-outside
// cancels; destructive confirm does the DELETE. Keyboard Escape / Enter
// not yet wired — Jose's dogfood will tell us if that's needed.
function KillConfirmModal({
  sessionId,
  onCancel,
  onConfirm,
}: {
  sessionId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          fontFamily: M,
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: 20,
          width: 420,
          maxWidth: '92vw',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.55)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Stop and remove session?</h2>
        <p style={{ margin: '10px 0 16px', fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          The terminal process will be killed and the session record
          removed (scrollback, events, and tool invocations cascade-delete).
          Cannot be undone.
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>
          {sessionId}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontFamily: M,
              background: 'transparent',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontFamily: M,
              fontWeight: 600,
              background: 'var(--color-danger)',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Stop and remove
          </button>
        </div>
      </div>
    </div>
  );
}
