import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X, GripVertical, Minimize2, Users, Columns2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatPage } from './ChatPage';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePreference } from '../hooks/usePreference';
import { api } from '../services/api';
import type { Session } from '@commander/shared';

const M = 'Montserrat, sans-serif';

const LEGACY_STORAGE_KEY = 'jsc-split-state-v1';
const MIN_PERCENT = 30;
const MAX_PERCENT = 70;
const DEFAULT_PERCENT = 55;
const STRIP_WIDTH = 48;
const MAX_TEAMMATES = 3;

interface SplitState {
  activeTabId: string | null;
  tabIds?: string[];
  minimized?: boolean;
  percent: number;
  /** @deprecated v1 field — read for migration only. */
  coderSessionId?: string;
  /** @deprecated v1 field — read for migration only. */
  pmSessionId?: string;
}

// One-time localStorage → preferences migration. Reads the old v1 shape,
// normalizes coderSessionId → activeTabId/tabIds, and returns it as the
// initial value for the current PM. The legacy key is cleared after read
// so a later server-side reset can't be stomped by a stale local copy.
const readLegacySplit = (pmSessionId: string): SplitState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplitState;
    if (parsed.pmSessionId !== pmSessionId) return null;
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (!parsed.activeTabId && parsed.coderSessionId) {
      parsed.activeTabId = parsed.coderSessionId;
      parsed.tabIds = [parsed.coderSessionId];
    }
    return parsed;
  } catch {
    return null;
  }
};

// Below this width the side-by-side split becomes unreadable. Force the
// minimized strip layout so the active chat takes full width and the
// teammate strip stays accessible. Tapping a teammate icon on mobile
// navigates to that session's own /chat/:id route (single-pane) rather
// than expanding into a dual-pane that wouldn't fit.
const MOBILE_BREAKPOINT_PX = 768;
const useIsNarrow = (): boolean => {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < MOBILE_BREAKPOINT_PX,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return narrow;
};

