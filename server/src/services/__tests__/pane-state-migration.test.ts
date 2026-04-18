// Phase W.2 — pane-state migration covers three shapes:
//   1. already-W2 → no-op
//   2. Phase W (left/right) → drop left, rename right → rightSessionId
//   3. legacy split-state.<pm> → extract activeTabId as rightSessionId
//
// Plus an orthogonal sweep: all split-state.* keys are deleted
// unconditionally after translation (dead schema).

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

type PaneStateWithLegacy = {
  left: string | null;
  right: string | null;
  rightSessionId: string | null;
  dividerRatio: number;
  focusedSessionId: string | null;
};

describe('Phase W.2 — migrateLegacySplitState', () => {
  before(() => { getDb(); });
  beforeEach(() => { getDb().prepare('DELETE FROM preferences').run(); });
  after(() => {
    closeDb();
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('no keys at all → outcome=no-op, no pane-state written', () => {
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'no-op');
    assert.equal(result.migrated, 0);
    assert.equal(preferencesService.get(PANE_STATE_KEY), null);
  });

  test('pane-state already W.2 shape → no-op, preserved', () => {
    preferencesService.set(PANE_STATE_KEY, {
      rightSessionId: 'user-chosen',
      dividerRatio: 0.42,
      focusedSessionId: 'user-chosen',
    });
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'already-w2');
    assert.deepEqual(preferencesService.get(PANE_STATE_KEY), {
      rightSessionId: 'user-chosen',
      dividerRatio: 0.42,
      focusedSessionId: 'user-chosen',
    });
  });

  test('hybrid W.2 + stray legacy left/right fields → stripped to canonical W.2', () => {
    // An older client that was still writing the W shape re-set the
    // preference after the initial migration, producing a hybrid row
    // where `rightSessionId` AND `left/right` coexist. Boot must
    // strip the dead keys so downstream readers can't misinterpret.
    preferencesService.set(PANE_STATE_KEY, {
      left: 'stale-pm',
      right: 'stale-coder',
      rightSessionId: 'canonical-right',
      dividerRatio: 0.5,
      focusedSessionId: 'canonical-right',
    } as unknown as PaneStateWithLegacy);
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'already-w2-stripped');
    const after = preferencesService.get(PANE_STATE_KEY) as Record<string, unknown>;
    assert.equal(after.rightSessionId, 'canonical-right');
    assert.equal(after.focusedSessionId, 'canonical-right');
    assert.equal('left' in after, false);
    assert.equal('right' in after, false);
  });

  test('pane-state in Phase W shape → reshaped to W.2, left dropped', () => {
    preferencesService.set(PANE_STATE_KEY, {
      left: 'pm-id',
      right: 'coder-id',
      dividerRatio: 0.6,
      focusedSessionId: 'coder-id',
    });
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'w-to-w2');
    assert.equal(result.migrated, 1);
    assert.deepEqual(preferencesService.get(PANE_STATE_KEY), {
      rightSessionId: 'coder-id',
      dividerRatio: 0.6,
      focusedSessionId: 'coder-id', // preserved — it was right
    });
  });

  test('Phase W focus pointing at left → dropped (URL-side can\'t be validated at boot)', () => {
    preferencesService.set(PANE_STATE_KEY, {
      left: 'pm-id',
      right: 'coder-id',
      dividerRatio: 0.5,
      focusedSessionId: 'pm-id', // focus was on left
    });
    migrateLegacySplitState();
    const migrated = preferencesService.get(PANE_STATE_KEY) as { focusedSessionId: string | null };
    assert.equal(migrated.focusedSessionId, null);
  });

  test('Phase W right=null (single-pane state) → W.2 with rightSessionId=null', () => {
    preferencesService.set(PANE_STATE_KEY, {
      left: 'pm-id',
      right: null,
      dividerRatio: 0.5,
      focusedSessionId: 'pm-id',
    });
    migrateLegacySplitState();
    const migrated = preferencesService.get(PANE_STATE_KEY) as { rightSessionId: string | null };
    assert.equal(migrated.rightSessionId, null);
  });

  test('legacy split-state.<pm> with activeTabId → W.2 rightSessionId', () => {
    preferencesService.set('split-state.pm-abc', {
      activeTabId: 'coder-xyz',
      percent: 60,
      minimized: false,
    });
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'legacy-to-w2');
    assert.equal(result.migrated, 1);
    assert.deepEqual(preferencesService.get(PANE_STATE_KEY), {
      rightSessionId: 'coder-xyz',
      dividerRatio: 0.6,
      focusedSessionId: 'coder-xyz',
    });
    assert.equal(preferencesService.get('split-state.pm-abc'), null);
  });

  test('legacy split-state with null activeTabId → no write; keys swept', () => {
    preferencesService.set('split-state.pm-solo', {
      activeTabId: null,
      percent: 50,
      minimized: false,
    });
    const result = migrateLegacySplitState();
    assert.equal(result.outcome, 'legacy-all-empty');
    assert.equal(result.migrated, 0);
    assert.equal(preferencesService.get(PANE_STATE_KEY), null);
    assert.equal(preferencesService.get('split-state.pm-solo'), null);
  });

  test('multiple legacy split-states → picks most-recently-updated; all swept', () => {
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
    getDb().prepare(
      "UPDATE preferences SET updated_at = datetime('now', '+1 hour') WHERE key = 'split-state.pm-new'",
    ).run();
    migrateLegacySplitState();
    const migrated = preferencesService.get(PANE_STATE_KEY) as { rightSessionId: string; dividerRatio: number };
    assert.equal(migrated.rightSessionId, 'coder-new');
    assert.equal(migrated.dividerRatio, 0.7);
    assert.equal(preferencesService.get('split-state.pm-old'), null);
    assert.equal(preferencesService.get('split-state.pm-new'), null);
  });

  test('already-W2 still sweeps legacy split-state.* keys (no dangling dead schema)', () => {
    preferencesService.set(PANE_STATE_KEY, {
      rightSessionId: 'user',
      dividerRatio: 0.5,
      focusedSessionId: null,
    });
    preferencesService.set('split-state.pm-legacy', {
      activeTabId: 'coder',
      percent: 50,
      minimized: false,
    });
    migrateLegacySplitState();
    assert.equal(preferencesService.get('split-state.pm-legacy'), null);
  });

  test('malformed legacy JSON → dropped silently, no crash', () => {
    preferencesService.set('split-state.pm-broken', {
      percent: 50, // activeTabId missing
    } as unknown as { activeTabId: string });
    preferencesService.set('split-state.pm-good', {
      activeTabId: 'coder-good',
      percent: 50,
      minimized: false,
    });
    migrateLegacySplitState();
    const migrated = preferencesService.get(PANE_STATE_KEY) as { rightSessionId: string };
    assert.equal(migrated.rightSessionId, 'coder-good');
    assert.equal(preferencesService.get('split-state.pm-broken'), null);
  });

  test('legacy percent clamped out-of-range', () => {
    preferencesService.set('split-state.pm-tight', {
      activeTabId: 'coder',
      percent: 10,
      minimized: false,
    });
    migrateLegacySplitState();
    const m = preferencesService.get(PANE_STATE_KEY) as { dividerRatio: number };
    assert.equal(m.dividerRatio, 0.3);
  });
});
