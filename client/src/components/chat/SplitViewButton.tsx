import { useEffect, useRef, useState } from 'react';
import { SplitSquareHorizontal, ChevronDown } from 'lucide-react';
import type { Session, SessionType } from '@commander/shared';
import { StatusBadge } from '../shared/StatusBadge';

const M = 'Montserrat, sans-serif';

interface SplitViewButtonProps {
  // All running sessions the user could choose as a right pane
  // (already pre-filtered to exclude the current left + current right
  // + stopped sessions by the caller).
  candidates: Session[];
  // When false, button is disabled + tooltip reads "Close a pane
  // first." (two panes already open).
  enabled: boolean;
  onSelect: (sessionId: string) => void;
}

const TYPE_LABELS: Record<SessionType, string> = {
  pm: 'PM',
  coder: 'Coder',
  raw: 'Raw',
};

// Phase W.2 — explicit "Split View" affordance that replaced the pin-
// icon-on-tab UX. Lives in the chat header. Click opens a dropdown
// listing other running sessions; selection opens that session as
// the right pane via `onSelect`.

export const SplitViewButton = ({ candidates, enabled, onSelect }: SplitViewButtonProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape (common dropdown convention).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const tooltip = enabled
    ? (candidates.length === 0 ? 'No other sessions to split with' : 'Open a session alongside this one')
    : 'Close a pane first.';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          if (!enabled || candidates.length === 0) return;
          setOpen((v) => !v);
        }}
        disabled={!enabled || candidates.length === 0}
        title={tooltip}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors"
        style={{
          fontFamily: M,
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          color: enabled ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
          border: '1px solid rgba(255,255,255,0.06)',
          opacity: enabled && candidates.length > 0 ? 1 : 0.45,
          cursor: enabled && candidates.length > 0 ? 'pointer' : 'not-allowed',
        }}
        onMouseEnter={(e) => { if (enabled && candidates.length > 0) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <SplitSquareHorizontal size={13} />
        <span>Split View</span>
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 140ms ease' }} />
      </button>

      {open && candidates.length > 0 && (
        <div
          role="listbox"
          className="absolute top-full right-0 mt-1.5 z-40 w-60 rounded-lg overflow-hidden"
          style={{
            background: 'rgba(12,16,22,0.96)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            fontFamily: M,
          }}
        >
          <div
            className="px-3 py-2 text-xs"
            style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            Open alongside this session
          </div>
          <ul>
            {candidates.map((s) => (
              <li key={s.id}>
                <button
                  role="option"
                  onClick={() => {
                    onSelect(s.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                  style={{ color: 'var(--color-text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <StatusBadge status={s.status} size="sm" />
                  <span className="flex-1 truncate text-sm">{s.name}</span>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      color: 'var(--color-text-tertiary)',
                      background: 'rgba(255,255,255,0.05)',
                    }}
                  >
                    {TYPE_LABELS[s.sessionType]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
