// Phase M Bundle 2 — context-usage color bands (research §9.5).
//
// Thresholds are from the authoritative research. They encode the
// compact-threshold relationship: green while comfortably below, yellow
// as the conversation warms up, orange when auto-compaction is imminent
// (Claude Code default is 80 %), red when the user should compact now
// or start losing detail. Shared across SessionCard, ContextBar, and
// the split-pane top bar so the color story is one source of truth.

export type ContextBand = 'green' | 'yellow' | 'orange' | 'red' | 'unknown';

export const CTX_GREEN_MAX = 50;
export const CTX_YELLOW_MAX = 79;
export const CTX_ORANGE_MAX = 89;
// Red = 90+ (implicit).

export const bandForPercentage = (pct: number | null | undefined): ContextBand => {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'unknown';
  if (pct < CTX_GREEN_MAX) return 'green';
  if (pct < CTX_YELLOW_MAX + 1) return 'yellow';
  if (pct < CTX_ORANGE_MAX + 1) return 'orange';
  return 'red';
};

// CSS variables defined in index.css; falling back to literal hex for
// the unknown band so the "no tick yet" state renders as a muted bar
// rather than the accent green.
export const bandColor = (band: ContextBand): string => {
  switch (band) {
    case 'green': return 'var(--color-accent)';
    case 'yellow': return 'var(--color-idle)';
    case 'orange': return '#F97316';
    case 'red': return '#EF4444';
    default: return 'var(--color-text-tertiary)';
  }
};

// Ordering used by useContextLowWarning to detect "upward crossings".
// `unknown` slots before `green` — any parse of a real number moves the
// band up, which should NEVER fire a warning because the baseline just
// became known. Downward crossings return a non-negative delta when
// compared this way only if we explicitly flip the sign — the hook does
// that guard itself.
const BAND_ORDER: ContextBand[] = ['unknown', 'green', 'yellow', 'orange', 'red'];

export const bandRank = (band: ContextBand): number => BAND_ORDER.indexOf(band);

// True iff the session crossed UP into a new band worth warning about.
// `green → yellow` is noise; `yellow → orange` warrants a soft prompt,
// `orange → red` warrants a firm one. Never warn on downward crossings
// — post-/compact the context drops back and that's relief, not alarm.
export const isWarningCrossing = (prev: ContextBand, next: ContextBand): boolean => {
  if (prev === next) return false;
  const prevRank = bandRank(prev);
  const nextRank = bandRank(next);
  if (nextRank <= prevRank) return false;
  return next === 'orange' || next === 'red';
};
