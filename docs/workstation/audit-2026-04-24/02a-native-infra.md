# 02a — Native Command Center infra audit (sidecar + Rust shell + plugin + shared)

**Scope.** Read-only audit of the infrastructure layer of the native Command Center at `command-center/apps/{shell,sidecar,plugin}` and `command-center/packages/shared`. Frontend + xterm wrapper covered by a sibling agent; not opened here.

**Overall verdict.** The infra layer is the best-preserved part of Commander. Process split, bearer flow, schema, worktree chain, PTY handle, WS topic bus, and 10-tool MCP surface are all directly reusable for JS WorkStation. The load-bearing product misalignment (observer vs. native environment) lives above this layer — the sidecar doesn't care whether sessions come from an external `claude` process or an in-app one, which is the good news.

---

## 1 — Rust shell (149 LOC total, 144 in `lib.rs` + 5 in `main.rs`)

`apps/shell/src-tauri/src/lib.rs` does exactly what SPEC §2.2 authorizes and nothing else. LOC accounting:

- `lib.rs:4-42` — imports, constants, `SidecarState` mutex wrapper, platform-gated `send_sigterm` / `is_alive` via `nix` (unix) with `cfg(not(unix))` stubs returning false/true.
- `lib.rs:20-23` — `config_path()` derives `$HOME/.commander/config.json` at call time.
- `lib.rs:44-66` — `spawn_sidecar`: honors `JSTUDIO_SIDECAR_CMD` env override for unbundled dev runs, otherwise resolves the `commander-sidecar` sidecar binary declared in `tauri.conf.json:42`. Spawns the child, pipes stdout/stderr to `eprintln!` with `[sidecar]` / `[sidecar!]` prefixes, logs `Terminated`.
- `lib.rs:68-79` — `shutdown_sidecar`: SIGTERM → 100 ms poll loop up to `SIDECAR_TERM_GRACE = 5s` → SIGKILL. This matches SPEC §2.2 graceful-shutdown contract.
- `lib.rs:81-109` — five `#[tauri::command]` IPC endpoints: `get_config_path`, `read_config`, `get_resource_path`, `show_window`, `quit_app`. That is the complete Tauri IPC surface.
- `lib.rs:112-143` — `run()`: registers `single_instance` plugin (`:114`), `shell` plugin (`:120`), installs `SidecarState`, registers the 5 IPC handlers, spawns the sidecar in `.setup`, and wires both `RunEvent::ExitRequested` and `WindowEvent::CloseRequested` to `shutdown_sidecar`.
- `main.rs:1-5` — `windows_subsystem = "windows"` gate + single-line `fn main()` calling into the lib crate.

Window config at `tauri.conf.json:11-26`: single `main` window, 1280×800 with 960×600 min, visible-on-launch, `titleBarStyle: "Visible"`. CSP at `:29` constrains IPC + 127.0.0.1 HTTP/WS origins. Sign flow is unsigned: `signingIdentity: null`, `entitlements: null` at `:49-51` — N1 ships local-only, no notarization.

Capability set at `apps/shell/src-tauri/capabilities/default.json:6-13`: `core:default` + `window:{show,hide,set-focus,close}` + `path:default` + `shell:default`. Minimal and sufficient.

Cargo deps at `Cargo.toml:17-26`: Tauri 2.1, `tauri-plugin-shell` 2.0, `tauri-plugin-single-instance` 2.0, `serde`/`serde_json`, `nix` 0.29 gated on `cfg(unix)` (KB-P4.15 cfg-gate-from-day-one discipline). `devtools` feature is opt-in for `bun run build:app:debug`.

This file enforces the G5 ≤150 LOC guardrail with headroom. The sidecar owns everything non-trivial — no Rust code touches PTY, DB, hook parsing, approval, HTTP, WS, or MCP. Directly keep-able.

---

## 2 — Bun sidecar boot flow (`apps/sidecar/src/index.ts`, 115 LOC)

Linear boot, halt-on-failure at every stage, with exit codes distinct per stage for log diagnostics:

1. `index.ts:9-10` — create Pino logger (`logger.ts`), emit boot event with sidecar version `'0.1.0-n2'`.
2. `index.ts:12-16` — `scanPort()` across `11002..11011` (`port-scan.ts:3`), exit code 1 if none available. Uses real `net.createServer().listen` + close for true availability check, not just a probe.
3. `index.ts:22` — `loadOrCreateConfig(port, logger)` reads `~/.commander/config.json`, preserves existing bearer or mints fresh.
4. `index.ts:26-37` — `openDb()` → `runMigrations(raw)` → `countTables(raw)`; exit 2 if `< 9` tables materialize. The `< 9` gate is the sanity check against half-applied schema.
5. `index.ts:44-52` — `migrateIdentityFilesOnBoot(db, logger)` (T1 identity-file migration). Exit 4 on failure — halts boot before the server accepts traffic so frontend/MCP never see half-migrated state.
6. `index.ts:54-59` — build Fastify via `createServer({config, raw, db})`.
7. `index.ts:62` — `server.listen({port, host: '127.0.0.1'})` — 127.0.0.1 bind only. Exit 3 on listen failure.
8. `index.ts:77-93` — `SIGTERM`/`SIGINT` graceful shutdown: `server.close` → `raw.close` → `process.exit(0)`.

**Parent-re-parent self-termination** (`index.ts:95-109`, load-bearing). On macOS, if the Rust shell is force-quit or crashes without delivering SIGTERM, the sidecar's parent flips to launchd (pid 1). A 1-second `setInterval` watches `process.ppid !== originalPpid` and self-terminates via the same `shutdown` path. Without this, the next app launch hits port exhaustion on the 10-port range.

---

## 3 — Bearer auth + atomic-persist (`config.ts`, 155 LOC)

Path helpers at `config.ts:20-38`: `home()` prefers `process.env.HOME` over `os.homedir()` (testability — `homedir()` uses `getpwuid()` and ignores env). Dir/file/DB/logs paths all resolved per-call.

`loadOrCreateConfig` at `config.ts:74-155`:

1. **Read path** (`:82-124`). Four distinct `readOutcome` states — `preserved`, `first-run`, `corrupt`, `missing-field`, `unexpected-error` — each logged structurally. ENOENT is the only silent outcome; everything else emits a warn so production incidents show up in logs without needing the test harness.
2. **Mint-if-missing** (`:126`): `existingBearer ?? randomUUID()`.
3. **Atomic write** (`:137-140`): `writeFile(tmpFile, body)` → `rename(tmpFile, file)`. Per OS §20.LL-L16, rename(2) on POSIX is atomic within a single filesystem — a concurrent reader always sees either the old-complete or new-complete content, never a torn JSON. This is the N2.1 fix that solved "every boot remints bearer → plugin 401s → user reinstalls."

Consumers of the bearer:
- Fastify preHandler via `requireBearerOrTauriOrigin` (`middleware/auth.ts:29-60`) — checks origin whitelist (`tauri://localhost`, `https://tauri.localhost`, dev `http://localhost:5173`, `http://127.0.0.1:5173`), then `Authorization: Bearer`, then `?access_token=` query param (WebSocket workaround for WHATWG API that has no custom-header escape).
- Plugin shim (`apps/plugin/hooks/forward.sh:31-33`) — pure-bash extraction with `grep`/`sed`, no `jq` dependency so the hook works on stock macOS.

The plugin reads config **every hook invocation** (not cached) per `forward.sh:16-17` — port change after sidecar restart is picked up without reinstall. Critical for the bearer contract.

---

## 4 — Drizzle schema overview (`db/schema.ts`, 306 LOC)

Nine tables, all mirrored in `BOOT_SCHEMA_SQL` as idempotent `CREATE TABLE IF NOT EXISTS` DDL applied on every boot (`client.ts:26-28`). Timestamps are ISO-8601 text via `strftime`; UUIDs are text; JSON columns use Drizzle `mode: 'json'`.

