# Dispatch N2 — Plugin + MCP Dual-Protocol

**Phase:** N2 — Plugin + MCP integration
**Date drafted:** 2026-04-23
**CTO:** Claude.ai Opus 4.7
**Target path for CODER:** `~/Desktop/Projects/jstudio-commander/command-center/` at HEAD `f595475` (N1 closed 8/8)
**Word budget:** ~3,500 words; full-phase per operating-model commitment #2

---

## §0 — Pre-dispatch reality check (PM-executed)

- Monorepo HEAD at `f595475`. N1 + N1.1 closed 8/8. Clean working tree.
- `Command Center.app` launches from Finder. `~/.commander/` state dir populated with `config.json` (bearer token + sidecar port). SQLite DB has 9 tables, empty.
- Sidecar `/health` responds. Bearer auth active on existing `/health` route.

---

## §1 — Acceptance criteria

**Per SMOKE_DISCIPLINE.md v1.1, every criterion Jose-observable at the outermost layer. §3.4.1 window-presence check applies to CODER smoke-readiness.**

**2.1 — Plugin locally installable + detected.** Jose copies the install command from the new Preferences → Plugin tab, runs it in a Claude Code session from any project directory, and the plugin installs. Running `/plugin` in Claude Code shows `commander` in the installed list. No external GitHub repo required for N2 — local-path install is acceptable.

**2.2 — Hook events flow end-to-end.** With plugin installed, Jose starts a Claude Code session in a test project and sends one user prompt. Back in Command Center → Preferences → Debug tab, a new "Recent hook events" panel shows at least three events (`SessionStart`, `UserPromptSubmit`, one more) with non-null `session_id` + timestamps within the last 60s. Events visible in the UI are read from the sidecar DB via TanStack Query, not fabricated client-side.

**2.3 — De-dupe verified.** Jose clicks a new "Replay last event" button in Preferences → Debug (CODER-added for smoke). Button POSTs the last received hook event back to the sidecar. The recent-events list does NOT grow — de-dupe by `session_id + event_uuid` tuple blocks the duplicate row per KB-P4.3. Debug button is smoke-only per SMOKE_DISCIPLINE §4.2 sanctioned exception.

**2.4 — MCP server callable from external Claude Code.** Jose configures a second Claude Code session with MCP pointing at `http://127.0.0.1:<port>/mcp` with the bearer token, runs a prompt asking Claude to "list projects in Commander." Claude calls the `list_projects` MCP tool; output shows at least one project (the test project from 2.2, auto-created on first plugin event) with real `id`, `name`, `identity_file_path`.

**2.5 — Bearer auth enforced.** Jose runs three terminal probes from PHASE_N2_REPORT §3 (CODER documents exact commands):
- `curl http://127.0.0.1:<port>/health` → `200 OK` (unauthed health endpoint by design).
- `curl -X POST http://127.0.0.1:<port>/hooks/session-start -d '{}'` → `401`.
- `curl http://127.0.0.1:<port>/mcp/tools/list` → `401`.

**2.6 — Narrow-primitive tool surface verified.** Per D-KB-07 (KB-P1.7 v1.3). Grep the sidecar + MCP route registrations for the strings `execute_sql`, `run_migration`, `shell_exec`, `raw_filesystem`, `eval`. Zero matches. Verified during CODER's automated suite, documented in PHASE_N2_REPORT §3 part 1.

**2.7 — Plugin install UX.** Preferences → Plugin tab exists. Shows: install command text, Copy button, status indicator ("Plugin detected" / "Plugin not detected — install to enable hook events"). Status updates live — after Jose installs the plugin and starts a Claude Code session, within 5s the status flips to "Plugin detected" without requiring a Preferences close/reopen.

**2.8 — Zombie-window regression check.** Relaunch `Command Center.app` from Finder cold. SMOKE_DISCIPLINE §3.4.1 check (shell + sidecar in `ps`, ≥1 window in AX list, non-zero window dimensions within display bounds). No regression of N1.1 fix.

---

## §2 — Tasks

