# Phase Report — Command-Center — Phase N2 — Plugin + MCP Dual-Protocol

**Phase:** N2 — plugin + MCP integration
**Started:** 2026-04-23 ~05:30 local
**Completed:** 2026-04-23 ~06:45 local
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/server` (cwd) targeting `~/Desktop/Projects/jstudio-commander/command-center/`
**Model / effort used:** Claude Opus 4.7 (1M context) / effort=max
**Status:** COMPLETE pending Jose 8/8 re-run of dispatch §9 on `Command Center.app`

---

## 1. Dispatch recap

Implement the Claude Code plugin + MCP dual-protocol: 13 hook events POSTing into a Fastify sidecar at `/hooks/<kebab-case>`, six-step handler pipeline (bearer verify → event_uuid → de-dupe → persist raw → emit WS → status transition → response), PreToolUse auto-allow (real approval pipeline is N5), 10 MCP CRUD tools exposed on `/mcp` with D-KB-07 narrow-primitive discipline (no `execute_sql` / `run_migration` / raw-shell / raw-fs / `eval`), per-session WebSocket topic bus for `hook:<session_id>` subscribers, new Preferences → Plugin tab showing env-var exports + install command + live status indicator, Debug tab "Recent hook events" panel + "Replay last event" smoke button for de-dupe verification, integration tests covering the full flow, and smoke-readiness on the built `Command Center.app`.

## 2. What shipped

**Commit (1 on `main`, G12-clean — `bun install --frozen-lockfile` no drift):**
- `527afad` feat(n2): plugin + MCP dual-protocol — hooks pipeline, WS bus, 10 CRUD tools

Base: `f595475` (N1.1 close). Delta: single atomic commit for the full N2 rotation.

**Files changed:**
- Created: 21 — plugin package (4 files under `apps/plugin/`) + 7 sidecar services (`ws-bus`, `hook-events`, `hook-pipeline`, `projects`, `sessions`, `tasks`, `knowledge`, `agent-runs`) + 3 route modules (`hooks.ts`, `api.ts`, `ws.ts`) + middleware (`auth.ts`) + MCP server + tool registry (2 files) + Preferences Plugin tab + integration test.
- Modified: 7 — `tauri.conf.json` (bundle.resources for plugin dir), sidecar `server.ts` (wires bus + 4 route plugins), `index.ts` (passes db handle to createServer), `package.json` (+@fastify/websocket), bun.lock, frontend `sidecar-client.ts` (+recent-events/replay/getPluginPath), `preferences.tsx` (Plugin tab + Debug recent-events panel + Replay button), `preferences-store.ts` (PreferencesTab includes 'plugin').
- Deleted: 0.

**Capabilities delivered:**
- External Claude Code sessions with plugin installed POST every hook event into the sidecar; raw payload persists into `hook_events` (schema-drift defense per KB-P1.1); de-dupe by `(session_id, event_uuid)` PK; typed event fans out on `hook:<session_id>` WebSocket topic (KB-P1.13 per-session channel discipline).
- External Claude Code sessions with MCP configured against `http://127.0.0.1:<port>/mcp` can call `list_projects`, `get_project`, `list_tasks`, `create_task`, `update_task`, `add_knowledge_entry`, `list_sessions`, `get_session`, `spawn_agent_run` (N2 stub at `queued`), `cancel_agent_run` (N2 stub at `cancelled`).
- First `SessionStart` with a new cwd auto-creates the `projects` row (name = basename) + `sessions` row (status `initializing`) so `list_projects` + `list_sessions` can see them immediately without prior setup (dispatch §7).
- Jose sees a new Preferences → Plugin tab with env-var exports, marketplace + single-path install commands, and a live status indicator polling `/api/recent-events` every 5s; status flips "not detected" → "Plugin detected" within 5s of the first hook event.
- Jose sees a new Debug → "Recent hook events" panel listing last 20 events with hh:mm:ss + event name + truncated session_id, refreshing every 3s, plus a "Replay last event" smoke button that proves de-dupe (count stays unchanged).
- Curl probes match acceptance 2.5 exactly: `/health` unauthed 200, `/hooks/session-start` unauthed 401, `/mcp/tools/list` unauthed 401.

