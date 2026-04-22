# Native Commander Rebuild — Scoping Brief

**From:** PM (Commander, 2026-04-22)
**To:** CTO (Claude.ai)
**Type:** Scoping brief (not a dispatch). PM-drafted recommendations for CTO ratification before any rebuild dispatch fires.
**Preceded by:** Migration plan 12/12 COMPLETE per `MIGRATION_STATE.md`. Commander bug work paused. CTO-ratified 2026-04-22 that native rebuild is the real next phase.
**Scope:** Platform target recommendation + feature-preservation catalog + deferred-backlog absorption + migration path options + human-in-loop invariant + open questions.

---

## §1 — TL;DR

**PM recommendation:** **Tauri with Node.js sidecar** for the native rebuild. Migrate incrementally via the "hybrid" path — native shell + sidecar serves existing Fastify backend unmodified; rebuild UI iteratively in the native shell while web Commander stays alive as fallback. Preserves ~100% of backend code, ~80% of React UI (with native-specific refactors), gains real-time chat status from direct node-pty access (closes the Phase Y architectural ceiling by construction), adds unified PM/CTO/Coder bridge UI as the native-specific UX improvement.

**Rationale:** Electron is heavier and slower startup; Swift/SwiftUI is a full rewrite with no code reuse; Tauri-sidecar lets us reuse every Commander commit since Phase U without porting. Investment scales to outcome.

**Timeline shape (rough, needs CTO refinement):** 4-phase rebuild, estimated 3-6 weeks of focused work depending on UX scope ambition.

---

## §2 — What "native rebuild" means

Current Commander is web-based: browser renders React client, Fastify backend on localhost, tmux shell-out for session management, chokidar file watching. Runs in any browser tab.

Native rebuild = **a standalone desktop app** (icon in Dock, one-click launch, native window frame, native notifications, filesystem and tmux access without browser sandbox constraints) that runs Commander without a browser.

**Why native matters architecturally** (beyond "feels like a real app"):

1. **Direct terminal access.** Web Commander shells out to tmux and reads pane content via `tmux capture-pane`. A native app can attach to a `node-pty` session directly and receive every output byte as it's written — the Phase Y architectural ceiling vanishes by construction. Chat status can reflect actual streaming work in real time because there's no JSONL-transcript pipeline between the model and the UI.
2. **Unified UI for the three-role model.** Today Jose manually routes documents between CTO (Claude.ai tab), PM (Commander PM pane), CODER (Commander CODER pane). Native can surface a single routing surface: brief-review pane, dispatch-compose pane, report-consumption pane — all in one window.
3. **Filesystem + OS integration.** Native FSEvents are faster than chokidar's polling fallback. Native notifications for session state changes. Deep-link into Finder / terminal. Global shortcuts (Cmd+Opt+C to cycle sessions, Cmd+Shift+N for new dispatch, etc.).
4. **No browser tab drift.** Commander currently lives in a tab that can be closed, the backend orphaned, sessions lingering. Native app tightly couples UI lifecycle to backend lifecycle.

---

## §3 — Platform target options

Three realistic paths. Each evaluated against: code reuse, UI reuse, startup performance, distribution footprint, macOS-first fit, future cross-platform option, rewrite cost.

### 3.1 — Option A: Electron

**Shape:** bundle Chromium + Node.js runtime, React UI renders in Chromium webview, Node backend runs in main process.

| Dimension | Assessment |
|---|---|
| Backend code reuse | ~100% — Fastify server runs in main process unchanged |
| UI code reuse | ~100% — React app renders in webview as-is |
| Startup perf | Slow (Chromium boot ~500ms-1s) |
| Installed footprint | Heavy (~150-200MB) |
| Memory | Heavy (~300-500MB) |
| macOS integration | Good (Electron has mature macOS APIs) |
| Cross-platform option | Excellent — Electron ships on all three platforms |
| Rewrite cost | Lowest — mostly packaging work |

**Pros:** cheapest path to ship.
**Cons:** worst startup + memory; doesn't really feel "native" on macOS.

### 3.2 — Option B: Tauri with Node.js sidecar (RECOMMENDED)

**Shape:** Rust shell + WebView2/WebKit native view, Rust IPC layer, spawn existing Fastify server as a sidecar process (Tauri supports this natively via `tauri.conf.json` sidecar config).

