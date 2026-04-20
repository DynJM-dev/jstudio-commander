# CTO_STATE.md — JStudio Command Center

**Owner:** Claude (CTO advisor at claude.ai)
**Last Updated:** 2026-04-16
**Conversation Thread:** Command Center + PM Training

---

## PART 1 — GLOBAL JSTUDIO OPERATING MODEL

*This section is shared across every project's CTO_STATE.md. If updated, propagate to all project files.*

### Who's Who

- **Jose Miguel Bonilla** — Founder & Strategic Architect. Runs JStudio from Santiago, Dominican Republic. Makes brand, product, and direction calls. Doesn't write code directly — orchestrates.
- **Claude.ai (CTO advisor)** — Architecture, tool evaluation, business strategy, project briefs, research, high-importance decisions. Produces PM_HANDOFF.md documents. Owns strategic memory via CTO_STATE files.
- **Claude Code PM** — Execution layer. Takes CTO_HANDOFFs, manages phases, spawns coders, generates CTO briefs every 3 phases. Lives in Commander or Codeman. Owns tactical memory via PM_BRAIN.md / STATE.md / CODER_BRAIN.md.
- **Claude Code Coder(s)** — Persistent teammates spawned by PM via TeamCreate in tmux. Execute phases.

### Division of Labor (CTO vs PM vs Coder)

| Layer | Owns | Does Not Own |
|-------|------|--------------|
| **CTO (Claude.ai)** | Architecture decisions, tool/stack choices, business strategy, project briefs, research, pattern establishment, model/effort policy | Writing code, managing phases, file-level decisions |
| **PM (Claude Code)** | Phase execution, coder orchestration, scope creep triage, STATE tracking, handoff documents | Architecture changes, brand/pricing decisions, stack choices |
| **Coder (Claude Code)** | Writing code, running tests, following patterns, reporting blocks | Planning phases, scope decisions, model selection |

### Workflow v2 (Current)

