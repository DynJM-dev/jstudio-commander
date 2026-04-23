# Dispatch N1 — Foundation

**Phase:** N1 — Foundation (first Command-Center phase)
**Date drafted:** 2026-04-23
**CTO:** Claude.ai Opus 4.7
**Target path for CODER:** `~/Desktop/Projects/jstudio-commander/command-center/` (exists, empty)
**Word budget:** ~3,300 words; full-phase per operating-model commitment #2

---

## §0 — Pre-dispatch reality check

Minimal. N1 starts from an empty directory. Only two verifications apply:

- `~/Desktop/Projects/jstudio-commander/command-center/` exists (confirmed by Jose 2026-04-23).
- Rehydration-prompt §9 paths align with filesystem (confirmed: strategic docs at `jstudio-commander/docs/command-center/`; operational artifacts inside monorepo).

No existing build to verify against. No assumptions to falsify. Proceeding to dispatch.

---

## §1 — Acceptance criteria

**Per SMOKE_DISCIPLINE.md v1.0 §3.1, every criterion is Jose-observable at the outermost user-experience layer: a Finder-launched `Commander.app` (built via `bun run build:app`), interacted with via UI, verified via pixels.**

**1.1 — Visible skeleton within 200ms of Finder launch.** Jose double-clicks `Commander.app`. Within 200ms (perceptually instant, measured by a pre/post timestamp in the webview's first paint), a window appears showing a "Command-Center ready" skeleton UI. No blank white window visible at any point. Measurement tool acceptable: a CODER-built dev overlay that prints first-paint timestamp to the UI.

**1.2 — Sidecar reachable via webview fetch.** Jose opens Preferences modal via ⌘,. The modal displays **"Sidecar: healthy"** or equivalent affirmative state within 3s of mount. The modal's fetch to `http://127.0.0.1:<port>/health` is a real webview-origin fetch (NOT a curl probe, NOT a dev-mode stub). Per SMOKE_DISCIPLINE §4.2 anti-pattern — the N2.1 failure mode of testing this via curl is explicitly what we're not repeating.

**1.3 — Schema + GPU verification.** Preferences modal has a "Debug" tab. The tab displays:
- Table count: `8 tables loaded` (projects, workspaces, agents, tasks, knowledge_entries, agent_runs, sessions, hook_events, onboarding_state — count is 9 with onboarding_state, acceptable to show either 8 or 9 as long as all tables from ARCHITECTURE_SPEC.md §3.2 are present). Clicking the count expands a list of table names read from SQLite.
- GPU status: `Hardware accelerated` across all render categories. Source: webview navigates an internal URL that surfaces `chrome://gpu` output (or equivalent Tauri v2 webview introspection). Debug tab smoke-only; dev tools or smoke-specific view acceptable per SMOKE_DISCIPLINE §4.2 sanctioned exception.

**1.4 — Single-instance lock.** Jose launches `Commander.app` from Finder. A window appears. Jose launches `Commander.app` a second time from Finder. No second window appears; either the first window comes to focus or nothing visible happens. No two simultaneous Commander processes visible in Activity Monitor after the second launch attempt.

**1.5 — No scrollbar gutter artifact.** Any placeholder pane rendered in N1 (including a minimal xterm probe added for smoke purposes) shows no 14px right-side dead strip. Visual verification on a pane with horizontal content that would overflow. Even though xterm is not a primary N1 surface, CODER adds a smoke-only xterm mount to verify the scrollbar-gutter CSS baked per KB-P4.2 is correctly applied — otherwise the fix goes unverified until N3.

**1.6 — Structural fixes live in code.** Three KB-mandated foundation fixes present in the committed code (reviewed by PM during report handoff, not Jose smoke):
- PTY spawn env defaults include `LANG=en_US.UTF-8` + `LC_ALL=en_US.UTF-8` in the sidecar spawn utility (not exercised by a real PTY in N1, but the env setup code must be in place with a unit test).
- Scrollback serialization helper in the sidecar performs explicit utf8 `Buffer`↔`string` round-trip with a unit test covering the known mojibake-signature character classes (em-dash, bullet, box-drawing, Braille).
- xterm default container CSS component in `packages/ui/` applies scrollbar-gutter fix (`::-webkit-scrollbar`, `scrollbar-width: none`, `overflow: hidden`) — verified in 1.5.

**1.7 — Cold restart preserves config.** Jose quits via ⌘Q. Relaunches. Bearer token in Preferences is the same value (read from `~/.jstudio-commander/config.json`). Sidecar port matches between launches (re-scanned but config tracks last-used port).

---

## §2 — Tasks (ordered; CODER may reorder within constraints)

**T1 — Monorepo scaffold.** Create `bun.lockb`, `package.json`, and Bun workspace structure per ARCHITECTURE_SPEC §D-N1-10. Apps: `shell/`, `frontend/`, `sidecar/`. Packages: `shared/`, `ui/`. TypeScript strict everywhere. Shared config for ESLint/Biome (CODER picks one), TypeScript base config at root. Cargo.toml audited per KB-P4.15 — every Rust dependency either cross-platform or gated behind `#[cfg(target_os = "...")]`.

**T2 — Rust shell.** Tauri v2 scaffold in `apps/shell/`. Rust code ≤150 LOC (G5). Responsibilities per ARCHITECTURE_SPEC §2.2: window creation with `visible: false` until `show_window()` IPC called; single-instance lock via Tauri plugin; shutdown handler (sidecar SIGTERM → 5s → SIGKILL); explicit GPU acceleration flags; spawn sidecar as child process; IPC commands for `get_resource_path`, `get_config_path`, `show_window`, `quit_app`.

**T3 — Bun Fastify sidecar.** `apps/sidecar/`. Bun 1.3.5+ runtime. Fastify route surface for N1: `GET /health`. Port scan 11002..11011. Bearer token at `~/.jstudio-commander/config.json` — auto-generated via `crypto.randomUUID()` on first launch, persisted. Write sidecar port to same config for frontend discovery. Pino for structured logging to `~/.jstudio-commander/logs/<date>.log`.

**T4 — Drizzle schema.** Complete N1 schema per ARCHITECTURE_SPEC §3.2. All 9 tables (projects, workspaces, agents, tasks, knowledge_entries, agent_runs, sessions, hook_events, onboarding_state) with indices + FK relationships. Migration runs on sidecar boot; boot fails visibly if migration fails. `bun:sqlite` as driver (no `better-sqlite3` — Bun's built-in is faster and needs no native bindings). DB file at `~/.jstudio-commander/commander.db`.

**T5 — Webview ↔ sidecar connectivity.** CSP in `tauri.conf.json` explicitly allows `connect-src http://127.0.0.1:*`. Tauri v2 capabilities include `http:` fetch permission for localhost ports. Frontend async-initializes post-skeleton: reads config via `get_config_path` IPC, fetches `/health`, displays result in Preferences. No sync I/O at module init (KB-P1.14).

**T6 — Frontend skeleton + Preferences.** `apps/frontend/` — React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Router. Routes: `/` (welcome skeleton: "Command-Center ready. ⌘, opens Preferences.") and `/preferences` (modal). Preferences tabs: **General** (bearer token copy, version display), **Debug** (schema table list, GPU status, first-paint timestamp). Route-level code splitting: main bundle target ≤500 KB. Approval modal component, code editor, syntax highlighter, file tree — all lazy-loaded (placeholders acceptable in N1; actual components land N5/N6).

**T7 — Boot-path discipline verification.** Per KB-P1.14:
- Route-level code splitting verified via `vite build --mode analyze` output; main bundle ≤500 KB.
- No sync work at module init verified by grepping entry points for sync fs/keychain/IPC calls.
- `ready-to-show` pattern: frontend calls Tauri `show_window()` IPC after first React paint completes (use `requestAnimationFrame` or equivalent).
- 200ms skeleton measured: CODER instruments first-paint timestamp in dev build; smoke criterion 1.1 verifies against this.

**T8 — GPU acceleration verification.** Tauri v2 config includes explicit hardware acceleration. Smoke-specific view or dev-tools route in Preferences → Debug surfaces GPU status. Acceptance per criterion 1.3.

**T9 — Structural-fix baking.** Per KB-P4.2, P4.12, P4.13:
- `packages/shared/src/pty-env.ts` — utility returning PTY env with UTF-8 locale. Unit test asserts presence of `LANG=en_US.UTF-8` + `LC_ALL=en_US.UTF-8`.
- `packages/shared/src/scrollback-codec.ts` — encode/decode helpers for scrollback blobs. Unit tests: round-trip em-dash, bullet, box-drawing, Braille, CJK characters; assert byte-for-byte equality.
- `packages/ui/src/xterm-container.tsx` — component with scrollbar-gutter CSS baked in. Unit render test: container has `overflow: hidden` + no scrollbar gutter visible (via jsdom + computed style).

**T10 — Smoke readiness check.** CODER launches the built `.app` from Finder themselves and confirms the window appears, before filing PHASE_REPORT (smoke-readiness check per SMOKE_DISCIPLINE §5 item 2). This is NOT the full Jose smoke — just a launchability confirmation so Jose's dogfood doesn't fail on "the .app doesn't even open."

---

## §3 — Required reading (load-bearing; PM confirms CODER has loaded before execution)

- `COMMAND_CENTER_ROADMAP.md` v0.3 — N1 phase section.
- `ARCHITECTURE_SPEC.md` v1.1 — §2 (platform), §3 (storage), §7 (IPC contracts), §D-N1-10 (monorepo layout). §10 is the ratified decision log.
- `COMMANDER_KNOWLEDGE_BASE.md` v1.3 — Part 1.12 (UI/sidecar split), 1.13 (per-session IPC — forward reference for N3 but design N1 sidecar WS routing to support it), 1.14 (boot-path discipline), 1.16 (persistent state placement), 1.17 (context degradation — not N1 but informs Preferences layout), 4.1 (Tauri production build), 4.2 (xterm gotchas), 4.12 (GPU packaging), 4.15 (Cargo platform gating).
- `OPERATING_SYSTEM.md` — §3.4 manual-bridge invariant, §20.LL L11–L14 (investigation discipline triggers), §24 (pattern-matching discipline — minimal in N1 but applies).
- `standards/SMOKE_DISCIPLINE.md` v1.0 — load-bearing for §1 acceptance framing and §9 smoke scenario below.
- `standards/INVESTIGATION_DISCIPLINE.md` — invoked only if a fix rotation lands unit-green + symptom unchanged.

---

## §4 — Constraints

**G1–G14 guardrails** carry from v1 unchanged. Specifically for N1:

- **G5 — Rust scope ≤150 LOC.** Non-negotiable. If T2 approaches the cap, CODER surfaces a deviation report before expanding, not after.
- **G8 — Surface better approaches with deviation report.** If CODER discovers during T3 that a different Bun runtime pattern is cleaner than what §2.3 specifies, deviation report lands in PHASE_REPORT §4 — never silent substitution.
- **G10 — Root-cause before fix.** Applies if any task hits a bug during N1 implementation. Instrumentation rotation per INVESTIGATION_DISCIPLINE if symptom doesn't move on first attempt.
- **G12 — Dependency declaration hygiene.** Every `bun add` lands with `package.json` + `bun.lockb` update in the same commit. PM verifies during report review.

**CODER self-certification prohibition (SMOKE_DISCIPLINE §3.4).** CODER runs the smoke-readiness check (T10) but does NOT run or pass-judge Jose's user-facing smoke. PHASE_REPORT §3 item 3 stays blank until PM appends Jose's outcome.

**Bun runtime risk note (ARCHITECTURE_SPEC §2.3).** If during T3 or T9 CODER hits a Bun runtime bug that's not trivial to work around, CODER reports via PHASE_REPORT §8 (Questions for PM) before dropping to the Node fallback. PTY API is not exercised in N1, but sidecar uses `bun:sqlite`, `Bun.spawn` (for subprocess sanity tests), and Bun-hosted Fastify — any of those hitting issues is escalate-first, not pivot-first.

---

## §5 — Stack (locked, for reference)

Per ARCHITECTURE_SPEC §10 ratified decisions 2026-04-23:

- React 19 · TanStack Router · Vite · Tailwind v4 · shadcn/ui · Bun 1.3.5+ · Fastify · Drizzle · `bun:sqlite` · Pino · Bun workspaces (no Turborepo in v1)
- Vitest at sidecar from N1. No frontend RTL tests in N1 (starts N4).

---

## §6 — Out of scope for N1

- Claude Code plugin package, `hooks.json`, `/hooks/*` routes (N2).
- MCP server routes `/mcp/*` (N2).
- PTY spawn via `Bun.spawn({ terminal })` (N3 — structural helpers in T9 stage the env only).
- Task board kanban with real content (N4 — skeleton placeholder only).
- Approval modal implementation (N5).
- ChatThread + renderer registry (N6).
- Frontend RTL tests beyond the T9 unit tests (N4+).

---

## §7 — Approach notes (CODER judgment within dispatch)

**Task ordering.** T1 and T2 can parallel with T3 and T4 after T1 lands. T5 depends on T2+T3+T4. T6 depends on T5. T7 and T8 are verification layers over T6. T9 is independent of all other tasks. T10 runs last.

**Bun sidecar bundling inside Tauri sidecar.** Tauri v2 sidecar model expects a binary. Bun produces one via `bun build --compile`. CODER configures Tauri's `tauri.conf.json` `externalBin` pointing at the compiled Bun sidecar binary. This is the ARCHITECTURE_SPEC §2.3 single-binary win — drop it in, done.

**Bearer token generation and display.** Token is a UUIDv4 generated on first boot if `config.json` doesn't exist. Displayed in Preferences → General with a "Copy" button. Users paste into external Claude Code sessions in N2+ — in N1, it just exists.

**Preferences modal state.** Component state is in Zustand per ARCHITECTURE_SPEC §4. Preferences values read from sidecar via TanStack Query on mount (health check, schema inspection, GPU status). No persistence in N1 beyond the config.json bearer token — nothing else is user-modifiable yet.

**Skeleton content.** Minimal per §1 criterion 1.1. A welcome message + ⌘, hint is sufficient. Full kanban skeleton is N4. Don't over-build the home view in N1 — it will be replaced.

---

## §8 — CODER in-rotation decisions

**CODER decides without escalating:**
- File-level organization within each app (e.g., `apps/sidecar/src/routes/`, `apps/frontend/src/components/`).
- Exact Preferences modal component structure and styling.
- Whether to use Biome or ESLint+Prettier (either is acceptable; CODER picks, PM ratifies via PHASE_REPORT §4).
- Which shadcn/ui primitives to pull in for N1 (Preferences uses Dialog, Tabs, Button, probably — CODER chooses).
- Logging patterns within Pino (structured fields, log levels).
- Commit granularity within each task.

**CODER escalates before acting:**
- Any deviation from ARCHITECTURE_SPEC §3.2 schema (tables, columns, indices).
- Any change to ARCHITECTURE_SPEC §10 ratified stack picks.
- Rust scope threatening to exceed 150 LOC (G5).
- Bun runtime showing non-trivial bugs during development (§2.3 risk note — Node fallback is an escalation-gated choice, not CODER's unilaterally).
- Any smoke criterion from §1 that appears unverifiable by Jose at the outermost layer (SMOKE_DISCIPLINE §3.3 — if a criterion requires intermediate-layer inspection to verify, it's a dispatch bug, surface it).

---

## §9 — Smoke scenario

**Smoke scenario conforms to SMOKE_DISCIPLINE.md v1.0. CODER's automated suite is prerequisite, not substitute.**

**Restrictions during smoke execution:**
- No `bun run dev` / dev mode. No terminal assist. No direct API calls from curl. No direct DB inspection from `sqlite3`. No process-tree inspection as a smoke step (valid for CODER's diagnostic work during the phase; not for smoke).
- Permitted sanctioned exception (per SMOKE_DISCIPLINE §4.2): the Debug tab's GPU status view uses webview introspection of `chrome://gpu`. This is still the outermost layer (rendered in the UI, read by Jose via pixels).

**Smoke steps — Jose executes, PM appends outcome to PHASE_REPORT §3:**

1. **Build.** `cd ~/Desktop/Projects/jstudio-commander/command-center && bun run build:app`. Build succeeds; `.app` bundle exists at the documented output path (CODER documents exact path in PHASE_REPORT §2).

2. **First launch — skeleton visible fast.** Open `Commander.app` from Finder. Within 200ms, a window appears showing the welcome skeleton. No blank white window observed at any point. (Criterion 1.1.)

3. **Preferences health.** Press ⌘, to open Preferences. Modal mounts; General tab shows "Sidecar: healthy" (or equivalent affirmative state) within 3s. Bearer token is displayed with a Copy button. Version line shows a non-empty version. (Criterion 1.2.)

4. **Debug tab.** Click Debug tab in Preferences. Shows table count (8 or 9 per §1.3) and, on expansion, all table names from ARCHITECTURE_SPEC §3.2. GPU status line shows "Hardware accelerated" on all render categories. First-paint timestamp displayed (for Jose to verify §1.1 wasn't CODER wishful-thinking). (Criterion 1.3.)

5. **Close Preferences.** Escape key closes Preferences; welcome skeleton remains visible.

6. **xterm scrollbar-gutter probe.** Preferences → Debug → "xterm probe" button. Opens a small inline xterm pane with content wider than the pane. No 14px right-side dead strip visible; no scrollbar gutter. (Criterion 1.5.)

7. **Single-instance lock.** Keep Commander running. Double-click `Commander.app` from Finder again. No second window opens. Either existing window comes to focus or nothing visible happens. Activity Monitor shows single Commander process (Jose can open Activity Monitor for this — it's the OS tool, still pixel-observable). (Criterion 1.4.)

8. **Clean shutdown + restart.** Press ⌘Q. App quits cleanly (no "force quit required" dialog). Sidecar process ends (verifiable in Activity Monitor if needed). Relaunch from Finder. Bearer token in Preferences matches the value from step 3 (config persisted). Version matches. Skeleton appears within 200ms again. (Criterion 1.7.)

**Expected outcome:** 8/8 steps pass. Any failure blocks N1 close and triggers the hotfix-dispatch pattern (N1.1). If a failure surfaces that isn't obviously within N1 scope (e.g., a Bun bundling bug deep in `bun build --compile`), CODER is authorized under §4 G10 to fire an instrumentation rotation before attempting a fix dispatch — INVESTIGATION_DISCIPLINE.md applies.

---

## §10 — PHASE_REPORT expectations

Per SMOKE_DISCIPLINE.md §5, PHASE_REPORT §3 has three parts:

1. **CODER automated suite results:** Vitest (sidecar), Cargo check, typecheck, `bun install --frozen-lockfile` (G12 clean), lint clean. CODER fills this at report-filing time.

2. **Smoke-readiness check:** CODER confirms `.app` launches from Finder and shows a window. One-line confirmation.

3. **User-facing smoke outcome:** blank at PHASE_REPORT filing. PM appends after Jose dogfoods, with step-by-step pass/fail per §9.

**CODER is responsible for:**
- Tasks 1–10 executed per §2.
- All six structural acceptance items (1.1–1.7) verified in CODER's local test run before handoff.
- PHASE_REPORT §1 (dispatch recap), §2 (what shipped with commit hashes + file lists), §3 parts 1 and 2, §4 (deviations), §5 (issues + resolutions), §6 (deferred — should be empty for N1), §7 (tech debt introduced if any), §8 (Questions for PM), §9 (next-phase recommendations), §10 (metrics — commits, tool-call count, duration).

**CODER is NOT responsible for:**
- §3 part 3 (Jose smoke outcome — PM appends).
- Ratifying N1 close (CTO does, after §3 shows user-facing smoke PASSED).
- Authoring N2 dispatch (CTO's job).

---

## §11 — Closing

N1 is the foundation for everything after. Three protected principles from KB v1.3 are baked here for the first time — UI/sidecar split (KB-P1.12), boot-path discipline (KB-P1.14), persistent state placement (KB-P1.16). Two more (per-session IPC per KB-P1.13, xterm explicit-dispose per KB-P4.2 v1.2) are designed for in the sidecar WS routing plumbing even though they're not exercised until N3. Getting these right in N1 is the difference between clean N3+ phases and the N2.1.x hotfix pattern from v1.

Estimated rotation count: 1, assuming no major Bun-runtime surprises. If T3 or T4 hits a Bun gotcha that's not documented publicly, a second rotation is possible — escalate early per §4 Bun risk note.

No effort estimate in wall-clock. Ships when it ships.

---

**End of dispatch N1. Routing: CTO → Jose → PM (reality check already complete, so PM may proceed directly to CODER execution prompt) → CODER.**
