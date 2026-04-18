import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { ChatPage } from './ChatPage';
import { TerminalDrawer } from '../components/chat/TerminalDrawer';
import { usePaneState } from '../hooks/usePaneState';
import { useSessionUi } from '../hooks/useSessionUi';
import { MIN_PANE_WIDTH_PX } from '@commander/shared';

const M = 'Montserrat, sans-serif';

// Phase W — the generic pane container. Replaces SplitChatLayout's
// PM/Coder special-case with a simple visual pin model driven by the
// global `pane-state` preference. Max 2 panes ever; each pane is a
// self-contained ChatPage with its own terminal drawer. Zero cross-
// pane state sharing.
//
// Display precedence (documented fallback for team-lead checkpoint):
//   1. pane-state.left && pane-state.right → 2-pane layout.
//   2. pane-state.left only → 1-pane on left's session.
//   3. pane-state empty → fall back to URL :sessionId as a transient
//      single pane. This keeps `/chat/:id` deep links working when
//      the user has unpinned everything — no awkward blank view.
//
// URL semantics: the URL is a navigation target, not a pin trigger.
// Pin actions are explicit via the sidebar icon. This matches design
// call (a) confirmed at the Phase W checkpoint.

interface PaneProps {
  sessionId: string;
  isFocused: boolean;
  onFocus: () => void;
  // When false, this pane is the only one visible and doesn't need a
  // focus border (nothing to distinguish it from). The click-to-focus
  // handler still fires but never paints anything.
  showFocusBorder: boolean;
}

const Pane = ({ sessionId, isFocused, onFocus, showFocusBorder }: PaneProps) => {
  const [sessionUi, ui] = useSessionUi(sessionId);
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneHeight, setPaneHeight] = useState<number>(0);

  // Track the pane's content height so the drawer's clamp math can
  // use a live number. Initial read on mount + ResizeObserver for
  // subsequent divider drags / window resizes.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const update = () => setPaneHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cmd+J / Ctrl+J toggles THIS pane's drawer when the pane is
  // focused. Listener lives on the Pane (not the drawer) so it stays
  // mounted whether the drawer is open or closed — otherwise the
  // first Cmd+J couldn't OPEN a closed drawer because its listener
  // wouldn't exist yet.
  useEffect(() => {
    if (!isFocused || paneHeight <= 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'J') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Ignore when a text input owns focus — users routinely Cmd+J
      // in search boxes etc. The pane's focus marker is data-pane-
      // session-id; if the keydown target is inside a textarea or
      // input, skip.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      e.preventDefault();
      ui.toggle(paneHeight);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocused, paneHeight, ui]);

  const drawerHeight = paneHeight > 0 ? ui.effectiveHeight(paneHeight) : 0;
  const drawerOpen = sessionUi.terminalDrawerOpen && paneHeight > 0;

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
      {/* Chat content area. Shrinks when the drawer is open so the
          terminal doesn't overlap the input bar. */}
      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{
          paddingBottom: drawerOpen ? drawerHeight : 0,
          transition: 'padding-bottom 180ms ease-out',
        }}
      >
        <ChatPage sessionIdOverride={sessionId} />
      </div>

      {/* Per-pane terminal drawer. Mounts only when the pane has
          measured itself — prevents the initial drawer-height calc
          from clamping against paneHeight=0. */}
      {paneHeight > 0 && (
        <TerminalDrawer
          sessionId={sessionId}
          open={sessionUi.terminalDrawerOpen}
          heightPx={drawerHeight}
          onHeightChange={(px) => ui.setHeight(px, paneHeight)}
          onClose={() => ui.setOpen(false)}
        />
      )}
    </div>
  );
};

export const PaneContainer = () => {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [paneState, paneActions] = usePaneState();

  // Display precedence — see header comment for the fallback rule.
  const leftId = paneState.left ?? urlSessionId ?? null;
  const rightId = paneState.left ? paneState.right : null;
  const isDual = Boolean(leftId && rightId);

  const focusedId = paneState.focusedSessionId ?? leftId;

  // Divider drag — reuse the same clientX-delta pattern the old split
  // used. Clamped so neither pane can shrink below MIN_PANE_WIDTH_PX.
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
      // Clamp both ends so neither pane drops below the min width.
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

  // Cmd+J / Ctrl+J handling lives on each Pane (scoped to isFocused),
  // not here — the focused pane owns its own listener so it can call
  // useSessionUi.toggle with live paneHeight. Centralizing the
  // keydown here would force us to dispatch a CustomEvent across the
  // tree, which only works when the target drawer is already
  // mounted. Keeping it on Pane means "closed drawer" also responds
  // to Cmd+J (the opening press).

  if (!leftId) {
    // No session at all — pane-state empty AND URL has no :sessionId
    // (shouldn't happen under the current routes, but render a graceful
    // empty state rather than crash).
    return (
      <div className="h-full flex items-center justify-center" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
        <p className="text-sm">No session selected. Pick one from the sidebar.</p>
      </div>
    );
  }

  // P0 fix: parent `<main>` in DashboardLayout is NOT `flex flex-col`,
  // it's a block element with `flex-1 overflow-hidden`. So `flex-1` on
  // our container does NOTHING (no flex parent = no flex-basis). The
  // container must use `h-full` to inherit main's computed height.
  // Each column mirrors the pre-W SplitChatLayout pattern
  // (`h-full min-h-0 overflow-hidden`) so the flex-col inside Pane
  // can do its min-h-0 trick and the ChatPage scroll region can grow.

  if (!isDual) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <Pane
          sessionId={leftId}
          isFocused={true}
          onFocus={() => paneActions.focus(leftId)}
          showFocusBorder={false}
        />
      </div>
    );
  }

  const leftRatio = paneState.dividerRatio;

  return (
    <div ref={containerRef} className="flex h-full w-full min-h-0">
      <div
        style={{ width: `${leftRatio * 100}%`, minWidth: MIN_PANE_WIDTH_PX }}
        className="h-full min-h-0 overflow-hidden"
      >
        <Pane
          sessionId={leftId!}
          isFocused={focusedId === leftId}
          onFocus={() => paneActions.focus(leftId!)}
          showFocusBorder={true}
        />
      </div>

      {/* Divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className="shrink-0 flex items-center justify-center cursor-col-resize group"
        style={{
          width: 6,
          background: 'rgba(255, 255, 255, 0.04)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
          borderRight: '1px solid rgba(255, 255, 255, 0.06)',
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
          sessionId={rightId!}
          isFocused={focusedId === rightId}
          onFocus={() => paneActions.focus(rightId!)}
          showFocusBorder={true}
        />
      </div>
    </div>
  );
};
