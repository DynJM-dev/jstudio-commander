# Command-Center Architecture Specification

**v1.3** — 2026-04-23 · CTO (Claude.ai Opus 4.7) · `~/Desktop/Projects/jstudio-commander/docs/command-center/ARCHITECTURE_SPEC.md` · Calibration patch pairing with KB v1.4 (§7.3 external session `.mcp.json` shape + §8.1 plugin.json minimal shape)

**Authority:** `COMMAND_CENTER_ROADMAP.md` v0.3 (phase sequence) + `COMMANDER_KNOWLEDGE_BASE.md` v1.3 (principles) + `OPERATING_SYSTEM.md` (operating-model invariants).

**Status:** Ratified by Jose 2026-04-23. §10 decisions locked. Ready for N1 dispatch drafting.

---

## §0 — How to read this document

This spec sits between the roadmap (what ships in what order) and dispatches (what CODER does in a phase). Every N# dispatch cites relevant sections of this spec and refines a scoped slice of it.

Reading order for anyone arriving fresh: KB Part 1 (ratified principles) → Roadmap v0.3 (phase sequence) → this spec (how each phase implements) → N# dispatch (what CODER does this rotation).

Structure: §1 protected-principle summary; §2–§9 concrete architecture per layer; §10 open decisions for N1 dispatch ratification; §11 scope-exclusions.

No dispatch-level detail. Expect to refer to this spec's relevant sections from the "Required reading" block of every dispatch from N1 forward.

---

## §1 — Protected architectural principles

Six principles from KB Part 1 that are protected — any proposal to relax them must invalidate the principle first, not override locally:

1. **UI-process / pane-host-process split (KB-P1.12).** Tauri shell + webview is one OS process; Fastify sidecar + node-pty + agent children + persistence is a second. IPC between them. UI reloads / HMR / crashes never affect the sidecar.
2. **Per-session IPC channels, never shared bus (KB-P1.13).** Every long-running data stream uses per-session WebSocket topics (`<topic>:<session_id>` pattern). No multiplexed server-side-filtered firehose.
3. **Boot-path discipline (KB-P1.14).** Skeleton UI in 200ms; no sync keychain / IPC / disk at module init; `ready-to-show` paired with window creation; route-level code splitting.
4. **xterm explicit-dispose lifecycle (KB-P4.2 v1.2).** Every `new Terminal()` pairs with `dispose()` + listener unregistration + PTY ownership on unmount. React reconciliation does not own xterm lifecycle.
5. **Narrow-primitive tool surface (KB-P1.7 v1.3).** MCP and HTTP tools are CRUD primitives. No raw SQL, no raw shell-exec, no raw filesystem-write regardless of caller's model tier.
6. **Persistent state in sidecar DB (KB-P1.16).** Flow-gating state in SQLite via Drizzle. localStorage only for transient UI preferences (panel widths, filter selections, dismissed tooltips).

Two operating-model disciplines that shape how architecture is verified:

- **SMOKE_DISCIPLINE v1.0** — user-facing smoke at the outermost layer (Finder-launched `.app` + pixel observations). CODER's automated smoke is prerequisite, not substitute.
- **INVESTIGATION_DISCIPLINE** — when a fix ships unit-green + symptom unchanged, fire an instrumentation rotation; no fix code until diagnostic ratified.

---

## §2 — Platform: Tauri v2 + Rust shell + Fastify sidecar

### 2.1 Process topology

Three runtime processes at steady state:

```
┌────────────────────────────────────────────────────────────┐
│                    Commander.app bundle                    │
│                                                            │
│  ┌─────────────────────────────┐  ┌────────────────────┐   │
│  │  Rust shell (Tauri v2)      │  │  Fastify sidecar   │   │
│  │  ──────────────────────     │  │  ───────────────   │   │
│  │  • Webview host             │──│  • Node 22         │   │
│  │  • PathResolver             │  │  • node-pty        │   │
│  │  • single-instance lock     │  │  • Drizzle/SQLite  │   │
│  │  • GPU flags                │  │  • Hook handler    │   │
│  │  • shutdown handler         │  │  • MCP server      │   │
│  │                             │  │                    │   │
│  │   React frontend            │  │                    │   │
│  │   (in webview)              │  │                    │   │
│  └─────────────────────────────┘  └────────────────────┘   │
│          │                              │                  │
│       Tauri IPC              HTTP + WS (127.0.0.1:<port>)  │
└────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
      User inputs                 node-pty children
                                  (claude, bash, etc.)
```

Rust shell spawns the sidecar as a child process on launch. If the webview crashes, the sidecar survives (and Rust shell respawns the webview). If the Rust shell crashes, the sidecar dies with it (it's in the shell's process tree).

Auto-update mechanics (if ever un-deferred per KB-P7.9): Rust shell restarts with new binary; sidecar spawns fresh on new binary; agent children die during restart. Commercial-phase concern, not v1.

### 2.2 Rust scope boundary