| Table | Purpose | Key FKs / indices |
|---|---|---|
| `projects` (`schema.ts:14-26`) | Project rows, one per cwd | `uniqueIndex projects_identity_path_unique` on `identity_file_path` |
| `workspaces` (`:28-44`) | Multi-pane layouts per project | FK `project_id` CASCADE; index `project_id` |
| `agents` (`:46-66`) | Agent specs (model, bounds, tools) | FK `project_id` CASCADE |
| `tasks` (`:68-84`) | Kanban work items | FK `project_id` CASCADE; compound index `(project_id, status)` |
| `knowledge_entries` (`:88-104`) | APPEND-ONLY (KB-P1.3); supersession via `supersededById` | FK `task_id` CASCADE |
| `agent_runs` (`:106-127`) | FSM rows for runs | FK `task_id` CASCADE; indices `(task_id, status)` + `session_id` |
| `sessions` (`:129-146`) | Claude session rows + scrollback | indices `agent_run_id`, `claude_session_id` |
| `hook_events` (`:148-163`) | Raw hook payloads for replay | FK `session_id` CASCADE; compound indices `(session_id, ts)` + `(event_name, ts)` |
| `onboarding_state` (`:167-178`) | Single-user flow gating (PK `'local'` sentinel) | — |

Runtime config at `client.ts:13-15`: `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`. WAL is required for concurrent reader/writer under Bun's `bun:sqlite` driver.

Migration runner is the boot-time DDL-exec pattern (`client.ts:26-28`) — PHASE_N1_REPORT §4 documents this is N1-only shape; N2+ replaces with drizzle-kit generator. The replacement never landed because drizzle-kit didn't turn out to be load-bearing enough to justify the churn, and `CREATE IF NOT EXISTS` is idempotent.

---

## 5 — Identity-file migration (`migrations/commander-json-identity.ts`, 286 LOC) — load-bearing

**Contract.** Pre-N4: `projects.identity_file_path` = raw cwd (`/Users/jose/x`). Post-N4: points at `<cwd>/.commander.json` and the file on disk contains `{project_id, schema_version}`. Enables folder rename/move/machine transfer without DB loss (KB-P1.5).

**Run shape** (`:113-257`):

1. Idempotent short-circuit if already `.commander.json` (`:138-141`).
2. `existsSync(currentPath)` check — if dir is gone, skip with `skipped_deleted_on_disk` counter (`:144-151`). Explicit deviation D1: we do NOT resurrect the directory (would be surprise side-effect) nor invent a sentinel column value (consumer surface leak).
3. **H3 pre-collision check** (`:161-206`). If a canonical row already exists at `<cwd>/.commander.json` AND another row at raw-cwd `<cwd>` is hitting the migration, count dependents (`tasks` + `workspaces`). Zero dependents → DELETE the duplicate (safe dedup), append `system:migration-dedup` forensic event. Non-zero dependents → record failure, boot halts.
4. Atomic write (`:212-232`): `writeFile(tmpFile)` → `rename(tmpFile, targetFile)` → `UPDATE projects SET identityFilePath`. DB update happens ONLY after file write lands.
5. Failure branch (`:233-253`): best-effort tmp cleanup, row stays at pre-migration shape, next boot retries.

**Sentinel session** (`:69-105`). `hook_events.session_id` is NOT NULL FK. System-origin events (like migration-dedup forensics) need a valid session. `ensureSystemBootSession` idempotently inserts `sessions.id = 'system-boot', cwd = '<system>', status = 'completed'` — one row per DB lifetime. `appendSystemEvent` wraps the forensic insert.

The H3 dedup + forensic trail pattern is the N4a.1 response to the pre-fix `ensureProjectByCwd` bug that created raw-cwd duplicates *after* migration ran. Good operational pattern worth keeping.

---

## 6 — PTY lifecycle + worktree

**Agent-run FSM** (`agent-run/lifecycle.ts`, 552 LOC). 5-state transitions: `queued → running → (completed | failed | cancelled | timed-out)`. In-memory `RUNNING: Map<runId, {handle, sessionId, projectRoot, worktreePath, startedAtMs, wallClockTimer?, scrollback: Uint8Array[]}>` at `:79-90` tracks live runs — not persisted, sidecar restart loses live handles but session rows survive for UI history.

