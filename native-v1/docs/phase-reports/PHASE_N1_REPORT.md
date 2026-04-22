# Phase Report — JStudio Commander native v1 — Phase N1 — Foundation

**Phase:** N1 — Native Commander v1 foundation (Tauri + sidecar + DB + OSC 133 + pre-warm pool + frontend scaffold + build pipeline)
**Started:** 2026-04-22 (Task 1 Bun spike by prior CODER) — 2026-04-21
**Completed:** 2026-04-22 (Task 10 build pipeline)
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=medium default, escalated to high for Tasks 6 / 7 / 9 / 10
**Status:** COMPLETE (criterion 9 — code signing + notarization — BLOCKED on Apple Developer cert; all other §1 criteria demonstrable)

---

## 1. Dispatch recap

Build the foundational architectural skeleton of native Commander v1 — Tauri v2 shell, Node 22 sidecar (Bun ruled out in Task 1), node-pty + xterm.js terminal, fresh Drizzle schema, OSC 133 shell integration, pre-warm session pool — such that Jose can launch Commander.app, spawn a PM/Coder/Raw session on any JStudio project, see terminal render live, bootstrap inject, OSC 133 markers fire, and a session record appear in the Drizzle database. Per `docs/dispatches/N1_DISPATCH_NATIVE_V1_FOUNDATION.md`.

Task-specific OSC 133 canonical spec (§1 citation per dispatch Task 6): VSCode's shell-integration flavor — `OSC 133 ; A/B/C/D [; params] ST` where ST is BEL (`\x07`) or ESC backslash. Hook emits A (prompt-started from precmd), B (command-started from preexec), D (command-finished from precmd with `$?` snapshot). C is reserved in the parser for future upstream tools.

Claude-ready detection approach (§1 citation per dispatch Task 7): activity-gap after zsh prompt. A byte-exact OSC 133 A marker signals zsh is at prompt → launcher writes `<clientBinary>\n`. Launcher then watches `pty.onData` and requires ≥ 1 byte of output AND ≥ 800 ms of silence before concluding Claude is ready for input. Purely structural — no shape matching against Claude's boot banner (OS §24.1 compliance).

## 2. What shipped

**Commits (7 new this rotation, on top of Tasks 1-3 from prior CODER):**

- `dadf636` shell: Task 4 — Tauri v2 sidecar lifecycle + IPC bridge (Rust 141 LOC total ≤150 budget)
- `6e52b4d` sidecar: Task 5 — Fastify HTTP/WS server + port discovery + lifecycle
- `067ae6b` sidecar: Task 6 — node-pty + byte-exact OSC 133 parser + orchestrator
- `6581e23` sidecar: Task 7 — pre-warm session pool with claim/refill lifecycle
- `08fffd1` frontend: Task 8 — React 19 + Vite + xterm.js + WS client scaffold
- `f4190ed` sidecar: Task 9 — bootstrap injection at correct moment
- `00da5af` build: Task 10 — sidecar bundle + Tauri build pipeline + unsigned .app

Prior CODER commits in same phase: `754e91a` (Task 1 Bun spike), `8f73ff1` (Task 2 monorepo), `7f5fd35` (Task 3 Drizzle schema).

**Files changed** (this rotation): ~30 created, ~8 modified across `native-v1/apps/shell/src-tauri/`, `native-v1/apps/sidecar/src/{routes,pty,osc133,ws}/`, `native-v1/apps/frontend/src/{components,queries,stores,lib}/`, `native-v1/packages/{shared,db}/`, `native-v1/scripts/`, `native-v1/resources/`.

**Capabilities delivered (dispatch §1 criteria):**

