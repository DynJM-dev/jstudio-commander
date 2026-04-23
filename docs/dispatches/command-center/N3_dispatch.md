# Dispatch N3 — PTY Spawn + Run-Task Mechanic

**Phase:** N3 — PTY spawn, the Run-Task mechanic
**Date drafted:** 2026-04-23
**CTO:** Claude.ai Opus 4.7
**Target path for CODER:** `~/Desktop/Projects/jstudio-commander/command-center/` at HEAD `9f8c608` (N2.1 closed 3/3)
**Word budget:** ~3,500 words; full-phase per operating-model commitment #2

---

## §0 — Pre-dispatch reality check

- Monorepo HEAD at `9f8c608` commander-repo + `e1975fa` meta-repo. Clean working trees.
- N2.1 closed 3/3. Bearer contract locked by 7-assertion regression test. Debt 15 RESOLVED.
- SMOKE_DISCIPLINE v1.2 §3.4.2 state-isolation discipline landed (PM fold).
- ARCHITECTURE_SPEC v1.3 + KB v1.4 calibration patch landed with D-KB-09..12 ratified.
- 41/41 tests green. 149/150 LOC Rust (G5). Bundle size held. `bun install --frozen-lockfile` clean.
- N2 + N2.1 PM-shipped fixes + forwarder shim stable. Plugin→sidecar→MCP pipeline proven end-to-end with real Claude Code v2.1.118 sessions.

---

## §1 — Acceptance criteria

**Per SMOKE_DISCIPLINE v1.2, every criterion Jose-observable at outermost layer. §3.4.1 window-presence triad + §3.4.2 state-isolation discipline apply to CODER smoke-readiness.**

**3.1 — Run spawned externally, visible in Commander UI.** Jose opens an external Claude Code session (project-root `.mcp.json` with commander MCP configured per D-KB-12). Prompts Claude: "Spawn an agent run in Commander that runs `ls -la` in this directory." Claude calls `spawn_agent_run` MCP tool. Within 3s, Commander's Preferences → Debug → "Recent agent runs" panel shows the new run with `status: running` (transitioned from N2's `queued` stub), non-null `pty_pid`, and a session_id matching the one Claude reported.

**3.2 — Worktree materialized.** The run's row in `agent_runs` has `worktree_path` populated to `<project-root>/.worktrees/run-<uuid>/`. The directory exists on disk, is a valid git worktree of the project's HEAD, and is distinct from the project's main working tree (git commands at the worktree show a different checked-out ref if the project has branches — otherwise at least `git rev-parse --is-inside-work-tree` returns true).

**3.3 — PTY output streams live to Commander UI.** Debug panel has a new minimal "Run viewer" button next to each running row. Jose clicks it. A terminal-style pane opens showing the PTY output of the spawned command, streaming live. For `ls -la` this is near-instant; for a longer command (Jose runs a second test with `spawn_agent_run` invoking `sleep 3 && echo done`) the output appears progressively, not all at once at completion. Output renders via xterm.js with the scrollbar-gutter fix (KB-P4.2) — no 14px dead strip.

**3.4 — Run completes cleanly, status transitions.** The `ls -la` run reaches `status: completed` with `ended_at` populated, `exit_reason: "exit-code-0"` (or equivalent structured value), `wall_clock_seconds` populated with a sane value (under 2s for `ls -la`), and the run stays visible in the recent-runs panel as completed.

**3.5 — Cancel kills the PTY.** Jose spawns a long-running run (third test: `sleep 60`). From the run viewer, Jose clicks a "Cancel" button. Within 6s: `status` transitions to `cancelled`, `exit_reason` documents SIGTERM vs SIGKILL path (SIGTERM if the process exited within 5s, SIGKILL if the 5s grace elapsed), PTY pid no longer in `ps`, run viewer shows the cancellation in the output stream.