## 3. Tests, typecheck, build

### 3.1 CODER automated suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (4 workspaces) | PASS | shell (cargo check + clippy -D warnings clean at 149/150 LOC, no Rust changes), sidecar, frontend, packages/shared, packages/ui — all strict. |
| Lint (Biome) | Clean | 69 files, 0 errors, 0 warnings. |
| Unit + integration (sidecar `bun:test`) | 16/16 pass | N1 carried forward (health 3 + config 3 = 6) + 10 new integration cases in `tests/integration/plugin-flow.test.ts`. |
| Unit (shared Vitest) | 14/14 pass | unchanged from N1. |
| Unit (ui Vitest jsdom) | 4/4 pass | unchanged from N1. |
| **`bun install --frozen-lockfile`** | Clean | 356 installs, 528 packages, no drift. G12 holds after `bun add @fastify/websocket` in this commit. |
| Build (`bun run build:app`) | PASS | Sidecar binary 61 MB; frontend main eager bundle ~240 kB raw (33 kB CSS + 5 kB entry + 33 kB router + 197 kB react); preferences lazy 46 kB (up from 39 kB — Plugin tab added); xterm-probe lazy 292 kB; Rust release build ~1 min; bundle `Command Center.app` 65 MB; codesign `hashes=294+3` (up one from N1.1). |

**Narrow-primitive grep (acceptance 2.6) — D-KB-07 verified:**

```bash
cd command-center
grep -rnE "execute_sql|run_migration|shell_exec|raw_filesystem|\beval\b" apps/sidecar/src apps/plugin
```

Output:
```
apps/sidecar/src/mcp/tools-registry.ts:20: * **D-KB-07 narrow-primitive discipline (load-bearing):** no `execute_sql`,
apps/sidecar/src/mcp/tools-registry.ts:21: * `run_migration`, raw shell, raw filesystem, or `eval` tools. Every tool
apps/sidecar/src/mcp/tools-registry.ts:53:// ---- input validation helpers (narrow primitives, no free-form eval) ----
```

All three matches are comment lines that explicitly cite D-KB-07 as forbidden. Tool-surface grep for `name: '…'` returning only the 10 legitimate tools:

```
$ grep -nE "^\s+name:\s*'[a-z_]+'" apps/sidecar/src/mcp/tools-registry.ts
94:    name: 'list_projects',
102:    name: 'get_project',
121:    name: 'list_tasks',
137:    name: 'create_task',
177:    name: 'update_task',
216:    name: 'add_knowledge_entry',
253:    name: 'list_sessions',
260:    name: 'get_session',
279:    name: 'spawn_agent_run',
304:    name: 'cancel_agent_run',
```

**Zero banned tool names. D-KB-07 holds.**

### 3.2 CODER smoke-readiness (SMOKE_DISCIPLINE v1.1 §3.4.1 triad + plugin-install dry-run)

Launched `Command Center.app` from Finder equivalent (`open`). All three triad criteria:

- **(a) Process tree** — PASS. `commander-shell` (pid 96706) + `commander-sidecar` (pid 96788) both in `ps` as children of the bundle path.
- **(b) Window count** — PASS. `System Events → process "commander-shell" → count windows` returned **1**.
- **(c) Display bounds** — PASS. Window `{size: 1280×800, position: 1080, 305}` within primary display `{0, 0, 3440, 1440}`.

Local plugin-install dry-run (dispatch §2 T11 CODER-readiness, NOT §1 user-facing smoke):

