// xterm.js terminal pane per ARCHITECTURE_SPEC v1.2 §6 + N2 §1.6 scrollback
// persistence. One instance per session; mount / unmount bracket the terminal
// lifecycle.
//
// Scrollback flow:
//   - On mount: GET /api/sessions/:id/scrollback; if a blob exists, write it
//     to the terminal BEFORE attaching the live pty stream. This mirrors the
//     xterm.js addon-serialize round-trip contract.
//   - On unmount (pane close, workspace change, window unload): serialize the
//     current buffer via addon-serialize.serialize() and PATCH /scrollback.
//   - Flushes are best-effort — a slow PATCH during window unload may not
//     complete. fetch + keepalive:true preserves the request across unload.

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { wsClient } from '../lib/wsClient.js';
import { discoverSidecarUrl } from '../lib/sidecarUrl.js';
import { httpJson } from '../lib/http.js';

interface Props {
  sessionId: string;
  /** N2.1.4 Bug E fix: when true, imperatively focus xterm's textarea so
   *  typed keystrokes route to this pane's pty. Zustand focusedPaneIndex
   *  state alone doesn't move DOM focus — clicking on pane chrome updates
   *  Zustand but DOM focus stays on the last-focused xterm textarea. See
   *  docs/diagnostics/N2.1.4-pane-input-routing-evidence.md. */
  focused?: boolean;
}

export function TerminalPane({ sessionId, focused }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: { background: '#0b0d10', foreground: '#e7e9ee' },
    });
    termRef.current = term;
    const fit = new FitAddon();
    const search = new SearchAddon();
    const serialize = new SerializeAddon();
    serializeRef.current = serialize;
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(serialize);
    term.open(container);
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch (err) {
      console.warn('[terminal] WebGL init failed, falling back to canvas:', err);
    }
    // N2.1.5 Bug H fix: defer fit.fit() to the next animation frame so the
    // browser's layout pass completes before we measure container
    // dimensions. Synchronous fit.fit() on the same tick as term.open()
    // inside a flex-1-in-flex-1 container frequently reads pre-layout
    // getBoundingClientRect values → WebGL renderer caches cell atlas
    // against miscomputed metrics → scrollback writes render with
    // overlapping/garbled content (Jose's Step 11 observation). See
    // docs/diagnostics/N2.1.5-bug-h-evidence.md.
    // Upstream references: xtermjs/xterm.js#5320, #4841, #3584, #2394.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* container still sizing */
      }
    });

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* container still sizing */
      }
    };
    window.addEventListener('resize', onResize);

    let cancelled = false;
    let unsubscribeWs: (() => void) | null = null;
    let onDataDispose: { dispose(): void } | null = null;

    const attachLive = () => {
      if (cancelled) return;
      unsubscribeWs = wsClient.subscribe(`session:${sessionId}`, (event) => {
        if (event.type === 'pty:data' && event.sessionId === sessionId) {
          term.write(event.data);
        }
      });
      onDataDispose = term.onData((data) => {
        wsClient.sendPtyInput(sessionId, data);
      });
    };

    // Load any saved scrollback BEFORE subscribing to live events so the
    // restored content and live output concatenate without interleaving.
    void (async () => {
      try {
        const res = await httpJson<{ blob: string | null }>(
          `/api/sessions/${sessionId}/scrollback`,
        );
        if (cancelled) return;
        if (res.blob) {
          const decoded = atob(res.blob);
          term.write(decoded);
        }
      } catch (err) {
        console.warn('[terminal] scrollback load failed:', (err as Error).message);
      } finally {
        attachLive();
      }
    })();

    // beforeunload fires on Cmd+Q (Tauri) and tab close. Serialize + PATCH
    // with keepalive so the request survives the page teardown.
    const onBeforeUnload = () => {
      void flushScrollback(sessionId, serialize, { keepalive: true });
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('resize', onResize);
      // Fire-and-forget on unmount; no keepalive needed (regular async OK).
      void flushScrollback(sessionId, serialize);
      if (unsubscribeWs) unsubscribeWs();
      if (onDataDispose) onDataDispose.dispose();
      term.dispose();
      termRef.current = null;
      serializeRef.current = null;
    };
  }, [sessionId]);

  // N2.1.4 Bug E fix: bridge Zustand `focusedPaneIndex` state into xterm.js
  // DOM focus. Clicking pane chrome (header, gutter, ContextBar, drawer)
  // updates Zustand but doesn't move DOM focus, so keystrokes stayed on the
  // previously-focused xterm textarea (typically pane 1's). Now whenever
  // `focused` flips to true — via pane-click OR Cmd+Opt+←/→ focus cycle —
  // we imperatively focus this pane's terminal. Idempotent: calling focus()
  // on an already-focused xterm is a no-op. See
  // docs/diagnostics/N2.1.4-pane-input-routing-evidence.md.
  useEffect(() => {
    if (focused && termRef.current) {
      termRef.current.focus();
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      data-session-id={sessionId}
      style={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        backgroundColor: 'var(--color-background)',
        padding: 8,
      }}
    />
  );
}

async function flushScrollback(
  sessionId: string,
  serialize: SerializeAddon,
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  try {
    const raw = serialize.serialize();
    if (!raw) return;
    const blob = btoa(unescape(encodeURIComponent(raw)));
    const base = await discoverSidecarUrl();
    await fetch(`${base}/api/sessions/${sessionId}/scrollback`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob }),
      keepalive: opts.keepalive ?? false,
    });
  } catch (err) {
    console.warn('[terminal] scrollback flush failed:', (err as Error).message);
  }
}
