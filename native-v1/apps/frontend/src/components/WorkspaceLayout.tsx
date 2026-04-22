// Top-level workspace layout — horizontal split into 1-3 panes, each with a
// SessionPane. Drag handles between panes adjust ratios (min 15%).
// Cmd+Opt+← / Cmd+Opt+→ cycle focus. N2 §1.4 + §1.5.

import { useEffect, useRef } from 'react';
import { SessionPane } from './SessionPane.js';
import { useWorkspaceStore, MIN_PANE_RATIO } from '../stores/workspaceStore.js';
import { useSessionStore } from '../stores/sessionStore.js';

export function WorkspaceLayout() {
  const layout = useWorkspaceStore((s) => s.layout);
  const setRatios = useWorkspaceStore((s) => s.setRatios);
  const cycleFocus = useWorkspaceStore((s) => s.cycleFocus);
  const focusPane = useWorkspaceStore((s) => s.focusPane);
  const setPaneSession = useWorkspaceStore((s) => s.setPaneSession);
  const addPane = useWorkspaceStore((s) => s.addPane);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const ratiosRef = useRef(layout.ratios);
  ratiosRef.current = layout.ratios;

  // When the sidebar's activeSessionId changes (user clicked a session),
  // surface it in the focused pane if that pane is empty.
  useEffect(() => {
    if (!activeSessionId) return;
    const current = layout.panes[layout.focusedIndex];
    if (current && current.sessionId === null) {
      setPaneSession(layout.focusedIndex, activeSessionId);
    } else if (current && current.sessionId !== activeSessionId) {
      // Replace the focused pane's session with the newly-selected one so
      // single-pane navigation works as N1 did.
      setPaneSession(layout.focusedIndex, activeSessionId);
    }
    // Intentionally ignore layout.focusedIndex dep to avoid recursive loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Global shortcuts: Cmd+Opt+←/→ focus cycle, Cmd+\ enter split view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && e.altKey;
      if (mod && e.key === 'ArrowRight') {
        e.preventDefault();
        cycleFocus(1);
      } else if (mod && e.key === 'ArrowLeft') {
        e.preventDefault();
        cycleFocus(-1);
      } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '\\') {
        e.preventDefault();
        if (useWorkspaceStore.getState().layout.panes.length < 3) addPane();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cycleFocus, addPane]);

  const startDrag = (dividerIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const totalWidth = container.getBoundingClientRect().width;
    const startX = e.clientX;
    const startRatios = [...ratiosRef.current];

    const onMove = (ev: PointerEvent) => {
      const dxRatio = (ev.clientX - startX) / totalWidth;
      const next = [...startRatios];
      const left = next[dividerIndex]! + dxRatio;
      const right = next[dividerIndex + 1]! - dxRatio;
      if (left < MIN_PANE_RATIO || right < MIN_PANE_RATIO) return;
      next[dividerIndex] = left;
      next[dividerIndex + 1] = right;
      setRatios(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}
    >
      {layout.panes.map((pane, i) => {
        const ratio = layout.ratios[i] ?? 1 / layout.panes.length;
        const isFocused = i === layout.focusedIndex;
        return (
          <div key={i} style={{ display: 'flex', flex: `${ratio} 1 0`, minWidth: 0 }}>
            <SessionPane
              index={i}
              sessionId={pane.sessionId}
              focused={isFocused}
            />
            {i < layout.panes.length - 1 ? (
              <div
                onPointerDown={startDrag(i)}
                title="Drag to resize panes"
                style={{
                  width: 4,
                  cursor: 'col-resize',
                  background: 'var(--color-border)',
                  flexShrink: 0,
                }}
              />
            ) : null}
          </div>
        );
      })}
      {/* focusPane is invoked by SessionPane click handler; referenced here
          only to keep the selector live and silence unused-lint. */}
      {typeof focusPane === 'function' ? null : null}
    </div>
  );
}