| Dimension | Assessment |
|---|---|
| Backend code reuse | ~100% — Fastify runs unchanged as sidecar |
| UI code reuse | ~95% — React app renders in WebView; native IPC API replaces some `fetch`/WebSocket patterns, rest identical |
| Startup perf | Fast (Tauri ~50-150ms) |
| Installed footprint | Light (~10-20MB shell + Node binary ~50MB) |
| Memory | Moderate (~80-150MB) |
| macOS integration | Good (native APIs via Rust) |
| Cross-platform option | Excellent — Tauri ships Mac/Win/Linux |
| Rewrite cost | Low — Tauri shell + sidecar config + some IPC bridging |

**Pros:** native feel, fast, lightweight, keeps existing backend intact.
**Cons:** introduces a small Rust surface (shell glue + sidecar lifecycle management). Rust expertise required for shell layer.

### 3.3 — Option C: Native Swift/SwiftUI (macOS-only)

**Shape:** SwiftUI UI, Swift backend, shell-out to tmux from Swift, FSEvents for file watch, URLSession for HTTP, custom WebSocket server in Swift OR keep a small Node sidecar.

| Dimension | Assessment |
|---|---|
| Backend code reuse | ~10-30% — core patterns portable (schema, types), implementations rewrite |
| UI code reuse | 0% — React to SwiftUI is a rewrite |
| Startup perf | Best (instant) |
| Installed footprint | Smallest (~5-10MB) |
| Memory | Smallest (~40-80MB) |
| macOS integration | Best (first-class) |
| Cross-platform option | None (macOS-only) |
| Rewrite cost | Highest — full UI + backend rewrite |

**Pros:** fastest, lightest, best macOS UX.
**Cons:** biggest rewrite cost; no cross-platform path; no code reuse from Phase U onward.

### 3.4 — PM recommendation: Option B

Option B (Tauri + sidecar) is the Pareto-optimal choice. It preserves the existing Commander codebase (every Phase U/V/W/Y/Finalizer commit, all tests, all services) while shedding the browser-tab model. Rust surface is minimal and well-scoped to shell glue.

The sidecar pattern specifically is what unlocks it — Tauri can spawn `node server/dist/index.js` as a managed child process with automatic lifecycle (kill on app quit, restart on crash, stdio piping). The React frontend doesn't even know it's inside a native app; it continues to `fetch('/api/…')` and `new WebSocket('ws://localhost:…')` as before.

Cross-platform preserved for future expansion (if Jose ever needs Windows/Linux builds for team members or clients).

---

## §4 — Feature catalog to preserve

Complete inventory of Commander features that must survive the rebuild. Grouped by subsystem.

### 4.1 — Session management

- Session spawning via tmux (`tmux new-session -d -s jsc-<uuid>`)
- PM + CODER + Raw session type model
- Per-session effort level (SESSION_TYPE_EFFORT_DEFAULTS + per-session override)
- Bootstrap injection at session start (pm-session-bootstrap / coder-session-bootstrap)
- Parent/teammate relationship model (`parent_session_id`)
- Session lifecycle (active / stopped / waiting / working)
- Manual-bridge model — NO auto-forwarding between PM and CODER (persona-enforced; M6 confirmed zero auto-forward code)
- Synthetic-id reconciliation on first hook (C27 fix `a6ca156`)
- Session cwd resolution (Issue 10 `resolveSessionCwd` SSOT)

### 4.2 — Tmux integration

- `tmux send-keys` for dispatching commands
- `tmux capture-pane` for reading output
- Per-session pane tracking (`tmux_session` field)
- Startup orphan adoption (`server/src/index.ts:275-303`)
- Heal path on pane loss
- Case-collision guard script (`scripts/check-case-collisions.sh`)

**Native upgrade opportunity:** replace tmux shell-out with direct `node-pty` integration. Eliminates pane-classifier lag, orphan adoption, capture-pane polling. Requires rethink of session-tmux ownership boundary (currently tmux owns the process; node-pty would move ownership into Commander). Not required for v1; can stay tmux-based initially.

### 4.3 — Real-time event pipeline

- WebSocket event broadcast: `chat:message`, `session:updated`, `pane-capture:<sessionId>`, `project-state-md-updated:<sessionId>`, `session:prompt`, others
- Event bus (server-side)
- Per-session channel isolation
- File watcher (chokidar) for JSONL transcripts
- File watcher for STATE.md + canonical project docs
- Status poller (1.5s tick)
- Heartbeat + staleness detection

**Native upgrade opportunity:** replace chokidar with FSEvents on macOS (native kernel events, zero polling). Replace status poller with tmux event hooks or node-pty direct reads (eliminates 1.5s tick entirely).

### 4.4 — UI — ContextBar

