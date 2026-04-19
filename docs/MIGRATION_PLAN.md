# Command Center Migration Plan

**Target:** Architecture v2 as defined in `COMMAND_CENTER_ARCHITECTURE_v2.md`
**Status tracker:** `MIGRATION_STATE.md`
**Author:** CTO (Claude.ai) with Jose Bonilla
**Created:** 2026-04-18

> This document is the **execution plan**. It breaks the migration into phases, each small enough to complete in one session, with clear deliverables and acceptance criteria.
>
> Rules for this document:
> - Each phase is sized to ship in one session (not "a week of work")
> - Each phase has acceptance criteria — how we know it's done
> - Each phase has a rollback plan — how to undo if it doesn't work
> - Phases are numbered M1, M2, ... (M = Migration) to avoid collision with existing Commander phases (U.1, V, W, etc.)

---

## Phase M0 — CTO workflow formalization (templates + handoff rhythm)

**Effort:** 1 CTO session (this conversation), writing only, ~1 hour
**Risk:** Zero — writing documents
**Dependencies:** None
**Why first:** Establishes the document contracts between CTO, PM, and Coder before the code changes in M1 depend on them. Cheap, low-risk, unblocks everything else.

### Scope

Create the canonical templates that govern CTO ↔ PM communication. These are the document "contracts" — when PM writes a CTO_BRIEF, it follows the template; when CTO responds, it follows the response template. Consistent structure means both sides know what to expect.

### Deliverables

Create these files in `~/Desktop/Projects/jstudio-meta/templates/`:

1. **`cto-brief-template.md`** — structure for PM's periodic checkpoint reports
   - Project snapshot (current phase, what shipped, stack in use)
   - Architecture decisions made since last brief
   - Tech debt accumulated (with severity)
   - Skill performance (which invoked, which produced good/bad output)
   - Blockers and open questions for CTO (enumerated)
   - Metrics (token burn, phase velocity)
   - Recommended improvements to PM practice or OS

2. **`cto-question-template.md`** — structure for PM's ad-hoc questions to CTO
   - Context (project, phase, what led to the question)
   - What's been tried or considered
   - PM's current leaning if any
   - What decision is needed and by when

3. **`cto-response-template.md`** — structure for CTO's responses back
   - Answer to the question or direction on the brief
   - Reasoning (research done, cross-project patterns applied)
   - Any updates to OS or standards that came out of this
   - Next action for PM
   - Follow-up questions if any

4. **`phase-report-template.md`** — structure for Coder's phase completion reports
   - Phase identifier (number + name)
   - What shipped (list of commits, files changed)
   - Tests/typecheck/build status
   - Issues encountered and how resolved
   - Deferred items (things noted but not done this phase)
   - Questions for PM
   - Recommended next phase adjustments

### Acceptance criteria

- All four templates exist in `~/Desktop/Projects/jstudio-meta/templates/`
- Each template includes example content (filled-in example showing correct usage)
- Architecture doc §5 workflow references these templates correctly
- PM skill (`/pm` skill) references the templates it expects PM to use
- Coder bootstrap (to be written in M2) references the PHASE_REPORT template

### Rollback plan

Delete template files. They're documents; nothing breaks without them (existing PM skill has some brief logic already).

---

## Phase M1 — Reset effort defaults and add Coder session type

**Effort:** 1 session of Command Center Coder work (Claude Code), ~3-4 hours
**Risk:** Low — config changes, no logic changes
**Dependencies:** None

### Scope

Change three things in the Command Center spawn flow:

1. **Replace `/effort xhigh` hardcode with per-session-type defaults**:
   - `pm`: `/effort high`
   - `coder`: `/effort medium`
   - `raw`: `/effort medium`

2. **Add `coder` as a session type**:
   - Extend `sessionType` enum from `'pm' | 'raw'` to `'pm' | 'coder' | 'raw'`
   - Add UI option in session spawn modal
   - Route coder session spawn through bootstrap injection path (like PM, but pointing to a different bootstrap file)

3. **Create the Coder bootstrap file at `~/.claude/prompts/coder-session-bootstrap.md`** (content provided in Phase M2 — for M1, create a stub with minimal placeholder).

### Files touched

