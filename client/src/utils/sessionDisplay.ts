import type { Session, SessionStatus } from '@commander/shared';

// Client-side derived UI state. The server stores the raw SessionStatus
// (working/idle/waiting/stopped/error); the UI layer augments it with
// `teammate-active` for PMs whose pane is idle but whose teammates are
// actively working. That state exists only visually — the server doesn't
// care, it's purely for "the session is productive, don't paint it idle".
export type DisplayStatus = 'working' | 'waiting' | 'teammate-active' | 'idle' | 'stopped' | 'error';

// `teammate-active` is distinct from `waiting`: waiting means the user must
// act (yellow alarm), while teammate-active means "no action required, work
// is happening in a sub-agent" (calm blue). Precedence top-to-bottom below
// mirrors the severity/attention-required ladder — a PM that's BOTH working
// its own pane AND has busy teammates reads as `working` (own pane wins
// because that's what the user is watching on this surface).
export const getDisplayStatus = (
  session: Pick<Session, 'status'>,
  teammates?: Session[] | null,
): DisplayStatus => {
  const raw = session.status as SessionStatus;
  if (raw === 'working') return 'working';
  if (raw === 'waiting') return 'waiting';
  if (raw === 'stopped') return 'stopped';
  if (raw === 'error') return 'error';
  // raw is 'idle' — check teammates
  if (teammates && teammates.some((t) => t.status === 'working')) return 'teammate-active';
  return 'idle';
};

// Return a display name that disambiguates when multiple sessions share the
// same `name`. Works on the full session list (active + stopped) so a dead
// dupe still gets tagged before the user opens it. When the name is unique
// the result equals `session.name` unchanged.
//
// The suffix is derived from the Commander id (first 6 chars). Tmux session
// names already encode this prefix (`jsc-<first-8>`), so the disambiguator
// lines up with the pane the user would see in tmux/Terminal — matches the
// mental model in two places.
export const sessionDisplayName = (session: Session, all: Session[]): string => {
  const sameName = all.filter((s) => s.name === session.name);
  if (sameName.length <= 1) return session.name;
  const suffix = session.id.slice(0, 6);
  return `${session.name} · ${suffix}`;
};

// Map each session id → disambiguated display name in one pass. Caller-side
// memoization: build once per session-list change and look up per-row
// instead of O(n²) per-render recomputation.
export const buildDisplayNameMap = (sessions: Session[]): Map<string, string> => {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const map = new Map<string, string>();
  for (const s of sessions) {
    if ((counts.get(s.name) ?? 0) > 1) {
      map.set(s.id, `${s.name} · ${s.id.slice(0, 6)}`);
    } else {
      map.set(s.id, s.name);
    }
  }
  return map;
};