**T1 — Plugin package scaffold.** Create `apps/plugin/` in monorepo. Structure per KB-P3.2:
- `.claude-plugin/plugin.json` — name `commander`, version, description.
- `.claude-plugin/marketplace.json` — marketplace entry (populated for future public publish; not required for local install).
- `hooks/hooks.json` — all 13 hook events mapped to `http://127.0.0.1:${COMMANDER_PORT}/hooks/<kebab-case-event-name>`. Each hook uses `Authorization: Bearer $COMMANDER_TOKEN` header with `allowedEnvVars: ["COMMANDER_TOKEN", "COMMANDER_PORT"]`.
- `README.md` — local install instructions.

Events to wire per ARCHITECTURE_SPEC §7.4 + §5.2: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, SessionEnd, PreCompact, PostCompact.

**T2 — Hook routes on Fastify sidecar.** `apps/sidecar/src/routes/hooks.ts` — one POST route per hook event. All routes share a handler pipeline (T3). Routes return within the Claude Code hook timeout budget (documented default 60s; most hooks respond in <50ms).

**T3 — Hook handler pipeline.** Per ARCHITECTURE_SPEC §7.4, each handler executes:

1. **Verify bearer** (shared middleware from T7). 401 on missing/mismatched.
2. **Generate `event_uuid`** if absent in payload (UUIDv4 via `crypto.randomUUID()`). Plugin `hooks.json` should supply UUID if Claude Code 1.x provides one in the hook payload — otherwise sidecar generates.
3. **De-dupe check** by `session_id + event_uuid` tuple — query `hook_events` for existing row; if found, return `{ continue: true }` without persisting again (KB-P4.3).
4. **Persist raw payload** to `hook_events` table per ARCHITECTURE_SPEC §3.2 (raw `payload_json` column stores entire body — KB-P1.1 schema-drift defense).
5. **Emit typed event** on `hook:<session_id>` WS topic (routes defined in T9 below; N2 lands the emit side even if no UI pane subscribes yet).
6. **Update session status** in `sessions` table if the event implies a transition (SessionStart → `initializing`; Stop → `done`; SessionEnd → `done`; etc.).
7. **Respond** — blocking hooks return the required response shape (T4 for PreToolUse); non-blocking hooks return `{ continue: true }`.

