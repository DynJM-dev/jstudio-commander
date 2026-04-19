# Command Center Architecture v2

**Version:** 2.0 · **Status:** Target state (migration in progress) · **Author:** CTO (Claude.ai) with Jose Bonilla

> This document describes the target architecture for JStudio's Command Center and its workflow. It is the **reference doc**. When the migration is complete, everything in this document should be true. Today, some of it is aspirational.
>
> For current state and migration progress, see `MIGRATION_STATE.md`. For the step-by-step migration plan, see `MIGRATION_PLAN.md`.

---

## Part 1 — First principles

Before anything structural, the principles this architecture is built on. Every decision below traces back to one of these.

### 1.1 The human is the bridge

PM and Coder do not talk to each other. Jose copies phase prompts from PM to Coder. Jose copies reports from Coder back to PM. This was the Gemini model, and it worked. It works because:

- PM keeps strategic context clean (no coder tool-call noise)
- Coder keeps tactical context clean (no PM planning deliberation)
- Jose stays in control — he sees every handoff, catches problems before they land, maintains the mental model
- No agent-teams orchestration overhead, no bootstrap loaded twice, no auto-forwarding bureaucracy

This is a choice. It is not a limitation. Automation of the handoff has been tried (current Commander Command Center wiring) and has produced worse outcomes than the manual bridge. We go back to manual.

### 1.2 Effort is calibrated, not maxed

Current default: `/effort xhigh` on every session. This is wrong for most work.

- **Planning and architecture** — PM brainstorming, tradeoff analysis, complex schema decisions. Warrants high/xhigh.
- **Execution of a scoped phase** — Coder implementing a well-defined dispatch. Warrants medium/high.
- **Simple fixes and iteration** — design tweaks, bug fixes, single-file edits. Warrants low/medium.

Effort should be set per task, not per session. Default should be medium, scaled up when the work actually needs deeper thinking.

### 1.3 Skills are knowledge modules, not orchestration templates

Skills encode how JStudio does things: UI conventions, DB patterns, audit procedures, DGII compliance, landing page structure. They're reference material, not instructions.

- Skills are **invoked** when relevant, not auto-loaded on every session.
- PM references skills in Execution Prompts ("Use `/ui-expert` for this component").
- Coder invokes skills when the dispatch tells it to.
- Jose can invoke skills manually in any session.

Skills are available, known, and used on demand. They don't inflate baseline context.

### 1.4 Personas are good, they just need to be tight

The Gemini PM document worked because it was ~1500 words, focused, and defined the role clearly. The current PM bootstrap has grown. It needs to be trimmed back to something closer to the original — role, responsibilities, protocol, and a clean handoff to the first question.

