import type { Session } from '@commander/shared';

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
