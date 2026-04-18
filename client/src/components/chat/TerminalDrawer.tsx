import { useCallback, useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { SessionTerminalPreview } from './SessionTerminalPreview';
import {
  MIN_DRAWER_HEIGHT_PX,
  MAX_DRAWER_HEIGHT_RATIO,
} from '@commander/shared';

const M = 'Montserrat, sans-serif';

interface TerminalDrawerProps {
  sessionId: string;
  open: boolean;
  heightPx: number;
  onHeightChange: (px: number) => void;
  onClose: () => void;
}

// Phase W — per-pane terminal drawer. Anchored to the bottom of its
// pane only (no cross-pane span). Slides up on toggle (180ms ease-out).
// Read-only: wraps SessionTerminalPreview for the live output feed.
// No input inside — the pane's own ChatPage input bar is the only
// send-target; drawer is a monitor, not a terminal.
//
// Height is persisted per session via useSessionUi — two pinned panes
// remember their drawer height independently. First open computes 35%
// of pane height as default and writes it back; subsequent opens
// restore the exact pixel height the user last left.
//
// Keyboard contract (global Cmd+J lives in PaneContainer, dispatches
// a `commander:toggle-drawer` CustomEvent on window with the focused
// session id). Esc here closes THIS drawer when the drawer itself
// has focus — doesn't fire on the page Esc (that's chat interrupt).

export const TerminalDrawer = ({
  sessionId,
  open,
  heightPx,
  onHeightChange,
  onClose,
}: TerminalDrawerProps) => {
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ y: number; startHeight: number } | null>(null);

  // Cmd+J open/close + focus handling live on the parent Pane (see
  // PaneContainer). This component is purely a view: renders when
  // `open` is true, shells out height via onHeightChange, closes via
  // onClose. No keyboard shortcut handling here — the parent owns
  // the focused-pane semantics.

  // Resize-by-drag on the top edge. Dragging UP grows the drawer,
  // DOWN shrinks. clientY delta is inverted from the drawer's bottom-
  // anchored growth direction.
  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    dragStartRef.current = { y: e.clientY, startHeight: heightPx };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [heightPx]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !dragStartRef.current) return;
      const dy = dragStartRef.current.y - e.clientY; // inverted
      onHeightChange(dragStartRef.current.startHeight + dy);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      dragStartRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onHeightChange]);

  if (!open) return null;

  return (
    <div
      className="absolute left-0 right-0 bottom-0 flex flex-col"
      style={{
        height: heightPx,
        background: 'rgba(12, 16, 22, 0.96)',
        backdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(14, 124, 123, 0.25)',
        fontFamily: M,
        transition: draggingRef.current ? 'none' : 'height 180ms ease-out',
      }}
      role="region"
      aria-label="Terminal output drawer"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      tabIndex={-1}
    >
      {/* Drag handle — 4px hit target at top edge, ns-resize cursor */}
      <div
        onMouseDown={onHandleMouseDown}
        className="absolute left-0 right-0 cursor-ns-resize"
        style={{ top: -2, height: 4, zIndex: 2 }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal drawer"
      />

      {/* Chrome */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        <div className="flex items-center gap-2">
          <Terminal size={13} style={{ color: 'var(--color-accent-light)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Terminal output
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/5 transition-colors"
          title="Close (Esc)"
          aria-label="Close terminal drawer"
        >
          <X size={13} style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
      </div>

      {/* Live output — reuses the existing read-only preview */}
      <div className="flex-1 min-h-0 overflow-auto">
        <SessionTerminalPreview sessionId={sessionId} />
      </div>
    </div>
  );
};

// Re-export clamps so consumers can display them in tooltips/a11y hints
// without importing shared constants directly.
export const DRAWER_MIN_PX = MIN_DRAWER_HEIGHT_PX;
export const DRAWER_MAX_RATIO = MAX_DRAWER_HEIGHT_RATIO;