- POST `http://127.0.0.1:11002/hooks/session-start` with bearer + synthetic SessionStart payload → `{"continue":true}`.
- DB `sqlite3 ~/.commander/commander.db "SELECT event_name, session_id FROM hook_events;"` → `SessionStart|t11-smoke-session`.
- Project auto-created: `coder-smoke|/tmp/coder-smoke`.
- Session auto-created: `t11-smoke-session|/tmp/coder-smoke|initializing`.
- `GET /api/recent-events` (origin-bypass via webview header) → `count: 1`, event visible.
- Bearer probes: `/health` → 200, `/hooks/session-start` unauthed → 401, `/mcp/tools/list` unauthed → 401, `/mcp` authed `tools/list` → 200 with 10 tools.
- `osascript -e 'tell application "Command Center" to quit'` → processes after quit: 0 (parent-death watchdog fallback verified).

**Not the full Jose user-facing smoke per SMOKE_DISCIPLINE §3.4** — Jose runs dispatch §9's 8 steps (install the plugin from an actual Claude Code session, exercise real events, MCP external-session `list_projects` call, etc.) against `Command Center.app`.

### 3.3 User-facing smoke outcome

**BLANK at filing.** PM appends after Jose runs dispatch §9's 8 steps against `Command Center.app`. 8/8 closes N2.

## 4. Deviations from dispatch

**D1 — MCP server hand-rolled instead of `@modelcontextprotocol/sdk`.** Dispatch §5 + §7 authorize either path conditional on Bun-compat verification. Chose hand-roll for three reasons documented in `mcp/server.ts` header comment:

1. The SDK's stdio + SSE transports are irrelevant here — we only need POST-JSON.
2. Bun-compat surface is smaller with ~130 LOC of hand-rolled JSON-RPC than with a full SDK adapter; if bugs surface they're localizable to our code.
3. Pulling the SDK only to use `tools/list` + `tools/call` is dep weight without capability gain; N5+ can reconsider if we add prompts / resources / sampling.

**Evidence:** `mcp/server.ts` at 182 LOC implements `initialize` + `tools/list` + `tools/call` cleanly, integration test covers both MCP methods, unauthed GET `/mcp/tools/list` returns 401 via the scoped preHandler (dispatch §2.5 acceptance path). **Impact:** zero — if the SDK becomes compelling in N5 for resources/prompts, swap-in at the mcp/server.ts module boundary is local.

**D2 — WebSocket auth accepts `?access_token=<token>` query param in addition to `Authorization: Bearer` + origin bypass.** Dispatch §2 T7 lists the HTTP-header + origin paths only. Bun's `WebSocket` follows WHATWG spec with no custom-header escape hatch; the integration test + any future non-Tauri WS client (external Claude Code tool with WS consumption) needs a way to pass bearer. Query-param bearer is a standard WS-auth pattern (Kubernetes, various MCP implementations). Same expected-token comparison, different carrier; zero additional trust surface. Verified in `plugin-flow.test.ts` — unauthed WS upgrade fails (via preHandler), authed via `?access_token=` succeeds.

**D3 — `hook_events.id` PK format is `<session_id>:<event_uuid>` instead of a standalone UUID.** Dispatch §2 T3 specifies de-dupe by `(session_id, event_uuid)` tuple lookup. Making the composite the PK (rather than indexing on a separate tuple) is equivalent semantically — the unique constraint PK enforces de-dupe — and eliminates the extra index N1 schema would have needed. N1 schema's `id TEXT PRIMARY KEY` accepts any unique string; composite keys of this form are common in event-sourced systems. **Impact:** none — tests assert `COUNT(*) = 1` after duplicate POST (passes); future schema evolution can migrate to (session_id, event_uuid) unique index if `id` needs to be a standalone UUID for some downstream code path.

**D4 — User-facing "Command Center" title in Preferences modal description.** Small N1.1 residue in `preferences.tsx` flipped to "Command Center" (was "Command-Center" with hyphen). No behavioral change; UX consistency with N1.1 rename.

