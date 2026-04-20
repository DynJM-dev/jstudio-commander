# M5 Dispatch — Batch 2 (git-init + light migrations)

> **For:** Claude Code Coder session (fresh session, default cwd)
> **From:** CTO via Jose
> **Model/effort:** Sonnet 4.6 / medium
> **Estimated duration:** 2-3 hours total (~30-45 min per project, 4 projects)
> **Reference:** `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v2, with M4+M5b1 amendments in commit 47538d1)
> **Follows:** M5 batch-1 (jstudio-agency + elementti-ERP, shipped 2026-04-19)

---

## 1. Context

M5 batch-1 validated the migration procedure at scale on two heavy projects. Batch-2 applies the same procedure to four lighter projects, three of which are not yet under git version control.

**Key difference from batch-1:** the git-init pre-flight step. The MIGRATION_CHECKLIST says explicitly that projects without version control must be put in git before migration starts. Batch-2 treats this as a Step 2a pre-flight — inline in each project's migration, not a separate phase.

Projects in batch-2:

1. **rodeco-dashboard** — needs git init, small codebase
2. **rodeco-website** — needs git init, Firebase-hosted marketing + functions
3. **raffle-platform** (RIFA2RD) — needs git init, Firebase-based raffle platform
4. **OvaGas-ERP** — HAS a git repo (github.com/DynJM-dev/OveGas-ERP — typo'd name will be flagged in STATE.md as tech debt, not resolved here)

## 2. Scope

For each project, execute the 9-step per-project migration procedure at `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` (v2). Treat each as **full migration** — all are active or in-use projects.

Process sequentially in the order listed above. Do NOT interleave.

---

## 3. The git-init pre-flight (Step 2a, applies to 3 of 4)

For any project that returns `fatal: not a git repository` when you run `git status` in its directory, perform this pre-flight BEFORE the standard Step 2 (pre-migration snapshot tag).

### Standard git-init sequence

```bash
cd ~/Desktop/Projects/<project-folder>/

# Initialize git
git init
git branch -m main 2>/dev/null || true  # name default branch "main"

# Inspect what's there, confirm .gitignore exists
ls -la | head -20
cat .gitignore 2>/dev/null | head -30
```

### .gitignore baseline

Every JStudio project needs at minimum these entries in `.gitignore`:

```
node_modules/
.env
.env.local
.env.*.local
dist/
build/
.DS_Store
*.log
.turbo/
.vercel/
.firebase/
```

If `.gitignore` doesn't exist or is missing critical entries, add them before the initial commit. Firebase projects specifically need `.firebase/` and `.env` in `.gitignore` (credentials leak risk). Use your judgment — if the project has project-specific gitignore needs (e.g., a build output folder named differently), add them too.

### Initial commit

```bash
# Stage everything respecting .gitignore
git add -A

# Sanity check — nothing secret about to be committed
git status --short | head -30

# Initial commit
git commit -m "chore: initial commit (pre-M5 migration baseline)"