**T4 — PreToolUse auto-allow (N2 scope).** PreToolUse handler returns:

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow",
    "reason": "auto-approved (N2 pre-approval-UI; per dispatch §2 T4)"
  }
}
```

Event still persists + emits on WS. Approval UI lands in N5 and will replace this auto-allow with a real decision pipeline. N2 just needs the integration to work end-to-end without blocking Claude Code.

**T5 — MCP server on `/mcp/*` (same Fastify instance).** Implement Model Context Protocol server per spec. Exposes `tools/list` + `tools/call` endpoints. Bearer-authed via the same middleware as hook routes. `tools/list` returns the 10 CRUD tools from T6.

**T6 — MCP CRUD tool implementations.** Per ARCHITECTURE_SPEC §7.3 + D-KB-07 narrow-primitive rule. Each tool is a thin wrapper over the existing HTTP API handlers (share business logic — don't duplicate):
- `list_projects`, `get_project`
- `list_tasks`, `create_task`, `update_task`
- `add_knowledge_entry` (append-only)
- `list_sessions`, `get_session`
- `spawn_agent_run` (N2 accepts the call but spawn is stubbed — returns agent_run row with `status: 'queued'`. Actual PTY spawn lands N3.)
- `cancel_agent_run` (marks row as `cancelled`. Full PTY kill lands N3.)

Each tool has: JSON schema for input, input validation, error envelope on failure matching `{ ok: false, error: { code, message } }`. No `execute_sql`. No `run_migration`. No raw shell/fs access. Verified in acceptance 2.6.

**T7 — Bearer auth middleware.** `apps/sidecar/src/middleware/auth.ts` — shared Fastify preHandler hook. Reads bearer from `Authorization: Bearer <token>` header; compares to token in `~/.commander/config.json`; 401 on missing or mismatched. Applied to all `/hooks/*` and `/mcp/*` routes. `/health` and Tauri-origin requests (detected via origin check for the webview) pass through without bearer (Tauri's custom URL scheme is the implicit auth surface for frontend calls; acceptable for v1 local-only deployment).

**T8 — Settings panel plugin-install-command display.** `apps/frontend/src/routes/preferences/plugin.tsx` — new Preferences tab. Shows:
- Install command text in a monospace box: `/plugin install file://~/Desktop/Projects/jstudio-commander/command-center/apps/plugin` (path resolved at runtime from Tauri `get_resource_path` IPC — do NOT hardcode Jose's absolute path; use whatever Tauri resolves).
- Copy button (shadcn/ui copy-to-clipboard pattern).
- Status indicator: "Plugin detected" (green) when at least one hook event has arrived in the last 10 min, else "Plugin not detected — install to enable hook events" (neutral).
- Status polls every 5s via TanStack Query with `refetchInterval`.

**T9 — WebSocket routing scaffold.** `apps/sidecar/src/ws.ts` — Fastify WebSocket route at `/ws`. Implements the subscribe/unsubscribe protocol per ARCHITECTURE_SPEC §7.5 for `hook:<session_id>` topics only in N2 (other topics from §5.1 scaffold but aren't exercised until N3+). Bearer auth on WS handshake.

**T10 — Integration test (bun:test).** `apps/sidecar/tests/integration/plugin-flow.test.ts` — spins up sidecar, POSTs synthetic hook events for a fabricated `session_id`, asserts:
- Raw payload persisted with exact input JSON.
- De-dupe: same payload twice → one row.
- WS subscriber receives typed event on matching topic.
- Unauthed POST → 401.
- PreToolUse returns allow envelope.

**T11 — Smoke readiness.** CODER runs the SMOKE_DISCIPLINE v1.1 §3.4.1 check on built `Command Center.app` (shell + sidecar in `ps`, window in AX list, dimensions within display bounds). Plus a manual-ish dry-run: CODER installs the plugin locally themselves, triggers one hook event, verifies it lands. This is prerequisite to Jose smoke, not substitute.

---

## §3 — Required reading

Every reference load-bearing for N2. PM verifies CODER has loaded before execution.

- `N2_dispatch.md` (this document).
- `N1_dispatch.md` — reference for §9 smoke format + structural-fix continuity (scrollbar-gutter, UTF-8 PTY env — those land in N3 but the helpers exist in `packages/shared/`).
- `ARCHITECTURE_SPEC.md` v1.2 — §3.2 (schema, esp. `hook_events` + `sessions`), §5 (WS topics + event typing), §7.3 + §7.4 + §7.5 (IPC contracts — MCP + hooks + WS), §8.1 + §8.2 (plugin + bearer auth), §9 (error handling: plugin-not-installed path).
- `COMMANDER_KNOWLEDGE_BASE.md` v1.3 — Part 1.1 (raw-payload schema-drift defense), 1.2 (composition over re-implementation — MCP tools chain with other MCPs rather than re-implementing them), 1.7 v1.3 (narrow-primitive tool surface), 3.2 (plugin structure), 3.3 (hook payload shapes), 4.3 (session_id + uuid de-dupe), 4.6 (Bug J cross-instance isolation — applies to MCP server too).
- `OPERATING_SYSTEM.md` — §3.4 manual bridge, §20.LL L11–L14 (ground truth over derivation — applies to smoke 2.2/2.4 pixel observation), §24 pattern-matching.
- `standards/SMOKE_DISCIPLINE.md` v1.1 — §3.4 + §3.4.1 (window-presence ground truth), §4.2 (sanctioned exceptions), §5 (CODER vs Jose smoke).
- `standards/INVESTIGATION_DISCIPLINE.md` — applies if any task hits unit-green + symptom-unchanged.
- `DECISIONS.md` — D-KB-07 (narrow-primitive tool surface) + D-KB-08 (Tauri perf validated).

---

## §4 — Constraints

**G1–G14** carry from v1. Specifically for N2:

- **G5 Rust ≤150 LOC** — N2 is sidecar + frontend work; Rust should not grow. Current 149/150 LOC.
- **G8 deviation report** — MCP spec has some ambiguity around specific method shapes. If CODER finds the spec surface we're targeting doesn't match current Claude Code MCP client behavior, deviation report lands in PHASE_REPORT §4 BEFORE committing a workaround.
- **G10 root-cause before fix** — if hook events don't land on first plugin-install test, CODER fires instrumentation rotation before iterating. Common failure modes to probe first: env-var expansion in `hooks.json`, bearer header not set, port-discovery race between plugin activation and sidecar ready.
- **G12 dep hygiene** — any new deps land with `bun.lockb` update same commit. Expected N2 deps: `@fastify/websocket`, possibly `@modelcontextprotocol/sdk` if the MCP server wraps the SDK rather than hand-rolling protocol (CODER picks; if using SDK, verify Bun compatibility before committing).

**CODER self-certification prohibition** (SMOKE_DISCIPLINE §3.4): CODER runs T11 readiness check but does NOT pass-judge the full §1 smoke. PHASE_REPORT §3 part 3 blank until PM appends Jose's outcome.

**D-KB-07 narrow-primitive protection**: if during implementation CODER thinks "it would be simpler to just expose an `execute_sql` tool for this one case" — deviation report required. D-KB-07 is not simplifiable-away. No tool, regardless of caller capability class, runs raw SQL / shell / fs-write.

---

## §5 — Stack (locked)

No changes from ARCHITECTURE_SPEC §10 ratified decisions. Additions for N2:
- `@fastify/websocket` for WS transport.
- MCP protocol implementation (SDK or hand-rolled — CODER picks).

---

## §6 — Out of scope for N2

- PTY spawn (N3 — `spawn_agent_run` MCP tool stubs at `status: 'queued'`).
- Approval modal UX (N5 — PreToolUse auto-allows in N2).
- Kanban UI with real tasks (N4 — Preferences plugin tab is the only new UI surface in N2).
- JSONL secondary indexer (KB-P1.1 — plugin is primary; indexer is fallback, scopes later).
- Published marketplace plugin (N7 hardening — local install sufficient for N2).
- ChatThread + renderer registry (N6).

---

## §7 — Approach notes

**MCP SDK vs hand-rolled.** Anthropic publishes `@modelcontextprotocol/sdk` for TypeScript. If it's Bun-compatible (CODER verifies in T5 before committing), use it. If not, hand-roll the minimal subset (tools/list + tools/call is enough for N2). The MCP protocol is not large; hand-rolling is reasonable fallback.

**Port discovery from plugin side.** `hooks.json` uses `${COMMANDER_PORT}` env var. Jose sets `COMMANDER_PORT` + `COMMANDER_TOKEN` in his shell environment (or in the specific Claude Code session via whatever that tool's env mechanism is). CODER documents the exact setup commands in the Preferences → Plugin tab install instructions — not just the `/plugin install` command, but also what env vars to export first.

**Plugin path resolution.** The install command displayed in Preferences uses `file://` scheme pointing at the local monorepo path. Tauri resolves via `get_resource_path` IPC so it works from any install location. Publishing to a real GitHub repo is N7 hardening.

**Session auto-creation.** When a `SessionStart` event arrives with a `session_id` that doesn't exist in `sessions` table, the handler creates the row (per ARCHITECTURE_SPEC §7.4 item 1 — persist raw always; T3 adds: if new session_id, INSERT row with defaults). Same for `projects` — if the SessionStart payload includes a cwd that doesn't match any existing project by `identity_file_path`, auto-create a project row with `name` derived from the cwd basename. Fulfills acceptance 2.4 "project shows up in list_projects."

**Preferences tab organization.** Existing tabs from N1: General, Debug. New in N2: Plugin. Future: Agents (N4+), Workspaces (N4+). Keep tab order stable as panels are added.

---

## §8 — CODER in-rotation decisions

**CODER decides without escalating:**
- File organization inside `apps/plugin/` (within the Claude Code marketplace convention).
- Whether to use `@modelcontextprotocol/sdk` or hand-rolled MCP protocol (verify Bun compatibility either way).
- Shadcn component choices for Preferences → Plugin tab (Input, Button, Badge for status, Separator).
- Whether the Debug tab's "Recent hook events" panel uses a simple table or a scrolling log.
- Specific error envelope shape inside the existing `{ ok, data?, error? }` contract.
- Integration test structure + assertions beyond T10 minimums.

**CODER escalates before acting:**
- Any new tool on the MCP surface that isn't in the T6 list of 10. D-KB-07 applies — CTO ratifies additions.
- Schema changes to `hook_events` or `sessions` tables. ARCHITECTURE_SPEC §3.2 amendments route through CTO.
- Plugin install flow that deviates from standard Claude Code `/plugin install` UX.
- Bearer-auth bypass for any route beyond `/health`.
- MCP server exposing any Commander-side capability for write operations beyond what T6 lists.

---

## §9 — Smoke scenario

**Conforms to SMOKE_DISCIPLINE v1.1. Restrictions per v1.0 §4 apply. CODER automated suite + T11 readiness are prerequisite, not substitute.**

**Jose executes; PM appends outcome to PHASE_REPORT §3 part 3:**

1. **Build + launch.** `cd command-center && bun run build:app`. Double-click `Command Center.app` from Finder. Window appears with skeleton; SMOKE_DISCIPLINE §3.4.1 passes (shell + sidecar in `ps`, window present with non-zero dimensions). (Acceptance 2.8.)

2. **Preferences → Plugin tab.** Press ⌘, → Plugin tab visible. Shows install command in monospace box + Copy button + status indicator reading "Plugin not detected — install to enable hook events". Copy button puts the command in clipboard (Jose paste-tests once). (Acceptance 2.7 — status side.)

3. **Plugin install.** Jose opens a Claude Code session in a test project directory (e.g., `~/Desktop/test-project`). Runs the copied install command. Claude Code reports plugin installed. `/plugin` lists `commander` as installed. (Acceptance 2.1.)

4. **Trigger first hook.** In the same Claude Code session, Jose types a simple prompt ("what files are here?"). Claude responds. Back in Command Center → Preferences → Plugin tab, within 5s the status indicator flips to "Plugin detected". (Acceptance 2.7 — status flip.)

5. **Debug tab recent events.** Jose switches to Preferences → Debug. Recent hook events panel lists at least 3 rows with `SessionStart` / `UserPromptSubmit` / `PostToolUse` (or similar), all within the last 60s, all with real `session_id` values. (Acceptance 2.2.)

6. **De-dupe replay button.** Jose clicks the Debug tab's "Replay last event" button. Events panel does NOT grow — count stays the same. (Acceptance 2.3.)

7. **Auth probes.** Jose runs the three curl commands from PHASE_N2_REPORT §3. Expected: `/health` 200, `/hooks/session-start` 401, `/mcp/tools/list` 401. (Acceptance 2.5.)

8. **MCP external session.** Jose opens a second Claude Code session (different project dir). Configures MCP per PHASE_N2_REPORT §4 (CODER documents exact config — `~/.claude/settings.json` MCP entry with URL + bearer). Prompts Claude: "List the projects registered in Commander." Claude calls `list_projects`; returns at least one project (the test project from step 3). (Acceptance 2.4 + 2.6 — latter verified by CODER automated grep.)

**Expected outcome:** 8/8 pass. Any failure blocks N2 close → N2.1 hotfix. If a failure is in plugin-install UX (step 3) or hook-flow (step 4), CODER fires instrumentation rotation per G10 — likely suspects are env-var expansion in `hooks.json` or port-discovery race.

---

## §10 — PHASE_REPORT expectations

File: `~/Desktop/Projects/jstudio-commander/command-center/docs/phase-reports/PHASE_N2_REPORT.md`.

CODER fills: §1 dispatch recap, §2 commits + diff summary, §3 part 1 (automated — `bun test`, Cargo check, typecheck, `bun install --frozen-lockfile`, lint, narrow-primitive grep output), §3 part 2 (SMOKE_DISCIPLINE v1.1 §3.4.1 check result + CODER local plugin install dry-run result), §4 deviations (incl. SDK vs hand-rolled decision), §5 issues + resolutions, §6 deferred (should be empty for N2), §7 tech debt (incl. published-marketplace deferral, JSONL-indexer deferral — both expected; note for N7 or later), §8 questions, §9 next-phase recommendations (N3 PTY spawn), §10 metrics (commits, tool calls, duration).

PM appends §3 part 3 after Jose smoke. 8/8 closes N2.

---

## §11 — Closing

N2 is where Commander becomes actually useful — hook events flow, MCP server responds, Jose can interact with Claude Code sessions through Commander's data surface. The D-KB-07 narrow-primitive discipline is being tested for the first time: every temptation to expose a shortcut tool needs to stay blocked, because N3+ adds more callers and the shortcut-allowing habit compounds.

Rotation count estimate: 1–2. The MCP protocol implementation is the largest unknown; if `@modelcontextprotocol/sdk` works clean on Bun, it's one rotation. If hand-rolling, possibly two.

No effort estimate in wall-clock. Ships when it ships.

---

**End of dispatch N2. Routing: CTO → Jose → PM → CODER.**