**Spawn path** (`spawnAgentRun` at `:100-218`):
1. Resolve/create task (4 paths: explicit taskId, projectId+title, cwdHint, first-project-in-DB fallback).
2. Queue row via `queueAgentRun`.
3. Mint child sessionId (distinct from caller's).
4. Resolve projectRoot via `resolveProjectRoot(project.identityFilePath)` (`services/projects.ts:29-34`) — strips `.commander.json` basename if present; back-compat for unmigrated raw-cwd rows. N4a.1 Debt 24 fix.
5. `createWorktree` call (see below).
6. `ensureSessionByClaudeId(db, childSessionId, worktreePath)`.
7. `spawnPty` with bytes piped through `bus.publish(pty:<id>, {kind:'data', bytes: base64})` and accumulated into `scrollbackBuf`.
8. Transition to `running`, write `pty_pid` + `started_at` + `session_id` + `worktree_path` (null if degraded fallback used project root as cwd).
9. Wall-clock watchdog via `setTimeout(timeoutRun, budgetMs)`.

**Cancel path** (`cancelAgentRun` at `:226-272`). Order is mandatory per dispatch §7:

1. **Pre-kill scrollback flush** (`:245`). Concat all `Uint8Array` chunks, base64-encode once, persist to `sessions.scrollback_blob`. Record survives termination.
2. `handle.kill('SIGTERM')`.
3. `Promise.race` against 5000 ms grace timer (`SIGTERM_GRACE_MS = 5_000` at `:92`).
4. On grace expiry, `SIGKILL` + await.
5. `finalizeTerminal` — agent_runs + sessions row updates, WS `status:<id>` event, clearTimeout, `RUNNING.delete`, best-effort `removeWorktree`.

Timeout path (`timeoutRun` at `:280-311`) is structurally identical, just with `status: 'timed-out'` and `exit_reason` carrying the run duration.

Natural exit (`handleExit` at `:318-350`) maps `exitCode` → completed/failed; signalCode → failed.

**Worktree chain** (`worktree/create.ts`, 155 LOC, `createWorktree` at `:54-112`):

1. **Primary**: `git worktree add <path> HEAD` via Bun `$` shell (`:69-76`). Returns `{worktreePath, isGitWorktree: true, isFallbackCopy: false}`.
2. **Fallback 1 — shallow copy**: `fs.cp` with exclusion list (`.git`, `.worktrees`, `node_modules`, `dist`, `build`, `target`, `.turbo`, `.vite` at `:43-52`). Returns `{isGitWorktree: false, isFallbackCopy: true}`.
3. **Fallback 2 — project-root-as-cwd**: no isolation, returns `{worktreePath: projectRoot, isGitWorktree: false, isFallbackCopy: false}`. Logged loudly at `:110`.

Cleanup (`removeWorktree` at `:137-155`) is best-effort: `git worktree remove --force` then silent if it fails. Does not rm non-git dirs (user-data safety).

`spawnPty` (`pty/spawn.ts`, 159 LOC). **Deviation from SPEC §6.3** documented at `:8-22`: `Bun.spawn({terminal: {...}})` exists in Bun 1.3.13 but streams `undefined` bytes — API surface incomplete. N3 uses `stdin: 'pipe' / stdout: 'pipe' / stderr: 'pipe'` + `ReadableStream` reader loop (`streamReader` at `:144-158`). Sufficient for line-oriented commands; real TTY semantics (SIGWINCH, cursor control) deferred. KB-P4.13 blank-terminal-until-Enter defense at `:88-100` writes `\n` after 100 ms only for `claude` executables.

---

## 7 — WS pub/sub + Fastify routing

**Bus topology** (`services/ws-bus.ts`, 84 LOC). Per-session topics per KB-P1.13, NEVER a multiplexed firehose. Topic conventions exercised:

- `hook:<session_id>` — hook-pipeline events (N2).
- `pty:<session_id>` — raw PTY byte frames, base64-encoded via `encodeScrollbackBase64` (N3).
- `status:<session_id>` — FSM transitions (N3). Scaffolded: `approval:*`, `tool-result:*`.

Dual-direction indexing: `topicToClients: Map<string, Set<WsBusClient>>` + `clientToTopics: WeakMap<WsBusClient, Set<string>>`. WeakMap-keyed client tracking lets GC reap disconnected clients even if unsubscribeAll is missed. `publish` (`:65-79`) is synchronous send-to-all; send errors logged but don't break fan-out.

**Fastify routes** (one canonical enumeration):

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness probe (table count, version, uptime) | NONE (`server.ts:52-58`) |
| GET | `/ws` | WS handshake with subscribe/unsubscribe protocol | bearer-or-origin (preHandler) |
| POST | `/hooks/{session-start,user-prompt-submit,pre-tool-use,post-tool-use,notification,stop,subagent-start,subagent-stop,task-created,task-completed,session-end,pre-compact,post-compact}` | 13 Claude Code hooks (SPEC §7.4) | bearer |
| POST | `/mcp` | JSON-RPC 2.0 canonical entry (initialize, tools/list, tools/call) | bearer |
| ALL | `/mcp/*` | 404 JSON-RPC catch-all, hits bearer preHandler first for 401-vs-404 semantics | bearer |
| GET | `/api/recent-events` | Debug tab — paginated hook events | bearer |
| POST | `/api/events/replay` | Debug replay button | bearer |
| GET | `/api/recent-runs` | Debug tab — agent runs | bearer |
| POST | `/api/runs` | Spawn a run (wraps `runSpawn`) | bearer |
| GET | `/api/runs/:id` | Run detail + joined scrollback_blob | bearer |
| DELETE | `/api/runs/:id` | Cancel a run (wraps `runCancel`) | bearer |
| GET | `/api/tasks`, `/api/tasks/with-latest-run`, `/api/tasks/:id` | Kanban reads | bearer |
| POST | `/api/tasks` | Create + auto-project resolution | bearer |
| PATCH | `/api/tasks/:id` | Title / instructions / status | bearer |
| GET / POST | `/api/tasks/:taskId/knowledge` | Knowledge entries (append-only) | bearer |

HTTP + MCP + WS paths for spawn/cancel converge on the same `agent-run/lifecycle.ts` primitives — single source of CRUD truth (dispatch §2 T6), no duplicated semantics.

---

## 8 — MCP server + hook pipeline + plugin

**MCP server** (`mcp/server.ts`, 191 LOC). Hand-rolled JSON-RPC 2.0 — `@modelcontextprotocol/sdk` rejected at PHASE_REPORT §4 D1 because it ships stdio/SSE transports we don't use and adds Bun-compat surface we have to verify. ~80 LOC suffices. Implements `initialize` (`:98-108`), `tools/list` (`:111-118`), `tools/call` (`:121-163`). Unknown methods → `METHOD_NOT_FOUND`. Wildcard `/mcp/*` at `:179-186` returns 404 JSON-RPC, but bearer preHandler fires first so `curl /mcp/tools/list` without token returns 401.

**10-tool surface** (`mcp/tools-registry.ts`, 415 LOC). Each tool is a thin wrapper over a service-layer function — the same function backs HTTP routes, so no duplication. D-KB-07 narrow-primitive discipline is the defense layer; no `execute_sql`, `run_migration`, `eval`, raw-shell, raw-fs.

| # | Tool | Purpose |
|---|---|---|
| 1 | `list_projects` | All projects known to Commander |
| 2 | `get_project` | Project by UUID |
| 3 | `list_tasks` | Tasks by project, newest-updated first |
| 4 | `create_task` | New task row |
| 5 | `update_task` | Patch title/instructions/status (no delete) |
| 6 | `add_knowledge_entry` | Append-only per KB-P1.3; supersession via separate `supersededById` |
| 7 | `list_sessions` | Claude Code sessions (200 most recent) |
| 8 | `get_session` | Session by id |
| 9 | `spawn_agent_run` | Materialize worktree + launch PTY + wall-clock bound; returns row at `running` |
| 10 | `cancel_agent_run` | Pre-kill flush → SIGTERM → 5s → SIGKILL; idempotent |

**Hook pipeline** (`services/hook-pipeline.ts`, 173 LOC). SPEC §7.4 canonical 6-step recipe. Entry `runHookPipeline(deps, eventName, rawPayload)` at `:58-140`:

1. Extract `session_id`; warn + pass-through if missing (`:67-73`).
2. `eventUuidOf(payload)` — mints UUID or uses `uuid`/`event_uuid` field from payload (`services/hook-events.ts:66-73`).
3. On `SessionStart`: auto-create project + session row (`ensureProjectByCwd` + `ensureSessionByClaudeId`). On other events: ensure session row with `cwd='/'` if missing (mid-session plugin install recovery).
4. `insertIfNew(db, {sessionId, eventName, eventUuid, payload})` — row id = `${sessionId}:${eventUuid}`, pre-check returns null on dupe. De-dupe contract per KB-P4.3.
5. Publish `hook:<session_id>` envelope on WS bus.
6. Map event → session status via `sessionStatusForEvent` (`services/sessions.ts:78-91`): SessionStart=initializing, UserPromptSubmit=working, Stop=done, SessionEnd=done.
7. Return `{continue: true}` or PreToolUse-specific `{hookSpecificOutput: {permissionDecision: 'allow', ...}}` envelope. PreToolUse auto-allows in N2; real approval UI deferred to N5.

**Plugin** (`apps/plugin/`). `.claude-plugin/plugin.json` is intentionally minimal — `{name, version, description, author, license}` only, NO `hooks`/`mcpServers` keys. SPEC §8.1 calls out that declaring `manifest.hooks` for the standard `./hooks/hooks.json` path triggers Claude Code's "Duplicate hooks file detected" abort.

`hooks/hooks.json` registers 9 of 13 events (missing SubagentStart, TaskCreated, TaskCompleted, PostCompact — Claude Code hasn't shipped PascalCase emitters for those). Each entry invokes `bash "${CLAUDE_PLUGIN_ROOT}/hooks/forward.sh" <kebab-event>`.

`forward.sh` (55 LOC) is fail-open: every error path echoes `{"continue":true}` and exits 0. Reads bearer + port from config on each invocation, POSTs stdin payload with `curl --max-time 4` to `http://127.0.0.1:<port>/hooks/<event>`. Response is echoed to stdout so PreToolUse blocking decisions propagate back to Claude Code.

**External session `.mcp.json`** (SPEC §7.3) lives at project root with `{"mcpServers": {"commander": {"type":"http", "url":"http://127.0.0.1:<port>/mcp", "headers": {"Authorization": "Bearer <token>"}}}}`. Wrapped shape is schema-required for project-root location; plugin-bundled `.mcp.json` accepts flat shape (N2 calibration). Commander exposes the exact block in Preferences with current port + bearer substituted.

---

## 9 — Keep vs scrap for JS WorkStation

| Module | Status | Reason |
|---|---|---|
| Rust shell (`apps/shell/src-tauri/`) | **KEEP** | 149 LOC, clean boundaries, G5 respected, sidecar lifecycle + IPC surface is reusable |
| Bun sidecar boot + Fastify (`index.ts`, `server.ts`) | **KEEP** | Halt-on-failure boot, distinct exit codes, bus-shared between routes is a good pattern |
| Drizzle schema (`db/schema.ts`) | **KEEP+EXTEND** | 9 tables cover projects / tasks / knowledge / sessions / hook_events / agent_runs / workspaces / agents / onboarding_state. Extend with WorkStation-native concepts (in-app sessions, conversation threads), don't redesign from scratch |
| `bun:sqlite` + WAL (`db/client.ts`) | **KEEP** | Zero native addons, correct pragmas, sufficient scale for single-user |
| Bearer auth + atomic-persist (`config.ts`) | **KEEP** | Tmp+rename is correct per OS §20.LL-L16, readOutcome logging is good diagnostics; directly reusable |
| Identity-file migration + `.commander.json` (`migrations/commander-json-identity.ts`) | **KEEP** | Idempotent, deleted-on-disk handling, sentinel session forensics. Pattern itself is the lesson; code ships as-is for WorkStation since same DB carries over |
| `ensureProjectByCwd` dual-form lookup (`services/projects.ts:54-139`) | **KEEP** with caveat | Dual-form lookup + concurrent-insert race guard + file-reconcile after race-loss is correct. Revisit whether cwd is even the right identity primitive for WorkStation where "project" might be something the user creates explicitly |
| PTY spawn + worktree chain (`pty/spawn.ts`, `worktree/create.ts`) | **KEEP+EXTEND** | Spawn fallback chain is clean. In WorkStation, local in-app sessions may bypass worktree entirely (it's a containment pattern for background runs). PTY handle API stays identical |
| WS pub/sub topology (`services/ws-bus.ts`, `routes/ws.ts`) | **KEEP** | Per-session topics with WeakMap-reaped clients is the right shape. Add more topic flavors but keep the subscribe/unsubscribe protocol |
| MCP server (10 narrow-primitive tools) | **REPHRASE** | In WorkStation, MCP is no longer the primary surface — in-app sessions use direct service-layer calls. Keep the tools for external-session interoperability but don't design around them |
| Hook pipeline + plugin (`hook-pipeline.ts`, `apps/plugin/`) | **REPHRASE** | For in-app sessions WorkStation spawns itself, hook events fire from inside the sidecar directly, no bash shim needed. Keep plugin for external-session observer mode as a secondary feature, not the main flow |
| Parent-re-parent self-terminate (`index.ts:95-109`) | **KEEP** | Defends against the real macOS force-quit / launchd-reparent scenario; cheap and correct |

---

## 10 — Notable traps + anti-patterns (carry as lessons)

1. **Atomic-write race on `.commander.json`** (N4a.1 D1/D2 class). `services/projects.ts:82-107` — concurrent `ensureProjectByCwd(sameCwd)` calls can both pass the initial SELECT then both INSERT. Guards in place: (a) per-call unique tmp filename `${identityFile}.${randomUUID()}.tmp` at `:90`, (b) UNIQUE-constraint catch at `:108-115` re-queries winner, (c) file-reconciliation at `:119-132` rewrites disk with winner's id so DB + file agree. Lesson: tmp+rename alone is not enough when multiple writers race; uniqueness of the tmp name matters.

2. **`ensureProjectByCwd` column-semantic drift** (Debt 24). Pre-N4 `identity_file_path` meant "the cwd directory"; post-N4 it means "path to the `.commander.json` file inside the cwd." Consumers reading the column directly broke. Mitigation: `resolveProjectRoot(identityFilePath)` at `services/projects.ts:29-34` normalizes both forms. Any new code touching the column routes through this helper. Lesson: when a column's semantic changes across migrations, ship a single resolver and force all consumers through it.

3. **FK-on-NOT-NULL vs system-origin rows** (N4a.1 H3). `hook_events.session_id` is NOT NULL FK to `sessions(id)` — system-origin events (migration dedup forensics, future health alerts, etc.) can't insert without a referent. Fix: `SYSTEM_BOOT_SESSION_ID = 'system-boot'` sentinel session row (`migrations/commander-json-identity.ts:69`) seeded idempotently on every boot. Lesson: when any table is FK-ed to an entity that's normally user-created, seed a system sentinel.

4. **Bun PTY API surface vs docs** (`pty/spawn.ts:8-22`). SPEC §6.3 cites `Bun.spawn({terminal: {...}})` but Bun 1.3.13's data callback fires once with `undefined`. Went with `stdout: 'pipe'` + ReadableStream reader instead. Lesson: when runtime docs and actual shipped behavior disagree, don't block the phase; document the deviation and move on. Keep a migration path open to the spec'd API when the runtime catches up.

5. **Hook plugin shape: plugin.json declarations trigger "Duplicate hooks file detected"** (SPEC §8.1 + N2 D6b). Declaring `manifest.hooks = "./hooks/hooks.json"` in plugin.json, while also having the file at that path (Claude's standard auto-load path), causes plugin-install abort. Minimal plugin.json wins: no hooks key, no mcpServers key. Lesson: convention-over-configuration for tool-registered paths; declare only deviations.

6. **HTTP-type hooks reject env-var URLs at plugin-load time** (`apps/plugin/hooks/forward.sh:9-15`). Claude Code v2.1+ validates hook `url` format before expansion, so `${COMMANDER_PORT}` breaks. Command-type hooks with a bash shim are the working pattern — the shim reads config at every invocation so port/bearer changes propagate without plugin reinstall. Lesson: platform validators run before your env-var expands; shell indirection is the escape hatch.

7. **Boot-order trap: migration before server listen** (`index.ts:44-66`). If migration runs async-with server already listening, frontend + MCP can hit half-migrated state. Fix: migration is awaited, halts boot on failure with exit code 4, server never starts. Lesson: state-materialization steps block server.listen; halt-on-failure exit codes distinct per stage are cheap and make log diagnostics trivial.

8. **Rust ≤150 LOC G5 discipline enforcement** (`lib.rs` = 144 LOC). Every temptation to grow Rust (log rotation, cross-platform polish, extra IPC commands) was pushed into the sidecar. The result is a clean blast wall: sidecar can be rebuilt, redeployed, even swapped for Node 22 + node-pty in an escalation path, without Rust needing to change. Lesson: when the native shell is small by design, keep it small by discipline — and track it in a commit CI check if it ever drifts.

---

**Word count: ~2,880.** Saved to `/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/docs/workstation/audit-2026-04-24/02a-native-infra.md`.
