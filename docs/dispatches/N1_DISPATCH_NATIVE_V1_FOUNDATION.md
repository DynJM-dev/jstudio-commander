# N1 Dispatch — Native Commander v1 Foundation

**Dispatch ID:** N1 (redo, Attempt 2)
**From:** CTO (Claude.ai)
**To:** PM (Commander) → fresh CODER spawn (architectural N1 reset)
**Phase:** N1 — Native Commander v1 foundation
**Depends on:** `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (canonical architectural contract), `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` v1 (user-facing acceptance contract), `docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` (operating-model continuity)
**Template reference:** `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md` (CODER produces PHASE_REPORT in this format at completion)
**Estimated duration:** 5-8 working days
**Model/effort:** Sonnet 4.6 / effort=medium for most work, escalate to high for architectural decisions (Bun verification spike, IPC bridge shape, pre-warm pool lifecycle)
**Status:** Ready to fire

---

## §0 — Dispatch purpose in one sentence

Build the foundational architectural skeleton of native Commander v1 — Tauri v2 shell, Bun (or Node+pkg) sidecar, node-pty + xterm.js terminal, fresh Drizzle schema, OSC 133 shell integration, pre-warm session pool — such that Jose can launch Commander.app, spawn a PM session on any JStudio project, see the terminal render live, bootstrap inject, OSC 133 markers fire, and a session record appear in the Drizzle database.

This is the architectural reset following N1 Attempt 1's debrief. Attempt 1's scaffold stays on disk as reference; this dispatch starts fresh.

---

## §1 — Non-negotiable acceptance criteria

The phase is complete when **all** of the following observable behaviors are demonstrable by Jose running the binary:

1. **Commander.app launches on macOS arm64** from a signed `.app` bundle. Bundle size ≤60 MB. Launch time from click to main window interactive ≤1.5s.
2. **Sidecar spawns automatically** on app launch, managed via `tauri-plugin-shell`. No orphan processes on quit (Cmd+Q, menu quit, Dock quit all shutdown cleanly within 5s).
3. **Fresh Drizzle database** initializes at `~/.jstudio-commander-v1/commander.db` on first launch. Schema matches ARCHITECTURE_SPEC.md v1.2 §10 exactly (with PM v1.2 folds: composite `idx_session_events_session_type`, `uidx_workspace_pane_slot`, FTS5 virtual table via raw migration SQL, partial index flag for `status != 'stopped'`, `updatedAt` triggers). `sessionTypes` seeded with `pm`, `coder`, `raw` rows at first run.
4. **New PM session spawns** from a "New Session" button in the main window. Modal collects project path + type (PM/Coder/Raw default: PM) + effort (default per type). On submit:
   - `/bin/zsh` is spawned via node-pty with the bundled OSC 133 hook sourced via `-c`.
   - `JSTUDIO_SESSION_ID` env var is set on the pty.
   - `claude` is exec'd inside the shell.
   - Bootstrap file (`~/.claude/prompts/pm-session-bootstrap.md` for PM, `~/.claude/prompts/coder-session-bootstrap.md` for Coder, nothing for Raw) is written to pty.stdin as the first input **after** pty attach is confirmed live.
   - Session row is inserted into `sessions` table with correct `projectId`, `sessionTypeId`, `effort`, `cwd`, `ptyPid`, `status: 'active'`.
5. **xterm.js terminal renders** in the session's pane. GPU rendering via `@xterm/addon-webgl`. Live pty output visible byte-for-byte (ANSI colors, spinners, progress bars, cursor positioning all correct). Keystroke input works (xterm.js `onData` → WS `pty:input` → sidecar writes to pty.stdin). Scrollback up to 10,000 lines.
6. **OSC 133 markers fire** on the first shell prompt after Claude Code boots. Sidecar parses markers from pty output stream and emits typed `command:started` + `command:ended` events to the event bus. Events visible via in-app debug log OR dev-console (whichever dispatch-author chooses — verification mechanism, not production UI).
7. **Pre-warm session pool** active at idle. Sidecar maintains 2 pre-warmed pty processes (spawned `/bin/zsh` + OSC hook, idle at shell prompt). On new-session spawn, one pre-warmed pty is claimed + bootstrap injected + Drizzle session row created. Warm spawn time <500ms; cold spawn time (pool empty) <2s. Pool size configurable via `preferences` table key `pool.size` (default 2, range 0-5).
8. **Single-instance enforcement** via `tauri-plugin-single-instance`. Second launch focuses the existing window; does not spawn a second instance.
9. **Signed build.** Apple Developer cert configured (Jose provides; cert present on the build machine). `.app` is signed and notarized per Tauri v2's macOS signing pipeline. Running the `.app` does not produce Gatekeeper "unidentified developer" warning.
10. **Clean shutdown.** On Cmd+Q: sidecar SIGTERM → wait up to 5s → SIGKILL if unresponsive → lock file removed. All pre-warmed pty processes terminated. No orphan `node`/`bun`/`zsh`/`claude` processes after quit (verify via `ps aux | grep` check).

**The phase is NOT complete until every item above is demonstrable.** Partial completion with "works for PM sessions but Coder bootstrap untested" is not acceptance.

---

## §2 — Architectural contract (cite ARCHITECTURE_SPEC.md v1.2)

CODER must treat ARCHITECTURE_SPEC.md v1.2 as the canonical contract. Specific sections load-bearing for N1:

- **§2 Platform** — Tauri v2 shell + Rust scope boundary (5 categories, nothing else). Bun primary runtime; Node+pkg fallback if Bun verification spike fails.
- **§3 Storage** — Drizzle + better-sqlite3, fresh schema at `~/.jstudio-commander-v1/commander.db`, no migration from web Commander.
- **§4 State management** — Zustand (client state) + TanStack Query (server state). No Redux, no MobX, no ad-hoc Context for server state.
- **§5 Real-time pipeline** — OSC 133 + typed event bus + FSEvents via `tauri-plugin-fs-watch`.
- **§6 Terminal layer** — xterm.js + @xterm/addon-webgl + node-pty, Option A (node-pty in sidecar). OSC 133 hook bundled, sourced via `-c`.
- **§7 IPC contracts** — Three-layer: Tauri IPC (OS only), WebSocket (streaming), HTTP (query). Do NOT mix layers.
- **§8 Sidecar process model** — `tauri-plugin-shell` managed, crash recovery with exponential backoff (1s / 3s / 9s up to 3 retries within 60s).
- **§10 Schema** — implement exactly as specified including PM v1.2 folds.

**If any section of v1.2 is ambiguous to CODER, CODER reports the ambiguity in PHASE_REPORT §8 (Questions for PM). CODER does NOT make architectural decisions unilaterally.** This is the explicit guardrail against the Attempt 1 "8 unilateral decisions" debrief pattern.

---

## §3 — Task breakdown (10 tasks, ordered)

Ordered so CODER can execute sequentially. Each task has its own acceptance criterion. CODER should commit at task boundaries (10 commits minimum for this phase).

### Task 1 — Bun verification spike (high-effort escalation)

Before any other work: verify Bun can host the sidecar runtime on macOS arm64.

**Spike scope:**
- Install Bun (latest stable as of dispatch date).
- Create throwaway directory `~/tmp/bun-verification/`.
- Install `node-pty` + `better-sqlite3` + `drizzle-orm` + `fastify` as dependencies.
- Write a 30-line smoke test: spawn `/bin/zsh` via node-pty, echo "hello" into it, read "hello" back from pty output, open a SQLite database via better-sqlite3, run a `CREATE TABLE` + `INSERT` + `SELECT`, close cleanly.
- Run under Bun. If all operations succeed without native-binding errors or segfaults, Bun passes verification.
- If Bun fails, document exactly what failed (node-pty native compile error, better-sqlite3 arm64 incompatibility, segfault during SQLite operations, whatever the failure mode is).

**Decision point:**
- **Bun passes** → proceed with Bun as sidecar runtime.
- **Bun fails** → fall back to Node + pkg (not raw Node binary bundling per ARCHITECTURE_SPEC §2.1). Report failure in PHASE_REPORT §4 (Deviations) and §5 (Issues).

**Acceptance:** `~/tmp/bun-verification/` directory with working smoke test + documented result (pass/fail) + decision committed. If fail, pkg-Node setup verified with same smoke test.

**Effort escalation:** medium by default; escalate to high if native binding issues surface (debugging Bun/Node.js native addon compat is non-trivial).

### Task 2 — Monorepo scaffold

Create the repository structure for native Commander v1. This is NOT the existing web `jstudio-commander/` repo's `src-tauri/` from Attempt 1 — that stays as reference. Use a new directory: `jstudio-commander/native-v1/`.

**Structure:**
```
native-v1/
├── apps/
│   ├── shell/            # Tauri Rust shell (≤150 LOC per ARCHITECTURE_SPEC §2.5)
│   │   ├── src-tauri/
│   │   │   ├── src/main.rs
│   │   │   ├── Cargo.toml
│   │   │   └── tauri.conf.json
│   │   └── package.json
│   ├── sidecar/          # Bun (or Node+pkg) Fastify server
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── server.ts
│   │   │   ├── db/
│   │   │   ├── pty/
│   │   │   └── osc133/
│   │   └── package.json
│   └── frontend/         # React + Vite + xterm.js
│       ├── src/
│       │   ├── App.tsx
│       │   ├── stores/   # Zustand stores
│       │   ├── queries/  # TanStack Query hooks
│       │   ├── components/
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── shared/           # Event types, schema types, IPC contracts
│   │   ├── src/
│   │   │   ├── events.ts
│   │   │   ├── session-types.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── db/               # Drizzle schema + migrations
│       ├── src/
│       │   ├── schema.ts
│       │   └── migrations/
│       └── package.json
├── resources/
│   └── osc133-hook.sh    # Bundled zsh hook
├── package.json          # Workspace root (Bun workspaces or pnpm workspaces)
├── turbo.json            # If using Turborepo
└── README.md
```

**Package manager decision:** Bun workspaces if Bun passed Task 1. pnpm workspaces otherwise. Turborepo on top either way for build orchestration.

**Acceptance:** `bun install` (or `pnpm install`) succeeds from monorepo root. Each app has its own `package.json` with correct workspace references. Typecheck runs clean across all packages (empty files still typecheck).

### Task 3 — Drizzle schema + migrations + seed

Implement ARCHITECTURE_SPEC.md v1.2 §10 schema exactly. Place in `packages/db/src/schema.ts`.

**What lands:**
- All tables from §10: `projects`, `sessions`, `sessionTypes`, `sessionEvents`, `costEntries`, `toolEvents`, `approvalPrompts`, `preferences`, `workspaces`, `workspacePanes`, `threeRoleLinks`.
- All indexes including PM v1.2 folds: `idx_session_events_session_type` (composite), `uidx_workspace_pane_slot` (UNIQUE).
- FTS5 virtual table for `session_events.payload` via raw migration SQL in `packages/db/src/migrations/0001_fts5_session_events.sql` — includes sync triggers (insert / update / delete).
- Partial index `CREATE INDEX ... ON sessions(...) WHERE status != 'stopped'` in raw migration SQL.
- `updatedAt` triggers — verify Drizzle's `timestamp_ms` mode generates them; if not, add as raw migration SQL.
- `sessionTypes` seed migration that inserts the three canonical rows:
  ```ts
  { id: 'pm', label: 'PM', bootstrapPath: '~/.claude/prompts/pm-session-bootstrap.md', effortDefault: 'high', clientBinary: 'claude', sortOrder: 1 },
  { id: 'coder', label: 'Coder', bootstrapPath: '~/.claude/prompts/coder-session-bootstrap.md', effortDefault: 'medium', clientBinary: 'claude', sortOrder: 2 },
  { id: 'raw', label: 'Raw', bootstrapPath: null, effortDefault: 'medium', clientBinary: 'claude', sortOrder: 3 },
  ```
- First-run initialization logic in sidecar: if database doesn't exist at `~/.jstudio-commander-v1/commander.db`, create directory + run all migrations + seed session types.

**Acceptance:**
- Database initializes on first sidecar launch.
- All tables + indexes present (verify via `.schema` command in sqlite3 CLI).
- FTS5 virtual table present and sync triggers working (insert a session_event, verify FTS5 table mirrors it).
- `session_types` table has exactly the three canonical rows on first launch.
- Subsequent launches detect existing database and do NOT re-run migrations.

**Effort:** medium. This is mechanical schema implementation; the design is already locked in v1.2.

### Task 4 — Rust shell (apps/shell/src-tauri/)

Implement the Tauri v2 Rust shell. ≤150 LOC budget per ARCHITECTURE_SPEC §2.5. Scope strictly limited to five categories per §2.1:

1. Tauri configuration + window management
2. Sidecar lifecycle (spawn, crash recovery, clean shutdown)
3. IPC bridge for OS integrations (v1 scope: notifications, single-instance, quit handler; other OS integrations land in N5)
4. Code signing + updater stub (updater plugin installed; update endpoint TBD until N6)
5. Eventual node-pty bridge — **not used in N1** (node-pty lives in sidecar per §2.4 Option A)

**Concrete scope for N1:**
- `tauri.conf.json` with Apple Developer cert signing identity configured.
- `main.rs` that:
  - Initializes `tauri-plugin-shell`, `tauri-plugin-single-instance`, `tauri-plugin-updater`, `tauri-plugin-fs-watch`.
  - Spawns sidecar via `tauri_plugin_shell::Builder::sidecar()` pointing at the Bun (or pkg-Node) binary.
  - TCP-polls sidecar `GET /api/health` until ready (up to 5s timeout).
  - Opens `WebviewWindow` at `http://127.0.0.1:<port>` (port discovered from `~/.jstudio-commander-v1/runtime.json` written by sidecar).
  - Registers quit handler: on app quit → send SIGTERM to sidecar → wait 5s → SIGKILL if needed → remove lock file → exit.
  - Crash recovery loop: if sidecar exits unexpectedly, restart with exponential backoff (1s/3s/9s, max 3 retries within 60s rolling window).
