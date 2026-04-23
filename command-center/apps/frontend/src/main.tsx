import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

// KB-P1.14 — no sync keychain / IPC / disk work at module init. The only
// sync work here is the render kickoff itself. Sidecar handshake (fetch
// to /health) is deferred to components that need it, behind TanStack
// Query + Suspense-compatible queryFn calls.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Health polling is lightweight; keep it fresh but not aggressive.
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
const root = createRoot(rootEl);

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// Boot-path discipline (KB-P1.14 rule 3): show_window() called AFTER first
// React paint. rAF after render = layout committed = real frame painted.
// If Tauri IPC isn't present (vite preview / browser dev), invoke throws
// and we swallow — the window is already visible in browser contexts.
requestAnimationFrame(() => {
  const paintedAt = performance.now();
  const started =
    (window as unknown as { __CMDR_BOOT__?: { started?: number } }).__CMDR_BOOT__?.started ?? 0;
  (
    window as unknown as { __CMDR_BOOT__: { paintedAt: number; firstPaintMs: number } }
  ).__CMDR_BOOT__ = {
    paintedAt,
    firstPaintMs: paintedAt - started,
  };
  invoke('show_window').catch(() => {
    // Non-Tauri context (browser dev) — window is already visible.
  });
});
