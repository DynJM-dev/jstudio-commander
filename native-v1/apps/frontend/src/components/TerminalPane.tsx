// xterm.js terminal pane per ARCHITECTURE_SPEC v1.2 §6. One instance per
// session; mounts/unmounts with the component. GPU rendering via
// addon-webgl with canvas fallback if WebGL init fails (observed on some
// virtualized display setups; documented in §6.2 but acceptance targets
// macOS arm64 where WebGL is always available).

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { wsClient } from '../lib/wsClient.js';

interface Props {
  sessionId: string;
}

export function TerminalPane({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

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
      theme: {
        background: '#0b0d10',
        foreground: '#e7e9ee',
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
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

    const unsubscribe = wsClient.subscribe(`session:${sessionId}`, (event) => {
      if (event.type === 'pty:data' && event.sessionId === sessionId) {
        term.write(event.data);
      }
    });

    const onDataDispose = term.onData((data) => {
      wsClient.sendPtyInput(sessionId, data);
    });

    return () => {
      unsubscribe();
      onDataDispose.dispose();
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      data-session-id={sessionId}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--color-background)',
        padding: 8,
      }}
    />
  );
}