**3.6 — Hard bounds enforced at sidecar layer.** Jose spawns a fourth test run with `max_wall_clock_seconds: 3` passed via MCP input. The run invokes `sleep 30`. Within 9s (3s wall-clock + 5s SIGTERM grace + buffer): status transitions to `timed-out`, exit_reason documents the bound hit, PTY killed. Enforcement is sidecar deterministic code — no "model decides when to stop" anywhere. KB-P6.15 applies.

**3.7 — `hook:<session_id>` + `pty:<session_id>` WS flow.** When Jose's external Claude Code session ran the spawn_agent_run call, the SessionStart hook fired and persisted. When the spawned child process (the `ls -la` etc.) runs under its own Claude Code wrapper, it gets its own session_id; both hook events and PTY output stream on their respective per-session WS topics. Verified by Debug panel showing hook events arriving alongside PTY output for the same session_id. KB-P1.13 per-session topic isolation holds.

**3.8 — Bearer persistence + zombie-window + state-isolation regression checks.** Cold relaunch of `Command Center.app` from Finder after all runs complete. SMOKE_DISCIPLINE v1.1 §3.4.1 window-presence triad passes. Bearer in Preferences unchanged from pre-N3 value (D-N1-07 §8.2 contract held). CODER's smoke-readiness dry-run (documented in PHASE_N3_REPORT §3 part 2) used isolated state path per SMOKE_DISCIPLINE v1.2 §3.4.2 — verified by the script not containing `rm -rf ~/.commander/` or equivalent user-directory writes.

---

## §2 — Tasks

**T0 — Logger type bridge (Debt 16).** Before N3's logging surface expands across PTY + WS + agent-run status transitions. Define `Logger` type in `packages/shared/src/logger.ts` that bridges Pino's `Logger` and Fastify's `FastifyBaseLogger`. Remove the type-assertion in `apps/sidecar/src/index.ts:19`. Unit test: type-check the shared logger in both Fastify-handler and standalone-usage contexts. ~20–30 min per PM estimate. Closes Debt 16.

**T1 — PTY spawn via Bun terminal API.** `apps/sidecar/src/pty/spawn.ts` — wraps `Bun.spawn({ terminal: {...} })` per ARCHITECTURE_SPEC §6.3. Input: `agent_run_id`, `command`, `cwd` (the worktree path), env (merged from process.env + UTF-8 locale from `packages/shared/src/pty-env.ts` already shipped in N1 T9), optional `max_wall_clock_seconds` / `max_tokens` / `max_iterations`. Returns PTY handle + pid.

Internals per KB-P4.13 blank-terminal-until-Enter defense: emit prompt-trigger byte `\n` via setTimeout 100ms after spawn if the command is a Claude session (detected by command path ending in `claude`). For non-Claude commands (bash, ls, etc.), skip the prompt-trigger — it's only needed to defeat Claude Code's REPL blank-until-input idle state.

**T2 — Worktree materialization.** `apps/sidecar/src/worktree/create.ts`. On `spawn_agent_run` tool call, before PTY spawn:

