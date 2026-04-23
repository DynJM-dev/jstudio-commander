# CTO_BRIEF — Command-Center N3 CLOSE + N4 draft request

**From:** PM · 2026-04-23
**Status:** N3 CLOSED on 9/9 user-facing smoke PASS. PTY spawn + worktree materialization + 5-state agent-run FSM + first real `pty:<session_id>` + `hook:<session_id>` WS subscribers + deterministic wall-clock bound + SIGTERM→5s→SIGKILL cancel path + pre-kill scrollback flush — all validated end-to-end with an external Claude Code v2.1.118 MCP session. The largest rotation yet, single-ship, no iterations.

## §1 — Commit chain (4a24fce → 30d2230 commander-repo; 92b7e17 meta-repo)

4 commits commander-repo for N3:

- `b90e062` feat(n3): PTY spawn + Run-Task mechanic — FSM, worktree, WS stream, xterm viewer [CODER, 20 files +1700/~70]
- `4a9c221` docs(n3): PHASE_N3_REPORT — CODER sections filed, §3 part 3 blank for PM [CODER]
- `30d2230` docs(n3): append §3.3 PASSED 9/9 + Debts 23-24 + UX observation — N3 CLOSES [PM]

Plus `92b7e17` meta-repo: SMOKE_DISCIPLINE v1.2 §3.4.2 state-isolation landed earlier this cycle.

Scope: **48/48 tests** (30 sidecar + 14 shared + 4 ui; 7 new N3 integration cases: pty-spawn, cancel-run, wall-clock-bound, worktree-isolation). **Zero new deps** (G12 — Bun.spawn + Bun.$ + xterm.js all previously shipped). **Rust 149/150** unchanged (G5). Bundle size held. `bun install --frozen-lockfile` clean. D-KB-07 narrow-primitive grep clean (10 MCP tools unchanged; spawn/cancel now wire to real PTY lifecycle instead of N2 stubs; shell command is user-explicit Claude-Code-layer intent, not a generic shell-exec affordance).

## §2 — §8 deviation + question ratifications

All three §8 questions PM-ratified + committed; CTO concurrence requested:

**Q1 — §4 D1 Bun stream-pipe fallback (NOT escalation-gated):** ACCEPT. Bun 1.3.13's `terminal.data` callback fires once with `undefined` bytes — API exists but incomplete. CODER's G10 probe (3 inline test scripts, <10 min) surfaced this, shifted to Bun-native `stdout: 'pipe'` + ReadableStream path. This is NOT the §2.3-gated fallback to bun-pty / node-pty — it's adapting inside the Bun runtime. All N3 acceptance commands (`ls`, `sleep`, `echo`) are line-oriented; no TTY semantics needed. Forward-looking risk: interactive `claude` REPL at N4+ may genuinely need real TTY — Debt 18 tracks; proper §2.3 escalation-gated decision happens at that point with better signal (is Bun upstream fixed by then? Is TTY truly required vs pipe-sufficient for `claude`?).

**Q2 — §4 D3 spawn_agent_run auto-task-creation chain:** ACCEPT. Four-tier resolution (`task_id` explicit → `project_id+title` → `cwd_hint` → default-first-project) absorbs external Claude Code sessions' reality — they don't know Commander's project/task shape upfront. D-KB-07 narrow-primitive discipline preserved (CRUD on agent_runs rows; shell command is user's explicit Claude-Code-layer intent via bearer-authed MCP, not a generic shell-exec affordance). Ergonomic win for external callers.

**Q3 — Debt 22 Biome a11y suppressions on RunViewer backdrop:** ACCEPT for N3. Two `biome-ignore lint/a11y/useKeyWithClickEvents` on backdrop click-outside pattern. Keyboard close via aria-labeled Close button satisfies a11y semantically. N4 Radix Dialog adoption restructures the modal surface and suppressions disappear without explicit refactor cost.

**Additional accepted deviation, no question raised but worth CTO note:**

**§4 D2 worktree three-tier fallback:** ACCEPT. Dispatch §7 authorized two-tier (git → copy); CODER shipped three-tier (git → shallow-copy with exclude-list → project-root-as-cwd with `worktree_path=NULL`). More conservative; degraded modes distinguishable via `worktree_path` value. KB-P1.4's "acceptable v1 degraded mode" framing preserved.

## §3 — T0 closed Debt 16 (Logger type bridge)

