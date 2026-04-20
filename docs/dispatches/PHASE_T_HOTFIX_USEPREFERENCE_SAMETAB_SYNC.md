# Phase T Hotfix — `usePreference` Same-Tab Multi-Instance Sync (Fix Z)

**From:** PM (Commander, 2026-04-20)
**To:** CODER (same Phase T session — fresh context carries Phase T investigation forward cleanly)
**Type:** NARROW HOTFIX ROTATION — single commit, single primary file, ~30 min scope.
**Preceded by:** Phase T `e4c66c5` shipped + Jose 8-criterion smoke: 7 green, Case 4 (toggle hide) FAIL.
**Status:** Jose-authorized. Root cause localized at source; not speculative.

---

## Root cause (PM-diagnosed, source-level evidence)

Two peer `useSessionUi(sessionId)` hook instances exist in `PaneContainer.tsx`:

- `PaneHeaderWithMirror` at line 138 — owns the Mirror toggle button's `onClick` wired to its own `ui.toggleMirror`.
- `Pane` at line 158 — owns the `<TmuxMirror />` mount conditional at line 263.

Both route through `usePreference(key, default)` at `client/src/hooks/usePreference.ts`. The module-level `cache: Map<string, unknown>` at line 8 pre-populates on any instance's `update()` call. The WS `preference:changed` listener at lines 43-54 bails at line 49: `if (cache.get(key) === next) return;` — which is intended to prevent cross-tab echo-back from causing no-op re-renders, but also incidentally prevents same-tab peer hook instances from syncing their local state.

**Bug path:**
1. User clicks Mirror toggle → `PaneHeaderWithMirror`'s `update(false)` runs:
   - `cache.set(key, false)` (line 57)
   - `setValue(false)` — own state updated
   - `api.put(...)` persists
2. `Pane`'s hook instance still has stale local state (`mirrorVisible: true`).
3. Server broadcasts `preference:changed`. Both instances' WS listeners fire.
4. `Pane`'s listener hits line 49: `cache.get(key) === false === next` → RETURN. `setValue` never called. State stays stale.
5. Conditional at line 263 evaluates `true && <TmuxMirror />` → mirror stays mounted.

**Cross-tab sync works** (different tab has clean cache). **Same-tab multi-instance sync is broken**. The WS listener was designed to serve this purpose and is inadvertently disabled by the cache guard.

## Fix shape — same-tab pub-sub (Fix Z, locked)

Extend `usePreference` with a module-level subscriber registry so peer hook instances in the same tab sync on every `update()`.

**Contract:**

```ts
// Module-level, alongside the cache:
const subscribers = new Map<string, Set<(value: unknown) => void>>();

// Inside useEffect that subscribes to cache/WS (or a new useEffect):
// Register this instance's setValue callback, unregister on unmount.
useEffect(() => {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  const listener = (v: unknown) => setValue(v as T);
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) subscribers.delete(key);
  };
}, [key]);

// Inside update(), after setValue(next):
const update = useCallback((next: T) => {
  cache.set(key, next);
  setValue(next);
  // Notify peer hook instances in the same tab.
  const peers = subscribers.get(key);
  if (peers) {
    peers.forEach((listener) => {
      // Skip self — already set via setValue above. React bails on
      // same-value setState anyway, so this is belt-and-braces.
      if (listener !== selfListenerRef.current) listener(next);
    });
  }
  writePending.current = api.put(...);
}, [key]);
```

Implementation detail: to skip self-notification, track `selfListenerRef` with `useRef` to the listener callback registered in the effect. Alternatively, pass self through via a sentinel — whichever reads cleaner in CODER's judgment.

**Do NOT modify the existing WS `preference:changed` listener's cache-match guard.** That guard exists to prevent cross-tab echo-back from re-triggering local state on a value the tab already set. It's correct for its purpose. Same-tab sync is an additive path, not a replacement.

## File boundaries (strict)

Touch:
- `client/src/hooks/usePreference.ts` — primary fix per shape above.
- `client/src/hooks/__tests__/usePreference.test.ts` OR a new test file — coverage for same-tab pub-sub behavior.

Do NOT touch:
- `client/src/hooks/useSessionUi.ts` — it's a clean consumer of `usePreference`; bug is one layer down.
- `client/src/pages/PaneContainer.tsx` — the two-hook-instance pattern is valid once `usePreference` syncs correctly.
- `client/src/components/chat/TmuxMirror.tsx` — orthogonal.
- Any other `usePreference` consumer file — the fix is at the hook layer; consumers benefit automatically.
- `client/src/services/ws.ts` or the WS listener wiring — the cross-tab path stays exactly as-is.
- Any server file — same-tab sync is purely client-side.
- Any Phase Y, Item 3, M7/M8 surface.
- Any 15.3-arc file.

If the fix requires touching a file outside these boundaries, STOP and ping PM with MINOR/MAJOR classification.

## Pre-ship grep sweep (CODER executes)

Before committing, grep for all `usePreference` usages across the client tree:

```
grep -rn "usePreference" client/src --include="*.ts" --include="*.tsx"
```

Identify every case where two or more components call `usePreference` with the SAME key. List them in PHASE_REPORT under a `§ Multi-instance consumer audit` section. For each case, one-sentence verdict:

- "Non-regression expected — this multi-instance case was previously broken (stale read) and is now correct." (Most likely verdict.)
- "Requires verification — this consumer was relying on stale-read semantics intentionally for <reason>." (Rare; would flag for PM escalation before shipping.)

Expected findings include at minimum `useSessionUi` (the case we're fixing — PaneHeaderWithMirror + Pane). Others may surface.

## Tests

Minimum 3 new tests covering the same-tab sync contract:

1. **Peer sync on update.** Two `usePreference(key, default)` calls in the same render tree with the same key. Instance A calls `update(newValue)`. Instance B's returned value updates to `newValue` within the render cycle. Assert at the return-value level via test-renderer.

2. **Subscriber cleanup on unmount.** Mount Instance A + Instance B with same key. Unmount Instance B. Verify `subscribers.get(key)` size decreases by 1 (via exported-for-test peek or via behavior: next update only notifies remaining instances). Also verify `subscribers` Map entry is deleted when last instance unmounts — no module-level Map leak.

3. **Different keys stay isolated.** Instance A (`usePreference('key-a')`) and Instance B (`usePreference('key-b')`). Instance A calls update. Instance B's value does NOT change. Cross-key pollution guard.

Non-regression — run the full client suite. Target: current 348 baseline, still 348 (or +3 if new tests count), all pass. Typecheck clean.

If any existing test fails after the fix, STOP. The failing test is either (a) implicitly relying on stale-read semantics which is a genuine regression concern, or (b) the fix implementation has an unintended side-effect. Either way, ping PM before shipping.

## Acceptance gate — Jose live smoke

The one user-observable behavior that proves the fix landed:

**Phase T Case 4 (re-run).** Open any Commander session. Mirror is visible at top of pane (default). Click the Mirror toggle button in the pane header. Mirror hides immediately (zero DOM footprint, no blank space). Hard-reload browser. Mirror stays hidden for that session. Click toggle again. Mirror shows and continues updating.

Secondary: verify Phase T Cases 1, 2, 5, 7, 8 still pass (should be unaffected by a pub-sub fix in `usePreference`, but the non-regression check is cheap).

Also verify: terminal drawer (Cmd+J) still toggles correctly on both panes in split view — this is the stress test for the pub-sub when two Pane instances call `useSessionUi(sessionId-A)` and `useSessionUi(sessionId-B)` with DIFFERENT keys (cross-key isolation test from live behavior).

Also verify: ProjectStateDrawer (Cmd+Shift+S) still toggles — similar cross-key isolation check.

## Commit discipline

Single commit. Message: `fix(ui): usePreference same-tab multi-instance sync (Phase T toggle hotfix)`. Body: explain the root cause (cache-guard defeating WS listener for same-tab peers), cite file:line evidence, describe the pub-sub mechanism, note the multi-instance consumer audit findings.

Never bundle with anything else. Reversible via `git revert` if smoke rejects.

## PHASE_REPORT requirements

Sections:
1. Fix implementation — Map-of-Sets pub-sub with self-notification skip mechanism.
2. File diff summary.
3. Multi-instance consumer audit (§ required).
4. Tests added + non-regression suite pass count.
5. Typecheck clean declaration.
6. Scope adherence: boundaries held.
7. Explicit "awaiting Jose Phase T Case 4 live smoke + cross-key isolation check" gate.
8. Rejection-gate self-audit.

## Rejection triggers

(a) Files outside the boundary touched. The whole point is a one-layer fix.
(b) WS `preference:changed` cache-guard modified. That guard is correct for its cross-tab purpose; do NOT remove it.
(c) Any existing `usePreference` consumer file modified. Consumers benefit automatically from the fix at the hook layer.
(d) New test harness added (jsdom, RTL). If existing test harness can't cover the pub-sub behavior, flag to PM — do NOT add infrastructure in a hotfix rotation.
(e) Ship-green claim without Phase T Case 4 live-smoke declaration.
(f) Speculative-fix-forward if live smoke fails. Per OS §20.LL-L11, instrument first (this time the instrumentation would be small — temporary `[useprefs-instr]` logs in `usePreference.update` + the subscribe effect — but still evidence before patching).

## Sequencing after ship

Jose smokes Case 4. Green → Phase T CLOSED. PM updates STATE.md with Phase T COMPLETE + hotfix commit + multi-instance audit findings. Then folds CTO's Phase Y Amendments 1-5 into held Phase Y dispatch, returns to CTO for one-round fire-ready confirmation.

Red → targeted revert of the hotfix commit only (Phase T core ship at `e4c66c5` stays), instrumentation rotation via `standards/INVESTIGATION_DISCIPLINE.md`.

## Standing reminders

Per `feedback_understand_before_patching` + OS §20.LL-L11/L12: root cause was localized at source level with file:line evidence, not speculation. The fix shape addresses the mechanism. If live smoke reveals the fix doesn't actually close Case 4, that would be a v5-§11.1-style "diagnostic was rigorous but localization was wrong" — instrument before patching further.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own CODER session in Commander has a Mirror toggle. Post-ship, you can click it yourself (or watch Jose do it) as cheapest live-smoke proof.

Go.