1. Resolve project from `session_id` → `sessions.cwd` → `projects` lookup. Handle missing project case (auto-create, matching N2's ensureProjectByCwd pattern — KB-P1.5 full `.commander.json` identity file lands in N4; N3 uses the current column shape).
2. Generate run UUID. Construct worktree path `<project-root>/.worktrees/run-<uuid>/`.
3. Run `git worktree add <worktree-path>` against the project's HEAD. If the project root isn't a git repo, fall back to copying files to a scratch dir + logging that git-worktree was unavailable. PHASE_REPORT documents non-git fallback behavior as acceptable v1 degraded mode per KB-P1.4.
4. Return the worktree path for PTY spawn's cwd.

**T3 — Agent-run lifecycle FSM.** `apps/sidecar/src/agent-run/lifecycle.ts` — deterministic state transitions per ARCHITECTURE_SPEC §3.2 `agent_runs.status` enum:
- `queued → running`: on PTY spawn success.
- `running → completed`: on PTY exit with code 0.
- `running → failed`: on PTY exit with non-zero code OR spawn failure OR worktree materialization failure.
- `running → cancelled`: on cancel_agent_run MCP tool call; SIGTERM → 5s → SIGKILL → status update. Exit_reason records which path completed the kill.
- `running → timed-out`: on wall-clock bound hit; same SIGTERM → 5s → SIGKILL flow; exit_reason documents the bound.

Each transition writes `agent_runs` row update + emits `status:<session_id>` WS event.

`max_tokens` + `max_iterations` bounds tracked if Claude Code exposes them via hook events (PostToolUse payload). If not exposed in v2.1.118 hook data, scope those bounds as N4+ telemetry work — document in §9 as deferred. Wall-clock bound is deterministic and always enforced.

**T4 — PTY output → WS stream.** Each spawned PTY's stdout publishes to `pty:<session_id>` WS topic per ARCHITECTURE_SPEC §5.1. Message shape per §5.2 `PtyEvent` discriminated union. Bytes are base64-encoded UTF-8 (KB-P4.2 round-trip safety). Subscribers receive raw byte stream; rendering is client-side.

Parallel: scrollback accumulates to `sessions.scrollback_blob` column via the `packages/shared/src/scrollback-codec.ts` helper shipped in N1 T9. Existing scrollback-codec round-trip tests already verify UTF-8 hygiene — extend with one test that verifies cross-session scrollback never contaminates (Bug J class defense per KB-P4.6).

**T5 — `spawn_agent_run` / `cancel_agent_run` wire-up (MCP).** Replace N2's stub handlers in `apps/sidecar/src/mcp/tools.ts`:

- `spawn_agent_run`: accept the tool call per existing JSON schema + add optional input fields `max_wall_clock_seconds`, `max_tokens`, `max_iterations`, `command` (if absent, defaults to `claude` per KB-P6.7 bare-claude spawn pattern). Invoke T2 worktree creation + T1 PTY spawn + T3 FSM transition. Return the agent_run row with `status: running` + real `pty_pid`.
- `cancel_agent_run`: look up agent_run by id. If status is running, invoke T3 cancel path. Return updated row. If already terminal, return row as-is (idempotent cancel).

D-KB-07 narrow-primitive rule holds: these are CRUD tools operating on agent_runs rows, not `execute_shell` or `execute_sql`. The shell command passed to PTY is the user's explicit intent at the Claude Code layer, not a generic shell-exec affordance.

**T6 — HTTP API parity for agent_runs.** ARCHITECTURE_SPEC §7.2 already lists `POST /api/runs` + `DELETE /api/runs/:id`. N2 left these as stubs (per PHASE_N2_REPORT). N3 wires them to the same T3 lifecycle functions MCP calls. Frontend (T8) consumes HTTP API, not MCP directly — keeps the webview-origin vs bearer-origin split clean.

**T7 — `useSessionPaneActivity`-equivalent WS hook (frontend).** `apps/frontend/src/hooks/use-session-stream.ts` — subscribes to `hook:<session_id>` + `pty:<session_id>` WS topics for a given session_id. Returns: latest hook events (up to N=50 in memory), latest PTY bytes (streaming), connection status. Explicit unsubscribe on unmount per KB-P4.2 xterm dispose lifecycle + KB-P1.13 per-session topic isolation.

Implementation: TanStack Query `useQuery` for initial scrollback fetch + WebSocket listener with `queryClient.setQueryData` invalidation on incoming events per ARCHITECTURE_SPEC §4. No Zustand for this — server-source data.

**T8 — Minimal run viewer UI.** `apps/frontend/src/components/run-viewer.tsx` — a modal or slide-over pane that renders:
- Header: run id, command, status badge, wall-clock elapsed, token count if available.
- xterm.js terminal (using `packages/ui/src/xterm-container.tsx` shipped N1 T9) streaming PTY output.
- Hook events side-panel (collapsible) showing chronological hook event chips — one chip per event with type + timestamp + truncated payload preview.
- Cancel button (only when `status === 'running'`).

Launch point: "View" button added to each row in Preferences → Debug → "Recent agent runs" panel. Not a first-class kanban yet — that's N4. N3 ships the terminal-surface mechanic, N4 lifts it into the real UI.

**T9 — Extend Preferences → Debug panel.** New sub-section "Recent agent runs" (distinct from existing "Recent hook events"). Columns: run id (truncated), status badge, session_id (truncated), worktree path, wall-clock, started_at, View button.

Shares the polling pattern from N2's recent-hook-events panel (TanStack Query `refetchInterval`). Virtualization still deferred per Debt 14 (belongs with N4 kanban).

**T10 — Integration tests (bun:test).**

1. `apps/sidecar/tests/integration/pty-spawn.test.ts` — spin sidecar; call `spawn_agent_run` via MCP with a synthetic `echo hello` command; assert row transitions queued → running → completed; assert PTY output contains "hello"; assert wall-clock > 0; assert ended_at populated.
2. `apps/sidecar/tests/integration/cancel-run.test.ts` — spawn a `sleep 30`; call cancel_agent_run after 500ms; assert SIGTERM path used (process exits within 5s of signal); assert status = cancelled; exit_reason documents SIGTERM.
3. `apps/sidecar/tests/integration/wall-clock-bound.test.ts` — spawn a `sleep 30` with max_wall_clock_seconds=2; assert timed-out status within 8s; exit_reason documents bound hit.
4. `apps/sidecar/tests/integration/worktree-isolation.test.ts` — spawn two concurrent runs against a test git repo; assert they get distinct worktree_paths + distinct git HEADs if test repo has branches.

**T11 — Smoke readiness per SMOKE_DISCIPLINE v1.2.** CODER builds `Command Center.app`, runs §3.4.1 window-presence triad check, runs an isolated-state dry-run of the full N3 flow (spawn + view + cancel) using a temp `$HOME` (`mktemp -d` + `HOME=<temp> ./Command\ Center.app/...`) OR the backup-restore pattern from N2.1. PHASE_REPORT §3 part 2 documents which isolation pattern was used + includes the shell snippet.

**Prohibition:** the T11 script MUST NOT contain `rm -rf ~/.commander/`, `rm -rf ~/.claude/`, or any destructive action against real user-state directories. This is the SMOKE_DISCIPLINE v1.2 §3.4.2 discipline and it's non-negotiable. PM catches any such pattern in report review and blocks close.

---

## §3 — Required reading

- `N3_dispatch.md` (this document).
- `ARCHITECTURE_SPEC.md` v1.3 — §3.2 (agent_runs + sessions schemas), §5 (WS topology + event shapes), §6.3 (Bun.spawn terminal API + fallback paths), §7.2 (HTTP API routes for runs), §7.3 (MCP tool set — spawn_agent_run + cancel_agent_run are now the first non-stub tools).
- `COMMANDER_KNOWLEDGE_BASE.md` v1.4 — Part 1.4 (worktree isolation), 1.5 (project identity — v1 uses current column shape, KB-P1.5 `.commander.json` is N4 scope), 1.6 (hard bounds — wall-clock always deterministic, token/iteration may be N4+), 1.13 (per-session WS topics — critical for Bug J class defense at PTY layer), 4.2 (xterm dispose lifecycle), 4.6 (Bug J cross-instance isolation), 4.13 (blank-terminal-until-Enter prompt-trigger), 6.7 (bare `claude` spawn — never `claude -p`), 6.15 (no arithmetic in prompts — hard bounds are deterministic code).
- `OPERATING_SYSTEM.md` — §3.4 manual bridge, §20.LL L11-L14 (ground truth over derivation — applies to hard-bounds enforcement), §24 pattern-matching.
- `standards/SMOKE_DISCIPLINE.md` v1.2 — §3.4.1 window-presence triad + §3.4.2 state-isolation discipline (new; both load-bearing for T11).
- `standards/INVESTIGATION_DISCIPLINE.md` — fires if any task hits unit-green + symptom-unchanged. Especially relevant for T1 PTY spawn (if output doesn't stream) and T3 FSM (if transitions don't fire as expected).
- `DECISIONS.md` — D-KB-07 (narrow-primitive tool surface — holds for T5), D-KB-12 (project-root `.mcp.json` shape — Jose uses for 3.1 test).
- `PHASE_N2_REPORT.md` §9 (N3 handoff points — Obs 1–6).
- `PHASE_N2.1_REPORT.md` §5 (bearer contract + atomic-write pattern — T2 worktree creation + T3 FSM writes should use atomic-rename pattern where applicable).

---

## §4 — Constraints

**G1–G14** carry. Specifically for N3:

- **G5 Rust ≤150 LOC** — no Rust changes expected. Stays 149/150.
- **G8 deviation report** — Bun's `spawn({ terminal })` API is ~5 months old at this point. If CODER hits runtime bugs that suggest the API is structurally wrong for our use case, deviation report BEFORE falling back to bun-pty or node-pty. Fallback paths per ARCHITECTURE_SPEC §2.3 exist but are escalation-gated.
- **G10 root-cause before fix** — if PTY output doesn't stream on first spawn test (T10 case 1), CODER fires an instrumentation rotation before iterating. Common suspects: WS topic naming mismatch, base64 encoding error, event publisher not wired to the PTY handle, FSM transition firing before subscription-ready. Instrument first.
- **G12 dep hygiene** — expected new deps: none required. Bun's terminal API is built-in; git worktree creation uses `Bun.$` shell invocation (also built-in); xterm.js already in packages/ui from N1 T9. If CODER reaches for any new dep, justify in PHASE_REPORT §4.
- **SMOKE_DISCIPLINE v1.2 §3.4.2** — smoke-readiness state-isolation is non-negotiable. T11 script MUST use isolated state. PM blocks close if violated.

---

## §5 — Stack (locked — no additions)

ARCHITECTURE_SPEC §10 ratified decisions hold. N3 uses shipped stack only:
- `Bun.spawn({ terminal: {...} })` — built-in, no dep.
- `Bun.$` or `node:child_process` for git worktree commands.
- Existing Fastify WebSocket plumbing from N2 T9.
- Existing xterm.js from N1 T9 via `packages/ui/src/xterm-container.tsx`.
- bun:test for integration tests.

---

## §6 — Out of scope for N3

- `.commander.json` per-project identity file (KB-P1.5 — N4 scope).
- Task board kanban with runs surfaced as primary UI (N4).
- Approval modal UX for PreToolUse (N5 — PreToolUse still auto-allows per N2 T4).
- ChatThread + renderer registry (N6).
- JSONL secondary indexer (KB-P1.1 fallback — plugin is primary; indexer is scope later).
- `max_tokens` + `max_iterations` bounds enforcement IF Claude Code v2.1.118 hooks don't expose token/iteration counts. Wall-clock bound always enforced deterministically. Document token/iteration deferral in §9 if needed.
- Persistent scrollback restore across Commander restarts at the UI layer — data is persisted to `sessions.scrollback_blob` per T4 but the frontend re-hydration path for stopped-run scrollback is N4 scope.
- Published marketplace plugin (N7).

---

## §7 — Approach notes

**Worktree fallback for non-git projects.** If the target project isn't a git repo (rare but possible in test/toy contexts), T2 falls back to copying files to a scratch dir. Log this explicitly + mark it in the agent_run row via a new `exit_reason` prefix or a separate column if needed (CODER decides — deviation report if a new column is added). Full isolation semantics preserved; just different implementation.

**Concurrent runs.** Multiple runs against the same project must get distinct worktrees. T10 case 4 verifies. Git worktree handles this natively via unique branch-like refs per worktree. If Bun's shell invocation or Git itself rate-limits concurrent worktree adds, CODER documents + files as tech debt (not blocking).

**WS back-pressure.** A chatty PTY (e.g., `find / 2>/dev/null`) can produce high-volume byte streams. N3 does not yet implement back-pressure — if the subscriber can't keep up, latest-wins or drop-to-buffer semantics TBD. Document as tech debt; N7 hardening may revisit. Out of N3 scope.

**Session identity.** When `spawn_agent_run` is called, the agent_run row's `session_id` is either supplied by the MCP caller (if the caller is an external Claude Code session that wants to chain into an existing session) or minted fresh (for a newly-spawned child session). The hook pipeline from N2 handles SessionStart events for child sessions; N3 just ensures the agent_run row is linked to the right session_id.

**Scrollback persistence on cancel / timeout.** Cancel and timeout paths MUST flush the PTY's in-memory scrollback buffer to `sessions.scrollback_blob` before the kill signal, so the record isn't lost. T3 FSM handles this: pre-kill flush then state transition then WS event.

---

## §8 — CODER in-rotation decisions

**CODER decides without escalating:**
- File organization within new `apps/sidecar/src/pty/`, `apps/sidecar/src/worktree/`, `apps/sidecar/src/agent-run/` directories.
- Whether run-viewer is a modal or slide-over (UX judgment; shadcn Sheet vs Dialog).
- Integration test fixtures (synthetic git repo layout, cleanup pattern).
- Logger shape in T0 — single shared type vs wrapper functions.
- Bun shell vs node:child_process for git worktree invocation — both acceptable.
- xterm addon choices beyond N1's baseline (webgl/fit/serialize already in).
- Specific polling interval for the recent-runs panel (5s is reasonable; CODER picks).

**CODER escalates before acting:**
- Any new MCP tool beyond `spawn_agent_run` / `cancel_agent_run` wire-up (D-KB-07).
- Schema changes to `agent_runs` or `sessions` (ARCHITECTURE_SPEC §3.2 amendments route through CTO).
- Dropping back to bun-pty or node-pty fallback (ARCHITECTURE_SPEC §2.3 escalation gate).
- Hard-bounds enforcement shape changes (KB-P1.6 + KB-P6.15 — deterministic-only enforcement).
- Any smoke script touching real user-state directories (SMOKE_DISCIPLINE v1.2 §3.4.2).

---

## §9 — Smoke scenario

**Conforms to SMOKE_DISCIPLINE v1.2. CODER automated suite + T11 readiness are prerequisite, not substitute.**

**Jose executes; PM appends outcome to PHASE_REPORT §3 part 3:**

1. **Build + launch.** `cd command-center && bun run build:app`. Double-click `Command Center.app` from Finder. Window appears with skeleton; §3.4.1 triad passes. (Acceptance 3.8.)

2. **Configure external MCP session.** Jose opens a second Claude Code session in a test project directory with a project-root `.mcp.json` per D-KB-12 wrapped shape. Session connects to commander MCP cleanly. (Prerequisite.)

3. **Spawn first run — `ls -la`.** In the external Claude session, Jose prompts: "Spawn an agent run in Commander that runs `ls -la` in the current directory." Claude calls `spawn_agent_run`. Commander → Preferences → Debug → Recent agent runs shows the run within 3s at `status: running` → `completed`. (Acceptance 3.1, 3.4.)

4. **Worktree check.** Jose opens Terminal. `ls <project-root>/.worktrees/` shows a `run-<uuid>/` directory. `cd <worktree-path> && git rev-parse --is-inside-work-tree` returns `true`. (Acceptance 3.2.)

5. **Spawn second run + open run viewer — `sleep 3 && echo done`.** Jose prompts Claude to spawn a run with this command. From recent-runs panel, Jose clicks "View" on the new row. Run viewer opens with xterm streaming. Over 3s, "done" appears progressively (not all at once). No scrollbar gutter dead strip. (Acceptance 3.3.)

6. **Spawn third run + cancel — `sleep 60`.** Jose prompts Claude to spawn `sleep 60`. Opens run viewer. Clicks Cancel. Within 6s: status flips to cancelled, exit_reason shows SIGTERM path (since sleep respects SIGTERM), PTY pid gone from `ps`. (Acceptance 3.5.)

7. **Spawn fourth run + wall-clock timeout — `sleep 30`, max 3s.** Jose prompts Claude to spawn `sleep 30` with `max_wall_clock_seconds=3`. Within 9s: status flips to timed-out. (Acceptance 3.6.)

8. **Cross-run hook flow.** During the third or fourth test, the Debug → Recent hook events panel shows hook events arriving on matching session_ids alongside the PTY-viewer output. No cross-session contamination. (Acceptance 3.7.)

9. **Cold relaunch regression.** Jose ⌘Q. Relaunches `Command Center.app` from Finder. §3.4.1 triad passes. Bearer unchanged in Preferences → General (D-N1-07 §8.2 held). Four completed/cancelled/timed-out runs still visible in recent-runs panel (persisted across restart). (Acceptance 3.8.)

**Expected outcome:** 9/9 pass (step 2 is prerequisite, not scored — if Jose can't configure MCP, dispatch has a bigger problem than acceptance criteria). Any failure blocks N3 close → N3.1 hotfix. Most likely failure modes: PTY output doesn't stream (G10 instrumentation rotation), cancel SIGTERM timing off (check the 5s grace), wall-clock bound off-by-one. All three are deterministic-code bugs, instrumentable before fix.

---

## §10 — PHASE_REPORT expectations

File: `~/Desktop/Projects/jstudio-commander/command-center/docs/phase-reports/PHASE_N3_REPORT.md`.

CODER fills §1 (dispatch recap), §2 (commits + diff summary), §3 part 1 (automated — `bun test`, cargo check, typecheck, `bun install --frozen-lockfile` clean, lint clean, D-KB-07 narrow-primitive grep still clean, shared-logger type bridge from T0 verified), §3 part 2 (SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2 both verified; shell snippet showing isolated-state pattern pasted), §4 (deviations — worktree fallback semantics, logger bridge shape, any bun:spawn quirks), §5 (issues + resolutions), §6 (deferred — token/iteration bounds if KB-P1.6 scoped to wall-clock only for N3, scrollback UI re-hydration), §7 (tech debt — including WS back-pressure, anything new), §8 (questions), §9 (N4 kanban prep recommendations), §10 (metrics).

§3 part 3 blank until PM appends Jose smoke outcome. 9/9 closes N3.

---

## §11 — Closing

N3 makes Commander actually orchestrate. External Claude Code sessions can spawn, watch, cancel, and timeout child runs through Commander's data surface. The PTY layer + per-session WS topics + xterm lifecycle discipline all hit real use for the first time.

Key risks: Bun.spawn terminal API maturity (mitigated by escalation-gated fallback); hard-bound timing precision (mitigated by G10 root-cause discipline); the first real xterm dispose-on-unmount exercise (verified by T10 integration + T11 isolated smoke). KB-P4.2, P4.6, P4.13, P1.13 all get their first integration-layer test in this phase.

Rotation count estimate: 1–2. Bun.spawn terminal surface is the largest unknown; if it cooperates, one rotation. If it has an edge case around sigterm or output-ordering, possibly two. The four PM-shipped N2 fixes stabilized the plugin→sidecar layer, so N3 builds on clean ground.

No effort estimate in wall-clock. Ships when it ships.

---

**End of dispatch N3. Routing: CTO → Jose → PM → CODER.**
