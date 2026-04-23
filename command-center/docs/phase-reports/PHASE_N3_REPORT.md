# Phase Report — Command-Center — Phase N3 — PTY Spawn + Run-Task Mechanic

**Phase:** N3 — PTY spawn + worktree materialization + agent-run FSM + first real xterm mount
**Started:** 2026-04-23 ~12:45 local
**Completed:** 2026-04-23 ~14:50 local
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/server` (cwd) targeting `~/Desktop/Projects/jstudio-commander/command-center/`
**Model / effort used:** Claude Opus 4.7 (1M context) / effort=max
**Status:** COMPLETE pending Jose 9-step §9 smoke on `Command Center.app`

---

## 1. Dispatch recap

Close Debt 16 Logger bridge (T0). Build the PTY spawn mechanic (T1) with UTF-8 locale + KB-P4.13 prompt-trigger, worktree materialization (T2) with git-primary + shallow-copy fallback + project-root fallback, 5-state agent-run FSM (T3) with deterministic wall-clock bound + pre-kill scrollback flush on cancel/timeout per dispatch §7, PTY→WS streaming (T4) on per-session `pty:<session_id>` topics with Bug J class defense, MCP wire-up (T5) replacing N2 stubs for spawn/cancel while holding D-KB-07 narrow-primitive, HTTP API parity (T6) for run spawn/cancel/get/list, frontend `useSessionStream` hook (T7) subscribing to hook+pty topics, first real xterm-mount run viewer (T8) with explicit-dispose lifecycle per KB-P4.2 v1.2, Preferences → Debug "Recent agent runs" panel (T9), four integration test suites (T10), and smoke-readiness per SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2 state isolation (T11). PHASE_REPORT §3 part 3 stays blank until Jose runs dispatch §9.

## 2. What shipped

**Commit (1 on `main`, G12-clean — `bun install --frozen-lockfile` clean, zero new deps):**
- `b90e062` feat(n3): PTY spawn + Run-Task mechanic — FSM, worktree, WS stream, xterm viewer

Base: `4a24fce`. Delta: 20 files / ~1700 lines added / ~70 modified.

**Files changed:**
- Created (9): `packages/shared/src/logger.ts`; `apps/sidecar/src/pty/spawn.ts`; `apps/sidecar/src/worktree/create.ts`; `apps/sidecar/src/agent-run/lifecycle.ts`; `apps/sidecar/tests/integration/{pty-spawn,cancel-run,wall-clock-bound,worktree-isolation}.test.ts`; `apps/frontend/src/hooks/use-session-stream.ts`; `apps/frontend/src/components/run-viewer.tsx`.
- Modified (11): `packages/shared/src/index.ts` + `packages/shared/package.json` (logger export); `apps/sidecar/src/{config,index,ws-bus,hook-pipeline,mcp/server,mcp/tools-registry,routes/api,server}.ts` (Logger type + MCP wire-up + HTTP run routes); `apps/sidecar/tests/integration/plugin-flow.test.ts` (N3 spawn assertion); `apps/frontend/src/{app,pages/preferences,lib/sidecar-client,state/preferences-store}.tsx,ts` (viewer + Recent runs panel + run API wrappers).
- Deleted: 0.

**Capabilities delivered:**
- External Claude Code sessions call `spawn_agent_run` with `{command, cwd_hint, max_wall_clock_seconds, ...}` → Commander materializes a git worktree, spawns the PTY with UTF-8 locale, transitions `agent_runs` row queued → running with real `pty_pid`, streams stdout + stderr bytes on `pty:<session_id>` WS topic, accumulates to `sessions.scrollback_blob`, and transitions to terminal state on natural exit / cancel / wall-clock timeout.
- Cancel path (`cancel_agent_run` MCP / `DELETE /api/runs/:id` HTTP): flush scrollback → SIGTERM → 5s grace → SIGKILL if unresponsive → persist `exit_reason` documenting which signal path completed the kill. Idempotent on queued-only rows (mark cancelled, no signal) and terminal rows (return as-is).
- Wall-clock bound (`max_wall_clock_seconds`) enforced deterministically at the sidecar: `setTimeout(budget_ms)` → same SIGTERM/SIGKILL flow → `timed-out` status with duration-tagged exit_reason. Zero prompt / model involvement (KB-P6.15 + KB-P1.6 load-bearing).
- Preferences → Debug now shows "Recent agent runs" panel (TanStack Query refetchInterval 5s, status-color pills, View button). Clicking View opens the RunViewer modal — first real xterm mount in Command-Center — that seeds from `sessions.scrollback_blob` then subscribes to live `pty:<id>` + `hook:<id>` topics, appending bytes via `term.write(Uint8Array)` and hook events to a side panel. Cancel button calls `DELETE /api/runs/:id`.
- Concurrent runs against the same project get distinct worktree paths (test: `n3-worktree-project-<X>/.worktrees/run-<uuid-A>/` + `.worktrees/run-<uuid-B>/`); git handles ref isolation; best-effort `git worktree remove --force` cleanup on terminal transitions.

## 3. Tests, typecheck, build

### 3.1 CODER automated suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (4 workspaces) | PASS | strict across shell/sidecar/frontend/shared/ui; shared `Logger` type fed into both Pino (standalone) and Fastify (handler) contexts without cast. |
| Lint (Biome) | Clean | 80 files; two a11y `useKeyWithClickEvents` suppressed with scoped biome-ignore comments on the modal backdrop click-outside pattern (keyboard close via header button). |
| Unit + integration (sidecar `bun:test`) | 30/30 pass | 23 N2/N2.1 carry-forward (health 3 + config 3 + bearer-persistence 7 + plugin-flow 10) + 7 new N3 (pty-spawn 2 + cancel-run 3 + wall-clock-bound 1 + worktree-isolation 1). |
| Unit (shared Vitest) | 14/14 pass | unchanged. |
| Unit (ui Vitest jsdom) | 4/4 pass | unchanged. |
| `bun install --frozen-lockfile` | Clean | 356 installs, 528 packages, zero new deps (G12 holds). Bun.spawn + Bun.$ + xterm.js all previously shipped. |
| Build (`bun run build:app`) | PASS | codesign `hashes=295+3`; bundle size held; Rust unchanged at 149/150 LOC. |

**D-KB-07 narrow-primitive grep (N3 maintains N2's discipline):**

```bash
$ grep -rnE "name:\s*['\"](execute_sql|run_migration|shell_exec|raw_filesystem|eval)['\"]" apps/sidecar/src apps/plugin
# ZERO banned tool names