# Tag this as the pre-migration snapshot
git tag pre-m5-snapshot
```

### Remote handling

Do NOT create a GitHub remote during this dispatch. If Jose wants a remote, that's a separate decision per project (which org, private/public, repo name policy). Surface to Jose in the PHASE_REPORT's "Jose follow-up" section that any batch-2 project without a remote needs one set up later.

### If something looks dangerous before the initial commit

If `git status --short` shows files that look like they shouldn't be in git (credentials, huge binaries, secrets, something surprising), **stop and surface to Jose**. Better to pause than commit something sensitive.

---

## 4. Per-project guidance

### 4.1 rodeco-dashboard

**Path:** `~/Desktop/Projects/rodeco-dashboard/`
**Project type:** Dashboard (construction industry internal tool)
**Stack:** React 19 + Tailwind v4 + framer-motion + lucide-react + recharts (JStudio-standard)
**Applicable standards:** `~/Desktop/Projects/jstudio-meta/standards/DASHBOARD_STANDARDS.md`
**Git status:** NOT yet a git repo — apply §3 git-init pre-flight

**Specific considerations:**

- Client is Rodeco SRL (Dominican construction company, Santiago)
- This is the internal tool side; `rodeco-website/` is the client-facing side (handled separately in §4.2)
- The `/licitacion` skill relates to this project but lives in `~/.claude/skills/licitacion/` — don't migrate skill content into this project
- Expect minimal existing docs; CLAUDE.md, PROJECT_DOCUMENTATION.md, STATE.md, DECISIONS.md all likely need fresh creation from templates

### 4.2 rodeco-website

**Path:** `~/Desktop/Projects/rodeco-website/`
**Project type:** Landing page (construction company marketing site)
**Stack:** Vite + Firebase (firestore.rules, firestore.indexes.json, functions/, firebase.json)
**Applicable standards:** `~/Desktop/Projects/jstudio-meta/standards/LANDING_STANDARDS.md`
**Git status:** NOT yet a git repo — apply §3 git-init pre-flight

**Specific considerations:**

- Marketing asset folders exist: `ContentImages/`, `Fotos proyectos Rodeco/`, `LogoRod.png`, `REPORTE-CONTENIDO-RODECO.md`, `Rodeco-Landing/`
- `REPORTE-CONTENIDO-RODECO.md` is likely a client-content brief — read it before deciding to archive vs keep at root
- Firebase project may have production deploy config — don't touch firebase.json or firestore.rules
- Marketing content folders stay in the project structure (archive only handoff-era docs, not assets)

### 4.3 raffle-platform (RIFA2RD)

**Path:** `~/Desktop/Projects/raffle-platform/`
**Project type:** Depends on what's in there — could be Landing, Dashboard, or SaaS-flavored
**Stack:** Firebase-based (per CTO memory — "was done on Firebase and no repo")
**Applicable standards:** Read existing `PROJECT_DOCUMENTATION.md` header first. Coder memory says it self-identifies as "RIFA2RD — Complete Project Documentation" in the header. Pick the best-fit standards file once you see what's there.
**Git status:** NOT yet a git repo — apply §3 git-init pre-flight

**Specific considerations:**

- The product brand is RIFA2RD. Folder is `raffle-platform/`. Don't rename the folder — use canonical CLAUDE.md to declare the brand name explicitly.
- Dominican Republic raffle platform — may have regulatory considerations (ProConsumidor, Ministerio de Hacienda per OS §13.6)
- If the existing `PROJECT_DOCUMENTATION.md` mentions regulatory requirements, preserve those explicitly in the new canonical version

### 4.4 OvaGas-ERP

**Path:** `~/Desktop/Projects/OvaGas-ERP/`
**Project type:** ERP
**Stack:** JStudio-standard (assumed — verify)
**Applicable standards:** OS itself (ERP is the JStudio default per v1.2 §25.3)
**Git status:** HAS a git repo — GitHub at `github.com/DynJM-dev/OveGas-ERP` (typo'd "OveGas" instead of "OvaGas")

**Specific considerations:**

- **Do NOT rename the GitHub repo.** That's a Jose/admin task outside migration scope.
- **Tech debt entry required in STATE.md:** Add to the tech debt tracker: `| LOW | GitHub repo is named 'OveGas-ERP' (typo) — should be renamed to 'OvaGas-ERP'. GitHub admin task, not code. | M5 batch-2 | Rename via GitHub repo settings when convenient. |`
- Standard ERP migration otherwise — expect DGII compliance in content, NCF sequences, tenant isolation

---

## 5. Execution order per project

Same 9-step checklist as batch-1, with git-init pre-flight at Step 2a where needed:

- **Step 0** — Confirm full-migration category
- **Step 1** — Audit current state (inventory files, note sizes, classify)
- **Step 2** — Git snapshot tag `pre-m5-snapshot` (requires Step 2a first for non-git projects)
- **Step 2a (new for batch-2)** — If not a git repo: `git init` + `.gitignore` check + initial commit + tag (per §3 above)
- **Step 3** — Rename non-canonical files (archive BEFORE writing canonical replacements, per v2 checklist amendment)
- **Step 4** — Create missing canonical files from templates
- **Step 5** — Fill canonical files with real content
  - Use Explore subagent for brain-file extraction if the project has 2+ untracked brain files over 20KB (per v2 checklist amendment)
  - Use honest provenance dating for extracted decisions (per v2 checklist amendment)
  - Check-ins for PROJECT_DOCUMENTATION structure (if existing is >20KB) and STATE.md trim (if >50% reduction)
  - Batch check-ins if same file-reads inform both (per v2 checklist amendment)
- **Step 6** — Archive stale files (scratch files under 1KB with obvious throwaway content can be deleted outright per v2 checklist amendment)
- **Step 7** — Validate migrated structure
- **Step 8** — Log the migration — edit `~/Desktop/Projects/jstudio-meta/MIGRATION_STATE.md` (do NOT commit cross-repo; leave for Jose)
- **Step 9** — Commit per-project changes with atomic, semantically-distinct commits

---

## 6. Scope boundaries

**Do NOT:**

- Modify project code, configs, migrations, or tests — docs only
- Create GitHub remotes (Jose task)
- Rename folders
- Touch Firebase config, Supabase config, or deployment settings
- Migrate any project outside batch-2 (batch-3: PPseguros + GrandGaming is a separate dispatch)
- Force-push or rewrite history in any repo

**Do (autonomously):**

- `git init` + `.gitignore` baseline additions when needed (per §3)
- File archiving and canonical-file creation per checklist
- Small adjacent improvements noticed in passing (typos, stale refs, unused config), committed separately
- Stale path fixes (any `jstudio-master/` → `jstudio-core/`, any `JSTUDIO/` → `jstudio-meta/`)
- Scratch file deletion per v2 checklist amendment

---

## 7. Check-ins expected

Fewer than batch-1 (these projects are lighter):

- **Per-project check-in** if PROJECT_DOCUMENTATION.md existing content is >20KB (unlikely for 3 of 4 — they likely have no substantial master plan)
- **Per-project check-in** if STATE.md trim removes >50% content (unlikely — these projects don't have bloated STATE files to begin with)
- **Pre-git-init check-in** if `git status --short` shows anything concerning (credentials, huge binaries, unexpected files) before the initial commit

Expect 0-2 total check-ins across the 4 projects. Most work should proceed autonomously.

---

## 8. Expected PHASE_REPORT

One combined PHASE_REPORT at the end of all 4 projects, following the batch-1 pattern. Per-project sections plus combined/batch-level section. Use the same template structure as batch-1's report.

Key additions for batch-2 specifically:

- **Git-init pre-flight outcomes** — for each project that needed it: final `.gitignore` contents, initial commit hash, any surprises
- **Folder-vs-brand naming mismatches noted** — RIFA2RD declared in raffle-platform/CLAUDE.md, OvaGas declared correctly in OvaGas-ERP/CLAUDE.md despite GitHub typo
- **OvaGas GitHub typo** — confirm tech debt entry added to STATE.md

---

## 9. Autonomous decisions you can make

- `.gitignore` entries beyond the baseline if project-specific needs are obvious (e.g., a build folder with a non-standard name)
- File categorization (archive vs canonical vs delete) when answer is clear
- Which phase/rev date to use for extracted decisions when honest-provenance markers apply
- Commit message phrasing (use conventional commits)
- Whether a check-in is warranted (if it feels borderline, surface; if clearly within autonomous scope, proceed)

## 10. Surface to Jose

- Anything that would leak secrets if committed
- Existing `git status` or `git remote` output that looks surprising or corrupted
- Project that self-identifies as something other than expected (e.g., folder says "dashboard" but content says "marketing site")
- Any regulatory-sensitive content you're unsure how to categorize (raffle-platform + DR gaming regulations specifically)
- Jose-side items that need follow-up (remote setup, repo renames, etc.)

---

## 11. Before starting

Acknowledge this dispatch in one sentence. Then:

1. Verify all four project folders exist:
   ```bash
   for p in rodeco-dashboard rodeco-website raffle-platform OvaGas-ERP; do
     echo "=== $p ==="
     ls -d ~/Desktop/Projects/$p/ 2>/dev/null && echo "EXISTS" || echo "MISSING"
   done
   ```

2. Confirm git status for each:
   ```bash
   for p in rodeco-dashboard rodeco-website raffle-platform OvaGas-ERP; do
     echo "=== $p ==="
     cd ~/Desktop/Projects/$p/ 2>/dev/null && git status --short 2>&1 | head -3
   done
   ```
   Expected: rodeco-dashboard, rodeco-website, raffle-platform show "not a git repository"; OvaGas-ERP shows clean or tracked changes.

3. Confirm `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` exists and has the v2 amendments (commit 47538d1).

If any pre-flight fails or state differs from expected, surface to Jose before starting Step 0 for rodeco-dashboard.

---

**End of M5 batch-2 dispatch. Begin with rodeco-dashboard pre-flight.**
