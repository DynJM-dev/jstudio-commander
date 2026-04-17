// Shared palette for teammate-scoped UI (cards, chips, placeholder cards).
// Matches the color names written into ~/.claude/teams/*/config.json so the
// visual identity stays consistent across the chat thread, sidebar, and
// split-pane view. Unknown/missing colors fall back to the accent token so
// inline CSS never receives an unparseable literal.
const TEAMMATE_COLOR_HEX: Record<string, string> = {
  blue: '#3B82F6',
  purple: '#A855F7',
  teal: '#14B8A6',
  green: '#22C55E',
  yellow: '#EAB308',
  red: '#EF4444',
  orange: '#F97316',
  pink: '#EC4899',
  cyan: '#06B6D4',
};

export const resolveTeammateColor = (raw: string | undefined | null): string => {
  if (!raw) return 'var(--color-accent)';
  const key = raw.toLowerCase();
  if (TEAMMATE_COLOR_HEX[key]) return TEAMMATE_COLOR_HEX[key]!;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  return 'var(--color-accent)';
};