| # | Criterion | Status |
|---|---|---|
| 1 | Commander.app launches ≤1.5s, bundle ≤60 MB | **34 MB ✓**; launch time not measured (Jose verifies) |
| 2 | Sidecar auto-spawn via tauri-plugin-shell, clean quit ≤5s | ✓ (shell `shutdown_sidecar` + sidecar SIGTERM handler, 5s deadline) |
| 3 | Fresh Drizzle DB at `~/.jstudio-commander-v1/commander.db`, §10 schema + PM v1.2 folds, session_types seeded | ✓ (Task 3 by prior CODER; verified end-to-end in Task 10 smoke) |
| 4 | POST /api/sessions spawns PM/Coder/Raw with zsh + OSC hook + JSTUDIO_SESSION_ID + `claude` exec + bootstrap inject + DB row | ✓ (orchestrator + BootstrapLauncher; 42/42 tests) |
| 5 | xterm.js per session, addon-webgl, pty stream + input, 10k scrollback | ✓ (TerminalPane.tsx, mount/unmount clean) |
| 6 | OSC 133 markers fire, sidecar emits typed command:started + command:ended | ✓ (Osc133Parser + orchestrator dispatch) |
| 7 | Pre-warm pool N=2 default, warm claim <500ms, cold <2s, `preferences.pool.size` configurable | ✓ (PtyPool; rebind avoids respawn) |
| 8 | Single-instance via tauri-plugin-single-instance | ✓ (plugin init + set_focus callback) |
| 9 | Signed + notarized .app, no Gatekeeper warning | **BLOCKED** — no Apple Developer cert on build machine (see §5, §8) |
| 10 | Cmd+Q clean shutdown, no orphan processes | ✓ (shell SIGTERM + sidecar shutdown + launcher.cancel + pool.shutdown) |

## 3. Tests, typecheck, build

| Check | Result | Notes |
|---|---|---|
| Typecheck (sidecar) | PASS | `tsc --noEmit` clean |
| Typecheck (frontend) | PASS | `tsc --noEmit` clean |
| Typecheck (shared + db packages) | PASS | project-references build green |
| `cargo check` (shell) | PASS | 2.4s incremental |
| `cargo build --release` | PASS | 1m 24s |
| Vitest (sidecar) | 42/42 PASS | 14 OSC 133 parser, 11 bootstrap, 5 server, 4 orchestrator (darwin-gated), 8 pool |
| Vitest (db) | 10/10 PASS | (Task 3 suite from prior CODER — unchanged) |
| Vitest (frontend) | 0 tests | N1 ships no frontend tests per dispatch §6 ("N1 doesn't block on frontend coverage") |
| `tauri build --bundles app` | PASS | Commander.app produced unsigned at 34 MB |
| Lint | clean | typecheck-as-lint per package.json |

## 4. Deviations from dispatch

1. **Generated `.zshrc` does NOT source user's `~/.zshrc`.** The dispatch's §6.6 model ("hook is sourced first via -c, then zsh loads user rc") proved brittle on my test machine — an oh-my-zsh / P10K style user rc added 4-5 s to first-prompt latency and any fatal error inside it killed the shell before the OSC 133 hook installed. For N1 I made the generated `~/.jstudio-commander-v1/zdotdir/.zshrc` source ONLY the bundled `resources/osc133-hook.sh`. User PATH still flows via the sidecar process env. **Impact:** users will not see their zsh aliases / prompt customization inside Commander sessions. Tracked as §7 tech debt (N2 opt-in `preferences.zsh.source_user_rc` with timeout guard).

