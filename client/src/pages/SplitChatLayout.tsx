import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { X, GripVertical } from 'lucide-react';
import { ChatPage } from './ChatPage';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../services/api';
import type { Session, Teammate } from '@commander/shared';

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

  // On mount, check for existing active teammates of this PM — they may have
  // been spawned before this page was open.
  useEffect(() => {
    if (!pmSessionId) return;
    let cancelled = false;
    api
      .get<Session[]>(`/sessions/${encodeURIComponent(pmSessionId)}/teammates`)
      .then((teammates) => {
        if (cancelled) return;
        const active = teammates.find((t) => t.status !== 'stopped');
        if (active && !coderSessionId) setCoderSessionId(active.id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // Only run once per PM session; state transitions handle WS updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmSessionId]);

  // React to teammate:spawned and teammate:dismissed events
  useEffect(() => {
    if (!lastEvent || !pmSessionId) return;
    if (lastEvent.type === 'teammate:spawned') {
      const t = lastEvent.teammate as Teammate;
      if (t.parentSessionId === pmSessionId) {
        setCoderSessionId(t.sessionId);
      }
    } else if (lastEvent.type === 'teammate:dismissed') {
      if (coderSessionId === lastEvent.sessionId) {
        setCoderSessionId(null);
      }
    }
  }, [lastEvent, pmSessionId, coderSessionId]);

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

      <div className="relative h-full min-h-0 overflow-hidden" style={{ width: `${100 - percent}%` }}>
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