`packages/shared/src/logger.ts` now exports a structural `Logger` type bridging Pino's `Logger` and Fastify's `FastifyBaseLogger` without cast. Consumed by 7 modules (`config.ts`, `ws-bus.ts`, `hook-pipeline.ts`, `agent-run/lifecycle.ts`, `mcp/server.ts`, `routes/api.ts`, `index.ts`). Zero `as unknown as Parameters<…>` remaining. Debt 16 CLOSED.

## §4 — New tech debt from N3 (all LOW)

**Debt 18** — Bun.spawn `terminal` API unused, §4 D1 stream-pipe fallback active. Revisit if Bun ships upstream fix OR N4+ interactive `claude` REPL surfaces a real TTY dependency.

**Debt 19** — WS back-pressure not implemented per dispatch §6 deferral. Chatty PTY (`find / 2>/dev/null`) could outpace subscribers. N7 hardening.

**Debt 20** — RunViewer seeds from current scrollback_blob only, no cross-restart hydration. Dispatch §6 explicit deferral. N4 kanban fold (~3-4 hr; Zustand persist on `viewingRunId`).

**Debt 21** — Non-git worktree shallow-copy has no byte/file-count cap. Non-git projects are rare in Jose's smoke; not blocking v1.

**Debt 22** — Biome a11y suppressions on RunViewer backdrop (accepted per Q3 above). Eliminated by N4 Radix Dialog adoption.

**Debt 23 (PM-filed post-smoke)** — RunViewer clears live xterm output on `running → completed` transition. Data IS preserved (close+reopen restores from scrollback_blob); UI lifecycle artifact only. Likely `useSessionStream` hook or RunViewer effect-dependency rerun clearing xterm buffer on status flip. Fix ~30-45 min in `use-session-stream.ts` / `run-viewer.tsx`. **Scheduling:** natural fold with N4 RunViewer restructure.

**Debt 24 (PM-filed post-smoke)** — Recent agent runs panel ordering non-chronological. The `bee17096` row (only NULL-worktree_path entry) pinned to position 1 + new entries land at arbitrary positions unrelated to timestamps. Likely NULL-handling in SQL `ORDER BY` or JS comparator. Cosmetic in diagnostic panel; not data impacting. N4 kanban's ordering implementation replaces this entirely.

All LOW severity. Zero MEDIUM/HIGH introduced. Net N3 effect: +7 debt (18-24), Debt 16 closed. Debts 1-14 + 17 + 20 unchanged. Debt 15 already resolved in N2.1.

## §5 — UX Observation A (for CTO N4 scope)

RunViewer has only an Exit (×) affordance; no "Back" or prev-view button. Low relevance for N3 (single viewer surface at a time) but becomes real UX friction in N4 kanban when card → viewer → card navigation lands (users will want to return to kanban context after viewing a run). Worth explicit dispatch-scope inclusion in N4: either inline the RunViewer into a card-navigation stack OR add a Back button that navigates to the previous kanban view state.

## §6 — §9 Observations 1-6 routing for N4 kanban

From PHASE_N3_REPORT §9 (6 items; full detail in report):

- **Obs 1** — RunViewer is the kanban card's "open" surface. N4 launches it from card click + potentially inlines a mini-viewer in card body (last-N-lines preview). `useSessionStream` + XtermContainer ready for both.
- **Obs 2** — Debug "Recent agent runs" panel is N3's stand-in for kanban's "In Progress" column. Same query shape + status pills + View action. Lift panel into kanban's active-runs column with minimal re-layout.
- **Obs 3** — `.commander.json` identity-file migration per KB-P1.5. N3 uses `projects.identity_file_path = cwd` inherited from N2's `ensureProjectByCwd`. N4 migration: write `.commander.json` into each cwd with existing project.id, update identity_file_path column to point at the file. Column stays stable; semantic changes.
- **Obs 4** — Wall-clock deterministic; token/iteration bounds need hook-payload signal (PostToolUse counts). Ship `max_tokens` + `max_iterations` enforcement in N4 alongside ContextBar (KB-P1.17 75% threshold surfacing) when Claude Code v2.1.118+ exposes counts.
- **Obs 5** — Pre-kill scrollback flush (N3) + atomic-write tmp-rename (N2.1 config.ts) are both instances of the same **"persist before destructive-action"** discipline. Worth codifying as OS §20.LL-L16 at next retrospective landing — see §7 below.
- **Obs 6** — `ensureProjectByCwd` auto-creation is the de-facto Commander "Open Folder" primitive. External sessions hitting `spawn_agent_run` with a new `cwd_hint` auto-create a project row. N4 kanban first-mount surfaces this project list; needs UX decision for "detected N auto-created projects" (batch rename/delete affordance vs silent absorb).

## §7 — Proposed OS §20.LL-L16 amendment — persist-before-destructive-action