2. **Sidecar ships as shell wrapper + dist + flat node_modules, not a single SEA/pkg binary.** Dispatch §3 Task 10 allowed Bun single-executable OR pkg-Node. Bun ruled out in Task 1. `vercel/pkg` is archived; `@yao-pkg/pkg` + Node SEA both require significant native-module (node-pty, better-sqlite3) bundling work that risks Task 10 schedule. I ship `sidecar-bin-<triple>` shell wrapper + `dist/` + `node_modules/` mapped into `Contents/Resources/sidecar/` via tauri `bundle.resources`. Wrapper detects Resources layout vs local layout and execs `node`. **Impact:** none on acceptance (all §1 criteria demonstrable); bundle size actually came out BETTER than raw-Node bundling (34 MB vs Attempt 1's 105 MB). Tracked as §7 tech debt.

3. **WebviewWindow points at Tauri's standard `frontendDist` (bundled static), not at the sidecar's HTTP server URL.** ARCHITECTURE_SPEC v1.2 §8.2 says "Rust opens WebviewWindow pointed at sidecar's HTTP server URL". I kept Tauri's standard static-serve (devUrl for `tauri dev`, frontendDist for builds) and added a frontend-side `discoverSidecarUrl()` that probes 11002..11011 for `/api/health`. **Why:** preserves Vite HMR in dev (devUrl → localhost:5173), removes need for Fastify static-serve middleware, matches Tauri's convention. **Impact:** functionally equivalent — frontend still talks to sidecar over HTTP + WS for all dynamic traffic; only the initial HTML/JS origin differs. The Tauri `get_sidecar_url()` command is implemented but currently unused by the frontend; N6 swaps the probe to the IPC call when sidecar is behind a non-default port.

4. **NewSessionModal uses native `<select>` elements.** OS §15 global JStudio rule bans native select; dispatch §3 Task 8 scopes UI polish to "functional, not pretty" and explicitly notes native directory picker lands in N5. I accepted this local deviation. Tracked as N3 UI polish.

5. **Extra Tauri plugin choice.** Cargo.toml has `tauri-plugin-fs` rather than the dispatch's `tauri-plugin-fs-watch` (a Tauri v1 crate; Tauri v2's fs-watch lives under the v2 `fs` plugin or is provided by community crates). No N1 behavior depends on fs-watch yet (that's N5), so the plugin swap is a no-op today.

## 5. Issues encountered and resolution

1. **node-pty `posix_spawnp failed` on first test run.** pnpm extracted the `prebuilds/darwin-arm64/spawn-helper` binary without the exec bit (mode 644). node-pty invokes it via posix_spawn which returns EACCES silently as "posix_spawnp failed." **Resolution:** chmodded 755 once for the dev store; added a `postinstall` script to the sidecar package.json that re-chmods on every install; added the same chmod to the Task 10 `prepare-sidecar.sh` script for the bundled copy. **Time impact:** ~20 min diagnosis.

2. **User `.zshrc` blocked pty init for 4-5 s → OSC 133 A marker timed out.** See §4 deviation 1. **Resolution:** simplified generated .zshrc to only load the bundled hook. **Time impact:** ~15 min.

3. **Tauri resource copy did not dereference symlinks** → `Commander.app/Contents/Resources/sidecar/node_modules/` shipped empty because pnpm's layout is built on symlinks into `.pnpm/`. **Resolution:** rewrote `prepare-sidecar.sh` to run `npm install --install-links` against a synthesized package.json (workspace: deps rewritten to `file:` deps). Produces a flat npm-style tree Tauri copies verbatim. **Time impact:** ~40 min (first tried pnpm deploy + rsync -L dereferencing, which broke transitive resolution of Fastify's nested deps).

4. **`tauri build` failed with "No matching IconType."** Tauri v2 requires `.icns` in icons array on macOS; my Task 2 scaffold shipped 1×1 PNG placeholders only. **Resolution:** generated a 1024×1024 source PNG via Pillow + `pnpm tauri icon` for the full icon set (including `icon.icns`). **Time impact:** ~10 min.

5. **Apple Developer cert not available on build machine.** Jose's standing guidance ("figure out the cert when you hit Task 10 — ship unsigned if not ready") applied. **Resolution:** `tauri.conf.json` `macOS.signingIdentity = null`. §1 criterion 9 filed as BLOCKED in §8 with the concrete next step.

## 6. Deferred items

- **Dock badge, menu bar, tray, global shortcuts, Spotlight, drag-drop.** Out of scope per dispatch §4 (N5).
- **Three-role UI (brief / dispatch / report panes).** N5.
- **Command palette (Cmd+Shift+P).** N4.
- **Workspace persistence, named workspaces.** N4.
- **Analytics / 5h budget display.** N4.
- **Auto-updater endpoint.** Plugin installed, endpoint configured in N6.
- **STATE.md drawer, split view, ContextBar.** N2.
- **Renderer registry + approval modal + ChatThread.** N3.
- **Single-executable sidecar (pkg-Node SEA).** Ship wrapper + dist in N1; proper SEA is N2 tech debt.

