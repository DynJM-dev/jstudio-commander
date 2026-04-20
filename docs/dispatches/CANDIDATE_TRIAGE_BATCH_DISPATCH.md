# Candidate Triage Batch — Dispatch

**From:** PM (Commander, 2026-04-20)
**To:** CODER (continuing post-15.3 close)
**Type:** TRIAGE + EXECUTE — walk through every open candidate and open queue item, make a go/no-go call per item, execute cleanly if go, log reasoning if no-go or investigate-more. One commit per executed candidate, maximum reversibility.
**Preceded by:** 15.3 thread CLOSED at `c34b278`. Test suite 310/310 pass.
**Deliverable:** `docs/reports/CANDIDATE_TRIAGE_REPORT_2026-04-20.md` + N commits (one per executed candidate).

---

## Operating principles (read before touching anything)

**Principle 1 — Nothing that breaks existing progress.** Each candidate execution is a single reversible commit. If a commit would risk regressing any existing behavior (15.3 state machinery, approval modal, Plan widget, Candidate 22 close, Item 3 cadence, §6.1/§6.2/§6.3/§6.1.1/§6.4, Fix 1/2, Option 4, Option 2, Activity-gap), do NOT ship. Log as "declined — regression risk" in the triage report.

**Principle 2 — Verify 100% before fix.** For each candidate, you must be able to articulate: (a) exactly what bug is observed, (b) exactly what mechanism produces it, (c) exactly what the fix changes, (d) exactly what observable proof confirms the fix worked. If any of these four are speculation rather than evidence, the candidate is "investigate-more" not "fix."

**Principle 3 — Certainty of improvement.** A candidate ships only if the fix is provably an improvement. "Probably better," "cleaner code," or "matches pattern" are not sufficient. The fix must remove observable friction or correct observable wrongness.

**Principle 4 — Investigate-first default.** When in doubt, the default is investigate-more. A one-paragraph note in the triage report explaining why investigation is needed is a valid deliverable. Do not fix-forward under uncertainty. This is the discipline that broke the 3-rotation pattern on 15.3 (see `feedback_understand_before_patching`).

**Principle 5 — One commit per candidate.** Each executed candidate gets its own commit. If a candidate needs changes across multiple files, one commit covers them all. Do NOT bundle two candidates into one commit — that destroys reversibility.

**Principle 6 — HARD EXCLUSIONS.** Do NOT touch these in this rotation under any circumstances:
- Candidate 23 (Claude Code runtime `contextLimit`) — architecture family, post-M7 rotation.
- Candidate 32 (Case 3 activity-missing on multi-step tools) — 15.3 residual, Codeman-model family, post-M7.
- Candidate 33 (Case 5 60s stuck trailing edge) — 15.3 residual, Codeman-model family, post-M7.
- Any M5 / M7 / M8 migration work.
- `session.status` pane classifier logic server-side (the architectural rework these three share).

These are explicitly deferred. If during triage you find a candidate's fix would touch any of these surfaces, that candidate becomes "declined — deferred to Codeman-model rotation."

---

## Deliverable format — TRIAGE_REPORT

Create `docs/reports/CANDIDATE_TRIAGE_REPORT_2026-04-20.md` with one section per candidate below, in the order listed. Each section has four subsections:

1. **Verdict.** One of: SHIPPED (commit SHA), DECLINED (with reason), INVESTIGATE-MORE (with specific question that must be answered first).
2. **Evidence.** What you observed in the codebase or at runtime that informs the verdict.
3. **Fix shape (if SHIPPED).** What the commit changed, file:line, and why this fix satisfies Principle 2.
4. **Proof (if SHIPPED).** How the fix was verified (test, grep, runtime observation).

---

## Candidate 19 — Stop button cross-pane (P1 functional)

**Context:** Split view with two sessions; clicking the Stop button in one pane can interrupt the session in the OTHER pane. Destructive risk. Separate class from 15.3 — this is UI routing, not classifier.

**PM pre-triage read:** Investigate the Stop-button onClick handler in whichever component renders it (likely `ChatInput` or a header button). Trace which session ID the Stop call uses. If the handler reads a global or parent state that's pane-id-agnostic, that's the bug. Fix: route Stop through the pane's own session context, not a shared-parent state.

