import {
  PANE_STATE_KEY,
  MIN_DIVIDER_RATIO,
  MAX_DIVIDER_RATIO,
  type PaneState,
} from '@commander/shared';
import { getDb } from '../db/connection.js';
import { preferencesService } from './preferences.service.js';

// Phase W — one-shot migration run at server boot. Converts the legacy
// per-PM `split-state.<sessionId>` preferences (stored shape:
// `{activeTabId, percent, minimized}`) into the single global
// `pane-state` row (shape: `{left, right, dividerRatio,
// focusedSessionId}`).
//
// Behavior:
//   - If `pane-state` already exists, do NOT overwrite — the user's
//     current pin intent stays authoritative. Still clean up every
//     `split-state.*` key so they don't accumulate.
//   - Of all legacy entries with a non-null activeTabId, pick the
//     most-recently-updated (user's latest layout intent). Write it
//     as `{left: pmId, right: activeTabId, dividerRatio:
//     percent/100 clamped, focusedSessionId: activeTabId}`.
//   - Entries with `activeTabId: null` (user never picked a
//     teammate) contribute nothing to pane-state but still get
//     deleted — they're dead weight.
//   - Malformed entries (missing activeTabId field, bad JSON) are
//     silently skipped. The migration never crashes boot.

const clampRatio = (ratio: number): number => {
  if (Number.isNaN(ratio)) return 0.5;
  if (ratio < MIN_DIVIDER_RATIO) return MIN_DIVIDER_RATIO;
  if (ratio > MAX_DIVIDER_RATIO) return MAX_DIVIDER_RATIO;
  return ratio;
};

interface LegacySplitState {
  activeTabId: string | null;
  percent: number;
  minimized: boolean;
}

const isValidLegacy = (v: unknown): v is LegacySplitState =>
  typeof v === 'object' &&
  v !== null &&
  'activeTabId' in v &&
  'percent' in v &&
  (typeof (v as { percent: unknown }).percent === 'number');

export const migrateLegacySplitState = (): void => {
  const db = getDb();
  const existing = preferencesService.get<PaneState>(PANE_STATE_KEY);

  const rows = db.prepare(
    `SELECT key, value FROM preferences
     WHERE key LIKE 'split-state.%'
     ORDER BY updated_at DESC`,
  ).all() as Array<{ key: string; value: string }>;

  if (rows.length === 0) return;

  // Find the first row (already ordered by updated_at DESC) that
  // has a valid shape AND a non-null activeTabId. That's the user's
  // latest live pair.
  let chosen: { pmId: string; activeTabId: string; percent: number } | null = null;
  if (!existing) {
    for (const row of rows) {
      let parsed: unknown;
      try { parsed = JSON.parse(row.value); } catch { continue; }
      if (!isValidLegacy(parsed)) continue;
      if (parsed.activeTabId === null || typeof parsed.activeTabId !== 'string') continue;
      const pmId = row.key.slice('split-state.'.length);
      if (!pmId) continue;
      chosen = { pmId, activeTabId: parsed.activeTabId, percent: parsed.percent };
      break;
    }
    if (chosen) {
      const migrated: PaneState = {
        left: chosen.pmId,
        right: chosen.activeTabId,
        dividerRatio: clampRatio(chosen.percent / 100),
        focusedSessionId: chosen.activeTabId,
      };
      preferencesService.set(PANE_STATE_KEY, migrated);
    }
  }

  // Always clean up — once Phase W ships, split-state.* keys are
  // dead schema. Leaving them bloats preferences and risks a future
  // rollback re-hydrating the old UI.
  db.prepare(`DELETE FROM preferences WHERE key LIKE 'split-state.%'`).run();
};
