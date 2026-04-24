# Archived Native-v1 Forensic Audit

**Audit date:** 2026-04-24
**Scope:** `/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/`
**Archive commit:** `dc8a0f6` (2026-04-22)
**Archive marker:** `docs(n2.1.6): Jose smoke — Bug D fixed, Bug K residual, kill-session wiring broken`

## 1. Architectural shape

Native-v1 was a macOS-only desktop rebuild of web-Commander, structured as a pnpm/Turborepo monorepo with three run-time tiers and two pure packages:

- **`apps/shell/`** — Tauri v2 Rust shell. Scope intentionally capped at ≤150 LOC (`apps/shell/src-tauri/src/lib.rs:150` exactly). Owned only: window lifecycle, sidecar child-process spawn/restart/shutdown, tauri-plugin-{shell, single-instance, updater, fs, dialog}, and one IPC command `get_sidecar_url()`. All business logic forbidden.
- **`apps/sidecar/`** — Node 22 LTS + Fastify HTTP/WS server + node-pty + Drizzle (better-sqlite3). Owns pty orchestration, OSC 133 parsing, pre-warm pool, bootstrap injection, workspace persistence, scrollback, FSEvents file watch, ~80 vitest specs.
- **`apps/frontend/`** — React 19 + Vite + Tailwind v4 + xterm.js (WebGL + Fit + Search + Serialize addons) + TanStack Query + Zustand. Discovered sidecar URL via port-scan 11002-11011 against `/api/health`.
- **`packages/shared/`** — typed IPC event union (`packages/shared/src/events.ts:126-140` — 14 discriminated variants with `assertNeverEvent` helper), session-state machine, session-type enum.
- **`packages/db/`** — Drizzle schema + migrations + seed.

**Process model.** One shell process → spawns one sidecar process (Rust `tauri-plugin-shell::sidecar()`) → sidecar spawns one zsh per session via node-pty → zsh execs `claude` inside the pty. Frontend webview is Tauri's standard `frontendDist` (static serve), not routed through sidecar HTTP.