Same for the new Coder persona (which doesn't exist today but will be added): tight, focused, role-specific.

### 1.5 One document standard, enforced

Filename drift (`PM_HANDOFF.md` vs `HANDOFF.md` vs `PROJECT_DOCUMENTATION.md`) breaks automation and makes project navigation unpredictable. Every project uses the same file structure. Skills and tools assume that structure.

### 1.6 Global is for rules, local is for project context

- **Global** (`~/.claude/`, `~/Desktop/Projects/jstudio-meta/`): the OS document, skills, playbook, templates. Things that apply to how JStudio builds software generally.
- **Local** (each project directory): project-specific facts. Stack choices, known quirks, project-specific conventions, active phase, decisions made for this project.

Project-local CLAUDE.md is small (under 3k tokens) and project-specific. Global CLAUDE.md is thin (pointers to the OS and skills). Session loads both automatically but neither is bloated.

---

## Part 2 — Roles

### 2.1 The Human (Jose)

**Role:** Product Owner, Creative Visionary, Bridge, Final QA.

**Responsibilities:**
- Define business goals and product direction
- Approve architectural decisions (database schema, tenant model, major tradeoffs)
- Carry prompts between PM and Coder sessions
- Execute deployments and external integrations (DGII registration, domain cutovers, payment gateways)
- Final QA on shipped work

**Does not:**
- Write code directly (unless desired)
- Translate between AI sessions automatically — the manual bridge is the whole point

### 2.2 The PM (Claude Code session, `sessionType: 'pm'`)

**Role:** Lead Architect, Strategic Project Manager, Creative Director.

**Responsibilities:**
- Build master context for the project (via `PROJECT_DOCUMENTATION.md`)
- Design database schemas, RBAC models, feature architecture
- Break work into phases
- Write copy-pasteable **Execution Prompts** for each phase
- Reference relevant skills in those prompts
- Recommend model + effort level per phase
- Synthesize Coder's `PHASE_REPORT` back into updated project state
- Proactively suggest improvements (better UI patterns, more efficient queries, modern UX trends)

**Does not:**
- Dispatch to Coder automatically
- Run Coder's tool calls
- Write React components or final implementation code
- Forward Jose's messages anywhere

**Bootstrap:** The PM persona document (`~/.claude/prompts/pm-session-bootstrap.md`). Tight, focused, Gemini-style. Includes the Three-File Context Trinity, the Execution Protocol, and role boundaries.

**Effort default:** `high`. User can raise to `xhigh` for explicit strategic work.

### 2.3 The Coder (Claude Code session, `sessionType: 'coder'` — new)

**Role:** Tactical Engineer.

**Responsibilities:**
- Read Execution Prompts from PM (pasted by Jose)
- Implement the requested changes precisely
- Use skills as directed (`/ui-expert`, `/db-architect`, `/supabase-cli`, etc.)
- Invoke subagents (Explore, general-purpose) for exploration when dispatch requires it
- Run build checks, typecheck, tests
- Produce a structured `PHASE_REPORT` at phase completion for Jose to paste back to PM

**Does not:**
- Make strategic decisions (scope, architecture, feature priority)
- Forward messages to PM
- Ask clarifying questions about anything outside the dispatch — if the dispatch is ambiguous, Coder reports that back to Jose and waits

**Bootstrap:** The Coder persona document (`~/.claude/prompts/coder-session-bootstrap.md`) — new, to be created. Tight. Defines role, conventions reference, PHASE_REPORT format, how to handle ambiguity.

**Effort default:** `medium`. Raised to `high` via Execution Prompt when the phase is complex.

### 2.4 The Raw session (`sessionType: 'raw'`)

**Role:** Whatever Jose wants. Plain Claude Code.

**Responsibilities:** None prescribed.

**Bootstrap:** None.

**Effort default:** `medium`. User controls.

**Use cases:** Quick experiments, one-off scripts, exploratory work, testing a new skill, anything that doesn't fit PM or Coder.

### 2.5 The CTO (Claude.ai — this conversation)

**Role:** Strategic depth. Research. Cross-project synthesis. Long-form architecture and brief writing. First stop for any work where CTO's tooling or fresh context gives a genuine advantage over PM.

**What CTO does better than PM:**

- **Deep web research.** web_search, web_fetch, and time to use them. Multi-source, cross-referenced. PM's Claude Code is optimized for coding workflows, not extended research.
- **Long-form strategic writing.** Architecture docs, migration plans, this document itself. Tuned for structured long-form output without accumulated code-reading tool-call pollution.
- **Cross-project synthesis.** Can hold JStudio's 6+ projects in mind simultaneously and pattern-match across them. PM is scoped to its project.
- **Fresh context per conversation.** No baggage from a running session. Good for rethinking and course correction.
- **File uploads and images.** Screenshots, PDFs, documents paste directly into the conversation.

**What CTO cannot do (and PM can):**

- **Read project files in real time.** CTO sees only what Jose pastes. PM can `cat` anything.
- **Persistent project state.** PM auto-loads `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md` every session. CTO starts from zero.
- **Execute code, bash, or Claude Code commands.** CTO can write file content here, but Jose must save it to disk.
- **Session continuity.** PM runs continuously. CTO conversations end; each new one starts fresh (backed by saved memories and canonical documents).

**Invoked when:**

1. **Starting a new project.** Write the `PROJECT_DOCUMENTATION.md` kickoff before PM session exists.
2. **Major architectural decisions** that span projects or involve external research (new Supabase features, DGII rule changes, library evaluations).
3. **Strategic checkpoints.** Every 3-5 phases, PM generates a `CTO_BRIEF.md`; Jose uploads; CTO reads, pushes back, course-corrects.
4. **Ad-hoc research questions** from PM. When PM hits a question that needs external research, PM writes a `CTO_QUESTION.md`; Jose carries to CTO; CTO responds; Jose carries answer back.
5. **Meta-work.** Updating these architecture docs, the OS, skill definitions, migration plans.
6. **When PM is stuck or over-thinking.** Fresh eyes on a thorny decision.

**Handoff mechanism:**

CTO does not live in Command Center. CTO is reached through Claude.ai (browser or desktop app). Integration with Command Center is **document-based, not session-based**:

- CTO → PM: Documents that Jose pastes into PM (kickoff docs, checkpoint responses, answers to questions)
- PM → CTO: Structured files (`CTO_BRIEF.md`, `CTO_QUESTION.md`) that Jose uploads to CTO
- State continuity: Saved memories in CTO plus the canonical project documents on disk

Three canonical templates govern these handoffs (defined in Phase M0 of the migration):

- `CTO_BRIEF.md` — periodic checkpoint from PM. Includes project snapshot, architecture decisions made, tech debt, blockers, open questions, metrics.
- `CTO_QUESTION.md` — ad-hoc question from PM when stuck. Includes context, what's been tried, what PM thinks, what decision is needed.
- `CTO_RESPONSE.md` — what CTO returns. Includes answer, reasoning, any updates to OS or standards that came out of the question.

**Does not:**

- Replace PM for in-flight projects (PM has the real-time project state)
- Write code directly
- Directly modify Commander's codebase (that's dispatched through Coder via PM)
- Make tactical decisions that depend on current project state (those go to PM)
- Know anything Jose hasn't pasted or that isn't web-searchable

