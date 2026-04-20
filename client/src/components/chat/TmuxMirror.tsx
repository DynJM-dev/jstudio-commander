import { useEffect, useMemo, useRef, useState } from 'react';
import { AnsiUp } from 'ansi_up';
import type { WSEvent } from '@commander/shared';
import { useWebSocket } from '../../hooks/useWebSocket';

const M = 'Montserrat, sans-serif';

// Phase T MVP — tmux pane mirror. Read-only renderer fed by the
// `pane-capture:<sessionId>` WS channel. The status-poller tees each
// tick's `tmux capture-pane -e` output through eventBus when content
// changes (server-side dedupe). This component subscribes, ansi_up-
// renders the text, and auto-follows the bottom of the output unless
// the user has scrolled up. Fixed 200px height; no interactivity; no
// keyboard capture. Scope-locked to the dispatch — no xterm.js / no
// node-pty re-add (Phase P.3 deleted those for stated product reasons).

const MIRROR_HEIGHT_PX = 200;
// Strict-equality guard: resume auto-follow when the user scrolls
// back within SCROLL_FOLLOW_EPSILON_PX of the bottom. Tolerant enough
// that a sub-pixel render wobble doesn't strand follow-bottom off.
const SCROLL_FOLLOW_EPSILON_PX = 4;

interface TmuxMirrorProps {
  sessionId: string;
}

export const TmuxMirror = ({ sessionId }: TmuxMirrorProps): React.ReactElement => {
  const { lastEvent, subscribe, unsubscribe } = useWebSocket();
  const [paneText, setPaneText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLPreElement>(null);
  const followBottomRef = useRef<boolean>(true);

  // Fresh AnsiUp per mount is cheap; the converter holds ~1KB of
  // palette tables + a small buffer. Memoized only to stabilize
  // across renders where paneText didn't change.
  const ansi = useMemo(() => new AnsiUp(), []);

  useEffect(() => {
    const channel = `pane-capture:${sessionId}`;
    subscribe([channel]);
    return () => unsubscribe([channel]);
  }, [sessionId, subscribe, unsubscribe]);

  // Reset state on sessionId change so a pane never briefly shows the
  // previous session's tail while waiting for the first emit.
  useEffect(() => {
    setPaneText(null);
    followBottomRef.current = true;
  }, [sessionId]);

  // WS event handler. Filter by type + sessionId so split-view's other
  // pane cannot bleed its capture into this mirror.
  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'session:pane-capture') return;
    if (event.sessionId !== sessionId) return;
    setPaneText(event.paneText);
  }, [lastEvent, sessionId]);

  // Scroll-pin follow-bottom. When user is at (or near) the bottom,
  // auto-scroll to bottom on each update; otherwise hold position.
  // Follow resumes the moment the user scrolls back to bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [paneText]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    followBottomRef.current = distanceFromBottom <= SCROLL_FOLLOW_EPSILON_PX;
  };

  const html = useMemo(() => {
    if (paneText === null) return '';
    return ansi.ansi_to_html(paneText);
  }, [paneText, ansi]);

  return (
    <div
      className="shrink-0 w-full"
      style={{
        height: MIRROR_HEIGHT_PX,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(8,10,14,0.92)',
      }}
      data-tmux-mirror-session-id={sessionId}
    >
      <pre
        ref={scrollRef}
        onScroll={onScroll}
        aria-label="Tmux pane mirror"
        aria-readonly="true"
        className="w-full h-full overflow-auto"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.35,
          color: 'rgba(235,238,245,0.92)',
          padding: '8px 12px',
          margin: 0,
          whiteSpace: 'pre',
        }}
      >
        {paneText === null ? (
          <span style={{ fontFamily: M, opacity: 0.5 }}>
            Waiting for pane capture…
          </span>
        ) : (
          <span
            // ansi_up escapes HTML + emits its own spans for colors;
            // safe to inject. The input is server-captured tmux text,
            // not user-supplied HTML.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </pre>
    </div>
  );
};
