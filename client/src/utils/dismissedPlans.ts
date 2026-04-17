// Plan dismissals — persistent across reloads so an X-close doesn't get
// re-surfaced on every page navigation or server restart.
//
// Storage: localStorage['jsc-plan-dismissed'] = JSON array of planKey
// strings (message ids that anchor a plan's first TaskCreate). Cap at
// DISMISSED_MAX entries; FIFO eviction keeps writes cheap and avoids
// unbounded growth for heavy users who plow through dozens of plans.

const STORAGE_KEY = 'jsc-plan-dismissed';
const DISMISSED_MAX = 50;

const read = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const write = (keys: string[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // quota / private-mode — silently drop, dismissal just won't persist
  }
};

export const isDismissed = (planKey: string): boolean => read().includes(planKey);

export const dismiss = (planKey: string): void => {
  const current = read();
  if (current.includes(planKey)) return;
  const next = [...current, planKey];
  // FIFO cap — oldest dismissals drop first so the most recent stay sticky.
  const trimmed = next.length > DISMISSED_MAX ? next.slice(next.length - DISMISSED_MAX) : next;
  write(trimmed);
};

export const clearDismissed = (): void => write([]);