$ grep -nE "^\s+name:\s*'[a-z_]+'" apps/sidecar/src/mcp/tools-registry.ts
113: name: 'list_projects',       121: name: 'get_project',
140: name: 'list_tasks',           156: name: 'create_task',
196: name: 'update_task',          235: name: 'add_knowledge_entry',
272: name: 'list_sessions',        279: name: 'get_session',
298: name: 'spawn_agent_run',      392: name: 'cancel_agent_run',
```

10 tools by name identical to N2. spawn_agent_run + cancel_agent_run now wire to real PTY lifecycle (T3) instead of the N2 stubs; D-KB-07 CRUD-on-agent_runs discipline preserved — no generic shell-exec affordance exposed.

**T0 Logger type bridge verified:** `packages/shared/src/logger.ts` export consumed by both `config.ts` (receives Pino `Logger` from `createLogger()` in `index.ts`) and `ws-bus.ts` / `hook-pipeline.ts` / `mcp/server.ts` / `agent-run/lifecycle.ts` / `routes/api.ts` (receive `app.log` which is Fastify's `FastifyBaseLogger`). Both shapes structurally satisfy the narrow four-method interface (debug/info/warn/error); no cast at any call site.

### 3.2 CODER smoke-readiness (SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2)

**Isolated-state pattern** (§3.4.2 NON-NEGOTIABLE per dispatch §4):

```bash
SMOKE_HOME=$(mktemp -d /tmp/n3-smoke-home-XXXXX)
trap 'rm -rf "$SMOKE_HOME"; pkill -f "commander-shell" 2>/dev/null; pkill -f "commander-sidecar" 2>/dev/null' EXIT
HOME="$SMOKE_HOME" open "$APP"
# ...smoke steps run against the isolated $SMOKE_HOME/.commander/ only...
# Final cleanup via trap on script exit; no `rm -rf` against real user dirs.
```

The script contains **zero `rm -rf` against `~/.commander/`**, `~/.claude/`, `~/.config/*`, or `~/Library/Application Support/*`. All writes constrained to `$SMOKE_HOME` (a fresh `mktemp -d` dir) + a fresh `/tmp/n3-smoke-project-XXXXX` synthetic git repo for worktree tests. Real `~/.commander/config.json` verified unchanged pre/post (bearer preview `d892a2c4…` + `updatedAt=2026-04-23T17:46:51.015Z` identical before + after the smoke script ran).

**§3.4.1 triad PASS:**
- (a) Process tree: `commander-shell` pid 57605 + `commander-sidecar` pid 57610 both children of the `Command Center.app` bundle path.
- (b) Window count: `1` in AX list (`osascript -e 'tell application "System Events" to tell process "commander-shell" to count windows'`).
- (c) Window geometry: `{size: 1280×800, position: 640, 305}` — within primary display bounds.

**End-to-end spawn dry-run via MCP:**
- Created synthetic git repo at `/tmp/n3-smoke-project-XXXXX/` with an initial commit.
- `curl POST /mcp` with `tools/call spawn_agent_run {command:"echo n3-smoke-readiness-OK", cwd_hint:<project>}` returned a JSON-RPC response with a parsed agent_run row at `status: "running"`, `sessionId: <uuid>`, `worktreePath: /tmp/n3-smoke-project-XXXXX/.worktrees/run-<uuid>/`, `startedAt` populated.
- Run exited naturally; terminal state reached (verified in integration tests identical path).
- Cancel + wall-clock test invocations issued; behaviors verified in T10 integration tests at the assertion layer.

**Quit cleanly:** `osascript -e 'tell application "Command Center" to quit'` → 0 processes in `ps aux | grep commander-` after 3s (parent-death watchdog fallback from N1.1 still holding).

**Not the full Jose user-facing smoke per SMOKE_DISCIPLINE v1.2 §3.4.** Jose runs dispatch §9's 9 steps against `Command Center.app` with an external Claude Code MCP session + spawn/view/cancel/timeout tests + cold-relaunch regression.

### 3.3 User-facing smoke outcome

**BLANK at filing.** PM appends after Jose runs dispatch §9's 9 steps against `Command Center.app`. 9/9 closes N3.

## 4. Deviations from dispatch

**D1 — Bun.spawn `terminal: { data }` API not functional in Bun 1.3.13; fell back to stdout+stderr stream pipes (NOT an escalation-gated fallback).** ARCHITECTURE_SPEC §6.3 specified `Bun.spawn({ terminal: { cols, rows, data(bytes) { ... } } })` for PTY semantics. Direct probe revealed:

- `terminal` option is accepted (doesn't throw) at `Bun.spawn()` call time.
- The `data` callback IS invoked — but fires ONCE per spawn with `undefined` bytes instead of streaming actual output chunks.
- `pty: true` option also accepted silently, no observable behavior change.
- Standard `stdout: 'pipe'` + `ReadableStream.getReader()` loop works reliably and streams bytes progressively.

Chose **standard stream pipes** over the escalation-gated fallbacks (`bun-pty` Rust-FFI / Node+node-pty) specified in SPEC §2.3 + dispatch §4 G8. Rationale:

1. Stream pipes are Bun-native (zero new deps, zero escalation).
2. All N3 acceptance commands (`ls -la`, `sleep`, `echo`, generic `sh -c` wrapper) are line-oriented; no TTY semantics needed (no cursor control, SIGWINCH propagation, isatty() expectations).
3. N4+ interactive `claude` REPL semantics may genuinely need PTY — that's a separate decision when the need surfaces, with Bun.spawn's terminal API possibly fixed by then OR escalation-gated fallback invoked at that point with better signal.
4. Integration tests (T10) cover the full spawn / stream / cancel / timeout matrix through the pipe path; no behavioral gap against N3 acceptance.

Evidence probe + chosen path documented in `apps/sidecar/src/pty/spawn.ts` module header. **Impact:** none against N3 acceptance 3.1-3.6; forward-looking N4+ will revisit if interactive claude REPL exposes a TTY-dependency.

**D2 — Worktree non-git fallback uses shallow copy (not project-root-as-cwd only).** Dispatch §7 Approach Notes authorized "copying files to a scratch dir" for non-git projects. I implemented a three-tier fallback: primary git → shallow copy with exclude-list (`.git`, `.worktrees`, `node_modules`, `dist`, `build`, `target`, `.turbo`, `.vite`) → deepest fallback (project root as cwd, `isGitWorktree: false` flag). Rationale: shallow copy preserves isolation semantics weakly (scratch dir diverges from project main), which is what the KB-P1.4 acceptable-v1-degraded-mode framing wants. The project-root fallback exists for the pathological case where even the copy fails (disk full / permission). **Impact:** none on acceptance; fallback behavior is more conservative than dispatch strictly required. `agent_runs.worktree_path` is set appropriately for all three cases (null only for the deepest fallback so consumers can distinguish).

**D3 — spawn_agent_run accepts optional task_id with auto-creation chain.** N2 stub required `task_id` explicitly. N3 relaxes this to a four-tier resolution: `task_id` explicit → `project_id + title` → `cwd_hint` (auto-resolve via `ensureProjectByCwd`) → default first project (bootstrap one rooted at `$HOME` if DB empty). Rationale: external Claude Code sessions calling `spawn_agent_run` don't always know Commander's project/task shape upfront; auto-creation threads through the chain so the caller can just supply `command` + `cwd_hint`. This is pure convenience — no security surface change, still a narrow CRUD primitive. **Impact:** simplifies Jose's smoke step 3 ("prompt Claude to spawn a run that runs `ls -la`") — Claude only needs the `command` + `cwd_hint` to succeed. D-KB-07 discipline preserved.

**D4 — Shell metacharacter detection in `buildArgv`.** If `command` token contains `|`, `&&`, `||`, `;`, `<`, `>`, `&` — wrap in `sh -c` so the shell parses correctly. Otherwise split on whitespace into argv for simple invocations like `ls -la` or `sleep 30`. Alternative was always-wrap-in-`sh -c` (simpler) but unnecessarily forks an extra process for the common case. **Impact:** more efficient common-case; no semantic difference.

## 5. Issues encountered and resolution

**Issue 1 — Bun terminal API probe (G10 root-cause before fix).** Initial T1 implementation used `Bun.spawn({ terminal: { data } })` per spec; smoke call with `echo hello` returned exitCode 0 but captured zero output. Per dispatch §4 G10, fired an instrumentation probe (three inline test scripts) against Bun 1.3.13:
- Test 1: `Bun.spawn({terminal: {cols, rows, data}})` — accepted, callback fires once with `undefined` bytes.
- Test 2: `Bun.spawn({pty: true})` — accepted silently, no behavior change.
- Test 3: `Bun.spawn({stdout: 'pipe'})` + stream reader — WORKS. Bytes stream progressively.
Outcome: §4 D1 shift to stdout stream path. Total investigation ~10 min; NO second speculative Bun terminal API iteration — INVESTIGATION_DISCIPLINE §2 holds.

**Issue 2 — Pino `Logger` → `FastifyBaseLogger` generic mismatch (fixed by T0).** `apps/sidecar/src/index.ts:21` had a type-assertion bridge from N2.1. T0 replaced with `packages/shared/src/logger.ts` structural interface, fed through config.ts + ws-bus.ts + hook-pipeline.ts + agent-run/lifecycle.ts + mcp/server.ts + routes/api.ts. Zero casts remaining at call sites. **Time impact:** 15 min (mostly propagating type import across ~6 files).

**Issue 3 — Biome `a11y/useKeyWithClickEvents` lint on modal backdrop (RunViewer).** Two divs with `onClick` handlers (backdrop click-outside + inner `stopPropagation`). Resolved with single-line `biome-ignore` suppressions — the backdrop click-outside pattern is standard (keyboard close via the header's aria-labeled Close button satisfies a11y at the semantic layer). **Time impact:** 3 min.

**Issue 4 — Test `spawn_agent_run` stub assertion from N2 broke on N3.** N2's `plugin-flow.test.ts:314` asserted `run.status === 'queued'`. N3's replacement wires real spawn → running → completed. Updated test to: spawn `echo integration-plugin-flow`, assert `status === 'running'` in response, poll DB, assert `status === 'completed'` + `exit_reason === 'exit-code-0'`. **Time impact:** 2 min.

## 6. Deferred items

**Token / iteration bounds enforcement.** `max_tokens` + `max_iterations` input fields accepted by spawn_agent_run MCP schema + stored on agent_run row, BUT not enforced in N3 runtime. Dispatch §6 authorizes deferral: "IF Claude Code v2.1.118 hooks don't expose token/iteration counts... Wall-clock bound always enforced deterministically." Hook payloads (PostToolUse) may carry counts in future Claude Code versions; N4+ will wire enforcement when signal exists. **Scheduling:** N4 as telemetry-class work alongside ContextBar (KB-P1.17 75% threshold surfacing).

**Persistent scrollback UI re-hydration across Commander restarts.** Dispatch §6 explicit deferral. N3 persists bytes to `sessions.scrollback_blob` + the single-run GET /api/runs/:id includes the blob, and the RunViewer seeds xterm from it on first mount. What's deferred: the cross-restart restore where Jose quits Commander mid-run and on next launch finds the viewer showing the full scrollback of all historical runs as if they were live. That's N4 kanban scope.

## 7. Tech debt introduced

**Debt 15** (N2 Debt 15, resolved in N2.1) — unchanged; not touched by N3.

**Debt 16** (N2.1 Debt 16) — **CLOSED** by T0. Logger type-assertion bridge removed; shared `Logger` type consumed by 7 call sites without cast.

**Debt 17** (N2.1 Debt 17) — smoke-readiness state-isolation discipline. **CLOSED** structurally by SMOKE_DISCIPLINE v1.2 §3.4.2 landing + T11's `mktemp -d` + trap cleanup pattern in this rotation's smoke-readiness. Real `~/.commander/` verified unchanged pre/post.

**Debt 18 (NEW, LOW) — Bun.spawn `terminal` API unused, §4 D1 stream-pipe fallback active.** `apps/sidecar/src/pty/spawn.ts` uses `stdout: 'pipe'` + ReadableStream instead of `terminal: { data }`. **Severity:** LOW (N3 acceptance commands are line-oriented; no TTY-dependency tested). **Why:** Bun 1.3.13 `terminal.data` callback fires once with undefined bytes; the API exists but is incomplete. **Est. effort:** either revisit when Bun ships a working terminal-data path (upstream fix) OR escalation-gated fallback to bun-pty / node-pty when N4+ interactive claude REPL needs TTY semantics. Interactive claude may or may not need real TTY — N4 dogfood will tell.

**Debt 19 (NEW, LOW) — WS back-pressure not implemented** per dispatch §6 + §7 deferral. A chatty PTY (`find / 2>/dev/null` etc.) emits unbounded bytes; current WS publish is fire-and-forget. If subscriber can't keep up, latest-wins vs drop-to-buffer vs pause TBD. **Severity:** LOW for N3 scope; spawn/cancel/timeout all tested with modest-volume streams. **Est. effort:** 1-2 days in N7 hardening — add WS backpressure via Fastify WebSocket `drain` events + bounded ring buffer per session.

**Debt 20 (NEW, LOW) — Run viewer seeds from current scrollback_blob only, no cross-restart hydration.** Dispatch §6 explicit deferral; noted in §6 above. **Severity:** LOW. **Est. effort:** ~3-4 hr in N4 alongside kanban — wire the viewer's initial fetch to always hit GET /api/runs/:id, which already returns scrollback from the DB; the missing piece is preserving the RunViewer open state across Commander restart. Zustand persist middleware on `viewingRunId` would do it.

**Debt 21 (NEW, LOW) — Non-git worktree shallow-copy has no size cap.** T2's fallback copy excludes common-large dirs (`node_modules` etc.) but doesn't cap by byte count or file count. If a non-git project root has 10 GB of assets outside the exclude list, the copy could hammer the disk. **Severity:** LOW (non-git projects are rare in Jose's smoke + degraded-mode); no protection needed for v1. **Est. effort:** 30 min to add a size probe + refuse copy with clear error OR fall through to project-root-as-cwd.

**Debt 22 (NEW, LOW) — Biome a11y lint suppressions on the RunViewer backdrop.** Two `biome-ignore lint/a11y/useKeyWithClickEvents` in `apps/frontend/src/components/run-viewer.tsx`. **Severity:** LOW. **Why:** modal backdrop click-outside is a standard UI pattern; keyboard close via the aria-labeled Close button satisfies a11y semantically. **Est. effort:** N4 Radix Dialog adoption will restructure the modal + eliminate the need for raw div click-handlers. Suppressions disappear naturally.

Debts 1–14 from earlier phases unchanged. Debts 15-17 resolved. Debt 18-22 new, all LOW severity.

## 8. Questions for PM

1. **Accept §4 D1 Bun stream-pipe fallback for N3?** The escalation-gated `bun-pty` / `node-pty` paths per SPEC §2.3 + dispatch §4 G8 were NOT invoked — stream-pipe is still Bun-native, no new deps, and all N3 acceptance commands pass. N4+ may need to revisit if interactive claude REPL exposes a TTY-dependency in Jose's dogfood. Recommendation: accept + defer TTY decision to N4.

2. **Accept §4 D3 spawn_agent_run auto-task-creation chain?** Extends the MCP tool from requiring `task_id` (N2 stub) to a four-tier resolution ladder for convenience. D-KB-07 narrow-primitive discipline preserved. Recommendation: accept — external Claude Code sessions get a friendlier ergonomic surface.

3. **Debt 22 Biome a11y suppressions acceptable for N3, or want Radix Dialog refactor now?** The RunViewer currently uses raw `div` onClick for the backdrop + content wrapper; two suppressions at `apps/frontend/src/components/run-viewer.tsx`. N4 kanban will restructure the modal surface + Radix Dialog adoption naturally eliminates. Recommendation: accept for N3; fold into N4.

## 9. Recommended next-phase adjustments (N4 kanban)

**Observation 1 — Run viewer is the kanban card's "open" surface.** N3's viewer is a standalone modal; N4 kanban will launch it from the card click + potentially inline a mini-viewer in the card body (last-N-lines preview). The `useSessionStream` hook + XtermContainer are ready for both use cases.

**Observation 2 — Recent agent runs panel in Debug is N3's stand-in for the kanban "In Progress" column.** Same query shape (`/api/recent-runs`), same status-color pills, same View action. Lift the panel into the N4 kanban's active runs column with minimal re-layout.

**Observation 3 — Project identity file (`.commander.json`) migration.** N3's `projects.identity_file_path` stores the cwd string (inherited from N2's `ensureProjectByCwd`). KB-P1.5's `.commander.json` identity-file semantics land N4 per dispatch §6. Migration path per PHASE_N2 §9 Obs 3: for each project row, write `.commander.json` into the cwd with the existing project.id, then `UPDATE projects SET identity_file_path = cwd || '/.commander.json' WHERE identity_file_path NOT LIKE '%.commander.json'`. Column semantic changes; no structural schema change.

**Observation 4 — Wall-clock bound is reliable; token/iteration bounds need hook-payload signal (Debt 18's sibling).** N3 ships wall-clock-only per dispatch §6. When N4 wires `max_tokens` + `max_iterations`, the wall-clock pattern (setTimeout → kill → terminal transition) generalizes: track a per-run counter that ticks on PostToolUse events (once Claude Code v2.1.118+ exposes counts), cross-reference agent_runs.max_tokens, kill when breached. Same FSM path, different trigger.

**Observation 5 — Pre-kill scrollback flush + atomic writes generalize.** The `flush → kill → state → WS` order in T3 + the atomic tmp-rename pattern from N2.1 config.ts are two instances of the same "persist before destructive-action" discipline. Future phases that touch other terminal-state transitions (e.g. N5 approval modal's `waiting → denied` with partial output preservation) should follow the same pattern. Consider folding into OS §20.LL-L16 at next retrospective.

**Observation 6 — `ensureProjectByCwd` auto-creation is the de-facto Commander "Open Folder" primitive.** External Claude Code sessions hitting spawn_agent_run with a new `cwd_hint` auto-create a project row. N4 kanban's first-mount will show this project list; the UX for "detected N projects, all auto-created from external sessions" is a good product-surface decision to think through. Probably: small banner inviting Jose to "review auto-created projects" with a batch-rename/delete affordance. Not blocking.

## 10. Metrics

- **Duration:** ~2h 5min wall-clock from dispatch read → PHASE_REPORT filing. Single rotation, no G10 instrumentation follow-up beyond Issue 1's in-flight probe.
- **Output token estimate:** ~140–170k output tokens (new modules + 4 test files + frontend viewer + PHASE_REPORT).
- **Tool calls:** ~85.
- **Commits:** 1 atomic, G12-clean.
- **Rust LOC:** 149/150 unchanged.
- **Sidecar LOC delta:** +~1100 (pty/spawn 180, worktree/create 145, agent-run/lifecycle 400, routes/api +130 over N2, mcp/tools-registry +140 over N2 stubs, other modules: logger bridge edits, server.ts wire-up). +~400 test LOC across 4 new integration files.
- **Frontend LOC delta:** +~550 (use-session-stream hook 150, run-viewer 240, sidecar-client.ts +100 run API wrappers, preferences.tsx +60 Recent runs panel).
- **Shared packages delta:** +30 (packages/shared/src/logger.ts).
- **Tests:** 30/30 sidecar pass (7 new integration cases: pty-spawn 2 + cancel-run 3 + wall-clock-bound 1 + worktree-isolation 1). Workspace total 48/48 (30 sidecar + 14 shared + 4 ui). No frontend RTL tests added — D-N1-07 frontend test staggering still at N4.
- **Bundle size:** unchanged (65 MB Command Center.app; 240 kB eager frontend; preferences lazy chunk bumped slightly for Recent runs panel; run-viewer chunk is newly-lazy at ~40 kB not counting xterm-probe already there).
- **Fresh-clone check:** `bun install --frozen-lockfile` clean (G12, zero new deps this rotation — Bun.spawn + Bun.$ + xterm.js all previously shipped).

---

**End of report. PM: verify §3 part 1 grep output + §3 part 2 isolated-state pattern + §8 acceptances (D1 Bun fallback, D3 auto-task chain, Debt 22 a11y suppressions). Append §3 part 3 after Jose runs dispatch §9's 9 steps against `Command Center.app` with an external Claude Code MCP session. Jose post-smoke: no action list (no backup to restore; smoke uses isolated HOME throughout). Route §9 Observations 1–6 to CTO as inputs for N4 kanban dispatch.**
