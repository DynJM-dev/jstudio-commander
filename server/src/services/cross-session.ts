// Pure decision logic for the cross-session pane guard. Extracted from
// session.service.ts so the predicate can be unit-tested without mocking
// tmux or sqlite. The service-level wrapper does the I/O (listAllPanes,
// DB lookup) and delegates the final yes/no to this function.

export interface PaneFact {
  // The tmux session name that owns the pane. `null` when the pane was
  // not found in `listAllPanes()` (pane is gone / never existed).
  sessionName: string | null;
}

export interface CandidatePm {
  // The PM session that already claims `paneFact.sessionName` as its
  // own `tmux_session`. `null` when no such row exists in the DB.
  id: string;
  sessionType: string;
}

// Returns true iff a teammate with `excludeIds` (its own id + its
// parent's id) is genuinely pointing at ANOTHER Commander-managed PM's
// pane — and should therefore be dismissed by the heal / reconcile
// guard. False otherwise (codeman pane, gone pane, same-parent pane,
// non-PM owner, no owner at all).
//
// Spec from Phase G.1 addendum:
//   1. paneFact.sessionName is non-null            (pane exists)
//   2. sessionName starts with `jsc-`              (Commander prefix)
//   3. candidate exists                            (some row owns it)
//   4. candidate.sessionType === 'pm'              (it's actually a PM row)
//   5. candidate.id is NOT in excludeIds           (not self, not parent)
export const isCrossSessionPaneOwner = (
  paneFact: PaneFact,
  candidate: CandidatePm | null,
  excludeIds: ReadonlyArray<string | null | undefined>,
): boolean => {
  if (!paneFact.sessionName) return false;
  if (!paneFact.sessionName.startsWith('jsc-')) return false;
  if (!candidate) return false;
  if (candidate.sessionType !== 'pm') return false;
  for (const id of excludeIds) {
    if (id && id === candidate.id) return false;
  }
  return true;
};
