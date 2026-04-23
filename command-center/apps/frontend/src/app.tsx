import { Suspense, lazy, useEffect } from 'react';
import { HomePage } from './pages/home';
import { usePreferencesStore } from './state/preferences-store';

// Route-level code splitting — Preferences (Dialog + Tabs + xterm probe) is a
// separate chunk that only loads when the user opens it with ⌘,. Main bundle
// stays small per KB-P1.14.
const PreferencesModal = lazy(() =>
  import('./pages/preferences').then((m) => ({ default: m.PreferencesModal })),
);

export function App() {
  const open = usePreferencesStore((s) => s.open);
  const setOpen = usePreferencesStore((s) => s.setOpen);

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
      <HomePage />
      <Suspense fallback={null}>
        {open && <PreferencesModal open={open} onOpenChange={setOpen} />}
      </Suspense>
    </>
  );
}
