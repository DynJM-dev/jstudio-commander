import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  connected: boolean;
  error: string | null;
  disconnect: () => void;
}

const TERM_THEME = {
  background: '#0A0E14',
  foreground: '#E6EDF3',
  cursor: '#0E7C7B',
  selectionBackground: 'rgba(14,124,123,0.3)',
  black: '#0A0E14',
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#F59E0B',
  blue: '#3B82F6',
  magenta: '#A855F7',
  cyan: '#12A5A4',
  white: '#E6EDF3',
  brightBlack: '#484F58',
  brightRed: '#F87171',
  brightGreen: '#4ADE80',
  brightYellow: '#FCD34D',
  brightBlue: '#60A5FA',
  brightMagenta: '#C084FC',
  brightCyan: '#22D3EE',
  brightWhite: '#FFFFFF',
};

export const useTerminal = (sessionId: string | null): UseTerminalReturn => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    fitAddonRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    // Create terminal
    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Try WebGL addon for perf (graceful fallback)
    import('@xterm/addon-webgl').then(({ WebglAddon }) => {
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available — canvas renderer is fine
      }
    }).catch(() => {});

    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/terminal/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      // Send initial resize
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (e) => {
      term.write(e.data as string);
    };

    ws.onclose = (e) => {
      setConnected(false);
      if (e.code >= 4000) {
        setError(e.reason || 'Connection closed');
      }
    };

    ws.onerror = () => {
      setError('Failed to connect to terminal');
      setConnected(false);
    };

    // Terminal input → WebSocket
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize handler
    const handleResize = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch {
        // Ignore resize errors during teardown
      }
    };

    // ResizeObserver for container
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      inputDisposable.dispose();
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      wsRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
      setConnected(false);
    };
  }, [sessionId]);

  return { containerRef, connected, error, disconnect };
};
