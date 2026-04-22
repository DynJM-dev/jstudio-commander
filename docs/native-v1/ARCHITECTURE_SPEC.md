# Native Commander v1 — Architecture Spec (N0 Deliverable 2)

**From:** CTO (Claude.ai, 2026-04-22)
**To:** PM (Commander) for review + folding, then Jose for ratification
**Depends on:** `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` (N0 Deliverable 1)
**Scope:** Architectural primitives, feature-to-primitive mapping, data model, IPC contracts, bug common-denominator elimination, v1.0 scope boundary, future-scope invariants.
**Non-scope:** Specific file layouts (those go in N1 dispatch), CSS/theme tokens (those go in later UI dispatches), exact test surfaces (PM designs per subsystem).
**Status:** v1.3 — PM folded two §7-queued CODER-N1-surfaced corrections per N1_ACCEPTANCE_MEMO §7: §5.4 plugin name correction + §8.2 WebviewWindow origin revision. Canonical contract for N2 dispatch execution.

---

## §0 — How to read this document

This spec is the architectural contract between Deliverable 1 (what v1 does for the user) and the phased build dispatches that follow (N1 through N6). It names primitives, maps features to those primitives, and commits to structural choices that eliminate entire classes of bugs we hit in web Commander.

Read the principles (§1) and the primitives (§2-§8) first. The feature-to-primitive mapping (§9), Drizzle schema (§10), renderer registry (§11), IPC contracts (§12), and bug elimination table (§13) are reference material when dispatch drafting needs them. §14-§16 close the document with scope, invariants, and open questions.

This spec is **evidence-grounded.** Every primitive choice cites the bug class it eliminates, the Phase Y arc learning it applies, or the operating model invariant it preserves. Primitives chosen without such grounding are flagged as open design space.

This spec is **non-foreclosing.** Every architectural decision explicitly preserves optionality for future scope (multi-AI terminals, cross-platform, external distribution, workspace grids, swarm orchestration) unless foreclosing is a deliberate cost-reducing call with its cost named.

---

## §1 — Architectural principles

Five principles derived from the Phase Y arc, migration v2 operating model, and the ground-truth discipline codified in OS §20.LL-L13 and L14. Every primitive choice in §2-§8 is evaluated against these.

### 1.1 — Ground truth over derivation

When a signal can be observed directly from its source, v1 observes it directly. Derivation chains that compute a proxy from downstream artifacts are rejected unless no ground-truth source exists.

OS §20.LL-L14 applied architecturally. Phase Y arc's five failed rotations existed because the `useChat → ChatMessage[] → useToolExecutionState → ContextBar` chain derived status from the JSONL transcript pipeline when the pty itself was the ground-truth source.

Consequence in v1: node-pty direct attach replaces tmux capture-pane polling. OSC 133 shell markers replace pane-regex classification. FSEvents replace chokidar polling. The state machine is driven by observed pty events, not reconstructed from downstream text.

### 1.2 — Per-session isolation by construction

Cross-session leakage must be impossible by architecture, not merely unlikely by runtime check. Candidates 19 (ESC cross-pane) and 36 (effort display leak) are the same class: shared subscription channels where actions routed by inference rather than by data-attribute binding.

