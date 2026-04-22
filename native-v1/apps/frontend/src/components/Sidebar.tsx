// Sessions sidebar. N1 scope: list of active sessions + "New session" entry.
// N2 adds project grouping, status badges, three-role drawer.

import { useSessions } from '../queries/sessions.js';
import { useSessionStore } from '../stores/sessionStore.js';

const M = 'Montserrat, system-ui, sans-serif';

export function Sidebar() {
  const sessions = useSessions();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActiveSessionId);
  const openNew = useSessionStore((s) => s.openNewSessionModal);

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: M,
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.02em',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        Commander
      </div>

      <button
        onClick={openNew}
        type="button"
        style={{
          margin: 12,
          padding: '10px 12px',
          fontSize: 13,
          fontFamily: M,
          fontWeight: 600,
          background: 'var(--color-primary)',
          color: 'var(--color-primary-foreground)',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        + New session
      </button>

      <div style={{ padding: '8px 12px', fontSize: 11, opacity: 0.55, textTransform: 'uppercase' }}>
        Sessions
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {sessions.isLoading ? (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>Loading…</div>
        ) : sessions.data && sessions.data.length > 0 ? (
          sessions.data.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              type="button"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: M,
                background:
                  activeSessionId === s.id ? 'var(--color-muted)' : 'transparent',
                color: 'var(--color-foreground)',
                border: '1px solid',
                borderColor:
                  activeSessionId === s.id
                    ? 'var(--color-border-strong)'
                    : 'transparent',
                borderRadius: 6,
                marginBottom: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 500 }}>{s.sessionTypeId} · {s.effort}</div>
              <div style={{ opacity: 0.55, fontSize: 11, marginTop: 2 }}>
                {s.status} · pid {s.ptyPid ?? '—'}
              </div>
              <div style={{ opacity: 0.4, fontSize: 10, marginTop: 1 }}>
                {s.cwd}
              </div>
            </button>
          ))
        ) : (
          <div style={{ padding: 12, fontSize: 12, opacity: 0.55 }}>
            No sessions yet. Click <strong>+ New session</strong>.
          </div>
        )}
      </div>
    </aside>
  );
}
