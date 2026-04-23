import { Suspense, lazy, useEffect } from 'react';
import { KanbanPage } from './pages/kanban';
import { usePreferencesStore } from './state/preferences-store';

// Route-level code splitting — Preferences (Dialog + Tabs + xterm probe) is a
// separate chunk that only loads when the user opens it with ⌘,. Main bundle
// stays small per KB-P1.14.
const PreferencesModal = lazy(() =>
  import('./pages/preferences').then((m) => ({ default: m.PreferencesModal })),
);

// N3 — lazy-load the run viewer. First real xterm mount + WS subscriber;
// separate chunk so the xterm.js bundle cost only pays when Jose opens a run.
const RunViewer = lazy(() =>
  import('./components/run-viewer').then((m) => ({ default: m.RunViewer })),
);

export function App() {
  const open = usePreferencesStore((s) => s.open);
  const setOpen = usePreferencesStore((s) => s.setOpen);
  const viewingRunId = usePreferencesStore((s) => s.viewingRunId);
  const setViewingRunId = usePreferencesStore((s) => s.setViewingRunId);

  // ⌘, opens Preferences per §1.2 acceptance. Escape closes via Dialog default.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <>
      <KanbanPage />
      <Suspense fallback={null}>
        {open && <PreferencesModal open={open} onOpenChange={setOpen} />}
      </Suspense>
      <Suspense fallback={null}>
        {viewingRunId ? (
          <RunViewer runId={viewingRunId} onClose={() => setViewingRunId(null)} />
        ) : null}
      </Suspense>
    </>
  );
}
