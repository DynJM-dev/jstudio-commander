# Command-Center Roadmap

**v0.3** — 2026-04-23 · Supersedes v0.2 · CTO (Claude.ai Opus 4.7) · `~/Desktop/Projects/jstudio-commander/docs/command-center/COMMAND_CENTER_ROADMAP.md`

**Authority:** `COMMANDER_KNOWLEDGE_BASE.md` v1.3 (cited KB-P#.#) · `OPERATING_SYSTEM.md` §3.4 + §20.LL-L11/L12/L13/L14 + §24 · `SMOKE_DISCIPLINE.md` v1.0 · `INVESTIGATION_DISCIPLINE.md`.

**Purpose:** shared mental model of N1→N7 so CTO, PM, CODER operate from the same phase picture before dispatches land.

**Changelog from v0.2:**

- KB-P1.7 v1.3 correction (write-gate rule widens to tool-surface discipline) folds into N2 MCP tool spec as explicit ban on raw-SQL / exec primitives.
- KB-P1.12 v1.3 correction (Tauri perf walkback) noted in guiding posture — runtime choice matters when paired with banked fixes; doesn't change our runtime decision.
- KB-P1.16 persistent state placement folds into cross-phase constraints + N1 schema design.
- KB-P1.17 context degradation cliff folds into N3 run viewer + N4 ContextBar (75% threshold warning).
- KB-P4.14 session-lifetime folds into N7 hardening (bearer token rotation simulated smoke).
- KB-P4.15 platform-conditional Cargo cfg folds into N1 Cargo.toml audit as foundation discipline.
- KB-P5.6 v1.3 handoff ladder extension (75% context threshold as trigger) folds into N4 ContextBar action.
- KB-P5.11 browser-agent E2E noted as supplementary testing tool (complements SMOKE_DISCIPLINE, doesn't replace).

No phase restructuring; boundaries from v0.1/v0.2 hold.

---

## Guiding posture

Command-Center is not native-v1 scaled up. Structural shifts from v1:

- Task-primary home, terminal as drill-down (KB-P1).
- Plugin-first integration, JSONL secondary (KB-P1.1 — externally validated by Quad's Dr. Vibe, KB-P1.1 v1.3 note).
- Schema-from-day-one for tasks, knowledge, agent_runs, agents (KB-P1.3).
- Bundled plugin + MCP server on same Fastify instance, **CRUD primitives only, no raw SQL / exec surface** (KB-P1.2 + KB-P1.7 v1.3 correction).
- **UI-process / pane-host-process split (KB-P1.12)** — now with updated evidence: Matt's Day 134 shipped Tauri build is ~10× faster than Electron on same hardware *when paired with* the banked fixes (per-session IPC, xterm dispose, workspace suspension, boot-path discipline). Tauri alone without the fixes regressed. We have both.
- **Per-session IPC channels, never shared bus (KB-P1.13)** — the #1 production perf decision.
- **Boot-path discipline (KB-P1.14)** baked into foundation — 200ms skeleton, no sync work at module init.
- **Persistent state in sidecar DB (KB-P1.16)** — localStorage only for transient UI preferences.
- Structural bug fixes in foundation, not hotfix (KB-P4.2/4.3/4.12/4.13/4.15).

Organizing principle: one concept per phase. Multi-concept phases accumulate partial-landing debt.

---

## N1 — Foundation

**Purpose:** Tauri v2 shell boots from Finder with visible skeleton within 200ms; Fastify sidecar reachable via webview fetch; SQLite schema complete; boot-path discipline established; structural fixes baked in; Cargo.toml platform-gated from day one.

**Scope.** Fresh Tauri v2 scaffold. Rust shell: `PathResolver::resolve_resource()`, single-instance lock, shutdown handler, explicit GPU acceleration flags (KB-P4.12 — verify in packaged `.app`). Fastify sidecar: `/health` endpoint, bearer token at `~/.jstudio-commander/config.json` (no expiry v1; KB-P4.14 note for future rotation), port scan 11002..11011. CSP + Tauri capabilities allow `connect-src http://127.0.0.1:*` (KB-P4.1). Drizzle schema per KB-P1.3 with indices — `tasks`, `knowledge_entries`, `agent_runs`, `agents` (with `capability_class` column per KB-P1.7), `sessions` (nullable `agent_run_id` FK), `projects`, `workspaces`, plus any flow-gating state tables per KB-P1.16 (e.g. `onboarding_state` if v1 ships an onboarding flow). v1-discovered structural fixes baked in: `LANG=en_US.UTF-8` + `LC_ALL=en_US.UTF-8` in PTY env; scrollback serialization with explicit utf8 round-trip; xterm scrollbar-gutter CSS as default component style (KB-P4.2).

**New in v0.3 — Cargo platform gating (KB-P4.15):** every Rust dependency audited at N1 time; platform-specific features wrapped in `#[cfg(target_os = "...")]` gates from day one, even though we only build macOS in v1. Prevents silent cross-platform breakage if we add targets later.

**Boot-path discipline (KB-P1.14):**

1. Route-level code splitting — main bundle ≤500KB; lazy-load syntax highlighter, code editor, file tree, markdown renderer, settings, approval modal component.
2. No sync keychain / IPC / disk work at module init — bearer token reads, config loads, sidecar handshake deferred to async initializer post-first-paint.
3. `ready-to-show` paired with window creation — webview appears only after React has mounted AND painted a real frame.
4. Skeleton UI within 200ms of launch — placeholder kanban shell visible; subsystems stream in async behind it.

Minimal UI beyond skeleton: "sidecar healthy" indicator (real webview fetch), Preferences pane, installed-plugin status.

**Dependencies:** none.

**Acceptance shape.** Finder-launched `.app` shows UI skeleton within 200ms (measured). Preferences shows "sidecar healthy" via actual webview fetch (not curl — SMOKE_DISCIPLINE §4.2). SQLite opens; all N1 tables queryable. Single-instance lock prevents second launch. No scrollbar gutter on any xterm mount. No mojibake on special-character probe. `chrome://gpu` in packaged `.app` shows hardware acceleration on all render categories. Cargo.toml platform audit documented in PR description — every platform-specific dep has a cfg gate.

**Effort category:** substantial. Tauri shell + boot-path + GPU + schema + structural-fix baking + platform-audit is the care work.

---

## N2 — Plugin + MCP dual-protocol

**Purpose:** Commander is reachable as both a Claude Code plugin target AND an MCP server on the same bearer-authed Fastify instance — with a CRUD-only tool surface.

**Scope.** Commander plugin package (separate repo): `.claude-plugin/plugin.json` + `hooks/hooks.json` mapping priority hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, Subagent/Task lifecycle, SessionEnd, PreCompact/PostCompact) to `http://127.0.0.1:${COMMANDER_PORT}/hooks/<event>` with bearer auth via `$COMMANDER_TOKEN` (KB-P3.1). Sidecar `/hooks/*` handlers persist raw payloads (KB-P1.1 schema-drift defense), emit typed WS events to frontend, de-dupe by `session_id + uuid` (KB-P4.3). MCP server on `/mcp/*` route prefix: `list_projects`, `get_project`, `list_tasks`, `create_task`, `update_task`, `add_knowledge_entry`, `list_sessions`, `spawn_agent_run`, `cancel_agent_run`, `get_agent_run` (KB-P1.2).

**New in v0.3 — narrow-primitive tool surface (KB-P1.7 v1.3 correction, KB-P6.17):** MCP tools ship CRUD primitives only. **No `execute_sql` tool. No `run_migration` tool. No raw `shell_exec`. No `filesystem_write_raw`.** Any destructive-class operation requires out-of-band human confirmation regardless of which model calls it. Tool surface is the defense, not model capability class. The v1.2 `capability_class` column on `agents` remains as a secondary diff-gate for cheap/fast models on non-destructive scratch writes, but is not the primary control.

Settings panel shows `/plugin install` command, bearer-token copy button, MCP config blob for external `~/.claude/settings.json`.

**Dependencies:** N1 schema, sidecar, bearer auth.

**Acceptance shape.** Install plugin via `/plugin install`. Spawn Claude Code session from terminal — sidecar receives SessionStart hook, session row inserted. External session calls `create_task` via MCP — row appears. Kill session; SessionEnd hook updates row. All payloads stored raw. Bearer auth rejects unauthenticated. **No tool in the exposed MCP surface accepts raw SQL strings, raw shell commands, or unbounded filesystem paths** — verified by manual MCP tool-list audit in PR review.

**Effort category:** medium.

---

## N3 — Run-Task mechanic

**Purpose:** The primitive that IS Commander's value — click Run on a task, get isolated worktree, `claude` spawned bare with instructions + knowledge piped, stdout streamed + context usage visible.

**Scope.** Identity-file linking: `.commander.json` with `{project_id}` on first "Open Folder" (KB-P1.5). Git worktree per run: sidecar owns `git worktree add/remove` (KB-P1.4). Spawn via bare `claude "prompt"` — never `claude -p` (KB-P3.3) — stdin piped from `{instructions}\n\n{accumulated_knowledge}`. CCManager teammate-mode injection (KB-P3.4). PTY via node-pty. Hard bounds enforced at sidecar (KB-P1.6): wall-clock (SIGTERM + 5s SIGKILL), token, iteration, explicit cancel. Minimal run viewer: stdout + status pill + elapsed + tokens + kill button + **context-usage indicator (new in v0.3 per KB-P1.17)**. Kill-session wired end-to-end; per SMOKE_DISCIPLINE §3.4, CODER cannot self-certify. Approvals fall back to Claude Code's TUI prompt — modal ships N5.

**Foundation disciplines (from v0.2, unchanged):**

1. **Per-session IPC topology (KB-P1.13).** Per-session WebSocket topics (`pane-capture:<sessionId>`), never shared bus.
2. **xterm explicit-dispose lifecycle (KB-P4.2 v1.2).** Every `new Terminal()` pairs with `dispose()` + listener unregistration + PTY ownership.
3. **Blank-terminal-until-Enter fix (KB-P4.13).** Sidecar writes prompt-trigger byte after PTY spawn.

**New in v0.3 — context-usage surfacing (KB-P1.17):** run viewer shows `{used_tokens} / {window_limit}` with percentage. Color state: green <60%, yellow 60–75%, red >75%. Crossing 75% emits a toast on the run viewer: "Consider handoff — context approaching degradation zone." 75% threshold is a soft advisory; hard token limit (KB-P1.6) is separate.

Investigation item per KB-P7.8: PM runs ~1-hour `ccusage`-vs-sidecar-derived token-tracking probe; CTO ratifies before N3 closes. **Additional v0.3 probe target:** verify the 75% threshold is reachable via available tracking (ccusage or hook-derived). If neither exposes real-time usage with <5s lag, the threshold warning becomes a stale-data problem; fall back to a lower-fidelity "run age" heuristic.

**Dependencies:** N2 plugin for live hook events + narrow MCP tool surface; N2 MCP for dogfood task spawns.

**Acceptance shape.** Create task via MCP from external Claude session on real project folder. Click Run. Worktree materializes. `claude` visible in process tree. stdout streams on per-session WS topic (verified by subscribing to a second session's topic and seeing zero cross-traffic). Kill button kills; worktree cleans up. Wall-clock timer fires on low-bound test. No mojibake. Terminal shows prompt within 2s without keystroke. xterm `dispose()` called on run-viewer unmount (instrumented counter). Context-usage indicator updates in real-time; crosses 75% threshold on a long-running test task; toast fires. All via UI except initial MCP task-create call.

**Effort category:** substantial. Product center of gravity. Three foundation disciplines + context-usage surfacing + ccusage probe; budget accordingly.

---

## N4 — Task board UI

**Purpose:** Kanban home screen; task cards → modal with instructions + knowledge + run history; project + workspace switching; design tokens from first mount; hidden-workspace suspension; ContextBar with 75% cliff warning.

**Scope.** Kanban columns: Todo / In Progress / Review / Done. Cards show title + last-run status + token count. Drag between columns. Task modal: two markdown fields (instructions + knowledge). Knowledge as append-only provenance log (`{agent_id, timestamp, content_md, superseded_by}`) — never destructive (KB-P1.3, P6.4). "Run" routes through N3. Terminal drawer per-pane (Cmd+J). Project switcher. Workspace sidebar: named + color-themed, 8-color palette (KB-P1.11). Design tokens from KB-P1.10 applied at every mount. Linear-discipline 4-region max — not VS Code 5-region (KB-P6.11).

**Disciplines (v0.2 unchanged + v0.3 additions):**

1. **Hidden workspace suspension (KB-P1.15).** Inactive workspace xterm render loops suspend; WS subscriptions unsubscribe; PTY processes untouched.
2. **No-arithmetic-in-prompts validation (KB-P6.15).** Form validations in deterministic code only.
3. **Persistent state placement (KB-P1.16, new in v0.3).** State that gates flow lives in sidecar DB. localStorage reserved for panel widths, last-selected filters, dismissed-tooltip flags. Gate test: *if this state vanishes, does the user lose work or hit a confusing redirect?* Yes → DB. No → localStorage OK.
4. **ContextBar with 75% threshold (KB-P1.17 + KB-P5.6 v1.3, new in v0.3).** Per-pane ContextBar shows context usage as percentage bar with color state. At 75%+ shows a "Write handoff prompt" one-click action; clicking serializes current agent state and opens a paste-ready prompt for another model.

**Dependencies:** N3 run mechanic + schema + context-usage surfacing.

**Acceptance shape.** Launch from Finder. Task board renders on real project. Create task via UI. Fill instructions + knowledge. Click Run. Terminal drawer opens with live stdout on per-session topic. Run completes; card status updates. Switch workspace → hidden workspace xterm loops pause (rAF counter); PTY alive (`ps`). Switch back → scrollback restores. Create workspace via UI → capacity validation in code. ContextBar shows percentage + color; hits 75% on a long test run; "Write handoff prompt" action appears; clicking produces a structured prompt. Flow-gating state (e.g. project-link completion) persists across localStorage-clear + relaunch.

**Effort category:** substantial. Four surfaces + suspension + validation + state-placement discipline + ContextBar handoff action. Pre-authorized N4a/N4b split if scope balloons.

---

## N5 — Approval modal (Item 3 sacred)

**Purpose:** The competitive differentiator — `PreToolUse`-hook-driven inline approval modal with cross-pane isolation and macOS-native notifications when unfocused.

**Scope.** `PreToolUse` hook → `ApprovalModal` mounts within 100ms on target pane (KB-P1.8). Modal: tool name + JSON input (collapsible) + Allow (⌘↩) / Deny (Esc) / Custom. State transitions `working → waiting(approvalPromptId) → working`. ContextBar shows "Waiting for approval." Cross-pane: approval in pane 2 doesn't block panes 1/3. Background notification via Tauri when unfocused; click → focus + surface modal on correct pane. No auto-resolve. No timeout. Per-session policy (KB-P6.9). **Byte-identical semantics across PM / Coder / Raw personas.** Response writes to correct pty.stdin; canonical response shape per KB-P3.1.

**Dependencies:** N3 Run-Task (PreToolUse events flowing on per-session topics), N4 pane model.

**Acceptance shape.** Spawn session. Prompt `ls /tmp`. Within 100ms of permission prompt, modal appears. Allow via ⌘↩ → modal closes, terminal resumes. Deny via Esc → rejection flows. Two concurrent sessions both prompting; each modal scoped to its pane. Unfocus; trigger approval; notification fires; click → focus + modal on correct pane. Canonical smoke in SMOKE_DISCIPLINE §4.3.

**Effort category:** medium.

---

## N6 — ChatThread + renderer registry

**Purpose:** Hook-event stream as first-class surface alongside terminal; typed renderers per event discriminator; explicit denylist for silent drops.

**Scope.** ChatThread panel, default always-visible (KB-P7.5). Event-policy SSOT file (discriminator → renderer mapping, OS §23.2 pattern). Typed renderers: user message, assistant text, tool_use paired with tool_result (compound card), thinking block, file attachment chip, inline reminder, compact file ref. Unknown shape → `UnmappedEventChip` (denylist style, OS §23.2). Shiki syntax highlighting. De-dupe by `session_id + uuid` (KB-P4.3). Scroll anchoring. Attachment drop handling. Approval-modal events (N5) render distinctly. Classifiers follow OS §24 pattern-matching discipline.

**Available techniques in v0.2/v0.3:**

- **Iframe-per-preview (KB-P5.9)** when >3 live rendering contexts land; `z-index: -1` positioning (NOT `display: none` — Chrome throttles to 1 FPS).
- **Screenshot-as-context (KB-P5.10)** as possible pane-level action. Deferrable to v2+.

**Dependencies:** N5 (approval event shape), N4 pane model.

**Acceptance shape.** Spawn session. Send prompt exercising multiple tools. ChatThread renders: user → thinking → tool_use+tool_result compound → assistant text → stop. No `UnmappedEventChip` for known shapes. Approval events render distinctly. De-dupe verified via forced resume.

**Effort category:** substantial.

---

## N7 — Hardening

**Purpose:** Deferred items get dedicated attention.

**Scope.** Frontend RTL test suite to 70% coverage (sixth-rotation deferral from v1; KB-P7.4). Specific surfaces: ContextBar, SessionPane, WorkspaceLayout, ChatThread, ApprovalModal, renderer-registry exhaustiveness. Bundle-size discipline (≤40MB). Backup + restore flow for `~/.jstudio-commander/` + `.commander/` project-local. Graceful-degradation audit: sidecar crashed, plugin uninstalled, JSONL corrupted, worktree pollution, bearer-token rotation. Secondary JSONL indexer (if added) carries session-ID ownership filter (KB-P4.6).

**New in v0.3 — bearer-token rotation smoke (KB-P4.14):** simulate bearer-token rotation mid-run; verify agent run completes without interruption. Sidecar performs silent refresh; agent sessions never see the rotation. Applies even though v1 has no expiry — future-proofs the rotation path.

**Dependencies:** N6.

**Acceptance shape.** `vitest --coverage` ≥70% frontend. Launch with sidecar pre-killed; UI shows clear error state + recovery path. Backup exported, restore re-imports. Bearer-token rotation smoke passes. No regressions from N1–N6 smokes.

**Effort category:** medium.

---

## Cross-phase constraints

Applies to every phase, every dispatch:

- **Manual-bridge invariant (OS §3.4)** — Jose sole routing agent; no direct PM↔CODER or PM↔CTO.
- **SMOKE_DISCIPLINE v1.0** — cited in §9 of every dispatch; user-facing smoke is phase-close gate; CODER cannot self-certify. **KB-P5.11 browser-agent E2E is supplementary diagnostic coverage, not a substitute.**
- **INVESTIGATION_DISCIPLINE.md** — fires when fix ships unit-green + symptom unchanged, or before stacking a second speculative fix.
- **G1–G14 guardrails** carry from v1, including Rust ≤150 LOC scope boundary (G5).
- **OS §24 pattern-matching discipline** — classifiers over external-tool output constrain by semantic shape.
- **Pre-dispatch reality check** — PM runs current build and verifies CTO's assumptions before CTO drafts.
- **Ground-truth over derivation (OS §20.LL-L14)** — before designing a derivation chain, check for an existing ground-truth signal.
- **Deep-link URL scheme discipline (KB-P4.8 v1.2)** — `command-center://` if ever shipped requires dev/prod scheme split + single-instance routing + explicit `#[serde(rename_all)]` + session-ready barrier.
- **Build steps fail loud on missing env vars (KB-P4.9 v1.2/v1.3)** — no silent partial artifacts. Migrations co-deploy atomically with dependent code.
- **Persistent state placement (KB-P1.16, new v0.3)** — flow-gating state in sidecar DB; localStorage only for transient UI preferences.
- **Narrow-primitive tool surface (KB-P1.7 v1.3 correction, KB-P6.17, new v0.3)** — no raw SQL, raw shell-exec, or raw filesystem-write tools exposed via MCP regardless of caller's model tier.

## Named architectural principles (protected)

Any proposal to relax these must invalidate the principle first, not just override it locally:

- **UI-process / pane-host-process split (KB-P1.12).** UI and Fastify sidecar are separate OS processes; node-pty, agent children, persistence in sidecar.
- **Per-session IPC channels, never shared bus (KB-P1.13).** Every long-running data stream uses per-session WS topics.
- **Boot-path discipline (KB-P1.14).** Skeleton UI in 200ms; no sync work at module init; `ready-to-show` paired with window creation; route-level code splitting.
- **xterm explicit-dispose lifecycle (KB-P4.2 v1.2).** Every `new Terminal()` pairs with `dispose()` + listener unregistration + PTY ownership on unmount.
- **Narrow-primitive tool surface (KB-P1.7 v1.3 + KB-P6.17, new in v0.3).** MCP tools are CRUD primitives; raw SQL / shell-exec / filesystem-write never exposed.
- **Persistent state in sidecar DB (KB-P1.16, new in v0.3).** Flow-gating state server-side; localStorage transient-only.

## Explicitly NOT scheduled (banked for v2+ or commercial)

Adapter architecture for Codex/Cursor/Aider (KB-P7.6); debug-mode first-class UI (KB-P5.4); handoff-prompt UI with 5-step ladder + 75% trigger automation (KB-P5.6 v1.3 — data exists in N3 schema, button in N4); screenshot-as-context as automated feature (KB-P5.10); Stripe / Settings redirect (KB-P7.7); best-of-N same-prompt parallelism (KB-P2.3); signing/notarization (KB-P7.3); Apple Developer enrollment (KB-P7.2); iframe-per-preview renderer integration (KB-P5.9); auto-update pipeline (KB-P7.9); multi-platform CI strategy (KB-P7.10); Commander-specific Claude skills (KB-P5.12 — post-N7 once dispatch format stabilizes).

## Ratification state

v0.1 items ratified by Jose 2026-04-23: UTF-8 + scrollbar-gutter in N1; design tokens in N4; N4a/N4b pre-authorized.

v0.2 additions ratified same day: all KB v1.2 additions + their roadmap implications.

v0.3 additions ratified same day (Jose: "make as many changes as you think are needed and best for the entire project"): all KB v1.3 additions including two corrections (KB-P1.7 write-gate widening, KB-P1.12 Tauri perf walkback) + their roadmap implications per changelog above.

**Next CTO artifact:** ARCHITECTURE_SPEC (cites roadmap v0.3 + KB v1.3), then N1 dispatch.

**Further research:** diminishing returns signaled from the v1.3 pass — of 10 prioritized items in the brief, 3 were corrections/reinforcements of existing principles and 7 were new material. Matt's architectural discovery rate appears to still be productive; another pass in 2–3 weeks may be worth doing if he ships a substantial shift (e.g. multi-agent orchestration v2, new plugin pattern, significant MCP primitive addition). If next pass yields <3 non-banked items, stop research and commit to current KB as frozen-for-N1.

---

**End of roadmap v0.3.**
