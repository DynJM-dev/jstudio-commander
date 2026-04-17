// Phase O — coloring for the HeaderStatsWidget chips.
//
// CPU and rate-limit (5h / 7d) chips reuse the same band math as
// context-usage (green/yellow/orange/red at 50/80/90) because the UX
// story is identical — "how much of this budget have you used".
// Memory has different thresholds because OS memory pressure hits
// earlier than Claude's context budget: 70/90 for yellow/red with no
// orange band.
//
// Pure helpers; the widget wraps band → CSS var via bandColor from
// contextBands, so colors stay one source of truth.

import type { ContextBand } from './contextBands';

export const bandForBudget = (pct: number | null | undefined): ContextBand => {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'unknown';
  if (pct < 50) return 'green';
  if (pct < 80) return 'yellow';
  if (pct < 90) return 'orange';
  return 'red';
};

// Memory uses a tighter-at-the-top palette — yellow at 70, red at 90,
// no orange tier. Matches the "OS swap pressure" tooltip story on
// tools like htop where 90%+ consistently means actual trouble.
export const bandForMemory = (pct: number | null | undefined): ContextBand => {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'unknown';
  if (pct < 70) return 'green';
  if (pct < 90) return 'yellow';
  return 'red';
};

// Mem bytes → "12.3 GB" / "820 MB" / etc. Two-decimal precision at the
// GB tier so 32GB hosts show realistic 12.34 readings rather than "12 GB".
export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
