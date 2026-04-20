# M5 Dispatch — Batch 3 (Remaining existing-git projects)

> **For:** Claude Code Coder session (fresh session, default cwd)
> **From:** CTO via Jose
> **Model/effort:** Sonnet 4.6 / medium
> **Estimated duration:** 1.5-2 hours total (~45-60 min per project)
> **Reference:** `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v3, with M4+M5b1+M5b2 amendments in commits 47538d1 and 06bdaab)
> **Follows:** M5 batch-1 (agency + elementti, shipped) and batch-2 (rodeco-dashboard + rodeco-website + raffle-platform shipped, OvaGas deferred)

---

## 1. Context

M5 batch-3 is the final scheduled batch. Two projects remain:

1. **PPseguros** — Firebase-legacy analytics/dashboard, active project (insurance intelligence for brokers)
2. **GrandGaming** — gaming platform (exact type TBD during recon)

Both projects are already under git, so no git-init pre-flight work. Batch-3 is a cleaner, lighter batch than 1 or 2.

**Not in this batch:**
- OvaGas-ERP (deferred from batch-2 pending Jose's rebrand commit work)

After batch-3 ships, M5 is 7/8 complete with OvaGas the only open item. Migration phase count moves to 8/12 (67%).

## 2. Scope

For each project, execute the 9-step per-project migration procedure at `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v3). Treat each as **full migration** — both are active, in-use projects.

Process sequentially: **PPseguros first** (heavier, more accumulated docs likely), **GrandGaming second**.

---

## 3. Per-project guidance

### 3.1 PPseguros

**Path:** `~/Desktop/Projects/PPseguros/`
**Project type:** Dashboard / Analytics (insurance broker intelligence platform)
**Stack:** Firebase-legacy (Firestore + Cloud Functions + Firebase Auth)
**Applicable standards:** `~/Desktop/Projects/jstudio-meta/standards/DASHBOARD_STANDARDS.md`
**Git status:** existing repo, expected active/healthy

**Specific considerations:**

**(a) Firebase-legacy project.** DASHBOARD_STANDARDS.md §2-2.4 addresses Firebase-legacy patterns explicitly. Reference those patterns in the new canonical CLAUDE.md — don't re-explain them, just point to the applicable standards file.

**(b) SIA Seguros integration context.** Per CTO memory, PP Seguros has integration with SIA Seguros via Patridge Consulting (database access path for broker data). If this is documented in any existing PM_HANDOFF / brain file / README, preserve it in the new PROJECT_DOCUMENTATION §7 (Integrations).

**(c) Broker RBAC + white-labeling.** Multi-broker platform where each broker sees only their own book of business. White-labeling per broker (theme config, logo, potentially custom domain). If these are documented anywhere, preserve in new PROJECT_DOCUMENTATION.md §5 (RBAC) and §6 (Design).

**(d) Insurance-specific terminology.** Spanish UI with industry terms (pólizas, primas, siniestros, retención, etc.). Preserve in CLAUDE.md Known Quirks section if there are consistency rules the project enforces (e.g., "always use 'prima' not 'premium' in Spanish UI").

**(e) Firestore Admin credential.** If PPseguros has a `serviceAccountKey.json` or similar Firebase Admin credential in the repo tree, it should already be gitignored (project has existed for a while). Verify via `grep -r serviceAccountKey .` that no credential accidentally got tracked. If one did, surface immediately — don't attempt to fix in this migration.

### 3.2 GrandGaming

**Path:** `~/Desktop/Projects/GrandGaming/`
**Project type:** TBD (determine during Step 1 audit)
**Stack:** TBD
**Applicable standards:** TBD based on project type — likely Landing, Dashboard, or a SaaS variant
**Git status:** existing repo

**Specific considerations:**

**(a) CTO has minimal context on GrandGaming.** Your Step 1 audit is the source of truth for what this project is. Read existing docs (README, PROJECT_DOCUMENTATION, HANDOFF if present) to classify the project type before creating CLAUDE.md.

**(b) DR gaming regulations may apply.** If GrandGaming is a real-money gaming platform (casinos, sportsbooks, rifas with prize pools >RD$), OS §13.6 applies — ProConsumidor + Ministerio de Hacienda requirements, 3% tariff, etc. If the project content suggests regulated gaming, preserve those references explicitly in PROJECT_DOCUMENTATION.md §7 (Integrations) and §10 (Compliance).

**(c) If GrandGaming is free-to-play / skill-gaming / non-regulated:** explicitly note "not subject to DR gaming regulation (ProConsumidor / Ministerio de Hacienda) — free-to-play / skill-based model" in §7, same protective-framing pattern used for raffle-platform's non-DGII status.

**(d) Project might be dormant.** If last commit is >30 days old, reflect that honestly in STATE.md "Right now" — don't invent active work. Use the "Paused at [last known state] as of [date]" framing from M5 batch-1 agency example.