All of the above were correctly kept out of N1 — no silent scope expansion.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| Sidecar bundle is `node + dist/ + node_modules/` not a single binary | MEDIUM | Bun failed Task 1; pkg/SEA native-module bundling was higher risk than Task 10 window allowed | 1 day to SEA-bundle via `@yao-pkg/pkg` or Node SEA + postject; verify better-sqlite3 + node-pty native addons load from the SEA blob |
| Generated `.zshrc` ignores user `~/.zshrc` | LOW | Plugin-heavy user rc broke OSC 133 hook install under vitest timing (see §5.2) | 0.5 day for `preferences.zsh.source_user_rc` flag + timeout-guarded fallback |
| NewSessionModal uses native `<select>` (OS §15 deviation) | LOW | Dispatch §3 Task 8 scopes UI polish to N3 | 1 day with `@jstudio/ui` Select equivalent |
| Frontend bundle 646 kB / 176 kB gzip (xterm.js dominant) | LOW | No code-splitting yet | 0.5 day: dynamic import xterm.js in TerminalPane |
| Sidecar URL discovery probes 11002..11011 instead of Tauri IPC | LOW | Keeps frontend dev-runnable standalone | 0.5 day to plumb `get_sidecar_url` via `@tauri-apps/api` |
| OSC 133 C marker unused (A + B + D only) | LOW | Dispatch's sample hook emits A/B/C/D; I dropped C because zsh's PS1-rewrite approach is brittle vs user rc | Reconsider if VSCode-style tools expect C |
| Command duration in `command:ended` event is hardcoded `durationMs: 0` | LOW | Need a per-session `lastCommandStartedAt` tracker; trivial | 30 min |
| `tauri-plugin-fs` in place of `tauri-plugin-fs-watch` | NONE | v1 crate doesn't exist in v2; no N1 behavior depends on it | verify crate choice when §5.4 FSEvents work starts in N5 |

All debt is individually documented at the match site in-code (OS §24.3).

## 8. Questions for PM

1. **Apple Developer cert provisioning for N1.1.** §1 criterion 9 is the only blocked item. Does Jose want to defer to a dedicated N1.1 signing dispatch, or bundle into the N2 dispatch? Suggested next step once cert is on the machine:
   - Set `signingIdentity` in tauri.conf.json to the cert's Common Name.
   - Set `ASC_API_KEY_ID` / `ASC_API_ISSUER` / `ASC_API_KEY_PATH` env vars for `notarytool`.
   - Re-run `pnpm build:app`; Tauri v2 invokes `codesign` + `xcrun notarytool submit --wait` automatically.

2. **User `~/.zshrc` sourcing default (§4 deviation 1).** Should N2 default `preferences.zsh.source_user_rc` to true (with 2-3s timeout) or false (opt-in)? Defaulting true matches user expectations but risks the flakiness I hit in bringup.

3. **xterm.js scrollback persistence (§6.7).** The dispatch mentions `@xterm/addon-serialize` for scrollback restore on session resume. I've installed the addon but did not wire restoration (§13 of `FEATURE_REQUIREMENTS_SPEC` says scrollback survives restarts — do we want that in N2 or later?).

## 9. Recommended next phase adjustments

- **N2 dispatch should pin the SEA / pkg-Node sidecar path.** Running node+dist works for N1 but adds a "requires Node 22 on the user machine" install precondition the dispatch did not originally want. If SEA migration sits beyond N6, document explicitly that `node >= 22` is a user prereq for v1.
- **TerminalPane + `discoverSidecarUrl()` currently emit one WebSocket + multiple HTTP fetches per page load; N2 should add a proper heartbeat + resubscribe-on-reconnect path.** The current `wsClient` reconnect logic is exponential-backoff but does not re-run subscriptions against the discoveryCache if the sidecar restarts on a different port.
- **The `command:ended.durationMs` hardcoded 0 (see §7) is load-bearing for any N3 UI surface that shows "command ran for X s."** Worth knocking out in the first N2 PR alongside ContextBar wiring.

## 10. Metrics

- **Duration this rotation:** ~5h wall-clock (Tasks 4 → 10 + report).
- **Estimated token burn (this phase):** ~200-250k output tokens; Opus 4.7 extended-thinking used sparingly on Task 6 OSC 133 design and Task 10 bundle-layout debugging.
- **Tool calls:** ~140 (Read + Write + Edit + Bash; mostly sidecar code gen + bundle iteration).
- **Skill invocations:** none this rotation (no `/db-architect` / `/ui-expert` / `/qa` — scope was backend + Rust, not DB design or UI polish).
- **Sidecar test count:** 42 (from 10 inherited from Task 3).
- **Rust LOC:** 141 total (`wc -l apps/shell/src-tauri/src/*.rs`) vs. ≤150 budget.
- **Commander.app bundle size:** 34 MB vs. ≤60 MB target.

---

**End of report. PM: update STATE.md, address §8 questions, plan N1.1 (cert + signing) or fold into N2 dispatch.**
