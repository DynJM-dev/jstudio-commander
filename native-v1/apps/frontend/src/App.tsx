import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { TerminalPane } from './components/TerminalPane.js';
import { NewSessionModal } from './components/NewSessionModal.js';
import { useSessionStore } from './stores/sessionStore.js';

const M = 'Montserrat, system-ui, sans-serif';

function Shell() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        fontFamily: M,
        background: 'var(--color-background)',
        color: 'var(--color-foreground)',
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {activeSessionId ? (
          <TerminalPane key={activeSessionId} sessionId={activeSessionId} />
        ) : (
          <EmptyPane />
        )}
      </main>
      <NewSessionModal />
    </div>
  );
}

function EmptyPane() {
  const openNew = useSessionStore((s) => s.openNewSessionModal);
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Commander v1</h1>
      <p style={{ margin: 0, opacity: 0.65, fontSize: 13, maxWidth: 420 }}>
        Spawn a PM, Coder, or Raw session on a JStudio project directory to
        begin. Sessions attach to a live zsh with OSC 133 shell integration.
      </p>
      <button
        onClick={openNew}
        type="button"
        style={{
          padding: '10px 18px',
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
        Spawn first session
      </button>
    </div>
  );
}

export function App() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
        },
      }),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
