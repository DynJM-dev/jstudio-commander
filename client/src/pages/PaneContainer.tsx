import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GripVertical, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatPage } from './ChatPage';
import { TerminalDrawer } from '../components/chat/TerminalDrawer';
import { ProjectStateDrawer } from '../components/chat/ProjectStateDrawer';
import { SplitViewButton } from '../components/chat/SplitViewButton';
import { usePaneState } from '../hooks/usePaneState';
import { useSessionUi } from '../hooks/useSessionUi';
import { useSessions } from '../hooks/useSessions';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  MIN_PANE_WIDTH_PX,
  MIN_DRAWER_HEIGHT_PX,
  MAX_DRAWER_HEIGHT_RATIO,
  type Session,
} from '@commander/shared';

const M = 'Montserrat, sans-serif';

// Phase W.2 — generic pane container. Display rules:
//   - URL `/chat/:sessionId` is the source of truth for the LEFT pane.
//   - `paneState.rightSessionId` adds a right pane if set.
//   - Sessions-page click → `/chat/:id` always opens SINGLE pane.
//     The url-changed dispatch collapses right if it matches.
//   - Session termination cascade: lives in usePaneState's WS listener.
//     When the terminated session was the LEFT pane (URL), the router
//     navigates to /sessions; toast fires here.
//
// Close buttons per pane:
//   - Right pane X → closeRight() only (session stays running).
//   - Left pane X → navigate to /sessions; if right was set, a
//     follow-up url-changed fires which collapses right (since the
//     new URL `/sessions` has no :sessionId → newLeft=null, right
//     stays intact; user reaches it by clicking in sessions list).
//     NB: per spec #5, if left X when 2-pane, right promotes to
//     sole pane + URL updates to it. Implemented explicitly below.

interface PaneHeaderProps {
  sessionName: string;
  sessionType?: string;
  status?: string;
  showClose: boolean;
  showSplitView: boolean;
  onClose?: () => void;
  splitCandidates?: Session[];
  splitEnabled?: boolean;
  onSplitSelect?: (sessionId: string) => void;
}

const PaneHeader = ({
  sessionName,
  sessionType,
  showClose,
  showSplitView,
  onClose,
  splitCandidates = [],
  splitEnabled = true,
  onSplitSelect,
}: PaneHeaderProps) => (
  <div
    className="shrink-0 flex items-center gap-2 px-3 py-1.5"
    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', fontFamily: M }}
  >
    <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text-secondary)' }}>
      {sessionName}
    </span>
    {sessionType && (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
        style={{ color: 'var(--color-text-tertiary)', background: 'rgba(255,255,255,0.05)' }}
      >
        {sessionType}
      </span>
    )}
    <span className="flex-1" />
    {showSplitView && onSplitSelect && (
      <SplitViewButton
        candidates={splitCandidates}
        enabled={splitEnabled}
        onSelect={onSplitSelect}
      />
    )}
    {showClose && onClose && (
      <button
        onClick={onClose}
        title="Close pane (session keeps running)"
        aria-label="Close pane"
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--color-text-tertiary)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <X size={13} />
      </button>
    )}
  </div>
);

interface PaneProps {
  sessionId: string;
  isFocused: boolean;
  onFocus: () => void;
  showFocusBorder: boolean;
  sessionMeta: Session | null;
  header: React.ReactNode;
}

