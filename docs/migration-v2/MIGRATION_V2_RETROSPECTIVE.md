# Migration v2 — Retrospective

**Author:** CTO (Claude.ai)
**Date:** 2026-04-22
**Status:** Final — migration v2 closed, operating-model invariants banked, continuity mapped to native Commander v1.
**Location:** `~/Desktop/Projects/jstudio-commander/docs/migration-v2/RETROSPECTIVE.md`
**Preceding docs:** `MIGRATION_STATE.md` (12/12 complete, 2026-04-20), `MIGRATION_PLAN.md`, `MIGRATION_CHECKLIST_per_project.md`, `COMMAND_CENTER_ARCHITECTURE_v2.md`, `M9_AUDIT.md`
**Companion docs:** `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` (N0 D1), `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (N0 D2)

---

## §0 — Why this document exists

Migration v2 shipped. All twelve milestones landed. The operating system codified. Commander Finalizer closed the Phase Y arc via ground-truth pivot. The portfolio stabilized.

This document closes the chapter honestly — what we set out to do, what we actually delivered, what we did not deliver, what we learned, and what survives into native Commander v1.

It is not a celebration doc. It is an audit. The goal is that a CTO session six months from now can read this and understand the shape of the migration without guessing at what was in our heads.

It is also load-bearing for v1. Every operating-model invariant we banked during v2 carries forward into v1. Every architectural limitation we hit in v2 informs the ground-up rebuild. If this retrospective is sloppy, v1 inherits the sloppiness.

---

## §1 — What migration v2 set out to do

Migration v2 was scoped in `MIGRATION_PLAN.md` as a nine-milestone arc (M1-M9) with the goal of:

1. Normalizing every JStudio project onto a canonical four-file root structure (`CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`, `DECISIONS.md`).
2. Ratifying a single `OPERATING_SYSTEM.md` at `jstudio-meta` that all sessions load.
3. Establishing three-role discipline (CTO on Claude.ai, PM on Claude Code opus high, CODER on Claude Code opus medium) with manual-bridge invariant.
4. Shipping a Commander tool capable of real-time operational awareness across 3-5 concurrent sessions.
5. Banking standards files for the recurring project shapes (LANDING, DASHBOARD, REDESIGN, INVESTIGATION_DISCIPLINE).
6. Tightening cost governance through per-session effort control + 5-hour rolling budget visibility.

The plan's explicit non-goal was a native desktop Commander. The plan assumed Commander would stay web for at least another twelve months. Phase Z (native wrapper scoping) was added late, 2026-04-20, as a response to accumulated evidence that the web platform had structural ceilings the plan hadn't anticipated.

---

## §2 — What actually shipped

All twelve milestones landed. Scope delta between plan and delivery:

### 2.1 — Milestones as planned (M1-M9)

- **M1 — Canonical four-file structure** rolled out across all active projects. Every project's root has the four files; PM sessions and CODER sessions load them in the right order per `CLAUDE.md`'s thin header.
- **M2 — OPERATING_SYSTEM.md consolidation** at `jstudio-meta`. Single authoritative doc. 1689 lines at close. Versioned via the §23 changelog mechanism.
- **M3 — Three-role model codified.** OS §3.1-§3.4 locks the separation. Manual-bridge invariant is constitutional. No auto-forwarding exists anywhere in the codebase; M6 audit confirmed.
- **M3.6 — Skill audit + ERP_STANDARDS stale-reference cleanup.** Recon-closed 2026-04-19. Single commit with §23 changelog v4 entry + bootstrap ERP_STANDARDS stale-ref deletion + OS §20.LL-L13/L14 additions. Firebase deploy dry-run clean.
- **M4 — Commander M4 Primary.** `pm-session` + `coder-session` types shipped. Per-type bootstrap injection. `resolveSessionCwd` SSOT fix for Issue 10.
- **M5 — Commander M5.** Session `effort` column + default per type. Token analytics pipeline (`session_ticks`, `cost_entries`, `TOKEN_ANALYTICS_*.md` rolling reports). DGII patterns codified in `OS §13`.
- **M6 — Manual-bridge audit.** Confirmed zero auto-forwarding code. Teammate relationships display-only. Approval-path (Item 3) verified sacred; byte-identical semantics through every rotation.
- **M7 — Project state drawer.** MVP shipped STATE.md live view per session via `watcher-bridge.ts` + chokidar. Full M7 scope (four-file tabbed view, project-type badge, recent activity feed, DECISIONS filter, drawer preference persistence) deferred — carries forward into v1 as §7 full scope.
- **M8 — Effort adjust surfaces.** Primary: `SessionCard.tsx` click-to-adjust. Secondary: `CreateSessionModal.tsx` spawn-time override. Both stable post-M8.
- **M9 — Standards + skill inventory.** `LANDING_STANDARDS.md`, `DASHBOARD_STANDARDS.md`, `REDESIGN_STANDARDS.md`, `INVESTIGATION_DISCIPLINE.md` authored and landed. `M9_AUDIT.md` output skill audit.

### 2.2 — Milestones added mid-migration

- **Commander Finalizer Part 1 + Part 2.** Not in original plan. Added after Phase Y arc's fifth rotation closed without full stability. Finalizer Track 1 (pane-activity subscription ground truth) + Track 2 (session.status string derivation removal) + Track 3 (display-layer polish for C36/C39/C42/C44). Shipped via commits `0c87230`, `2da88c1`, `1ec2d47`, `a6ca156`, `94536b5`, `93312e4`. Closed 2026-04-22 via the `CTO_BRIEF_COMMANDER_FINALIZER_CLOSED.md` dispatch.
- **Phase T pane-activity mirror.** Added to workaround the web platform's transcript-pipeline lag. `TmuxMirror.tsx` + `useSessionPaneActivity` + `session:pane-capture` WS channel at 1.5s polling cadence. Structurally replaced in v1 by real xterm.js; see §6.3 for the architectural ceiling this exposed.
- **OS §20.LL-L11 through L14** (investigation discipline, pattern-matching discipline, plain-language reframe as architectural signal, ground-truth over derivation). Authored in response to specific failure modes encountered mid-migration. Load-bearing for both v2 closure and v1 authoring.

### 2.3 — Deferred in-plan items carried to v1

- Full M7 project pane (four-file tabbed view, project metadata display).
- Dedicated analytics page (per-project / per-model / per-session-type breakdowns, optimization insights, export). Real-time metrics (5h / 7d budget, per-session context-window %) did ship in v2; dedicated analytics deferred to v1.1 per §16.3 ratification.
- Three-role unified UI — the biggest qualitative v1 leap. Not in v2 plan; scoped as part of v1 per Deliverable 1 §12.

### 2.4 — Items dropped from plan without regret

- **Commander cross-device sync.** Web Commander was accessed from two machines for ~3 weeks. Philosophically against local-first premise; deleted from backlog.
- **Commander mobile companion.** Speculative from plan. No product need surfaced in 8 months of use. Deleted.
- **Per-session cost cap enforcement.** Considered mid-M5. Decided cost visibility > cost gating: Jose is the decision-maker, budget is a tool not a fence. Deleted.

---

## §3 — The Phase Y arc — what it was, why it closed when it did

Migration v2's largest unplanned expense was the Phase Y arc: a sequence of five rotations attempting to stabilize real-time chat status (`working` / `idle` / `waiting` / `composing`) in the web Commander UI.

### 3.1 — The failure shape

Every rotation derived status from a different combination of proxies:

- Rotation 1: `useChat.messages[-1].type` last-block shape matching.
- Rotation 2: `useToolExecutionState` hook inferring from tool_use/tool_result pairing.
- Rotation 3: Temporal gate stacking (`typedIdleFreshKillSwitch`, `lastTurnEndTs`, `isSessionWorking` OR-chain).
- Rotation 4: Parallel-run predicate chain (`resolveActionLabelForParallelRun`, Fix 1/2/Option 2/4).
- Rotation 5: Activity-gap detector + heartbeat-stale gate + `useCodemanDiffLogger` parallel-run comparison.

Each rotation closed ~60-80% of the cases but opened a new residual. Class 2 divergences (legacy fallback leak) stayed at ~56% of JSONL entries until Finalizer Track 2 surgically removed the derivation chain.

### 3.2 — What finally closed it

**Finalizer Track 1** subscribed ContextBar directly to `session:pane-capture` events (Phase T's 1.5s pane-text diff channel). That subscription was closer to ground truth than any derivation chain because the pane text itself is the ground truth — the whole derivation apparatus was reconstructing what a capture already had.

That pivot banked the lesson codified in **OS §20.LL-L14: ground-truth signals beat derivation chains**. It also revealed that the Phase T mirror was the structurally correct signal source, not the patched-over workaround it had been positioned as.

### 3.3 — Why v1 eliminates the whole class

Pane-capture polling at 1.5s is better than derivation-chain inference, but it is still a sampled proxy for the pty itself. V1's node-pty direct attach + OSC 133 shell integration observes the ground-truth source without any sampling. The capture-and-re-render pattern becomes unnecessary. The whole derivation apparatus (`useToolExecutionState`, `resolveEffectiveStatus`, `resolveActionLabelForParallelRun`, codeman-diff logger, debug.routes.ts, all 15.3-arc legacy guards) can be deleted rather than ported.

This is why v1 is a rebuild, not a wrapper. The wrapper option was seriously considered (ratified as Phase Z on 2026-04-20, scoped in `PHASE_Z_NATIVE_APP_PLAN.md`) and then displaced by the ground-up spec after N1 Attempt 1's 8 unilateral-decision debrief surfaced the gap between "what Tauri wrap preserves" and "what web Commander's architectural ceiling prevents."

### 3.4 — Cost of the Phase Y arc

Five rotations. Roughly 120-150 hours of PM + CODER time. Roughly $8-12k of token spend (rough estimate from TOKEN_ANALYTICS rolling reports, not precisely calculated because the cost-reporting divergence bug itself was one of the issues).

The cost was not wasted. It produced:

- OS §20.LL-L11 (investigation discipline): stop patching when the investigation reveals a structural ceiling.
- OS §20.LL-L12 (pattern-matching discipline): character-level shape matching is fragile; typed signals are load-bearing.
- OS §20.LL-L13 (plain-language reframe as architectural signal): when the user describes the system to a new dev and the description doesn't match the code, the code is wrong.
- OS §20.LL-L14 (ground-truth over derivation): observe the source signal when one exists.

These four principles are now the single most valuable artifact of migration v2. They cost what they cost; they paid for themselves at Finalizer close and will keep paying across v1-v∞.

---

## §4 — Operating-model invariants — what survives into v1

This is the load-bearing section for v1 continuity. Every invariant below ships forward into native Commander v1 without modification. V1's primitives change; the operating model does not.

### 4.1 — Manual-bridge invariant (OS §3.4, §14.1)

Jose is the sole routing agent between CTO ↔ PM ↔ CODER. No persona bypass, no auto-forwarding, no auto-dispatch. Every inter-role document transit requires Jose pressing a button, copying text, pasting into another surface.

V1 preserves this at the UI level. The three-role UI (brief-review + dispatch-compose + report-consumption panes) reduces bridge friction without removing agency. "Copy to CODER" puts text on clipboard + highlights the CODER pane — it does not auto-send. "Route PHASE_REPORT to parent PM" opens the PM pane with the report loaded — it does not auto-submit.

This is the single most-tested invariant of the whole operating model. Every attempt to shortcut it (consciously or via accidental auto-forwarding code) was caught and reverted. The invariant held across all five Phase Y rotations, the Finalizer arc, and the N1 Attempt 1 debrief.

### 4.2 — Three-role separation (OS §3.1-§3.3)

- **CTO** (Claude.ai, this thread): strategic, architectural, cross-project. Long context windows. High cost per session; few sessions per day. Responsible for architectural decisions, phase planning, cross-project invariants.
- **PM** (Claude Code opus high): tactical, per-project. Reads OS + project docs on every bootstrap. Drafts dispatches to CODER. Reviews PHASE_REPORTs. Manages STATE.md.
- **CODER** (Claude Code opus medium): executional. Follows dispatches exactly. Writes code. Reports back via PHASE_REPORT. Does not drift scope.

Bootstrap injection enforces persona. Effort defaults match role cost-shape. The separation held across migration v2 with one notable incident (Phase Y Rotation 3 where a PM session drafted dispatches that were architectural rather than tactical — caught on review, corrected by rewriting the dispatch after CTO review).

### 4.3 — Canonical four-file project structure (OS §6)

Every active JStudio project has at its root:

- `CLAUDE.md` — thin header, loaded every session, project-specific facts only.
- `PROJECT_DOCUMENTATION.md` — master plan, CTO-authored at kickoff, PM-maintained.
- `STATE.md` — active scratchpad, updated every phase.
- `DECISIONS.md` — append-only log of major decisions with rationale.

The structure survived every migration and every project-scope change. New projects spawned mid-migration adopted the structure from day one. Projects that pre-existed migration v1 were retrofitted during M1. Zero regressions.

V1 preserves the structure. V1's project-view surface (§7.2 of Deliverable 1, §9.4 of Architecture v2) reads the four files natively.

### 4.4 — Investigation discipline (OS §20.LL-L11, L12, INVESTIGATION_DISCIPLINE.md)

Three sub-principles:

- **L11 — Stop patching when investigation reveals a ceiling.** If the current architectural layer cannot support the required behavior, stop adding workarounds. Escalate to architectural reframe.
- **L12 — Pattern-matching discipline.** Character-level shape matches against external tool output are brittle. Typed signals beat shape matches every time. Never infer from text shape when a structured event is available.
- **INVESTIGATION_DISCIPLINE.md** — the process doc for running an investigation to closure without scope creep, without premature patching, without reopening decisions.

V1 preserves all three. V1's typed renderer registry (§11) and typed state machine (§5.5) are direct applications of L12. V1's whole rebuild-vs-wrap decision is a direct application of L11.

### 4.5 — Ground-truth over derivation (OS §20.LL-L14)

When a ground-truth signal is available, observe it directly. Derivation chains that compute a proxy are rejected unless no ground-truth source exists.

V1 is largely an architectural expression of this principle. Node-pty direct attach replaces tmux capture polling. OSC 133 shell markers replace pane-regex classification. FSEvents replace chokidar polling. The state machine is driven by observed pty events, not reconstructed from downstream text.

### 4.6 — Plain-language reframe (OS §20.LL-L13)

When the user describes the system to a new dev in plain English and the description doesn't match the code, the code is wrong.

The strongest application of this principle was the moment Jose described web Commander as "I want to see what Claude Code sees" and the web architecture required Jose to NOT see what Claude Code sees (it derived a proxy). That plain-language description forced the architectural reframe. V1 implements the plain-language description directly: xterm.js shows what pty shows, byte-for-byte.

V1 dispatches during N1-N6 carry this as a forcing function: if the dispatch language diverges from how Jose would describe the acceptance criterion, the dispatch is miswritten.

### 4.7 — Item 3 sacred (approval modal byte-identical semantics)

Commander Finalizer Part 2's approval-path carrying over is non-negotiable. `usePromptDetection`, `PermissionPrompt.tsx` mount behavior, ContextBar waiting-passthrough in `resolveEffectiveStatus` — the exact consent surface Jose interacts with for every CODER permission request — must survive byte-identical into v1.

V1 implements it via typed `approval:prompt` events from the JSONL watcher (replacing the fragile pane-regex approval detection) routed to a `PermissionPrompt` component. The UI shape is preserved; the underlying detection mechanism is architecturally improved. V1 validation: the approval flow passes Jose's dogfood smoke-test with zero perceptible difference from web.

### 4.8 — Bootstrap injection invariant (OS §23.3)

PM sessions inject `pm-session-bootstrap.md` before Jose's first prompt is visible. CODER sessions inject `coder-session-bootstrap.md` similarly. Raw sessions skip bootstrap (bare Claude Code). No session type is loaded without its persona injection, and no session type is loaded with the wrong persona.

V1 preserves this via spawn-time pty write — the first bytes written to pty after attach are the bootstrap file contents. Jose never sees "empty Claude Code" UI state.

### 4.9 — `resolveSessionCwd` SSOT (OS §23.3 Issue 10)

Session cwd resolution has a single source of truth. Historical bug (Issue 10) was `execFile('tmux', ['new-session', '-c', '~/...'])` not expanding `~`. Fixed via `resolveSessionCwd` helper; stable since 2026-04-18.

V1 preserves the helper. Node-pty cwd option receives the already-resolved path.

### 4.10 — Pattern-matching discipline in dispatches (OS §24)

Dispatches to CODER must describe acceptance criteria in typed signal terms, not in text-shape terms. "When the session's OSC 133 CommandEnd event fires with exit code 0, the ContextBar status flips to idle" is a typed-signal dispatch. "When the terminal shows a prompt character, the status flips to idle" is a shape-match dispatch and rejected.

V1 dispatches (N1-N6) carry this forward. Every acceptance criterion in ARCHITECTURE_SPEC.md v1.2 §9 is a typed-signal criterion by design.

---

## §5 — Skills-as-knowledge-modules — what migration v2 banked

Migration v2 did not produce a formal skill system but did produce the raw material for one. `LANDING_STANDARDS.md`, `DASHBOARD_STANDARDS.md`, `REDESIGN_STANDARDS.md`, `INVESTIGATION_DISCIPLINE.md` are knowledge modules that CTO + PM + CODER load conditionally based on the shape of the work.

The pattern:

- Standards files live at `~/Desktop/Projects/jstudio-meta/standards/*.md`.
- Dispatches reference them by path when applicable: "apply `standards/LANDING_STANDARDS.md` §4 for the hero section."
- Standards files are versioned + changelogged inline.
- No runtime loading mechanism — Jose pastes the path into a dispatch, the receiving session reads it at bootstrap time via file read.

V1 preserves this. No bundled skills inside the Commander app; standards stay as file-system artifacts at `jstudio-meta`. V1 adds: filesystem watching so if a standard is edited mid-session, subsequent bootstraps pick up the change automatically (vs. stale until next full session spawn).

Future v2+ scope may add a formal skill registry within the app. Not in v1.

---

## §6 — Architectural ceilings web Commander hit

Four architectural limitations made themselves felt during migration v2. Each is named here so v1's design can be evaluated against whether it escapes them.

### 6.1 — Transcript pipeline lag

Web Commander read Claude Code's JSONL transcript as the authoritative event source. JSONL writes are batched by Claude Code at turn boundaries — in-progress tool execution, thinking blocks, and streaming text don't appear in JSONL until the turn ends (or a sub-turn boundary fires). This meant the UI perpetually trailed reality by 1-3 seconds.

The whole Phase Y arc was an attempt to work around this. Every rotation added derivation paths trying to guess what was happening between JSONL writes. The fundamental structural fix — observing pty directly — was only possible architecturally in native.

**V1 escape:** node-pty direct attach observes every byte Claude Code writes, in real time. JSONL becomes secondary (used for persistent history + tool-result dispatch), not primary (not used for status inference).

### 6.2 — tmux shell-out latency

Web Commander spawned sessions via `tmux new-session -c <cwd>` and sent input via `tmux send-keys -t <pane> -l <text>`. Every send traversed: client → Fastify server → Node `execFile('tmux')` → tmux socket → pane stdin. Typical round-trip: 50-200ms on macOS, occasionally higher under load.

This was not critical-path for correctness but was perceptible for interactive use. It also introduced failure modes (Candidate 37: stale-pane stderr when tmux panes were force-closed; Candidate 45: detectExistingCommander IPv4/IPv6 resolver race) that didn't exist in a pty-direct model.

**V1 escape:** xterm.js `onData` handler writes to sidecar WebSocket → sidecar writes to `pty.stdin`. Round-trip: ≤30ms on localhost. No tmux layer, no send-keys shell-out, no stale-pane failure mode.

### 6.3 — Pane-capture as approximation

Phase T's 1.5s `tmux capture-pane` polling was the closest-to-ground-truth signal web Commander could reach. It closed most of the Phase Y residual. But it is still an approximation: it samples, it polls, it re-renders captured text via `ansi_up`. Fast updates (spinners, progress bars, cursor animations) are lost or flicker. Multi-pane interaction (Candidate 36 effort display leak) exposed a shared-channel bug that required per-session isolation to resolve.

**V1 escape:** xterm.js per session is not a mirror — it IS the rendering surface. No sampling, no polling, no `ansi_up` conversion. Every byte pty writes renders at native terminal cadence (60fps under @xterm/addon-webgl). Per-pane instance isolation is structural, not runtime-checked.

### 6.4 — Display-layer leaks via shared channels

Candidate 36 (effort cross-session display) and Candidate 19 (ESC cross-pane interrupt) were the same class: shared subscription channels where the action was routed by inference rather than by data-attribute binding. Candidate 36 was structurally in the Phase T mirror display path; Candidate 19 was in the global ESC handler.

Both were fixed via runtime checks (`paneFocus.ts` predicate for ESC, isolated data stamping for mirror). Runtime checks work but require discipline to maintain. A future feature that forgets to scope by sessionId re-opens the whole class.

**V1 escape:** Session identity is a required parameter on every cross-cutting operation, enforced by TypeScript. Shared broadcasts (like Phase T's capture-pane WS channel) are replaced with per-session IPC channels. Cross-session leakage requires bypassing the type system, not forgetting a runtime guard.

---

## §7 — Cost governance outcomes

Migration v2 surfaced concrete cost data across 8 months of use. The aggregate profile:

- **Daily spend range:** $500-$4,500 during active work windows. Median ~$1,200-$1,800. Floor around $80 on light days; ceiling pushed past $4,500 during Phase Y Rotation 4 (investigation-intensive, multi-rotation sessions).
- **5h rolling budget proximity:** Jose hit the 80% band approximately 3-4 times per week during heavy work. Rate-limit trip events (reaching 100%): 2-3 total across the migration, all during Phase Y investigation peaks.
- **Effort calibration:** PM high effort → CODER medium effort default ratio held. Explicit overrides (downshifting PM to medium for routine dispatches, upshifting CODER to high for debugging sessions) averaged ~10% of sessions.
- **Cost-source divergence:** the `session_ticks.sum_cost_reported` vs `cost_entries.cost_usd` discrepancy surfaced during M5 analytics never got resolved in v2. Visible in TOKEN_ANALYTICS reports as "reported vs actual." V1 schema unifies to a single source (`cost_entries`).

Governance tools that worked:

- ContextBar 5h-rolling budget %, colored band (green / yellow / orange / red per OS §20.RL thresholds).
- Per-session cost counter visible in ContextBar + SessionCard.
- Daily `TOKEN_ANALYTICS_YYYY-MM-DD.md` rollup reports generated outside Commander via scripts.

Governance tools that didn't ship:

- Dedicated in-app analytics page (deferred to v1.1).
- Budget-approaching notification (deferred to v1 per §14.1 real-time metrics).
- Per-project cost attribution in a visible surface (project_metadata table has the data, no UI consumed it).

---

## §8 — Lessons banked (beyond the four OS principles)

The four OS principles (§4.4-§4.6 of this doc) are the headline lessons. Six more sub-lessons worth explicit banking:

### 8.1 — Fold discipline vs. author discipline

During ARCHITECTURE_SPEC.md v1.1 → v1.2 round-trip, CTO merged Jose's §16 ratifications into a file PM had already amended, without reading the amended version first. PM's schema + renderer + preserved-list amendments were overwritten. PM caught it on re-review, re-applied in v1.2, and documented the drift in §18 version history.

Lesson: when a document is in active round-trip between multiple authors, incoming-edit discipline is separate from outgoing-edit discipline. Read the current state of the file before applying edits, even when the edits are additive rather than substantive. Banked for v1 dispatch-phase rhythm.

### 8.2 — The wrap-vs-rebuild decision requires the right evidence

Phase Z (Tauri wrap scoping) was ratified 2026-04-20 with the framing "preserve everything, wrap in native shell." N1 Attempt 1 dispatch went out with that framing, produced a working scaffold, and surfaced 8 unilateral decisions that flagged the gap between "preserve everything" and "escape the architectural ceiling."

Jose's push-back — "want BridgeMind-quality, audit features first, common-denominator bugs out" then "want very very solid, build correctly not easiest" — was the forcing function. The wrap framing was a cost-minimization frame; Jose reframed it as a quality-maximization frame. The ratified answer shifted to ground-up rebuild.

Lesson: architectural decisions have a frame. Switching the frame can invert the optimal answer. CTO must surface the frame before ratifying, not after.

### 8.3 — "Deferred" needs to mean deferred, not forgotten

Migration v2 deferred full M7 (project pane), dedicated analytics, and three-role UI. All three are now v1 scope — not lost. The filing mechanism (in MIGRATION_STATE.md as "deferred items" + in FEATURE_REQUIREMENTS_SPEC.md §9.4 explicitly) worked because the defer-list was an audited artifact, not a mental note.

Lesson: deferrals require a filing location that survives session boundaries. "We'll get to it later" without a filed artifact is a lost item. Banked into OS §20 (pending fold into OS file).

### 8.4 — Investigation depth vs. dispatch breadth

During Phase Y Rotation 4, a single dispatch to CODER spanned 6 different files across the derivation chain, asked for 3 refactors, and included 4 "also while you're there, fix X" additions. It came back half-done, with unclear handoff shape, requiring 3 follow-up rotations.

Compare Finalizer Track 1 dispatch: one file (`useSessionPaneActivity.ts` new), one acceptance criterion (ContextBar subscribes to pane-activity and status is driven by it), no scope expansion. Closed in one round.

Lesson: dispatch breadth is inversely correlated with closure rate. N1-N6 dispatches should be narrow, single-file-or-small-cluster, single-acceptance-criterion. Banked into dispatch-writing discipline for v1 phase rollout.

### 8.5 — Pre-emptive structural constraints pay for themselves

C26 (session_ticks missing UNIQUE constraint) cost ~2 hours of debugging + one migration to fix. The fix was a single `UNIQUE (session_id, turn_index)` constraint that any schema review should have caught at design time. It was missed because the original schema was drafted ad-hoc across multiple M4-M5 ALTER migrations rather than via a reviewed full-schema design pass.

V1 schema (ARCHITECTURE_SPEC.md v1.2 §10) has proper constraints from day one. PM's v1.2 amendment added `uidx_workspace_pane_slot` as a proactive application of the C26 lesson.

Lesson: schema constraints are cheap to add at design time, expensive to add after data accumulates. V1 constraint discipline is part of the rebuild ROI.

### 8.6 — The operating system is the product

Before migration v2, JStudio's product was "Jose's client-facing ERPs and landings." After migration v2, JStudio's product is "Jose's client-facing ERPs and landings, produced by a working three-role AI development operation." The operating model is part of what JStudio sells, implicitly; it's what lets JStudio ship at the pace and quality clients pay for.

OPERATING_SYSTEM.md and its associated docs (standards, this retrospective, ARCHITECTURE_SPEC, investigation discipline) are the single most load-bearing artifact JStudio produced during v2. More load-bearing than any individual client project's code.

Lesson: invest in the operating model as seriously as in product code. Banked.

---

## §9 — Honest debt carried forward

Not everything landed clean. Debt v1 inherits:

### 9.1 — Cost-source divergence unresolved in v2

`session_ticks.sum_cost_reported` vs `cost_entries.cost_usd` never got a reconciliation commit in v2. V1 schema unifies to `cost_entries` as the single source, which resolves the class structurally — but any v1.1 analytics work that tries to join against historical v2 session_ticks data will hit the divergence.

Mitigation: web Commander DB stays alive for historical queries. V1 starts clean. Analytics reports for the v2 period reference web Commander data; analytics for v1+ period reference v1 data.

### 9.2 — M7 project pane only partially shipped

STATE.md live view shipped. Four-file tabbed view + project metadata + recent activity feed + DECISIONS filter did not. Preferences persistence for drawer state (height, open/closed) per-session — did not.

V1 delivers the full M7 scope in §7 of Deliverable 1 + §7.1-§7.2 of Architecture v2. Not debt v1 inherits with friction; debt the v2 plan failed to deliver.

### 9.3 — Candidate 34 permission-mode selector

Net-new UI surface for permission-mode switching (`default` / `acceptEdits` / `plan`). Not shipped in v2. V1 includes it via the typed renderer registry path (§11 of ARCHITECTURE_SPEC v1.2).

### 9.4 — Snapshot tag cleanup across repos

Pre-m4 and pre-m5 snapshot tags accumulated across 8+ repositories during migration. Not cleaned up. Low-priority hygiene debt; does not affect v1 execution. Parked item, non-blocking.

### 9.5 — Investigation discipline needs more corpus

OS §20.LL-L11 and INVESTIGATION_DISCIPLINE.md are sound but thinly exemplified. Three or four more investigation-closure examples would harden the playbook. Expected to accumulate naturally across v1 phases; no action required now.

### 9.6 — Effort re-calibration after v1 ships

Current effort defaults (PM high / CODER medium / Raw medium) were calibrated against web Commander's cost profile. V1's architectural leverage (faster spawn, lower latency, typed state) may shift the optimal defaults — potentially downshifting CODER default to medium-low for routine work, potentially upshifting PM to xhigh for architectural sessions. Re-calibration after ~4-6 weeks of v1 dogfood.

---

## §10 — Continuity map to native v1

One-page answer to "what moves forward unchanged, what moves forward restructured, what doesn't move forward."

### 10.1 — Unchanged into v1

- Manual-bridge invariant (§4.1)
- Three-role separation (§4.2)
- Canonical four-file project structure (§4.3)
- Investigation discipline (§4.4)
- Ground-truth over derivation (§4.5)
- Plain-language reframe (§4.6)
- Item 3 sacred (§4.7)
- Bootstrap injection invariant (§4.8)
- `resolveSessionCwd` SSOT (§4.9)
- Pattern-matching discipline in dispatches (§4.10)
- Skills-as-knowledge-modules pattern (§5)
- Standards file locations (`jstudio-meta/standards/*.md`)
- Session type model (`pm`, `coder`, `raw`) — extended to extensible registry in v1 §10 schema
- Session effort model (low / medium / high / xhigh) + type defaults
- OS § reference paths — `OPERATING_SYSTEM.md` stays at `jstudio-meta`
- 5h rolling budget + context-% real-time metrics (UX surface preserved)
- Cost telemetry aggregation (`cost_entries` table, unified source)

### 10.2 — Moves forward restructured

- **Terminal layer:** tmux capture → xterm.js + node-pty direct. UI shape mostly preserved (terminal pane visible per session), architecture fully rebuilt.
- **Real-time status:** pane-regex classifier → typed state machine fed by OSC 133 + tool events. UI signal (status dot, action label) preserved; derivation eliminated.
- **Event bus:** Fastify WS + custom typed events → same pattern, exhaustively typed union, per-session channel isolation structural.
- **State management:** ad-hoc `useChat` / `useToolExecutionState` / etc. → Zustand (pure client state) + TanStack Query (server state) + WebSocket-driven cache writes. Component-level code shape mostly preserved; hook internals rebuilt.
- **Approval path:** `usePromptDetection` pane-regex → typed `approval:prompt` events from JSONL watcher. UI shape (PermissionPrompt component, mount location) byte-identical.
- **Preferences:** `usePreference` React hook w/ Phase T hotfix `9bba6ab` → typed preference API over Zustand + SQLite. Same UX.
- **Session spawn:** tmux shell-out (~1.5-3s cold) → node-pty direct (~1-2s cold, <500ms warm via pre-warm pool). UX shape identical (modal, recent projects, effort override); implementation rebuilt.

### 10.3 — Does not move forward

- **Phase Y transcript-authoritative derivation chain.** `useToolExecutionState`, `useCodemanDiffLogger`, codeman-diff.jsonl, debug.routes.ts, all 15.3-arc legacy guards (typedIdleFreshKillSwitch, lastTurnEndTs, isSessionWorking OR-chain, Fix 1/2, Option 2/4, Activity-gap, heartbeat-stale gate), `resolveEffectiveStatus`, `resolveActionLabelForParallelRun` predicate chains. Entire apparatus obsoleted by ground-truth architecture.
- **Phase T tmux-capture mirror.** `TmuxMirror.tsx` (ansi_up-converted pane capture rendering), Phase T pane-capture polling, `session:pane-capture` event, `useSessionPaneActivity` hook (Finalizer Track 1 workaround).
- **Tmux infrastructure.** `tmux.service.ts` capturePane + sendKeys shell-out, `status-poller.service.ts` (1.5s tick), pane-regex classifier in `agent-status.service.ts`, orphan-tmux-adoption path (Commander restart + tmux-alive), `check-case-collisions.sh` script.
- **Server-side `session.status` string derivation.** The `session.status` field as pane-regex-derived string. V1 drives status from OSC 133 + tool-event stream + pty exit.
- **N1 Attempt 1 Tauri wrapper scaffold.** `src-tauri/**` in current working directory from Attempt 1. `scripts/prepare-sidecar.sh`. Placeholder-dist workaround. Node-binary-bundling approach (copy host `$(which node)` verbatim). Stays on disk as reference; not the v1 starting point.
- **Web Commander commander.db migration.** No migration from the web DB to v1. Web Commander stays alive for historical queries during v1 ship + dogfood.
- **Chokidar polling.** Replaced by FSEvents via tauri-plugin-fs-watch.
- **Ad-hoc React state composition.** Replaced by disciplined Zustand + TanStack Query layering.

---

## §11 — What makes v1 different structurally

Six structural differences between v2 (web Commander) and v1 (native Commander), stated plainly:

1. **V1 observes pty directly.** V2 observed tmux captures at 1.5s cadence.
2. **V1 has no derivation chain for status.** V2 derived status from transcript → message-shape → tool-pair → temporal-gate → predicate-chain → pane-activity mirror.
3. **V1's renderer registry is compile-time exhaustive.** V2 had gaps (C29, C35, C40) with silent fallback to generic renderers.
4. **V1's per-session isolation is structural (TypeScript-enforced sessionId).** V2's was runtime-checked (paneFocus predicates, data-attribute stamping).
5. **V1's schema has proper constraints from day one.** V2's schema accumulated 20+ ALTER migrations with retention + uniqueness gaps surfaced only after data accumulated.
6. **V1's IPC contracts are three-layered by purpose (Tauri IPC for OS, WebSocket for streams, HTTP for queries).** V2 was single-layer (HTTP + WS) with tmux shell-out as an unacknowledged fourth layer.

None of these differences eliminate the operating model. They all preserve it. The operating model is the product of migration v2; v1 is a better implementation substrate for it.

---

## §12 — What this retrospective does not conclude

Three things this document deliberately does NOT declare closed:

### 12.1 — The operating model is not final

OS §20.LL-L11 through L14 are the most recent principles banked. They were banked 2026-04-22, two days before this retrospective. Future CTO sessions during v1 phase rollout will surface new principles; they will be banked into OS §20.LL-L15, L16, etc. The operating model is a living artifact; migration v2 is its adolescence, not its finality.

### 12.2 — V1 scope is not guaranteed to ship as specified

ARCHITECTURE_SPEC.md v1.2 is a contract for N1-N6 dispatches. The dispatches themselves will surface adjustments (Bun verification spike may fail → fall back to pkg Node; FTS5 migration may reveal trigger issues → adjust; pre-warm pool may exhibit memory pressure → tune). The spec is the plan; the ship is the ground truth. This retrospective does not claim v1 will ship the spec verbatim; it claims the spec is what we intend to ship.

### 12.3 — The product direction is not locked

V1 is macOS-only, single-user, no telemetry, no external distribution. V2+ may shift. Selling Commander as a product is "very far away" per Jose's §16.10 ratification but is architecturally preserved (extensible session types, cross-platform Tauri substrate, code signing + updater in place, no telemetry-optional gotchas to undo). If that direction becomes real, v1's primitives support the pivot without rebuild.

---

## §13 — Closing note

Migration v2 shipped. The Phase Y arc closed. The operating model is load-bearing and documented. The four OS principles (L11-L14) are the most valuable artifact produced. V1 is architected, specified, and ready for N1 redo dispatch.

The chapter closes here.

---

## §14 — Version history

- **v1.0 (2026-04-22)** — Initial authored by CTO (Claude.ai) from full migration v2 context + Phase Y arc + Finalizer closure + ARCHITECTURE_SPEC v1.2 continuity mapping. No amendments pending.

---

**End of retrospective.** Filed at `~/Desktop/Projects/jstudio-commander/docs/migration-v2/RETROSPECTIVE.md`. Ready for N1 redo dispatch.
