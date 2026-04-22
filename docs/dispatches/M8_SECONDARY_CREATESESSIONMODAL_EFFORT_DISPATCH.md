# M8 Secondary — CreateSessionModal Effort Override at Spawn

**From:** PM (Commander, 2026-04-20)
**To:** CODER (fresh or continuing — rotation is narrow, either works)
**Type:** CLIENT-ONLY dispatch, single commit, ~30-45 min scope. Closes M8's deferred secondary scope.
**Preceded by:** M8 Primary shipped at `1d33160` (SessionCard click-to-adjust). Secondary deferred per dispatch framing — now landing.
**Status:** Jose-authorized.

---

## Scope framing — even smaller than anticipated

PM-side recon surfaced that `server/src/services/session.service.ts:523` **already accepts `opts.effortLevel` as an override**:

```
const effortLevel: EffortLevel = opts.effortLevel ?? SESSION_TYPE_EFFORT_DEFAULTS[sessionType];
```

Server-side plumbing is in place. No server change needed for M8 Secondary. This rotation is purely client-side:

1. Add an effort selector to `CreateSessionModal.tsx`.
2. Default the selector to the persona default per current session-type selection (`pm→high`, `coder→medium`, `raw→medium`).
3. Reset the selector to new persona default when session type changes.
4. Thread the chosen value through the create payload so it reaches `createSession`'s `opts.effortLevel` parameter.

---

## Scope — in

**Location:** `client/src/components/sessions/CreateSessionModal.tsx` (confirmed via recon — plural `sessions/` directory, NOT `session/`).

**Implementation (contract, not prescriptive):**

- Add UI state for `effortLevel: EffortLevel` alongside the existing sessionType / other modal state.
- Initialize from `SESSION_TYPE_EFFORT_DEFAULTS[initialSessionType]`.
- Add a dropdown/select control — visual style matches the existing SessionCard effort dropdown (from M8 Primary at `effortCard.ts`) and ContextBar effort dropdown. Same 5 levels, same accent palette. Don't invent a new UX.
- On sessionType change: reset `effortLevel` to the new type's `SESSION_TYPE_EFFORT_DEFAULTS` value (don't preserve a cross-type override — user re-chose the session type so default expectations reset).
- Include the `effortLevel` in the create-session payload when the user submits. If the existing submit handler calls `api.post('/sessions', { ...payload, effortLevel })` or similar, extend the payload object with the new field.

**Label in the modal:** match the existing SESSION_TYPE_EFFORT_DEFAULTS info text convention. Something like "Effort level" with a subtitle "Override the default for this session type" (or whatever matches the modal's existing copy style — don't over-invent).

## Scope — out