**File boundary if executing:** Stop-button component + its direct parent. Do NOT touch session lifecycle server-side.

**Your call:** If you can pinpoint the routing bug and verify the fix with a unit test that asserts stop(sessionA) does NOT interrupt sessionB, SHIP. Otherwise INVESTIGATE-MORE with a specific log capture plan.

---

## Candidate 24 — /compact prompt text reappears in input buffer (P2 visual)

**Context:** After `/compact` completes and the user interacts further, the `/compact` literal text reappears in the chat input box as if it were last-sent. Visual glitch, not functional.

**PM pre-triage read:** Chat input state management post-compact. Likely a prior-send-buffer (maybe `lastSubmittedText` or similar) that isn't cleared on `compact_boundary` system-event arrival. Grep for `lastSubmitted`, the `compact_boundary` handler, and input-component state clears.

**File boundary if executing:** Chat input component + wherever input state resets on system events. Do NOT touch compact processing logic or the `compact_boundary` event itself.

**Your call:** Verify the exact reappearance mechanism first (what state is holding the text, what event should clear it). If the fix is adding a single clear on `compact_boundary`, SHIP. If it turns out the reappearance is actually the browser's autocomplete, that's not a Commander bug — DECLINE.

---

## Candidate 26 — `token_usage` table growth rate audit (P2 data)

**Context:** Jose observed 9,761 rows across 5 active sessions, ~1,950 rows per session. Heartbeat pattern, not session-lifecycle. Separate from Issue 13 retention.

**PM pre-triage read:** This is an AUDIT, not a fix. Grep for the `token_usage` insert path, identify the cadence driver (poller tick, hook event, manual), calculate projected growth at 30/90/365 days across N active sessions. Propose a retention policy or aggregation strategy.

**File boundary if executing:** This is READ-ONLY investigation. Write the audit findings to the triage report. Any actual retention migration is a separate dispatch.

**Your call:** DECLINE execution (audit is the deliverable), log findings in triage report.

---

## Candidate 27 — `recovered-jsc-*` placeholder sessions (investigation)

**Context:** Spawn-path produces placeholder sessions that never promote to real sessions. Issue 6-ish territory — bind-watcher / recovery-path boundary bug. 4 such rows observed in a recent purge batch. Jose flagged: worth understanding the mechanism before dispatch.

**PM pre-triage read:** Grep for `recovered-jsc` or the placeholder-session spawn path. Identify which code path writes these rows and why reconciliation to a real `claude_session_id` fails. This is an INVESTIGATE-MORE candidate by nature — the fix direction isn't known yet.

**File boundary:** Read-only investigation in this rotation.

**Your call:** INVESTIGATE-MORE. Document the spawn path, the bind-watcher code, and propose at least one hypothesis for the promotion failure. Actual fix is a separate dispatch.

---

## Candidate 28 — Empty `commander.db` at repo root (P3 hygiene)

**Context:** File `~/Desktop/Projects/jstudio-commander/commander.db` exists at 0 bytes. Real DB is at `~/.jstudio-commander/commander.db`. Something creates the empty file at repo root.

**PM pre-triage read:** Grep for the literal string `commander.db` across the codebase. Likely candidates: (a) a test runner using a default relative path, (b) a dev script opening a connection with a bare filename, (c) a path-resolution bug with missing tilde expansion. Two options: fix the path resolution OR add `commander.db` to `.gitignore` if the empty file is a benign side effect of some tooling that doesn't need fixing.

**File boundary if executing:** Wherever the empty-file-create happens, plus potentially `.gitignore`.

**Your call:** If the root cause is a single-line bug (bare-filename connection string where it should use the resolved path), SHIP the one-line fix. If the empty file is a benign dev-script artifact and the root cause would require touching many files, SHIP a `.gitignore` entry instead (line: `/commander.db` at repo root) and DECLINE the path-resolution fix as over-scope.

---

## Candidate 29 — `task_reminder` renderer-registry audit (P2 polish)

**Context:** Commander's typed-renderer set (post-Issue 7.1 `abbbbb3`) has 8 registered attachment types. `task_reminder` event type observed in transcript but no registered renderer — likely falls through to generic attachment chip or silently drops. Candidate scope: (1) add `task_reminder` renderer; (2) audit full Claude Code event-type catalog against Commander's registered set; (3) catalog unregistered types + decide per-type whether to register, generic-fallback, or suppress.

