import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

// Scrollbar-gutter CSS per KB-P4.2 — no 14px right-side dead strip. Applied
// via inline <style> so the rule lives with the component and can't drift
// from the xterm mount. Scope class keeps it from bleeding into other UI.
const SCOPED_GUTTER_CSS = `
.cmdr-xterm-host,
.cmdr-xterm-host * {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.cmdr-xterm-host::-webkit-scrollbar,
.cmdr-xterm-host *::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
`;

const HOST_STYLE: React.CSSProperties = {
  overflow: 'hidden',
  width: '100%',
  height: '100%',
  position: 'relative',
};

export interface XtermContainerProps {
  /**
   * Optional initial content to render — used by the N1 Debug tab smoke probe
   * to paint overflow content that would otherwise expose the scrollbar gutter.
   */
  initialContent?: string;
  /** Called once the terminal instance is mounted + sized (after first rAF). */
  onReady?: (term: Terminal) => void;
  /** Disable the fit-addon rAF-deferred fit(). Useful for jsdom tests. */
  skipFit?: boolean;
}

/**
 * XtermContainer — canonical xterm mount with scrollbar-gutter CSS baked +
 * explicit-dispose lifecycle (KB-P4.2 v1.2 protected). React reconciliation
 * does NOT own terminal lifecycle; this hook owns it explicitly.
 *
 * N1 scope: static-content smoke probe. PTY wiring, WebGL addon, scrollback
 * restore, per-session WS subscription land N3+.
 */
export function XtermContainer({ initialContent, onReady, skipFit }: XtermContainerProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      theme: { background: '#0a0a0a', foreground: '#e0e0e0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // KB-P4.2 WebGL/WKWebView initial-mount race — defer fit() into the next
    // frame so layout flushes before any atlas cache. The probe doesn't use
    // WebGL addon but the rAF pattern is consistent with the N3+ path.
    let rafId: number | undefined;
    const ready = () => {
      if (!skipFit) {
        try {
          fit.fit();
        } catch {
          // jsdom / detached DOM may fail to measure; safe to swallow in the
          // smoke-probe path. Production mounts always have real geometry.
        }
      }
      if (initialContent) term.write(initialContent);
      onReady?.(term);
    };
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(ready);
    } else {
      ready();
    }

    return () => {
      if (rafId !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      // KB-P4.2 v1.2 explicit-dispose lifecycle (protected). Every new Terminal
      // pairs with dispose() in reverse mount order.
      fit.dispose();
      term.dispose();
    };
  }, [initialContent, onReady, skipFit]);

  return (
    <>
      <style>{SCOPED_GUTTER_CSS}</style>
      <div
        ref={hostRef}
        className="cmdr-xterm-host"
        style={HOST_STYLE}
        data-testid="xterm-container"
      />
    </>
  );
}