### 2.6 The Team (multiple Claude Code sessions, experimental)

**Role:** Parallel autonomous execution.

**Use cases:**
- Overnight builds where three independent workstreams can proceed in parallel
- Long-running refactors across independent modules
- QA + security audit running simultaneously

**Rule:** Team mode is for **parallelism**, not for the PM-to-Coder handoff. The PM-to-Coder model is always the manual bridge described above. Team mode is a separate tool for separate work.

---

## Part 3 — Session types in Command Center

### 3.1 UI surface

The Command Center "new session" flow shows four options:

1. **PM Session** — persona-loaded, for project management and planning
2. **Coder Session** — persona-loaded, for executing phase prompts
3. **Raw Session** — no persona, plain Claude Code
4. **Team Session** — multi-session coordinated, for autonomous parallel work

### 3.2 What each session type does at spawn

| Session Type | Effort | Bootstrap File | Auto-Compact |
|---|---|---|---|
| `pm` | `high` (raisable) | `~/.claude/prompts/pm-session-bootstrap.md` | off |
| `coder` (new) | `medium` (raisable per phase) | `~/.claude/prompts/coder-session-bootstrap.md` (new) | on |
| `raw` | `medium` | none | on |
| `team` (future) | per teammate | per teammate config | per teammate |

**Changes from current state:**
- Effort defaults drop from `xhigh` to calibrated levels
- `coder` session type added (currently only `pm` and `raw` exist)
- New Coder bootstrap file created
- Auto-compact stays off for PM, on for everything else

### 3.3 What Command Center does NOT do

- Does not auto-forward messages between sessions
- Does not inject project-specific CLAUDE.md content (that's Claude Code's job via auto-loading)
- Does not configure MCP servers (user controls globally)
- Does not install hooks (separate setup)
- Does not auto-load skills (sessions invoke them as needed)

Command Center is a **session manager + visualizer**. Not an orchestrator. That's the correct shape for it.

---

## Part 4 — Project document structure

### 4.1 Canonical files per project

Every JStudio project has this structure at the project root:

```
<project>/
├── CLAUDE.md                    (local, thin, project-specific)
├── PROJECT_DOCUMENTATION.md     (master plan, written by PM)
├── STATE.md                     (active scratchpad, updated per phase)
├── DECISIONS.md                 (major decisions log, append-only)
└── .claude/
    └── settings.local.json      (project-specific Claude Code config)
```

### 4.2 File purposes

**`CLAUDE.md` (local, 500–2500 words):**

- Points to the global OS document for JStudio standards
- Lists only project-specific deviations from standards
- Project stack (React 19 / Firebase-legacy / Supabase / etc.)
- Key directories and their purposes
- Known quirks, gotchas specific to this project
- Link to `PROJECT_DOCUMENTATION.md` for the master plan

**`PROJECT_DOCUMENTATION.md` (PM-authored, updated per major milestone):**

- Project identity (client, industry, goal)
- Tech stack confirmed
- Module map with P0/P1/P2 priorities
- Database schema sketch
- RBAC matrix
- Design notes (colors, logo, radius)
- Integrations (DGII NCF types, payments, FCM, third-party APIs)
- Phase plan (current and upcoming phases)
- Open decisions requiring Jose's input

This is the file PM builds in Phase 1 of every project and updates as the project evolves.

**`STATE.md` (Coder-authored after each phase, PM reviews):**

- Current phase and status
- What shipped in the last phase
- Known issues / WIP
- Immediate next step
- Recent commits
- Any blockers

This is the single most important file for context recovery. It's updated every phase. If PM or Coder gets compacted, reading STATE.md restores working context in one file.

**`DECISIONS.md` (Jose-authored or PM-authored when Jose approves):**

- Append-only log of major architectural/product decisions
- Each entry: date, decision, rationale, alternatives considered
- Prevents revisiting settled decisions ("why did we pick Supabase over Firebase here?")

