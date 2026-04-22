# Native N1 — Tauri Shell + Node Sidecar + Commander.app Bundle

**From:** PM (Commander, 2026-04-22)
**To:** CODER (FRESH SPAWN — this is the start of the native rebuild arc; context-clean spawn is required)
**Type:** First dispatch of the native Commander rebuild. Single commit. Autonomous execution per `feedback_authorize_autonomous_coder_rotations`.
**Preceded by:** Native rebuild scoping brief at `docs/briefs/NATIVE_REBUILD_SCOPING_BRIEF.md`. CTO ratified 2026-04-22: Tauri + Node.js sidecar; macOS-only v1; Option Z hybrid migration; repo stays `jstudio-commander`, bundle ships as `Commander.app`.
**Status:** DRAFT pending Jose ratification. Do NOT fire until Jose says go.

---

## §1 — Architectural preamble (binding context for CODER)

Commander's chat-status real-time problem is architecturally unsolvable in the web platform. The Phase Y arc (five rotations, closeout `93312e4`, finalizer `0c87230`) proved that the JSONL-transcript pipeline — Claude Code → filesystem → server watcher → WebSocket → React — does NOT surface in-progress assistant content until turn-end. No amount of client-side derivation can fabricate a signal that hasn't been emitted yet. The Finalizer Track 1 reframe (`useSessionPaneActivity`) worked because it subscribed to the Phase T tmux-pane-capture stream, which IS ground-truth, but that stream still goes through `tmux capture-pane` polling at 1.5s cadence — a workaround, not a solution.

**Native Commander resolves this structurally.** A native app can attach `node-pty` directly to Claude Code's pty session and receive every output byte as it's written. No JSONL pipeline, no tmux capture polling, no watcher-bridge latency. The Phase Y ceiling dissolves.

