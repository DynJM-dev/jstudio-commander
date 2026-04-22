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
}

export function TerminalPane({ sessionId }: Props) {
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
    fit.fit();

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