### 4.3 What lives globally, not per-project

These stay at `~/Desktop/Projects/jstudio-meta/`:

- `OPERATING_SYSTEM.md` (the OS — all JStudio conventions)
- `JSTUDIO_EFFICIENCY_PLAYBOOK.md` (token efficiency reference)
- `handoff-templates/` (PM_HANDOFF templates for ERP / Landing / Website Redesign)

These stay at `~/.claude/`:

- `skills/` (all skill definitions)
- `prompts/` (session bootstraps)
- `CLAUDE.md` (global, thin — references the JStudio OS)
- `settings.json` (global Claude Code config, hooks, MCP)

### 4.4 Naming discipline

The file names above are canonical. No more `HANDOFF.md`, `PM_HANDOFF_ELEMENTTI.md`, or other variants. Skills and automation assume `PROJECT_DOCUMENTATION.md` and `STATE.md`.

Existing projects with non-canonical names are renamed during migration (Phase 2).

---

## Part 5 — The workflow

### 5.1 Starting a new project

**Step 1 — CTO kickoff (Claude.ai).** **Always start here for a serious new project.**

Jose opens a fresh Claude.ai conversation and describes the project: client, industry, tier, goals, constraints. CTO:

- Asks clarifying questions about business model, regulatory context, technical constraints
- Does web research on anything external (industry-specific compliance, new library evaluations, competitive context)
- Cross-references other JStudio projects for patterns that apply
- Produces a complete `PROJECT_DOCUMENTATION.md` draft including:
  - Project identity (client, industry, goal, UI language, deploy target)
  - Tech stack confirmed for this project
  - Module map with P0/P1/P2 priorities
  - Database schema sketch
  - RBAC matrix
  - Design notes (colors, logo, radius, references)
  - Integrations (DGII NCF types, payments, FCM, third-party APIs)
  - Phase plan for the first 3-5 phases
  - Open decisions requiring Jose's input before Phase 1

CTO output is a downloadable file Jose saves to the project directory as `PROJECT_DOCUMENTATION.md`.

**Why this step matters:** PM is better at executing phases with live state than at initial greenfield thinking. CTO's fresh context, research tools, and cross-project view make kickoff work 5-10x more efficient. Skipping this step and going straight to PM for kickoff produces worse plans and burns more PM tokens.

**Step 2 — PM session setup (Command Center).**

Jose spawns a PM session in Command Center for the project directory (with `PROJECT_DOCUMENTATION.md` already saved there from Step 1). PM's bootstrap loads. PM reads `PROJECT_DOCUMENTATION.md` on startup.

PM's first responses:
- Confirms understanding of the project
- Initializes `STATE.md` at the project root
- Creates project-local `CLAUDE.md` with project-specific conventions
- Creates `DECISIONS.md` with any settled decisions from kickoff
- Produces the first Execution Prompt for Phase 1, including recommended model + effort level

**Step 3 — Coder session starts.**

Jose spawns a Coder session for the same project directory. Coder's bootstrap loads. Coder auto-reads `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md` at startup.

Jose pastes the Phase 1 Execution Prompt from PM. Coder reads it, executes. Coder invokes skills as directed in the prompt.

**Step 4 — Phase completion.**

Coder produces a `PHASE_REPORT` at phase completion (structured format, defined in the Coder bootstrap). Jose copies the report from Coder session and pastes it into PM session. PM reads the report, updates `STATE.md`, addresses any issues flagged, and produces the next Execution Prompt.

**Step 5 — Repeat for subsequent phases.**

Phases 2, 3, 4... follow the same loop. PM plans → Jose carries prompt to Coder → Coder executes and reports → Jose carries report back to PM → PM synthesizes → next phase.

### 5.2 Direct work with Coder (outside the phase plan)

Not every task is a formal phase. For:

- Design iteration (adjust spacing, colors, layout tweaks)
- Bug fixes (typo in error message, off-by-one in calculation)
- Small additions (new route, new validation rule)
- Visual polish (loading states, empty states, transitions)

Jose talks to Coder directly in the Coder session. No PM involvement. This is the "VSCode Claude" flow — tight, responsive, no orchestration overhead.

**When to carry direct work back to PM:**

- After a cluster of related direct work ("fixed all the modal issues today")
- When direct work revealed a pattern that should be captured in standards
- When a decision was made during direct work that needs to be in `DECISIONS.md`

Jose either updates STATE.md himself or tells PM ("today I shipped X, Y, Z outside the phase plan — update STATE.md"). Keeps PM's map of reality accurate.

### 5.3 Strategic checkpoint (CTO_BRIEF flow)