---

## 4. Execution order per project

Standard 9-step checklist (v3) with no git-init pre-flight needed for either:

- **Step 0** — Confirm full-migration category
- **Step 1** — Audit current state (classify project type, inventory files, note sizes)
- **Step 2** — Git snapshot tag `pre-m5-snapshot` in project repo
- **Step 3** — Rename non-canonical files (archive BEFORE writing canonical per v2 amendment)
- **Step 4** — Create missing canonical files from templates
- **Step 5** — Fill canonical files with real content
  - Use Explore subagent for brain-file extraction if applicable (v2 amendment)
  - Use honest-provenance dating for extracted decisions (v2 amendment)
  - Batch check-ins if same file-reads inform both PROJECT_DOCUMENTATION and STATE decisions (v2 amendment)
- **Step 6** — Archive stale files (scratch under 1KB can be deleted outright per v2 amendment)
- **Step 7** — Validate migrated structure (typecheck, build if applicable)
- **Step 8** — Log the migration — edit `~/Desktop/Projects/jstudio-meta/MIGRATION_STATE.md` (do NOT commit cross-repo; leave for Jose)
- **Step 9** — Commit per-project changes with atomic, semantically-distinct commits

---

## 5. Scope boundaries

**Do NOT:**

- Modify project code, configs, migrations, or tests — docs only
- Touch Firebase config, Firestore rules, Cloud Functions source
- Rename folders
- Invent regulatory context if not documented (apply OS §13.6 only if existing docs mention it)
- Migrate OvaGas (deferred)
- Force-push or rewrite history

**Do (autonomously):**

- File categorization and canonical-file creation per v3 checklist
- Small adjacent improvements noticed in passing (typos, stale refs), committed separately
- Stale path fixes (any `jstudio-master/` → `jstudio-core/`, any `JSTUDIO/` → `jstudio-meta/`)
- Scratch file deletion per v2 amendment
- Pre-commit defensive scan per v3 amendment (grep credentials, size check, extensionless-binary `file` check) — applies to existing repos too for safety

---

## 6. Check-ins expected

- **Per-project PROJECT_DOCUMENTATION check-in** if existing master plan is >20KB (likely for PPseguros, possibly for GrandGaming)
- **Per-project STATE.md check-in** if trim removes >50% content
- **GrandGaming classification check-in** if the project type is genuinely ambiguous from Step 1 audit and picking the wrong standards file would materially affect migration
- **Regulatory-sensitive content check-in** if GrandGaming turns out to be a real-money gaming platform with specific compliance requirements you're unsure how to preserve

Expect 2-4 total across the two projects. Batch check-ins per v2 amendment #5 if same file-reads inform both.

---

## 7. Expected PHASE_REPORT

One combined PHASE_REPORT at the end of both projects. Per-project sections plus combined/batch-level section. Use the same template structure as batch-1 and batch-2.

Key sections to surface for batch-3 specifically:

- **Per-project classification** — PPseguros as Dashboard/Analytics, GrandGaming as [type determined]
- **Firebase-legacy pattern preservation** — how PPseguros references DASHBOARD_STANDARDS §2 for its Firebase-legacy patterns in its CLAUDE.md
- **Regulatory framing applied** — what each project's compliance posture is in the new PROJECT_DOCUMENTATION §7/§10
- **Anything surprising in the GrandGaming audit** (unknown territory — flag anything noteworthy)
- **M5 completion status** — 7/8 projects migrated after batch-3 ships; OvaGas remains the sole open item

---

## 8. Autonomous decisions you can make

- Project type classification for GrandGaming based on existing content
- File categorization and archive structure
- Small adjacent improvements (typos, stale refs, config cleanup)
- Honest-provenance dating for extracted decisions per v2 amendment
- Whether to batch check-ins per v2 amendment #5

## 9. Surface to Jose

- PPseguros integration details that seem incomplete or inconsistent with CTO memory
- GrandGaming project type that's ambiguous and affects standards file selection
- Any credential leak risk discovered during pre-commit defensive scan
- Any regulatory-sensitive content that needs specific Jose direction
- Anything in the existing docs that contradicts OS v1.2 conventions

---

## 10. Before starting

Acknowledge this dispatch in one sentence. Then:

1. Verify both project folders exist and are git repos:
   ```bash
   for p in PPseguros GrandGaming; do
     echo "=== $p ==="
     ls -d ~/Desktop/Projects/$p/ 2>/dev/null && echo "EXISTS" || echo "MISSING"
     cd ~/Desktop/Projects/$p/ 2>/dev/null && git log --oneline -1 2>&1 | head -1
   done
   ```

2. Confirm `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` is at the v3 state (last commit 06bdaab).

If pre-flight fails for either project, surface to Jose before starting.

---

**End of M5 batch-3 dispatch. Begin with PPseguros pre-flight.**
