# Brief — M7 + M8 Migration Requirements for Commander UI

**From:** Migration CTO (JStudio Architecture v2 migration track)
**To:** Commander CTO (JStudio Command Center development track)
**Via:** Jose Bonilla
**Date:** 2026-04-19
**Purpose:** Hand off the last two migration phases (M7 + M8) to the Commander UI track with the context, requirements, and constraints the migration work has established.

---

## 1. Context

JStudio Architecture v2 migration has shipped 10 of 12 phases between 2026-04-18 and 2026-04-19. The remaining two phases are both Commander UI work:

- **M7** — Project view UI in Command Center
- **M8** — Effort indicator + adjustment UI

Rather than have the migration CTO (without current Commander code context) dispatch these, Jose has decided the Commander CTO track drives them. This brief documents what the migration architecture needs the UI to surface, so the Commander track can fold M7/M8 into its own roadmap rather than receiving them as external dispatches.

## 2. What the migration shipped that UI now inherits

The migration established a canonical per-project 4-file structure at every JStudio project root:

- `CLAUDE.md` — thin per-project context loaded by every session (<2500 words target)
- `PROJECT_DOCUMENTATION.md` — master plan (~2000-8000 words)
- `STATE.md` — live present-tense working file (<1500 words target)
- `DECISIONS.md` — append-only architectural decisions log

Plus per-project archive structure:
- `docs/archive/2026-04-19-pre-canonical/` — originals preserved from migration
- `docs/archive/phase-reports/` — extracted historical phase content

Plus `docs/briefs/` for CTO_BRIEF / CTO_QUESTION / CTO_RESPONSE documents (OS v1.2 §6.2-6.4).

**8 of 8 JStudio projects now conform to this structure:**
- jstudio-agency (Landing, Firebase-legacy)
- elementti-ERP (ERP, Supabase)
- rodeco-dashboard (Dashboard)
- rodeco-website (Landing, Firebase)
- raffle-platform / RIFA2RD (B2C + admin)
- PPseguros (Dashboard, Firebase-legacy)
- GrandGaming (B2C TCG, nested structure)
- OvaGas-ERP (ERP)
- jl-family-office / JLP (pilot project, M4)

Plus:
- `jstudio-meta/` — company ops (OS v1.2, standards, templates, migration docs)
- `jstudio-core/` — ERP starter template (renamed from `jstudio-master/`)
- `jstudio-commander/` — Command Center itself

## 3. What M7 was supposed to deliver

**M7 — Project view in Command Center UI**

The original architecture v2 plan called for a UI surface in Commander that shows, for the currently-active project (whichever project the active session is working in), the canonical 4 files with the following affordances:

### Core requirements from migration perspective

1. **Read the 4 canonical files at the session's cwd.** When a PM or Coder session is spawned in `~/Desktop/Projects/elementti-ERP/`, Commander can display that project's `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`, and `DECISIONS.md` as a panel, tab, or sidebar view. The files are markdown; rendered markdown is the minimum bar.

2. **Live updates when files change.** If a Coder session updates `STATE.md` mid-phase (which happens in every M4/M5 migration and is expected behavior going forward), Commander should reflect the change without requiring the user to re-open or refresh the view. File watcher infrastructure already exists in Commander per Phase L work.

3. **Awareness of project type.** The migration's `CLAUDE.md` convention declares project type explicitly (Landing, Dashboard, ERP, etc.) and applicable standards files from `jstudio-meta/standards/`. A nice-to-have is Commander showing which project type and which standards apply. Not load-bearing for M7 — could be a future polish.

4. **Read-only from the UI's perspective.** The UI surfaces the files. It does not edit them. Edits happen via Coder/PM sessions. This is a deliberate constraint — the canonical files are the source of truth; UI is a window, not an editor.

### Pragmatic scope negotiation

If the full M7 scope is too large for one phase in the Commander roadmap, here's what I'd consider minimum-viable vs nice-to-have:

**MVP M7 (highest-leverage, smallest surface):**
- Show `STATE.md` for the active session's project, live-updating
- Nothing else

**Full M7:**
- Show all 4 canonical files with live updates
- Tab or pane navigation between them
- Optional: show archive folder presence (indicator only, not full browse)

**Extended M7:**
- Project type + standards badge
- Recent activity feed derived from `STATE.md` "Recent activity" section
- DECISIONS.md filterable by category

Migration track's actual need is STATE.md visibility. That's the one file that changes frequently during active work, and visibility into it would directly address Jose's complaint that "many times I don't know what is going on because I'm not seeing the real time activity of what Claude is doing inside the chat window."

## 4. What M8 was supposed to deliver

**M8 — Effort indicator + adjustment UI**

Commander already supports `/effort` per session. M1 established defaults: PM defaults to `high`, Coder defaults to `medium`, Raw defaults to `medium`. The effort level is stored in the session DB and can be changed via the `/effort` command.

### Core requirements from migration perspective

1. **Visible effort level per session.** A small indicator showing the current effort level on each session card or pane. Glanceable, not loud.

2. **Adjustment affordance.** Click or hover to change. Sends the `/effort [new-level]` command to the session. Confirmation or visual update when the session acknowledges.

3. **Awareness that effort persists via `--permission-mode`-adjacent config.** M1 established that effort defaults apply at session spawn via the persona bootstrap. The indicator should reflect the actual current state in the session, which may have been adjusted mid-session.

### Nice-to-haves