- `#[tauri::command]` handlers for: `app_quit()`, that's it for N1. Other OS integrations land in N5.

**Acceptance:**
- LOC count ≤150 (`wc -l apps/shell/src-tauri/src/*.rs`).
- `cargo check` clean.
- No Rust code exists outside the five scoped categories (CODER self-audits against §2.3 examples of scope drift to reject).
- App launches, sidecar spawns, WebviewWindow opens pointed at sidecar URL.

**Effort:** medium. Rust surface is small and the patterns are well-documented in Tauri v2 docs. Escalate to high only if cross-compilation or code-signing-pipeline issues arise.

### Task 5 — Sidecar Fastify server + port discovery + health

Implement `apps/sidecar/src/server.ts` as a Fastify HTTP + WebSocket server.

**Concrete scope:**
- Port binding from 11002, retry up to 11011 if occupied.
- On port bind success, write `{ port: <N>, pid: <PID> }` to `~/.jstudio-commander-v1/runtime.json`.
- `GET /api/health` returns `{ status: 'ok', version: <from package.json> }`.
- WebSocket endpoint at `/ws` with multiplexed channels (subscription model per §7.3).
- Lock file at `~/.jstudio-commander-v1/sidecar.lock` containing `{ pid: <PID>, port: <N>, startedAt: <timestamp> }`.
- Graceful shutdown handler on SIGTERM: close WS connections → stop pre-warm pool → close all active session ptys → close Drizzle DB → remove lock file → exit 0.

