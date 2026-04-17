import { useEffect, useState } from 'react';
import type {
  IdleNotificationFragment,
  ParsedChatMessage,
} from './chatMessageParser';

// Phase K — visibility mode for inter-session protocol noise
// (idle_notification / teammate_terminated / shutdown_approved).
//
// - `hide`:  drop these fragments entirely
// - `chips`: one muted line per fragment (default)
// - `cards`: slightly larger variant with timestamp inline
//
// Backed by localStorage so the preference survives reloads. Read through
// `useSystemEventsMode` so components re-render when the value changes in
// another tab (storage event). No UI surfaces the toggle today; flip via
// DevTools `localStorage.setItem('jsc-show-system-events', 'cards' | 'hide')`.
export type SystemEventsMode = 'hide' | 'chips' | 'cards';

const STORAGE_KEY = 'jsc-show-system-events';
const DEFAULT_MODE: SystemEventsMode = 'chips';

const readMode = (): SystemEventsMode => {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'hide' || raw === 'chips' || raw === 'cards') return raw;
  return DEFAULT_MODE;
};

export const useSystemEventsMode = (): SystemEventsMode => {
  const [mode, setMode] = useState<SystemEventsMode>(() => readMode());

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key && e.key !== STORAGE_KEY) return;
      setMode(readMode());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return mode;
};

// Collapse-window for consecutive same-teammate idle_notifications. The
// threshold is intentionally generous — Claude Code tends to burst multiple
// idle flips within a couple seconds of each other, and the UI reads cleaner
// as one "coder-15 idled ×3" row than three separate chips.
const IDLE_COLLAPSE_WINDOW_MS = 60_000;

// Fragment shape carrying the collapsed count. Reuses the original
// IdleNotificationFragment type + an optional `count` annotation so the
// rendering path stays a single code path.
export interface CollapsedIdleFragment extends IdleNotificationFragment {
  count?: number;
}

export type CollapsedChatMessage = Exclude<ParsedChatMessage, IdleNotificationFragment> | CollapsedIdleFragment;

const parseTs = (ts?: string): number | null => {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
};

// Walk the fragment list and merge consecutive `idle-notification` entries
// for the same `from` within IDLE_COLLAPSE_WINDOW_MS into a single fragment
// carrying a `count`. Other fragment types pass through untouched. Missing
// timestamps collapse optimistically — the user doesn't need us to resolve
// exact ordering for a visual row, and two idles a frame apart with no
// timestamps are almost certainly the same burst.
export const collapseConsecutiveIdles = (
  fragments: ParsedChatMessage[],
): CollapsedChatMessage[] => {
  const out: CollapsedChatMessage[] = [];
  for (const frag of fragments) {
    if (frag.kind !== 'idle-notification') {
      out.push(frag as CollapsedChatMessage);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === 'idle-notification' && last.notification.from === frag.notification.from) {
      const lastTs = parseTs(last.notification.timestamp);
      const thisTs = parseTs(frag.notification.timestamp);
      const inWindow =
        lastTs === null || thisTs === null || Math.abs(thisTs - lastTs) <= IDLE_COLLAPSE_WINDOW_MS;
      if (inWindow) {
        const merged: CollapsedIdleFragment = {
          ...last,
          count: (last.count ?? 1) + 1,
          // Advance the timestamp to the most recent occurrence so the
          // tooltip reflects when the burst ended, not began.
          notification: {
            ...last.notification,
            timestamp: frag.notification.timestamp ?? last.notification.timestamp,
          },
        };
        out[out.length - 1] = merged;
        continue;
      }
    }
    out.push(frag as CollapsedIdleFragment);
  }
  return out;
};

// Convenience predicate used by ChatThread to decide whether a fragment
// should be hidden under the `hide` visibility mode.
export const isSystemEventFragment = (frag: ParsedChatMessage): boolean =>
  frag.kind === 'idle-notification' ||
  frag.kind === 'teammate-terminated' ||
  frag.kind === 'shutdown-approved';