**Runtime packaging.** Rejected Bun (N1 Task 1 spike — `docs/n1-spikes/bun-verification-result.md`) because `node-pty.onData` never fired under Bun 1.3.13 (N-API/libuv incompatibility with node-pty's kevent read loop; 0 bytes delivered vs 16 bytes under Node). pkg-Node and Node SEA with native modules (node-pty, better-sqlite3) also failed (`posix_spawnp` errors with pkg-bundled addons). Shipped as shell wrapper + `dist/` + flat npm-deployed `node_modules/` under `Commander.app/Contents/Resources/sidecar/`. Final bundle 35 MB.

**IPC topology.** HTTP REST for CRUD (`/api/sessions`, `/api/projects`, `/api/workspaces/current`, `/api/preferences/:key`, `/api/sessions/:id/scrollback`). Single WebSocket for typed event bus (`pty:data`, `pty:input`, `session:state`, `command:started/ended`, `session:created/status/stopped`, `system:warning/error/info`, `project:file-changed`, `pong`). No bidirectional RPC; mutations go HTTP, streams go WS.

## 2. Scope progression

Nine phases executed in three weeks (2026-04-21 → 2026-04-22):

| Phase | Goal | Result |
|---|---|---|
| **N1** — Foundation | Tauri + sidecar + DB + OSC 133 + pool + frontend scaffold + build | CLOSED. 34 MB bundle, 42/42 tests, 141/150 Rust LOC. Criterion 9 (signing) indefinitely deferred. |
| **N2** — UI surfaces + SEA | ContextBar, STATE.md drawer, split-view, workspace persistence, scrollback restore, `.zshrc` opt-in, duration tracking, WS heartbeat, SEA bundle | CLOSED with SEA ESCALATED (Node 22 runtime has ~65 MB stripped floor; `@yao-pkg/pkg` workspace-resolution broken). 58/58 tests, 35 MB bundle. |
| **N2.1** — Sidecar hotfix | Fix "Sidecar unreachable" from Jose's first dogfood | CLOSED. Two stacked root causes (Rust `SIDECAR_BIN` constant mismatch + wrapper Finder-PATH missing `node`). 71/71 tests. |
| **N2.1.1** — Webview fetch | Fix CORS/CSP after N2.1 revealed sidecar was reachable to curl but not to webview | CLOSED. Added `@fastify/cors` + explicit Tauri CSP for `connect-src http://127.0.0.1:*`. |
| **N2.1.2** — Modal selection | Fix path-picker + session-type dropdown not committing selections | CLOSED. Root cause: TanStack Query `useMutation` return value is NOT React-stable; its presence in a `useEffect` dep array wiped user selections on every render. |
| **N2.1.3** — OSC hook path + claude PATH | Production-bundle Claude Code never spawns | CLOSED with TWO root causes: Tauri bundle put hook at `Resources/resources/`, sidecar resolved to `Resources/sidecar/resources/`; AND wrapper PATH missed user Node-global bin where `claude` lives. |
| **N2.1.4** — Bootstrap autosend + pane focus | Bootstrap content buffered as Claude paste without submit; pane-2 keystrokes routed to pane-1 | CLOSED. Sidecar-side: Claude TUI paste-buffer commits only on `\r`, not `\n`. Frontend-side: Zustand `focusedIndex` never called `xterm.focus()`. |
| **N2.1.5** — Cold-launch bootstrap + xterm render | First cold-launch autosend fails; xterm mount renders artifacts | CLOSED with Bug D residual. Added bracketed-paste wrappers + post-write quiesce + 3s hard deadline; `requestAnimationFrame`-deferred `fit.fit()`. Jose's cold-boot routinely exceeded 3s; Bug K (UTF-8 mojibake) surfaced instead of fully fixing Bug H. |
| **N2.1.6** — Deterministic Claude-ready signal + mojibake + kill-session | Fix Bug D with OSC-title gate + quiet period; fix Bug K at scrollback decode boundary; add trash-button affordance | **NOT CLOSED. ARCHIVED.** Bug D fixed via hybrid signal; Bug K scrollback-path fixed but live-stream path still corrupts; kill-session backend verified working via direct probe but frontend click-chain broken. |

Five hotfix rotations (N2.1.1 → N2.1.6) compressed into 24 hours. PHASE_N2.1.6_REPORT §9 notes: "Root-cause stacking pattern (4th observation). N2.1.3 (OSC path + PATH) → N2.1.4 (pty.stdin + DOM focus) → N2.1.5 (timing + render) → N2.1.6 (signal + encoding + lifecycle). Independent root causes in every rotation."

## 3. The bugs that stopped it

### Bug D — Cold-launch bootstrap autosend (evolved across 3 rotations)

- **Symptom.** First cold-launch after full-kill: PM bootstrap appears as `[Pasted text #N]` paste placeholder; Jose must press Enter; Jose's first typed input concatenated to bootstrap.
- **Root causes discovered sequentially:** (N2.1.4) Claude's Ink TUI treats multi-line pty.stdin as a paste buffer; only `\r` (not `\n`) commits. (N2.1.5) Content-then-`\r` with fixed 200ms delay races Claude's boot — the 800ms pty-quiet window fires before Claude's paste handler is registered. (N2.1.6) Chunk-gap quiet heuristic with 3s hard deadline — too short for Jose's machine (~10s boot stalls common).
- **Attempted fixes.** (`N2.1.4-bootstrap-autosend-evidence.md:136`) add `\r` submit after 200ms delay → works on warm, fails on cold. (`N2.1.5-bug-d-evidence.md:124`) bracketed-paste wrappers (`\x1b[200~…\x1b[201~`) + post-write quiesce loop + 3s hard deadline → 5/6 in CODER probe but still fails Jose's common-case. (`N2.1.6-bug-d-deterministic-signal-evidence.md`) hybrid signal — first OSC title emission = structural gate; post-gate quiet period = timing signal; 30s readyTimeout fallback with `system:warning` event.
- **Final status.** FIXED in archive. Jose smoke confirmed "Session bootstrap si working from the get go."
- **Lesson for JS WorkStation.** Claude Code TUI state transitions are not observable via a single primitive. Need **composite signal detection** — structural gate (OSC, byte-pattern) + timing (quiet period) + hard fallback with user-visible warning. Never rely on a single time-based deadline when the substrate (Claude Code) is variable.

### Bug K — UTF-8 mojibake in scrollback (residual at archive)

- **Symptom.** Text fills with `â`/`â¢`/`âµ`/`â³`. Progressive degradation on session-switch + app-restart. Screenshot-verified by Jose.
- **Root cause.** (`N2.1.6-bug-k-mojibake-evidence.md:81`) `atob(blob)` returns a binary "string" where each JS char is one raw UTF-8 byte (0-255). Passing that to `term.write(stringValue)` makes xterm treat each UTF-8 byte as a Latin-1 codepoint; `0xE2` (start of em-dash / bullet / box-drawing) renders as U+00E2 = `â`. Writer-side (`btoa(unescape(encodeURIComponent(raw)))`) was correct; sidecar `Buffer` pipeline preserves bytes; only the reader's string/bytes interface was wrong. Each round-trip re-mojibakes already-mojibake bytes → progressive.
- **Attempted fix.** (`apps/frontend/src/components/TerminalPane.tsx:127`) Replace `term.write(atob(blob))` with `term.write(Uint8Array.from(atob(blob), c => c.charCodeAt(0)))`. xterm.js v5+ accepts `Uint8Array` and UTF-8-decodes internally (per xtermjs PR #1904).
- **Final status.** RESIDUAL at archive. Scrollback round-trip probe verified via `/tmp/n2.1.6-verify-kill-k.mjs` returns clean bytes, but Jose's smoke showed session-switch still corrupts: *"very buggy screen with the texs and all that still, especially when changing sessions."* The scrollback-restore decode path was fixed; the **live pty-data → term.write path was not touched** and the session-switch re-restore path may still invoke the old write shape.
- **Lesson for JS WorkStation.** Establish **bytes-direct invariant at module boundaries**. Never round-trip terminal bytes through JS strings unless explicitly UTF-8-decoded. Encode/decode boundaries deserve round-trip unit tests, not only integration tests.

### Bug H — xterm mount layout race

- **Symptom.** Terminal renders with overlapping text, wrong line breaks, self-repairs on first keystroke.
- **Root cause.** (`N2.1.5-bug-h-evidence.md:70`) `fit.fit()` called synchronously on the same microtask as `term.open()` inside a `flex-1` child of `flex-1` parent — `getBoundingClientRect` returns pre-layout dimensions; WebGL atlas caches against miscomputed cell metrics; scrollback writes render into the bad atlas. First keystroke triggers re-measure → repair. Upstream pattern matches xtermjs/xterm.js issues #5320, #4841, #3584, #2394.
- **Fix.** `requestAnimationFrame(() => fit.fit())`. One-line change.
- **Final status.** FIXED in archive. Jose: *"The laying and text issue was better at first."*
- **Lesson.** xterm.js fit-addon timing is a known class of bug. Always defer first `fit()` to rAF; never call on same tick as `term.open()`.

### Bug E — Pane input routing

- **Symptom.** Keystrokes to pane 2 land in pane 1's xterm.
- **Root cause.** (`N2.1.4-pane-input-routing-evidence.md:42`) Zero call sites of `Terminal.focus()` anywhere in `apps/frontend/src/`. Zustand `focusedPaneIndex` only drove the focus-border style; DOM focus on xterm textareas was whatever React last painted.
- **Fix.** Propagate `focused` prop from SessionPane into TerminalPane; `useEffect(() => { if (focused) termRef.current?.focus(); }, [focused])`.
- **Final status.** FIXED in archive.
- **Lesson.** Zustand state and DOM focus are parallel universes. Bridge them explicitly. Frontend React-based design needs **imperative handles for DOM-native widgets** — xterm, `<input>`, `<dialog>`, IME composition.

### Bug N2.1.2 — TanStack Query mutation object identity

- **Symptom.** Path picker selection reset itself; session-type stayed on PM.
- **Root cause.** (`N2.1.2-modal-selection-evidence.md:68`) `const createMutation = useCreateSession()` returns a **fresh object every render** from TanStack Query v5's `useMutation`. Its `.mutate` / `.reset` callbacks are stable; the wrapper object is not. A reset-effect keyed `[open, createMutation]` fires on every render and wipes user selections.
- **Fix.** Drop `createMutation` from the dep array; read `.reset` off it inside the body (which reads the current render's stable callback).
- **Final status.** FIXED.
- **Lesson.** **Never include TanStack Query hook-wrapper return values in `useEffect` dep arrays.** Only include the handles (`mutateAsync`, scalar state) that are individually stable. This surfaced again in memory as a cross-cutting invariant.

### Bug N2.1.1 — CORS/CSP (webview ≠ curl)

- **Symptom.** "Sidecar unreachable — tried 127.0.0.1:11002..11011" in production .app; `curl` to sidecar works fine; `ps aux` shows sidecar running.
- **Root cause.** (`N2.1.1-webview-fetch-evidence.md:44`) Tauri webview origin is `tauri://localhost`; sidecar is `http://127.0.0.1:11002`. Triply cross-origin. No `@fastify/cors` registered; response lacked `Access-Control-Allow-Origin`. Tauri `csp: null` leaves WKWebView's default policy in place.
- **Fix.** Register `@fastify/cors` with localhost-scoped policy + explicit Tauri CSP `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*`.
- **Lesson.** **A curl test for a sidecar is not a smoke test for its consumer.** Must test through the actual consumer transport (webview fetch) — documented in `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md §4.2`.

### Bug N2.1.3 — Bundle-resource-path mismatch (two stacked)

- **Root cause A.** (`N2.1.3-osc-path-evidence.md:102`) Tauri's `bundle.resources` mapping put `osc133-hook.sh` at `Contents/Resources/resources/osc133-hook.sh` (top-level), but `resolveHookPath()` fallback resolved to `Contents/Resources/sidecar/resources/osc133-hook.sh` (nested under sidecar/). Hook never loaded → no OSC 133 A marker → bootstrap launcher never fires.
- **Root cause B.** (`N2.1.3-claude-path-evidence.md:59`) `claude` lives under `/Users/.../.nvm/.../bin/claude` — user-install NVM path. Finder-launched `.app` gets `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Even once hook path worked, zsh responded `command not found: claude`.
- **Fix.** (A) Rust-side `PathResolver → app.path().resource_dir()` → `JSTUDIO_OSC133_HOOK_PATH` env var to sidecar. (B) Sidecar wrapper augments PATH with `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`, NVM-discovered dir, `$HOME/.claude/local`.
- **Lesson.** Bundle-resource paths must be resolved by the substrate that writes the bundle (Rust/Tauri), never inferred `__dirname`-relative from runtime code.

## 4. The kill-session residual at archive

(Same rotation as archive commit `dc8a0f6`.)

**Symptom per Jose's smoke.** Trash button clickable, confirm modal opens, clicking "Stop and remove" does NOTHING. PHASE_N2.1.6_REPORT §3: *"Task 3 backend probe passed (DB row removal via direct API call verified) but the frontend-click → API path is broken."*

**Backend wiring (confirmed healthy):**
- `apps/sidecar/src/pty/orchestrator.ts:273` — `deleteSession()` SIGTERM → 5s wait → SIGKILL fallback → `db.delete(sessions)` with cascading FKs.
- `apps/sidecar/src/routes/sessions.ts:133` — DELETE route calls `orchestrator.deleteSession ?? orchestrator.stopSession`.
- Direct probe verified: POST → spawn, DELETE → 200, GET → 404, pid cleaned up.

**Frontend wiring (traced):**
- `apps/frontend/src/queries/sessions.ts:65` — `useStopSession()` returns `useMutation({ mutationFn: (id) => httpJson(...DELETE...) })`. Identical shape to the TanStack Query mutation-identity pattern that broke N2.1.2 — though this one is a mutation call, not a useEffect dep.
- `apps/frontend/src/components/SessionPane.tsx:30-42` — `confirmKill` async function: calls `setPaneSession(index, null)` (optimistic), `setKillConfirmOpen(false)`, then `await killMutation.mutateAsync(sessionId)` in try/catch. On error, restores `setPaneSession(index, sessionId)`. This looks wired correctly at code-read.
- `apps/frontend/src/lib/http.ts:13` — `httpJson` calls `discoverSidecarUrl()` then `fetch(base+path, { method: 'DELETE' })`. Fine.

**Most likely root cause (not diagnosed at archive).** The fresh-port-discovery path (`discoverSidecarUrl()` may be re-probing sidecar URL on the mutate call, and if the cached URL is stale or WS has reconnected on a different port, the DELETE goes to a dead port and silently fails). Alternatively: `httpJson` throws on non-2xx, which the optimistic restore would catch — but at archive, the symptom Jose reports is "does nothing" (no visible error, no pane flicker), which suggests the mutation never fires at all. A useState-captured-stale-closure or modal-mount race with `onClick={e.stopPropagation()}` bubbling behavior is plausible.

**The archive commit didn't produce a diagnostic file for this.** PHASE_N2.1.6_REPORT lists "Likely causes: (1) confirm-button handler not wired to mutation; (2) mutation firing but erroring silently; (3) optimistic UI state change not applied. Needs DevTools Network + Console inspection." Never got that inspection before the decision to rebuild.

**Lesson for JS WorkStation.** When a known-working backend path exists, wire a **persistent "why didn't the button work?" debug surface** — log every mutation invocation with sessionId + resulting HTTP status into a visible panel. At the scale of 1 user (Jose), a DevTools-equivalent always-on log is cheaper than repeated smoke cycles.

## 5. Architectural choices that WORKED

1. **Byte-exact OSC 133 parser** (`apps/sidecar/src/osc133/parser.ts`). Stateful buffer across pty chunks, handles both BEL and ESC-backslash terminators, 4096-byte runaway cap, zero shape-matching against prompt glyphs. 14 vitest specs. Would drop cleanly into any future workstation that needs terminal-side command framing. Cited in OS §24.1 as canonical pattern discipline.

2. **Hybrid Claude-ready signal** (`apps/sidecar/src/pty/bootstrap.ts:197-224`). The pattern "structural gate (count N OSC title emissions) + timing signal (quiet period after gate) + hard timeout fallback with user-visible warning" was the only approach that held Jose's cold-boot regime across 6/6 probes. This pattern is reusable for any Claude TUI interaction (approval-modal paste, slash-command injection, tool-call ack).

3. **Pre-warm pty pool** (`apps/sidecar/src/pty/pool.ts`). 2 warm zshes with OSC 133 hook already installed, idle at first prompt. Claim rebinds callbacks, writes `export JSTUDIO_SESSION_ID=…; cd <cwd>`, async refill. Warm claim <500ms vs cold ~2s. Clean shutdown semantics. 8 specs. Architecturally sound.

4. **Typed WS event bus with exhaustive-check discriminator** (`packages/shared/src/events.ts`). 14-variant discriminated union + `assertNeverEvent` compile-time exhaustiveness. Adding a new variant fails TypeScript at every dispatch site that didn't handle it. Eliminates an entire class of event-drift bugs. This pattern is gold.

5. **Rust-side resource resolution → sidecar env** (`apps/shell/src-tauri/src/lib.rs:51-58`). `app.path().resource_dir()` → `JSTUDIO_OSC133_HOOK_PATH` env var. Cleanly decouples "where bundled resources live" (Tauri's job) from "how the sidecar finds them" (sidecar reads env). Generalizable for any future bundled resource.

6. **Investigation discipline** (codified via G10-G14 guardrails). Every rotation required a diagnostic evidence file committed BEFORE any fix. This caught multiple false PM hypotheses (N2.1.2 arrival hypothesis was wrong; N2.1.6 Task 1 first attempt needed correction in-rotation). The `docs/diagnostics/*-evidence.md` pattern with Layer / Symptom / Root-cause / Fix-shape / Acceptance-plan sections is the single most valuable discipline this attempt produced. Worth inheriting verbatim.

7. **One-way dependency direction in monorepo.** `apps/*` → `packages/*`, `apps` never import other apps, `packages/shared` has zero app dependencies. Matches JStudio blast-wall rules.

## 6. Architectural choices that FAILED

1. **Node SEA / single-binary sidecar bundling.** N2 Task 1 ESCALATED after <60 min: Node 22 runtime is 105 MB raw / ~65 MB stripped. Mathematically can't hit ≤55 MB target with Node. `@yao-pkg/pkg` additionally failed on pnpm workspace symlink resolution. `pkg` + `node-pty` → `posix_spawnp` failure. The "Node 22 prereq on user machine" workaround was a deferred cost the project kept paying.

2. **Fixed-timer paste-commit heuristics.** Three successive attempts (200 ms, 800 ms quiet, 3 s hard deadline) all failed Jose's cold-boot regime because Claude's boot latency is the domain of variance this machinery was supposed to absorb. Only the signal-based hybrid in N2.1.6 held.

3. **Implicit DOM focus management in xterm-hosting components.** Bug E's root cause was a complete absence of `term.focus()` calls anywhere in the app. Relying on browser DOM focus heuristics in a split-pane layout was wrong; needs explicit imperative focus bridging from logical state to DOM focus.

4. **User `~/.zshrc` sourcing policy.** N1 default was NOT to source user rc (because oh-my-zsh / P10K broke hook install). N2 added opt-in `preferences.zsh.source_user_rc` but the subshell-timeout-guard pattern the dispatch specified is infeasible in zsh (subshell exports don't propagate; killing mid-`source` corrupts state). User aliases / prompt customization are gone by default — a persistent papercut.

5. **Test coverage imbalance.** Sidecar reached 100/100 vitest specs. Frontend shipped at 0 React Testing Library tests across all 9 phases. N2.1.6 PHASE_REPORT §6 notes: "Sixth rotation asking [for RTL]. Bug K in particular would have been caught by a scrollback round-trip test." Bugs H, E, K, and likely the kill-session regression would each have been caught by a single RTL test. Deferring frontend tests compounded every rotation's risk.

6. **Frontend URL discovery by port-probe instead of Tauri IPC.** `apps/frontend/src/lib/sidecarUrl.ts` probes 11002-11011. When sidecar restarts on a different port (which the Rust-side respawn logic allows), cache invalidation vs live connections is fragile. Deviation D3 in N1 chose this for dev-mode symmetry, and it held — but "sidecar URL changes mid-session" is an unhandled edge in the current code.

7. **Native `<select>` elements in `NewSessionModal`.** Violates JStudio global rule (OS §15 bans native select; use `@jstudio/ui` Select with portal). Tracked as N3 tech debt, never paid down.

## 7. Why was it archived?

PHASE_N2.1.6_REPORT §3 close: *"N2.1.6 does NOT close. Jose signaled likely architectural restructuring for next rotation ('we are likely going to change a lot of things')."*

The **proximate triggers** at archive time (dc8a0f6 commit message):
- Bug D finally fixed (win).
- Bug K **residual** — decode-layer fix worked for scrollback restore, but live-stream + session-switch paths still mojibake.
- **Kill-session wiring broken** on the frontend side despite backend verified via probe. No DevTools inspection performed.

The **underlying reasons** (inferred from the full progression):
- **Root-cause stacking in every hotfix rotation.** Dispatch authors kept expecting single-root-cause bugs; reality was 2-3 stacked layers per phase (OSC path + PATH in N2.1.3; pty.stdin + DOM focus in N2.1.4; timing + render in N2.1.5; signal + encoding + lifecycle in N2.1.6). Each unfixed layer blocked a smoke gate.
- **Smoke-as-late-verification mismatch.** CODER smoke probes verify backend layers; UI behaviors require Jose smoke. The phase gate was never "CODER probe clean" — always "Jose's Finder-launched `.app` user-facing smoke." By archive, the cycle from CODER commit → Jose smoke → new-bug-discovered → next dispatch was 30-60 min each, and three consecutive rotations had ≥1 FAIL in user-facing smoke.
- **Tauri + Node hybrid operational tax.** Every deployment needed a bash wrapper that discovered Node, a Rust shell coordinating sidecar respawn + resource resolution, a port-discovery probe from webview, CORS middleware on sidecar, CSP config on Tauri. Every layer added its own bug class (N2.1 SIDECAR_BIN constant, N2.1.1 CORS, N2.1.3 bundle path).
- **Jose's common case ≠ CODER's common case.** Cold-boot stalls >10s reproducible on Jose's machine; CODER probes called them "pathological." The variance in Claude Code's internal boot was in the sidecar's problem domain (Bug D three rotations to solve) and would remain so indefinitely.

The archive was a **strategic reset** — keep investigation discipline, abandon the Tauri + Node sidecar architecture. Current rebuild (`command-center/`, outside this audit's scope) chose Tauri + Bun. Further reset to "JS WorkStation" follows.

## 8. What JS WorkStation should INHERIT

1. **Diagnostic-first discipline.** `docs/diagnostics/<phase>-<bug>-evidence.md` with Layer / Symptom / Root-cause / Fix-shape / Acceptance-validation sections, committed BEFORE any fix. Forced CODER to prove a hypothesis before shipping. Caught multiple wrong PM-hypothesis cases mid-rotation.

2. **Byte-exact OSC 133 parser** verbatim from `apps/sidecar/src/osc133/parser.ts`. Reusable across runtime changes.

3. **Hybrid Claude-ready signal pattern** (OSC title gate + quiet period + hard timeout + visible warning). Codify in workstation docs as the canonical "wait for external-tool TUI ready" primitive. Applies to any Claude Code TUI interaction.

4. **Typed WS event bus with `assertNeverEvent` exhaustiveness**. Cheap compile-time protection against event-drift bugs in a system fundamentally made of event streams.

5. **Pre-warm pty/process pool pattern.** If workstation spawns child processes for AI sessions, pre-warm them with init work done (shell config loaded, env ready), claim-on-demand, refill async.

6. **Rust-side resource resolution → env vars to sidecar.** If workstation has any two-tier shell/runtime split, always let the shell own path resolution and pass resolved paths to the runtime via env.

7. **Bytes-direct `term.write(Uint8Array)` idiom** for any scrollback/live-pty-output rendering. Never round-trip through JS strings.

8. **xterm `fit.fit()` via `requestAnimationFrame`**, never on the same tick as `term.open()`. Hard-coded lesson.

9. **Pre-warmed per-session zsh with a bundled hook file + `ZDOTDIR` redirect** (not modifying user `~/.zshrc`). Deterministic shell init, bounded failure mode.

10. **PHASE_REPORT 10-section template** (`~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`) reference in every dispatch. Dispatch recap → What shipped → Tests → Deviations → Issues → Deferred → Tech debt → Questions → Next-phase recs → Metrics. Shipping discipline inheritance.

## 9. What JS WorkStation should AVOID

1. **Node 22 as sidecar runtime.** 65 MB stripped floor blocks any "single binary under 55 MB" target. If workstation wants a single-binary deliverable, pick a runtime with a smaller stripped floor (Bun if node-pty compatibility can be verified with a smoke spike; Rust-native if terminal rendering can live in a library rather than xterm.js).

2. **Wrapper-script-based PATH discovery.** `apps/scripts/prepare-sidecar.sh` walks known Node install paths. Every new user environment that doesn't match adds a support bug. Workstation should either (a) ship its own runtime, (b) use Tauri's own resource resolution end-to-end, or (c) refuse to start and print a clear "install X" message.

3. **Port-probe sidecar URL discovery.** `apps/frontend/src/lib/sidecarUrl.ts` probes 11002-11011 from the webview. When the sidecar restarts on a different port mid-session, cache invalidation is fragile. Workstation should establish a durable process-tree IPC channel (named pipe / Unix socket / stdio) or a fixed known port the substrate enforces.

4. **Deferring frontend unit tests across phases.** 6 rotations × "fold-into-next-phase" × zero tests = every frontend bug shipped was a runtime discovery. Workstation must land RTL/Playwright coverage for mutation paths, focus bridging, xterm mount timing, encoding round-trips, and trash-button-type CRUD affordances as acceptance criteria of the first UI phase.

5. **Fixed-timer heuristics for external-tool readiness.** Three rotations to converge on "don't do this; find a signal." Pre-commit to signal-based waiting; reserve timers only for outer-bound fallbacks with user-visible warnings.

6. **TanStack Query return value in `useEffect` deps.** Codify in memory: only include `mutateAsync`, `isPending`, scalar state in deps — never the wrapper object (`createMutation`, `killMutation`). The N2.1.2 fix pattern was already banked as auto-memory; keep enforcing it.

7. **Single `.zshrc` policy for all user machines.** oh-my-zsh / P10K will break hook install. Either opt-in with timeout guards (doesn't work — zsh can't safely timeout `source`) or accept that user aliases/prompt/PATH are lost (papercut). **Better: don't rely on user shell customization inside the workstation's sessions at all.** Provide workstation-owned shell + prompt + PATH.

8. **Native `<select>` in a custom-UI system.** Violates JStudio OS §15. Use `@jstudio/ui` Select with portal from first UI commit.

9. **Pixel-testing as Jose's responsibility.** UI bugs (Bug H render, Bug K mojibake, kill-session wiring) were always Jose-discovered via smoke. Workstation should ship with a headless UI verification layer (Playwright with screenshots + DOM-diff + visual-regression) so the feedback loop is CODER-internal.

10. **"Wrapper + dist + node_modules" production layout.** Every sub-path (`Contents/Resources/sidecar/dist/`, `.../node_modules/`, `.../resources/`) is a bundle-path bug waiting to happen (N2.1.3 was exactly this). Workstation should ship either a single binary or a Tauri-managed layout with zero manual path-resolution code.

## 10. Salvageable modules

Specific files whose code (or logic) should be adapted into JS WorkStation. Absolute paths.

1. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/osc133/parser.ts`** (175 LOC + test). Complete byte-exact OSC 133 parser with split-chunk handling, BEL + ESC-backslash terminators, exit-code extraction. Plus `parser.test.ts` — 14 specs.

2. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/pty/bootstrap.ts`** (319 LOC). The hybrid-signal BootstrapLauncher state machine (`wait-for-zsh-prompt` → `wait-for-claude-ready` → `wait-for-paste-quiet` → `done/errored`). `OSC_TITLE_RE = /\x1b\][012];[^\x07\x1b]*(?:\x07|\x1b\\)/g` captures the key signal. 80 vitest specs.

3. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/pty/pool.ts`** (196 LOC) + `pool.test.ts`. Pre-warm pty pool with claim/refill lifecycle, ready-signal via OSC 133 A, exit-while-warm handling, size-clamp + shutdown.

4. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/resources/osc133-hook.sh`** (43 LOC). Minimal zsh OSC 133 A/B/D hook with idempotency guard. Drop-in to any project needing shell-integration.

5. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/pty/hook-path.ts`** (110 LOC). `ensureZdotdir()` pattern — generate per-runtime `.zshrc` that sources the bundled hook + optionally user rc, idempotent write, mode-0644 + mode-0755 directory creation. Resolves hook path via env override → dev path → bin-adjacent fallback.

6. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/packages/shared/src/events.ts`** (152 LOC). 14-variant discriminated WS event union + `assertNeverEvent` exhaustive-check helper. The pattern is the gold; the specific variants are adaptable.

7. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/pty/orchestrator.ts:273-294`** — `deleteSession()` SIGTERM → 5s wait → SIGKILL fallback → DB cascade pattern. 22 lines that correctly handle the full pty-process-kill lifecycle.

8. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/sidecar/src/routes/sessions.ts:196-233`** — `appendRecentPath()` move-to-front, JSON-serialized list with cap + corruption-tolerant parse. Pattern for any "recent items" preference.

9. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/frontend/src/components/TerminalPane.tsx:119-128`** — bytes-direct xterm write idiom: `term.write(Uint8Array.from(atob(blob), c => c.charCodeAt(0)))`. Includes the inline comment explaining why. One of the most compact correctness-critical snippets in the codebase.

10. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/apps/shell/src-tauri/src/lib.rs`** (150 LOC). Entire Rust shell as a canonical "minimal Tauri v2 host for a sidecar" template: sidecar spawn, restart with backoff (1/3/9s over 60s window), `on_sidecar_exit` handler, `shutdown_sidecar`, `get_sidecar_url` IPC, `app_quit` IPC, RunEvent handling. If JS WorkStation keeps Tauri, start from this file.

11. **All 16 diagnostic files under `/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/docs/diagnostics/`**. Each is a worked example of the G10/G11 diagnostic discipline with real forensic data, hypothesis ranking, upstream references, and fix-shape specification. Gold for training the diagnostic habit into JS WorkStation's rotations.

12. **`/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/` (all 10 reports)**. Worked examples of the 10-section PHASE_REPORT template filled with real content. Showed the template's robustness across foundation work, hotfixes, and ESCALATED task outcomes.
