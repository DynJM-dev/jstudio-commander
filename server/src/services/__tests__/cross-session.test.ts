import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrossSessionPaneOwner } from '../cross-session.js';

const pmCandidate = (id: string, sessionType: string = 'pm') => ({ id, sessionType });

describe('isCrossSessionPaneOwner — Phase G.1 addendum predicate', () => {
  test('codeman-managed tmux session → NOT flagged', () => {
    // Phase G.1 addendum trigger: codeman-spawned coders live in
    // codeman-* tmux sessions. The Commander prefix filter MUST
    // short-circuit before any DB lookup so these are never healed.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'codeman-03763f99' },
      pmCandidate('some-pm-id'),
      ['coder-self'],
    );
    assert.equal(result, false);
  });

  test('jsc-* pane owned by ANOTHER PM → flagged', () => {
    // The original ovagas-ui case: coder@ovagas-ui pane %51 lives in
    // jsc-e16a1cb2 which the OvaGas PM owns. Coder is not the OvaGas
    // PM, so flagging is correct.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'jsc-e16a1cb2' },
      pmCandidate('e16a1cb2-ovagas-pm'),
      ['coder@ovagas-ui', 'parent-elsewhere'],
    );
    assert.equal(result, true);
  });

  test('jsc-* pane owned by ITS OWN PARENT → NOT flagged', () => {
    // Same-session, not cross-session. A coder whose pane lives inside
    // its parent PM's tmux session is a legitimate sub-pane scenario
    // and must not be dismissed by the heal.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'jsc-parent-pm' },
      pmCandidate('parent-pm-id'),
      ['coder-self', 'parent-pm-id'],
    );
    assert.equal(result, false);
  });

  test('no tmux session found (pane gone) → NOT flagged', () => {
    // Different failure mode: pane disappeared. The status poller
    // handles that path; the cross-session guard must stay silent.
    const result = isCrossSessionPaneOwner(
      { sessionName: null },
      null,
      ['coder-self', 'parent-id'],
    );
    assert.equal(result, false);
  });

  test('jsc-* pane with no owning PM row → NOT flagged', () => {
    // The pane lives in a Commander-managed tmux session, but no
    // session row claims that tmux session as its own (e.g. ghost
    // tmux session left by a deleted PM). No owner means nothing to
    // flag against.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'jsc-orphan-tmux' },
      null,
      ['coder-self'],
    );
    assert.equal(result, false);
  });

  test('jsc-* pane owned by a NON-PM session → NOT flagged', () => {
    // Defense in depth: even if a row claimed the tmux session, only
    // PM rows are valid owners. A raw session sitting on the same
    // tmux name is some other oddity, not a cross-session bug.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'jsc-something' },
      pmCandidate('not-pm', 'raw'),
      ['coder-self'],
    );
    assert.equal(result, false);
  });

  test('null/undefined values in excludeIds are skipped', () => {
    // Callers pass [teammateId, parentId] and parentId may be null
    // for top-level rows. The predicate must tolerate null/undefined
    // entries without short-circuiting incorrectly.
    const result = isCrossSessionPaneOwner(
      { sessionName: 'jsc-e16a1cb2' },
      pmCandidate('e16a1cb2-ovagas-pm'),
      ['coder', null, undefined],
    );
    assert.equal(result, true);
  });
});