**PM pre-triage read:** Read the renderer-registry file (`event-policy.ts` per OS §23). List all typed renderers currently. Grep transcript files for attachment types actually emitted in recent sessions. Enumerate the gap. Decide per-type.

**File boundary if executing:** `event-policy.ts` renderer registry + any new chip components for newly-registered types. Do NOT touch the JSONL parser or server-side emit code.

**Your call:** Scope-check. If the audit reveals 1–2 missing renderers that are trivial to add (pure visual component, no business logic), SHIP. If the gap is 5+ types or requires complex chip logic, SHIP only `task_reminder` specifically (the named one) and log the rest as a follow-up dispatch. If `task_reminder` itself turns out to be server-only / never reaches client, DECLINE and update the candidate note.

---

## Candidate 30 — Markdown visual parity with VSCode Claude (P2 UX)

**Context:** Commander's assistant-message markdown renderer produces visibly lower-quality output than VSCode Claude. CTO acceptance bar. Audit scope: section hierarchy, list typography, nested lists, inline code, code blocks, tables, blockquotes, emoji treatment, paragraph spacing, links, bold/italic contrast.

**PM pre-triage read:** This is a LARGE candidate with many sub-axes. Principle 5 says one-commit-per-candidate — that would either mean one enormous commit across the whole render pipeline, or fragmenting the candidate. Per sequencing in STATE, this was queued post-15.3 + after M7/M8, so it's not urgent. Principle 3 says "certainty of improvement" — without a concrete side-by-side screenshot and per-axis gap enumeration, we can't verify the fix is complete.

**File boundary if executing:** `client/src/utils/text-renderer.tsx`, `tailwind.config`/`@theme` block, possibly `package.json` for `@tailwindcss/typography` install.

