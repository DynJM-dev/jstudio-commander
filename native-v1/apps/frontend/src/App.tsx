import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { NewSessionModal } from './components/NewSessionModal.js';
import { PreferencesModal } from './components/PreferencesModal.js';
import { ConnectionBanner } from './components/ConnectionBanner.js';
import { WorkspaceLayout } from './components/WorkspaceLayout.js';
import { useSessionStore } from './stores/sessionStore.js';
import { useWorkspaceSync } from './lib/workspaceSync.js';

const M = 'Montserrat, system-ui, sans-serif';

function Shell() {
  useWorkspaceSync();
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
        <ConnectionBanner />
        <WorkspaceLayout />
      </main>
      <NewSessionModal />
      <PreferencesModal />
    </div>
  );
}

// EmptyPane CTA is rendered inside SessionPane's EmptyPaneBody when a pane
// has no session. The top-level shell always mounts WorkspaceLayout now.
// Marker use to keep useSessionStore import from going unused on trees that
// don't read it directly.
void useSessionStore;

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