1. Jose describes new project or feature to CTO
2. CTO produces complete `PM_HANDOFF.md` (module map, DB schema, phase plan, open decisions)
3. Jose pastes handoff into PM session in Commander
4. PM executes (doesn't re-plan) — spawns persistent coder, runs phases
5. Every 3 phases PM generates `CTO_BRIEF.md` with SUGGESTIONS
6. Jose uploads brief to CTO — CTO decides on SUGGESTIONS, course-corrects
7. Jose relays decisions back to PM

### Tech Stack (JStudio Standard)

- **Frontend:** React 19 + TypeScript + Vite 7+ + Tailwind v4 (`@theme`) + Framer Motion
- **Backend:** Supabase (new projects) / Firebase (legacy)
- **Monorepo:** Turborepo (pnpm)
- **UI Font:** Montserrat via inline `style={{ fontFamily: M }}`
- **Design Language:** Glassmorphism with `[data-theme="dark"]` selectors
- **Icons:** lucide-react
- **Charts:** Recharts (lazy loaded)
- **PDF:** `@react-pdf/renderer` v3.4.5 (pinned, accept React 19 peer warning)
- **State:** Context + hooks (no Redux, no Zustand)
- **Deploy:** Vercel

### Critical Bans (Apply to Every Project)

- No StrictMode
- No `.single()` — use `.maybeSingle()`
- No native `<select>` — use portal Select
- No html2pdf — use @react-pdf/renderer
- No Tailwind `font-*` / `dark:` classes
- No hardcoded hex colors — use @theme tokens
- No Redux / Zustand
- No `.catch()` chains — services return `{ data, error }`
- No `await` on audit logs (fire-and-forget)
- No app-side `.eq('tenant_id')` — trust RLS
- No Postgres ENUM — use TEXT CHECK
- No FLOAT for money — use NUMERIC(12,2)
- No FCM notification-only — data-only FCM only

### Model & Effort Policy (Opus 4.7 era — as of 2026-04-15)

- **Claude Code requires v2.1.111+** for Opus 4.7
- **All Claude Code work:** `claude-opus-4-7` (1M context automatic on Max/Team/Enterprise)
- **PM effort:** Always max. Never downgrade the brain.
- **Coder/specialist teammate effort:** xhigh default, high for repetitive/polish, max for overnight/complex architecture
- **Sonnet:** ONLY for disposable Agent tool subagents (grep, glob, file scans). Never for teammates that write code or decide.
- **Full routing matrix:** Lives in `~/.claude/skills/jstudio-pm/SKILL.md` under "Model & Effort Routing"

### Skills (Claude Code)

12 active skills at `~/.claude/skills/`:
- `/pm`, `/ui-expert`, `/db-architect`, `/scaffold`, `/qa`, `/security`, `/landing`, `/supabase-cli`, `/e2e-testing`, `ui-ux-pro-max`, Skill Creator plugin, `awesome-design-md`
- Default skill sequence for feature work: `/db-architect` → `/supabase-cli` → `/scaffold` → `/ui-expert`
- Pre-deploy parallel: `/qa` + `/security` (read-only, ~30k tokens each)

### DR Market Rules

- Spanish UI, English code
- DGII compliance (NCF, ITBIS 18%) where applicable
- Mobile-first glassmorphism
- Every table: `tenant_id` + RLS (Pattern 1) in same migration file as table creation
- Currency: `RD$` DOP, `US$` USD, `es-DO` locale, NUMERIC(12,2)

### Active Projects

| Project | Type | Status | Path |
|---------|------|--------|------|
| JStudio Commander | Internal tool | Active development | `~/Desktop/Projects/jstudio-commander/` |
| JLP Family Office | Client ERP | Phase 10 + UI polish | `~/Desktop/Projects/jlp-family-office/` |
| Elementti ERP | Client ERP | Shipped | `~/Desktop/Projects/elementti-ERP/` |
| PP Seguros | Client SaaS | Shipped | `~/Desktop/Projects/pp-seguros/` |
| RIFA2RD | Client SaaS | Active | (path TBD) |
| GrandGaming | Client | Active | (path TBD) |
| Dominican Padel Cup | Event site | Shipped | (path TBD) |

---

## PART 2 — PROJECT-SPECIFIC: JStudio Commander

### Project Identity

**What it is:** JStudio's internal command center — a web UI + backend for Jose to view, control, and orchestrate Claude Code tmux sessions across all JStudio projects. Custom-built to replace needing to manually tmux attach to each PM/coder session.

**Stack:** Fastify 5 + SQLite (better-sqlite3) + React 19 + Vite 7 + Tailwind v4 + WebSockets + chokidar

**Ports:** Fastify 3002, Vite dev 5173

**Path:** `~/Desktop/Projects/jstudio-commander/`

**Access:** Local Cloudflare tunnel + PIN auth for remote access

### Current Phase

**Opus 4.7 migration complete (2026-04-16).** Commander code, settings.json, team configs, and PM skill routing matrix all updated. Two coders (coder-9 + coder-10) were stood down for the model restart. 50+ commit sprint just wrapped — ready for next directive.

### What's Shipped

- Plan card attribution fix (cross-group via real task IDs)
- Sticky Plan Widget with IntersectionObserver + X close + 3s fade
- Split-Screen PM↔Coder pane (MVP single-slot, drag-resize 30-70%, localStorage restore)
- PM vs Raw session toggle with bootstrap auto-injection
- Cold Start protocol in `/pm` SKILL.md + canonical bootstrap prompt
- Activity chips (Skill/Brain/Memory/Send/TeamCreate)
- State-aware shimmer (thinking/tooling/waiting)
- Bulletproof interrupt (ESC/Cmd+./double-tap)
- Compaction support
- Nested teammate tree
- Per-session stats isolation (4-strategy hook-event matcher)
- upsertSession facade
- Plan extractor unit tests (6 tests, 3 JSONL fixtures)
- [1m] model suffix fix (team config normalizeModel)
- Opus 4.7 migration (model defaults, normalizeModel, team configs, routing matrix)

### What's Pending (Triage Required)

- Token-audit follow-ups #216-#221
- #230 project tech-stack pills (server-side)
- #191 stale-transcript pill (likely obsolete)

Plus the longer backlog from earlier planning (10-item todo list): multi-tab teammate pane, Direct Mode badge, context hygiene rules in CODER_BRAIN.md template, sticky plan dismiss bug, status poller cleanup, dev health check banner, TOKEN_CONTEXT_LIMITS unit tests, activity chip registry pattern, E2E Playwright foundation, stopped teammate cleanup cron, DB-persist preferences.

### Decisions Log (newest first)

- **[2026-04-16]** Don't install claude-mem as a Commander sibling. Absorb 4 patterns natively instead: (1) auto-capture brain updates via SessionEnd hook with cheap Sonnet Agent, (2) observations SQLite table with structured facts + IDs, (3) progressive disclosure search tool (`jsc search` → timeline → get_observations), (4) Memory/Knowledge page in Commander UI. Port conflict (37777 vs 3002) + philosophy mismatch (everything vs curated) drive the build-ourselves call.
- **[2026-04-16]** Opus 4.7 migration executed. Default model `claude-opus-4-7`, default effort `xhigh`, PM always max, coders floor at high effort, Sonnet only for disposable Agent subagents.
- **[2026-04-15]** CTO_STATE.md pattern established. Per-project files at `docs/CTO_STATE.md`. Global operating section + project-specific section.
- **[2026-04-15]** Workflow v2 locked: CTO produces PM_HANDOFF → Jose pastes → PM executes → every 3 phases PM generates CTO brief → Jose uploads → CTO course-corrects.

### Open Questions / Pending CTO Input

- Claude-mem pattern adoption order: start with Pattern 2 (auto-capture + observations table) now, or finish current Commander backlog first? **Awaiting Jose's call.**
- Should Commander expose memory/observations as an MCP server for the PM to query, or just as CLI (`jsc search`)? **Defer until Pattern 2 ships.**

### Patterns Established (Locked, Don't Revisit)

- SQLite via better-sqlite3 (not sqlite3 or drizzle)
- Fastify for backend (not Express)
- chokidar for file watching (not native fs.watch)
- WebSocket for real-time (not SSE)
- React 19 + Vite 7 + Tailwind v4 — match JStudio frontend standard
- No StrictMode
- Hook-based capture for session events (PostToolUse, SessionStart, SessionEnd)
- Per-session stats isolated via 4-strategy hook-event matcher
- PM cold-start protocol reads global CLAUDE.md + project brain files before accepting work

### Known Technical Debt

- #191 stale-transcript pill — likely obsolete, needs verification then removal
- Sticky plan dismiss uses boolean — should use `dismissedPlanKey` so new plans re-appear
- Status poller not cleaned up for pane-ID teammates (prerequisite for multi-tab)
- Preferences (split state, effort, theme) stored in localStorage — should move to DB

### CTO Notes for Next Session

- Jose has handed JLP off to another conversation thread — this thread is now dedicated to Commander + PM training
- Next likely directive: triage the backlog and pick either (a) finish remaining Commander todos first, or (b) start claude-mem-inspired patterns (auto-capture + observations table)
- When Jose returns, ask which lane to work next

---

## HOW TO USE THIS FILE

**At start of every CTO conversation about this project:**
1. Jose says "working on Commander" (or uploads this file)
2. CTO reads it in full (Part 1 + Part 2)
3. CTO reports: "Caught up. Last decisions: X. Open questions: Y. Ready for direction."

**During conversation:**
- CTO tracks decisions mentally, doesn't interrupt flow
- CTO flags when something contradicts an established pattern

**At end of conversation (or when Jose says "update CTO state"):**
- CTO produces updated CTO_STATE.md as artifact
- Jose saves to `~/Desktop/Projects/jstudio-commander/docs/CTO_STATE.md`
- Git commit: `docs: update CTO_STATE [one-line summary]`

**When Part 1 (global) changes:**
- CTO flags the change, produces updated Part 1 section
- Jose propagates to every project's CTO_STATE.md (or CTO batches the update across all of them in one conversation)

**File grows but stays lean:**
- Decisions Log: keep last ~30, archive older to `docs/CTO_STATE_archive.md`
- Shipped list: collapse into summary paragraphs after 3+ months
- Open Questions: clear entries once decided (they move to Decisions Log)
