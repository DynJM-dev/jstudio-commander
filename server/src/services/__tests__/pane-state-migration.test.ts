// Phase W — migration from per-PM `split-state.${pmSessionId}` keys
// to the single global `pane-state` row.
//
// The migration MUST:
//   - Preserve visual continuity for users who had an active split.
//     Left = PM id, right = activeTabId (the user's last-viewed
//     teammate), dividerRatio = percent/100 from the legacy shape.
//   - Be idempotent. Running twice is a no-op when pane-state already
//     exists.
//   - Clean up: every `split-state.*` key is deleted after translation
//     so the preferences table doesn't bloat and a future rollback
//     can't re-hydrate a stale layout.
//   - Skip no-op entries: a split-state with `activeTabId: null` means
//     the user never picked a teammate; there's no pair to migrate.
//     Those keys are still deleted (they're dead weight), but no
//     pane-state is written.
//   - Pick deterministically when multiple split-states exist — most
//     recently updated wins (that's the user's latest intent).

import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-pane-migration-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { getDb, closeDb } = await import('../../db/connection.js');
const { preferencesService } = await import('../preferences.service.js');
const { migrateLegacySplitState } = await import('../pane-state-migration.js');
const { PANE_STATE_KEY } = await import('@commander/shared');

describe('Phase W — migrateLegacySplitState', () => {
  before(() => {
    // Force schema init
    getDb();
  });

  beforeEach(() => {
    // Clean slate: wipe preferences between tests.
    getDb().prepare('DELETE FROM preferences').run();
  });

  after(() => {
    closeDb();
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('no legacy keys → no-op, no pane-state written', () => {
    migrateLegacySplitState();
    assert.equal(preferencesService.get(PANE_STATE_KEY), null);
  });

  test('single legacy split-state with activeTabId → writes pane-state and deletes legacy key', () => {
    preferencesService.set('split-state.pm-abc', {
      activeTabId: 'coder-xyz',
      percent: 60,
      minimized: false,
    });

    migrateLegacySplitState();

    assert.deepEqual(preferencesService.get(PANE_STATE_KEY), {
      left: 'pm-abc',
      right: 'coder-xyz',
      dividerRatio: 0.6,
      focusedSessionId: 'coder-xyz',
    });
    assert.equal(preferencesService.get('split-state.pm-abc'), null);
  });

  test('legacy split-state with null activeTabId → delete key, do NOT write pane-state', () => {
    preferencesService.set('split-state.pm-solo', {
      activeTabId: null,
      percent: 50,
      minimized: false,
    });

    migrateLegacySplitState();

    assert.equal(preferencesService.get(PANE_STATE_KEY), null);
    assert.equal(preferencesService.get('split-state.pm-solo'), null);
  });

  test('multiple legacy split-states → picks most-recently-updated, deletes all', () => {
    preferencesService.set('split-state.pm-old', {
      activeTabId: 'coder-old',
      percent: 50,
      minimized: false,
    });
    preferencesService.set('split-state.pm-new', {
      activeTabId: 'coder-new',
      percent: 70,
      minimized: false,
    });
    // datetime('now') is second-resolution; force a clearly-later
    // updated_at so "most recent" is unambiguous.
    getDb().prepare(
      "UPDATE preferences SET updated_at = datetime('now', '+1 hour') WHERE key = 'split-state.pm-new'",
    ).run();

    migrateLegacySplitState();

    const migrated = preferencesService.get(PANE_STATE_KEY) as {
      left: string; right: string; dividerRatio: number; focusedSessionId: string;
    };
    assert.equal(migrated.left, 'pm-new');
    assert.equal(migrated.right, 'coder-new');
    assert.equal(migrated.dividerRatio, 0.7);
    assert.equal(migrated.focusedSessionId, 'coder-new');
    assert.equal(preferencesService.get('split-state.pm-old'), null);
    assert.equal(preferencesService.get('split-state.pm-new'), null);
  });

  test('idempotent: running twice when pane-state already exists → no overwrite', () => {
    preferencesService.set(PANE_STATE_KEY, {
      left: 'user-chosen-a',
      right: 'user-chosen-b',
      dividerRatio: 0.42,
      focusedSessionId: 'user-chosen-a',
    });
    preferencesService.set('split-state.pm-legacy', {
      activeTabId: 'coder-legacy',
      percent: 50,
      minimized: false,
    });

    migrateLegacySplitState();

    // Existing pane-state preserved — do NOT clobber user intent.
    assert.deepEqual(preferencesService.get(PANE_STATE_KEY), {
      left: 'user-chosen-a',
      right: 'user-chosen-b',
      dividerRatio: 0.42,
      focusedSessionId: 'user-chosen-a',
    });
    // Legacy key still cleaned up even when we didn't migrate from it.
    assert.equal(preferencesService.get('split-state.pm-legacy'), null);
  });

  test('clamps out-of-range percent to MIN/MAX divider ratio', () => {
    preferencesService.set('split-state.pm-tight', {
      activeTabId: 'coder',
      percent: 10, // below MIN_DIVIDER_RATIO (30%)
      minimized: false,
    });
    migrateLegacySplitState();
    const low = preferencesService.get(PANE_STATE_KEY) as { dividerRatio: number };
    assert.equal(low.dividerRatio, 0.3);

    // Second scenario: high clamp. Clear and re-seed.
    getDb().prepare('DELETE FROM preferences').run();
    preferencesService.set('split-state.pm-wide', {
      activeTabId: 'coder',
      percent: 95, // above MAX_DIVIDER_RATIO (70%)
      minimized: false,
    });
    migrateLegacySplitState();
    const high = preferencesService.get(PANE_STATE_KEY) as { dividerRatio: number };
    assert.equal(high.dividerRatio, 0.7);
  });

  test('tolerates malformed legacy JSON (missing fields) by skipping that entry', () => {
    preferencesService.set('split-state.pm-broken', {
      // activeTabId absent — shape drift from an old client
      percent: 50,
    } as unknown as { activeTabId: string });
    preferencesService.set('split-state.pm-good', {
      activeTabId: 'coder-good',
      percent: 50,
      minimized: false,
    });

    migrateLegacySplitState();

    // Only the valid entry contributes; broken is dropped.
    const migrated = preferencesService.get(PANE_STATE_KEY) as { left: string; right: string };
    assert.equal(migrated.left, 'pm-good');
    assert.equal(migrated.right, 'coder-good');
    assert.equal(preferencesService.get('split-state.pm-broken'), null);
    assert.equal(preferencesService.get('split-state.pm-good'), null);
  });
});