export const SplitChatLayout = () => {
  const { sessionId: pmSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const isNarrow = useIsNarrow();
  const { lastEvent, subscribe } = useWebSocket();
  // Known teammates (non-stopped), capped at MAX_TEAMMATES. Authoritative
  // source is the server's /teammates list refreshed on WS transitions.
  const [teammates, setTeammates] = useState<Session[]>([]);
  // Persisted state lives on the server now (preferences table). usePreference
  // caches in-memory + hydrates async, so we keep a sane default and let
  // writes propagate. Key scoped per PM so switching sessions doesn't
  // inherit a mismatched layout.
  const prefKey = `split-state.${pmSessionId ?? 'none'}`;
  const legacy = useMemo(() => (pmSessionId ? readLegacySplit(pmSessionId) : null), [pmSessionId]);
  const defaultSplit = useMemo<SplitState>(() => legacy ?? {
    activeTabId: null,
    minimized: false,
    percent: DEFAULT_PERCENT,
  }, [legacy]);
  const [split, setSplit] = usePreference<SplitState>(prefKey, defaultSplit);
  // Account-wide (cross-PM) preference — when true, a teammate spawn
  // auto-activates the split pane on whichever PM's chat is open. When
  // false, the spawn still registers but the user has to click the
  // teammate in the strip/Sessions tree to focus them.
  const [autoSplitOnSpawn, setAutoSplitOnSpawn] = usePreference<boolean>('auto-split-on-spawn', true);
  const activeTabId = split.activeTabId ?? null;
  const minimized = !!split.minimized;
  const percent = split.percent ?? DEFAULT_PERCENT;
  const setActiveTabId = useCallback((next: string | null) => setSplit({ ...split, activeTabId: next }), [split, setSplit]);
  const setMinimized = useCallback((next: boolean) => setSplit({ ...split, minimized: next }), [split, setSplit]);
  const setPercent = useCallback((next: number) => setSplit({ ...split, percent: next }), [split, setSplit]);
  // Fires when a new teammate arrives while the pane is minimized — drives
  // a one-shot pulse on the strip icon so the user doesn't miss the spawn.
  const [pulseSessionId, setPulseSessionId] = useState<string | null>(null);
  // Whichever teammate input the user is currently focused in drives the
  // Direct Mode badge on the PM pane.
  const [directModeRole, setDirectModeRole] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => { subscribe(['sessions']); }, [subscribe]);

  // Server is authoritative. Filter to non-stopped, hard-cap at 3, sort
  // by creation so a consistent tab order survives across reloads.
  //
  // `promote` — when true, fill an empty activeTabId with the first
  // remaining teammate. Initial mount and manual refresh use true (the
  // user just arrived; showing the split they expect is correct). WS
  // spawn events gate on the auto-split-on-spawn preference so users
  // can opt out of having the split pop open under their cursor.
  const refreshTeammates = useCallback(async (opts?: { promote?: boolean }) => {
    if (!pmSessionId) return;
    const promote = opts?.promote ?? true;
    try {
      const list = await api.get<Session[]>(
        `/sessions/${encodeURIComponent(pmSessionId)}/teammates`,
      );
      const active = list
        .filter((t) => t.status !== 'stopped')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, MAX_TEAMMATES);

      setTeammates(active);

      // Drop any stale active tab (previously-active teammate is gone).
      // This path always runs, regardless of promote — a dead tab must
      // not linger.
      const tabStillValid = activeTabId && active.some((t) => t.id === activeTabId);
      if (!tabStillValid) {
        const next = promote ? (active[0]?.id ?? null) : null;
        if (next !== activeTabId) setActiveTabId(next);
      }
    } catch { /* transient — next WS event will retry */ }
  }, [pmSessionId, activeTabId, setActiveTabId]);

  useEffect(() => { refreshTeammates({ promote: true }); }, [refreshTeammates]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'teammate:spawned') {
      // Pulse the strip icon when a teammate spawns while minimized.
      if (minimized) {
        setPulseSessionId(lastEvent.teammate.sessionId);
        const t = setTimeout(() => setPulseSessionId(null), 3000);
        // No cleanup needed — setState is safe post-unmount.
        void t;
      }
      refreshTeammates({ promote: autoSplitOnSpawn });
    } else if (lastEvent.type === 'teammate:dismissed') {
      refreshTeammates({ promote: false });
    } else if (lastEvent.type === 'session:status') {
      // Patch status in place so tab dots update without a full refetch.
      setTeammates((prev) =>
        prev.map((t) => (t.id === lastEvent.sessionId ? { ...t, status: lastEvent.status } : t)),
      );
    } else if (lastEvent.type === 'session:updated') {
      // Upsert — keeps name/model/role fresh when team-config reconciles.
      setTeammates((prev) => {
        const idx = prev.findIndex((t) => t.id === lastEvent.session.id);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = lastEvent.session;
        return next;
      });
    }
  }, [lastEvent, refreshTeammates, minimized, autoSplitOnSpawn]);

  // Direct Mode — watch focus movement into/out of the right pane. A
  // teammate input is any element inside rightPaneRef; when focus lands
  // there, label the PM pane with the active tab's role.
  useEffect(() => {
    const onFocus = () => {
      const pane = rightPaneRef.current;
      if (!pane) { setDirectModeRole(null); return; }
      const active = document.activeElement as HTMLElement | null;
      if (active && pane.contains(active)) {
        const tab = teammates.find((t) => t.id === activeTabId);
        setDirectModeRole(tab?.agentRole ?? tab?.name ?? 'teammate');
      } else {
        setDirectModeRole(null);
      }
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocus);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocus);
    };
  }, [activeTabId, teammates]);

  // Drag-handle resize — disabled while minimized (pane is a fixed strip).
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (minimized) return;
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [minimized]);

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
    setTeammates([]);
    setSplit({ activeTabId: null, minimized: false, percent });
  }, [setSplit, percent]);

  const activeTab = useMemo(
    () => teammates.find((t) => t.id === activeTabId) ?? null,
    [teammates, activeTabId],
  );
  const anyWaiting = teammates.some((t) => t.status === 'waiting');

  if (teammates.length === 0 || !activeTabId) {
    return <ChatPage />;
  }

  // Minimized: PM full-width minus the 48px strip on the right.
  // Mobile viewports always render this variant — dual-pane below 768px
  // would squeeze each chat to <50% of an already-small screen.
  const useStrip = minimized || isNarrow;
  if (useStrip) {
    return (
      <div ref={containerRef} className="flex h-full w-full min-h-0" style={{ fontFamily: M }}>
        <div className="h-full min-h-0 overflow-hidden flex-1 relative">
          <ChatPage />
          <DirectModeBadge role={directModeRole} />
        </div>
        <motion.div
          layout
          transition={{ duration: 0.3, ease: 'easeOut' as const }}
          className={`shrink-0 flex flex-col items-center py-2 gap-1 ${anyWaiting ? 'waiting-glow' : ''}`}
          style={{
            width: STRIP_WIDTH,
            background: 'rgba(0,0,0,0.2)',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {!isNarrow && (
            <button
              onClick={() => setMinimized(false)}
              title="Expand teammates"
              className="flex items-center justify-center rounded-md transition-colors"
              style={{
                width: 32, height: 32,
                color: 'var(--color-text-secondary)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            >
              <Users size={14} />
            </button>
          )}
          <AnimatePresence>
            {teammates.map((t) => (
              <motion.button
                key={t.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  if (isNarrow) {
                    // Mobile: jump to the teammate's own /chat/:id route so
                    // they get the full viewport instead of cramming into
                    // half a small screen.
                    navigate(`/chat/${t.id}`);
                  } else {
                    setActiveTabId(t.id);
                    setMinimized(false);
                  }
                }}
                title={`${t.name}${t.agentRole ? ` · ${t.agentRole}` : ''}`}
                className={`relative flex flex-col items-center justify-center rounded-md px-0.5 py-1 transition-all ${pulseSessionId === t.id ? 'waiting-tab-alarm' : ''} ${t.status === 'waiting' ? 'waiting-tab-alarm' : ''}`}
                style={{
                  width: 32,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <StatusBadge status={t.status} size="sm" />
                <span
                  className="text-[9px] leading-tight mt-0.5 truncate w-full text-center"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {t.agentRole?.slice(0, 4) ?? t.name.slice(0, 4)}
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  const rightPercent = 100 - percent;

  return (
    <div ref={containerRef} className="flex h-full w-full min-h-0" style={{ fontFamily: M }}>
      <div className="h-full min-h-0 overflow-hidden relative" style={{ width: `${percent}%` }}>
        <ChatPage />
        <DirectModeBadge role={directModeRole} />
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

      <div
        ref={rightPaneRef}
        className={`relative h-full min-h-0 overflow-hidden flex flex-col ${activeTab?.status === 'waiting' ? 'waiting-glow' : ''}`}
        style={{ width: `${rightPercent}%` }}
      >
        {/* Tab bar — hidden when exactly one teammate (keeps the old
            single-slot silhouette). Rendered above ChatPage so tab clicks
            reassign the mounted ChatPage's sessionIdOverride. */}
        {teammates.length > 1 && (
          <div
            className="shrink-0 flex items-center gap-0.5 px-2 pt-2 pb-0 overflow-x-auto"
            style={{
              background: 'rgba(0,0,0,0.18)',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <AnimatePresence initial={false}>
              {teammates.map((t) => {
                const isActive = t.id === activeTabId;
                const isWaiting = t.status === 'waiting';
                return (
                  <motion.button
                    key={t.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => setActiveTabId(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md transition-all ${isWaiting && !isActive ? 'waiting-tab-alarm' : ''}`}
                    style={{
                      fontFamily: M,
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      background: isActive ? 'rgba(14, 124, 123, 0.1)' : 'transparent',
                      borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    <StatusBadge status={t.status} size="sm" />
                    <span>{t.name}</span>
                    {t.agentRole && (
                      <span
                        className="text-[10px] px-1 py-0.5 rounded"
                        style={{ color: 'var(--color-accent-light)', background: 'rgba(14, 124, 123, 0.08)' }}
                      >
                        {t.agentRole}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Single-tab header (hidden when tab bar is visible) */}
        {teammates.length === 1 && activeTab && (
          <div
            className="absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md px-2 py-1"
            style={{
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              fontFamily: M,
            }}
          >
            <StatusBadge status={activeTab.status} size="sm" />
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {activeTab.name}
            </span>
            {activeTab.agentRole && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: 'var(--color-accent-light)', background: 'rgba(14, 124, 123, 0.08)' }}
              >
                {activeTab.agentRole}
              </span>
            )}
          </div>
        )}

        {/* Top-right controls: auto-split toggle + minimize + close */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            onClick={() => setAutoSplitOnSpawn(!autoSplitOnSpawn)}
            className="flex items-center justify-center rounded-md p-1 transition-colors"
            style={{
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: autoSplitOnSpawn ? 'var(--color-accent-light)' : 'var(--color-text-tertiary)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'; }}
            title={autoSplitOnSpawn
              ? 'Auto-open split on teammate spawn: ON'
              : 'Auto-open split on teammate spawn: OFF'}
          >
            <Columns2 size={14} />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="flex items-center justify-center rounded-md p-1 transition-colors"
            style={{
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--color-text-secondary)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.25)'; }}
            title="Minimize to strip"
          >
            <Minimize2 size={14} />
          </button>
          <button
            onClick={closeCoderPane}
            className="flex items-center justify-center rounded-md p-1 transition-colors"
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
        </div>

        <div className="flex-1 min-h-0">
          {/* Keying ChatPage on activeTabId forces a clean remount when the
              user switches tabs — useChat + usePromptDetection re-keyed per
              session, scroll resets cleanly, inputs don't carry over. */}
          <ChatPage key={activeTabId} sessionIdOverride={activeTabId} />
        </div>
      </div>
    </div>
  );
};

// Informational badge for the PM pane when the user is focused on a
// teammate's input. Routing doesn't change — each tab's input already
// targets its own sessionId — this just makes the focus visible.
const DirectModeBadge = ({ role }: { role: string | null }) => (
  <AnimatePresence>
    {role && (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium pointer-events-none"
        style={{
          fontFamily: M,
          color: 'var(--color-accent-light)',
          background: 'rgba(14, 124, 123, 0.14)',
          border: '1px solid rgba(14, 124, 123, 0.28)',
          backdropFilter: 'blur(8px)',
        }}
      >
        Direct Mode · {role}
      </motion.div>
    )}
  </AnimatePresence>
);