- **Do NOT modify server-side.** `opts.effortLevel` already works; no changes needed to `session.service.ts`, `session.routes.ts`, or any shared type.
- **Do NOT modify `SESSION_TYPE_EFFORT_DEFAULTS` constants.** Persona defaults stay exactly as they are. The override is payload-level.
- **Do NOT modify M8 Primary surfaces** — SessionCard effort badge (`SessionCard.tsx`, `effortCard.ts`) and ContextBar effort dropdown (`ContextBar.tsx` changeEffort + dropdown) stay untouched. This is a different surface: spawn-time vs adjust-time.
- **Do NOT touch Phase Y surfaces** — `ContextBar.tsx`'s isWorking/label paths, `useToolExecutionState`, `useChat`, `contextBarAction`, `useCodemanDiffLogger`, 15.3-arc guards. ALL untouched. Phase Y parallel-run observation window is still active; don't interfere.
- **Do NOT touch** Phase T (TmuxMirror, usePreference, status-poller mirror tee), M7 (ProjectStateDrawer, useProjectStateMd), Item 3 (usePromptDetection), Candidate 27 surface (startup orphan adoption — that's a separate future dispatch).

If a fix requires touching outside the boundary, STOP and ping PM with MINOR/MAJOR.

---

## Tests

Minimum 3 cases, user-observable DOM contract per OS §20.LL-L10:

1. **Renders correct default per session type.** Mount modal with initial type = `pm` → effort selector shows `high`. Mount with `coder` → shows `medium`. Mount with `raw` → shows `medium`.
2. **Session-type change resets effort.** Start on `pm` (effort = high). Change session type to `coder`. Effort selector snaps to `medium` (coder's default), not stays on high.
3. **Override round-trips through payload.** User picks session type `coder` (default medium), then manually changes effort selector to `xhigh`. Submit. Create-session API call body contains `effortLevel: 'xhigh'`. Mock API, assert on call shape.

Run `pnpm test` + `pnpm typecheck`. Target: current 397 baseline + new tests, all pass, typecheck clean.

---

## File boundaries (strict)

Touch:
- `client/src/components/sessions/CreateSessionModal.tsx` — UI + state + payload threading.
- `client/src/components/sessions/effortCard.ts` — **ONLY IF** extracted helpers there help (e.g., a visual primitive for the dropdown that both SessionCard and CreateSessionModal can share). Default assumption: not touched. If you decide to extract a shared dropdown primitive, flag it as a MINOR deviation in PHASE_REPORT.
- Test file(s) under `client/src/components/sessions/__tests__/` or `client/src/utils/__tests__/` matching existing conventions (the existing `CreateSessionModal-labels.test.ts` is in `utils/__tests__/`, match that location).

Do NOT touch:
- Any server file.
- `SESSION_TYPE_EFFORT_DEFAULTS` at `packages/shared/src/types/session.ts`.
- Any file listed in the out-of-scope section above.

---

## Commit discipline

Single commit: `feat(ui): M8 Secondary — CreateSessionModal effort override at spawn`. Body explains: server-side plumbing was already in place (cite `session.service.ts:523`), rotation was pure client UI addition, three test cases per dispatch §Tests. Reversible via `git revert` if smoke rejects.

---

## Self-dogfood + acceptance gate

Jose browser smoke:

1. Open Create Session modal. Effort selector is visible, shows correct default for the pre-selected session type.
2. Change session type between pm / coder / raw. Effort selector updates to match new type's default.
3. Change session type, then manually override effort to a non-default value. Submit. Spawned session should start with the override effort (verify via SessionCard badge reading the override value, or via ContextBar effort dropdown on the new session).
4. Non-regression: submit a create-session WITHOUT changing the effort selector. New session spawns with persona default exactly as before M8 Secondary. Zero behavior change on the default path.
5. Non-regression: M8 Primary (SessionCard click-to-adjust) still works on the newly-spawned session. ContextBar effort dropdown still works.

Ship NOT claimed green until Jose runs smoke + confirms per the 5 cases.

---

## Rejection triggers

(a) Files outside boundary touched.
(b) Server-side changes — `session.service.ts` already handles the override, any change there is rejection.
(c) `SESSION_TYPE_EFFORT_DEFAULTS` modified.
(d) M8 Primary surfaces (SessionCard, ContextBar effort dropdown) regressed.
(e) Phase Y surfaces touched. The parallel-run observation window is active; disturbing it contaminates the evidence.
(f) Ship-green claim without Jose 5-case smoke.
(g) Speculative-fix on smoke failure — investigate via existing log infrastructure first per `standards/INVESTIGATION_DISCIPLINE.md`.

---

## PHASE_REPORT requirements

1. File diff summary.
2. Confirmation server-side was NOT touched.
3. Test count added (minimum 3).
4. Non-regression declaration — M8 Primary surfaces + Phase Y surfaces + M7 + Phase T + Item 3 all untouched.
5. Explicit "awaiting Jose 5-case browser smoke" gate. No ship-green claim.

---

## Standing reminders

Per `feedback_self_dogfood_applies_to_status_fixes`: CreateSessionModal is visible in Jose's own Commander — self-dogfood is free.

Per `feedback_vite_stale_code`: if HMR misses the new state/component registration, restart dev server.

Per OS §20.LL-L10: unit-green is zero acceptance signal. Jose's click-through is the acceptance.

Go.
