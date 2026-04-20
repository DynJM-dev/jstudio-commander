# M5 Follow-up Dispatch — OvaGas-ERP Migration (final M5 project)

> **For:** Claude Code Coder session (fresh, default cwd)
> **From:** CTO via Jose
> **Model/effort:** Sonnet 4.6 / medium
> **Estimated duration:** 30-45 minutes
> **Reference:** `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v4, current with all amendments from M4 + M5 batches 1/2/3)
> **Follows:** M5 batches 1+2+3 complete. OvaGas was deferred from batch-2 pending Jose's WIP framing; WIP now shipped in 8 atomic commits on main.

---

## 1. Context

OvaGas-ERP is the final M5 project. Jose has just shipped ~11 days of uncommitted JStudio Core → OvaGas rebrand work as 8 atomic commits on main (schema migrations, regenerated types, domain services, UI primitives, brand, app shell, module swap, auth/accounting/crm polish). Tree is now clean-rebrand-M5-migration-ready.

8 pre-canonical brain/handoff docs remain untracked and need archiving + replacement with canonical 4-file structure:
- ARCHITECTURE.md, AUDIT_REPORT.md, CLAUDE.md, CODER_BRAIN.md, DEMO_SCRIPT.md, OPS.md, PM_BRAIN.md, PM_HANDOFF.md

Once this migration ships, M5 closes at 8/8 projects, migration phase count at 8/12 (67%).

## 2. Scope

Execute the 9-step per-project migration procedure at `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v4), targeting OvaGas-ERP at `~/Desktop/Projects/OvaGas-ERP/`. Full migration category (active project, production ERP).

---

## 3. OvaGas-specific guidance

### 3.1 Project type and standards

- **Project type:** ERP (gas station ERP for OvaGas — shift reconciliation via cuadres, fuel inventory, NCF billing B14/B15, payroll engine, station-scoped operations)
- **Stack:** Supabase (modern) + React 19 + TypeScript + Vite + Turborepo
- **Applicable standards:** OS itself (§25.3 — ERP is JStudio default, no separate standards file)

### 3.2 Brain-file extraction

OvaGas has **6 untracked brain-style files** (all >13KB likely): CODER_BRAIN, PM_BRAIN, PM_HANDOFF, ARCHITECTURE, AUDIT_REPORT, DEMO_SCRIPT, OPS. Use Explore subagent per v2 checklist amendment to scan these in parallel for decision extraction. Expect 20-40 decisions across:

- **Domain decisions:** cuadre engine design, NCF billing (B14/B15 fiscal types), station scoping pattern, fuel inventory ledger, payroll engine
- **Technical decisions:** StationContext wiring, lazyLoad stale-chunk wrapper, UI kit primitives selection, theme token system
- **Security decisions:** RLS scoping on cuadre evidence, user_devices RLS, search_path pins, security hardening migrations

Honest-provenance dating: commits date back to 2026-04-08 (initial) through 2026-04-17. Use actual commit dates where extractable; `2026-04 (extracted, approx date from commit range)` where not.

### 3.3 Migration 8-commit context to preserve

Jose just committed the rebrand as 8 atomic commits (13df478 → 770a511). The new canonical PROJECT_DOCUMENTATION.md should reflect:

- This is a JStudio Core clone rebranded to OvaGas between 2026-04-08 and 2026-04-17
- Genesis → hardening migration sequence (18 migrations, documented in commit 13df478)
- Module swap pattern (generic inventory/proposals → OvaGas-specific cuadres/inventory-ovagas/nomina)
- Dashboard consolidation (Admin + Employee → unified DashboardHome)
- Current state: production-ready or near-ready ERP for the OvaGas gas station business

### 3.4 Regulatory framing (per v4 checklist amendment #5)

OvaGas IS subject to DGII compliance — NCF billing is implemented (B14/B15 migration `20260417006000_seed_ncf_b14_b15.sql`). Document in PROJECT_DOCUMENTATION.md §7:

- DGII NCF sequences (B14 fiscal receipts, B15 government receipts — per the seed migration)
- ITBIS 18% handling (standard DR tax)
- RNC requirements for the gas station operation

This is standard ERP regulatory framing, not protective-framing. Don't say "NOT subject" — OvaGas IS subject to these.

### 3.5 Known deferrals / tech debt to capture in STATE.md

From the 8-commit context:
- **OvaGas production readiness:** verify demo seed vs production data path before any live deploy
- **Station-scoped RLS coverage:** security hardening migrations (20260417002000, 20260417003000, 20260417004000) reference evidence scoping and user_devices RLS — ensure these are validated before production
- **Push notifications:** send-push Edge Function was rewritten (+246 lines) — may need deploy verification

Document these as tech debt entries with appropriate severity. Don't invent urgency.

### 3.6 Archive strategy

