// Preferences window per N2 dispatch §1.7. Cmd+, opens; single "Shell"
// section with the source-user-rc toggle. Change applies to new sessions.

import { useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { usePreference, useSetPreference } from '../queries/preferences.js';

const M = 'Montserrat, system-ui, sans-serif';

export function PreferencesModal() {
  const open = useSessionStore((s) => s.preferencesOpen);
  const openPrefs = useSessionStore((s) => s.openPreferences);
  const close = useSessionStore((s) => s.closePreferences);
  const zshPref = usePreference('zsh.source_user_rc');
  const setPref = useSetPreference();

  // Cmd+, global shortcut. Registered once at mount.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        openPrefs();
      }
      if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, openPrefs, close]);

  if (!open) return null;

  const current = zshPref.data?.value === 'true' || zshPref.data?.value === '1';
  const toggle = () => {
    setPref.mutate({
      key: 'zsh.source_user_rc',
      value: current ? 'false' : 'true',
    });
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
        zIndex: 60,
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
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Preferences</h2>
        <p style={{ margin: '6px 0 20px', fontSize: 12, opacity: 0.65 }}>
          Cmd+, anywhere to open. Esc to close.
        </p>

        <section>
          <h3
            style={{
              margin: '0 0 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: 0.65,
            }}
          >
            Shell
          </h3>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '10px 12px',
              background: 'var(--color-muted)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={current}
              onChange={toggle}
              disabled={setPref.isPending || zshPref.isLoading}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Source user <code>~/.zshrc</code> in sessions (experimental)
              </div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                When enabled, new Commander sessions inline-source your shell
                rc so aliases, prompt, and PATH apply. Slow or fatal rc
                configs can delay or break OSC 133 hook install. Change
                applies to new sessions only.
              </div>
            </div>
          </label>
          {setPref.isError ? (
            <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>
              {(setPref.error as Error).message}
            </p>
          ) : null}
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={close}
            type="button"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontFamily: M,
              background: 'transparent',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
