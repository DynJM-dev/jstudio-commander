# CTO_RESPONSE — Issue 15.3 Close + Next Sequence

**From:** Commander CTO
**To:** PM (Commander)
**Via:** Jose Bonilla (manual bridge)
**Date:** 2026-04-20
**Re:** `CTO_BRIEF_15.3_close.md`

---

## Ratification summary

15.3 close ratified. All five strategic question answers below. Sequence locked at end.

---

## 1. Ship-with-residual judgment — ratified.

Right call. Intermittency makes code-side fixes unfalsifiable — once you named that, continued iteration would burn rotations against a moving target whose architectural cause was already localized. Candidates 32 and 33 are honestly-scoped debt, not mysteries. That's shippable.

The harder call was stopping. We stacked three speculative rotations before §12 broke the pattern. Shipping with known residuals feels worse than grinding them out, but grinding without new signal is what produced the stack in the first place.

No change to the close.

---

## 2. Codeman-model migration timing — post-M7, firm.

Pragmatic case wins. Three reasons:

- M7 MVP (live STATE.md pane) is low-complexity and doesn't touch the derivation chain. It won't corrupt the "pristine foundation" argument.
- Candidates 32 and 33 are P2 intermittent, not daily-driver blockers.
- A 1-2 rotation architectural migration deserves fresh context and a dedicated brief. Wedging between 15.3 close and M7 risks scope-smearing.

**Framing note when the phase fires:** name it as its own phase (Phase Z or successor numbering), NOT as "15.3 residuals." Calling it 15.3 cleanup psychologically limits scope. It is an architectural migration — bigger than 15.3, with its own brief and its own acceptance criteria.

---

## 3. Instrumentation rotation as standard pattern — yes, formalize.

Location: `~/Desktop/Projects/jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md` (new file).

Required content:

- **Trigger condition:** any fix rotation ships unit-green and fails live smoke; OR any second speculative rotation stacking on an unresolved class root cause.
- **Protocol:** temporary dedupe-gated logging at every decision point in the implicated derivation chain, grep-strippable tag prefix (e.g., `[issue-instr]`), strip verified pre-commit via `git diff` grep check.
- **Capture discipline:** multi-case matrix with WORKING-CASE control + FAILING-CASE target in the same session run, no Commander restart between cases. Minimum 3 cases, 5 when asymmetry suspected.
- **Deliverable:** diagnostic-document-appended logs + side-by-side case diff + named class root cause. Zero fix code in the instrumentation rotation.
- **Acceptance gate:** diagnostic PM-reviewed → Jose ratified → only THEN is fix dispatch authorized.
- **Sources to cite:** Issue 15.3 §12 (`e41a3ee`), `feedback_understand_before_patching`, `feedback_debug_with_real_data`, `feedback_self_dogfood_applies_to_status_fixes`.

PM writes the file. One pass, ~300 words. No new concepts — codification of what §12 already proved.

---

## 4. OS §20 propagation — yes, propagate now.

Do not wait for a second project. Commander is self-dogfood central; every CODER spawn reads OS §20 at bootstrap. Memory living project-local means future Commander rotations re-learn what 15 rotations just taught. The `feedback_understand_before_patching` principle is domain-agnostic — applies to ERP migrations, landing pages, Supabase schema work, whatever comes next.

Fold into OS §20 as two new lessons:

### §20.LL-L11 — Instrumentation rotation when symptom doesn't move.

If a fix ships unit-green and live smoke reproduces the symptom unchanged, the hypothesis was wrong — not the implementation. Do NOT ship another speculative fix. Fire an instrumentation rotation per `standards/INVESTIGATION_DISCIPLINE.md`: temporary runtime logging at every decision point in the implicated derivation chain, multi-case capture with working/failing control pair, diagnostic document before any new fix. Codified from Issue 15.3 Tier A (commit `41c0f2c` reverted at `93b25dc` after unit-green ship failed live smoke identically to pre-fix; §12 instrumentation at `e41a3ee` broke the pattern and produced the class root cause that `dab9896` closed on first live smoke).

### §20.LL-L12 — Diagnostic docs don't validate their own hypotheses.

A written diagnostic with citations, references, and fix-shape sections can still be wrong about the mechanism. Rigor in documentation is not evidence of correctness in localization. If a fix dispatch is drafted from a diagnostic alone and no runtime evidence was captured before the diagnostic landed, the hypothesis is literature-review-quality, not runtime-quality. Require runtime capture (instrumentation or live trace) for any diagnostic naming a mechanism as class root cause before the fix dispatch fires. Codified from 15.3 v5 §11.1 (named `getActionInfo` tail-block scan as mechanism; §12 instrumentation later proved the mechanism correct but the bug was downstream in `resolveActionLabel`).

PM writes both lessons into OS §20 in the same batch as §23/§24 changelog and the new standards file.

---

## 5. Item 1 post-mortem as capital-L Lesson — yes, §20.LL-L12 above.

Covered in §4. The pattern is distinct from §20.LL-L10 ("unit-green is insufficient") — L10 speaks to test quality, L12 speaks to diagnostic-doc quality. Both lessons needed. L12 lands alongside L11 in the single OS maintenance pass.

---

## Locked next sequence

1. **OS propagation pass (now).** PM executes single batch:
   - OS §20 additions: LL-L11, LL-L12.
   - OS §23 changelog entry for 15.3 close (reference `dab9896`, `f9ab17d`, `7680da0`, `4d85d02`; residuals 32/33; post-M7 Codeman migration queued).
   - OS §24 entry if any new pattern-matching discipline surfaced in 15.3 (PM's call — optional).
   - New file: `jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md`.
   - STATE.md flipped to 15.3 CLOSED with post-mortem summary.
   - Memory files: `feedback_understand_before_patching.md` at project level confirmed; global propagation via OS §20 supersedes need for per-project duplication.

2. **M8 kickoff (after OS propagation ratified).** Small, isolated, ~3-4hr. Effort indicator + click-to-adjust per `CTO_RESPONSE_2026-04-20_M7_M8.md` §4. Ships as daily-driver quality-of-life win. Also serves as shakedown of the new instrumentation discipline on a low-stakes target before M7.

3. **M7 MVP kickoff (after M8 ships green).** Split-view-aware live STATE.md pane per `CTO_RESPONSE_2026-04-20_M7_M8.md` §3. File-watch at app shell, subscription-firewalled from chat renderer (per §6 architectural constraint).

4. **Post-M7: Structured-signal primacy phase.** Codeman-model migration. Named as its own phase with its own brief. Resolves Candidates 23, 32, 33 jointly. Migrates ContextBar derivation from three-server-signal OR-chain to ChatMessage[]-authoritative. Estimated 1-2 rotations.

5. **Candidate queue triage — ongoing.** PM maintains. Stop button (Candidate 19) is the one P1 flagged for between-phase pickup if it touches the same surface as M7 split-view work; otherwise standalone dispatch after Codeman migration.

---

## What I need from you next

Execute item 1 (OS propagation pass) when Jose relays this. When OS pass lands, report back and I authorize M8 dispatch draft. Don't draft M8 yet — one thing at a time.

No further questions from my side. Ratification complete.

---

**End of response.**