**Your call:** DECLINE full execution this rotation per scope size. Optionally SHIP one-line improvements that are unambiguous wins (e.g., install `@tailwindcss/typography` with default prose classes IF it doesn't change existing markdown rendering in a breakable way). Log the full audit as a formal follow-up dispatch scope.

---

## Candidate 31 — §6.1.1 integration test orphan `.disabled` (P3 hygiene)

**Context:** File `client/src/utils/__tests__/ContextBar-6.1.1-integration.test.ts.disabled` committed as disabled at `c34b278`. Imports `getActionInfo` re-export that only existed under Item 1 (reverted). Test is valid in spirit but dead under current HEAD.

**PM pre-triage read:** Option A: restore by re-adding the `export` to `getActionInfo` in `ContextBar.tsx` + rename the file back to `.test.ts`. Currently `getActionInfo` IS exported per Tier A Fix 1 commit `dab9896` MINOR deviation (CODER added exports for test infrastructure). So the restore MIGHT just work. Option B: rewrite the test to cover the same contract via the current exported helpers without relying on the orphan's specific shape. Option C: leave disabled as tech debt.

**File boundary if executing:** Just the rename + potentially a small fixup to the test file if the import needs adjustment.

**Your call:** Try Option A first — rename `.disabled` back to `.test.ts`, run the test, see if it passes. If yes, SHIP. If no (imports broken differently than expected), DECLINE Option A and log for a later rewrite rotation. Do NOT do Option B (test rewrite) this rotation — that's a larger scope.

---

## Non-candidate queue items

### Issue 13.1 — Schema cascade migration

**Context:** Four FK gaps confirmed by 6,799 orphan rows across a recent manual purge. Tables: `session_ticks` (no FK), `cost_entries` (SET NULL), `skill_usage` (SET NULL), `notifications` (SET NULL). Fix: flip SET NULL → CASCADE, add FK where missing.

**PM pre-triage read:** This is a DATABASE MIGRATION — touches schema, needs a migration file, affects production data semantics if any. Principle 1 says "nothing that breaks existing progress." A schema migration is a bigger surface than a client-side patch.

**Your call:** DECLINE. This warrants its own dedicated rotation with a proper migration design, rollback path, and smoke-test plan. Do NOT execute as part of this triage batch. Log as "deferred — separate dispatch warranted."

### Issue 17 — Polish batch

**Context:** `scheduled_task_fire` + `task_reminder` + Archived Sessions view + retention 30→20.

**Your call:** DECLINE as a batch. Individual sub-items may be individually candidate-worthy; consider after this triage. Do NOT batch-execute in this rotation.

### Issue 18 — Delete Archived Sessions (status unknown)

**Context:** Previous coder-16 may have shipped mid-rotation or shut down pre-ship. Reconciliation task never ran.

**PM pre-triage read:** Run `git log --all --oneline | grep -iE "issue.18|delete.archived|archived.session"` across all branches. Inspect `commander.db` `sessions` table for stopped-and-hidden rows matching the feature's DB surface. This is a RECONCILIATION task — READ-ONLY.

**Your call:** Execute the reconciliation. Log findings in the triage report. If Issue 18 is unshipped, note the residual scope for a future dispatch. If it's shipped but undocumented, note which commit.

### 15.1-F — Pre-restart subscription reinit gap

**Context:** Pre-restart sessions don't benefit from post-restart classifier fixes until closed + respawned. Workaround exists.

**Your call:** DECLINE. 15.3 closed; 15.1-F is narrow and workaround-ed. Not in scope for this triage batch.

### 15.4 — Idle-label semantics

**Context:** Some absorbed by 15.3's typed Idle subtypes. Status bar migration to richer Idle labels was Phase 4 scope.

**Your call:** DECLINE. 15.3 closed with residuals accepted; 15.4 is Phase-4 polish that goes with the Codeman-model architectural rotation.

---

## Hard exclusions (from Principle 6, restated)

CODER must NOT execute on:
- Candidate 20 (already RESOLVED by 15.3 Phase 1).
- Candidate 21 (already RESOLVED by 15.3 Phase 1).
- Candidate 22 (already SHIPPED at `c78e238`).
- Candidate 23 (post-M7 architecture-family).
- Candidate 32 (post-M7 architecture-family).
- Candidate 33 (post-M7 architecture-family).
- Any M5 / M7 / M8 migration work.
- Any `session.status` pane-classifier logic.

If a candidate's fix direction would require touching any of these, decline that candidate and note the dependency.

---

## Commit discipline

One commit per executed candidate. Commit message format:
```
fix(ui|db|hygiene): Candidate NN — short description

<body explaining what changed, why, and the proof this is an improvement>
```

Order commits in the order they're executed. Update the triage report as each commit lands so the report's SHIPPED entries carry SHA references.

If any executed commit breaks the test suite, REVERT it immediately, convert the verdict to INVESTIGATE-MORE, and continue with the next candidate. Do NOT leave a red test suite at end of rotation.

---

## Rejection triggers

(a) Principle 6 violation — touching an excluded surface.
(b) Principle 5 violation — bundling multiple candidates in one commit.
(c) Principle 1 violation — shipping a fix that regresses any existing test.
(d) Any "SHIPPED" verdict in the triage report without a commit SHA.
(e) Any "SHIPPED" verdict whose Proof subsection is "tests pass" without a user-observable or grep-observable demonstration.
(f) DECLINING everything without specific reasons (at least some candidates should SHIP — the queue was curated to have executable wins).
(g) SHIPPING everything without specific evidence — if all 8 executable candidates SHIP cleanly, that's suspicious; double-check Principle 2 on each.

---

## End-of-rotation deliverable

At end of rotation:
1. `docs/reports/CANDIDATE_TRIAGE_REPORT_2026-04-20.md` exists and has one section per candidate.
2. `git log` shows one commit per SHIPPED candidate, each on top of `c34b278`.
3. Full test suite passes at `pnpm test` + `pnpm typecheck`.
4. No working-tree modifications outside what's been committed (no leftover unstaged changes).
5. PHASE_REPORT posted summarizing: N executed, N declined, N investigate-more, SHAs listed, any blockers surfaced.

PM reviews PHASE_REPORT against Rejection triggers + Principle audits.

---

## Standing reminders

Per `feedback_understand_before_patching`: investigate-more is a valid verdict. Do not fix-forward under uncertainty.

Per `feedback_debug_with_real_data`: evidence at the runtime level, not inferred from source.

Per `feedback_self_dogfood_applies_to_status_fixes`: for any ship that affects visible UI, your own Commander session is the smoke test.

Per §20.LL-L10: unit-green is zero acceptance signal. User-observable demonstration is the Proof subsection's requirement.

Go.
