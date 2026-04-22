# N2.1.2 Hotfix Dispatch — Modal Selection Commits

**Dispatch ID:** N2.1.2
**From:** CTO (Claude.ai)
**To:** PM → continuing CODER
**Depends on:** N2.1.1 CLOSED (5/16 smoke), `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0, ARCHITECTURE_SPEC v1.2
**Triggered by:** Jose's N2.1.1 user-facing smoke steps 8+9 failed (selection commit bugs), steps 10-16 blocked (never exercised in prod build).
**Duration:** 0.25-0.5 day continuing CODER at xhigh. Budget $150-300.

---

## §1 — Acceptance criteria (SMOKE_DISCIPLINE.md compliant)

From Jose's Finder-launched `pnpm build:app:debug`:

**1.1 — Path picker selection commits.** Click + New session → click path picker → dropdown opens → click a Projects entry → entry's path populates input field → dropdown closes. Typing in input filters sections; Browse opens native dialog, selected path commits.

**1.2 — Session type dropdown selection commits.** Open session type dropdown → PM/Coder/Raw options visible → click one → that option is selected and displayed.

**1.3 — Full N2.1.1 §3.3 smoke 16/16 passes.** Including steps 10-16 (submit → session spawns → Pane 1 terminal renders → bootstrap injects → OSC 133 fires on first prompt → session in sidebar with live status → + Pane → second session on different project → split view with Cmd+Opt+→/← focus cycle → Cmd+Q → re-launch → both sessions restored with scrollback → Recent section shows both paths at top). Steps 10-16 have never been verified in a production build; they may surface additional latent bugs. If they do, report but don't expand scope — surface for potential N2.1.3.

**1.4 — No N1/N2/N2.1/N2.1.1 regression.** Sidecar reachable, Preferences clean, picker opens and stays open, dropdowns populate from API, CSP holds.

---

## §2 — Tasks

### Task 1 — Diagnose modal selection commits (webview DevTools, empty evidence commit per G10)

Launch `pnpm build:app:debug`. Open DevTools. Reproduce both fail modes.

For path picker: click a Projects entry. Trace via Console + React DevTools: does entry's `onClick` fire? Does it invoke the picker's `onSelect` handler? Does `onSelect` propagate to the form state? Where does the chain break?

PM's hypothesis: Task 3's monotonic `setOpen(true)` is scoped too broadly — likely fires on dropdown-item click and overrides the selection→close transition. Verify or refute with evidence.

For session type dropdown: same diagnosis pattern. This is the first time this dropdown is exercised in production; failure shape may be different from path picker.

Commit diagnostic evidence to `native-v1/docs/diagnostics/N2.1.2-modal-selection-evidence.md` before any fix. **Task 1 completes before Task 2 starts.**

**Effort:** 0.1 day.

### Task 2 — Fix both selection commits

Fix per Task 1 evidence. Both fixes are in `NewSessionModal.tsx` (same file per PM). Likely the same root cause manifesting in two places (setOpen scoping, event propagation, or selection-handler wiring).

Dependency additions (if any) **MUST land in the same commit as the code that imports them**, per G12 (new guardrail — see §3).

**Effort:** 0.1-0.2 day.

### Task 3 — Verify steps 10-16 end-to-end in build:app:debug

After Task 2 lands, CODER launches `pnpm build:app:debug` from Finder, runs steps 1-16 of the N2.1.1 §3.3 smoke as a smoke-readiness exercise (NOT substituting for Jose's user-facing smoke per SMOKE_DISCIPLINE §3.4 — this is CODER verifying the build is in a state where Jose's smoke could pass, not certifying that it will).

Specifically exercise steps 10-16 which have never run in a production build. If new failures surface: report in PHASE_N2.1.2_REPORT §5 and §8, do NOT fix in this dispatch. Scope stays narrow.

**Effort:** 0.05 day.

### Task 4 — PHASE_REPORT + Jose runs user-facing smoke

CODER files PHASE_N2.1.2_REPORT with SMOKE_DISCIPLINE §5 format. §3 user-facing smoke row marked PENDING. Jose runs §3.3 16-step smoke; PM appends outcome.

**Effort:** 0.05 day CODER + ~15 min Jose dogfood.

---

## §3 — New guardrail G12: Dependency declaration hygiene

Any commit that adds `import` statements for a new package MUST also include the matching additions to `package.json` + lockfile in the same commit. Fresh-clone-and-install from any commit in the repo must produce a buildable state.

Precedent: N2.1.1 Task 2 commit d376d50 imported `@fastify/cors` without the dep declarations. PM fixed at 61669f0. This was a silent fresh-clone breakage that wouldn't have surfaced in CODER's existing-workspace testing.

G12 applies from N2.1.2 forward. CODER verifies via `pnpm install --frozen-lockfile` after each dep-touching commit.

---

## §4 — Guardrails (inherited + G12)

Standard 11 guardrails from prior dispatches, plus:

**G12 — Dependency declaration hygiene.** Per §3 above.

Particularly relevant for this dispatch:
- **G10 — Root-cause before fix.** Task 1 evidence commits before Task 2.
- **G11 — Smoke layer naming in diagnostic commits.** "diagnostic: React DevTools shows onSelect handler firing but setValue not propagating (component-state layer)" not "diagnostic: click doesn't work."

---

## §5 — Required reading

1. This dispatch.
2. `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0.
3. `native-v1/docs/phase-reports/PHASE_N2.1.1_REPORT.md` including §3 user-facing smoke outcome.
4. `apps/frontend/src/components/NewSessionModal.tsx` and `apps/frontend/src/components/path-picker/` (the code being fixed).

---

## §6 — Jose's TODO

1. Save this dispatch to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_2_DISPATCH_MODAL_SELECTION_COMMITS.md`.
2. Paste in PM: "N2.1.2 dispatch saved."
3. PM produces paste-to-CODER (including G12 reminder).
4. Continuing CODER executes. ~0.25-0.5 day.
5. Jose runs 16-step smoke per N2.1.1 §3.3.
6. PM appends smoke result to PHASE_N2.1.2_REPORT §3.
7. If 16/16 pass: N2.1.2 closes. Dogfood window begins (3-5 days real use). Then N3 scope decision informed by dogfood.
8. If any step fails: narrow N2.1.3 if scope stays small, escalate if not.

---

**End of dispatch.**