Standard M5 pattern. Archive to `docs/archive/2026-04-19-pre-canonical/`:
- All 8 pre-canonical brain/handoff docs listed in §1

Plus add archive README per M4 pattern documenting what's there and why.

---

## 4. Execution order

Standard 9-step checklist (v4). Key amendments to remember:

- **Step 2 pre-flight verification** (v4 amendment): Run `git log --oneline -1` to verify git state independently. Expected: `770a511` (Jose's 8th commit) is HEAD.
- **Step 2 defensive scan** (v4 amendment): Extended to existing-repo snapshot tagging. Scan for credential patterns, >10MB files, extensionless binaries before tag.
- **Step 2a gitignore guidance** (v4 amendment): Not strictly needed since OvaGas is already a git repo, but verify no credentials slipped in during the 8 commits. Grep `serviceAccountKey`, `firebase-adminsdk`, `service-account`. Should be clean since nothing Firebase-admin-style in the stack.
- **Step 4 nested-project pattern** (v4 amendment): OvaGas is NOT nested — canonical 4 files go at repo root, no sub-app pointer README needed.
- **Step 5 subagent for brain-file extraction** (v4 amendment): USE IT. 6 brain-style files warrant the subagent approach.
- **Step 5 check-in batching** (v4 amendment): If PROJECT_DOCUMENTATION + STATE decisions surface from same file-reads, batch the check-ins.

Per-step:

- **Step 0** — Confirm full-migration category (yes, production ERP)
- **Step 1** — Audit current state (inventory 8 pre-canonical docs + current STATE.md + README.md if any + ARCHITECTURE.md etc.)
- **Step 2** — Defensive scan + snapshot tag `pre-m5-snapshot`
- **Step 3** — Archive pre-canonical docs (all 8) BEFORE writing canonical replacements
- **Step 4** — Create canonical CLAUDE.md, PROJECT_DOCUMENTATION.md, STATE.md, DECISIONS.md from templates
- **Step 5** — Fill canonical files:
  - Explore subagent scans 6 brain files, returns structured decisions
  - Main Coder extracts decisions into DECISIONS.md with honest-provenance dating
  - PROJECT_DOCUMENTATION.md synthesized from PM_HANDOFF.md + ARCHITECTURE.md + commit-8 context (the rebrand story)
  - STATE.md trimmed from whatever current state is to canonical target (<1500 words)
  - CLAUDE.md (<2500 words) with OvaGas-specific context
- **Step 6** — Archive stale files (the 8 docs → archive folder with README index)
- **Step 7** — Validate (typecheck + build clean)
- **Step 8** — Edit `~/Desktop/Projects/jstudio-meta/MIGRATION_STATE.md` (mark M5 FULLY COMPLETE, 8/8 projects; note that migration phase count is now 8/12); do NOT commit cross-repo
- **Step 9** — Commit per-project changes with atomic commits following M5 pattern

---

## 5. Scope boundaries

**Do NOT:**
- Modify any of the 8 commits Jose just made (they're the truth; this migration is docs-only on top)
- Touch project code, Supabase migrations, services, components
- Rename the folder
- Invent tech debt or deferrals not supported by actual context
- Force-push

**Do (autonomously):**
- Standard v4 checklist execution
- Small adjacent improvements (typos, stale path refs in any existing doc files)
- Archive structure decisions
- Commit message phrasing per conventional commits

---

## 6. Check-ins expected

- **PROJECT_DOCUMENTATION.md structure check-in** if synthesized draft needs direction on what the "current state" narrative should emphasize (pre-production polish vs demo-ready vs production-live)
- **STATE.md trim check-in** is unlikely since there isn't a bloated existing STATE.md (existing STATE.md per Jose's inventory is modified but manageable)

Expect 0-1 check-ins. Otherwise proceed autonomously.

---

## 7. Expected PHASE_REPORT

Same template as M4/M5 batches. Key sections for OvaGas:

- Files archived (count) + files created (count)
- Brain-file subagent outcomes (decisions extracted)
- Regulatory framing applied (DGII NCF + ITBIS; NOT protective-framing)
- Reference to Jose's 8-commit rebrand context in PROJECT_DOCUMENTATION
- **M5 closure declaration:** "M5 complete at 8/8 projects. Migration phase count now 8/12 (67%)."
- Any tech debt captured in STATE.md
- Jose follow-up section (snapshot tag, unpushed commits including the 8 rebrand + migration commits, any operational items)

---

## 8. Before starting

Acknowledge in one sentence. Then:

1. Verify state:
   ```bash
   cd ~/Desktop/Projects/OvaGas-ERP/
   git log --oneline -1  # expected: 770a511
   git status --short    # expected: 8 untracked .md files only
   ```

2. Confirm `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` at v4 (last commit `a32c49e`).

If pre-flight fails, surface to Jose before starting.

---

**End of OvaGas migration dispatch. Begin.**