- Bulk adjustment ("set all Coders to high for this batch")
- History (when did this session's effort last change)
- Default visibility ("this session is at default" vs "explicitly adjusted")

M8 is substantially smaller than M7 in scope. Expected 3-4 hours of Commander work per migration estimates; might be smaller in Commander's actual roadmap.

## 5. The stubborn Commander issues Jose mentioned

Jose flagged three classes of issue that M7/M8 work should be aware of, even if they're not M7/M8's job to fix:

1. **"Things not popping up on time"** — session events, activity indicators, or status changes that lag visible confirmation. Possibly related to the bootstrap injection bug with custom cwd that was flagged earlier in the migration (M3.6 was blocked on it for one recon cycle). Commander CTO track has been investigating via Phase U/V work.

2. **"Things getting stuck"** — sessions entering states they don't exit cleanly. Phase U.1 (4-layer state machine: force-idle cooldown, hook yield, stale-activity force-idle, pane classifier fallback) has been addressing this. Phase V continues the work.

3. **"Not seeing real-time activity in chat window"** — the user-visible feedback gap. This is the biggest UX complaint and the one M7 most directly addresses — if STATE.md is visible and live-updating, the user has a second surface showing what the Coder is actually doing, independent of whether the chat window is reflecting it.

M7's MVP scope (live STATE.md) would meaningfully reduce the pain of issue 3 even before full M7 ships.

## 6. Migration constraints the UI must respect

These are rules established by the migration that M7/M8 implementations must not violate:

### 6.1 Canonical files are the source of truth

UI reads them, UI does not replace them. Adding a "project view settings" panel that stores state in a sidecar JSON file somewhere is fine; but the migration's 4 canonical files must remain the place where project context lives.

### 6.2 Archive structure is load-bearing

`docs/archive/2026-04-19-pre-canonical/` and `docs/archive/phase-reports/` contain preserved pre-migration content. If the UI surfaces project docs, it should ignore the archive folder by default (don't show retired content as if it's current). Optional: show archive folders as collapsed/de-emphasized if the UI iterates on that complexity.

### 6.3 The `briefs/` directory is PM↔CTO communication

`docs/briefs/` contains `CTO_BRIEF_YYYY-MM-DD.md` + `CTO_QUESTION_YYYY-MM-DD_*.md` + `CTO_RESPONSE_*.md` files (OS v1.2 §6.2-6.4). These are PM↔CTO documents Jose carries manually between sessions. The UI might show them, but must not auto-forward them between sessions — the manual-bridge model (M6) is explicit: only Jose moves these files.

### 6.4 No per-project state in Commander DB

Commander's existing session + teammate tracking stays in its database. Per-project canonical state lives in the project's git repo. The UI shouldn't try to duplicate project state in Commander's DB — that creates a sync problem. File watcher + live read is the pattern.

### 6.5 Effort levels are persona-driven defaults + user override

M1 established: PM→high, Coder→medium, Raw→medium. These defaults are baked into `BOOTSTRAP_PATHS` + `SESSION_TYPE_EFFORT_DEFAULTS` in `session.service.ts`. M8's effort indicator should reflect actual current state (which may differ from defaults if user adjusted), not just the default.

## 7. What I'm NOT asking for

Things that would be nice but are genuinely outside M7/M8 scope and shouldn't feature-creep the Commander roadmap:

- Project creation flow (spawn a new canonical-structure project from templates) — that's a M5.5 / M10+ idea, not M7
- Cross-project dashboard (show all JStudio projects' states at once) — cool but out of scope
- Commit/push integration from the UI — explicit non-goal, Commander is not a git client
- AI-assisted editing of canonical files from the UI — violates §6.1
- Auto-forwarding updates from PROJECT_DOCUMENTATION.md to STATE.md or vice versa — violates manual-bridge / §6.3

## 8. Handoff offer

If the Commander CTO track wants to fold M7/M8 into its existing Phase V or post-V roadmap, that's the cleanest path. Migration track does not need M7/M8 as standalone phases — we need the capability (visible project state + adjustable effort) to be available in Commander at some point.

If it fits as Phase W or V.2 or whatever the next chunk of Commander work is, fine. If it needs to wait behind current Phase V completion and the stubborn state-machine work, fine.

The migration phases can be marked COMPLETE when:
- **M7:** A user can see the active session's project `STATE.md` somewhere in Commander UI with live updates. Full 4-file view is better but MVP-STATE is acceptable to close M7.
- **M8:** A user can see each session's current effort level and adjust it from the UI.

Both can close with less than the full scope listed in §3 and §4 if Commander's roadmap has tighter constraints. Migration track will accept MVP and document the deferred full-scope items as follow-up work.

## 9. Handoff mechanics

Jose is the bridge (manual-bridge model, naturally). Proposed flow:

1. Commander CTO reviews this brief
2. Commander CTO decides if M7/M8 fit into current roadmap, and at what scope
3. Commander CTO dispatches to Commander Coder (their normal pattern) when ready
4. Jose reports back to migration CTO when either phase ships
5. Migration CTO marks phases COMPLETE in `MIGRATION_STATE.md`

If Commander CTO wants to push back on scope, rework requirements, or propose entirely different framing — happy to iterate. This brief is a starting point, not a final spec.

## 10. Appendix — Key file locations for reference

- Operating System: `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` (v1.2)
- Migration state tracker: `~/Desktop/Projects/jstudio-meta/MIGRATION_STATE.md`
- Migration checklist (v4): `~/Desktop/Projects/jstudio-meta/MIGRATION_CHECKLIST_per_project.md`
- Canonical templates: `~/Desktop/Projects/jstudio-meta/templates/`
- Project-type standards: `~/Desktop/Projects/jstudio-meta/standards/`
- PM persona: `~/.claude/prompts/pm-session-bootstrap.md` (v3, manual-bridge clause at line 26)
- Coder persona: `~/.claude/prompts/coder-session-bootstrap.md` (v3, manual-bridge clause at line 24)
- M9 skill audit: `~/Desktop/Projects/jstudio-meta/M9_AUDIT.md`
- All M5 dispatches: `~/Desktop/Projects/jstudio-commander/docs/dispatches/`
- This brief: `~/Desktop/Projects/jstudio-commander/docs/briefs/M7_M8_MIGRATION_BRIEF.md` (suggested location)

---

**End of brief.**