**D5 — Plugin directory bundled INTO `Command Center.app` via `tauri.conf.json` bundle.resources.** Dispatch §2 T1 + §7 specifies local `file://` install with the path resolved at runtime via `get_resource_path` IPC. The simplest way for `get_resource_path('plugin')` to return a real filesystem path is to bundle the plugin dir at `.app/Contents/Resources/plugin/`. Bundled copy only — the monorepo source `apps/plugin/` is still the authoritative edit target; `bun run build:app` re-bundles. **Tradeoff noted:** dev-iteration on hooks.json + plugin.json requires a rebuild to see the change reflected in the installed plugin, since Claude Code loads from the bundled path. Not a problem at N2 (plugin is stable); N3 dev flow can symlink if friction surfaces.

## 5. Issues encountered and resolution

**Issue 1 — Fastify 5 `FastifyBaseLogger` vs Pino `Logger` type mismatch.** My `WsBus` + `hook-pipeline` initially typed `logger: Logger` using Pino's exported type; Fastify's `app.log` is `FastifyBaseLogger` (narrower interface). First typecheck caught the mismatch. **Resolution:** aliased `type Logger = FastifyBaseLogger` at the top of both modules. Both files still log via the standard `.info / .warn / .error / .debug` methods that both shapes satisfy. **Time impact:** ~5 min.

