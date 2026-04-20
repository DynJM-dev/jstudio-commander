# M5 Dispatch — Batch 1 (Heavy Projects)

> **For:** Claude Code Coder session (fresh session, default cwd)
> **From:** CTO via Jose
> **Model/effort:** Sonnet 4.6 / medium (escalate to Opus if unexpected complexity surfaces)
> **Estimated duration:** 2-3 hours total (agency ~90 min, elementti ~60 min)
> **Reference:** `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (authoritative procedure)

---

## 1. Context

M5 is the batch phase of per-project migration to canonical Architecture v2 structure. M4 pilot (JLP Family Office) validated the checklist cleanly — 7 atomic commits, 18 decisions extracted from brain files, 66% STATE.md trim, zero deviations from the 9-step procedure.

Batch 1 targets the two heaviest projects because they benefit most from early attention and carry the most accumulated content to reconcile:

1. **jstudio-agency** — explicitly deferred from M3.6v2 with three known content issues (HANDOFF.md 70KB, STATE.md 167KB, no canonical CLAUDE.md)
2. **elementti-ERP** — active production ERP, likely heavy docs

Remaining 6 projects split across batches 2 and 3 in separate dispatches.

## 2. Scope

For each of the two projects, execute the 9-step per-project migration procedure at `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md`. Treat both as **full migration** (both are active projects shipping phases).

Process them sequentially: agency first (fully ship), then elementti. Do NOT interleave.

---

## 3. Project-specific guidance

### 3.1 jstudio-agency

**Path:** `~/Desktop/Projects/jstudio-agency/`
**Project type (for CLAUDE.md declaration):** Landing page (brand-fit marketing site, Firebase-hosted)
**Applicable standards file:** `~/Desktop/Projects/jstudio-meta/standards/LANDING_STANDARDS.md`

**Known pre-flight state** (from M3.6v2 side-observations):
- Git repo: YES (has `.git`, last touched during M3.6v2 rename and relocation commits)
- `HANDOFF.md` exists at ~70KB — this is agency's existing master plan
- `PROJECT_DOCUMENTATION.md` also exists at ~4.5KB — likely stub from early setup
- `STATE.md` exists at ~167KB — 80+x over canonical target, needs aggressive trim
- No canonical `CLAUDE.md` at project root yet
- No `DECISIONS.md` yet

**Specific considerations:**

**(a) PROJECT_DOCUMENTATION.md reconciliation.** The 70KB HANDOFF.md and 4.5KB PROJECT_DOCUMENTATION.md likely describe the same project at different times. Read both before deciding the merge strategy. Probable approach:
- HANDOFF.md is the substantive content (70KB)
- Existing PROJECT_DOCUMENTATION.md is a stub to overwrite
- Rename HANDOFF.md → PROJECT_DOCUMENTATION.md (after archiving the stub)
- Restructure to canonical 12-section format

**Check-in #1 expected:** After reading both files, show Jose the proposed merge approach before executing. Same pattern as M4 Check-in #2.

**(b) STATE.md aggressive trim.** From 167KB to canonical target (<1500 words, ~5-10KB). This is a ~95% reduction — far beyond the 50% threshold that triggers Jose checkpoint in the standard checklist. Expect **Check-in #2** to happen here.

Recommended trim approach:
- Preserve current phase, immediate next action, recent 7-day activity
- Preserve active tech debt tracker, open threads, parked questions
- Move everything else to `docs/archive/phase-reports/` split by phase range or by date cluster
- Keep absolute last known-good checkpoint detail (e.g., last deploy, last milestone)

**(c) Archive strategy.** Expected archive-worthy files:
- `AUDIT_PLAN.md` — planning artifact from March
- `MOBILE_PLAN.md` — planning artifact from March
- Existing `PROJECT_DOCUMENTATION.md` stub (if overwritten by HANDOFF content)
- Any CTO_BRIEF-era files if present

Archive to `docs/archive/2026-04-19-pre-canonical/` per the M4 pattern.

**(d) CLAUDE.md project type.** Declare as Landing page. Reference LANDING_STANDARDS.md for standards pointer.

**(e) Known deferrals from M3.6v2 that batch-1 RESOLVES:**
- ✅ HANDOFF.md → PROJECT_DOCUMENTATION.md reconciliation
- ✅ 167KB STATE.md trim
- ✅ Canonical CLAUDE.md creation

Close the M3.6v2 deferral loop by mentioning completion in the PHASE_REPORT.

---

### 3.2 elementti-ERP

**Path:** `~/Desktop/Projects/elementti-ERP/`
**Project type (for CLAUDE.md declaration):** ERP
**Applicable standards file:** The OS itself (ERP patterns are the JStudio default, no separate standards file per v1.2 §25.3)

**Known pre-flight state:** CTO hasn't done recon on this folder. You'll discover the state in Step 1.

**Specific considerations:**

**(a) Likely content-rich.** Elementti is an active production ERP (per CTO memory: construction industry, dual-entity billing, multi-tenant, DGII-compliant). Expect substantial existing docs: PM_HANDOFF, possibly brain files, phase reports, decisions sprinkled through various docs.

Apply the same extract-before-archive pattern from M4 for any brain files: scan for decisions before moving to archive.

**(b) No landing-style tilt.** Elementti is an ERP, so CLAUDE.md follows the standard JStudio-default stack. No project-type standards file reference beyond the OS itself.

**(c) DGII compliance is mandatory.** When writing the new PROJECT_DOCUMENTATION.md §7 (Integrations), confirm NCF types, ITBIS handling, and any DGII-specific patterns from the existing content. Don't invent these — extract from existing docs.

**(d) Expect a Check-in on PROJECT_DOCUMENTATION.md structure.** Same as M4 and agency — if the existing master plan is substantial (>20KB), show the proposed restructure to Jose before committing.

---

## 4. Execution order

Process agency fully, then elementti. Per-project, follow the 9-step checklist:

For **each** project (agency, then elementti):

- **Step 0** — Confirm full-migration category (both are active, so yes)
- **Step 1** — Audit current state (list every top-level file, size, purpose)
- **Step 2** — Git snapshot tag `pre-m5-snapshot` in the project repo
- **Step 3** — Rename non-canonical files (HANDOFF → PROJECT_DOCUMENTATION)
- **Step 4** — Create missing canonical files from templates
- **Step 5** — Fill canonical files with real content
  - CLAUDE.md (thin, <2500 words, project-specific)
  - PROJECT_DOCUMENTATION.md (CHECK-IN for structure approval if existing is >20KB)
  - STATE.md (CHECK-IN if trim removes >50% content)
  - DECISIONS.md (seed from any brain files + historical docs)
- **Step 6** — Archive stale files to `docs/archive/2026-04-19-pre-canonical/`
- **Step 7** — Validate migrated structure (typecheck, build if applicable)
- **Step 8** — Log the migration — edit `~/Desktop/Projects/jstudio-meta/MIGRATION_STATE.md` (do NOT commit cross-repo; leave for Jose per M4 pattern)
- **Step 9** — Commit per-project changes with atomic, semantically-distinct commits (M4 pattern: each commit is one logical change)

Only after agency's Step 9 is clean and pushed, start agency's fresh-session validation (Step 7 in the checklist), then move to elementti.

---

## 5. Scope boundaries (explicit)

**Do NOT:**
- Modify project code, configs, migrations, or tests — docs only (same as M4)
- Touch the `.git` directory, force-push, or rewrite history
- Delete anything — archive instead
- Migrate any of the other 6 projects (those are batches 2 and 3)
- Rename any folder — filesystem names stay as-is (elementti-ERP stays `elementti-ERP`, agency stays `jstudio-agency`)
- Aggressively trim STATE.md without Jose approval at the >50% checkpoint
- Rewrite PROJECT_DOCUMENTATION.md without Jose approval if existing content is >20KB

**Do (autonomously):**
- File categorization (OPS vs keep vs archive) when answer is clear
- Stale path fixes (any `jstudio-master/` references → `jstudio-core/`, any `JSTUDIO/` → `jstudio-meta/`)
- `.DS_Store` removal
- Conventional commit messages
- Git operations inside the project repo
- Small adjacent improvements per v3 Coder persona §6 (stale script names, typos, etc.), committed separately

---

## 6. Check-ins expected

Four check-ins across the two projects (two each):

**Agency Check-in #1:** PROJECT_DOCUMENTATION.md merge strategy (HANDOFF 70KB + stub 4.5KB reconciliation approach)
**Agency Check-in #2:** STATE.md trim approach (167KB → canonical, ~95% reduction)
**Elementti Check-in #1:** PROJECT_DOCUMENTATION.md structure (if existing master plan >20KB)
**Elementti Check-in #2:** STATE.md trim (if trim removes >50% — likely but not certain)

No other check-ins expected. Proceed autonomously for everything else.

---

## 7. Expected PHASE_REPORT

At completion of BOTH projects, produce one combined PHASE_REPORT per template at `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`. Include:

**Per-project sections:**
- Files renamed, created, archived (counts + names)
- Decisions extracted into DECISIONS.md (count + one-line summary each)
- STATE.md before/after size
- PROJECT_DOCUMENTATION.md before/after size + what dropped/added
- Commit log (atomic commits with hashes + messages)
- Validation results (typecheck, build)

**Combined sections:**
- Total migration runtime
- Any deviations from the checklist (additions or skips)
- Patterns observed across both projects useful for M5 batch 2 and 3
- Recommendations for checklist amendments before batch 2 runs

**Jose follow-up section:**
- MIGRATION_STATE.md diff staged but not committed (per M4 pattern)
- Anything that needs Jose's direct attention (deploy confirmation, etc.)

---

## 8. Autonomous decisions you can make

- File classifications when obvious (code vs doc, keep vs archive, etc.)
- Mechanical script/config fixes noticed in passing (commit separately)
- Archive folder structure within the per-project archive dir (subfolders by era if helpful)
- Handling ambiguity in handoff-era docs (extract what matters, archive rest)

## 9. Surface to Jose

- The four check-ins above
- Anything code-touching (migration is docs-only; if a non-doc change seems necessary, stop and ask)
- Git repo health concerns (corrupt history, non-standard remote config, anything unusual)
- Missing content that should exist but doesn't (e.g., no master plan document found in a project — how to proceed)

---

## 10. Before starting

Acknowledge this dispatch in one sentence. Then:

1. Verify both project folders exist and are accessible:
   ```bash
   ls -la ~/Desktop/Projects/jstudio-agency/ | head -5
   ls -la ~/Desktop/Projects/elementti-ERP/ | head -5
   ```

2. Confirm both are git repos:
   ```bash
   cd ~/Desktop/Projects/jstudio-agency/ && git log --oneline -1
   cd ~/Desktop/Projects/elementti-ERP/ && git log --oneline -1
   ```

3. Confirm `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` is the authoritative procedure.

If any pre-flight fails, surface to Jose before starting Step 0 for agency.

---

**End of M5 batch-1 dispatch. Begin with agency pre-flight.**
