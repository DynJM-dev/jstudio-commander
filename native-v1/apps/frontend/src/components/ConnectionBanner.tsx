// Disconnected-state banner + reconnecting indicator. Subscribes to the
// wsClient's Zustand status store (not TanStack Query — this is pure client
// state, no server fetch). Click to retry when in disconnected state.

import { wsClient, useWsStatus } from '../lib/wsClient.js';

const M = 'Montserrat, system-ui, sans-serif';

export function ConnectionBanner() {
  const status = useWsStatus((s) => s.status);
  if (status.kind === 'connected' || status.kind === 'idle' || status.kind === 'connecting') {
    return null;
  }

  const base: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 12,
    fontFamily: M,
    fontWeight: 500,
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  if (status.kind === 'reconnecting') {
    return (
      <div
        style={{
          ...base,
          background: 'rgba(255, 175, 0, 0.1)',
          color: '#ffbd3d',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#ffbd3d',
            display: 'inline-block',
          }}
        />
        Sidecar reconnecting (attempt {status.attempt}, retry in{' '}
        {Math.round(status.nextDelayMs / 1000)}s)…
      </div>
    );
  }

  // disconnected
  return (
    <button
      type="button"
      onClick={() => wsClient.manualReconnect()}
      style={{
        ...base,
        width: '100%',
        textAlign: 'left',
        background: 'rgba(255, 80, 80, 0.12)',
        color: 'var(--color-danger)',
        border: 'none',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--color-danger)',
          display: 'inline-block',
        }}
      />
      Sidecar disconnected ({status.reason}) — click to reconnect.
    </button>
  );
}