Two ship patterns this cycle are the same principle:

- **N2.1 atomic config.json write:** `writeFile(tmp) → rename(tmp, file)` — persist before the atomic replace that could tear across a crash.
- **N3 pre-kill scrollback flush on cancel + timeout:** `flush(sessions.scrollback_blob) → SIGTERM → wait 5s → SIGKILL → status transition → WS event` — persist before the termination signal that could lose in-memory state.

Both eliminate a window where a destructive action (atomic rename, kill signal) could destroy uncommitted state. Generalizes to N5 approval-denied partial output preservation + any future state-transition handler that destroys in-memory data.

**Proposed OS §20.LL-L16:**

> **§20.LL-L16 — Persist-before-destructive-action.** Any state transition that destroys in-memory data (process termination, atomic replace, connection close, buffer eviction) MUST flush the data to durable storage BEFORE the destructive step. Ordering: persist → destructive-action → state-transition → observability event. Examples: atomic-write tmp+rename for config rewrites (N2.1 config.ts); pre-kill scrollback flush on SIGTERM/SIGKILL paths (N3 agent-run/lifecycle.ts); approval-denied partial-output preservation (N5). When the discipline is violated, the symptom is "data loss on crash / cancel / timeout that looks transient but is actually lost forever" — much harder to debug than explicit failures.

Mechanical fold — ~15 lines to append OS §20.LL-L16. Can do at next OS retrospective or now; PM can fold if CTO ratifies.

## §8 — Standing context

- D-KB-07 narrow-primitive: HELD through N3 (spawn/cancel are CRUD on agent_runs; not shell-exec).
- D-KB-08 Tauri perf: still validated.
- D-KB-09..12 KB v1.4 / SPEC v1.3 calibration: HELD; N3 dispatch written against corrected docs + Jose's external MCP used the wrapped `.mcp.json` shape first-try.
- `~/.commander/` state dir: in use + bearer stable across smoke.
- `bun:test` at sidecar: 30/30 green.
- SMOKE_DISCIPLINE v1.0/1.1 §3.4.1 / v1.2 §3.4.2: all three layers held across N3 smoke-readiness + Jose smoke.
- N2.1 bearer regression test (7 assertions): held — bearer unchanged across smoke's 3+ Commander restarts. D-N1-07 §8.2 contract locked as designed.

## §9 — Asks

1. **Ratify §8 Q1/Q2/Q3 + §4 D2 worktree three-tier fallback** per §2 above. Four deviations all PM-accepted; looking for CTO concur before routing N4 draft.

2. **Ratify OS §20.LL-L16 proposal** per §7 above. Mechanical fold; PM can apply to `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` if CTO concurs with the text.

3. **Draft N4 dispatch (kanban — task-primary UI).** Scope per ROADMAP v0.3 §N4 + Observations 1-6 baked in. Specific fold-ins requested:
   - Kanban with Todo / In Progress / Review / Done columns; each card shows task title + last-run status + token count + worktree-path short.
   - RunViewer inlined into card-click flow OR into a right-drawer (UX call — see UX Observation A about Back button).
   - **Debt 23** fix bundled (keep xterm buffer on running→completed).
   - **Debt 24** replaced by kanban's chronological implementation (not fixed in-place; kanban's list is the replacement).
   - **`.commander.json` identity-file migration** per KB-P1.5 — small migration in N4 T0 or similar.
   - **Token + iteration bounds enforcement** when hook-payload counts are available; ContextBar per-pane with KB-P1.17 75% threshold warning.
   - **Hidden-workspace suspension** per KB-P1.15 if N4 introduces multi-workspace.
   - **Task create / knowledge fields** (markdown instructions + append-only knowledge entries per KB-P1.3).
   - Pre-authorized N4a/N4b split if scope balloons per ROADMAP v0.3 ratification.

4. **Optional N7 pre-note:** Debt 18-21 are N7 hardening candidates; Debt 22/23 naturally close via N4 RunViewer restructure. Not a formal ask — just tracking so the N7 prep has a starting list.

Once N4 dispatch lands, PM runs pre-dispatch reality check + produces CODER prompt. Expected N4 shape: substantial (kanban + modal + card migrations + runs-as-cards + ContextBar + workspace shell); pre-authorized N4a/N4b split if scope balloons.

**End of brief. N4 fires on: 48/48 tests + locked bearer contract + clean plugin→sidecar→MCP pipeline + PTY spawn mechanic end-to-end + 149/150 LOC Rust + zero HIGH debt. Cleanest possible foundation for the kanban lift.**
