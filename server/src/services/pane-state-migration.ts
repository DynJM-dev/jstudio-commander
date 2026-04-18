import {
  PANE_STATE_KEY,
  MIN_DIVIDER_RATIO,
  MAX_DIVIDER_RATIO,
  type PaneState,
} from '@commander/shared';
import { getDb } from '../db/connection.js';
import { preferencesService } from './preferences.service.js';

// Phase W / W.2 — one-shot boot migration of chat pane state.
//
// Supports THREE shapes in order of precedence:
//
//  1. Phase W.2 (current canonical):
//       {rightSessionId, dividerRatio, focusedSessionId}
//     If this shape is already present, we DON'T overwrite — user's
//     latest intent wins. But we still sweep the older keys to keep
//     the preferences table tidy.
//
//  2. Phase W (superseded):
//       {left, right, dividerRatio, focusedSessionId}
//     Migrated by dropping `left` (URL owns it now) and keeping
//     `right` as `rightSessionId`. focus is preserved only if it
//     equals `right`; otherwise cleared (URL-side focus can't be
//     validated at server boot).
//
//  3. Pre-Phase W legacy per-PM `split-state.<sessionId>`:
//       {activeTabId, percent, minimized}
//     Migrated by picking the most-recently-updated row with a
//     non-null activeTabId. That session id becomes `rightSessionId`;
//     percent becomes dividerRatio (clamped); focus = activeTabId.
//     No `left` is written — Phase W.2 URL owns left.
//
// All legacy keys (split-state.*) and W-shaped pane-state are cleaned
// up after translation so rollback can't re-hydrate stale UI. Log a
// one-line outcome so boot output makes the migration visible.

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

const isValidLegacySplit = (v: unknown): v is LegacySplitState =>
  typeof v === 'object' &&
  v !== null &&
  'activeTabId' in v &&
  'percent' in v &&
  (typeof (v as { percent: unknown }).percent === 'number');

// Phase W shape: left/right keys present. Detected by the presence
// of `left` or `right` but absence of `rightSessionId`.
const isPhaseW = (v: unknown): v is { left: string | null; right: string | null; dividerRatio: number; focusedSessionId: string | null } => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const hasRightSessionId = 'rightSessionId' in o;
  const hasLegacy = 'left' in o || 'right' in o;
  return hasLegacy && !hasRightSessionId && typeof o.dividerRatio === 'number';
};

const isPhaseW2 = (v: unknown): v is PaneState => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return 'rightSessionId' in o && typeof o.dividerRatio === 'number';
};

export const migrateLegacySplitState = (): { outcome: string; migrated: number; dropped: number } => {
  const db = getDb();
  const existing = preferencesService.get<unknown>(PANE_STATE_KEY);

  let migrated = 0;
  let dropped = 0;
  let outcome = 'no-op';

  // Case 1: already Phase W.2. Nothing to migrate, but if the row
  // carries stray legacy fields (old client re-wrote left/right over
  // the migrated shape), normalize to the canonical W.2 keys only
  // so a future rollback or a new client can't re-hydrate the legacy
  // interpretation.
  if (isPhaseW2(existing)) {
    const o = existing as Record<string, unknown>;
    const hasStrayLegacy = 'left' in o || 'right' in o;
    if (hasStrayLegacy) {
      const clean: PaneState = {
        rightSessionId: (o.rightSessionId as string | null) ?? null,
        dividerRatio: clampRatio(o.dividerRatio as number),
        focusedSessionId: (o.focusedSessionId as string | null) ?? null,
      };
      preferencesService.set(PANE_STATE_KEY, clean);
      outcome = 'already-w2-stripped';
    } else {
      outcome = 'already-w2';
    }
  }
  // Case 2: Phase W shape — reshape in place.
  else if (isPhaseW(existing)) {
    const w = existing as { left: string | null; right: string | null; dividerRatio: number; focusedSessionId: string | null };
    const next: PaneState = {
      rightSessionId: w.right,
      dividerRatio: clampRatio(w.dividerRatio),
      // Focus only survives if it pointed at `right`. If it pointed at
      // `left`, we can't validate at server boot (URL isn't known) —
      // drop it and let the client re-focus on first click.
      focusedSessionId: w.focusedSessionId && w.focusedSessionId === w.right ? w.right : null,
    };
    preferencesService.set(PANE_STATE_KEY, next);
    migrated = 1;
    outcome = 'w-to-w2';
  }
  // Case 3: legacy split-state.* only.
  else {
    const rows = db.prepare(
      `SELECT key, value FROM preferences
       WHERE key LIKE 'split-state.%'
       ORDER BY updated_at DESC`,
    ).all() as Array<{ key: string; value: string }>;

    let chosen: { activeTabId: string; percent: number } | null = null;
    for (const row of rows) {
      let parsed: unknown;
      try { parsed = JSON.parse(row.value); } catch { dropped++; continue; }
      if (!isValidLegacySplit(parsed)) { dropped++; continue; }
      if (parsed.activeTabId === null || typeof parsed.activeTabId !== 'string') { dropped++; continue; }
      if (!chosen) {
        chosen = { activeTabId: parsed.activeTabId, percent: parsed.percent };
      }
    }
    if (chosen) {
      const next: PaneState = {
        rightSessionId: chosen.activeTabId,
        dividerRatio: clampRatio(chosen.percent / 100),
        focusedSessionId: chosen.activeTabId,
      };
      preferencesService.set(PANE_STATE_KEY, next);
      migrated = 1;
      outcome = 'legacy-to-w2';
    } else if (rows.length > 0) {
      outcome = 'legacy-all-empty';
    }
  }

  // Always sweep: split-state.* keys are dead schema regardless of
  // whether we migrated from them. Leaving them risks a rollback
  // re-hydrating the old UI. Count rows for reporting.
  const sweepResult = db.prepare(`DELETE FROM preferences WHERE key LIKE 'split-state.%'`).run();
  const sweptSplitState = (sweepResult.changes as number) || 0;

  console.log(
    `[pane-state] migration: outcome=${outcome} migrated=${migrated} dropped=${dropped} ` +
    `legacyKeysSwept=${sweptSplitState}`,
  );

  return { outcome, migrated, dropped };
};