**N1 is the foundation for that architecture.** N1 itself does NOT attach node-pty (that's N2). N1 ships the native shell + sidecar + `.app` bundle — the scaffolding that lets every later phase exist. The architectural why matters because N1's acceptance criterion is *zero regression from web Commander*. The whole point of Option Z (hybrid) is that existing Commander code keeps working unchanged in a native shell, and we only cash in the structural wins when N2+ refactors specific subsystems.

**Keep this framing when making judgment calls:** N1 is discipline, not ambition. Minimum viable native shell that runs existing Commander untouched. Anything beyond is N2+.

---

## §2 — Scope IN (strict)

Five deliverables, one commit:

### 2.1 — Tauri project scaffold

Create `src-tauri/` at the monorepo root (Tauri convention, CTO-ratified 2026-04-22; matches Tauri documentation, CODER moves faster on convention).

- `src-tauri/Cargo.toml` — Rust dependency manifest.
- `src-tauri/tauri.conf.json` — Tauri configuration (window size, app identifier `com.jstudio.commander`, sidecar config, bundle settings).
- `src-tauri/src/main.rs` — Tauri app entry point. Minimal — `tauri::Builder::default()` with sidecar lifecycle hook and window creation.
- `src-tauri/icons/` — placeholder icons (Tauri provides defaults; bundle icons can come in N5).

### 2.2 — Sidecar lifecycle

Tauri spawns the existing Commander Fastify server as a managed child process ("sidecar") on app start; kills it on app quit; pipes stdio for logging.

- Configure `tauri.conf.json` with `externalBin` or `bundledBin` entry for the server sidecar.
- Bundle strategy: copy Node.js binary + compiled server entry into the `.app` Resources directory, spawn as `node server/dist/index.js` (or equivalent — use whatever the existing `pnpm build:server` produces).
- Lifecycle contract: sidecar spawns on app launch, sidecar dies on app quit, no orphaned Node processes. Tauri's `tauri-plugin-shell` or the Rust `Command` with `Child::kill` on app-close event.
- Stdio: pipe stdout + stderr to Tauri logs (accessible via Tauri dev console or a log file in `~/Library/Logs/Commander/`).

### 2.3 — Frontend served from sidecar

The existing React app loads from the sidecar's localhost port, NOT from a `file://` URL. This preserves the exact web-Commander behavior (fetch to `/api/…`, WebSocket to `ws://…`).

- Tauri `devUrl` during `pnpm tauri dev` points to Vite dev server as today.
- Tauri `frontendDist` for production points to the sidecar-served static files (Fastify can serve the built client bundle from `client/dist/` — confirm this is already the case or add if missing; MINOR if the serving path needs a small addition).
- No file:// protocol. No webview-internal asset routing. Same URL scheme the browser used.

### 2.4 — Commander.app bundle

`pnpm tauri build` (or whatever the command name is under the monorepo's turbo/pnpm setup) produces a `Commander.app` file in `src-tauri/target/release/bundle/macos/`.

- Bundle identifier `com.jstudio.commander`.
- App display name `Commander`.
- Unsigned for N1 (signing is N5 scope — do NOT configure Apple Developer credentials here).
- Bundle should be double-clickable on macOS 14+ (Sonoma+) with no special flags.

### 2.5 — Verification smoke (Phase T regression guard)

Before committing, verify via manual run that double-clicking `Commander.app` produces:

1. Native window opens (not a browser tab) within 2-3 seconds.
2. Commander client renders identically to `pnpm dev` in browser.
3. Existing session list loads from the sidecar's SQLite.
4. **Phase T smoke sequence:**
   - Spawn a new session via CreateSessionModal.
   - Session card appears in sidebar.
   - Enter the session.
   - Send a prompt like `echo hello`.
   - Tool chip (Bash) appears in chat.
   - ContextBar transitions Idle → Working → Idle as expected.
   - Phase T Live Terminal pane renders pane content.
5. Quit the app (Cmd+Q). Verify `ps aux | grep node` shows zero orphan Node processes.

**If any step regresses vs web Commander behavior, N1 is not done.** Fix the sidecar / bundle configuration until the regression is closed. Do NOT work around it by modifying client or server business logic.

---

## §3 — Scope OUT (strict)

These are N2+ scope. Any work beyond strict N1 boundaries is rejection trigger (b):

- **UI changes** — zero diff to `client/src/**`. React components, hooks, utils, pages, tests untouched. The frontend loaded by the native shell is bit-identical to what loads in the browser.
- **Server business logic changes** — zero diff to `server/src/services/**`, `server/src/routes/**`, `server/src/event-bus/**`. If the sidecar launch requires a server change (e.g., a new env flag), it must be additive-only, at the entry point layer, and documented as MINOR.
- **IPC features** — no Tauri command handlers for client-initiated Rust calls (N3+ scope). No `window.__TAURI__.invoke(...)` pattern in client code. Client continues to use HTTP/WS as today.
- **OS integrations** — no native notifications, no global shortcuts, no menu bar items, no Dock badges, no deep links, no file associations.
- **node-pty attach** — not this dispatch. Phase T + tmux layer stays intact. N2 handles this.
- **Terminal emulator swap** — Phase T mirror continues rendering captures via `ansi_up` as today. N2 introduces xterm.js or equivalent.
- **Legacy-guard deletion** — CTO adjusted: legacy guards (`typedIdleFreshKillSwitch`, `lastTurnEndTs`, `isSessionWorking` OR-chain, Fix 1/2, Option 2/4, Activity-gap, heartbeat-stale, `useCodemanDiffLogger`, `debug.routes.ts`, JSONL) DO NOT delete in N1. They delete in N2's commit body once the terminal emulator supersedes the derivation chain. N1 carries the weight; N2 sheds it.
- **Schema changes** — SQLite schema untouched. No new migrations.
- **Skill / persona changes** — zero diff to `~/.claude/skills/**` or `~/.claude/prompts/**` or `jstudio-meta/OPERATING_SYSTEM.md`.
- **Web Commander sunset** — web version stays alive through N4. Don't delete `pnpm dev` or the `client/server` scripts.
- **Cross-platform configuration** — Tauri config is macOS-targeted only. Skip Windows / Linux build targets, skip cross-compile toolchain.
- **Signing / notarization / updater** — N5. Do NOT configure Apple Developer credentials or Tauri's updater.
- **Phase Y / Phase T / finalizer / 15.3-arc surface** — all frozen per existing hard-exclusion list. Inherited into this dispatch verbatim.

---

## §4 — Rust scope boundary

Per CTO §8-1 ratification, Rust code in this project is permanently scoped to three categories:

1. **Tauri config + sidecar lifecycle** (N1 scope — this dispatch).
2. **IPC bridge for OS integrations** (N3 scope — future).
3. **Eventual node-pty attach** (N2 scope — next dispatch).

**Business logic stays TypeScript.** If you find yourself writing Rust code that isn't (1), (2), or (3) — STOP, flag as MAJOR, ping PM.

For N1 specifically, Rust surface should be ~50-150 LOC total: `main.rs` + `Cargo.toml`. Anything beyond that is over-scoped.

---

## §5 — Tests

N1 is an infrastructure commit with a verification smoke, not a unit-test-heavy commit. Expected test delta:

- **Zero new TypeScript tests** — no logic changed in client or server.
- **Existing test suites (client 524, server 385, shared 34) must still pass.** Run `pnpm test` across all packages, confirm baseline.
- **Typecheck clean** across `@commander/shared`, `@commander/server`, `@commander/client` via `pnpm typecheck`.
- **Optional: one integration smoke script** under `scripts/` that validates the bundle produces and the sidecar spawns. Not required for ship — MINOR if CODER adds it.

The real acceptance is §2.5's manual smoke run — that IS the test.

---

## §6 — File boundaries

### May touch

- `src-tauri/**` — ADD (new directory at repo root per Tauri convention).
- `package.json` (repo root) — add Tauri-related scripts (`tauri:dev`, `tauri:build`) and dev dependencies (`@tauri-apps/cli`, `@tauri-apps/api`) as needed. Additive only.
- `pnpm-workspace.yaml` or `turbo.json` — register Tauri scripts if the monorepo setup requires it. Additive only.
- `.gitignore` — add `src-tauri/target/` as needed.
- `server/package.json` or `server/src/index.ts` — ONLY IF needed for static file serving of `client/dist/` via sidecar. MINOR deviation if touched; document in commit body.

### Do NOT touch

- Every client-side file (`client/src/**`, `client/test/**`, `client/public/**`).
- Every server-side business logic file (`server/src/services/**`, `server/src/routes/**`, `server/src/event-bus/**`, `server/src/hooks/**`).
- Phase Y frozen surfaces (`useChat.ts`, `useToolExecutionState.ts`, `pendingLocalFilter.ts`, `useCodemanDiffLogger.ts`, `debug.routes.ts`).
- 15.3-arc legacy guards (all of them).
- Item 3 `usePromptDetection.ts`.
- M7 / M8 / Phase T surfaces.
- `useSessionPaneActivity.ts` + ContextBar Finalizer Track 1 surface.
- Candidate 41 `pendingLocalFilter.ts`.
- `~/Desktop/Projects/jstudio-meta/**` (OS + standards + templates).
- `~/.claude/**` (skills + bootstraps).
- Any test file.

---

## §7 — Acceptance gates (Jose browser-equivalent smoke)

Per CTO extra acceptance criterion:

### Gate A — Bundle produces

`pnpm tauri build` (or equivalent) runs clean and produces `Commander.app` in the expected output directory. Document the exact command + output path in commit body.

### Gate B — Launch works

Double-click `Commander.app` in Finder. Within 2-3 seconds:
- Native Commander window opens (Dock icon appears, window frame is native).
- Window contents render the React app exactly as `pnpm dev` would in a browser.
- Session sidebar populates from SQLite.

### Gate C — Phase T smoke (regression guard, LOAD-BEARING) — CTO-ratified explicit 7-step path

CODER executes the sequence on their own machine before commit. Jose re-runs on his machine for ship-green authorization. **Any one step failing = Gate C FAIL = N1 is not done.**

1. **Launch `Commander.app` from the Applications folder** (real bundle path, not `pnpm tauri dev`). Confirms the bundled `.app` works, not just the dev harness.
2. **Spawn a CODER session on any JStudio project** (via CreateSessionModal). Use a real project — e.g. `~/Desktop/Projects/jstudio-commander/` or any active JStudio repo.
3. **Wait for Phase T mirror to render at least one tmux pane capture.** Live Terminal pane should show session startup content within ~3-5s.
4. **Send a simple command** (e.g. `ls`) via the session's ContextBar input.
5. **Observe all of:**
   - Tool chip renders in ChatThread (Bash tool chip for `ls`).
   - ContextBar transitions Working → Idle on completion (ground-truth signal per Finalizer Track 1).
6. **Kill `Commander.app` via Cmd+Q.** Window closes cleanly.
7. **Verify zero orphan Node processes:**
   - `ps aux | grep -i commander` returns no sidecar processes.
   - `ps aux | grep node` returns no Commander-related Node processes.

Any step failing = the sidecar architecture isn't cleanly preserving existing Commander behavior, which breaks the whole Option Z premise. Do NOT ship N1 with a Gate C regression.

### Gate D — SQLite lock release (supplemental to Gate C's process cleanup)

After Cmd+Q + zero orphan Node processes confirmed (Gate C step 7), verify `~/.jstudio-commander/commander.db` lock is released. Simplest check: `sqlite3 ~/.jstudio-commander/commander.db ".schema sessions"` should return without a "database is locked" error.

Ship NOT claimed green until Jose runs Gates A + B + C (all 7 steps) + D and confirms all pass.

---

## §8 — Rejection triggers

(a) Any UI change (client/src/** touched).
(b) Any business logic change (server/src/services/**, routes/**, event-bus/** touched).
(c) IPC features added (Tauri `invoke` commands exposed to client).
(d) OS integration features (notifications, shortcuts, menu bar, dock, deep links).
(e) node-pty attached or terminal emulator introduced.
(f) Legacy guards deleted or modified.
(g) Rust modules outside (i) config + (ii) sidecar lifecycle. IPC bridge placeholder is OK only if CODER determines it's a prerequisite for sidecar lifecycle management.
(h) Cross-platform configuration added (Windows / Linux build targets).
(i) Signing / notarization / updater configured.
(j) Regression in Phase T smoke (Gate C failure).
(k) Orphan Node processes after Cmd+Q (Gate D failure).
(l) Test suite regression (any test that was passing stops passing).
(m) Typecheck regression.
(n) Commit LOC exceeds ~500 (excluding generated Tauri boilerplate). N1 should be small — massive diff implies scope creep.

---

## §9 — Commit discipline

Single commit: `feat(native): N1 — Tauri shell + Node sidecar + Commander.app bundle`.

Commit body must include:
- Bundle output path for Gate A.
- Node binary bundling strategy (how the sidecar binary is packaged).
- Sidecar lifecycle mechanism (how spawn/kill is managed).
- Confirmation that Phase T smoke passed (Gate C).
- Confirmation of zero orphan Node processes post-quit (Gate D).
- Line count of Rust code added (should be ~50-150 LOC).
- Any MINOR deviations flagged.
- Architectural framing: N1 ships the scaffold for native architecture; N2 is the first phase that cashes in the structural wins.

Reversible via `git revert` — the commit adds new directory + additive configs, removing it leaves web Commander intact.

---

## §10 — Autonomy + sub-agent guidance

Per `feedback_authorize_autonomous_coder_rotations`:

**CODER authorized for:**
- Self-research into Tauri best practices (their docs at `https://tauri.app/v2/guides/` — do read them).
- Spawning sub-agent to audit existing Commander server's startup path (identify where static file serving happens, where port is chosen, whether any env flags gate native-shell compatibility).
- Self-dogfood on own machine (Jose will do the acceptance smoke).
- MINOR deviations inline with PHASE_REPORT notation.

**CODER blocked for:**
- Writing Rust business logic (only config + lifecycle).
- Modifying client or server business code (per §3, §6, §8).
- Expanding scope into N2 features (node-pty, terminal emulator, IPC commands, OS integrations).
- MAJOR decisions (unbudgeted scope, architectural deviations) — flag to PM.

---

## §11 — Expected duration

- CODER Tauri project scaffold + Cargo.toml + tauri.conf.json: ~1 hour.
- Sidecar lifecycle glue + server bundling: ~1-2 hours.
- Frontend-from-sidecar wiring: ~1 hour.
- Build target configuration + produce first `Commander.app`: ~1 hour.
- Verification smoke + fix-up cycles: ~1-2 hours.

**Total: ~5-7 hours of focused CODER work.** Allow for Rust-ecosystem friction on first build (dependency compilation, macOS permission prompts for bundle signing, etc.).

If it balloons past ~8 hours with no end in sight, STOP and flag — the sidecar architecture may need a different integration approach (e.g., bundling via `pkg` single-executable instead of `node + server.js`) that warrants PM discussion.

---

## §12 — Standing reminders

Per `feedback_understand_before_patching`: if N1's first build fails, don't stack fixes — read the failure log carefully, research the Tauri pattern, fix the cause. Tauri's failure modes are well-documented; the pattern is likely a known one.

Per `feedback_self_dogfood_applies_to_status_fixes`: CODER's own `Commander.app` launch is the first smoke. Phase T regression should be caught on CODER's machine before Jose ever sees it.

Per `feedback_defer_nonblocking_bugs_to_native_rebuild`: if a web-Commander bug surfaces during N1 smoke that ISN'T a Phase T regression introduced by the sidecar, don't fix it here. Log it + defer. N1 is scaffolding, not bug-fixing.

Per `feedback_phase_report_paste_signal`: explicit "ready to forward to PM" signal at end of PHASE_REPORT.

Per OS §20.LL-L14: if something requires a derivation chain to verify (e.g., "is the sidecar alive?"), check if a ground-truth signal exists first (e.g., `ps` output, port-listen check). Ground truth beats derivation.

Per `feedback_split_large_rotation_on_context_pressure`: this rotation is one commit, not multi-track. Context pressure isn't expected. If it surfaces, the commit ships as-is and N1 partial is deferred to a second attempt.

Go signal pending Jose ratification.