- Status (idle/working/waiting/stopped) with color dot
- Action label ("Running command...", "Composing response...", "Working...")
- Effort level indicator + click-to-adjust (M8 Primary `1d33160`)
- Stop button (`0c87230` ground-truth gate via `paneActivelyChanging`)
- Token + cost counters
- Context-window-% band indicator
- Active-teammate count label
- Refresh button (#237)
- Approval / permission prompt mount point (Item 3 sacred — waiting passthrough)

### 4.5 — UI — ChatThread + assistant rendering

- Message grouping (user messages separate, assistant messages grouped)
- Tool chip rendering (Read / Edit / Write / Bash / Agent / Task / Grep / Glob / etc.)
- Assistant text block rendering with markdown (limited parity with VSCode Claude — C30 deferred)
- Code-fence rendering with syntax highlighting
- Inline reminder rendering (`task_reminder` attachment — C29 deferred)
- Approval prompt rendering with Allow/Deny/Custom
- LiveActivityRow for thinking blocks (C42 pre-text scan via `extractLiveThinkingText`)
- Scroll-anchor with user-send override (C39 `2da88c1`)
- Compact-boundary rendering

### 4.6 — UI — Phase T tmux mirror

- Per-session Live Terminal pane
- `ansi_up` rendering (ANSI escape code → HTML)
- Scroll-pin follow-bottom
- Per-session toggle (Cmd+J)
- 200px fixed height
- `useSessionPaneActivity` hook subscribing to `pane-capture:<sessionId>` (C36 display-layer residual — defer to native rebuild)

**Native upgrade opportunity:** render the tmux pane in an actual terminal emulator component (xterm.js or native TerminalView), not a re-rendered capture. Closes C36 display layer entirely because rendering IS the pane, not a derived mirror.

### 4.7 — UI — STATE.md pane (M7 MVP)

- Per-pane STATE.md live view
- Drag-to-resize drawer with preference persistence
- Cmd+Shift+S toggle
- Subscription-firewalled from chat re-renders

### 4.8 — UI — Split view

- Multiple sessions side-by-side
- Per-pane `data-pane-session-id` routing
- ESC / Cmd+. cross-pane isolation (`paneFocus.ts` from Candidate 19)
- Per-pane ContextBar + ChatThread + Live Terminal + STATE.md drawer

### 4.9 — UI — Session management surfaces

- SessionCard (status, effort badge, last activity, teammate count)
- CreateSessionModal (session type + effort override at spawn, M8 Secondary `6b67cb5`)
- Sidebar (session list, filters, project grouping)
- Project view (STATE.md live pane — M7 MVP)

### 4.10 — Preferences + persistence

- SQLite database at `~/.jstudio-commander/commander.db`
- `usePreference` hook with same-tab subscriber pattern (Phase T hotfix `9bba6ab`)
- Per-session UI state (drawer open, mirror visible, heights)
- Cost telemetry (`session_ticks`, `cost_entries`)
- Token analytics queryable (Jose's TOKEN_ANALYTICS_*.md reports)

### 4.11 — Skill + persona integration

- jstudio-pm skill (major post-M9 overhaul)
- jstudio-db, jstudio-qa, jstudio-security, jstudio-ui, jstudio-landing, jstudio-supabase, jstudio-scaffold, jstudio-e2e, jstudio-ui-ux-pro-max, jstudio-licitacion
- PM / Coder bootstrap injection (stays as-is)
- Standards references (`jstudio-meta/standards/*.md`)
- OS reference (`jstudio-meta/OPERATING_SYSTEM.md`)

### 4.12 — Investigation + audit infrastructure (stays for now, retires during native v1 cleanup)

- `[codeman-diff]` parallel-run logger (Phase Y Rotation 1) — retire in native v1 (no longer needed once Phase T ground-truth drives everything)
- `debug.routes.ts` — retire with the logger
- `~/.jstudio-commander/codeman-diff.jsonl` — retire
- 15.3-arc legacy guards (typedIdleFreshKillSwitch, lastTurnEndTs, heartbeat-stale, etc.) — DELETE in native v1 (ground-truth replaces them entirely)

---

## §5 — Deferred-to-native-rebuild backlog (absorbed into rebuild scope)

Web Commander candidates flagged for native rebuild per `feedback_defer_nonblocking_bugs_to_native_rebuild`:

| Candidate | Description | Native-rebuild treatment |
|---|---|---|
| **C26** | Session-tick retention migration + UNIQUE constraint | Design fresh in v1 schema — proper uniqueness + retention-by-age policy built in |
| **C29** | `task_reminder` renderer gap | Rewrite renderer registry; native `InlineReminderNote` with full event-type coverage |
| **C30** | Markdown renderer visual parity with VSCode Claude | Native v1 uses full @tailwindcss/typography + rehype-highlight + remark-gfm stack (or equivalent native markdown rendering if not using React) |
| **C34** | Permission-mode selector | Net-new UI surface in v1 — native dropdown alongside effort selector on SessionCard + ContextBar |
| **C35** | Renderer-registry extension for unmapped Claude Code subtypes | Unified with C29 — full audit + typed coverage in v1 |
| **C36** | Effort cross-session display leak | Eliminated by construction — v1 uses terminal emulator per pane, not shared-channel capture broadcasts |
| **C40** | Unmapped system subtypes (api_error surface) | Same as C29/C35 — covered by v1 renderer rewrite |
| **C44** | Attachment submit tmux-relay residual | Native node-pty attach means no shell-out relay; file drops go directly to pty stdin with Claude Code's `@<path>` syntax intact |

**Summary:** every deferred candidate is either structurally eliminated by v1 architecture (C36, C44) or absorbed into greenfield v1 subsystem design (C26, C29, C30, C34, C35, C40).

---

## §6 — Migration path — rebuild vs incremental

Three options evaluated:

### 6.1 — Option X: Full rebuild from scratch

Start empty repo. Rebuild every subsystem native-first. Web Commander archived, referenced as spec but not as source.

**Pros:** clean architecture; no legacy carry; perfect alignment with v1 design.
**Cons:** expensive (3+ months); maximum risk of missing subsystems; no web fallback during build.

**PM lean:** no. Too much proven code thrown away.

### 6.2 — Option Y: Incremental web-surface replacement

Add Tauri shell around existing web Commander immediately. Ship as native wrapper v0. Then progressively replace surfaces (ContextBar first, ChatThread next, Phase T mirror via terminal-emulator native component, etc.) while keeping the rest web-rendered.

**Pros:** fastest path to "native feel" (just wrap); zero-downtime UX (every step ships); web Commander survives as fallback.
**Cons:** two UI paradigms coexist for weeks; risks freezing the "wrap only" state if momentum dies.

**PM lean:** maybe — good v0, but risk of stalling.

### 6.3 — Option Z: Hybrid — native shell + sidecar server, UI iteratively rebuilt

Tauri shell spawns existing Fastify as sidecar. React UI keeps working. First v1 commit ships as "functionally identical to web Commander, but runs as a Mac app." Subsequent phases rebuild UI + subsystems with native affordances (terminal emulator for mirror, FSEvents for watchers, native notifications, unified three-role UI).

**Pros:** immediate native shell + immediate code reuse; each phase is meaningfully shippable; clear architectural boundary (shell + sidecar + UI layers can evolve independently).
**Cons:** two runtimes (Rust + Node) instead of one; slightly more ops.

**PM lean:** **recommended.** This is Option B (platform) + Option Z (migration) — the sidecar architecture IS the migration path.

### 6.4 — Recommended phasing (subject to CTO refinement)

**Phase N1 — Native shell + sidecar** (~3-5 days):
- Set up Tauri project, spawn Fastify as sidecar with lifecycle management.
- Package as `.app` bundle, verifiable double-click launch on macOS.
- Existing React UI, existing backend, existing SQLite. Zero functional change.
- Deliverable: Commander runs as a Dock app with identical behavior to web version.

**Phase N2 — Terminal emulator for Phase T mirror** (~2-4 days):
- Replace the current `ansi_up`-rendered-capture mirror with xterm.js (or native equivalent) attached directly to tmux pane bytes.
- Closes C36 display layer by construction.
- UI: full-fidelity terminal, scrollback, select-copy, search.

**Phase N3 — Unified three-role UI** (~5-8 days):
- Single-window surface: brief-review pane (CTO upload/output), dispatch-compose pane (PM output to CODER), report-consumption pane (CODER PHASE_REPORT back).
- Replaces Jose's current manual routing between three tabs.
- Keep manual-bridge invariant — Jose still presses "forward" or "copy to CODER", nothing auto-sends.

**Phase N4 — Renderer registry rewrite + markdown parity + backlog absorption** (~4-7 days):
- Full renderer audit per C29/C30/C35/C40 combined.
- Markdown parity with VSCode Claude.
- Native notification integration for session state changes.
- Retire Phase Y parallel-run logger + 15.3-arc legacy guards per M9 batch plan.

**Phase N5 — Polish + cross-platform validation** (~3-5 days):
- Native notifications, global shortcuts, menu bar item, Dock badges.
- Optional Windows + Linux builds if Jose wants them.

**Total: ~17-29 days of focused work.** Fastest path if Jose is full-time on it; longer if parallelized with other client work.

---

## §7 — Human-in-loop invariant preservation

Per `project_native_rebuild_final_phase` + persona v3:

**What stays sacred:**
- Jose is the bridge between CTO (external Claude.ai thread) and Commander PM.
- Commander PM does NOT auto-message CODER — all CODER dispatches require Jose copy-paste.
- Commander CODER does NOT auto-message PM — all PHASE_REPORTs require Jose copy-paste.
- No persona bypass, no TeamCreate auto-forwarding.

**What changes (UX only, not control):**
- Current: Jose opens three browser tabs (Claude.ai + Commander PM + Commander CODER), Cmd+C/Cmd+V between them.
- Native: Jose opens one Commander window, three panes within. Brief-review pane shows pasted CTO output. "Compose dispatch" button opens the PM pane with context preserved. "Paste to CODER" button puts the compose output on clipboard AND highlights the CODER pane (but doesn't auto-send). Jose still presses Enter in the CODER pane.

**The invariant:** Jose presses the button, nothing else. Native reduces *friction*, not *agency*.

---

## §8 — Open questions for CTO

1. **Platform target — Tauri ratified?** Or preference for Electron (cheaper ship), Swift (macOS-first luxury), or something else?
2. **Migration path — Option Z (hybrid) ratified?** Or Option X (from scratch) or Y (wrap-only v0)?
3. **Cross-platform scope.** v1 macOS-only, with Windows/Linux as Phase N5 optional expansion? Or cross-platform parity from v1 Phase N1?
4. **Timeline budget.** Is 17-29 days of focused work realistic given Jose's other project obligations? Should we phase differently?
5. **Parallel client work.** Jose's active projects (JLP, Elementti, PPseguros, Rodeco, OvaGas, etc.) continue during rebuild — any phases where work must pause for stability? PM recommendation: N1 + N3 + N5 can run concurrently with client work; N2 + N4 are higher-focus phases that benefit from dedicated days.
6. **Web Commander sunset criteria.** At what phase does web Commander go dark? PM recommendation: keep alive through N4, sunset after N5 ratification.
7. **Licensing / distribution.** Single-user (Jose only) or shareable with team members / clients? Affects packaging, code signing, update distribution (Tauri has built-in updater, but needs signing cert).
8. **Backend schema evolution.** v1 SQLite schema carries every migration from Phase U forward. Clean-slate schema or preserve? PM recommendation: preserve (existing sessions survive the upgrade), add migrations for new fields (C26 retention, C34 permission-mode) as needed.
9. **Claude Code dependency.** Commander invokes `claude` CLI. v1 continues this model? Or does Claude Code get bundled / embedded? PM recommendation: external dependency, matches current model.
10. **Name.** Stay "jstudio-commander" or rebrand for native v1 (e.g. "JStudio Commander.app", "Commander", "JStudio Orchestrator")?

---

## §9 — What I recommend for the next CTO response

1. Ratify or adjust platform target (§3 — PM lean: Tauri + sidecar).
2. Ratify or adjust migration path (§6 — PM lean: hybrid Option Z with 5-phase sequencing).
3. Answer §8 open questions, especially cross-platform scope and timeline budget.
4. Any adjustments to the feature-preservation catalog (§4) — omissions or priority flips.
5. Any adjustments to the deferred-backlog absorption (§5) — items we should fix in web Commander anyway vs absorb into native v1.
6. Ratify the human-in-loop invariant framing (§7) — specifically the UX affordance description for the unified three-role UI.

After CTO ratification, PM drafts the N1 dispatch (Tauri shell + sidecar setup) for Jose to review before firing CODER.

---

## §10 — What we're NOT doing in this brief

- Choosing specific Tauri version, Rust dependencies, or sidecar lifecycle implementation details (N1 dispatch scope).
- Designing the unified three-role UI layout (N3 dispatch scope with mockups).
- Enumerating every renderer registry extension (N4 dispatch scope).
- Committing to cross-platform polish (N5 dispatch scope, optional).
- Addressing web Commander maintenance during rebuild (separate ops brief if needed).

---

**End of scoping brief.** Ready to forward to CTO. Standing by for ratification of §1 recommendations + §8 open-question answers before PM drafts N1 dispatch.