**Rust code ≤150 LOC total in v1** (G5 guardrail from v1, carries forward unchanged). Rust owns:

- Tauri window creation and lifecycle (including `ready-to-show` pairing per KB-P1.14).
- `PathResolver::resolve_resource()` exposed as an IPC command for sidecar resource paths (KB-P4.1).
- Single-instance lock (via Tauri single-instance plugin).
- GPU acceleration flags and verification.
- Shutdown handler: graceful sidecar shutdown signal → wait up to 5s → SIGKILL.
- Spawning the sidecar as a child process and managing its lifecycle.

Rust does NOT own: PTY management, DB, plugin handling, approval logic, event parsing, HTTP, WS, MCP. Any proposal to grow Rust scope past 150 LOC requires CTO ratification with rationale.

### 2.3 Sidecar runtime

Fastify on Bun 1.3+. Bun ships as a single binary, drops cleanly into Tauri v2's sidecar model without the wrapper + dist + node_modules choreography Node would require. Resolves the KB-P7.3 open question around bundling — the "SEA mathematically impossible on Node 22" concern does not apply to Bun.

Key runtime dependencies:

- **PTY**: `Bun.spawn({ terminal: {...} })` native API (added Bun 1.3.5, Dec 2025). No `node-pty` native addon required — Bun's PTY support is built in.
- **HTTP**: Fastify 5 — runs unchanged on Bun.
- **DB**: Drizzle ORM + `bun:sqlite` (Bun's built-in SQLite driver, faster than `better-sqlite3` and requires no native bindings).
- **Filesystem watching**: `chokidar` or Bun's native `Bun.watch()` — either works for FSEvents-driven JSONL indexing.

Port selection: sidecar scans 11002..11011 on boot, claims first available. Port written to `~/.commander/config.json` for frontend discovery. Rust shell reads config after sidecar signals ready.

**Risk note for N3 PTY work.** Bun's PTY API is ~4 months old at v1.0 spec ratification. Fallback paths if bugs surface: (a) `bun-pty` community Rust-FFI PTY wrapper, (b) dropping sidecar runtime back to Node 22 + `node-pty` with the bundling tax KB-P7.3 describes. PTY work lives in N3 — lead time before commitment locks in.

### 2.4 Window lifecycle (boot-path discipline from KB-P1.14)

Pattern ratified v1.2 after N1.1 zombie-window class bug. Window starts **visible** with a pre-React HTML skeleton — no IPC-dependent visibility handshake.

1. `.app` launched from Finder.
2. Rust shell creates window with `visible: true, center: true`.
3. Webview loads `index.html`. The HTML contains a minimal skeleton: `<body>Command Center — Booting…</body>` plus baseline CSS. This paints as soon as the webview loads.
4. Rust shell spawns sidecar in parallel — does NOT block window creation on sidecar ready.
5. React bundle loads; React mounts and replaces the HTML skeleton with the real skeleton UI (welcome view or kanban shell).
6. Frontend async-initializes: reads port from config, contacts sidecar `/health`, hydrates project list, etc.

**Why this pattern over `visible: false` + show_window IPC:**

v1.1 originally specified window created `visible: false`, React mounts, frontend calls `show_window` IPC to reveal. That handshake has a failure mode: if the IPC call silently fails (e.g., capability-grant issue, macOS behavior change on hidden webviews, swallowed `.catch()`), the window stays hidden indefinitely — Dock icon present, zero pixels rendered. Zombie-window state. Caught in N1.1 Jose smoke step 2 after the AppleScript process check reported green (process-level visibility was true; window count was zero).

Option A (shipped) eliminates the zombie case: user always sees pixels within the first paint. HTML skeleton renders before React hydrates, React skeleton replaces it within the 200ms budget (N1 measured 8ms React first-paint; budget has 192ms of slack).

Time budget:
- Window visible with HTML skeleton: first webview paint (<50ms typical on N1 Apple Silicon hardware).
- React skeleton hydrated: ≤200ms from launch (KB-P1.14).
- Sidecar `/health` responding: ≤1s.
- Project list + task list hydrated: ≤2s.
- If subsystems fail to hydrate within 5s, frontend surfaces explicit error state (not an indefinite spinner).

**Deferred tech-debt:** root cause of why `visible: false` + `show_window` IPC failed in N1.1 was not investigated (Tauri v2 capability-grant issue vs. macOS 26 behavior vs. swallowed frontend error). Logged as N7 hardening candidate. Current pattern is defense-in-depth — we don't need the root cause to ship safely.

---

## §3 — Storage: SQLite + Drizzle, fresh v1 schema

### 3.1 Storage locations

Per KB-P1.9 local-first + v1.2 ratification (2026-04-23 — internal project codename `commander` for paths and binaries, external product name `Command Center` for user-facing label):

- `~/.commander/config.json` — bearer token, sidecar port, first-launch state, Preferences settings.
- `~/.commander/commander.db` — SQLite main DB, Drizzle-managed.
- `~/.commander/logs/<date>.log` — sidecar logs, rotated daily.
- `<project-root>/.commander.json` — identity file, `{project_id: <uuid>}` (KB-P1.5).
- `<project-root>/.worktrees/run-<uuid>/` — per-run worktrees (KB-P1.4).

### 3.2 Schema (full v1 — N1 lands all tables empty)

Drizzle table definitions. All UUIDs via `crypto.randomUUID()` at sidecar layer; timestamps UTC ISO-8601.

```typescript
projects {
  id: uuid PRIMARY KEY
  name: text NOT NULL
  identity_file_path: text NOT NULL UNIQUE  // abs path to .commander.json
  created_at: timestamp NOT NULL
  updated_at: timestamp NOT NULL
  INDEX (identity_file_path)
}

workspaces {
  id: uuid PRIMARY KEY
  project_id: uuid NOT NULL → projects(id)
  name: text NOT NULL
  color: text NOT NULL            // one of 8 palette colors
  layout: jsonb                   // pane positions, sizes
  created_at, updated_at
  INDEX (project_id)
}

agents {
  id: uuid PRIMARY KEY
  project_id: uuid NOT NULL → projects(id)
  name: text NOT NULL
  system_prompt_md: text
  model: text NOT NULL            // e.g. "claude-opus-4-7"
  capability_class: text NOT NULL DEFAULT 'high'   // 'high' | 'fast' | 'cheap' per KB-P1.7
  max_iterations: int
  max_wall_clock_seconds: int
  max_tokens: int
  tools_json: jsonb
  created_at
  INDEX (project_id)
}

tasks {
  id: uuid PRIMARY KEY
  project_id: uuid NOT NULL → projects(id)
  title: text NOT NULL
  instructions_md: text NOT NULL
  status: text NOT NULL DEFAULT 'todo'   // todo | in_progress | in_review | done
  created_at, updated_at
  INDEX (project_id, status)
}

knowledge_entries {        // APPEND-ONLY per KB-P1.3
  id: uuid PRIMARY KEY
  task_id: uuid NOT NULL → tasks(id)
  agent_run_id: uuid → agent_runs(id)    // nullable if manually added
  agent_id: uuid → agents(id)            // nullable if manual
  timestamp: timestamp NOT NULL
  content_md: text NOT NULL
  superseded_by_id: uuid → knowledge_entries(id)  // supersede, never delete
  INDEX (task_id, timestamp)
}

agent_runs {
  id: uuid PRIMARY KEY
  task_id: uuid NOT NULL → tasks(id)
  agent_id: uuid → agents(id)
  session_id: uuid → sessions(id)
  status: text NOT NULL DEFAULT 'queued'
    // queued | running | waiting | completed | failed | cancelled | timed-out
  started_at, ended_at: timestamp
  exit_reason: text
  worktree_path: text
  tokens_used: int DEFAULT 0
  wall_clock_seconds: int DEFAULT 0
  INDEX (task_id, status)
  INDEX (session_id)
}

sessions {
  id: uuid PRIMARY KEY
  agent_run_id: uuid → agent_runs(id)   // nullable — not all sessions are from task runs
  pty_pid: int
  cwd: text NOT NULL
  claude_session_id: text               // Claude Code's own session UUID
  status: text NOT NULL DEFAULT 'initializing'
  scrollback_blob: blob                 // utf8 round-tripped per KB-P4.2
  created_at, ended_at: timestamp
  INDEX (agent_run_id)
  INDEX (claude_session_id)
}

hook_events {
  id: uuid PRIMARY KEY
  session_id: uuid → sessions(id)
  event_name: text NOT NULL             // SessionStart, UserPromptSubmit, etc.
  timestamp: timestamp NOT NULL
  payload_json: jsonb NOT NULL          // raw payload per KB-P1.1 schema-drift defense
  INDEX (session_id, timestamp)
  INDEX (event_name, timestamp)
}

onboarding_state {            // KB-P1.16 flow-gating state in DB
  user_id: text PRIMARY KEY DEFAULT 'local'   // v1 single-user; expand for multi-user later
  completed_steps: jsonb NOT NULL DEFAULT '[]'
  plugin_installed_acknowledged: boolean NOT NULL DEFAULT false
  first_project_added: boolean NOT NULL DEFAULT false
  updated_at: timestamp NOT NULL
}
```

Schema detail is subject to N1 dispatch refinement — column names or types may change during implementation, but shape + indices + FK relationships are load-bearing.

### 3.3 Migrations

Drizzle migrations run automatically on sidecar boot, before any query path is exercised. Migration failure → sidecar exits with logged error; frontend surfaces "database migration failed" state with log excerpt. Recovery path: manual DB backup restore OR clean reinstall.

Atomic principle per KB-P4.9 v1.3: code depending on column X cannot ship before migration adding column X lands on the user's machine. Drizzle's migration runner enforces this at boot; our discipline is to never bypass it.

### 3.4 Persistent-state placement (KB-P1.16 audit)

**DB (sidecar SQLite):** tasks, knowledge, agent_runs, sessions, workspaces, projects, agents, hook_events, onboarding_state.

**localStorage / sessionStorage:** sidebar width, collapsed panel states, last-selected project filter, theme override (if user picks non-default), dismissed-tooltip flags, last-visible ChatThread width.

**Gate test:** *if this state vanishes, does the user lose work or hit a confusing redirect?* Yes → DB. No → localStorage OK.

---

## §4 — State management: Zustand + TanStack Query + WebSocket

Per OS §20.LL v5 Zustand amendment:

- **Zustand** — pure client state. Current workspace selection, sidebar collapsed state, active pane focus, ephemeral UI flags, modal-open state.
- **TanStack Query** — server state with caching. Task list, run history, knowledge entries, session data, project list. Mutations invalidate queries.
- **WebSocket-driven** — real-time streams. PTY output, hook events, approval events, status updates. Events write into TanStack cache (via `queryClient.setQueryData`) or Zustand depending on whether the data has a canonical server source.

Split test: does this have a canonical source outside the frontend? → TanStack Query. Does it exist only for UI? → Zustand. Is it real-time streaming? → WebSocket, write into whichever cache applies.

MobX and Redux remain banned per OS §15. No exceptions.

---

## §5 — Real-time pipeline: per-session WebSocket channels

### 5.1 Topology (KB-P1.13)

Frontend connects to sidecar WebSocket endpoint. Topic subscription is explicit and per-session:

**Per-session topics:**
- `pty:<session_id>` — raw PTY output bytes
- `hook:<session_id>` — hook events as typed JSON
- `status:<session_id>` — session status transitions
- `approval:<session_id>` — PreToolUse events needing approval resolution
- `tool-result:<session_id>` — PostToolUse events

**Global topics (no session scope):**
- `system:warning` — sidecar-wide warnings
- `plugin:status` — plugin install/uninstall events

Frontend subscribes only to topics for currently-mounted panes. Pane unmount → unsubscribe. Workspace switch (hidden-workspace suspension, KB-P1.15) → unsubscribe all the hidden workspace's session topics.

### 5.2 Event typing

Discriminated-union types in `packages/shared/src/events.ts`:

```typescript
type PtyEvent =
  | { kind: 'data', session_id: string, bytes: string /* base64 utf8 */ }
  | { kind: 'exit', session_id: string, exit_code: number }

type HookEvent = {
  session_id: string
  event_name: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
            | 'Notification' | 'Stop' | 'SubagentStart' | 'SubagentStop'
            | 'TaskCreated' | 'TaskCompleted' | 'SessionEnd'
            | 'PreCompact' | 'PostCompact' /* ... */
  timestamp: string
  payload: unknown   // raw payload per KB-P1.1 schema-drift defense
}

type StatusEvent = {
  session_id: string
  status: 'initializing' | 'working' | 'waiting' | 'done' | 'failed' | 'cancelled'
  timestamp: string
}

type ApprovalEvent = {
  session_id: string
  approval_id: string
  tool_name: string
  tool_input: unknown
  timestamp: string
}
```

De-dupe by `session_id + uuid` tuple per KB-P4.3 when replaying events from JSONL (historical backfill path). Live hook events don't need de-dupe; JSONL replay does.

### 5.3 JSONL secondary indexer

Per KB-P1.1, JSONL is secondary. Indexer watches `~/.claude/projects/<url-encoded-cwd>/<session-uuid>.jsonl` via `chokidar` (cross-platform abstraction over `fs.watch` / FSEvents).

Purposes: (a) reconstruct pre-Commander sessions, (b) recover when plugin isn't installed, (c) FTS5 cross-session search.

**Bug J prevention (KB-P4.6):** indexer filters events by `session_id` ownership. Hook events already carry `session_id`; indexer only processes events for session IDs this sidecar instance created. Cross-instance leaks structurally impossible.

---

## §6 — Terminal layer: xterm.js + node-pty

### 6.1 xterm.js configuration

Per KB-P4.2 + KB-P4.12:

- `@xterm/xterm` latest stable.
- `@xterm/addon-webgl` for perf (fallback to canvas renderer if WebGL init fails; log warning).
- `@xterm/addon-fit` for responsive sizing.
- `@xterm/addon-serialize` for scrollback capture on session close.

Scrollbar-gutter CSS baked into default terminal-pane component (KB-P4.2):
```css
.xterm-container { overflow: hidden; }
.xterm-container ::-webkit-scrollbar { width: 0; height: 0; display: none; }
.xterm-container * { scrollbar-width: none; -ms-overflow-style: none; }
```

### 6.2 Mount/unmount lifecycle — explicit dispose (KB-P4.2 v1.2 protected)

Single custom hook owns mount/unmount. React reconciliation does NOT own terminal lifecycle:

```typescript
function useTerminalPane(session_id: string, containerRef: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const term = new Terminal({ /* config */ })
    const fitAddon = new FitAddon()
    const webglAddon = new WebglAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webglAddon)
    term.open(containerRef.current!)
    fitAddon.fit()

    const ptySub = subscribeToTopic(`pty:${session_id}`, (evt) => {
      if (evt.kind === 'data') term.write(atob(evt.bytes))  // utf8 safe
    })

    const dataHandler = term.onData((data) => sidecarWritePty(session_id, data))

    return () => {
      // Explicit disposal in reverse order of setup:
      dataHandler.dispose()
      ptySub.unsubscribe()
      webglAddon.dispose()
      fitAddon.dispose()
      term.dispose()
      sidecarReleasePtyOwnership(session_id)   // sidecar decides: keep alive or kill
    }
  }, [session_id])
}
```

Every link in the teardown chain is load-bearing. Skipping any of them produces the Matt-banked pane-swap / memory-leak failure mode.

### 6.3 PTY spawn (sidecar-owned)

Per KB-P3.3 + KB-P4.13 + KB-P4.2, using Bun's native PTY API:

```typescript
// Sidecar code (Bun runtime)
async function spawnSession(options: SpawnOptions) {
  const proc = Bun.spawn(['claude', options.prompt], {
    cwd: options.worktree_path,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    },
    terminal: {
      cols: 80,
      rows: 24,
      data(bytes) {
        publishToTopic(`pty:${session_id}`, {
          kind: 'data', session_id, bytes: Buffer.from(bytes).toString('base64')
        })
        appendToScrollback(session_id, bytes)  // utf8 round-trip per KB-P4.2
      },
    },
  })

  // KB-P4.13 blank-terminal-until-Enter fix — emit prompt-trigger byte so prompt paints
  setTimeout(() => proc.stdin.write('\n'), 100)

  proc.exited.then((exit_code) => {
    publishToTopic(`pty:${session_id}`, { kind: 'exit', session_id, exit_code })
    updateSessionStatus(session_id, 'done')
  })
}
```

Spawn form: bare `claude "prompt"` for interactive sessions (KB-P6.7 — never `claude -p`). CCManager teammate-mode injection when spawning under multi-session orchestration (KB-P3.4).

**Fallback path if Bun.spawn terminal API proves unreliable in N3:** replace with `bun-pty` (Rust-FFI community package). If that also fails, drop sidecar runtime back to Node 22 + `node-pty` per §2.3 risk note.

---

## §7 — IPC contracts

### 7.1 Tauri IPC commands (frontend ↔ Rust shell)

Minimal surface. Rust exposes:

- `get_resource_path(name: string) → string` — PathResolver bridge.
- `get_config_path() → string` — resolves `~/.jstudio-commander/config.json`.
- `show_window()` — frontend calls this after skeleton paint; Rust sets `visible: true`.
- `quit_app()` — graceful shutdown, triggers sidecar cleanup.

No PTY commands in Rust. No DB commands in Rust. No hook commands in Rust.

### 7.2 HTTP API (frontend ↔ sidecar)

Bearer-authed. All routes return `{ ok: boolean, data?: T, error?: ErrorEnvelope }`:

```
GET    /health                     → { status, version }
GET    /api/projects               → Project[]
POST   /api/projects               → Project
GET    /api/projects/:id           → Project
GET    /api/projects/:id/tasks     → Task[]
POST   /api/tasks                  → Task
PATCH  /api/tasks/:id              → Task
GET    /api/tasks/:id/knowledge    → KnowledgeEntry[]
POST   /api/tasks/:id/knowledge    → KnowledgeEntry   // append-only — no PATCH/DELETE
GET    /api/runs                   → AgentRun[]
POST   /api/runs                   → AgentRun         // spawn a run
GET    /api/runs/:id               → AgentRun
DELETE /api/runs/:id               → { ok: true }     // cancel/kill
GET    /api/workspaces             → Workspace[]
POST   /api/workspaces             → Workspace
PATCH  /api/workspaces/:id         → Workspace
GET    /api/sessions               → Session[]
GET    /api/sessions/:id           → Session
```

**Narrow-primitive rule (KB-P1.7 v1.3, protected):** no `/api/execute_sql`. No `/api/shell_exec`. No `/api/write_file_raw`. No endpoint that accepts free-form database or shell input.

### 7.3 MCP server routes (external Claude sessions ↔ sidecar)

On `/mcp/*` prefix, same Fastify instance, same bearer. Tool set (semantic parity with HTTP API per KB-P1.2 composition principle):

- `list_projects`, `get_project`
- `list_tasks`, `create_task`, `update_task`
- `add_knowledge_entry`  (append-only)
- `list_sessions`, `get_session`
- `spawn_agent_run`, `cancel_agent_run`, `get_agent_run`

External sessions chain Commander tools with other MCPs (Playwright, filesystem MCP, git MCP) rather than expect Commander to re-implement those capabilities.

**External Claude Code session configuration for Commander MCP (added v1.3):**

External sessions access Commander's MCP via a **project-root `.mcp.json` file** in the directory where `claude` launches. Shape is the **wrapped form** (`mcpServers` object):

```json
{
  "mcpServers": {
    "commander": {
      "type": "http",
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**Critical distinctions:**

- The `mcpServers` wrapper is REQUIRED for project-root `.mcp.json`. Flat-shape `{"commander": {...}}` without the wrapper is rejected with `mcpServers: Does not adhere to MCP server configuration schema`.
- **Plugin-bundled `.mcp.json`** (inside a Claude Code plugin package) accepts **flat shape** — this is a separate file at `.claude-plugin/../.mcp.json` inside the plugin, and the distinction matters. 4 of 5 official plugin-bundled examples use flat; only `discord` uses wrapped. Schema is location-dependent (project-root vs plugin-bundled).
- `~/.claude/settings.json` does NOT accept an `mcpServers` field — it's for Claude Code settings, not MCP registration. Settings.json schema validator rejects the field.
- Claude Code does NOT live-reload `.mcp.json`. The session must restart to pick up config changes.
- `<port>` and `<token>` come from `~/.commander/config.json` on the host. Commander's Preferences → Plugin tab shows the exact block to paste (with current port + bearer substituted) for one-click external-session setup.

See D-KB-12 in DECISIONS.md for the N2 smoke evidence that drove this amendment.

### 7.4 Plugin hook endpoints (plugin ↔ sidecar)

Bearer-authed. One route per hook event:

```
POST /hooks/session-start         → { continue: true }
POST /hooks/user-prompt-submit    → { continue: true }
POST /hooks/pre-tool-use          → { hookSpecificOutput: { permissionDecision, reason, updatedInput? } }
POST /hooks/post-tool-use         → { continue: true }
POST /hooks/notification          → { continue: true }
POST /hooks/stop                  → { continue: true }
POST /hooks/subagent-start        → { continue: true }
POST /hooks/subagent-stop         → { continue: true }
POST /hooks/task-created          → { continue: true }
POST /hooks/task-completed        → { continue: true }
POST /hooks/session-end           → { continue: true }
POST /hooks/pre-compact           → { continue: true }
POST /hooks/post-compact          → { continue: true }
```

Each handler pipeline:

1. Persist raw payload to `hook_events` table (KB-P1.1).
2. De-dupe by `session_id + uuid` (KB-P4.3).
3. Emit typed event on `hook:<session_id>` WS topic.
4. Update session status if the event implies a transition.
5. Return response to plugin (blocking hooks respond within the hook timeout; non-blocking hooks return `{ continue: true }` immediately and process async).

### 7.5 WebSocket subscription protocol

Single `/ws` endpoint per sidecar. After bearer-auth handshake:

```
→  { kind: 'subscribe', topic: 'pty:<id>' }
←  { kind: 'subscribed', topic: 'pty:<id>' }

←  { kind: 'event', topic: 'pty:<id>', data: { ... } }

→  { kind: 'unsubscribe', topic: 'pty:<id>' }
←  { kind: 'unsubscribed', topic: 'pty:<id>' }
```

Frontend unsubscribes on: pane unmount, workspace switch (hidden-workspace suspension), explicit session close, or tab visibility-hidden for >N minutes (configurable; default 10min).

---

## §8 — Plugin + MCP integration

### 8.1 Plugin package

Structure per KB-P3.2 v1.4 (calibrated against Claude Code v2.1.118 2026-04-23):

```
commander-plugin/
├── .claude-plugin/
│   ├── plugin.json          # name, version, description, author — NO hooks/mcpServers keys for standard paths
│   └── marketplace.json     # marketplace entry
├── hooks/
│   ├── hooks.json           # auto-loaded by convention (omit plugin.json manifest.hooks for this path)
│   └── forward.sh           # command-type shim; reads ~/.commander/config.json dynamically for port+bearer
└── README.md
```

**Minimal `plugin.json` (amended v1.3 — no hooks or mcpServers keys when using standard paths; declaring `manifest.hooks` for `./hooks/hooks.json` triggers "Duplicate hooks file detected" abort):**

```json
{
  "name": "commander",
  "version": "0.1.0",
  "description": "Command Center GUI hooks integration",
  "author": { "name": "JStudio" },
  "license": "MIT"
}
```

`hooks.json` uses command-type hooks invoking `bash "${CLAUDE_PLUGIN_ROOT}/hooks/forward.sh" <event-name>`. `forward.sh` reads port + bearer from `~/.commander/config.json` on every invocation (dynamic; absorbs port-scan variance + bearer changes) and POSTs stdin payload to `http://127.0.0.1:<port>/hooks/<event-name>`. See KB-P3.1 for the 9 supported events and KB-P3.2 for the full plugin structure.

**Why command-type and not HTTP-type hooks:** Claude Code v2.1+ validates the `url` field of http-type hooks at plugin-load time with strict URL format — env-var placeholders like `${COMMANDER_PORT}` fail validation before expansion. HTTP transport in Claude Code v2.1+ is for MCP servers (`.mcp.json`), not hooks. See D-KB-09 in DECISIONS.md + N2 smoke evidence in PHASE_N2_REPORT §4 D6b.

**Install flow (amended v1.3 — no `file://` URI):** `/plugin marketplace add <owner/repo-or-./path-or-absolute-path>` (NOT `file://<path>` — rejected at dialog layer), then `/plugin install commander@jstudio`. Commander's Settings panel shows the install command with one-click copy.

### 8.2 Auth

Single local bearer token at `~/.jstudio-commander/config.json`. v1: no expiry. Token shown in Settings panel with copy button.

Token used by:
- Commander's own frontend (read from config via Tauri IPC at boot).
- Claude Code plugin (set as `COMMANDER_TOKEN` env when plugin installed).
- External Claude sessions calling MCP (paste into `~/.claude/settings.json` MCP config).

Rotation: not in v1 scope. If added later (N7 or post-v1 hardening), rotation must not interrupt long-running agent sessions (KB-P4.14). Sidecar performs silent refresh; agent sessions never see the rotation happen.

---

## §9 — Error handling & degradation

Failure modes and responses:

**Sidecar unreachable on boot.** Frontend shows explicit error banner in Preferences + disabled state on task cards ("Sidecar unreachable — restart Commander"). Skeleton UI still renders; hydrating subsystems surface errors one by one.

**Plugin not installed.** Frontend surfaces a "Plugin not detected" banner on task board with one-click install instructions. JSONL secondary indexer still works for historical backfill. Sessions can still be created but don't get real-time hook events.

**PTY spawn fails.** Sidecar emits `status:<session_id>` with `failed` status + reason string. Frontend shows error on run viewer with logs link.

**Hook event schema changed (Anthropic updates Claude Code).** Raw payload stored (KB-P1.1); typed renderer falls back to `UnmappedEventChip` (OS §23.2 denylist pattern). No silent drop. CTO notified via PHASE_REPORT if repeated.

**Migration fails on boot.** Sidecar exits with logged error. Frontend shows "Database migration failed" state with log excerpt + manual-recovery link.

**Webview crashes.** Rust shell respawns webview. Sidecar untouched (KB-P1.12). Frontend reconnects WS; re-subscribes to topics for currently-active sessions; scrollback restores from DB blob (KB-P4.2). Sessions never die from UI crashes.

**Worktree pollution (user deletes `.worktrees/` manually).** Sidecar detects missing path on next run attempt; marks agent_run as `failed` with reason `worktree_missing`; offers cleanup action. Doesn't cascade into DB corruption.

**Context-usage tracking unavailable.** If `ccusage` probe fails or hook-derived tracking is stale (>5s lag), frontend degrades to "run age" heuristic and emits a visible warning — not a silent stale number. Per KB-P1.17.

---

## §10 — Ratified decisions (previously open; ratified by Jose 2026-04-23)

Nine decisions ratified. Recorded here as reference; no further decision required before N1 dispatch.

**D-N1-01 React 19.** Stable since Dec 2024; at 19.2.5 (Apr 2026). Fresh build avoids the upgrade-pain stories (those are React 18 apps with archived libraries like Recoil).

**D-N1-02 TanStack Router.** v1 stable 2+ years. Type-safe routing; pairs with TanStack Query (same team) for integrated data-loading on route transitions.

**D-N1-03 Vite.** Tauri default; no reason to deviate.

**D-N1-04 Tailwind v4.** Stable at 4.1+, Oxide engine (5x-100x faster than v3). CSS-first config aligns with KB-P1.10 design-tokens approach.

**D-N1-05 shadcn/ui.** Component ownership, pre-styled, fast to first pixels. Swap to raw Radix for specific components if needed later.

**D-N1-06 Bun (runtime + package manager).** Shift from original Node 22 recommendation. Rationale: Bun 1.3.5+ ships built-in PTY API (`Bun.spawn({ terminal })`) so `node-pty` native-addon compatibility is not an issue; Bun ships as a single binary which resolves KB-P7.3 bundling concerns (no more wrapper + dist + node_modules inside `.app`); Claude Code itself runs on Bun; Matt BridgeSpace uses Bun. Risk: Bun's PTY API is ~4 months old. Mitigation: fallback paths named in §2.3.

**D-N1-07 Test framework (staggered; v1.2 amendment).** `bun:test` at sidecar from N1 (Bun-native, no extra dep, Jest-compatible API). Frontend + shared/UI packages use Vitest starting N4 (when first real UI lands) — Vite-built browser surface is a different runtime context. N7 hardening still targets 70% overall coverage.

**D-N1-08 Pino.** Structured JSON, fast, Bun-compatible.

**D-N1-09 Bun workspaces (no Turborepo in v1).** Bun handles package management + workspace resolution natively. Monorepo is small (three apps + two packages); built-in Bun script orchestration is sufficient. Add Turborepo in N7 hardening only if build caching becomes a bottleneck.

**D-N1-10 Monorepo layout (specified by rehydration prompt §9 — not an open decision, confirmed here for reference):**

```
jstudio-commander/
├── command-center/                 # monorepo code
│   ├── apps/
│   │   ├── shell/                  # Tauri v2 shell — Rust + minimal webview host
│   │   ├── frontend/               # React app (webview content)
│   │   └── sidecar/                # Fastify + Bun PTY + Drizzle
│   ├── packages/
│   │   ├── shared/                 # shared TS types, event schemas, constants
│   │   └── ui/                     # shared React components (populated from N4 onward)
│   ├── docs/
│   │   └── phase-reports/          # PHASE_N1_REPORT.md, PHASE_N2_REPORT.md, …
│   ├── bun.lockb                   # Bun lockfile
│   └── package.json                # Bun workspaces root
├── docs/                           # strategic docs at project root
│   ├── command-center/
│   │   ├── COMMAND_CENTER_ROADMAP.md
│   │   ├── ARCHITECTURE_SPEC.md
│   │   ├── DECISIONS.md
│   │   └── CLAUDE.md
│   ├── dispatches/
│   │   └── command-center/
│   │       └── N1_*.md, N2_*.md, …
│   └── native-v1/                  # v1 docs archive (reference only)
└── native-v1/                      # v1 code archive (frozen at dc8a0f6)
```

**Split rationale (from rehydration §9):** strategic docs — roadmap, architecture spec, DECISIONS, project CLAUDE.md — live at `jstudio-commander/docs/command-center/`. Operational artifacts — phase reports — live inside the monorepo at `jstudio-commander/command-center/docs/phase-reports/`. Dispatches live at `jstudio-commander/docs/dispatches/command-center/`.

---

## §11 — What this spec does NOT cover

Deliberately out of scope:

- Exact React component tree — lands in N4 and N6 dispatches.
- Exact Fastify route implementations — lands in N2 and N3 dispatches.
- Approval modal pixel-level design — lands in N5 dispatch.
- Renderer-registry event-shape details — lands in N6 dispatch.
- Frontend test coverage matrix — lands in N7 dispatch.
- Production signing/notarization — deferred per KB-P7.3.
- Auto-update pipeline — deferred per KB-P7.9.
- Multi-platform CI — deferred per KB-P7.10.
- Commander-authored Claude skills — deferred per KB-P5.12 (post-N7).

Every N# dispatch references the relevant spec section and adds tactical detail.

---

## §12 — Changelog

- **v1.0 (2026-04-23):** Initial spec.
- **v1.0 layout fix (same-day):** §D-N1-10 corrected to match rehydration prompt §9.
- **v1.1 (same-day, ratification pass):** §10 decisions ratified. D-N1-06 shifted to Bun. D-N1-07 staggered Vitest. D-N1-09 Bun workspaces alone. §2.3 + §6.3 rewritten for Bun runtime.
- **v1.2 (2026-04-23, post-N1-close):** Four amendments folded after N1 + N1.1 shipped 8/8:
  - §2.4 window lifecycle rewritten — dropped IPC-dependent `visible: false → show_window` handshake, replaced with `visible: true` + HTML skeleton in `index.html`. Addresses N1.1 zombie-window class bug.
  - §3.1 state-directory paths amended from `~/.jstudio-commander/` → `~/.commander/` (internal project codename matches binary names per ratification 2026-04-23).
  - §10 D-N1-07 amended to name `bun:test` at sidecar explicitly (ratified post-N1 substitution).
  - Cross-reference added to SMOKE_DISCIPLINE v1.1 §3.4.1 (window-presence ground truth — applies to all phases from N2 forward).
- **v1.3 (2026-04-23, post-N2-close calibration patch):** Four runtime-drift amendments paired with KB v1.4:
  - §7.3 adds "External Claude Code session configuration for Commander MCP" subsection — project-root `.mcp.json` requires `{"mcpServers": {...}}` wrapper (plugin-bundled `.mcp.json` accepts flat shape — location-dependent distinction). Settings.json `mcpServers` field rejected by schema — `.mcp.json` at project root is the only correct location. No live-reload.
  - §8.1 plugin.json snippet corrected — minimal `{name, version, description, author, license}`, no `hooks` or `mcpServers` keys when using standard paths (`./hooks/hooks.json` + `./.mcp.json` auto-load by convention; declaring `manifest.hooks` for the standard path triggers "Duplicate hooks file detected" abort).
  - §8.1 hooks.json guidance updated — command-type hooks with `forward.sh` shim, NOT http-type hooks (Claude Code v2.1+ rejects env-var placeholders in url field pre-expansion).
  - Install flow amended — `file://` URIs rejected by "Add Marketplace" dialog; use `owner/repo`, `./path`, or absolute filesystem path.
  - Source: N2 smoke findings 2026-04-23; DECISIONS D-KB-09 through D-KB-12.

---

**End of Architecture Spec v1.3.**