**Issue 2 — WebSocket integration test failed on first attempt (Bun's WebSocket doesn't support custom headers).** The test connected with `new WebSocket(url, [], { headers: { Authorization: ... } })` — Bun ignores the third argument. Auth middleware correctly rejected the unauthenticated upgrade. **Resolution:** added `?access_token=<token>` query-param support to the auth middleware (see §4 D2) and updated the test to pass the bearer that way. All 16/16 tests pass post-fix. **Time impact:** ~10 min; root-cause-before-fix via dispatch G10 applied (read Bun WebSocket docs → confirmed the header path isn't supported → added the carrier path to auth middleware).

**Issue 3 — Biome `organize-imports` autofix separated a non-import statement in `hook-pipeline.ts`.** Biome sorted the imports but left a `type Logger = FastifyBaseLogger;` alias in the middle of the import block. Valid TypeScript but ugly. **Resolution:** moved the type alias below all imports. Re-ran Biome — 0 fixes applied; clean. **Time impact:** <1 min.

## 6. Deferred items

**None — N2 complete within dispatch scope.** Items explicitly out of scope per dispatch §6 (PTY spawn → N3; approval modal UX → N5; kanban UI → N4; JSONL secondary indexer; published marketplace plugin → N7; ChatThread + renderer registry → N6) remain deferred as planned.

## 7. Tech debt introduced

**Debt 8 (carries forward from N1.1) — Tauri v2 signingIdentity:null doesn't auto-codesign.** Mitigated by `scripts/post-tauri-sign.sh`. N7 hardening.

**Debt 9 — MCP server is hand-rolled minimum-viable** (see §4 D1). Covers `initialize` + `tools/list` + `tools/call`. Doesn't cover: `resources/list` + `resources/read`, `prompts/list` + `prompts/get`, sampling/completion, SSE streaming for long-running tool responses, subscriptions. **Severity:** LOW. **Why:** N2 CRUD surface doesn't need them; if N3+ adds tools that stream stdout (e.g. `spawn_agent_run` wanting to stream the PTY buffer), the SSE transport lands alongside. **Est. effort:** 1–2 days to pull in `@modelcontextprotocol/sdk` or extend hand-roll, whichever is cleaner at that point.

**Debt 10 — `hook_events` PK format `<session_id>:<event_uuid>`** (see §4 D3). **Severity:** LOW. **Why:** works as a PK, but some downstream queries might prefer a standalone UUID `id` with a `UNIQUE (session_id, event_uuid)` constraint. **Est. effort:** ~30 min schema migration + service-layer patch when/if it bites.

**Debt 11 — Published Claude Code plugin marketplace is local-only.** N2 uses `file://` install exclusively; `.claude-plugin/marketplace.json` stages metadata for publish but isn't pushed to any public repo. **Severity:** LOW. **Why:** single-user v1 per D-N1-09, no external users. **Est. effort:** 2–4 hr N7 (create `github.com/jstudio/command-center-plugin`, push tagged release, update Preferences → Plugin tab with public install command).

**Debt 12 — JSONL secondary indexer not implemented.** Plugin is primary event source per KB-P1.1; JSONL fallback for (a) pre-Commander session reconstruction, (b) recovering when plugin isn't installed, (c) FTS5 cross-session search is deferred. **Severity:** LOW. **Why:** dispatch §6 explicit non-scope + Jose dogfoods with plugin installed, so (b) rarely bites. **Est. effort:** 1–2 days — chokidar watcher + session_id ownership filter per KB-P4.6 (Bug J prevention) + FTS5 virtual table.

**Debt 13 — No MCP `initialize` protocol-version negotiation.** Server always replies with `protocolVersion: "2025-06-18"`; client's requested version is ignored. If Claude Code's MCP client ships with a newer or older version string, we just respond with ours and hope for the best. **Severity:** LOW. **Why:** MCP protocol is additive in practice; the methods we implement (tools/list, tools/call) are stable across versions. **Est. effort:** 15 min to echo-or-fallback the client's version string when we recognize it.

**Debt 14 — Debug tab "Recent hook events" panel renders without virtualization.** Limits to last 20 events; if a single session fires >200 events in a short window the panel could slow down. **Severity:** LOW. **Why:** N2 volume is low; virtualization is a `packages/ui` investment that belongs with the N4 kanban (which will render larger lists). **Est. effort:** 2–3 hr when it bites.

Debts 1–7 from N1 PHASE_REPORT §7 remain unchanged — N2 didn't touch drizzle-kit migrator, scrollback_blob storage shape, shell `ExitRequested` ordering, TanStack Router wiring, shadcn CLI, bundle size, or Cargo cfg gates.

## 8. Questions for PM

1. **Accept §4 D2 (`?access_token` query param for WS bearer)?** No alternative discovered that works with Bun's WHATWG WebSocket. Pattern is standard across WS protocols.

2. **Accept §4 D3 (`hook_events.id = <session_id>:<event_uuid>` composite PK)?** Functionally correct; minor schema-shape note. Future `agents` / `hook_events` joins may prefer a standalone UUID — flag if any downstream query is awkward.

3. **Accept §4 D5 (plugin dir bundled into `.app`)?** Alternative approaches (symlink, monorepo-path env var at launch, marketplace-hosted) have tradeoffs. Bundled copy is the simplest N2 path with `get_resource_path` as the IPC.

4. **§7 Debt 11 timing for published marketplace — keep at N7, or pull forward if external install friction becomes a blocker during dogfood?** My recommendation: N7. Dogfood is single-user; no external install pressure.

## 9. Recommended next-phase adjustments (N3 PTY spawn)

**Observation 1 — `spawn_agent_run` stub at `status='queued'` is the N2→N3 handoff point.** N3 PTY spawn should UPDATE the row to `running`, attach a PTY via `Bun.spawn({ terminal })`, stream stdout to `pty:<session_id>` WS topic (the topology already exists on the bus), then UPDATE to `completed` / `failed` / `cancelled` / `timed-out` on exit. The row's `session_id` FK points at `sessions.id`, which the hook pipeline populates on SessionStart — so the N3 PTY spawn can assume `sessions.<id>` exists by the time it writes into `agent_runs.session_id`.

**Observation 2 — `cancel_agent_run` stub at `status='cancelled'` is the kill path.** N3 needs to add SIGTERM → 5s → SIGKILL on the PTY handle before (or after — order matters for clean scrollback capture) updating the row. `agent_runs.exit_reason` gets a real value; N2 stubs it as `"cancelled-by-caller (N2 stub)"`.

**Observation 3 — Hook pipeline's `ensureProjectByCwd` stores `cwd` as `identity_file_path`.** N4 identity-file pattern (`.commander.json` per KB-P1.5) migrates the column meaning. Because the column is indexed as UNIQUE, migration path is: (1) write `.commander.json` into each existing project's cwd with the existing project.id, (2) `UPDATE projects SET identity_file_path = cwd || '/.commander.json' WHERE identity_file_path NOT LIKE '%.commander.json'`. Deliberate — the column name stays stable across the migration.

**Observation 4 — WS `hook:<session_id>` topics are live** but the frontend doesn't yet subscribe. The Debug tab polls `/api/recent-events` every 3s instead — fine for N2 since we only need "events arrived" as a coarse signal, but N3 pane-rendering needs real-time WS subscription. The `useSessionPaneActivity`-equivalent hook for Command-Center N3 subscribes to `pty:<session_id>` + `hook:<session_id>` for its mounted pane, uses the `WsBus` envelope shape from `services/ws-bus.ts`.

**Observation 5 — MCP protocol-version negotiation is stubbed.** N3 integration tests with the actual Claude Code MCP client will catch any version-mismatch incompatibility (Debt 13). Lightweight fix if it surfaces.

**Observation 6 — Plugin install path resolution via `get_resource_path` works, but the install is a two-step process** (marketplace add → install OR single-shot file install). Jose's smoke step 3 is the first real exercise of this flow. If Claude Code's `/plugin install file://` doesn't handle paths with spaces (`Command Center.app` has a space), we may need to either (a) URL-encode the path in the Preferences UI, (b) fall back to `marketplace add` where the space is less problematic in practice, or (c) symlink to a space-free path. My implementation shows both commands for robustness, but Jose's smoke will reveal which works.

## 10. Metrics

- **Duration:** ~75 min wall-clock from dispatch read → PHASE_REPORT filing (~05:30 local → ~06:45 local). Single rotation, no G10 instrumentation cycles needed.
- **Output token estimate:** ~150–180k output tokens (large rotation — 13+ new sidecar modules + tests + frontend surface + plugin scaffold + PHASE_REPORT).
- **Tool calls:** ~90 (file writes + bash + edits + build + smoke-readiness).
- **Commits:** 1 atomic, G12-clean.
- **Rust LOC:** 149 unchanged (1 under G5 cap).
- **Sidecar LOC added:** ~1300 (middleware/auth 40, ws-bus 60, hook-events 100, hook-pipeline 170, projects 50, sessions 80, tasks 60, knowledge 50, agent-runs 60, hooks.ts 55, api.ts 75, ws.ts 95, tools-registry 360, mcp/server 180, plus edits to server.ts 70 and index.ts 2).
- **Frontend LOC added:** ~400 (sidecar-client +100, preferences-plugin-tab 160, preferences.tsx ~145 added for Debug recent-events panel + Plugin tab wiring).
- **Plugin package LOC:** ~180 JSON + README.
- **Tests:** 16/16 sidecar pass (up 10 new integration cases), 14/14 shared pass, 4/4 ui pass. Total 34/34 workspace-wide.
- **Frontend bundle (eager main):** 240 kB raw (up from 233 kB in N1 — Plugin tab + Debug hook-events panel).
- **Frontend bundle (preferences lazy chunk):** 46 kB (up from 39 kB).
- **Commander.app bundle:** 65 MB unchanged.
- **Fresh-clone check:** `bun install --frozen-lockfile` clean (G12). New dep `@fastify/websocket@11.2.0` + 23 transitive.

---

**End of report. PM: verify the §8 acceptances — §4 D1–D5 deviations + §7 tech debt acceptance posture — append §3 part 3 after Jose runs dispatch §9 8-step smoke on `Command Center.app`, and route §9 Observations 1–6 to CTO as inputs for the N3 PTY spawn dispatch.**
