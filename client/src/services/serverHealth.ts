// Module-level flag toggled by HealthBanner when the server health beacon
// goes silent. Code paths that don't have access to React context (like
// `api.ts`) read it via `getIsServerDown()` to suppress error toasts during
// expected dev-restart blips.

let serverDown = false;
const listeners = new Set<(down: boolean) => void>();

export const setIsServerDown = (down: boolean): void => {
  if (down === serverDown) return;
  serverDown = down;
  for (const fn of listeners) fn(down);
};

export const getIsServerDown = (): boolean => serverDown;

export const onServerDownChange = (fn: (down: boolean) => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