const Pane = ({ sessionId, isFocused, onFocus, showFocusBorder, header }: PaneProps) => {
  const [sessionUi, ui] = useSessionUi(sessionId);
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState<number>(0);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const update = () => setPaneHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // M7 MVP — per-pane STATE.md drawer state. Local useState (not
  // persisted via useSessionUi to keep the dispatch boundary minimal;
  // persistence across reload is a later polish). Mutually exclusive
  // with the terminal drawer: opening one closes the other since both
  // bottom-anchor. Height defaults to 50% of pane on first open.
  const [stateDrawerOpen, setStateDrawerOpen] = useState(false);
  const [stateDrawerHeightPx, setStateDrawerHeightPx] = useState<number | null>(null);

  // Cmd+J / Ctrl+J — toggles THIS pane's drawer when focused.
  // Skipped when keydown target is an input/textarea (search boxes).
  useEffect(() => {
    if (!isFocused || paneHeight <= 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'J') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      e.preventDefault();
      ui.toggle(paneHeight);
      // Mutual exclusion — terminal opening closes the STATE.md drawer.
      setStateDrawerOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocused, paneHeight, ui]);

  // M7 MVP — Cmd+Shift+S / Ctrl+Shift+S toggles THIS pane's STATE.md
  // drawer when focused. No known conflicts with existing shortcuts
  // (grep verified: CommandInput/ChatPage Enter handlers, useModalA11y
  // tab trap — none bind Shift+S with modifier).
  useEffect(() => {
    if (!isFocused || paneHeight <= 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 's' && e.key !== 'S') return;
      if (!e.shiftKey) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      e.preventDefault();
      setStateDrawerOpen((prev) => {
        const next = !prev;
        if (next) {
          // Mutual exclusion — close terminal drawer.
          ui.setOpen(false);
          if (stateDrawerHeightPx === null) {
            // First open — default 50% of pane, clamped.
            const init = Math.floor(paneHeight * 0.5);
            const clamped = Math.min(
              Math.max(init, MIN_DRAWER_HEIGHT_PX),
              Math.floor(paneHeight * MAX_DRAWER_HEIGHT_RATIO),
            );
            setStateDrawerHeightPx(clamped);
          }
        }
        return next;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocused, paneHeight, ui, stateDrawerHeightPx]);

  const drawerHeight = paneHeight > 0 ? ui.effectiveHeight(paneHeight) : 0;
  const drawerOpen = sessionUi.terminalDrawerOpen && paneHeight > 0;
  const stateDrawerHeight = stateDrawerHeightPx !== null && paneHeight > 0
    ? Math.min(
        Math.max(stateDrawerHeightPx, MIN_DRAWER_HEIGHT_PX),
        Math.floor(paneHeight * MAX_DRAWER_HEIGHT_RATIO),
      )
    : 0;
  const stateDrawerReallyOpen = stateDrawerOpen && paneHeight > 0 && stateDrawerHeight > 0;

  return (
    <div
      ref={paneRef}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      className="relative flex flex-col h-full min-h-0"
      style={{
        outline: showFocusBorder && isFocused
          ? '1px solid var(--color-accent)'
          : '1px solid transparent',
        outlineOffset: '-1px',
        transition: 'outline-color 140ms ease-out',
      }}
      data-pane-session-id={sessionId}
    >
      {header}
      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{
          paddingBottom: drawerOpen
            ? drawerHeight
            : (stateDrawerReallyOpen ? stateDrawerHeight : 0),
          transition: 'padding-bottom 180ms ease-out',
        }}
      >
        <ChatPage sessionIdOverride={sessionId} />
      </div>

      {paneHeight > 0 && (
        <TerminalDrawer
          sessionId={sessionId}
          open={sessionUi.terminalDrawerOpen}
          heightPx={drawerHeight}
          onHeightChange={(px) => ui.setHeight(px, paneHeight)}
          onClose={() => ui.setOpen(false)}
        />
      )}

      {/* M7 MVP — per-pane STATE.md drawer. Same position class as
          TerminalDrawer; mutual exclusion enforced in the keyboard
          handlers above. Independent of TerminalDrawer lifecycle. */}
      {paneHeight > 0 && (
        <ProjectStateDrawer
          sessionId={sessionId}
          open={stateDrawerReallyOpen}
          heightPx={stateDrawerHeight}
          onHeightChange={(px) => {
            const clamped = Math.min(
              Math.max(px, MIN_DRAWER_HEIGHT_PX),
              Math.floor(paneHeight * MAX_DRAWER_HEIGHT_RATIO),
            );
            setStateDrawerHeightPx(clamped);
          }}
          onClose={() => setStateDrawerOpen(false)}
        />
      )}
    </div>
  );
};

// Simple inline toast surface — used when termination cascade fires.
// Lives here rather than a shared toast system because W.2 only needs
// one kind of toast and the existing app doesn't have a toast layer
// to reuse. A real toast stack can replace this without touching the
// cascade logic.
const Toast = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      role="status"
      className="fixed bottom-5 right-5 z-50 px-3 py-2 rounded-lg text-xs"
      style={{
        fontFamily: M,
        color: 'var(--color-text-primary)',
        background: 'rgba(12,16,22,0.96)',
        border: '1px solid rgba(14,124,123,0.35)',
        backdropFilter: 'blur(24px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        maxWidth: 360,
      }}
    >
      {message}
    </motion.div>
  );
};

