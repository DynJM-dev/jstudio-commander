import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { X, GripVertical } from 'lucide-react';
import { ChatPage } from './ChatPage';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../services/api';
import type { Session } from '@commander/shared';

const M = 'Montserrat, sans-serif';

const STORAGE_KEY = 'jsc-split-state-v1';
const MIN_PERCENT = 30;
const MAX_PERCENT = 70;
const DEFAULT_PERCENT = 55;

interface SplitState {
  pmSessionId: string;
  coderSessionId: string;
  percent: number;
}

const loadSplit = (pmSessionId: string): SplitState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplitState;
    if (parsed.pmSessionId !== pmSessionId) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveSplit = (state: SplitState | null): void => {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore quota */ }
};

export const SplitChatLayout = () => {
  const { sessionId: pmSessionId } = useParams<{ sessionId: string }>();
  const { lastEvent, subscribe } = useWebSocket();
  const [coderSessionId, setCoderSessionId] = useState<string | null>(null);
  const [coderSession, setCoderSession] = useState<Session | null>(null);
  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Restore previous split if it's for this same PM session
  useEffect(() => {
    if (!pmSessionId) return;
    const saved = loadSplit(pmSessionId);
    if (saved) {
      setCoderSessionId(saved.coderSessionId);
      setPercent(saved.percent);
    } else {
      setCoderSessionId(null);
      setPercent(DEFAULT_PERCENT);
    }
  }, [pmSessionId]);

  // Persist split state whenever it changes
  useEffect(() => {
    if (!pmSessionId) return;
    if (coderSessionId) {
      saveSplit({ pmSessionId, coderSessionId, percent });
    } else {
      saveSplit(null);
    }
  }, [pmSessionId, coderSessionId, percent]);

  // Subscribe to session events channel (where teammate:spawned/dismissed fire)
  useEffect(() => {
    subscribe(['sessions']);
  }, [subscribe]);

  // Refresh the list of teammates for the current PM. Opens the coder pane
  // if an active teammate exists; closes it if the currently-shown teammate
  // disappears. The endpoint resolves both the Commander UUID and the Claude
  // leadSessionId, so callers only need to pass whatever's in the URL.
  const refreshTeammates = useCallback(async () => {
    if (!pmSessionId) return;
    try {
      const teammates = await api.get<Session[]>(
        `/sessions/${encodeURIComponent(pmSessionId)}/teammates`,
      );
      const active = teammates.find((t) => t.status !== 'stopped');
      setCoderSessionId((prev) => {
        if (!active) { setCoderSession(null); return null; }
        // Prefer keeping the currently-shown teammate if still active
        const keep = prev && teammates.find((t) => t.id === prev && t.status !== 'stopped');
        if (keep) { setCoderSession(keep); return prev; }
        setCoderSession(active);
        return active.id;
      });
    } catch { /* transient failure — next WS event will retry */ }
  }, [pmSessionId]);

  // Initial load — catch teammates that were spawned before the page mounted.
  useEffect(() => { refreshTeammates(); }, [refreshTeammates]);

  // WS-driven refresh on any teammate transition. Cheap (single GET) and
  // avoids having to match parent IDs client-side when the PM uses multiple
  // identifiers (Commander UUID vs Claude leadSessionId).
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'teammate:spawned' || lastEvent.type === 'teammate:dismissed') {
      refreshTeammates();
    }
    // Keep the teammate's status fresh so the tab dot can reflect working →
    // waiting transitions without waiting for the next poll.
    if (lastEvent.type === 'session:status' && coderSessionId === lastEvent.sessionId) {
      setCoderSession((prev) => (prev ? { ...prev, status: lastEvent.status } : prev));
    }
  }, [lastEvent, refreshTeammates, coderSessionId]);

  // Drag-handle resize
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const raw = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, raw));
      setPercent(clamped);
    };
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const closeCoderPane = useCallback(() => {
    setCoderSessionId(null);
  }, []);

  // No teammate open → just render the PM pane at full width
  if (!coderSessionId) {
    return <ChatPage />;
  }

  return (
    <div ref={containerRef} className="flex h-full w-full min-h-0" style={{ fontFamily: M }}>
      <div className="h-full min-h-0 overflow-hidden" style={{ width: `${percent}%` }}>
        <ChatPage />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="relative shrink-0 flex items-center justify-center cursor-col-resize group"
        style={{
          width: 6,
          background: 'rgba(255, 255, 255, 0.04)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
          borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <GripVertical
          size={14}
          className="opacity-40 group-hover:opacity-80 transition-opacity"
          style={{ color: 'var(--color-text-tertiary)' }}
        />
      </div>

      <div className={`relative h-full min-h-0 overflow-hidden ${coderSession?.status === 'waiting' ? 'waiting-glow' : ''}`} style={{ width: `${100 - percent}%` }}>
        {/* Teammate tab strip — name, role, and status dot. Yellow-glows the
            whole pane (via waiting-glow) when the teammate is paused. */}
        <div
          className="absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md px-2 py-1"
          style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontFamily: M,
          }}
        >
          {coderSession && <StatusBadge status={coderSession.status} size="sm" />}
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {coderSession?.name ?? 'Teammate'}
          </span>
          {coderSession?.agentRole && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                color: 'var(--color-accent-light)',
                background: 'rgba(14, 124, 123, 0.08)',
              }}
            >
              {coderSession.agentRole}
            </span>
          )}
        </div>

        <button
          onClick={closeCoderPane}
          className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-md p-1 transition-colors"
          style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: 'var(--color-text-secondary)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'; }}
          title="Close teammate pane"
        >
          <X size={14} />
        </button>
        <ChatPage sessionIdOverride={coderSessionId} />
      </div>
    </div>
  );
};