Every 3-5 phases, or when the project hits a major decision point, PM generates a `CTO_BRIEF.md`. The brief is a structured report designed for CTO to consume fresh.

**CTO_BRIEF.md contents (canonical format):**

- Project snapshot (current phase, what's shipped, stack in use)
- Architecture decisions made since last brief
- Tech debt accumulated (with severity)
- Skill performance (which skills were invoked, which produced good/bad output)
- Blockers and open questions for CTO
- Metrics (token burn, phase velocity, test coverage if relevant)
- Recommended improvements to PM practice or OS standards

PM offers to generate this every 3 phases automatically. Jose can also request on demand.

**The checkpoint loop:**

1. PM generates `CTO_BRIEF.md`, saves to project `docs/briefs/` directory
2. Jose uploads the brief to CTO (Claude.ai)
3. CTO reads, researches if needed, cross-references other projects
4. CTO responds with `CTO_RESPONSE.md`: answers to questions, course corrections, updates to OS if needed, direction for the next phase range
5. Jose pastes CTO_RESPONSE into PM session
6. PM absorbs, updates PROJECT_DOCUMENTATION.md if needed, continues with adjusted direction

**Why this works:**

- PM doesn't have to do CTO-level research — it's expensive in PM's working context
- CTO doesn't have to hold live state — it gets a structured snapshot
- Jose stays in control of both — sees every brief, every response, every direction change
- Decisions get logged (CTO_RESPONSE goes into `docs/briefs/` alongside the brief)

### 5.4 Ad-hoc CTO questions (CTO_QUESTION flow)

Between scheduled checkpoints, PM sometimes hits questions that need CTO-level research or thinking. Examples:

- "Should we use this new Supabase feature for X?"
- "Client is asking about feature Y — is the DGII rule we know about still current?"
- "I'm stuck between two architectural approaches for Z — what's the right call?"

Instead of PM burning tokens on deep research, PM writes a `CTO_QUESTION.md` with:

- Context (what project, what phase, what led to the question)
- What's been tried or considered
- PM's leaning if any
- What decision is needed

Jose uploads to CTO. CTO researches, responds (as `CTO_RESPONSE.md`), Jose pastes back to PM. Same loop as the scheduled brief, just smaller and triggered on demand.

### 5.5 Who reads what

| Document | PM reads | Coder reads | CTO reads |
|---|---|---|---|
| Global OS | on demand | on demand | on demand |
| Global skills | on demand | when invoked | on demand |
| `PROJECT_DOCUMENTATION.md` | every session | referenced in dispatch | on checkpoint (Jose pastes or summarizes) |
| `STATE.md` | every session | every dispatch | on checkpoint (Jose pastes or summarizes) |
| `DECISIONS.md` | on demand | on demand | on demand |
| project `CLAUDE.md` | auto-loaded | auto-loaded | on demand (Jose pastes) |
| `CTO_BRIEF.md` | PM authors | n/a | CTO consumes |
| `CTO_RESPONSE.md` | PM consumes | n/a | CTO authors |
| `CTO_QUESTION.md` | PM authors (or Jose) | n/a | CTO consumes |

---

## Part 6 — The skills

### 6.1 Role

Skills encode JStudio conventions. They are knowledge modules invoked when relevant. They are not orchestration templates, not auto-loaded, not persistent session personas.

### 6.2 Current skill usage (Jose's actual pattern)

From Jose's direct statement:

| Skill | Usage |
|---|---|
| `/pm` | Every PM session (as the persona) |
| `/db-architect` | Occasional, mostly knowledge reference |
| `/scaffold` | Occasional |
| `/qa` | Phase boundaries |
| `/security` | Phase boundaries (parallel to `/qa`) |
| `/ui-expert` | When UI work happens |
| `/landing` | Rarely — reference knowledge for landing page work |
| `/supabase-cli` | As needed for DB operations |
| `/e2e-testing` | Not currently used |
| `ui-ux-pro-max` | When deep UI/UX guidance needed |
| `/licitacion` | Future (when Licitaciones tool is built out) |

### 6.3 Skill loading model

- Skills are in `~/.claude/skills/`. Claude Code discovers them automatically when relevant to the task.
- Skills are NOT preloaded into session context at spawn.
- PM references skills in Execution Prompts: "When implementing the dashboard shell, invoke `/ui-expert` for component patterns."
- Coder invokes skills when directed or when the task matches their description.
- Jose can invoke any skill manually in any session via slash command or natural language reference.

### 6.4 Skill health

After migration, skills get a light audit:
- `e2e-testing` marked deprioritized (Jose doesn't use it)
- `licitacion` stays but marked as future (when RODECO tool launches)
- `landing` stays but marked as reference knowledge (not instruction)
- Active skills confirmed aligned with current OS (no stale conflicts)

### 6.5 Model and effort selection framework (for PM)

When PM writes an Execution Prompt for Coder, it recommends a model and effort level. This is not a guess — it follows a framework based on the phase type and expected complexity.

**Model tiers (Claude Code available models):**

- **Opus 4.7** — highest capability, highest cost. For deep reasoning, architecture, complex refactors, anything where a wrong call is expensive to undo.
- **Sonnet 4.6** — strong generalist, much cheaper. For most execution work — feature modules, standard CRUD, UI implementation, tests.
- **Haiku 4.5** — fast and cheap. For mechanical tasks, bulk edits, simple transformations, file renames, template filling.

**Effort levels (via `/effort` command):**

- **`low`** — minimal thinking, fast. For mechanical work where the answer is obvious.
- **`medium`** — default for most execution. Some thinking, reasonable structure.
- **`high`** — deeper thinking. For work with multiple paths to consider or tradeoffs to weigh.
- **`xhigh`** — maximum thinking. For architecture, ambiguous debugging, irreversible decisions.

**PM's recommendation rubric:**

| Phase type | Model | Effort | Rationale |
|---|---|---|---|
| Initial architecture (Phase 1: DB + auth + theme) | Opus 4.7 | high | Decisions here compound; invest in depth |
| Shell & navigation (Phase 2) | Opus 4.7 | medium | Conventions established, execution focus |
| Feature module (typical CRUD) | Sonnet 4.6 | medium | Proven patterns apply; Sonnet is enough |
| Feature module (complex logic, state machines) | Opus 4.7 | high | Complexity warrants better model |
| UI polish pass | Sonnet 4.6 | low | Visual iteration, obvious fixes |
| Bulk refactor (rename, extract, reorganize) | Haiku 4.5 | low | Mechanical; don't pay for thinking |
| Bug fix (reproducible, scoped) | Sonnet 4.6 | medium | Standard investigation + fix |
| Bug fix (mysterious, multi-file) | Opus 4.7 | high | Root cause analysis needs depth |
| QA audit (`/qa`) | Opus 4.7 | high | Read-only, thorough review justified |
| Security audit (`/security`) | Opus 4.7 | high | Same reasoning; high-stakes output |
| Landing page content + structure | Sonnet 4.6 | medium | Creative but well-bounded |
| Migration from one stack to another | Opus 4.7 | xhigh | High risk, needs deep thinking |

**How PM surfaces this in Execution Prompts:**

Every Execution Prompt includes a header like:

```
## Phase 3 — Inmuebles feature module
**Recommended model:** Sonnet 4.6
**Recommended effort:** medium
**Estimated duration:** ~45 min coder time
**Why:** Standard feature module. DB table is simple (no complex relations beyond tenant_id). UI is list + form + detail. Proven pattern from JLP Sociedades module.

**If Coder should adjust:** raise to Opus+high if the schema needs anything beyond standard shape (e.g., tenant-shared records, soft-delete edge cases).
```

Coder reads this and can set its own effort via `/effort <level>` before starting. Model selection happens at session spawn (for new sessions) or mid-session via `/model <name>` if changing.

**When PM should recommend changing model mid-project:**

If a phase comes up that needs different capability than the current session, PM notes it: *"This phase warrants Opus 4.7 — either spawn a new Coder session with `--model claude-opus-4-7` or switch current session via `/model`."*

This keeps the human (Jose) in the loop for model choices that cost real money / rate limit.

---

## Part 7 — Command Center UI enhancements

### 7.1 Project view

A new top-level "Projects" view in Command Center. For each project:

- Name, client, industry
- Tech stack badges
- Current phase (from STATE.md)
- Recent activity (last phase shipped, last commit)
- Session tabs for PM and Coder for this project
- Direct links to `PROJECT_DOCUMENTATION.md` and `STATE.md`

This is display-only — Command Center reads the files, renders the view. It doesn't mutate them.

### 7.2 Session type selector (refined)

The new session modal shows:

- **PM** — "Strategic planning, architecture, phase management"
- **Coder** — "Tactical execution of phase prompts" (new)
- **Raw** — "Plain Claude Code, no persona"
- **Team** — "Multi-session parallel work (experimental)" (future)

Each has a one-line description in the UI explaining when to use it.

### 7.3 Skill invocation panel (optional, low priority)

A sidebar showing available skills with quick-invoke buttons. Clicking injects the invocation into the active session. Not critical — Jose can type `/ui-expert` himself — but a nice affordance.

### 7.4 Effort indicator (new)

Each session card shows its current effort level. Effort can be changed via UI (injects `/effort <level>` into the session). This gives Jose visibility into what level of thinking is active and lets him adjust mid-session.

---

## Part 8 — What explicitly changes from current state

Quick reference of deltas:

1. **`/effort xhigh` at spawn** → effort calibrated by session type (PM: high, Coder: medium, Raw: medium)
2. **No Coder session type** → new `coder` session type with its own bootstrap
3. **Filename drift across projects** → canonical names enforced (`PROJECT_DOCUMENTATION.md`, `STATE.md`)
4. **No local CLAUDE.md per project** → thin project-local `CLAUDE.md` everywhere
5. **PM auto-forwards to Coder (broken)** → PM writes Execution Prompts for Jose to paste manually
6. **Coder auto-forwards to PM (broken)** → Coder produces PHASE_REPORTs for Jose to paste to PM
7. **Skills auto-loaded** → skills invoked on demand, referenced in dispatches
8. **No project view in Command Center** → Projects dashboard with phase/state visualization
9. **Bootstrap file grown bloated** → tightened PM bootstrap closer to Gemini model's focus
10. **No effort visibility** → effort shown per session card, adjustable via UI

---

## Part 9 — What explicitly does NOT change

These work today and stay:

1. Command Center as a session spawner and visualizer
2. Session state machine (Phase U.1 four-layer defense)
3. tmux-based session management
4. Hook integration (Stop / SessionStart / SessionEnd)
5. JSONL-based session binding (Patch 0)
6. Split-screen pane layout
7. WebSocket activity streaming
8. Cloudflare tunnel + PIN auth
9. The JStudio OS document and efficiency playbook
10. All the skill content (just changed in how it's loaded)
11. Agent teams feature (stays as the "team session" option for genuinely parallel work)

---

## Part 10 — Success criteria

The architecture is working when:

1. **Simple tasks cost simple tokens.** A "fix the modal spacing" task in a Coder session costs under 10k output tokens. Currently 30-50k+.
2. **PM and Coder stay clean.** PM context doesn't accumulate Coder tool-call noise. Coder context doesn't accumulate PM deliberation.
3. **Jose feels in control.** Every handoff is visible. Nothing happens without his explicit action.
4. **Project visibility is instant.** Opening Command Center shows project state at a glance.
5. **Filename conventions hold.** Every project has the same structure. Skills find what they expect.
6. **Effort matches task.** No more xhigh for trivial fixes. Effort scales up when thinking actually helps.
7. **It feels like VSCode Claude.** Direct, responsive, doesn't over-explore, doesn't second-guess.

When all seven are true, the migration is done.

---

## Part 11 — Project-type standards structure

### 11.1 Why project types need their own standards

The JStudio OS document is strong on ERP-specific rules: DGII compliance, multi-tenant RLS, kardex, audit logs, ITBIS. But landing pages don't use any of that. A Firebase-legacy SaaS has different patterns than a Supabase-new ERP. A client portal has different RBAC needs than a public-facing website.

Forcing every project type through the same OS reads produces:
- PM/Coder loads irrelevant rules for the project type
- Standards conflict when a landing page gets ERP-shaped advice
- Context gets bloated with rules that don't apply

Better: the OS holds the **common core** (JStudio-wide rules that apply to every project regardless of type), and **project-type companion docs** hold the rules specific to that type.

### 11.2 The structure

```
~/Desktop/Projects/jstudio-meta/
├── OPERATING_SYSTEM.md              (common core — applies to all projects)
├── standards/
│   ├── ERP_STANDARDS.md             (multi-tenant, DGII, RLS, kardex, etc.)
│   ├── LANDING_STANDARDS.md         (brand fit, perf, SEO, content patterns)
│   ├── REDESIGN_STANDARDS.md        (Firecrawl discovery, SEO migration, etc.)
│   ├── PORTAL_STANDARDS.md          (client portal patterns, RBAC for external users)
│   ├── DASHBOARD_STANDARDS.md       (analytics/intelligence dashboards like PP Seguros)
│   └── SAAS_STANDARDS.md            (multi-tenant SaaS without full ERP features)
└── handoff-templates/
    ├── erp-handoff-template.md
    ├── landing-handoff-template.md
    ├── redesign-handoff-template.md
    └── ...
```

### 11.3 Loading model

Each project's `CLAUDE.md` declares its type:

```markdown
# Project CLAUDE.md

**Project type:** ERP (multi-tenant, DGII)
**Standards:**
- ~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md (common core)
- ~/Desktop/Projects/jstudio-meta/standards/ERP_STANDARDS.md (project-type rules)
```

PM and Coder sessions read the project CLAUDE.md at startup, which points them to the relevant standards. They don't load irrelevant standards for other project types.

### 11.4 What goes in the common OS vs project-type standards

**Common OS (applies always):**
- JStudio naming conventions (Montserrat, RD$ locale, English code)
- Git discipline (atomic commits, conventional commit messages)
- Skill invocation patterns
- Efficiency standards (§20)
- CTO reporting protocol
- Session-type definitions (PM/Coder/Raw)
- File organization (canonical names)

**Moves to ERP_STANDARDS.md:**
- Multi-tenant patterns (tenant_id, RLS, auth_tenant_id helper)
- DGII compliance (NCF sequences, ITBIS, tax tables)
- Kardex pattern (adjust_stock RPC)
- Per-tenant counter tables
- Dual-entity billing patterns
- Employee signup flow (temp Supabase client)

**Moves to LANDING_STANDARDS.md:**
- Brand-fit design (landings CAN break glass default)
- Performance targets (LCP, CLS, TBT)
- SEO requirements (meta, OG, structured data)
- Content patterns (hero sections, feature grids, testimonials)
- Mobile-first but non-data layouts

**Moves to REDESIGN_STANDARDS.md:**
- Firecrawl discovery flow
- SEO migration planning (301 mapping, sitemap)
- Performance improvement targets vs existing site
- Content preservation vs reinvention balance

**Moves to DASHBOARD_STANDARDS.md:**
- Data-heavy UI patterns (tables, charts, filters)
- Firestore vs Supabase patterns (PP Seguros is Firebase-legacy)
- Real-time data handling
- Export/download patterns
- Analytics-specific UX (drill-downs, cohort analysis)

**Moves to PORTAL_STANDARDS.md:**
- External-user RBAC (clients, not employees)
- Invitation + onboarding flows
- Document sharing patterns
- Client-facing design (different from internal admin)

**Moves to SAAS_STANDARDS.md:**
- Subscription/billing patterns
- Usage-based metering
- Multi-tenant without DGII (non-DR or non-ERP SaaS)

### 11.5 Migration path for this part

Extracting project-type standards from the current OS happens in Phase M3.5 of the migration. It's a light extraction — the content already exists in the OS, it just gets reorganized into companion files with the common core remaining in OS itself.

**Important:** Don't split too aggressively. If something could reasonably apply to 2+ project types, keep it in the common OS. Only move to project-type standards what is genuinely project-type-specific.

---

## Part 12 — Document glossary

Quick reference for every document name in this architecture, in one place.

**Global (JStudio-wide):**

- `OPERATING_SYSTEM.md` — common JStudio core rules
- `JSTUDIO_EFFICIENCY_PLAYBOOK.md` — token efficiency reference
- `standards/*.md` — per-project-type standards (ERP, Landing, etc.)
- `handoff-templates/*.md` — templates for PROJECT_DOCUMENTATION per project type

**Per-project (at project root):**

- `CLAUDE.md` — project-specific context, points to applicable standards, <3k tokens
- `PROJECT_DOCUMENTATION.md` — master plan, written by CTO at kickoff, maintained by PM
- `STATE.md` — active scratchpad, updated every phase
- `DECISIONS.md` — append-only log of major decisions

**Per-project (in `docs/briefs/` or similar):**

- `CTO_BRIEF.md` — checkpoint reports from PM to CTO (versioned: `CTO_BRIEF_2026-04-18.md`)
- `CTO_QUESTION.md` — ad-hoc questions from PM to CTO
- `CTO_RESPONSE.md` — CTO's responses back
- `PHASE_REPORT.md` — Coder reports per phase (versioned: `PHASE_03_REPORT.md`)

**Session-level (in `~/.claude/prompts/`):**

- `pm-session-bootstrap.md` — PM persona loaded at PM session start
- `coder-session-bootstrap.md` — Coder persona loaded at Coder session start

**Templates (in `~/Desktop/Projects/jstudio-meta/templates/`):**

- `project-claude-md-template.md` — template for new project CLAUDE.md
- `project-documentation-template.md` — template for PROJECT_DOCUMENTATION.md
- `state-md-template.md` — template for STATE.md
- `cto-brief-template.md` — template for CTO_BRIEF.md
- `cto-question-template.md` — template for CTO_QUESTION.md
- `cto-response-template.md` — template for CTO_RESPONSE.md
- `phase-report-template.md` — template for PHASE_REPORT.md

---

**End of architecture document. For migration path, see `MIGRATION_PLAN.md`.**