export const PaneContainer = () => {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [paneState, paneActions] = usePaneState();
  const { sessions } = useSessions();
  const { lastEvent } = useWebSocket();

  const leftId = urlSessionId ?? null;
  const rightId = paneState.rightSessionId;
  // Never paint same session on both sides — reducer normalizes, but
  // the first render could see a stale pair if the user navigated
  // into a session that happens to be the current right. Filter here
  // as a belt-and-suspenders.
  const effectiveRightId = rightId && rightId !== leftId ? rightId : null;
  const isDual = Boolean(leftId && effectiveRightId);

  const focusedId = paneState.focusedSessionId ?? leftId;

  const leftMeta = useMemo(
    () => sessions.find((s) => s.id === leftId) ?? null,
    [sessions, leftId],
  );
  const rightMeta = useMemo(
    () => sessions.find((s) => s.id === effectiveRightId) ?? null,
    [sessions, effectiveRightId],
  );

  // Running-session candidates for the Split View dropdown: anything
  // not stopped, not the left, not the currently-open right. Exclude
  // teammate rows without a parent from surfacing twice — but keep
  // role-agnostic: every non-stopped session is pickable.
  const splitCandidates = useMemo(
    () => sessions.filter(
      (s) => s.status !== 'stopped'
        && s.id !== leftId
        && s.id !== effectiveRightId,
    ),
    [sessions, leftId, effectiveRightId],
  );

  // URL changes → tell the reducer so it can collapse right if it
  // now matches the new URL, normalize focus. Fires on every mount +
  // every URL param change.
  useEffect(() => {
    paneActions.onUrlChanged(leftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId]);

  // Termination-cascade toast + left-pane navigation. When the URL-
  // side session gets terminated, pane-state can't help (URL isn't
  // its concern); we navigate away so the user never sits on a dead
  // `/chat/:id`.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!lastEvent) return;
    const e = lastEvent as { type?: string; session?: { id?: string; status?: string; name?: string }; sessionId?: string };
    const goneId = e.type === 'session:deleted' ? e.sessionId
                  : (e.type === 'session:updated' && e.session?.status === 'stopped') ? e.session.id
                  : null;
    if (!goneId) return;
    // A session went away. Compose toast + route actions.
    if (goneId === leftId) {
      const name = leftMeta?.name ?? 'Session';
      setToast(`${name} terminated — returning to Sessions`);
      // Before navigating, if the right pane was set, promote it to
      // left via navigation (better UX than dumping the user to the
      // list when they had another session visible). Spec #5: left X
      // promotes right; termination-cascade of left gets the same.
      if (effectiveRightId) {
        navigate(`/chat/${effectiveRightId}`, { replace: true });
        paneActions.closeRight();
      } else {
        navigate('/sessions', { replace: true });
      }
      return;
    }
    if (goneId === effectiveRightId) {
      const name = rightMeta?.name ?? 'Session';
      setToast(`${name} terminated — closed right pane`);
    }
  }, [lastEvent, leftId, effectiveRightId, leftMeta, rightMeta, navigate, paneActions]);

  // Divider drag.
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const total = rect.width;
      if (total <= 0) return;
      const minRatio = MIN_PANE_WIDTH_PX / total;
      const maxRatio = 1 - minRatio;
      let ratio = x / total;
      if (ratio < minRatio) ratio = minRatio;
      if (ratio > maxRatio) ratio = maxRatio;
      paneActions.setDivider(ratio);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [paneActions]);

  // Close handlers (per-pane X button).
  const onLeftClose = useCallback(() => {
    // Spec #5: left X → right promotes to left; URL updates.
    if (effectiveRightId) {
      const promotedTo = effectiveRightId;
      paneActions.closeRight();
      navigate(`/chat/${promotedTo}`, { replace: true });
    } else {
      navigate('/sessions', { replace: true });
    }
  }, [effectiveRightId, paneActions, navigate]);

  const onRightClose = useCallback(() => paneActions.closeRight(), [paneActions]);

  const onSplitSelect = useCallback(
    (sessionId: string) => paneActions.openRight(sessionId, leftId),
    [paneActions, leftId],
  );

  if (!leftId) {
    return (
      <div className="h-full flex items-center justify-center" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
        <p className="text-sm">No session selected. Pick one from the sidebar.</p>
      </div>
    );
  }

  const typeLabel = (s: Session | null) =>
    s ? ({ pm: 'PM', coder: 'Coder', raw: 'Raw' } as const)[s.sessionType] : undefined;

  const toastEl = (
    <AnimatePresence>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </AnimatePresence>
  );

  if (!isDual) {
    const singleHeader = (
      <PaneHeader
        sessionName={leftMeta?.name ?? 'Session'}
        sessionType={typeLabel(leftMeta)}
        status={leftMeta?.status}
        showClose={false}
        showSplitView={true}
        splitCandidates={splitCandidates}
        splitEnabled={true}
        onSplitSelect={onSplitSelect}
      />
    );
    return (
      <>
        <div className="h-full min-h-0 overflow-hidden">
          <Pane
            sessionId={leftId}
            isFocused={true}
            onFocus={() => paneActions.focus(leftId, leftId)}
            showFocusBorder={false}
            sessionMeta={leftMeta}
            header={singleHeader}
          />
        </div>
        {toastEl}
      </>
    );
  }

  const leftRatio = paneState.dividerRatio;
  const leftHeader = (
    <PaneHeader
      sessionName={leftMeta?.name ?? 'Session'}
      sessionType={typeLabel(leftMeta)}
      showClose={true}
      showSplitView={false}
      onClose={onLeftClose}
    />
  );
  const rightHeader = (
    <PaneHeader
      sessionName={rightMeta?.name ?? 'Session'}
      sessionType={typeLabel(rightMeta)}
      showClose={true}
      // In dual mode, split-view button is disabled (two already) but
      // still rendered on the FOCUSED pane so the user sees the cap.
      // Simpler: keep it on the right pane only with enabled=false.
      showSplitView={true}
      splitEnabled={false}
      splitCandidates={[]}
      onSplitSelect={onSplitSelect}
      onClose={onRightClose}
    />
  );

  return (
    <>
      <div ref={containerRef} className="flex h-full w-full min-h-0">
        <div
          style={{ width: `${leftRatio * 100}%`, minWidth: MIN_PANE_WIDTH_PX }}
          className="h-full min-h-0 overflow-hidden"
        >
          <Pane
            sessionId={leftId}
            isFocused={focusedId === leftId}
            onFocus={() => paneActions.focus(leftId, leftId)}
            showFocusBorder={true}
            sessionMeta={leftMeta}
            header={leftHeader}
          />
        </div>

        <div
          onMouseDown={onDividerMouseDown}
          className="shrink-0 flex items-center justify-center cursor-col-resize group"
          style={{
            width: 6,
            background: 'rgba(255,255,255,0.04)',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}
          role="separator"
          aria-orientation="vertical"
        >
          <GripVertical
            size={12}
            style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }}
            className="group-hover:opacity-100 transition-opacity"
          />
        </div>

        <div
          style={{ width: `${(1 - leftRatio) * 100}%`, minWidth: MIN_PANE_WIDTH_PX }}
          className="h-full min-h-0 overflow-hidden"
        >
          <Pane
            sessionId={effectiveRightId!}
            isFocused={focusedId === effectiveRightId}
            onFocus={() => paneActions.focus(effectiveRightId!, leftId)}
            showFocusBorder={true}
            sessionMeta={rightMeta}
            header={rightHeader}
          />
        </div>
      </div>
      {toastEl}
    </>
  );
};