**Server:**
- `server/src/services/session.service.ts` — effort level per session type, new coder bootstrap path
- `packages/shared/src/types/session.ts` — enum extension
- `server/src/routes/session.routes.ts` — validate new enum value

**Client:**
- `client/src/components/sessions/CreateSessionModal.tsx` — add "Coder" option
- Any session-type-dependent rendering (session cards, filters)

**Migrations:**
- SQLite schema: confirm `session_type` column accepts `'coder'` — if there's a CHECK constraint, update it.

### Acceptance criteria

- New session modal shows three options: PM / Coder / Raw
- PM session spawns with `/effort high` (not `xhigh`)
- Coder session spawns with `/effort medium`, loads coder-bootstrap (stub is fine for now)
- Raw session spawns with `/effort medium`
- All 374 existing tests still pass
- Manual test: spawn one of each, verify effort indicator in Claude Code matches expected

### Rollback plan

Git revert the commit. Schema change is non-destructive (accepting a new enum value is compatible with old rows).

### Why this first

Token burn is the most acute pain point. `/effort xhigh` on every session is the largest single contributor. Dropping to calibrated defaults will show measurable impact within a day. This is also the cheapest phase to execute and validate.

---

## Phase M2 — Write the tight personas (PM and Coder bootstraps)

**Effort:** 1 CTO session (Claude.ai), writing only, ~2 hours
**Risk:** Zero — writing documents
**Dependencies:** M1 complete (so there's a bootstrap path to write to)

### Scope

Replace the current PM bootstrap and the stub Coder bootstrap with tight, focused persona documents modeled on the Gemini documents Jose provided.

### PM bootstrap target

**Source inspiration:** Jose's two Gemini PM documents (the ERP/SaaS one and the Landing/Firebase one).

**Structure (roughly):**
1. Role declaration (Lead Architect, Strategic PM, Creative Director)
2. The Dual-AI Architecture (Human / PM / Coder with explicit boundaries)
3. Tech stack mandate (references JStudio OS for details)
4. Database/security rules (references JStudio OS §13 for details)
5. Creative philosophy (references JStudio OS §11 for details)
6. The Context Trinity (`PROJECT_DOCUMENTATION.md`, `STATE.md`, project `CLAUDE.md`)
7. The Execution Protocol:
   - PM writes Execution Prompts, not dispatches
   - Human carries prompts to Coder
   - Coder returns PHASE_REPORTs
   - Human carries reports back
8. **Effort and model recommendations per phase type** — follows the framework in Architecture v2 §6.5. PM includes a header in every Execution Prompt with recommended model, recommended effort, estimated duration, and rationale. PM also suggests when Jose should spawn a new Coder session at a different model (e.g., "this phase warrants Opus — switch via `/model` or spawn fresh Coder with `--model claude-opus-4-7`").
9. Reference to skills (invoked as knowledge modules)
10. Opening task: ask for the project pitch

**Target length:** 1500-2500 words. Tight. No bloat.

**Key behaviors encoded:**
- Never auto-dispatch to Coder — always produce copy-pasteable prompts
- Always recommend a model + effort level per phase
- Always reference relevant skills in Execution Prompts
- Ask clarifying questions only when they can't be resolved by reading the project docs
- When Jose asks something outside the scope of planning, defer or redirect ("that's a direct-to-Coder question, I'll wait for the report")

### Coder bootstrap target

**Structure:**
1. Role declaration (Tactical Engineer)
2. Inputs: Execution Prompt from PM (pasted by Jose), project `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`
3. Output: Implementation + `PHASE_REPORT` at phase completion
4. The Dual-AI Architecture (knows PM exists but doesn't talk to PM)
5. How to handle ambiguity (report to Jose, never assume; never message PM)
6. PHASE_REPORT format (structured, consistent)
7. Skill invocation — when and how
8. Build discipline (typecheck, test, commit discipline)
9. Effort handling (raise to high when dispatch says so, not by default)
10. Opening task: read the project context and await the first dispatch

**Target length:** 1000-1500 words. Tighter than PM — Coder's role is narrower.

### Deliverables

Two files:
- `~/.claude/prompts/pm-session-bootstrap.md` (rewritten)
- `~/.claude/prompts/coder-session-bootstrap.md` (new)

Both backed up before overwrite (old version saved as `*.v1.bak`).

### Acceptance criteria

- Spawn a fresh PM session with the new bootstrap. Ask it to create a dummy project plan. Verify:
  - It follows the three-file convention
  - It produces a copy-pasteable Execution Prompt, not a dispatch
  - It recommends model + effort for the phase
  - It doesn't try to auto-communicate with Coder
- Spawn a fresh Coder session with the new bootstrap. Paste a dummy Execution Prompt. Verify:
  - It reads project docs first
  - It executes the prompt
  - It produces a structured PHASE_REPORT at the end
  - It doesn't try to message PM

### Rollback plan

Restore from `*.v1.bak` backups.

---

## Phase M3 — Canonical file names + project-local CLAUDE.md template

**Effort:** 1 session (Claude.ai + bash), ~1 hour
**Risk:** Low — file operations and a template
**Dependencies:** M2 complete

### Scope

1. **Create a project CLAUDE.md template** at `~/Desktop/Projects/jstudio-meta/templates/project-claude-md-template.md`. Content: thin, project-specific scaffolding with sections for stack, project directories, known quirks, reference links.

2. **Create a migration checklist** for existing projects to rename files to canonical names. Not run yet — just the checklist. Actual migration of existing projects happens in M4.

3. **Update skill expectations**: audit any skill file that references `PM_HANDOFF.md` or `HANDOFF.md` and standardize them to `PROJECT_DOCUMENTATION.md`. Or decide the skill should accept both names during transition.

### Deliverables

- `~/Desktop/Projects/jstudio-meta/templates/project-claude-md-template.md`
- `~/Desktop/Projects/jstudio-meta/templates/project-documentation-template.md` (already exists as handoff templates — confirm alignment)
- `~/Desktop/Projects/jstudio-meta/templates/state-md-template.md`
- `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md` — checklist for renaming files in each existing project

### Acceptance criteria

- All three templates exist and are ready to use
- Migration checklist covers the steps to bring an existing project into canonical structure
- Skill files that reference specific filenames either use the canonical name or accept both during transition

### Rollback plan

Delete the template files. Skill file changes are reversible via git.

---

## Phase M3.5 — Add project-type standards as companion files

**Effort:** 1 CTO session, ~2 hours (actual: shipped 2026-04-19)
**Risk:** Low — additive content, no extraction from OS
**Dependencies:** M3 complete (so the structure exists)

### Why this exists (revised understanding)

**Original plan (per architecture v2):** Extract project-type-specific content from `OPERATING_SYSTEM.md` into 6 standards files (ERP, Landing, Dashboard, Redesign, Portal, SaaS), trim the OS to common-core only.

**Revised plan after reading the actual OS:** Add 3 companion standards files for project types whose patterns genuinely diverge from the JStudio default (Landing, Dashboard, Redesign). Do NOT extract from the OS — keep it as the source-of-truth document Jose can use to bootstrap his entire workflow on a new machine.

**Reasoning:**
- The OS is well-organized and the bulk of its content is genuinely common-core (workflow, role architecture, efficiency standards, tech stack defaults, DR market rules)
- Most "ERP-specific" content in the OS is also "JStudio-default" content because ERPs are the main work
- Extracting would create duplication and reference tangles, not clarity
- Companion files are additive — projects load them only when their type calls for it
- No regression risk; OS continues to work for projects that don't reference standards

**Project types that get a standards file:**
| Type | Standards file | Why |
|------|---------------|-----|
| Landing | `LANDING_STANDARDS.md` | Brand-fit design (deviates from glass), Lighthouse perf targets, SEO patterns |
| Dashboard/Analytics | `DASHBOARD_STANDARDS.md` | Firebase-legacy patterns, data-viz standards, real-time vs near-real-time, exports |
| Website Redesign | `REDESIGN_STANDARDS.md` | Firecrawl discovery, SEO migration mechanics, URL preservation strategy |

**Project types that do NOT get a standards file:**
| Type | Reason |
|------|--------|
| ERP/SaaS | The OS *is* the ERP standards |
| Website + ERP Bundle | Use LANDING/REDESIGN for website half + OS for ERP half |
| Licitaciones | Has its own SKILL.md at `~/.claude/skills/licitacion/SKILL.md` |
| Portal (future) | Defer until first portal project |
| SaaS-non-ERP (future) | Defer until first such project |

### Scope

**Step 1 — Patch the OS:**
- Bump version to v1.2 with changelog
- Update §3 Role architecture to reflect manual-bridge model (no auto-dispatch via TeamCreate)
- Update §5 Workflow chain to reflect manual handoffs and renamed PROJECT_DOCUMENTATION
- Rewrite §6 Handoff chain to add CTO_QUESTION/CTO_RESPONSE/DECISIONS/CLAUDE.md as first-class docs
- Update §16 document types table
- Add new §25 Project-type-specific standards (pointer + scope)
- Note retired files: PM_HANDOFF, PM_BRAIN, CODER_BRAIN

**Step 2 — Write 3 standards files:**
- `LANDING_STANDARDS.md` — landing-specific patterns
- `DASHBOARD_STANDARDS.md` — dashboard patterns including Firebase-legacy
- `REDESIGN_STANDARDS.md` — redesign patterns including SEO migration

### Deliverables

- Patched `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` (v1.2, ~1635 lines)
- New `~/Desktop/Projects/jstudio-meta/standards/LANDING_STANDARDS.md`
- New `~/Desktop/Projects/jstudio-meta/standards/DASHBOARD_STANDARDS.md`
- New `~/Desktop/Projects/jstudio-meta/standards/REDESIGN_STANDARDS.md`

### Acceptance criteria

- OS v1.2 cleanly references the 3 standards files in §25
- Each standards file is self-sufficient (loadable without reading the others)
- Each standards file explicitly references the OS for common patterns
- No content duplicated between OS and standards files
- A test PM session can be spawned in a landing project and load OS + LANDING_STANDARDS together

### Rollback plan

OS rollback: revert to v1.1 from git history. Standards files: delete the directory. Both reversible without affecting any active project (companion files are additive).

### Why not do this with M3

M3 is narrow scope — templates and filename conventions. M3.5 is content reorganization, more involved. Separating keeps both phases sized correctly.

---

## Phase M3.6 — Split JSTUDIO company ops from agency site

**Effort:** 1 session (mix of CTO planning + Coder bash work), ~2 hours
**Risk:** Medium — touching a live Firebase project folder
**Dependencies:** M3.5 complete (standards extraction already done, so we know what's ops-level vs project-level)

### Why this exists

Observed during M3 research: `~/Desktop/Projects/jstudio-meta/` currently serves two purposes:

1. **Company ops folder** — OS document, playbook, templates, standards, migration state, cross-project knowledge
2. **Active Firebase project** — the JStudio agency website itself (has `firebase.json`, `functions/`, `src/`, `dist/`, `public/`, `package.json`, `firestore.rules`, `PROJECT_DOCUMENTATION.md`, `HANDOFF.md`, `STATE.md`)

These two concerns shouldn't share a root directory. Company ops apply across all JStudio projects; the agency site is one project among many. Co-location creates filename conflicts (which `STATE.md` — company migration state or agency site state?) and makes automation fragile.

### Option A (recommended, approved by Jose)

Split into two directories:

**`~/Desktop/Projects/jstudio-meta/`** — pure company ops, no code
```
JSTUDIO/
├── OPERATING_SYSTEM.md
├── JSTUDIO_EFFICIENCY_PLAYBOOK.md
├── MIGRATION_STATE.md
├── templates/
│   ├── cto-brief-template.md
│   ├── cto-question-template.md
│   ├── cto-response-template.md
│   ├── phase-report-template.md
│   ├── project-claude-md-template.md
│   ├── project-documentation-template.md
│   └── state-md-template.md
├── standards/
│   ├── ERP_STANDARDS.md
│   ├── LANDING_STANDARDS.md
│   ├── DASHBOARD_STANDARDS.md
│   ├── PORTAL_STANDARDS.md
│   ├── REDESIGN_STANDARDS.md
│   └── SAAS_STANDARDS.md
└── handoff-templates/
    ├── erp-handoff-template.md
    ├── landing-handoff-template.md
    └── redesign-handoff-template.md
```

**`~/Desktop/Projects/jstudio-site/`** — the agency website as a normal JStudio project
```
jstudio-site/
├── CLAUDE.md                    (points to ops for standards)
├── PROJECT_DOCUMENTATION.md
├── STATE.md
├── DECISIONS.md
├── firebase.json
├── functions/
├── src/
├── dist/
├── public/
├── package.json
└── firestore.rules
```

### Scope

**Step 1 — Plan the split (CTO work):**
- List every file/folder currently in `~/Desktop/Projects/jstudio-meta/`
- Classify each as "ops" (stays) or "agency site" (moves to new folder)
- Identify any file that might be referenced by path from elsewhere (hardcoded paths in skills, bootstraps, CLAUDE.md, etc.) — these need path updates

**Step 2 — Execute the split (Coder session work):**
- Create `~/Desktop/Projects/jstudio-site/` directory
- Move agency-site files into it
- Verify the Firebase project still works from the new location (`firebase deploy --only hosting:... --dry-run` or similar)
- Update any references that pointed to the old location

**Step 3 — Update CLAUDE.md references:**
- Global `~/.claude/CLAUDE.md` — update paths if it referenced the old JSTUDIO folder
- PM bootstrap — already references the ops paths correctly
- Coder bootstrap — already references the ops paths correctly
- Any skill file — audit for hardcoded `~/Desktop/Projects/jstudio-meta/` paths that actually meant agency-site files

**Step 4 — Create proper project files for jstudio-site:**
- Thin project-local `CLAUDE.md` (declares project type = landing or dashboard, points to ops standards)
- Rename `HANDOFF.md` to `PROJECT_DOCUMENTATION.md` (or merge if both exist)
- Keep `STATE.md` (already canonical name)
- Create `DECISIONS.md` if not present

### Acceptance criteria

- `~/Desktop/Projects/jstudio-meta/` contains only company ops content (no Firebase config, no `src/`, no `dist/`)
- `~/Desktop/Projects/jstudio-site/` contains the full agency Firebase project and is deployable
- No broken references — can spawn a PM session in either folder and it finds what it expects
- Git history preserved for both (use `git mv` where applicable, or accept a clean break with a migration commit)
- The agency site still builds and deploys from its new location

### Rollback plan

Move files back to the original location. Update references back. Since this is a filesystem operation, rollback is clean.

### Why this order (after M3.5)

M3.5 extracts project-type standards into companion files. Once those exist, it's clearer what belongs in "company ops" vs what belongs in a specific project's folder. Doing M3.6 before M3.5 would mean doing the split twice (once now, once after extraction).

---

## Phase M4 — Migrate one pilot project to canonical structure

**Effort:** 1 session (1 hour of cleanup)
**Risk:** Low for the pilot, medium if we try to do all projects at once
**Dependencies:** M3 complete

### Scope

Pick one project as the pilot. **Recommendation: JL Family Office** — it's active, it's the one Jose said has been frustrating, and migrating it will validate the full structure before applying to others.

Steps:
1. Rename handoff files to `PROJECT_DOCUMENTATION.md`
2. Create project-local `CLAUDE.md` from template
3. Ensure `STATE.md` exists and is current
4. Create `DECISIONS.md` with any settled decisions extracted from STATE or other docs
5. If the project has accumulated 100KB+ of duplicate global content (Elementti situation), consolidate: keep project-specific facts, move/delete content that duplicates the OS

### Acceptance criteria

- Pilot project has exactly these files at root: `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`, `DECISIONS.md`
- Any other project-specific docs are justified (e.g., a one-off onboarding doc, fine)
- PM session spawned in this project directory finds everything it expects
- Coder session spawned in this project directory finds everything it expects
- Project's git log shows the migration as a clean commit

### Rollback plan

Git revert. The migration should be one commit so it's easy.

### Why pilot first, not all at once

Elementti has 200KB of root docs that need careful extraction. PP Seguros has client data at root that needs careful handling. Doing all projects in one phase is risky. Pilot first, observe what goes wrong, refine the migration checklist, then batch the rest.

---

## Phase M5 — Batch migration of remaining projects

**Effort:** 2-3 sessions, depending on how many projects and how messy each is
**Risk:** Medium — requires judgment on each project's existing docs
**Dependencies:** M4 complete, any issues from pilot resolved

### Scope

Apply the canonical structure to:
- Elementti ERP (big docs cleanup needed)
- PP Seguros (client data security audit needed)
- Command Center itself (jstudio-commander)
- RIFA2RD
- OvaGas
- Rodeco
- Any other active project

**Special handling per project:**

- **Elementti**: consolidate the 200KB of root docs. Most content goes to global OS (if it's general JStudio rules) or stays in Elementti's PROJECT_DOCUMENTATION.md (if project-specific). Duplicated content gets deleted. Target: Elementti root goes from 200KB of docs to <50KB.

- **PP Seguros**: audit client data files at root (`Datos de clientes y prospectos.xlsx`, `Reporte de Cartera`, `Presentacion de planes - CONSORCIO DE BANCA SALCE.pdf`, `.env`). Verify they're in `.gitignore`. Check git history for leaks. Either move to a secure location or confirm `.gitignore` coverage.

### Acceptance criteria

- All active projects have canonical file structure
- No client data at any project root that isn't gitignored
- Elementti root docs <50KB total
- Each project has a clean commit documenting the migration

### Rollback plan

Per-project: git revert on that project's migration commit. Migrations are per-project, so rollback is per-project.

---

## Phase M6 — Commander code: disconnect PM ↔ Coder auto-forwarding

**Effort:** 1 Command Center Coder session, ~2-3 hours
**Risk:** Medium — touches the teammate wiring
**Dependencies:** M1-M5 complete

### Scope

The current Command Center has team-config reconciliation that creates teammate sessions with `parent_session_id` linking Coder to PM. This enables the broken auto-forwarding pattern.

Decide and implement:

**Option A (simpler, recommended):** Don't spawn Coder as a teammate of PM. Each Coder session is independent. `parent_session_id` remains null. No team-config wiring between PM and Coder.

**Option B (more complex):** Keep the parent/child link for visualization purposes only. Update the PM skill and Coder bootstrap to explicitly not use the link for messaging.

Option A is cleaner and aligns with the architecture v2 principle that the human is the bridge.

### Changes needed

**If Option A:**
- Remove team-config wiring for PM/Coder pairs
- Team-config stays functional for true teammate scenarios (parallel autonomous work)
- Coder sessions are just independent sessions tied to a project, not children of PM

**If Option B:**
- Keep wiring but strip auto-forwarding from bootstraps (M2 already addresses this)
- Update Command Center UI to show PM ↔ Coder relationship without implying automation

### Acceptance criteria

- Jose can spawn a PM and Coder for the same project with no expectation of auto-communication
- Commander Coder does not receive PM's messages
- Commander PM does not receive Coder's tool calls
- Team-config still works for its actual use case (parallel autonomous teammates)

### Rollback plan

Git revert. The existing behavior is preserved as long as the code exists.

---

## Phase M7 — Project view in Command Center UI

**Effort:** 2-3 Command Center Coder sessions, ~1-2 days
**Risk:** Medium — new UI, new data-fetching
**Dependencies:** M1-M6 complete; canonical file structure in place so project-data fetching is predictable

### Scope

Add a Projects view to Command Center UI that shows, per project:

- Project name, client, industry (from `PROJECT_DOCUMENTATION.md` frontmatter)
- Tech stack badges (from same)
- Current phase (parsed from `STATE.md`)
- Last activity (last modification of STATE.md or last commit)
- Associated sessions (PM and Coder for this project)
- Quick links to open files in editor

### Deliverables

- New route in Command Center: `/projects`
- Backend endpoint: `GET /api/projects` that reads project directories and parses their docs
- Frontend project cards showing the above

### Acceptance criteria

- Jose can see all active projects in one view
- Each card shows current state at a glance
- Clicking a project card navigates to relevant sessions or file links
- New projects appear automatically (filesystem-based, no manual registration)

### Rollback plan

Feature-flag the new view. If it breaks, disable the flag.

---

## Phase M8 — Effort indicator + adjustment UI

**Effort:** 1 Command Center Coder session, ~3-4 hours
**Risk:** Low
**Dependencies:** M1 complete

### Scope

Add per-session-card effort level display and a control to change it. Clicking the effort indicator opens a small selector (low / medium / high / xhigh). Selecting a new level sends `/effort <level>` to the session via tmux keystroke.

### Acceptance criteria

- Every session card shows its current effort level
- Jose can change effort level from the UI
- Change takes effect on the next message to that session
- Change is logged in session telemetry

### Rollback plan

Feature-flag. If broken, disable.

---

## Phase M9 — Skill audit and lightweight cleanup

**Effort:** 1 CTO session, ~1-2 hours
**Risk:** Low
**Dependencies:** None (can run in parallel with others)

### Scope

Based on Jose's stated skill usage:

- Confirm `/pm`, `/db-architect`, `/scaffold`, `/qa`, `/security`, `/ui-expert`, `/supabase-cli`, `/landing`, `ui-ux-pro-max` are current and aligned with OS v1.1
- Mark `/e2e-testing` as deprioritized (not actively used)
- Mark `/licitacion` as "future" (pending Licitaciones tool launch)
- Ensure all skills have the YAML frontmatter from earlier efficiency work (`cost_profile`, `typical_output_tokens`, `autonomous_safe`)
- Ensure `jstudio-e2e-testing` and `jstudio-landing` retain the "Output discipline" clause if it helps, or remove if it conflicts with their natural verbosity needs

### Acceptance criteria

- Each active skill confirmed current
- Unused skills marked with status (deprioritized, future)
- No skill conflicts with the new persona bootstraps

---

## Overall sequencing and time estimate

Recommended order:

| Phase | What | Time | Who |
|---|---|---|---|
| M0 | CTO workflow templates (brief/question/response/phase-report) | 1hr | CTO (this session) |
| M1 | Effort defaults + Coder session type | 3-4hr | Commander Coder |
| M2 | Tight PM + Coder personas | 2hr | CTO (this session) |
| M3 | Canonical file names + templates | 1hr | CTO (this session) |
| M3.5 | Extract project-type standards from OS | 2hr | CTO (this session) |
| M3.6 | Split JSTUDIO ops folder from agency site | 2hr | CTO plan + Coder execution |
| M4 | Pilot project migration (JLP) | 1hr | Jose + CTO |
| M5 | Batch project migration | 2-3 sessions | Jose + CTO |
| M6 | Disconnect auto-forwarding | 2-3hr | Commander Coder |
| M7 | Project view UI | 1-2 days | Commander Coder |
| M8 | Effort indicator UI | 3-4hr | Commander Coder |
| M9 | Skill audit | 1-2hr | CTO (this session) |

**Total:** ~10-12 days of work spread over 2-3 weeks of real time.

**Critical path:** M0 → M2 → M1 → M3 → M3.5 → M3.6 → M4 (pilot) → validate → M5/M6 (parallel) → M7/M8 (parallel) → M9.

**Parallelizable:**
- M0, M2, M3, M3.5, M9 are all CTO writing work — can happen in sequence within a single CTO session
- M1, M6, M7, M8 are all Commander Coder work — can be dispatched sequentially
- M3.6 and M4 require Jose + Coder coordination (filesystem operations on live folders)
- M7 and M8 can run in parallel with M5 (different scopes)

---

## What to do first

**Today (this CTO session):** M0 and M2 shipped. Both are CTO writing work, both zero-risk, both unblock downstream phases.

1. **M0 ✓** produced the four templates (CTO_BRIEF, CTO_QUESTION, CTO_RESPONSE, PHASE_REPORT). These are document contracts.
2. **M2 ✓** produced the PM and Coder persona documents. These reference the M0 templates explicitly.

**Next Jose action:** Dispatch M1 to Commander Coder. M1 wires up effort defaults and the Coder session type. With M2 already shipped, Commander is ready to wire the new personas immediately.

**After M1 + M2 land:** M3 (templates + checklist), then M3.5 (project-type standards extraction), then M3.6 (JSTUDIO folder split), then M4 (pilot migration on JLP).

**Rule:** Update `MIGRATION_STATE.md` after every phase ships. If state lives only in this conversation, it's gone on compaction.

---

**End of migration plan. See `MIGRATION_STATE.md` for current progress.**