Consequence in v1: every session owns its own pty, its own xterm.js terminal instance, its own IPC channel, its own React component tree. Session identity is a required parameter on every cross-cutting operation, enforced by TypeScript. Shared broadcasts (like Phase T's capture-pane WS channel) are replaced with per-session IPC.

### 1.3 — Typed signals, not shape matching

Structured event metadata beats text-shape heuristics every time. OS §24 Pattern-Matching Discipline was codified precisely because character-level matching against external tool output is brittle (⏺ glyph semantic drift, "Esc to cancel" false-firing on viewer modals, markdown-shape plan-widget over-matching).

Consequence in v1: renderer registry is exhaustive typed union over Claude Code event types. Tool chips are dispatched on event-type metadata, never on text shape. Approval detection uses typed event signals, never "looks for 'Yes, I trust'" in output. Unknown types render as labeled "unmapped" chips with raw content visible, never silently dropped.

### 1.4 — Manual-bridge invariant preserved at UI level

OS §3.4: PM and Coder never communicate directly. PM and CTO never communicate directly. Jose is the bridge.

V1's three-role UI reduces friction of bridging without removing agency. "Copy to CODER" puts text on clipboard and highlights the CODER pane; it does not auto-send. "Route PHASE_REPORT to parent PM" opens the PM pane with the report loaded; it does not auto-submit. Every inter-pane action requires explicit Jose-initiated trigger.

This is OS §14.1 applied to the native UI layer.

### 1.5 — Extensibility preserved without upfront abstraction cost

V1 architecture does not foreclose multi-AI terminals (Codex, Cursor, Aider), workspace grids (>2 panes), swarm orchestration (coordinated multi-agent), or external distribution. It also does not build those features in v1.

The discipline: design primitives so future scope is additive, not refactor-requiring. Session types as an extensible registry (not a flat enum). IPC contracts as typed union of event variants (additive without breaking). Renderer registry with plug-in registration for new event types. Workspace schema that can hold N panes even if v1 UI only exposes 2-3.

This costs slightly more design thought up front, zero code weight. The test: can a future phase add a feature in its own dispatch without reopening v1's architecture? If yes, extensibility is sufficient. If no, we're missing a hook.

---

## §2 — Platform: Tauri v2 + Rust shell + Bun/Node sidecar

### 2.1 — Decision

Native shell is Tauri v2. Rust surface is tightly scoped to five categories:

1. Tauri configuration and window management
2. Sidecar lifecycle (spawn, crash recovery, clean shutdown)
3. IPC bridge for OS integrations (notifications, FSEvents, global shortcuts, tray, menu bar, drag-drop, Spotlight)
4. Code signing + updater integration
5. Eventual node-pty bridge (see §2.4) — not used in v1

Business logic stays in TypeScript. Any Rust code outside these five categories is scope drift and must be flagged to CTO.

Sidecar runtime is **Bun if verification passes in N1, Node-with-pkg fallback if not.** Verification spike is part of N1 scope: spawn node-pty under Bun, open better-sqlite3 under Bun on macOS arm64, verify both work end-to-end. If verified, Bun ships; if not, pkg-packaged Node ships. No raw Node binary bundling (Attempt 1's 105MB approach is deprecated).

### 2.2 — Rationale

Tauri v2 over Electron: ~10x lower memory (30-50MB idle vs 300-500MB), ~3-5x faster startup (<500ms vs 1-3s), native WebKit on macOS not bundled Chromium. Tauri v2 is production-mature (1Password, AppFlowy, Hoppscotch, BridgeSpace ship on it).

Tauri v2 over Swift/SwiftUI: preserves ~95% of the React UI code from web Commander (component patterns, state discipline, Tailwind tokens, test surfaces). Swift rewrite would cost 3+ months of unconstructive UI rebuild.

Bun over Node-as-bundled-binary: 30-50MB sidecar instead of 105MB. Faster startup. Built-in TypeScript execution (removes the packages/shared tsc-staging hack from Attempt 1). Lower latency SQLite (Bun ships its own SQLite API that outperforms better-sqlite3 in common queries, though v1 uses better-sqlite3 for ecosystem compat).

Fastify stays as sidecar server: preserves every service, every WebSocket handler, every Drizzle-adaptable schema. No rewrite cost. Sidecar managed via `tauri-plugin-shell` for crash recovery + log streaming + automatic restart.

### 2.3 — Rust scope boundary (load-bearing)

If a task comes up where you're about to write Rust for a non-§2.1-listed purpose, stop and escalate. Specific examples of scope drift to reject:

- Business logic (session management, state derivation, cost calculation) — TypeScript.
- Data parsing of Claude Code output — TypeScript.
- React component reimplementation — TypeScript.
- HTTP route handlers — Fastify in TypeScript.
- Renderer registry — TypeScript.
- State machine — TypeScript.

Rust is the shell + sidecar glue + OS bridge. Nothing more.

### 2.4 — node-pty placement decision

Two places node-pty can live:

- **Option A — node-pty in the sidecar (Node/Bun).** Sidecar spawns pty children. React frontend subscribes via WebSocket. Rust shell is pty-unaware.
- **Option B — node-pty in Rust.** Rust owns pty children. IPC to React for data/commands. Sidecar is pty-unaware.

**V1 decision: Option A.** Reasons:

- Preserves the existing Fastify + tmux service architectural shape (sidecar owns session processes).
- Allows xterm.js ↔ pty attach via WebSocket, which matches xterm.js's ecosystem (xterm.js frontend + node-pty backend is the BridgeSpace/VSCode/Warp pattern).
- Keeps Rust surface narrow (§2.1 boundary holds).
- Pty → sidecar → WebSocket → React hop is ~1-5ms on localhost; imperceptible compared to tmux shell-out's 50-200ms.

Option B is not foreclosed. If we later find a Rust-side pty reason (OS integration, tighter OS hook for crash recovery, reclaim some sidecar memory), we can migrate. For v1, Option A is the correct starting point.

### 2.5 — Open decisions for N1 dispatch

- Monorepo location: `src-tauri/` at repo root (Tauri convention, confirmed earlier).
- Rust LOC budget: ≤150 for N1 (matches Attempt 1's accidentally-correct landing).
- Bundle target: ≤60 MB v1, ≤30 MB stretch goal.
- Apple Developer cert: acquired now, used for signing from N1.

---

## §3 — Storage: SQLite + Drizzle ORM, fresh v1 schema

### 3.1 — Decision

SQLite via `better-sqlite3` for synchronous local-first queries. Drizzle ORM for typed query construction, schema definition, and migration management.

Database lives at `~/.jstudio-commander-v1/commander.db` (distinct path from web Commander's `~/.jstudio-commander/commander.db`). **No migration from web Commander's database.** Web Commander stays alive during v1 ship + dogfood for historical queries; v1 starts clean.

### 3.2 — Rationale

Drizzle over raw SQL: typed query surface matches TypeScript tooling, migrations are SQL files in version control with programmatic diff support, schema is declared in TypeScript (single source of truth), and runtime overhead is near-zero (Drizzle is query-builder-level, not ORM-abstraction-heavy).

Drizzle over Kysely / Prisma: Drizzle is closest to raw SQL, doesn't fight local-first patterns, works with better-sqlite3 natively, and the ecosystem around it in 2026 is mature. Prisma's schema-first approach and runtime query engine add weight v1 doesn't need. Kysely is viable but has thinner SQLite integration than Drizzle.

Fresh v1 database over migration: web Commander's schema accumulated 20+ ALTER migrations. Candidate 26 (session_ticks retention + UNIQUE constraint) is a visible symptom of that drift. V1 starts with a clean schema that has proper constraints from day one. Cost: lose historical telemetry (accepted by Jose — only worked on Commander in Commander). Benefit: no schema debt carried forward.

### 3.3 — Constraints

- Every business table has `id` (UUID PRIMARY KEY, generated via crypto.randomUUID()), `created_at` (TIMESTAMPTZ equivalent via SQLite `DATETIME DEFAULT CURRENT_TIMESTAMP`), `updated_at` (same with update trigger).
- Money columns (for cost telemetry): `NUMERIC` via `REAL` + validation — SQLite's NUMERIC affinity. Convert to/from `Decimal` in TypeScript for display.
- Enums: `TEXT` with `CHECK` constraint. Never Postgres ENUM equivalent.
- Foreign keys: enabled (`PRAGMA foreign_keys = ON`), `ON DELETE` behavior explicit.
- Retention policies baked into schema: session_events age out after 30 days (configurable), cost_entries retained indefinitely (cheap, queryable for analytics).
- Indexes on every foreign key column + on common query shapes (sessions by project, cost by day, etc.).

Detailed schema at §10.

---

## §4 — State management: Zustand + TanStack Query split

### 4.1 — Decision

Client state split by concern:

- **Zustand** for pure client state — UI preferences, window state, per-pane view state, keyboard shortcut registrations, theme selection, drawer open/closed states, workspace layout.
- **TanStack Query** for all server state — data fetched from Fastify over HTTP. Built-in caching, invalidation, optimistic updates, retry, stale-while-revalidate.
- **WebSocket-driven data** (session streams, pty output, tool events, status changes) — custom hooks that write to TanStack Query's cache via `queryClient.setQueryData`. WebSocket is the transport; TanStack Query is the cache.

No Redux. No MobX. No Context for server state.

**Note on OS §15 Critical Bans:** OS §15 reads "No Redux, Zustand, MobX — Context + hooks only." V1 deliberately deviates on Zustand. Rationale documented here for ratification: Zustand is a 3KB, unopinionated atomic-store library that serves a specific role (pure client state) without the bureaucracy of Redux or the reactive magic of MobX. It is used architecturally as "typed global state store," not as a Redux replacement. Context + hooks alone, as the Phase Y arc demonstrated, led to ad-hoc composition (`useChat` + `useSessionStateUpdatedAt` + `useToolExecutionState` + useEffect chains) that obscured data flow. Discipline + one small, explicit library is cleaner than discipline alone across a 50+ component app. CTO recommends amending OS §15 to permit Zustand specifically for pure client state, not server-state caching. If Jose rejects, v1 uses Context + hooks and accepts the complexity cost.

### 4.2 — Rationale

The Phase Y arc's complexity partly came from ad-hoc state composition. `useChat`, `useSessionStateUpdatedAt`, `useToolExecutionState`, `useCodemanDiffLogger`, `usePromptDetection`, ContextBar derivation chain — all composed via useEffect and useMemo, making the data flow illegible.

Disciplined state layering makes the flow explicit:

- Component reads server state → `useQuery('sessions')` from TanStack.
- Component reads client state → `useStore` from Zustand (or Context if OS §15 enforcement).
- WebSocket event arrives → custom hook writes to TanStack cache → dependent components re-render via cache subscription.
- User action → optimistic update via TanStack → POST to server → reconcile on response.

This architecture has a testable, legible data flow. Bugs in data freshness (like Phase Y's ContextBar staleness) show up at specific layer boundaries, not as emergent behavior from hook composition.

### 4.3 — Constraints

- **No ad-hoc Context for server state.** Server state is TanStack Query queries, always.
- **No useEffect chains for data derivation.** Derived state is computed in selector functions or TanStack Query's `select` option.
- **No redundant state.** If a value can be derived from query + store, don't duplicate.
- **State isolation per session.** Stores are scoped by sessionId where relevant. TanStack Query keys include sessionId (`['session', sessionId, 'events']`).

### 4.4 — Migration path from web Commander hooks

V1 rewrites these hooks from scratch with the new discipline, not ports them:

- `useChat` → `useSessionEvents(sessionId)` (TanStack Query with WebSocket cache writes)
- `useToolExecutionState` → not ported; status is driven by OSC 133 + tool events, not derived from messages
- `useCodemanDiffLogger` → not ported; no parallel derivation
- `usePromptDetection` → `useApprovalPrompts(sessionId)` (TanStack Query-based, typed tool-event-driven)
- `useProjectStateMd` → `useProjectStateMd(sessionId)` (TanStack Query with FSEvents cache writes)
- `useSessionPaneActivity` → not needed; ground truth is the xterm.js terminal itself

Component-level code that consumes these hooks keeps its shape; the hook internals are ground-up.

---

## §5 — Real-time pipeline: OSC 133 + typed event bus + FSEvents

### 5.1 — Decision

Three distinct real-time signal sources, each handled by a dedicated pipeline:

1. **pty output stream** — every byte Claude Code writes, observed directly. Piped to xterm.js for rendering + parsed for OSC 133 markers for state derivation.
2. **Claude Code event stream** — Claude Code's JSONL log for structured tool events, assistant messages, tool results. File-watched via FSEvents (macOS native), parsed into typed event union.
3. **Filesystem changes** — STATE.md updates, project directory scans. FSEvents native, no chokidar.

All three feed the typed event bus (same pattern as web Commander's `server/src/ws/event-bus.ts` but re-implemented with stricter typing).

### 5.2 — OSC 133 strategy

OSC 133 is the ANSI escape sequence convention for shell integration. Shell emits:

- `OSC 133 ; A ST` — PromptStart (before prompt printed)
- `OSC 133 ; B ST` — CommandStart (after user hits Enter)
- `OSC 133 ; C ST` — CommandEnd (command finished, exit code follows)
- `OSC 133 ; D ; <exit-code> ST` — CommandExit

V1 injects a zsh shell integration hook at session spawn (not modifying user's `.zshrc`), adding OSC 133 markers around every command. xterm.js (via addon or custom parser) emits typed events when markers are encountered:

- `command:started` with `{ sessionId, timestamp }`
- `command:ended` with `{ sessionId, exitCode, durationMs, timestamp }`

The state machine consumes these events directly. No pane-regex classification. No polling.

Claude Code runs inside this shell (spawned via `/bin/zsh -c 'claude ...'`). Claude Code's own turns emit as shell commands — each tool invocation Claude Code makes runs as a child process, so OSC 133 markers frame every tool execution naturally.

### 5.3 — Claude Code event stream

Claude Code writes a JSONL transcript to `~/.claude/sessions/<session-id>/messages.jsonl` (path verified per actual Claude Code version). V1 watches this file via FSEvents. New lines are parsed into typed events:

- `user_message`
- `assistant_message`
- `tool_use` (with tool-specific typed payload — Read, Edit, Write, Bash, Grep, Glob, Agent, Task, etc.)
- `tool_result` (keyed by `tool_use_id`)
- `thinking_block`
- `system_event` (compact, api_error, task_reminder, skill_listing, etc.)

Each typed event dispatches to the renderer registry (§11) for UI rendering, and to the state machine for status transitions.

### 5.4 — FSEvents + watcher discipline

macOS FSEvents via `tauri-plugin-fs` (Tauri v2's fs plugin; previous drafts cited `tauri-plugin-fs-watch` which is a v1-only crate — corrected in v1.3 per N1 deviation D5). Watches:

- Each active session's JSONL transcript file
- Each active project's `STATE.md` + `DECISIONS.md` + `PROJECT_DOCUMENTATION.md` + `CLAUDE.md`
- The `~/Desktop/Projects/` directory for new-project detection

No chokidar. No polling. Crash recovery: if FSEvents connection drops, sidecar auto-reconnects and emits a `watcher:reset` event so UI can force-refresh affected surfaces.

### 5.5 — Event bus typing

Event bus is a typed discriminated union. Every event has:

- `type` (string literal, e.g., `'session:status'`, `'command:started'`, `'project:state-md-updated'`)
- `sessionId` (optional, required for session-scoped events, absent for global events)
- `timestamp` (Unix epoch ms)
- Event-specific typed payload

No generic `unknown` payloads. No untyped catch-alls. Schema lives in `packages/shared/src/events.ts` as a single source of truth consumed by both sidecar and React client.

### 5.6 — Per-session channel isolation

Events with `sessionId` are delivered only to subscribers that registered for that session. Enforced at the WebSocket layer (per-session channels, per-subscription filter by sessionId). Structural: cross-session leakage requires bypassing the channel system, which TypeScript prevents at subscription registration.

Candidate 19 (ESC cross-pane) and Candidate 36 (effort display leak) — the class — is eliminated here by construction. Every action dispatch includes sessionId; every subscription filter includes sessionId. No shared channels.

---

## §6 — Terminal layer: xterm.js + @xterm/addon-webgl + node-pty

### 6.1 — Decision

Terminal rendering is a real xterm.js instance per session, attached via node-pty to a spawned shell process (zsh on macOS). @xterm/addon-webgl renders via GPU.

No tmux. No capture-pane. No text-tail approximation.

### 6.2 — Stack

- **node-pty** — native Node binding for PTY. Spawned per session in the sidecar.
- **xterm.js** — terminal emulator library rendering in the React frontend.
- **@xterm/addon-webgl** — GPU-accelerated rendering (60fps sustained under heavy output).
- **@xterm/addon-fit** — responsive terminal sizing.
- **@xterm/addon-search** — in-terminal search (Cmd+F in terminal pane).
- **@xterm/addon-serialize** — scrollback preservation for session restore.
- **Custom OSC 133 parser** — reads escape sequences from pty output, emits typed events to the event bus.

### 6.3 — Data flow

Sidecar spawns `pty = spawn('/bin/zsh', [...])` for each session. Sidecar writes to `pty.stdin` for commands. Reads from `pty.onData` for output. Data is streamed to React frontend via WebSocket as `pty:data` events (sessionId-scoped).

Frontend's xterm.js instance consumes `pty:data` via its `.write(data)` method. xterm.js handles all terminal emulation (ANSI parsing, cursor positioning, scrollback buffering, line wrapping, color rendering).

User input in the terminal pane: xterm.js's `onData` handler posts input to sidecar via WebSocket as `pty:input`. Sidecar writes to `pty.stdin`.

OSC 133 markers: sidecar's pty output handler scans for `ESC ] 133 ; [ABCD] ST` sequences before forwarding to frontend. On match, emits typed `command:*` event to the event bus. xterm.js receives the raw data regardless (markers are invisible to xterm.js rendering).

### 6.4 — Latency characteristics

- Keystroke → pty write: ≤30ms (WebSocket round-trip on localhost)
- pty output → xterm.js render: ≤50ms end-to-end
- OSC 133 event → state machine update: ≤10ms (in-sidecar)
- State machine → ContextBar UI: ≤20ms (TanStack Query cache write triggers re-render)

Total ground-truth latency from Claude Code action to UI reflection: ≤100ms typical. Compare to web Commander's tmux-capture polling: 1500-3000ms.

### 6.5 — Per-pane instance isolation

Each session's terminal is a separate xterm.js instance in its own React component tree. No shared buffers. No shared scrollback. Mirror-side bugs (Candidate 36 class) are structurally impossible because there is no mirror — the terminal *is* the rendering surface.

### 6.6 — Shell spawn details

V1 spawns sessions like this (pseudocode):

```ts
const pty = nodePty.spawn('/bin/zsh', [
  '-c',
  `source /path/to/osc133-hook.sh && claude ${bootstrapFlags}`
], {
  name: 'xterm-256color',
  cwd: resolveSessionCwd(project),
  env: { ...process.env, JSTUDIO_SESSION_ID: sessionId },
});
```

The OSC 133 hook script (`osc133-hook.sh`) is a small zsh integration that adds `precmd` and `preexec` hooks emitting OSC 133 markers. Bundled with v1. Not written to user's `~/.zshrc` — sourced per-session via `-c`.

Bootstrap injection for PM/Coder sessions happens *after* pty is live: first pty write is the bootstrap file contents. Raw sessions skip bootstrap injection per OS §23.3 invariants.

### 6.7 — Scrollback and persistence

Each session maintains up to N lines of scrollback in xterm.js memory (configurable, default 10,000). On session close, scrollback is serialized and stored in SQLite (`session_events` table as a compressed blob). On session resume, scrollback restored via `@xterm/addon-serialize`.

Scrollback is NOT part of the assistant-event stream. The JSONL transcript (parsed separately per §5.3) is the canonical message log; terminal scrollback is raw pty output.

---

## §7 — IPC contracts: Tauri IPC + WebSocket + HTTP

### 7.1 — Decision

Three communication layers, each scoped to its purpose:

- **Tauri IPC** (Rust ↔ React frontend) — for OS integrations only. Native notifications, tray actions, menu events, global shortcut triggers, FSEvents subscriptions, window state changes, quit-confirmation dialogs.
- **WebSocket** (Sidecar ↔ React frontend) — for real-time streaming. pty data, session events, tool events, status updates, chat messages, file-watcher triggers.
- **HTTP** (Sidecar ↔ React frontend) — for request/response queries. Session CRUD, preferences CRUD, project metadata queries, cost analytics queries, history fetches.

Frontend does not talk to Rust for session work; sidecar handles session lifecycle. Frontend talks to sidecar via WS/HTTP. Rust is OS bridge only.

### 7.2 — Tauri IPC surface (Rust → Frontend)

Defined via `#[tauri::command]` functions. Minimal, OS-specific:

- `notify_native(title, body, action)` — native macOS notification
- `set_tray_badge(count)` — Dock badge update
- `register_shortcut(accelerator, callback_event_name)` — global shortcut
- `fs_watch_start(paths)` / `fs_watch_stop(subscription_id)` — FSEvents subscription
- `spotlight_index_update(project_paths)` — Spotlight integration
- `window_set_always_on_top(bool)` — window behavior
- `drag_drop_register()` — project folder drop handler
- `app_quit()` — coordinated shutdown (stops sidecar, persists workspace state)

Events emitted from Rust to Frontend (via Tauri's event system):

- `system:tray-action` (tray menu click)
- `system:menu-action` (native menu item click)
- `system:shortcut-triggered`
- `system:fs-event` (normalized FSEvents notification)
- `system:drop-received` (folder dropped on app)

All IPC is typed via TypeScript definitions that mirror Rust signatures (generated or hand-maintained; v1 starts hand-maintained for tight control).

### 7.3 — WebSocket surface (Sidecar ↔ Frontend)

Single WS connection per client. Multiplexed channels:

- `global` — app-wide events (system:stats, system:rate-limits, tunnel:*)
- `session:<id>` — per-session events (chat, status, pty-data, tool-events)
- `project:<id>` — per-project events (state-md updates, new-session spawned)
- `workspace` — workspace state changes

Subscription model: frontend explicitly subscribes to channels it needs. Sidecar tracks subscriptions per connection. Events are delivered only to subscribed channels.

Event shape (exhaustive typed union, sketch):

```ts
type WsEvent =
  | { type: 'pty:data', sessionId: string, data: string, timestamp: number }
  | { type: 'command:started', sessionId: string, timestamp: number }
  | { type: 'command:ended', sessionId: string, exitCode: number, durationMs: number, timestamp: number }
  | { type: 'session:status', sessionId: string, status: SessionStatus, timestamp: number }
  | { type: 'tool:use', sessionId: string, toolUseId: string, tool: ToolEvent, timestamp: number }
  | { type: 'tool:result', sessionId: string, toolUseId: string, result: ToolResult, timestamp: number }
  | { type: 'approval:prompt', sessionId: string, prompt: ApprovalPrompt, timestamp: number }
  | { type: 'approval:resolved', sessionId: string, choice: ApprovalChoice, timestamp: number }
  | { type: 'thinking:started', sessionId: string, timestamp: number }
  | { type: 'thinking:ended', sessionId: string, durationMs: number, timestamp: number }
  | { type: 'system:error', sessionId?: string, error: SystemError, timestamp: number }
  | { type: 'session:cost-tick', sessionId: string, delta: CostDelta, timestamp: number }
  | { type: 'session:context-tick', sessionId: string, used: number, total: number, timestamp: number }
  | { type: 'project:state-md-updated', projectId: string, timestamp: number }
  | { type: 'project:new-detected', projectId: string, path: string, timestamp: number }
  | { type: 'workspace:layout-changed', workspaceId: string, timestamp: number }
  // Exhaustive — no catch-all
```

### 7.4 — HTTP surface (Sidecar ↔ Frontend)

REST-ish, consumed via TanStack Query. Endpoints:

- `GET /api/sessions` — list all sessions
- `GET /api/sessions/:id` — single session detail
- `POST /api/sessions` — create (triggers pty spawn)
- `PATCH /api/sessions/:id` — update (effort adjust, rename, etc.)
- `DELETE /api/sessions/:id` — stop + remove
- `POST /api/sessions/:id/command` — dispatch input (alternative to WS pty:input for some cases)
- `GET /api/projects` — list all JStudio projects from filesystem scan
- `GET /api/projects/:id/state-md` — initial fetch of STATE.md content
- `GET /api/cost/summary?range=7d` — cost analytics
- `GET /api/preferences/:key` — preference read
- `PUT /api/preferences/:key` — preference write
- `GET /api/workspaces/current` — current workspace layout
- `PUT /api/workspaces/current` — persist workspace layout
- `GET /api/health` — sidecar health (used by Rust for startup poll + periodic checks)

All endpoints typed via `packages/shared` definitions. TanStack Query wraps with caching and invalidation.

### 7.5 — Rationale for the three-layer split

WebSocket for streaming + HTTP for queries is standard; matches TanStack Query's stale-while-revalidate pattern cleanly. Tauri IPC is deliberately walled off to OS surface so sidecar can be replaced or debugged independently of Rust layer.

Contrast with a single-layer approach (everything over Tauri IPC, Rust as HTTP proxy): adds Rust scope for no benefit, couples sidecar to Tauri. Rejected.

Contrast with everything over HTTP (polling instead of streaming): adds latency, wastes bandwidth, loses real-time capability. Rejected.

---

## §8 — Sidecar process model: tauri-plugin-shell + crash recovery

### 8.1 — Decision

Sidecar (Fastify + Bun/Node) is spawned and managed by Rust via `tauri-plugin-shell`'s sidecar API. This gives:

- Automatic spawn on app launch
- Clean kill on app quit (no orphan processes)
- Crash detection via process exit code
- Automatic restart on crash (with backoff)
- Stdio log streaming to Rust for debugging
- Health check via sidecar-exposed `/api/health` endpoint

Attempt 1's raw `std::process::Command` approach is abandoned.

### 8.2 — Lifecycle

1. App launches → Rust checks for existing sidecar process lock at `~/.jstudio-commander-v1/sidecar.lock`. If present and PID is alive, attach; else proceed to spawn.
2. Rust spawns sidecar as child process with stdio piped. Captures PID to lock file.
3. Rust TCP-polls sidecar health endpoint (`GET /api/health`) until ready (typically <500ms).
4. **Rust opens WebviewWindow at Tauri's standard `frontendDist` (production) or `devUrl` (development).** Frontend discovers sidecar URL via `/api/health` probe at 11002..11011 on initial mount. `get_sidecar_url()` Tauri IPC command is implemented for non-default-port scenarios but unused in the default path. (Revised in v1.3 per N1 deviation D3 — previous drafts said "pointed at sidecar's HTTP server URL" which diverged orthogonally from Tauri v2 conventions. CODER's N1 implementation correctly aligned with convention; v1.3 folds the reality back into the spec.)
5. Sidecar reads config from env vars Rust sets at spawn (not shared JSON file — per Attempt 1 feedback).
6. On app quit (Cmd+Q, Dock quit, menu quit): Rust sends `SIGTERM` to sidecar, waits up to 5s for clean shutdown, then `SIGKILL` if needed. Removes lock file.

### 8.3 — Crash recovery

If sidecar exits unexpectedly:

1. Rust detects via process exit event.
2. Checks retry counter (resets every 60s of stable uptime).
3. If retries < 3 within 60s, restart sidecar with exponential backoff (1s, 3s, 9s).
4. If retries ≥ 3, surface user-visible error ("Sidecar crashed repeatedly, please restart Commander") and do not auto-restart.
5. On successful restart, frontend re-establishes WS + refetches TanStack Query cache.

### 8.4 — Single-instance enforcement

Only one Commander v1 instance runs at a time (per user). Enforced via:

- macOS app-level single-instance (Tauri supports via `tauri-plugin-single-instance`)
- Sidecar lock file on port + PID

Second-launch attempts focus the existing window rather than spawning a second instance.

### 8.5 — Port discovery

Sidecar binds to a port from a configured range (default: 11002). If the port is occupied, sidecar tries next port in range (11003, 11004, ...) up to 10 attempts. Final port is written to a known path (`~/.jstudio-commander-v1/runtime.json`) that Rust reads to build the WebviewWindow URL.

No user-configurable port in v1 (can be added later if needed).

---

## §8.5 — OS integrations: notifications, menu bar, tray, global shortcuts

V1 ships a full native integration surface. Not "native UI polish deferred to vNext" — this is part of v1 scope per ratified N5 inclusion.

### Dock + window

- App icon with badge showing active session count (red dot when any session needs attention: approval pending, error, idle-with-unread-response).
- Minimize to Dock; reopen restores window.
- Window state (position, size) persisted across launches via Tauri state plugin.

### Menu bar

Standard macOS menu structure:

- **Commander** — About, Preferences (Cmd+,), Services, Hide, Quit.
- **File** — New Session (Cmd+N), New Workspace, Open Project (Cmd+O), Import Session.
- **Edit** — standard Undo/Redo/Cut/Copy/Paste/Select All + Find in Terminal (Cmd+F in terminal pane).
- **View** — Toggle Sidebar (Cmd+\\), Toggle Terminal Drawer (Cmd+J), Toggle STATE.md Drawer (Cmd+Shift+S), Enter Split View, Cycle Focus (Cmd+Opt+→/←).
- **Session** — Stop (Cmd+.), Interrupt, Restart, Clone, Rename, Delete.
- **Window** — Minimize, Zoom, Bring All to Front, per-session window list.
- **Help** — Documentation, Release Notes, Report Issue.

### Tray (menu bar icon)

Small icon in macOS menu bar showing session count. Click opens mini-menu with:

- Active sessions list (click to focus window and select session)
- Quick actions (New Session, Pause All, Stop All)
- 5h budget indicator (green/yellow/red dot)
- Open Commander (brings main window forward)

### Global shortcuts

Configurable via Preferences. Defaults:

- **Cmd+Opt+C** — toggle Commander window visibility
- **Cmd+Shift+N** — open New Session modal from anywhere
- **Cmd+Shift+P** — open command palette (fuzzy search over sessions, projects, actions)
- **Cmd+Shift+Space** — focus ContextBar input on currently active session

### Native notifications

Triggered for:

- Approval prompt appears on non-focused session
- Session completes (long-running turn ends) when window is backgrounded
- Error events (system:error)
- Phase complete (if explicit `phase:complete` event emitted by user action or future automation)

Respects macOS Do Not Disturb. Appears in Notification Center. Click notification → focus Commander + select target session.

### Spotlight integration

Via macOS NSUserActivity / CSSearchableIndex (Tauri v2 support via custom bridge). Indexed items:

- Active project names ("JLP Family Office", "Elementti ERP", etc.)
- Recent session names

Searching Spotlight surfaces Commander as result; click opens Commander with that item selected.

### Drag-drop

Folder dropped on Dock icon or app window → spawn New Session modal pre-filled with that folder as project path.

---

## §9 — Feature-to-primitive mapping

Every feature from Deliverable 1, mapped to the primitives that implement it. Use this table when drafting phase dispatches — every feature should cite its primitive backing.

| Feature (from D1) | Primary primitives | Secondary primitives | Bug class eliminated |
|---|---|---|---|
| §1.1 Session spawning | Tauri window, sidecar HTTP POST /sessions, node-pty | Tauri IPC for modal | — |
| §1.2 Session types (PM/Coder/Raw) | Extensible session type registry (not enum) | bootstrap injection path lookup | — |
| §1.3 Effort level | SQLite sessions.effort column, sidecar HTTP PATCH | Zustand for local UI state of modal | C36 eliminated via §1.2 registry + per-pane isolation |
| §1.4 Bootstrap injection | Sidecar spawn-time pty write (first byte sequence) | fs.readFile for bootstrap content | — |
| §1.5 Session cwd resolution | resolveSessionCwd helper (preserved from web) | node-pty cwd option | — |
| §1.6 Parent/teammate | SQLite sessions.parent_session_id FK | UI tree rendering in Sidebar | — |
| §1.7 Session lifecycle (status) | OSC 133 events + tool-event stream + typed state machine | No pane-regex classifier, no derivation | Entire Phase Y ceiling class |
| §1.8 Synthetic-id reconciliation | First-hook reconciliation, sidecar-side | SQLite sessions.claude_session_id | — |
| §2.1 Terminal spawn + attach | node-pty, xterm.js, WebSocket pty:data events | tauri-plugin-shell for sidecar lifecycle | Tmux shell-out latency eliminated |
| §2.2 Terminal input | xterm.js onData → WS pty:input → pty.stdin | — | Tmux send-keys latency eliminated |
| §2.3 OSC 133 shell integration | Bundled osc133-hook.sh, xterm.js addon or custom parser, typed command:* events | — | All pane-regex classification |
| §3.1 Typed event bus | Exhaustive typed union in packages/shared/events.ts | Sidecar-side EventEmitter, WS channels | — |
| §3.2 File watchers | tauri-plugin-fs-watch (FSEvents native) | TanStack cache invalidation on file change | Chokidar polling latency |
| §3.3 Per-session isolation | Per-session WS channel, per-session xterm.js instance, per-session React subtree | Required sessionId on every hook signature | C19, C36 whole class |
| §4.1 Status + action label | Typed state machine from OSC 133 + tool events | ContextBar reads Zustand selector | Phase Y ceiling |
| §4.2 Effort indicator + dropdown | TanStack Query (sessions by id), sidecar PATCH | shared helper between SessionCard + ContextBar | — |
| §4.3 Stop button | xterm.js signal to pty (Cmd+. / Ctrl+C write to stdin) | pty isActivelyProducingOutput state | Pre-Finalizer invisibility |
| §4.4 Token + cost + context-window | SQLite session_events + cost_entries, TanStack Query | contextBands helper | Stats divergence fixed via unified schema |
| §4.5 Teammate count | SQLite query joining parent_session_id | ContextBar selector | — |
| §4.6 Manual refresh | TanStack Query refetch | — | Mostly vestigial in v1 |
| §4.7 Approval modal (Item 3 sacred) | Typed approval:prompt event from JSONL watcher | PermissionPrompt component, Zustand for mount state | Pane-regex approval detection |
| §5.1 Message grouping | Plain React logic, same as web Commander | — | — |
| §5.2 Tool chip rendering | Renderer registry (§11) exhaustive typed union | React components per tool type | C29/35/40 whole class |
| §5.3 Markdown rendering | remark-gfm + rehype-highlight + @tailwindcss/typography | ReactMarkdown | C30 full parity |
| §5.4 Inline reminder + attachments | Renderer registry for system_event subtypes | Typed union exhaustive | C29/35/40 whole class |
| §5.5 In-thread approval | Same as §4.7 but inline variant | PermissionPrompt reused | — |
| §5.6 LiveActivityRow | typed thinking:started / thinking:ended events | Component with elapsed timer | C42 eliminated via typed events not shape scan |
| §5.7 Scroll anchor | React effect on message count, C39 user-sent override preserved | — | — |
| §5.8 Compact-boundary rendering | typed compact_boundary system_event | Inline divider component | — |
| §6.1 Terminal pane per session | xterm.js + @xterm/addon-webgl + @xterm/addon-fit | Per-pane React instance | C36 display leak structurally eliminated |
| §6.2 Terminal input (direct) | xterm.js onData | Already covered in §2.2 | — |
| §7.1 Live STATE.md view | tauri-plugin-fs-watch + TanStack Query cache write | Markdown renderer | — |
| §7.2 Project metadata display | SQLite project_metadata + filesystem scan | Project view component | — |
| §8.1 Split view | Multiple independent pane components | Workspace schema with pane tree | C19 + C36 class |
| §8.2 Workspace persistence | SQLite workspaces + workspace_panes tables | Tauri window state | — |
| §9.1 SessionCard | React component reading TanStack Query | effortCard helper | — |
| §9.2 CreateSessionModal | Tauri IPC for shortcut, Zustand for modal state | HTTP POST /sessions | — |
| §9.3 Sidebar | React component + Zustand filter state | TanStack Query session list | — |
| §9.4 Project view | New route, TanStack Query projects list, filesystem scan | Project card component | — |
| §10.1 SQLite database | better-sqlite3 + Drizzle ORM | Fresh v1 schema (§10) | C26 retention class |
| §10.2 usePreference pattern | Typed Zustand store or TanStack Query for per-key prefs | SQLite preferences table | Phase T hotfix class |
| §10.3 Cost telemetry | SQLite cost_entries (single source of truth) | TanStack Query analytics view | Stats divergence |
| §11.1 PM/Coder bootstrap loading | Sidecar reads file at spawn, first pty write | Bootstrap file watch for hot-reload | — |
| §11.2 Standards + OS reference | File paths in jstudio-meta, referenced by dispatches | — | — |
| §11.3 Slash command hot-reload | fs-watch on bootstrap file, session API for re-inject | UI button | — |
| §12.1 Three-role unified UI | Zustand store for three panes, source attribution | SQLite three_role_links table | Manual-bridge preservation in UI |
| §12.2 Context inheritance | three_role_links table, TanStack Query graph | Navigation UI | — |
| §12.3 Clipboard routing safety | Tauri IPC clipboard API + manual trigger only | No auto-dispatch | Manual-bridge invariant |
| **§14.1 Named workspaces** (PM v1.2 fold) | SQLite `workspaces` + `workspace_panes`; Zustand for active-workspace state; Cmd+Shift+W switcher | TanStack Query for workspace list | — |
| **§14.1 Command palette** (PM v1.2 fold, §16.7) | Zustand visibility state; `fuse.js` (or similar) fuzzy search; TanStack Query for searchable data sources (sessions, projects, actions) | Global Cmd+Shift+P shortcut via Tauri IPC | — |
| **§14.1 Pre-warm session pool** (PM v1.2 fold, §16.4) | Sidecar-managed pty pool; preferences key for pool size | HTTP POST /sessions claims pre-warmed pty when available | Cold-spawn latency class |
| **§14.1 Scrollback preservation** (PM v1.2 fold, §16.6) | `@xterm/addon-serialize` serialize on session close; `sessions.scrollbackBlob` storage (5MB cap per session); deserialize on resume | — | Session continuity loss on restart |
| **§14.1 5h/7d budget real-time metrics** (PM v1.2 fold, §16.3) | Derived query on `cost_entries` with rolling time windows; TanStack Query stale-while-revalidate | Colored band per OS §20.RL thresholds | Rate-limit-surprise class |
| **§14.1 Tauri auto-updater** (PM v1.2 fold, §16.9) | `tauri-plugin-updater`; signed updates via Apple Developer cert; user-initiated install | GitHub releases endpoint (or self-hosted) | — |

---

## §10 — Drizzle schema (first pass)

Schema declared in TypeScript via Drizzle, migrations auto-generated + reviewed. This is a first-pass draft — PM may fold amendments during review.

```ts
import { sqliteTable, text, integer, real, blob, primaryKey, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// Core: projects + sessions
// ============================================================

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  type: text('type', { enum: ['erp', 'landing', 'dashboard', 'redesign', 'bundle', 'licitaciones', 'other'] }).notNull(),
  client: text('client'),
  lastStateMdMtime: integer('last_state_md_mtime'), // Unix ms
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  pathIdx: index('idx_projects_path').on(table.path),
}));

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // UUID
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sessionTypeId: text('session_type_id').notNull().references(() => sessionTypes.id), // Extensible registry (§11.x in requirements)
  effort: text('effort', { enum: ['low', 'medium', 'high', 'xhigh'] }).notNull(),
  parentSessionId: text('parent_session_id').references(() => sessions.id, { onDelete: 'set null' }),
  claudeSessionId: text('claude_session_id'), // Claude Code's own session id (JSONL path key)
  displayName: text('display_name'),
  status: text('status', { enum: ['active', 'working', 'waiting', 'idle', 'stopped', 'error'] }).notNull().default('active'),
  cwd: text('cwd').notNull(),
  ptyPid: integer('pty_pid'),
  scrollbackBlob: blob('scrollback_blob'), // xterm.js serialized scrollback on close
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
}, (table) => ({
  projectIdx: index('idx_sessions_project').on(table.projectId),
  parentIdx: index('idx_sessions_parent').on(table.parentSessionId),
  claudeIdx: index('idx_sessions_claude').on(table.claudeSessionId),
  statusIdx: index('idx_sessions_status').on(table.status),
}));

// ============================================================
// Extensible session type registry (§1.5 principle — multi-AI preserved)
// ============================================================

export const sessionTypes = sqliteTable('session_types', {
  id: text('id').primaryKey(), // 'pm', 'coder', 'raw', future: 'coder-gpt', 'coder-gemini', etc.
  label: text('label').notNull(),
  bootstrapPath: text('bootstrap_path'), // nullable for raw types
  effortDefault: text('effort_default', { enum: ['low', 'medium', 'high', 'xhigh'] }).notNull(),
  clientBinary: text('client_binary').notNull().default('claude'), // 'claude', future: 'codex', 'cursor', 'aider'
  spawnArgs: text('spawn_args'), // JSON array of CLI args
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
// Seeded at first run with: pm, coder, raw.

// ============================================================
// Real-time events + scrollback
// ============================================================

export const sessionEvents = sqliteTable('session_events', {
  id: text('id').primaryKey(), // UUID
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), // matches WsEvent.type literals
  payload: text('payload').notNull(), // JSON
  timestamp: integer('timestamp').notNull(), // Unix ms
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  sessionIdx: index('idx_session_events_session').on(table.sessionId),
  timestampIdx: index('idx_session_events_timestamp').on(table.timestamp),
  typeIdx: index('idx_session_events_type').on(table.eventType),
  // PM v1.1→v1.2 fold: composite index for per-session-per-type common queries
  // (e.g. "all tool_use events for session X"). Load-bearing for analytics
  // page (v1.1) and command-palette recent-commands (v1 §16.7).
  sessionTypeIdx: index('idx_session_events_session_type').on(table.sessionId, table.eventType),
}));
// Retention: age out after 30 days via scheduled cleanup.
// PM v1.1→v1.2 fold: retention enforcement is a Bun scheduled task running daily.
// Reads retention_days preference (default 30); deletes rows where
// timestamp < now - (retention_days * 86400 * 1000). cost_entries retained
// indefinitely for historical analytics (cheap, queryable).

// PM v1.1→v1.2 fold: FTS5 virtual table for full-text search across event payloads.
// Enables "what did I do last Tuesday" queries across historical transcripts,
// tool inputs, error messages. Load-bearing for v1.1 analytics drill-down and
// the v1 command palette (§16.7) recent-commands per session.
// Declared via raw migration SQL (Drizzle SQLite DSL doesn't have a first-class
// FTS5 helper as of 2026-04):
//   CREATE VIRTUAL TABLE session_events_fts USING fts5(
//     id UNINDEXED, session_id UNINDEXED, event_type, payload,
//     content='session_events', content_rowid='rowid', tokenize='porter unicode61'
//   );
// Sync triggers (insert / update / delete on session_events → mirror to FTS5)
// belong in the same migration SQL file. Retention cleanup is a single
// DELETE from session_events; FTS5 syncs via triggers.

// ============================================================
// Cost telemetry (single source of truth)
// ============================================================

export const costEntries = sqliteTable('cost_entries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  model: text('model').notNull(), // 'claude-opus-4-7', etc.
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  thinkingTokens: integer('thinking_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull(), // NUMERIC as REAL
  turnIndex: integer('turn_index').notNull(),
  timestamp: integer('timestamp').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  sessionIdx: index('idx_cost_session').on(table.sessionId),
  timestampIdx: index('idx_cost_timestamp').on(table.timestamp),
  uniqueTurn: index('uidx_cost_session_turn').on(table.sessionId, table.turnIndex), // prevents C26-class duplicates
}));

// ============================================================
// Tool events (for renderer registry)
// ============================================================

export const toolEvents = sqliteTable('tool_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  toolUseId: text('tool_use_id').notNull(),
  toolName: text('tool_name').notNull(),
  toolInput: text('tool_input').notNull(), // JSON
  toolResult: text('tool_result'), // JSON, nullable until resolved
  status: text('status', { enum: ['pending', 'complete', 'error'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
}, (table) => ({
  sessionIdx: index('idx_tool_events_session').on(table.sessionId),
  toolUseIdx: index('idx_tool_events_use_id').on(table.toolUseId),
}));

// ============================================================
// Approval prompts (Item 3 sacred)
// ============================================================

export const approvalPrompts = sqliteTable('approval_prompts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  toolUseId: text('tool_use_id').notNull(),
  promptPayload: text('prompt_payload').notNull(), // JSON
  resolution: text('resolution', { enum: ['allow', 'deny', 'custom', 'pending'] }).notNull().default('pending'),
  resolvedAt: integer('resolved_at'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ============================================================
// Preferences (typed)
// ============================================================

export const preferences = sqliteTable('preferences', {
  key: text('key').primaryKey(), // 'theme', 'terminal.drawer.height', 'contextbar.compact', etc.
  value: text('value').notNull(), // JSON
  scope: text('scope', { enum: ['global', 'session', 'project'] }).notNull().default('global'),
  scopeId: text('scope_id'), // sessionId or projectId when scope != 'global'
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  scopeIdx: index('idx_preferences_scope').on(table.scope, table.scopeId),
}));

// ============================================================
// Workspaces (§8.2 workspace persistence)
// ============================================================

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // 'default', 'morning work', 'client-X audit', etc.
  layoutJson: text('layout_json').notNull(), // JSON describing pane tree — supports 2 panes in v1, N panes future
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const workspacePanes = sqliteTable('workspace_panes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  paneIndex: integer('pane_index').notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  drawerStates: text('drawer_states').notNull().default('{}'), // JSON: {terminal: true, stateMd: false}
  sizes: text('sizes').notNull().default('{}'), // JSON: {terminal: 280, stateMd: 320}
}, (table) => ({
  workspaceIdx: index('idx_workspace_panes_ws').on(table.workspaceId),
  // PM v1.1→v1.2 fold: UNIQUE constraint on (workspaceId, paneIndex) prevents
  // duplicate pane slots in the same workspace — structural guarantee
  // (applying the C26 lesson about missing UNIQUE constraints proactively).
  uniqueWsPaneIndex: index('uidx_workspace_pane_slot').on(table.workspaceId, table.paneIndex),
}));

// ============================================================
// Three-role UI routing graph (§12 of requirements)
// ============================================================

export const threeRoleLinks = sqliteTable('three_role_links', {
  id: text('id').primaryKey(),
  linkType: text('link_type', { enum: ['cto_brief_to_pm_dispatch', 'pm_dispatch_to_coder_report', 'coder_report_to_pm_synthesis'] }).notNull(),
  sourceRef: text('source_ref').notNull(), // opaque pane-document id or session id
  targetRef: text('target_ref').notNull(),
  metadata: text('metadata'), // JSON: summary text, timestamps, commit refs
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => ({
  sourceIdx: index('idx_three_role_source').on(table.sourceRef),
  targetIdx: index('idx_three_role_target').on(table.targetRef),
}));
```

PM amendments folded in v1.1 (re-applied in v1.2 after merge overwrite):

- **FTS5 virtual table** for `session_events.payload` full-text search — declared in migration SQL (Drizzle doesn't expose FTS5 as a first-class helper). Triggers keep FTS5 synced on insert/update/delete. Load-bearing for v1.1 analytics drill-down + v1 command palette recent-commands.
- **Composite index** `(sessionId, eventType)` for per-session-per-type queries (`idx_session_events_session_type`).
- **UNIQUE constraint** on `workspace_panes(workspaceId, paneIndex)` (`uidx_workspace_pane_slot`) — structural guarantee applying the C26 lesson proactively.
- **Retention enforcement** documented inline: Bun scheduled daily task; session_events 30d default (configurable via `retention_days` preference), cost_entries indefinite.
- **`updatedAt` triggers** — Drizzle generates via `integer('updated_at', { mode: 'timestamp_ms' })` schema convention; N1 dispatch verifies trigger generation during migration review.
- **Partial index** on sessions `WHERE status != 'stopped'` — flagged for raw migration SQL since Drizzle SQLite DSL doesn't cleanly express partial indexes in the schema DSL itself.

Additional amendment considered but NOT folded:

- Splitting high-value queryable fields (e.g. `user_message_text`, `assistant_message_text`, `tool_name`) out of `sessionEvents.payload` into dedicated columns for faster filtered queries without JSON extraction. Deferred: v1 query volumes are modest (single-user, local), SQLite's `json_extract()` is fast enough. Revisit in v2 if analytics queries grow heavy.

---

## §11 — Renderer registry (typed)

### 11.1 — Contract

Renderer registry is a compile-time exhaustive typed union. Every Claude Code event-type has exactly one registered renderer. Unknown types fall through to an `UnmappedEventChip` renderer that displays the raw payload and logs a warning to the event bus.

Structurally prevents C29, C30, C35, C40 bug class: silent drop of unmapped events.

### 11.2 — Shape

```ts
// packages/shared/src/renderer-registry.ts

// PM v1.1→v1.2 fold — hierarchical model (system_event super-type with typed subtypes):
// Previous draft had task_reminder / api_error / skill_listing / invoked_skills /
// queued_command listed as both top-level ClaudeEventType AND as SystemEventSubtype.
// Resolved to hierarchical (system_event top-level, subtypes discriminated) because:
//   (a) Claude Code writes these as system-origin events in JSONL, not as peers of tool_use.
//   (b) System subtypes grow faster than top-level event shapes — hierarchical scales.
//   (c) system_event dispatcher routes to subtype renderers, keeping top-level registry
//       entry count bounded and new-subtype additions localized to SystemEventSubtype
//       + dispatcher.

// The exhaustive union of renderable top-level event types
export type ClaudeEventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'thinking_block'
  | 'system_event'          // super-type; subtypes below
  | 'compact_boundary'
  | 'compact_summary'
  | 'approval_prompt'
  | 'edited_text_file'
  | 'file_attachment'
  | 'compact_file_ref';
// (Exhaustive. Adding a new type forces touching this union and the registry.)

// Exhaustive subtypes of 'system_event' — dispatched via SystemEventDispatcher.
export type SystemEventSubtype =
  | 'compact'
  | 'api_error'
  | 'task_reminder'
  | 'skill_listing'
  | 'invoked_skills'
  | 'queued_command';

export type ToolName =
  | 'Read'
  | 'Edit'
  | 'Write'
  | 'Bash'
  | 'BashOutput'           // PM v1.1→v1.2 fold: added per current Claude Code tool surface
  | 'KillShell'            // PM v1.1→v1.2 fold: added
  | 'Grep'
  | 'Glob'
  | 'Agent'
  | 'Task'
  | 'TodoWrite'
  | 'NotebookEdit'         // PM v1.1→v1.2 fold: added
  | 'ExitPlanMode'         // PM v1.1→v1.2 fold: added
  | 'Skill'                // PM v1.1→v1.2 fold: added (slash-command skill invocation)
  | 'WebFetch'
  | 'WebSearch';
// (Exhaustive. Claude Code adds a tool → this union is updated + new renderer registered.)

// Renderer registration
import { ComponentType } from 'react';

export interface RendererProps<TPayload> {
  sessionId: string;
  event: { type: ClaudeEventType; payload: TPayload; timestamp: number };
}

type RendererMap = {
  user_message: ComponentType<RendererProps<UserMessagePayload>>;
  assistant_message: ComponentType<RendererProps<AssistantMessagePayload>>;
  tool_use: ComponentType<RendererProps<ToolUsePayload>>;
  tool_result: ComponentType<RendererProps<ToolResultPayload>>;
  thinking_block: ComponentType<RendererProps<ThinkingBlockPayload>>;
  system_event: ComponentType<RendererProps<SystemEventPayload>>; // dispatcher
  compact_boundary: ComponentType<RendererProps<CompactBoundaryPayload>>;
  compact_summary: ComponentType<RendererProps<CompactSummaryPayload>>;
  approval_prompt: ComponentType<RendererProps<ApprovalPromptPayload>>;
  edited_text_file: ComponentType<RendererProps<EditedTextFilePayload>>;
  file_attachment: ComponentType<RendererProps<FileAttachmentPayload>>;
  compact_file_ref: ComponentType<RendererProps<CompactFileRefPayload>>;
};

// System_event sub-registry — dispatcher maps subtype → renderer.
type SystemEventRendererMap = {
  compact: ComponentType<RendererProps<CompactSystemPayload>>;
  api_error: ComponentType<RendererProps<ApiErrorPayload>>;
  task_reminder: ComponentType<RendererProps<TaskReminderPayload>>;
  skill_listing: ComponentType<RendererProps<SkillListingPayload>>;
  invoked_skills: ComponentType<RendererProps<InvokedSkillsPayload>>;
  queued_command: ComponentType<RendererProps<QueuedCommandPayload>>;
};

// TypeScript enforces exhaustiveness: omitting any key is a compile error.
export const RENDERER_REGISTRY: RendererMap = {
  user_message: UserMessageRenderer,
  assistant_message: AssistantMessageRenderer,
  tool_use: ToolUseRenderer,
  tool_result: ToolResultRenderer,
  thinking_block: ThinkingBlockRenderer,
  system_event: SystemEventDispatcher, // routes to subtype renderers via SYSTEM_EVENT_REGISTRY
  compact_boundary: CompactBoundaryRenderer,
  compact_summary: CompactSummaryRenderer,
  approval_prompt: ApprovalPromptRenderer, // Item 3 sacred path
  edited_text_file: EditedTextFileRenderer,
  file_attachment: FileAttachmentRenderer,
  compact_file_ref: CompactFileRefRenderer,
};

export const SYSTEM_EVENT_REGISTRY: SystemEventRendererMap = {
  compact: CompactSystemRenderer,
  api_error: ApiErrorRenderer,
  task_reminder: InlineReminderNoteRenderer,
  skill_listing: SkillListingRenderer,
  invoked_skills: InvokedSkillsRenderer,
  queued_command: QueuedCommandRenderer,
};

// Fallback: if a new type appears that isn't in the union, dispatcher renders UnmappedEventChip.
// Will fail TypeScript at the dispatcher entry point if a new ClaudeEventType is added without a registry entry.
```

### 11.3 — ToolUse dispatcher

ToolUse is a super-type. The `ToolUseRenderer` dispatches to per-tool renderers:

```ts
const TOOL_RENDERERS: Record<ToolName, ComponentType<ToolRendererProps>> = {
  Read: ReadToolChip,
  Edit: EditToolChip,
  Write: WriteToolChip,
  Bash: BashToolChip,
  BashOutput: BashOutputToolChip,       // PM v1.1→v1.2 fold
  KillShell: KillShellToolChip,         // PM v1.1→v1.2 fold
  Grep: GrepToolChip,
  Glob: GlobToolChip,
  Agent: AgentToolCard, // richer card, subagent trees
  Task: TaskToolCard, // plan/task breakdowns
  TodoWrite: TodoWriteCard,
  NotebookEdit: NotebookEditToolChip,   // PM v1.1→v1.2 fold
  ExitPlanMode: ExitPlanModeToolChip,   // PM v1.1→v1.2 fold (plan-mode exit + summary)
  Skill: SkillToolChip,                 // PM v1.1→v1.2 fold (slash-command skill invocation)
  WebFetch: WebFetchToolChip,
  WebSearch: WebSearchToolChip,
};

function ToolUseRenderer(props: RendererProps<ToolUsePayload>) {
  const Renderer = TOOL_RENDERERS[props.event.payload.toolName]
    ?? UnmappedToolChip;
  return <Renderer {...props} />;
}
```

Adding a new tool: (1) extend `ToolName` union, (2) register in `TOOL_RENDERERS`. TypeScript enforces both.

### 11.4 — Markdown parity

Assistant text and user message rendering both go through a shared markdown renderer:

```ts
// @tailwindcss/typography + remark-gfm + rehype-highlight + rehype-raw (for inline HTML)
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight, rehypeRaw]}
  components={{
    code: SyntaxHighlightedCode,
    a: ExternalLinkWrapper,
    table: ResponsiveTable,
    // ... override as needed
  }}
>
  {content}
</ReactMarkdown>
```

V1 acceptance criterion: visual parity with VSCode Claude sidebar render for identical source markdown. Test corpus: 50+ real Claude responses captured from Jose's actual use, diffed visually.

---

## §12 — Bug common-denominator elimination table

Table showing every bug class from the Phase Y arc + Commander candidate pipeline mapped to the primitive choice that eliminates it structurally in v1.

| Bug class / Candidate | Web Commander manifestation | V1 primitive elimination |
|---|---|---|
| Phase Y ceiling | `useChat.messages` doesn't surface in-progress content until turn-end; ContextBar status lags | Ground truth from pty + OSC 133. Status observed from source, not derived. |
| C19 ESC cross-pane | Global ESC handler leaked interrupts across panes | Per-session IPC channel + required sessionId on every handler signature |
| C22 plan widget over-match | Markdown-shape numbered list matched as plan | Typed tool_use event (TodoWrite) dispatches to TodoWriteCard; shape matching removed |
| C23 contextLimit runtime | `MODEL_CONTEXT_LIMITS` SSOT for new Claude models | Typed model registry, updated as Claude adds models |
| C26 session_ticks retention + UNIQUE | No unique constraint on (session_id, turn_index); `INSERT OR IGNORE` was no-op | `cost_entries` (renamed from session_ticks) has UNIQUE (sessionId, turnIndex) + retention policy |
| C27 synthetic-id reconciliation | Orphan-adopted sessions stuck with synthetic id | Preserved fix (already shipped): reconcile on first Claude Code event |
| C29/35/40 renderer-registry gaps | `task_reminder`, `api_error`, system subtypes rendered as fallback | Exhaustive typed registry, compile-time enforced. Unknown types render as labeled "unmapped" with raw payload visible, never silently dropped. |
| C30 markdown parity | Missing @tailwindcss/typography + rehype-highlight + remark-gfm | Full stack included in v1, visual parity tested against corpus |
| C32 activity missing | Pane-regex classifier lag on multi-step tool sequences | No pane-regex. OSC 133 + tool events drive status. |
| C33 60s stuck "Running command..." | Asymmetry between session.status (pane-regex) and sessionState.kind (typed) | No server-side string status. Typed state machine from ground-truth events. |
| C34 permission-mode selector | Net-new UI surface | Built natively with typed registry in v1 |
| C36 effort cross-session display leak | Phase T mirror display layer leaked across panes via shared WS channel | Per-session xterm.js instance. No mirror, no shared channel. Structurally impossible. |
| C37 stale-pane stderr | tmux-capture on deleted panes | No tmux. node-pty direct attach. |
| C39 scroll anchor | User-send override branch | Preserved (already-shipped) logic |
| C41 pending-local filter | Optimistic local UI filter gaps | TanStack Query optimistic updates + server reconcile |
| C42 liveThinking bleed | Post-text thinking scan included response content | Typed thinking:started / thinking:ended events. No scan. |
| C44 attachment tmux-relay residual | tmux send-keys didn't relay attachments | node-pty stdin write supports `@<path>` syntax directly. No relay layer. |
| C45 detectExistingCommander preflight miss | IPv4/IPv6 resolver race on localhost health probe | tauri-plugin-single-instance + deterministic lock file path |
| Pattern-matching discipline (OS §24) | Multiple manifestations of character-shape matches firing on unrelated content | Typed signals everywhere. Shape matching forbidden; compile-time detectable. |
| Shape-vs-source (plan widget, "Esc to cancel") | UI inferred from text shape | Structured event metadata always authoritative |
| Temporal gate stacking | POLL_INTERVAL + HOOK_YIELD + FORCE_IDLE + IDLE_GRACE composed into unreachable windows | Event-driven state machine. No timer-composed gates. |
| Context-accumulation degradation | CODER speculation-quality after ~15 rotations | N/A — architecture layer, not addressable by code. OS §20.LL-L11 + L12 + INVESTIGATION_DISCIPLINE handle. |
| Phase Y Class 1 (stuck composing on settled text) | Stability timer workaround on streamingAssistantId | No streamingAssistantId derivation. pty-end-of-output from OSC 133. |
| Phase Y Class 2 (legacy fallback leak) | resolveActionLabelForParallelRun workaround | No parallel derivation. Single source. |
| Phase Y Class 3 (typedIdleFreshKillSwitch suppression) | Codeman override at top of resolveEffectiveStatus | No resolveEffectiveStatus. Direct from state machine. |
| Two-source-of-truth cost stats | session_ticks.sum_cost_reported diverges from cost_entries.cost_usd | Single table (cost_entries), single query path. |

Every bug class above is either (a) structurally eliminated by a v1 primitive choice, or (b) an architectural layer (context-accumulation) handled by OS discipline, not code.

---

## §13 — What V1 deliberately does not carry forward

Reaffirming the deliberately-left-behind list from Deliverable 1 §13, with architectural rationale for each:

- **Phase Y transcript-authoritative derivation chain** — `useToolExecutionState`, `useCodemanDiffLogger`, codeman-diff.jsonl, debug.routes.ts, 15.3-arc legacy guards. All derived from upstream-laggy transcript pipeline. V1 observes ground truth from pty + OSC 133.
- **Phase T tmux-capture mirror** — `TmuxMirror.tsx`, `useSessionPaneActivity`, `session:pane-capture` WS channel, 1.5s polling. Capture-and-re-render pattern replaced by real xterm.js terminal.
- **Tmux infrastructure** — `tmux.service.ts`, `status-poller.service.ts`, pane-regex classifier, orphan-adoption path, case-collision guard script. node-pty direct attach replaces tmux entirely.
- **Server-side `session.status` string** — pane-regex-derived. V1 drives status from typed state machine fed by OSC 133 + tool events + pty exit.
- **N1 Attempt 1 Tauri wrapper scaffold** — preserved locally on Jose's machine as reference implementation. V1 rebuilds from scratch per CTO ratification 2026-04-22.

Additional architectural carry-forwards that are **preserved** (per migration v2 operating model):

- Manual-bridge invariant (OS §3.4, §14.1)
- CTO/PM/CODER role separation (OS §3.1-§3.3)
- Canonical 4-file project structure (CLAUDE.md, PROJECT_DOCUMENTATION.md, STATE.md, DECISIONS.md) (OS §6, §4 of Architecture v2)
- Session-type effort defaults (OS §18.2)
- Bootstrap injection invariant (OS §23.3)
- `resolveSessionCwd` SSOT rule (OS §23.3 Issue 10)
- Item 3 waiting passthrough (approval modal) (Commander Finalizer, §14.4 of requirements)
- Four critical bans relevant to v1 UI: no StrictMode, no Redux, no hardcoded hex, no Tailwind `dark:` (OS §15). **Zustand amendment per §16.1 ratified 2026-04-22** — permitted for pure client state, not server state. OS §15 update lands with retrospective per §16.1.
- Investigation discipline (§20.LL-L11, L12, INVESTIGATION_DISCIPLINE.md)
- Pattern-matching discipline (OS §24)
- **§20.LL-L13 — User plain-language reframe as architectural signal** (shipped 2026-04-22 `23f8012`). PM v1.1→v1.2 fold: explicit entry at parity with L11/L12. L13 is the operating-model principle that determined when to stop patching web Commander and rebuild — same test applies to any v1 architectural reframe during N1-N6.
- **§20.LL-L14 — Ground-truth signals beat derivation chains** (shipped 2026-04-22 `23f8012`). PM v1.1→v1.2 fold: explicit entry at parity. L14 is the load-bearing principle for §1.1, §5 real-time pipeline, §6 terminal layer. When future v1 scope tempts a new derivation chain, §13's explicit L14 listing forces the "is there a ground-truth channel?" check first.

---

## §14 — V1.0 scope boundary

### 14.1 — Explicitly IN v1

**Platform + runtime:**
- Tauri v2 native app with sidecar (Bun if verification passes, Node+pkg fallback)
- node-pty + xterm.js + @xterm/addon-webgl terminal per session
- OSC 133 shell integration via bundled hook, spawning `/bin/zsh` explicitly
- Typed state machine for session status (ground-truth driven)
- Fresh SQLite schema via Drizzle ORM (no migration from web Commander DB)
- Zustand (pure client state) + TanStack Query (server state) state discipline
- Exhaustive typed renderer registry (compile-time enforced)
- FSEvents file watching via Tauri plugin
- Per-session IPC isolation
- Pre-warm session pool (default 2 pty processes, configurable 0-5)

**Features (all of Deliverable 1 §1-§12):**
- All features from Deliverable 1
- Named workspaces with UI switcher (Cmd+Shift+W)
- Command palette (Cmd+Shift+P) with fuzzy search over sessions, projects, actions
- Scrollback preservation across app restarts (up to 5MB per session)
- Real-time metrics visible: 5h budget %, 7d budget %, per-session context-window %, per-session cost, daily total cost

**Native OS integrations (§8.5):**
- Dock badge with active session count
- Full menu bar (Commander / File / Edit / View / Session / Window / Help)
- Tray icon (macOS menu bar) with mini-menu
- Global shortcuts (Cmd+Opt+C, Cmd+Shift+N, Cmd+Shift+P, Cmd+Shift+Space)
- Native notifications for approvals + background errors
- Spotlight integration (projects + recent sessions indexed)
- Drag-drop project folder to spawn session

**Distribution:**
- Apple Developer cert + code signing
- Tauri auto-updater (user-initiated installs)
- macOS-only initially (v1 is macOS)

**Three-role UI (§12 of Deliverable 1, ratified v1 scope):**
- Brief-review pane, dispatch-compose pane, report-consumption pane
- Source attribution visible per pane ("from: CTO (Claude.ai)", "from: PM", "from: CODER")
- Manual-bridge invariant preserved — all inter-pane actions user-initiated

### 14.2 — Explicitly NOT in v1 (future scope preserved)

**Deferred to v1.1:**
- **Dedicated analytics page** — full per-model / per-project / per-session-type breakdowns, optimization insights, rate-limit consumption trends, export to markdown/CSV, filter + drill-down. V1 surfaces real-time metrics; v1.1 adds the dedicated page.

**Deferred to v2+:**
- Multi-AI terminal support (Codex, Cursor, Aider). Session type registry is extensible; v2+ adds rows + spawn logic. No schema or code refactor required.
- Workspace grids beyond 2-3 panes. Schema supports N panes; v1 UI limited to 2-3.
- Swarm orchestration (coordinated multi-agent, shared mailbox). Architecture doesn't foreclose.
- External distribution (sharing with team members / clients / as product). Cert + updater infrastructure in place; v2+ when desired.
- Cross-platform (Windows, Linux). Tauri supports natively; v1 is macOS-only. v2+ revisits.
- Kanban-style task board. Not scoped.
- Voice interface. Not scoped.
- Cloud sync / multi-device. Philosophically against the local-first premise.
- AI-agent auto-routing between panes. Violates manual-bridge invariant. Not considered.
- Telemetry + opt-in UI. Not applicable while v1 is single-user.

### 14.3 — Ratified decisions log

All open questions from v1.0 draft have been ratified as of 2026-04-22 (see §16 for decisions).

---

## §15 — Future-scope invariants

Architectural decisions that preserve specific future optionality:

| Future scope | Preserved by | Enforcement in v1 |
|---|---|---|
| Multi-AI terminals (Codex, Cursor, Aider) | Extensible session type registry (`sessionTypes` table, `clientBinary` column, `spawnArgs` column) | V1 seeds 3 rows (pm, coder, raw). Adding a new type in v2 is a SQL insert + new bootstrap file + registered spawn logic. No schema migration. No code refactor. |
| Workspace grids (2x2, 3x4, 4x4) | `workspaces.layoutJson` stores arbitrary pane tree structure | V1 renders 2-3 panes via hard-coded layout component; v2 renders N panes by reading layoutJson. Storage schema unchanged. |
| Swarm orchestration | IPC event bus supports multi-subscriber per session | V1 uses per-session channels with single frontend subscriber. V2 adds server-side agent coordinator subscribing to same channels. No IPC rewrite. |
| External distribution | Apple Developer cert acquired; Tauri updater integration | V1 single-user. V2+ enables auto-update, adds multi-user data isolation if needed. Cert already in place. |
| Cross-platform (Windows, Linux) | Tauri v2 cross-platform by default; no macOS-specific business logic in sidecar | V1 ships macOS only. V2 enables Windows + Linux builds by flipping build config. FSEvents → equivalent filesystem watch on other platforms (Tauri plugin handles). |
| Renderer registry extension | Typed union in packages/shared enforces exhaustiveness | Adding new Claude event-type = extend union + add registry entry. Compile-time error if missed. No refactor. |
| Markdown + codeblock plugin extension | remark/rehype plugin array is open | V1 ships core plugins. V2 adds diagram plugins, math plugins, etc., by array extension. No refactor. |

Every invariant above has a zero-refactor future extension path. If a future scope would require architectural rework, we've missed a hook.

---

## §16 — Ratified decisions (Jose, 2026-04-22)

All 10 previously-open questions have been ratified. This section captures the decisions and rationale for the record.

### 16.1 — Zustand permitted for pure client state (OS §15 amendment)

**Decision:** Zustand is permitted in v1 for pure client state (UI preferences, drawer states, workspace layout, per-pane view state, keyboard-shortcut registrations). OS §15 Critical Ban on "Redux, Zustand, MobX" is amended: Zustand is permitted for non-server state when used atomically. Server state remains exclusively TanStack Query.

**Rationale:** Context + hooks alone produced the Phase Y arc's ad-hoc state composition (`useChat` + `useSessionStateUpdatedAt` + `useToolExecutionState` + useEffect chains) that obscured data flow. One small, explicit library with disciplined scoping is cleaner than discipline alone across a 50+ component app. Zustand is 3KB, unopinionated, and serves the "typed global client state" role without Redux bureaucracy or MobX reactive magic.

**OS update required:** PM folds an §15 amendment into OPERATING_SYSTEM.md when the retrospective lands. Proposed language: *"No Redux, MobX. Zustand permitted for pure client state (non-server data, non-hooks-composable UI state). Context + hooks for data that fits their shape. Server state via TanStack Query, always."*

### 16.2 — Named workspaces in v1

**Decision:** V1 ships named workspaces. Schema supports it (`workspaces.name` column already in §10). UI surfaces a workspace switcher in the sidebar header or via Cmd+Shift+W. Default workspace is "default." Users can create/rename/delete workspaces.

**Rationale:** Incremental UI cost for significant usability benefit. Morning-work / client-X-audit / migration-work workspace separation is a real workflow Jose already does informally via tab management. Making it explicit and persistent is a small amount of code.

### 16.3 — Basic analytics in v1, dedicated analytics page in v1.1

**Decision:** V1 surfaces real-time metrics that Jose needs for daily operational awareness. V1.1 ships the full dedicated analytics page.

**V1 surfaces (real-time, always-visible):**
- 5-hour rolling budget % (top bar, colored band — green / yellow / orange / red per OS §20.RL thresholds)
- 7-day rolling budget % (top bar, smaller)
- Per-session context-window % (ContextBar, colored band per contextBands)
- Per-session token + cost counters (ContextBar)
- Daily total cost (tray icon + top bar summary)
- Per-session current cost (SessionCard + ContextBar)

**V1.1 dedicated analytics page:**
- Full cost analytics: per-model breakdown, per-project breakdown, per-session-type breakdown, 7-day/30-day trends
- Rate-limit consumption trends (5h peak tracking, 7d weekly pattern)
- Optimization insights: sessions consuming disproportionate cost, context-compaction timing quality, effort-level correlation with output volume
- Export to markdown/CSV
- Filter + drill-down on any dimension

**Rationale:** V1 needs the "am I about to hit rate limit?" signals immediately. Deep analytics is a whole UI surface worth dedicated design time in v1.1 once v1 is dogfooded and Jose's actual analytics needs crystallize.

### 16.4 — Pre-warm session pool in v1

**Decision:** V1 maintains a small pool of pre-warmed idle pty processes (default 2) for fast new-session spawn. Pool is managed by sidecar. When Jose spawns a new session, one pre-warmed pty is claimed + bootstrap injected + assigned; sidecar spawns a replacement in background.

**Rationale:** Jose confirmed "if we'll definitely need it later, do it now." Pre-warming cuts spawn latency from 1-2s to <500ms — the difference between "instant" and "waiting." Pool complexity is contained in sidecar; frontend is unaware. Adding it to v1 scope.

**Acceptance criterion:** Cold spawn (first after app launch) <2s; warm spawn (with pool available) <500ms. Pool size configurable via preferences (default 2, min 0 to disable, max 5).

### 16.5 — Bundle target ≤60 MB, stretch ≤30 MB

**Decision:** Ratified.

### 16.6 — Scrollback preserved across app restarts

**Decision:** Ratified. Each session's xterm.js scrollback is serialized via `@xterm/addon-serialize` to SQLite `sessions.scrollbackBlob` column on session close or app quit. Restored on session resume via `@xterm/addon-serialize` deserialize.

**Cost consideration:** A 10,000-line scrollback is ~500KB-1MB serialized; a session with heavy pty output accumulates multi-MB scrollback. Pragmatic cap: scrollback blob per session ≤5MB; beyond that, oldest portions truncated.

### 16.7 — Command palette (Cmd+Shift+P) in v1

**Decision:** Ratified. Fuzzy search across:
- Active sessions (by name, by project, by type)
- All JStudio projects (from filesystem scan)
- Commander actions (New Session, New Workspace, Stop, Clone, Cycle Focus, Toggle Terminal, etc.)
- Recent commands per session (optional stretch)

Implementation: Zustand-backed visibility state, TanStack Query for searchable data sources, fuzzy-search via `fuse.js` or similar.

### 16.8 — `/bin/zsh` + bundled OSC 133 hook (shell strategy)

**Decision:** V1 spawns `/bin/zsh` explicitly for every session with the bundled OSC 133 hook sourced via `-c`. User's `~/.zshrc` still loads inside the session (zsh loads it by default on interactive shells) so user customization is preserved; OSC 133 markers are added on top via the bundled hook.

**Rationale:** Ensures OSC 133 works reliably regardless of user shell configuration. User's shell customizations (aliases, functions, prompt) still work because zsh loads `.zshrc` normally. The bundled hook is a small addition, not a replacement.

**Documentation in v1:** README notes "V1 uses zsh as the session shell. If you use a different shell (bash, fish) as your system default, Commander still spawns zsh per session; your shell config is sourced if zsh-compatible."

### 16.9 — Tauri auto-updater at launch, signed via Apple Developer cert

**Decision:** Ratified. V1 ships with `tauri-plugin-updater` configured. On app launch, checks for new releases from a JStudio-controlled endpoint (GitHub releases or self-hosted). Prompts user when an update is available; user controls whether/when to install.

**Implementation notes for N6 (distribution phase):**
- Apple Developer cert ($99/year) acquired by Jose.
- Updates signed with cert; Tauri verifies signature before install.
- Update endpoint: GitHub releases is the standard pattern (Tauri supports natively).
- No auto-install; always user-initiated.

### 16.10 — No telemetry, no opt-in UI for v1

**Decision:** Ratified. Commander v1 is single-user (Jose). No telemetry of any kind. No "send anonymous usage data" opt-in. All analytics stay local in SQLite.

**If/when external distribution becomes real (v2+ product direction):** Add explicit opt-in UI, default to off, document exactly what is collected (counts, not content), never collect code or project content. Revisit this decision only at that future point.

---

## §17 — Recommended next steps

With all §16 ratifications complete and PM fold pending:

1. **PM reviews this spec + folds amendments** — feature-to-primitive mapping validation, schema amendments, renderer registry coverage, bug table completeness. Produces v1.2 with PM comments incorporated.
2. **CTO drafts MIGRATION_V2_RETROSPECTIVE.md** — banks migration v2 closure with continuity into v1. Can run in parallel with PM's review.
3. **CTO drafts N1 redo dispatch** — Tauri shell + Bun verification spike + node-pty smoke + single session xterm.js hello-world + fresh Drizzle schema init + pre-warm pool scaffold (1 pty warm at idle, stretch goal for N1) + OSC 133 hook bundled. Acceptance: launch Commander.app, spawn a PM session on any project, xterm.js renders terminal, bootstrap injects, OSC 133 marker fires on first prompt, session record appears in Drizzle DB. 5-8 days estimated.
4. **PM designs per-subsystem test surfaces** — unit test plan for state machine, integration tests for IPC contracts, E2E tests for feature acceptance per Deliverable 1.
5. **Jose dogfoods N1** — once N1 ships, Jose uses v1 alongside web Commander, validates acceptance criteria.
6. **N2 through N6** — subsequent phases per Phase plan in Deliverable 1, each citing this spec as architectural contract.

---

## §18 — Version history

- **v1.0 (2026-04-22)** — Initial draft from CTO, based on Deliverable 1 (FEATURE_REQUIREMENTS_SPEC.md) + Phase Y arc learnings + migration v2 operating model.
- **v1.1 (2026-04-22)** — All 10 open questions from §16 ratified by Jose. OS §15 amendment accepted (Zustand permitted for pure client state). Named workspaces, command palette, scrollback persistence, pre-warm session pool, basic analytics + dedicated analytics page deferred to v1.1 — all confirmed IN v1 scope. `/bin/zsh` + bundled OSC 133 hook ratified. Tauri auto-updater + Apple Developer cert ratified. No telemetry. §14.1 IN-scope list updated; §16 converted from open questions to ratified decisions log. *(Note: an earlier PM v1.1 fold with schema + renderer + preserved-list amendments was overwritten during CTO's §16-ratifications merge; amendments re-applied in v1.2 below.)*
- **v1.3 (2026-04-22)** — PM fold of two §7-queued corrections surfaced during N1 CODER implementation (per N1_ACCEPTANCE_MEMO §7). Changes:
  - **§5.4 FSEvents plugin correction:** `tauri-plugin-fs-watch` (v1-only crate, doesn't exist in v2) → `tauri-plugin-fs` (Tauri v2's unified fs plugin). Aligns spec with plugin naming CODER correctly used in N1 (deviation D5).
  - **§8.2 WebviewWindow origin revision:** previous draft specified WebviewWindow points at sidecar's HTTP server URL. Corrected to Tauri's standard `frontendDist` (production) / `devUrl` (development) pattern with frontend-side `/api/health` probe at 11002..11011 for sidecar URL discovery. `get_sidecar_url()` Tauri IPC command is implemented for non-default-port scenarios but unused in default path. CODER's N1 implementation was architecturally better than the spec's original derivation — v1.3 folds reality back into spec (deviation D3). Lesson banked: spec should cite Tauri conventions where they exist rather than derive orthogonally.
  - **No changes** to §9 feature-to-primitive mapping (both fixes are implementation-level, not feature-mapping-level).
  - **No changes** to §10 Drizzle schema.
  - **No changes** to §11 renderer registry.
  - **No changes** to §12 bug elimination table.
  - **No changes** to §16 ratified decisions.
- **v1.2 (2026-04-22)** — PM review fold, re-applied post-merge + extended.
  - **§10 schema:** composite `idx_session_events_session_type` index (load-bearing for v1.1 analytics drill-down + v1 command-palette recent-commands per §16.7); UNIQUE constraint `uidx_workspace_pane_slot` on `workspace_panes(workspaceId, paneIndex)`; FTS5 virtual table for `session_events.payload` full-text search documented as raw migration SQL (Drizzle SQLite DSL limitation); retention enforcement policy documented inline (Bun daily scheduled task, 30d session_events default via `retention_days` preference, indefinite cost_entries); `updatedAt` trigger convention noted; partial index on `sessions WHERE status != 'stopped'` flagged for raw migration SQL.
  - **§11 renderer registry:** resolved hierarchical-vs-flat ambiguity in favor of hierarchical (`system_event` as top-level super-type with `SystemEventDispatcher` routing to `SYSTEM_EVENT_REGISTRY` subtype handlers). Removed duplicates from top-level `ClaudeEventType` (`task_reminder`, `api_error`, `skill_listing`, `invoked_skills`, `queued_command` now live only under `SystemEventSubtype`). Expanded `ToolName` union with `BashOutput`, `KillShell`, `NotebookEdit`, `ExitPlanMode`, `Skill` matching current Claude Code tool surface. `TOOL_RENDERERS` map updated.
  - **§13 preserved list:** added explicit entries for OS §20.LL-L13 (plain-language reframe as architectural signal) and L14 (ground-truth over derivation) at parity with L11/L12. These are the operating-model principles that directly enabled the v1 rebuild decision; explicit listing matters for future CTO/PM sessions working on v1 phases to apply them when architectural reframes tempt predicate-chain workarounds. Zustand §16.1 amendment cross-referenced into the OS §15 preserved-line.
  - **§9 feature-to-primitive mapping:** added 6 new rows for §14.1 Jose-ratified items that weren't in Deliverable 1 — named workspaces, command palette, pre-warm session pool, scrollback preservation across restarts, 5h/7d budget real-time metrics, Tauri auto-updater. Each cites the §16 ratification it derives from.
  - **§9, §12, §16, §4.1 Zustand amendment, §15 future-scope invariants:** PM verified, no corrections. §9 (post-fold) covers every feature + §14.1 addition. §12 bug table covers all 19 candidates from CTO's review scope (19/22/23/26/27/29/30/32/33/34/35/36/37/39/40/41/42/44/45) plus Phase Y Class 1/2/3 plus architectural classes (pattern-matching discipline, shape-vs-source, temporal gate stacking, context accumulation, two-source-of-truth costs). §16 ratified decisions log is complete.
  - **Not folded (noted as v2 reconsideration):** splitting high-value queryable fields out of `sessionEvents.payload` into dedicated columns — deferred to v2 on query-performance grounds; rationale in §10 amendment summary.

---

**End of spec v1.2.** All 10 §16 decisions ratified by Jose. PM review folds applied. Ready for CTO to draft MIGRATION_V2_RETROSPECTIVE.md + N1 redo dispatch.
