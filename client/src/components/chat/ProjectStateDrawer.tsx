import { useCallback, useEffect, useRef } from 'react';
import { FileText, X } from 'lucide-react';
import { StateViewer } from '../projects/StateViewer';
import { useProjectStateMd } from '../../hooks/useProjectStateMd';
import {
  MIN_DRAWER_HEIGHT_PX,
  MAX_DRAWER_HEIGHT_RATIO,
} from '@commander/shared';

const M = 'Montserrat, sans-serif';

interface ProjectStateDrawerProps {
  sessionId: string;
  open: boolean;
  heightPx: number;
  onHeightChange: (px: number) => void;
  onClose: () => void;
}

// M7 MVP — per-pane live STATE.md drawer. Mirrors TerminalDrawer's
// pattern (bottom-anchored, resizable, per-pane height) but reads the
// STATE.md of the pane's session's project via `useProjectStateMd`.
// Subscription firewall per dispatch: no shared state with ChatPage or
// ContextBar. StateViewer reused as-is for markdown rendering.
export const ProjectStateDrawer = ({
  sessionId,
  open,
  heightPx,
  onHeightChange,
  onClose,
}: ProjectStateDrawerProps) => {
  const { content, isLoading } = useProjectStateMd(open ? sessionId : undefined);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ y: number; startHeight: number } | null>(null);

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
      const dy = dragStartRef.current.y - e.clientY;
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
        borderTop: '1px solid rgba(168, 85, 247, 0.25)',
        fontFamily: M,
        transition: draggingRef.current ? 'none' : 'height 180ms ease-out',
      }}
      role="region"
      aria-label="Project STATE.md drawer"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      tabIndex={-1}
      data-project-state-drawer-session={sessionId}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onHandleMouseDown}
        className="absolute left-0 right-0 cursor-ns-resize"
        style={{ top: -2, height: 4, zIndex: 2 }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize STATE.md drawer"
      />

      {/* Chrome */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={13} style={{ color: '#A855F7' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            STATE.md
          </span>
          {isLoading && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              loading…
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/5 transition-colors"
          title="Close (Esc)"
          aria-label="Close STATE.md drawer"
        >
          <X size={13} style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
      </div>

      {/* Content — reuse StateViewer for markdown rendering. When
          content is null AND we're not loading, StateViewer's built-in
          empty state ("No STATE.md found…") surfaces. */}
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        {!isLoading && content === null ? (
          <p
            className="text-sm italic"
            style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
          >
            No STATE.md found in this project.
          </p>
        ) : (
          <StateViewer content={content ?? ''} />
        )}
      </div>
    </div>
  );
};

export const PROJECT_STATE_DRAWER_MIN_PX = MIN_DRAWER_HEIGHT_PX;
export const PROJECT_STATE_DRAWER_MAX_RATIO = MAX_DRAWER_HEIGHT_RATIO;