**Acceptance:**
- Sidecar launches standalone (`bun run apps/sidecar/src/index.ts`) without Tauri, for debugging.
- `GET /api/health` returns 200 OK with correct JSON.
- Lock file + runtime.json appear on launch, removed on clean shutdown.
- WebSocket connects from browser (Chrome DevTools console test: `new WebSocket('ws://127.0.0.1:11002/ws')`).
- SIGTERM triggers clean shutdown within 5s.

**Effort:** medium.

### Task 6 — node-pty integration + OSC 133 hook

Implement `apps/sidecar/src/pty/` with node-pty spawn + OSC 133 parser.

**Concrete scope:**
- `PtyManager` class manages lifecycle of a single pty process.
- Spawn method: `spawn(cwd, sessionId)` → returns pty instance with:
  - `/bin/zsh` as shell with `-c` arg sourcing the bundled OSC 133 hook then running interactive zsh.
  - `name: 'xterm-256color'`, `cols: 80`, `rows: 24` defaults (resize handled by frontend xterm.js `@xterm/addon-fit`).
  - `env: { ...process.env, JSTUDIO_SESSION_ID: sessionId }`.
  - `cwd` resolved via preserved `resolveSessionCwd` helper (port from web Commander if helper is trivially portable; re-implement if not).
- pty.onData handler:
  - Forward all data to WS channel `session:<sessionId>` as `pty:data` event.
  - Parse data stream for OSC 133 markers: `\x1b]133;A\x07`, `\x1b]133;B\x07`, `\x1b]133;C\x07`, `\x1b]133;D;<exit>\x07`.
  - On marker match, emit typed events: `command:started` (B marker) + `command:ended` with exit code (D marker).
  - Markers remain in the data stream forwarded to xterm.js (they're invisible to xterm.js rendering).
- pty.onExit handler: emit `session:status` event with status `'stopped'`, exit code, update Drizzle `sessions.status` + `sessions.stoppedAt`.
- Input handling: WS `pty:input` events write to `pty.stdin`.

**OSC 133 hook file (`resources/osc133-hook.sh`):**
```bash
#!/bin/zsh
# JStudio Commander v1 — OSC 133 shell integration hook
# Sourced at session spawn via zsh -c. Does NOT modify user ~/.zshrc.

# Prompt start marker
_osc133_precmd() { printf '\e]133;A\a' }
# Command start marker
_osc133_preexec() { printf '\e]133;B\a' }
# Command end marker (with exit code)
_osc133_chpwd() { : }  # reserved

# Register hooks
autoload -U add-zsh-hook
add-zsh-hook precmd _osc133_precmd
add-zsh-hook preexec _osc133_preexec
# Exit code via TRAPEXIT or command-end parsing — simplified below:
PS1="${PS1}"$'\e]133;C\a'  # end of command marker appended to prompt
```

**Caveats CODER should verify and report on:**
- The exact OSC 133 sequence spec differs between shell-integration implementations (WezTerm, iTerm2, VSCode, GHOSTTY). Choose one canonical spec and cite it in PHASE_REPORT §1. VSCode's shell integration spec is well-documented and matches what xterm.js addons parse.
- zsh hook interaction with user's `~/.zshrc`: hook is sourced first via `-c`, then zsh loads user rc. User's PROMPT/RPROMPT customizations may overwrite the OSC 133 `C` marker. Acceptable for N1 since we're validating the hook works at all; edge cases land in N2+.

**Acceptance:**
- pty spawns with zsh + OSC hook sourced.
- Running `ls` in the pty triggers `command:started` event (B marker) visible in sidecar log.
- `ls` completion triggers `command:ended` event (D marker with exit code 0) visible in sidecar log.
- pty data stream forwarded to WS channel, markers included.
- pty exits on `exit` command, `session:status` stopped event fires, Drizzle row updated.

**Effort:** high. This is the architecturally novel part of N1. OSC 133 parsing + event emission is where most unexpected behavior surfaces. Escalate effort if marker parsing has edge cases.

### Task 7 — Pre-warm session pool

Implement `apps/sidecar/src/pty/pool.ts`.

**Concrete scope:**
- `PtyPool` class manages N pre-warmed pty processes (default N=2, configurable via `preferences.pool.size`).
- On sidecar startup after DB ready: spawn N pre-warmed ptys at `~/` (default cwd, overridden on claim).
- Pre-warmed pty runs `/bin/zsh` with OSC 133 hook but does NOT run `claude` yet — it's idle at the zsh prompt.
- On session spawn request:
  - If pool has available pre-warmed pty: claim one, `cd` to session's actual cwd via `pty.write('cd /path/to/project\n')`, then write `claude\n` to start Claude Code, then write bootstrap content after Claude boots.
  - Spawn replacement pre-warmed pty in background to refill the pool.
  - If pool is empty (cold spawn): spawn fresh pty directly, no pool claim.
- On sidecar shutdown: kill all pre-warmed ptys.

**Subtleties CODER should handle:**
- Detecting when Claude Code has finished booting inside the pty (so bootstrap write happens at the right moment): watch for OSC 133 `A` marker from zsh AFTER `claude` command OR watch for specific prompt pattern. CODER chooses approach and reports in PHASE_REPORT §1.
- Pool size 0 → pre-warm disabled, always cold spawn.
- Pool size 5 max — don't exceed.
- Pre-warm memory cost: 2 idle ptys ≈ 20-40 MB sidecar memory overhead. Acceptable.

**Acceptance:**
- Sidecar startup spawns 2 pre-warmed ptys (verified via `ps aux | grep zsh` showing 2+ additional zsh processes beyond the test session).
- New-session request from frontend claims a pre-warmed pty in <500ms (measured via WS latency: time from `POST /api/sessions` to first `pty:data` event).
- Pool refills within 2-3s after claim.
- `preferences.pool.size` change takes effect on next app launch (live reconfig not required in N1).
- Sidecar shutdown kills all pool processes cleanly.

**Effort:** high. Lifecycle bugs in pool management are subtle; spend time on edge cases (claim-during-refill, shutdown-during-spawn, etc.).

### Task 8 — Frontend scaffold + xterm.js + WS client

Implement `apps/frontend/src/` as a React 19 + Vite 7 + Tailwind v4 app.

**Concrete scope:**
- `App.tsx` minimal layout: sidebar (empty for N1), main pane with "New Session" button and active session area.
- `stores/sessionStore.ts` Zustand store: active session ID, sidebar collapsed state.
- `queries/sessions.ts` TanStack Query hooks: `useSessions()`, `useSession(id)`, `useCreateSession()`.
- `queries/wsClient.ts` WebSocket client: connects to `ws://127.0.0.1:<port>/ws`, subscribes to channels, writes incoming events to TanStack Query cache via `queryClient.setQueryData`.
- `components/TerminalPane.tsx`: renders xterm.js instance for the active session. Uses `@xterm/addon-webgl`, `@xterm/addon-fit`, `@xterm/addon-search`. On mount: connect to WS session channel, write incoming `pty:data` to xterm.js, send `pty:input` on `onData`.
- `components/NewSessionModal.tsx`: project path picker (simple text input for N1, native directory picker lands in N5), session type dropdown (queried from `session_types` table via `GET /api/session-types`), effort dropdown. Submit → `POST /api/sessions`.

**Styling:** minimal Tailwind v4 for N1. Visual polish lands in N3+ per ARCHITECTURE_SPEC §17. The goal is "functional, not pretty."

**Critical bans from OS §15:**
- No React StrictMode (wrap `<App />` without `<StrictMode>`).
- No Redux/MobX.
- No hardcoded hex in styles (use Tailwind tokens or `@theme` CSS vars).
- No Tailwind `dark:` prefixes (light mode only for N1; theming lands in N3).

**Acceptance:**
- `bun run dev` (or `pnpm dev`) in `apps/frontend/` launches Vite dev server.
- Dev server loads the app; "New Session" button visible.
- Clicking New Session opens modal. Selecting project path + type + effort, submitting, creates a session row (verify via Drizzle DB).
- Session's xterm.js pane mounts, connects to WS, shows live Claude Code boot output.
- Typing in the terminal works (input → pty.stdin → Claude Code sees it).
- OSC 133 markers fire on first Claude Code prompt; verifiable via sidecar log or debug overlay.

**Effort:** medium.

### Task 9 — Bootstrap injection at correct moment

Implement bootstrap-write logic in sidecar (`apps/sidecar/src/pty/bootstrap.ts`).

**Concrete scope:**
- After pty is live + `claude` has been exec'd + Claude Code has booted (detection mechanism per Task 7 subtleties):
  - If session type is `pm` or `coder`: read bootstrap file at `sessionTypes.bootstrapPath`, write contents to pty.stdin followed by newline.
  - If session type is `raw`: skip bootstrap.
  - If bootstrap file is missing: fail session spawn with user-visible error (emit `session:status` error + log). Do NOT silently fall back to Raw.
- First-byte guarantee: bootstrap must write BEFORE Jose could have typed. This means detecting "Claude Code is ready for input" correctly — not writing too early (before Claude boots) or too late (after a race condition where Jose typed first).
- Bootstrap injection is observable: the bootstrap text should appear in the xterm.js terminal, same as if Jose had typed it.

**Acceptance:**
- Spawn PM session → pm-session-bootstrap.md content appears as first input in the terminal, routed through Claude Code, triggering the persona-acknowledgment response.
- Spawn Coder session → coder-session-bootstrap.md injected.
- Spawn Raw session → no bootstrap, terminal shows Claude Code's default welcome.
- Missing bootstrap file → session spawn fails with error: "Bootstrap file not found at <path>" in UI, no silent fallback.
- Order guarantee holds under repeated testing (spawn 5 sessions in quick succession, all bootstraps inject before any Jose input).

**Effort:** medium-high. The "correct moment" detection is subtle.

### Task 10 — Build pipeline + signing + final smoke test

**Concrete scope:**
- `bun run build` (or `pnpm build`) at monorepo root builds:
  - Frontend → Vite production build (`apps/frontend/dist/`).
  - Sidecar → Bun single-executable OR pkg-Node binary (per Task 1 decision). Output at `apps/sidecar/dist/sidecar-bin`.
  - Rust shell → `cargo tauri build` producing signed + notarized `.app` bundle.
- Apple Developer signing identity configured via `tauri.conf.json` (Jose provides cert; CODER integrates).
- Notarization via `notarytool` (Tauri v2 automates this if signing identity is correct).
- Final output: `.app` bundle in `native-v1/apps/shell/src-tauri/target/release/bundle/macos/`.
- Bundle size check: `du -sh Commander.app` — must be ≤60 MB. If >60 MB, diagnose (which file is largest) and report in PHASE_REPORT §7 (Tech debt).
- Final smoke test (all §1 acceptance criteria):
  - Launch Commander.app from Finder (not from terminal) → no Gatekeeper warning.
  - Spawn PM session on `~/Desktop/Projects/jstudio-meta/` → terminal renders, bootstrap injects, OSC 133 fires, session in DB.
  - Run a Claude Code prompt ("list files in this directory") → OSC 133 markers fire before + after the command, xterm.js shows Claude's response fully.
  - Quit app via Cmd+Q → all processes terminated (verify via `ps aux | grep -E 'node|bun|zsh|claude|Commander'`).

**Acceptance:**
- All 10 §1 criteria demonstrable in a single end-to-end session.
- Bundle ≤60 MB.
- No Gatekeeper warning on first launch.
- Clean process tree on quit.

**Effort:** medium. Build + signing has known gotchas (Apple notarization timing, entitlements.plist for hardened runtime, signing-chain errors) but patterns are well-documented.

---

## §4 — Explicit non-scope for N1

These are v1 features that DO NOT land in N1. Phase N2+ will cover them. CODER must not build ahead.

- Split view (multi-session UI layout) — N2.
- STATE.md drawer (§7 of Deliverable 1) — N2.
- ContextBar full-fidelity (status indicator, effort dropdown, Stop button, token/cost/context displays, teammate count, manual refresh, approval modal mount) — N2/N3.
- ChatThread rendering (message grouping, tool chips, markdown, inline reminders, approval inline, LiveActivityRow, scroll anchor, compact-boundary) — N3.
- Renderer registry implementation — N3.
- Approval modal (Item 3 sacred) — N3 (path reserved structurally in N1 via typed `approval:prompt` event shape, but no UI).
- Command palette (Cmd+Shift+P) — N4.
- Three-role UI (brief/dispatch/report panes) — N5.
- OS integrations beyond single-instance: Dock badge, menu bar, tray icon, global shortcuts, notifications, Spotlight, drag-drop — N5.
- Workspace persistence + named workspaces — N4.
- Analytics (even basic 5h/7d budget display) — N4.
- Auto-updater endpoint (plugin installed in N1, endpoint configured and tested in N6).

If CODER finds themselves building any of the above in N1, stop and flag in PHASE_REPORT §4 (Deviations).

---

## §5 — Explicit guardrails from N1 Attempt 1 debrief

N1 Attempt 1 produced 8 unilateral decisions that weren't authorized by the dispatch. Specific guardrails to prevent recurrence:

1. **No unilateral architectural decisions.** If ARCHITECTURE_SPEC.md v1.2 doesn't specify the answer, CODER asks in PHASE_REPORT §8 (Questions for PM). Does not guess.
2. **No silent scope expansion.** If CODER sees "while I'm here I should also fix X" temptation, it goes in PHASE_REPORT §6 (Deferred items) with suggested phase, not into the current commit.
3. **No workarounds without reporting.** If a spec section is technically infeasible as written (e.g., Drizzle can't generate `updatedAt` triggers), implement the minimum viable workaround, report in PHASE_REPORT §4 (Deviations) AND §5 (Issues), and flag for CTO ratification before the workaround is considered final.
4. **No "I'll clean it up in a follow-up commit."** Every commit should be ship-quality. Tech debt is declared in PHASE_REPORT §7, not hidden in a TODO comment.
5. **Strictly respect §2.3 Rust scope boundary.** If tempted to write Rust for business logic, STOP and report. Business logic = TypeScript, always.
6. **OS §24 pattern-matching discipline.** No character-level shape matching against external tool output. OSC 133 marker detection uses byte-exact `\x1b]133;...` sequences (typed), not "looks for a prompt-like string." Approval detection (not in N1 scope but foundational) will use typed events, never shape matching.
7. **No partial completion claims.** "Works for PM but I didn't test Coder bootstrap" is not acceptance. Every §1 criterion gets tested before PHASE_REPORT is written.

---

## §6 — Testing discipline for N1

CODER writes tests as they build. Not after.

**Test scope:**
- **Unit tests (sidecar):** Drizzle schema migration tests (all tables present, indexes present, FTS5 sync works), OSC 133 parser tests (given input byte stream, emits correct typed events), PtyManager tests (spawn/input/exit lifecycle), PtyPool tests (claim/refill/shutdown).
- **Integration tests (sidecar):** Full session spawn flow (HTTP POST /sessions → pty spawn → WS pty:data → Drizzle row).
- **E2E smoke test:** Single automated test that launches sidecar, spawns a Raw session (Raw chosen to avoid bootstrap file dependency), verifies pty data arrives on WS, verifies session in DB, terminates cleanly.
- **Frontend:** minimal — React Testing Library for `TerminalPane` mount behavior. Full UI tests land in later phases.

**Test runner:** `vitest` for both sidecar and frontend. `bun test` acceptable if Bun is runtime.

**Acceptance:** `bun run test` (or `pnpm test`) from monorepo root passes. Target coverage: 70%+ on sidecar, N1 doesn't block on frontend coverage.

---

## §7 — Commit discipline

Minimum 10 commits (one per task). More is fine. Commit message format:

```
<scope>: <imperative summary>

<optional body>

Refs: ARCHITECTURE_SPEC.md v1.2 §<section>
```

Scopes: `shell`, `sidecar`, `frontend`, `db`, `shared`, `build`, `test`.

Example:
```
sidecar: implement OSC 133 marker parser + typed event emission

Parses \x1b]133;A/B/C/D escape sequences from pty onData stream.
Emits command:started (B) and command:ended (D with exit code) to
WS event bus. Markers pass through to xterm.js unchanged.

Refs: ARCHITECTURE_SPEC.md v1.2 §5.2, §6.3
```

**Do not squash commits.** CTO + PM review per-commit during PHASE_REPORT review.

---

## §8 — PHASE_REPORT template reference

At phase completion, CODER writes PHASE_REPORT in the canonical 10-section format from `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`:

1. Dispatch recap (one sentence)
2. What shipped (commits + files + capabilities)
3. Tests, typecheck, build (pass/fail table)
4. Deviations from dispatch (every non-spec choice flagged)
5. Issues encountered and resolution
6. Deferred items (each with suggested phase)
7. Tech debt introduced (severity, effort to fix)
8. Questions for PM (specific, actionable)
9. Recommended next phase adjustments
10. Metrics (duration, token burn, tool calls, skill invocations)

**Length target:** 600-1200 words. Longer is fine if Deviations + Issues are substantial.

**Filing:** `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N1_REPORT.md`. Jose carries the file to PM session.

---

## §9 — What PM does with this dispatch

PM receives this dispatch, reviews against ARCHITECTURE_SPEC.md v1.2 for scope consistency, flags any CTO ambiguity before firing. Specific PM checks:

1. **§1 criteria** — do all 10 criteria map to ARCHITECTURE_SPEC v1.2 §9 feature-to-primitive rows? (Yes by design; verify.)
2. **§3 task breakdown** — does each task's acceptance criterion match its §1 criterion? Order sequence makes sense? Dependencies respected (e.g., schema before sidecar that depends on schema)?
3. **§4 non-scope** — anything that should be in N1 but was excluded? (Check against §14.1 of v1.2.)
4. **§5 guardrails** — anything from the Attempt 1 debrief missing?
5. **§7 commit discipline** — matches OS §14 commit conventions?
6. **§8 PHASE_REPORT format** — references the template correctly per `feedback_dispatch_references_phase_report_template`?

After review, PM produces the paste-to-CODER prompt. CODER spawn is a fresh instance (architectural N1 reset per fresh-spawn memory). The paste-prompt should include:
- This full dispatch content (CODER reads it in full on spawn).
- Explicit "this is a fresh N1 reset; do not reference or port from N1 Attempt 1 scaffold" instruction.
- ARCHITECTURE_SPEC.md v1.2 path reference.
- FEATURE_REQUIREMENTS_SPEC.md path reference.
- MIGRATION_V2_RETROSPECTIVE.md path reference (CODER reads §4 invariants + §10 continuity map for operating-model context).

---

## §10 — What Jose does

1. Save this dispatch to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N1_DISPATCH_NATIVE_V1_FOUNDATION.md`.
2. Paste in PM thread: "N1 redo dispatch saved at `docs/dispatches/N1_DISPATCH_NATIVE_V1_FOUNDATION.md`."
3. Wait for PM review + paste-to-CODER prompt.
4. Spawn fresh CODER (architectural N1 reset).
5. Paste PM's prompt into fresh CODER.
6. CODER executes over 5-8 working days. Jose checks in at natural breakpoints (task boundaries), spot-reviews commits, does not micromanage.
7. When CODER files PHASE_N1_REPORT.md, Jose carries to PM session for review.
8. PM reviews report against this dispatch's §1 criteria. If all criteria met + deviations/issues/tech-debt acceptable: N1 closes. If not: specific follow-up dispatch (N1.1) addresses the gaps.
9. After N1 closes: Jose dogfoods the native binary for a few days. Verifies acceptance holds under real use. Reports feedback to CTO.
10. CTO drafts N2 dispatch (ContextBar + STATE.md drawer + split view shell).

---

## §11 — Estimated duration + effort calibration

- **Optimistic:** 5 days (Bun verification passes clean, OSC 133 hook works first try, signing chain has no surprises).
- **Realistic:** 6-7 days.
- **Pessimistic:** 8 days (Bun fails verification → pkg-Node fallback setup, OSC 133 marker edge cases, notarization issues).

**Effort profile:**
- Task 1 (Bun spike): 0.5 day, medium-high effort.
- Task 2 (monorepo scaffold): 0.5 day, medium.
- Task 3 (schema + seed): 0.5-1 day, medium.
- Task 4 (Rust shell): 1 day, medium.
- Task 5 (sidecar server): 0.5 day, medium.
- Task 6 (node-pty + OSC 133): 1-1.5 days, high.
- Task 7 (pre-warm pool): 0.5-1 day, high.
- Task 8 (frontend scaffold + xterm.js): 1 day, medium.
- Task 9 (bootstrap injection): 0.5 day, medium-high.
- Task 10 (build + signing + smoke test): 0.5-1 day, medium.

Total: 6.5-8 days. Parallelism possible on Tasks 4 + 5 (Rust + sidecar are independent until integration).

**Token budget:** estimated $600-$1200 for CODER execution. Medium effort default; spot-escalate to high for Tasks 1, 6, 7, 9.

---

## §12 — Closing instructions to CODER

This dispatch is the architectural reset. Prior to this dispatch, an Attempt 1 scaffold exists on disk at `~/Desktop/Projects/jstudio-commander/src-tauri/`. **Do not port from it.** Do not reference its files as starting points. Treat it as archived — a reference to look at for "how did Attempt 1 do X" only when a comparative question is useful.

Your starting point is `native-v1/` as a fresh directory.

Read these in order before writing a single line of code:

1. This dispatch (start to finish).
2. `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 — the canonical contract.
3. `~/Desktop/Projects/jstudio-commander/docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` — the user-facing acceptance.
4. `~/Desktop/Projects/jstudio-commander/docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` — §4 (operating-model invariants), §10 (continuity map), §11 (what makes v1 structurally different).
5. `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` — §14.1 (manual-bridge), §15 (critical bans + Zustand amendment), §20.LL-L11 through L14, §23.3 (bootstrap injection), §24 (pattern-matching).
6. `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md` — the format your PHASE_REPORT will be written in.

Then execute the 10 tasks in order. Commit at task boundaries. Test as you build. Ask PM for anything ambiguous — do not guess.

When all 10 §1 acceptance criteria are demonstrable: write PHASE_N1_REPORT.md, file it at `native-v1/docs/phase-reports/PHASE_N1_REPORT.md`, and notify Jose for carry to PM.

---

**End of N1 dispatch. Ready to fire.**
