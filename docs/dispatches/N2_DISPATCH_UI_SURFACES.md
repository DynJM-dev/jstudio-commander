# N2 Dispatch — SEA Bundling + ContextBar + STATE.md Drawer + Split View + Scrollback

**Dispatch ID:** N2
**From:** CTO (Claude.ai)
**To:** PM (Commander) → fresh CODER spawn
**Phase:** N2 — Native Commander v1 core UI surfaces + SEA self-containment
**Depends on:** N1 CLOSED (`native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md`), `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (canonical architectural contract; v1.3 spec corrections applied per acceptance memo §7 at PM's fold convenience), `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` v1, `docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` (§4 invariants, §10 continuity map)
**Template reference:** `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md` (CODER produces PHASE_N2_REPORT in this format at completion)
**Estimated duration:** 6-8 working days
**Model/effort:** Opus 4.7 (1M context) / effort=medium default, escalate to high for Task 1 (SEA bundling, native modules), Task 5 (split view workspace persistence), Task 7 (scrollback serialize/restore)
**Status:** Ready to fire

---

## §0 — Dispatch purpose in one sentence

Build the N2 core UI surfaces on top of N1's foundation — SEA-bundled sidecar (eliminating Node 22 prereq), ContextBar with live session metrics, STATE.md drawer, split view with workspace persistence, scrollback restore across restarts — and close the three carryover items surfaced in PHASE_N1_REPORT (`.zshrc` opt-in flag, `command:ended.durationMs` tracking, WebSocket heartbeat with resubscribe-on-reconnect).

N2 is the phase where Commander starts resembling the actual v1 user experience, on top of N1's working architectural skeleton.

---

## §1 — Non-negotiable acceptance criteria

The phase is complete when **all** of the following observable behaviors are demonstrable:

### 1.1 — SEA-bundled sidecar (eliminates Node 22 prereq)

The `.app` bundle contains a single-executable sidecar binary — no separate `node` + `dist/` + `node_modules/` layout. Native modules (node-pty, better-sqlite3) load correctly from the bundled binary. User machine does NOT need Node installed to run Commander.

Verification: on a machine where `/usr/local/bin/node` is renamed to prevent discovery, Commander.app still launches and spawns sessions correctly.

### 1.2 — ContextBar per session

Every active session displays a ContextBar at the top of its pane showing:
- **Status indicator** (active / working / waiting / idle / stopped / error) — driven by typed state machine from OSC 133 + tool events (no derivation chains).
- **Action label** (describes what the session is doing right now — e.g., "Running command", "Waiting for approval", "Idle at prompt").
- **Effort indicator + dropdown** (click to change effort for this session; persists to `sessions.effort`).
- **Stop button** (sends SIGINT to pty; visible when session is actively producing output).
- **Token + cost counters** (input / output / cache tokens, cost in USD; updated per turn from `cost_entries`).
- **Context-window %** (used / total for current model; colored band: green / yellow / orange / red per OS §20.RL thresholds).
- **Teammate count** (number of other sessions with same `parentSessionId`, if any; display-only).
- **Session name + manual refresh button** (refresh forces TanStack Query refetch).

ContextBar reads server state via TanStack Query (`useSession(id)`, `useSessionCosts(id)`, etc.). Client state (dropdown open/closed) via Zustand. No ad-hoc Context. No useEffect derivation chains.

### 1.3 — STATE.md drawer per session

Each session pane has a right-side drawer showing the session's project's four canonical files:
- **STATE.md** tab (default open) — live view, updates via FSEvents.
- **DECISIONS.md** tab.
- **PROJECT_DOCUMENTATION.md** tab.
- **CLAUDE.md** tab.

Rendered as markdown via `react-markdown` + `remark-gfm` (full markdown rendering deferred to N3; N2 ships basic readable rendering). Drawer height resizable via drag handle; state persisted per session in `preferences` table (`session.<id>.stateDrawerHeight`).

FSEvents subscription on the four files; drawer contents refresh on file change with no manual refresh needed.

### 1.4 — Split view (multi-session layout)

Main window supports displaying 2 or 3 session panes side-by-side.
- **Enter split view:** menu View → Enter Split View (Cmd+\) OR drag a session from sidebar into the main area.
- **Add a second/third session:** drag from sidebar OR "+" button in existing pane.
- **Resize:** drag the vertical divider between panes. Minimum pane width 400px.
- **Close a pane:** "×" in pane header; session stays alive, just removed from current workspace view.
- **Focus cycle:** Cmd+Opt+→ / Cmd+Opt+← cycles focus between panes.

Layout limited to 2-3 panes in v1 per ARCHITECTURE_SPEC v1.2 §14.1. Workspace schema supports N panes but UI enforces 2-3.

### 1.5 — Workspace persistence

Current workspace state (which sessions are in which panes, pane sizes, drawer heights, drawer tab selections) persists across app restarts. On next launch, workspace reopens exactly as it closed.

Implementation: `workspaces` + `workspace_panes` tables per ARCHITECTURE_SPEC v1.2 §10. Default workspace is "default"; named workspaces deferred to N4.

### 1.6 — Scrollback restore

On app quit OR session close: xterm.js buffer serialized via `@xterm/addon-serialize`, written to `sessions.scrollbackBlob` (5MB cap per §16.6; truncate oldest if exceeded).

On session resume (workspace restore OR manual reopen of stopped session): blob loaded from DB, `term.write(blob)` called, then live pty stream subscription attached.

Visual acceptance: close Commander with 3 active sessions showing varied terminal output (Claude responses, command outputs, scrollback depth 500+ lines); reopen; all 3 sessions show visually identical terminal contents before any new input.

### 1.7 — `.zshrc` opt-in preference

`preferences.zsh.source_user_rc` boolean preference (default `false`) controls whether generated session `zdotdir/.zshrc` attempts to source user's `~/.zshrc`.

When `true`: after OSC 133 hook installs, generated rc emits `[ -f ~/.zshrc ] && timeout 3 source ~/.zshrc 2>/dev/null || true`. On timeout/error, sidecar emits `system:warning` event with text "User .zshrc failed to source within 3s; continuing with hook-only session."

UI: preference toggleable via Preferences window (Cmd+,) under a "Shell" section. Change takes effect on next session spawn (no live reconfig of active sessions).

### 1.8 — `command:ended.durationMs` tracked

Per-session `lastCommandStartedAt` tracker (in-memory in sidecar; reset on each A or B marker). On D marker, `command:ended` event is emitted with `durationMs: Date.now() - lastCommandStartedAt`. Zero-hardcoded-value elimination.

Verification: run `sleep 2` in a Claude Code session; verify `command:ended` event payload shows `durationMs` between 1900 and 2100.

### 1.9 — WebSocket heartbeat + resubscribe-on-reconnect

Frontend wsClient sends `{ type: 'ping' }` every 15s. Sidecar responds with `{ type: 'pong' }`. If no pong received within 5s after ping, client considers connection dead → close + reconnect with exponential backoff (1s / 3s / 9s, max 3 retries within 60s rolling window).

On reconnect: re-run all active subscriptions against the fresh connection. Frontend's subscription registry is the source of truth; not the sidecar's.

Edge case covered: sidecar restarts on a DIFFERENT port (port 11002 was temporarily occupied during restart, sidecar bound to 11003). Frontend's discoverSidecarUrl re-probes 11002..11011 on reconnect failure and finds the new port.

### 1.10 — All N1 behavior preserved

Every §1 criterion from N1 that demonstrably passed MUST still pass at N2 close:
- Commander.app launches, bundle ≤60 MB (N2 target: ≤55 MB given SEA savings).
- Sidecar auto-spawn, clean quit.
- Fresh Drizzle DB, schema + PM v1.2 folds.
- POST /api/sessions spawns PM/Coder/Raw correctly, bootstrap injects.
- xterm.js per session, addon-webgl.
- OSC 133 markers fire.
- Pre-warm pool N=2 default.
- Single-instance enforcement.
- Cmd+Q clean shutdown.

N2 regression on any N1 criterion is a release blocker. Phase does not close until both N1 + N2 criteria pass.

---

## §2 — Architectural contract + spec correction note

CODER treats ARCHITECTURE_SPEC.md v1.2 as canonical, with two §7-queued v1.3 corrections applied in practice:

1. **§8.2 WebviewWindow origin** — CODER does NOT rewrite Tauri's `frontendDist` / `devUrl` pattern to point at sidecar URL. The v1.2 spec was incorrect on this point; v1.3 corrects it to match N1's actual (better) implementation. CODER preserves N1's approach.
2. **§5.4 FSEvents plugin** — use `tauri-plugin-fs` (Tauri v2's fs plugin) for STATE.md file-watching in Task 3 of this dispatch. If the plugin's subscription model is insufficient for multi-file multi-project watching, escalate to PHASE_N2_REPORT §8 (Questions for PM) rather than unilaterally adding a community crate.

Other v1.2 sections load-bearing for N2:
- **§4 State management** — Zustand + TanStack Query split. NO Redux, NO MobX, NO ad-hoc Context for server state.
- **§5 Real-time pipeline** — typed event bus, FSEvents via Tauri plugin, per-session channel isolation.
- **§7 IPC contracts** — three-layer split preserved (Tauri IPC for OS only, WS for streaming, HTTP for query).
- **§9 Feature-to-primitive mapping** — every N2 feature has a row; cite the row when implementing.
- **§10 Drizzle schema** — `workspaces`, `workspace_panes`, `preferences`, `sessionEvents` all already in schema. No new migrations needed for N2 except the `zsh.source_user_rc` default seed.
- **§11 Renderer registry** — NOT required for N2. STATE.md drawer uses basic `react-markdown` rendering; full renderer registry is N3.

**If any v1.2 section is ambiguous or appears to contradict v1.3 corrections, CODER reports in PHASE_N2_REPORT §8 (Questions for PM).** No unilateral spec interpretation.

---

## §3 — Task breakdown (10 tasks, ordered)

Ordered by dependency. Task 1 (SEA) is foundational; Tasks 2-6 are independent UI work (parallelizable in principle, serial in practice for commit discipline); Tasks 7-9 are integration work layering on Tasks 2-6; Task 10 is the full smoke + PHASE_REPORT.

### Task 1 — SEA-bundled sidecar (HIGH effort)

Eliminate the Node 22 prereq by shipping sidecar as a single self-contained executable.

**Approach choice** (CODER decides, reports rationale in PHASE_REPORT §1):
- **Option A — Node SEA (Single Executable Application)** via `node --experimental-sea-config` + `postject`. Official Node pathway.
- **Option B — `@yao-pkg/pkg`** (maintained fork of the archived vercel/pkg). Simpler packaging, known native-module support.

**Native module handling (this is where SEA bundling gets hard):**
- `node-pty` includes native `.node` bindings + the `spawn-helper` binary. Both must survive into the bundled artifact with correct exec permissions.
- `better-sqlite3` includes native `.node` binding.
- Bundled artifact must locate these native assets at runtime (typically via `process.execPath`-relative paths or extraction-to-temp on first run).

**Acceptance:**
- `apps/sidecar/dist/sidecar-bin` is a single executable file, no adjacent `node_modules/`.
- Running `./sidecar-bin` standalone (no Node installed) spawns `/bin/zsh` via node-pty successfully (smoke: same Task 1 Bun verification script from N1, but against the SEA binary).
- Running `./sidecar-bin` opens + queries `commander.db` via better-sqlite3 successfully.
- Commander.app bundle size ≤55 MB (SEA should shave 5-15 MB off the 34 MB N1 size depending on approach).
- Launched on a machine WITHOUT Node in PATH (test: `mv /usr/local/bin/node /usr/local/bin/node.bak` then launch `.app`; restore after test), Commander still works.

**Effort:** HIGH. Native-module bundling with SEA/pkg is where most unexpected failures surface. Budget 1-1.5 days. If both Options A and B fail verification after 1 day of work, escalate to PHASE_N2_REPORT §8 for alternative approaches (pre-bundled native binary sidecar? Rust-hosted sidecar?). Do NOT silently revert to the N1 wrapper + dist + node_modules approach.

### Task 2 — ContextBar component + typed state machine

Build `ContextBar.tsx` in frontend with all §1.2 surfaces + the typed session state machine that drives status.

**State machine (this is the load-bearing piece):**
- Define `SessionState` typed union in `packages/shared/src/session-state.ts`:
  ```ts
  type SessionState =
    | { kind: 'active', since: number }
    | { kind: 'working', commandStartedAt: number, toolInProgress?: ToolName }
    | { kind: 'waiting', approvalPromptId?: string }
    | { kind: 'idle', sinceCommandEndedAt: number }
    | { kind: 'stopped', exitCode: number, at: number }
    | { kind: 'error', message: string, at: number };
  ```
- Transitions driven by typed events:
  - `command:started` → `{kind: 'working', commandStartedAt: <timestamp>}`
  - `command:ended` → `{kind: 'idle', sinceCommandEndedAt: <timestamp>}`
  - `tool:use` → `{kind: 'working', commandStartedAt: <existing>, toolInProgress: <tool>}`
  - `approval:prompt` → `{kind: 'waiting', approvalPromptId: <id>}`
  - `session:status` (from pty.onExit) → `{kind: 'stopped', exitCode, at}`
- State machine lives in sidecar (source of truth), transmitted to frontend via WS `session:state` event (sessionId-scoped).
- Frontend reads via TanStack Query cache; ContextBar subscribes.

**Action label:**
- Derived from state: `active` → "Ready", `working` → "Running command" (or `${toolInProgress}` if set), `waiting` → "Waiting for approval", `idle` → "Idle at prompt", `stopped` → "Stopped (exit ${exitCode})", `error` → "Error: ${message}".
- Pure function, lives in `packages/shared/src/session-state.ts` alongside the type.

**ContextBar internals:**
- Status indicator: small colored dot + state kind label.
- Action label: string derivation.
- Effort dropdown: Radix UI dropdown (install `@radix-ui/react-dropdown-menu` if not present); options PM/Coder/Raw effort defaults; on select, POST /api/sessions/:id with `{effort: <new>}`.
- Stop button: visible when `state.kind === 'working'`; on click, POST /api/sessions/:id/interrupt (new endpoint; sends SIGINT to pty).
- Token / cost counters: useQuery `useSessionCosts(id)` reading `cost_entries` aggregated.
- Context-window %: `state.contextUsed / state.contextTotal * 100`; colored band per OS §20.RL thresholds (green <50%, yellow 50-70%, orange 70-85%, red >85%). Context total comes from `MODEL_CONTEXT_LIMITS` registry (preserve from web Commander or reimplement).
- Teammate count: `useQuery` counting other sessions with same `parentSessionId`.
- Manual refresh button: `queryClient.invalidateQueries(['session', id])`.

**Acceptance:**
- ContextBar renders at top of session pane.
- Status indicator reflects real state within 100ms of the triggering event.
- Effort change persists to DB and reflects on reload.
- Stop button SIGINTs the pty and state transitions to idle.
- Cost counter updates per Claude Code turn (verify by running a turn and watching the number tick).
- Context % colored band transitions correctly as context fills.
- Manual refresh works.

**Effort:** Medium-high. State machine is the conceptually dense part; UI surfaces are mechanical once state is clean.

### Task 3 — STATE.md drawer with FSEvents watching

Build right-side drawer component (`StateMdDrawer.tsx`) with 4-tab markdown view + file watching.

**Drawer shell:**
- Component mounts to right of TerminalPane.
- Width controlled via drag handle on left edge; width persisted per session.
- Collapse/expand via ">" button in drawer header; collapsed state persisted per session.
- Tabs: STATE.md (default) / DECISIONS.md / PROJECT_DOCUMENTATION.md / CLAUDE.md. Tab selection persisted per session.

**File resolution:**
- Session has `projectId` → query `projects` table for `path` → compute file paths: `${path}/STATE.md`, `${path}/DECISIONS.md`, etc.
- Missing file: tab shows "File not found at `${absolute_path}`" placeholder, no error.

**File watching (tauri-plugin-fs):**
- On session mount in pane: subscribe to watch events for the 4 project files.
- On file change event: invalidate `useProjectFile(projectId, filename)` TanStack Query.
- On session unmount OR pane close: unsubscribe.

**Markdown rendering:**
- `react-markdown` + `remark-gfm`. Basic tables, lists, code blocks, links.
- Full markdown rendering (syntax highlighting via `rehype-highlight`, full `@tailwindcss/typography`, link previews, image rendering, etc.) → N3.
- N2 renders sufficient to read STATE.md comfortably. No styling polish beyond basic readability.

**Acceptance:**
- Drawer renders at right of session pane.
- All 4 tabs show correct file contents.
- Editing STATE.md in an external editor causes drawer to refresh within 500ms (FSEvents latency).
- Drawer width / tab selection / collapse state persists across app restart.
- Missing file shown gracefully, not as error.

**Effort:** Medium. Tauri fs plugin subscription model is where any friction will surface.

### Task 4 — Split view (2-3 pane layout)

Build split view shell in `App.tsx` + a `WorkspaceLayout.tsx` component.

**Layout model:**
- Default: 1 pane visible, session controlled by Zustand `activeSessionId`.
- Split: user triggers "Enter Split View" → layout splits into 2 panes, existing session occupies pane 0, pane 1 empty.
- Third pane: "+ Add Pane" in existing split → 3-pane layout.
- Pane 1/2 source: drag from sidebar OR click "+" in the empty pane to open NewSessionModal.

**Pane component:**
- Each pane is a self-contained `SessionPane.tsx` that renders ContextBar + TerminalPane + StateMdDrawer for its assigned `sessionId`.
- Resize handle between panes: draggable vertical bar; updates pane width ratio; persists to workspace_panes.sizes.
- Minimum pane width: 400px.
- Close pane: "×" in pane header; session stays alive (not stopped), just unassigned from current workspace.

**Focus model:**
- Zustand `focusedPaneIndex` state.
- Cmd+Opt+→ cycles forward, Cmd+Opt+← cycles backward.
- Focused pane gets subtle border highlight.
- Keyboard input (when terminal focused) routes to focused pane's pty.

**Layout schema (workspaces.layoutJson):**
- Tree structure: `{type: 'split', orientation: 'vertical', children: [PaneRef, PaneRef, PaneRef?]}` for 2-3 panes.
- Schema supports arbitrary N panes via recursive split nodes (future-proofing per §15 future-scope invariants) but v1 renderer only handles the above shape.
- Validation: if layoutJson has >3 panes, renderer ignores and falls back to first 3.

**Acceptance:**
- Cmd+\ or menu enters split view.
- 2-pane split works; 3-pane works.
- Resizing works; minimum width enforced.
- Close pane works; session stays in sidebar, reusable.
- Cmd+Opt+→/← cycles focus; visual highlight correct.
- Layout persists per §1.5.

**Effort:** HIGH. Split view is always more complex than it looks. Budget 1.5 days.

### Task 5 — Workspace persistence

Implement `workspaces` + `workspace_panes` table writes + restore logic.

**Write path:**
- Every change to active workspace layout triggers debounced (500ms) write to `workspaces.layoutJson` and `workspace_panes` rows.
- Changes include: pane added/removed, pane resized, drawer height changed, drawer tab changed, drawer collapsed/expanded.

**Read path:**
- On app launch: read `workspaces` where `isCurrent = true`; default to a fresh "default" workspace if none exists.
- Restore pane structure from `layoutJson`; assign sessions to panes from `workspace_panes.session_id`.
- If a persisted session no longer exists (was manually deleted): pane renders empty with "Session no longer available" placeholder.

**Default workspace:**
- First launch creates `{id: <uuid>, name: 'default', isCurrent: true, layoutJson: <empty>}`.
- Named workspaces (creating multiple, switching between) → N4.

**Acceptance:**
- Close Commander with 3-pane split view, drawer heights customized, tab selections varied.
- Reopen; layout restored identically.
- Delete a session externally (via DB direct edit for test); reopen; pane shows "Session no longer available" placeholder; doesn't crash.

**Effort:** Medium. Straightforward CRUD on top of Task 4's layout model.

### Task 6 — Scrollback serialize + restore

Wire `@xterm/addon-serialize` (already installed N1) for persistence.

**Serialize on:**
- Session close (pty exit event).
- App quit (Tauri quit handler triggers serialize for all active sessions before sidecar shutdown).
- Manual session pause/stop from UI.

**Size cap:**
- Per §16.6 ratification: 5MB per session max.
- If serialized > 5MB, truncate oldest portion until ≤5MB. Log truncation via `system:info` event.

**Restore on:**
- Workspace restore (Task 5): after session assigned to pane, before live pty subscription, call `term.write(blob)`.
- Manual reopen of stopped session (future; N2 doesn't include UI for this, but the code path works for workspace restore).

**Storage:**
- `sessions.scrollbackBlob` BLOB column (already in v1.2 schema).
- Writes happen via HTTP `PATCH /api/sessions/:id/scrollback` (new endpoint).
- Reads via `GET /api/sessions/:id/scrollback` (new endpoint).

**Acceptance per §1.6:**
- Close Commander with 3 active sessions varied content.
- Reopen; 3 sessions show visually identical terminal contents.
- Turn off/on network (no impact — scrollback is local).
- Serialized blob sizes verifiable via `sqlite3 commander.db "SELECT id, LENGTH(scrollback_blob) FROM sessions;"`.

**Effort:** Medium. Addon already installed; orchestration is the work.

### Task 7 — `.zshrc` opt-in preference

Wire the `preferences.zsh.source_user_rc` flag end-to-end.

**Backend:**
- Seed `preferences` with `{key: 'zsh.source_user_rc', value: 'false', scope: 'global'}` on first run.
- When spawning a session, read the preference. If `true`, generate session `zdotdir/.zshrc` with:
  ```bash
  # JStudio Commander — hook first
  source "$JSTUDIO_OSC133_HOOK_PATH"
  
  # User rc with timeout guard
  if [ -f "$HOME/.zshrc" ]; then
    # timeout via subshell + background + wait
    (
      # sourced in subshell to prevent fatal errors from killing session
      source "$HOME/.zshrc" 2>/dev/null
    ) &
    _rc_pid=$!
    ( sleep 3; kill $_rc_pid 2>/dev/null ) &
    _timer_pid=$!
    wait $_rc_pid 2>/dev/null
    kill $_timer_pid 2>/dev/null
  fi
  ```
  *(CODER: verify this zsh pattern actually works; adjust if needed. The goal is "source with 3s timeout, swallow errors, continue.")*
- If timeout hits (check exit status of sourced subshell): emit `system:warning` WS event with text "User .zshrc failed to source within 3s; continuing with hook-only session."
- If `false` (default): generate rc that sources only the hook, matching N1 behavior exactly.

**Frontend:**
- Add Preferences window (Cmd+, opens a modal).
- Preferences modal has "Shell" section with a toggle: "Source user ~/.zshrc in sessions (experimental)".
- On toggle change, PUT `/api/preferences/zsh.source_user_rc` with new value. Note to user: "Change applies to new sessions."

**Acceptance per §1.7:**
- Default `false`: new session spawn generates hook-only rc (N1 behavior preserved).
- Flip to `true`: new session spawn generates hook + user rc with timeout guard.
- User rc that takes >3s: session still spawns successfully, `system:warning` emitted.
- User rc with fatal error: session still spawns, error swallowed.
- Preferences modal opens on Cmd+,, toggle works, preference persists.

**Effort:** Medium. The zsh timeout-guard pattern is the finicky bit.

### Task 8 — `command:ended.durationMs` tracking

Per-session `lastCommandStartedAt` tracker.

**Implementation:**
- Sidecar's OSC133Parser (from N1): on A or B marker detection, write `Date.now()` to `session.lastCommandStartedAt` (in-memory map keyed by sessionId).
- On D marker: compute `durationMs = Date.now() - session.lastCommandStartedAt`. Emit `command:ended` event with accurate `durationMs`.
- If D arrives without prior A/B (edge case): emit with `durationMs: 0` and log `system:warning`.

**Acceptance per §1.8:**
- Run `sleep 2 && echo done` in a session terminal.
- Verify `command:ended` event has `durationMs` between 1900 and 2100 (log via sidecar console or frontend WS debug view).

**Effort:** Low-medium. 30-min fix per PHASE_N1_REPORT §9. Gold-plating: ensure thread-safety of the in-memory map if multiple commands queue (shouldn't happen in practice but code should be robust).

### Task 9 — WebSocket heartbeat + resubscribe-on-reconnect

Upgrade wsClient for reliable connection.

**Client changes (`apps/frontend/src/queries/wsClient.ts`):**
- After connection open: `setInterval(() => send({type: 'ping'}), 15_000)`.
- Start 5s timeout on each ping: if `pong` received before timeout, all good; otherwise close connection and trigger reconnect.
- Maintain `subscriptionRegistry: Map<channel, handler>` at client level.
- On reconnect (after exponential backoff 1s/3s/9s max 3 retries in 60s rolling window):
  - Re-run `discoverSidecarUrl()` (probes 11002..11011) — handles sidecar restart on different port.
  - Reopen WS to discovered URL.
  - Replay all subscriptions from registry against fresh connection.
  - Resume normal operation.

**Sidecar changes:**
- Accept `{type: 'ping'}` messages → respond `{type: 'pong', timestamp: <now>}`.
- No sidecar-initiated heartbeat needed (client-initiated is sufficient).

**Edge cases to handle:**
- Sidecar crashes, Rust restart logic respawns it on (possibly different) port. Frontend's probe + reconnect handles this.
- Sidecar restart takes >9s (all retries exhaust): frontend enters "Disconnected" state, shows user-visible banner "Sidecar disconnected; click to reconnect." Clicking resets retry counter + probes again.

**Acceptance per §1.9:**
- Kill sidecar process manually (`kill <pid>`). Rust respawns it within 1-3s.
- Frontend detects disconnection within 20s (15s heartbeat + 5s timeout).
- Frontend reconnects within 10s after sidecar back up.
- All active sessions resume receiving pty:data events.
- Force port change (kill sidecar, block 11002 with `nc -l 11002`, respawn sidecar on 11003): frontend discovers new port and reconnects.

**Effort:** Medium. The subscription registry + replay is the subtle part.

### Task 10 — Full smoke + PHASE_N2_REPORT

**Full smoke scenario:**
1. Launch Commander.app from Finder (no Node in PATH for verification).
2. Spawn PM session on `~/Desktop/Projects/jstudio-meta/`. Verify ContextBar renders, state starts at `active`, drawer shows STATE.md.
3. Run a Claude Code prompt. Observe state transitions `working` → `idle`. Cost counter ticks. Context % updates. OSC 133 markers fire (verifiable via sidecar log). `command:ended.durationMs` non-zero.
4. Enter split view (Cmd+\). Drag a second session from sidebar. Resize panes. Cycle focus.
5. Add a third pane via "+". Spawn a Coder session in it. Verify bootstrap injects.
6. Edit an external STATE.md file. Verify drawer refreshes within 500ms.
7. Open Preferences (Cmd+,), toggle `zsh.source_user_rc` to true. Spawn a new session; verify it still works (or system:warning if user rc fails).
8. Kill sidecar manually. Verify frontend reconnects. All sessions resume.
9. Close Commander (Cmd+Q). Reopen. Verify all 3 sessions restore with scrollback intact, drawer states correct, pane sizes preserved.
10. Verify bundle size ≤55 MB. Verify all 42/42 sidecar + 10/10 DB tests pass (plus new N2 tests).

**PHASE_N2_REPORT:**
- Canonical 10-section format per `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`.
- Filed at `native-v1/docs/phase-reports/PHASE_N2_REPORT.md`.
- Target length: 800-1500 words.
- §4 (Deviations) should be meaningfully populated if any spec-implementation gaps surfaced. Empty §4 is suspicious.

**Effort:** Low. Smoke is exercising; report is writing. 0.5 day.

---

## §4 — Explicit non-scope for N2

These features are explicitly NOT built in N2. Phase N3+ covers them.

- **Renderer registry** (tool chips, markdown full parity, system events, approval modal). → N3.
- **ChatThread component** (message grouping, assistant rendering, user message rendering). → N3.
- **Approval modal** (Item 3 sacred). Typed event shape exists; UI lands in N3.
- **Command palette** (Cmd+Shift+P). → N4.
- **Named workspaces + workspace switcher** (Cmd+Shift+W). → N4.
- **Analytics** (per-project, per-model, rate-limit trends, export). Real-time 5h/7d metrics visible in ContextBar via Task 2; dedicated analytics page → N4.
- **Three-role UI** (brief / dispatch / report panes). → N5.
- **Full OS integrations** (Dock badge, menu bar beyond basic, tray icon, global shortcuts beyond basic, Spotlight, drag-drop). → N5.
- **Auto-updater endpoint configuration.** Plugin installed N1; endpoint → N6.
- **Code signing + notarization.** Deferred per N1_ACCEPTANCE_MEMO.md §4.

If CODER finds themselves building any of the above in N2, stop and flag in PHASE_N2_REPORT §4 (Deviations).

---

## §5 — Guardrails carried forward from N1 Attempt 1 + N1 success

These are the same guardrails from N1 dispatch §5, restated because they continue to apply:

1. **No unilateral architectural decisions.** ARCHITECTURE_SPEC v1.2 (with v1.3 corrections) is the contract. Ambiguity → PHASE_REPORT §8.
2. **No silent scope expansion.** "While I'm here" → §6 (Deferred items).
3. **No workarounds without reporting.** If spec is infeasible as written → §4 (Deviations) + §5 (Issues) + flag for CTO ratification.
4. **No "I'll clean it up later."** Every commit ship-quality. Debt declared in §7.
5. **Strict §2.3 Rust scope boundary.** Rust is shell + sidecar glue + OS bridge, nothing more.
6. **OS §24 pattern-matching discipline.** Typed events only. No character-shape matching against tool output.
7. **No partial completion claims.** Every §1 criterion tested before PHASE_REPORT.

**Addition specific to N2:** N1 established a pattern where CODER surfaced a better architectural approach than the spec (deviation D3). This is welcome. The rule is: if CODER believes the spec's approach is wrong, CODER implements what CODER believes is correct AND files the deviation with rationale. CODER does NOT implement the spec's approach silently when CODER thinks it's wrong. Either follow spec or deviate-with-report; never silently second-guess.

---

## §6 — Testing discipline for N2

CODER writes tests as built.

**Test scope:**
- **Unit tests (sidecar):** SEA bundle smoke (Task 1), state machine transition tests (Task 2), scrollback size-cap enforcement (Task 6), `.zshrc` timeout behavior (Task 7), `command:ended.durationMs` accuracy (Task 8), WS heartbeat timing (Task 9).
- **Integration tests (sidecar):** Full session spawn → state transitions → cost accumulation → stop (Task 2), workspace persistence write + read cycle (Task 5).
- **E2E:** The §3 Task 10 smoke scenario automated if feasible; manual if not (document which).
- **Frontend:** minimal. React Testing Library for ContextBar (state → UI mapping), SessionPane (drawer resize), WorkspaceLayout (focus cycling).

**Test runner:** vitest. `pnpm test` from monorepo root passes all suites.

**Target coverage:** 75%+ sidecar, 40%+ frontend. Up from N1's 70%+ sidecar.

---

## §7 — Commit discipline

Minimum 10 commits, one per task. No squashing. Format:

```
<scope>: <imperative summary>

<optional body>

Refs: ARCHITECTURE_SPEC.md v1.2 §<section>, N2_DISPATCH §<task>
```

Scopes: `shell`, `sidecar`, `frontend`, `db`, `shared`, `build`, `test`, `prefs`.

Per N1 precedent: 7 task-commits came in with clean per-task scoping. Continue.

---

## §8 — PHASE_REPORT template reference

Same as N1 dispatch §8. Canonical 10-section format from `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`. Filed at `native-v1/docs/phase-reports/PHASE_N2_REPORT.md`.

---

## §9 — What PM does with this dispatch

1. Read end-to-end against ARCHITECTURE_SPEC v1.2 + N1_ACCEPTANCE_MEMO + v1.3 spec corrections pending fold.
2. Verify Task 1 (SEA) is correctly scoped as HIGH effort with clear escalation path.
3. Verify Task 4 (split view) acceptance criteria match §1.4 observable behaviors.
4. Verify each §1 criterion maps to one or more tasks.
5. Verify §4 non-scope is complete (nothing that should be in N2 is missing; nothing in N2 should be deferred).
6. Verify §5 guardrails carry the correct lessons from N1 + N1 Attempt 1.
7. Produce paste-to-CODER prompt. Include:
   - Full dispatch content (CODER reads start to finish).
   - Explicit "this builds on N1; do NOT regress any N1 §1 criterion" instruction.
   - Required reading: N1_ACCEPTANCE_MEMO.md (for context on deviations accepted), ARCHITECTURE_SPEC v1.2 (canonical, with v1.3 corrections noted in §2 of this dispatch), FEATURE_REQUIREMENTS_SPEC.md, MIGRATION_V2_RETROSPECTIVE.md §4 + §10.
   - OS reading: §14.1, §15, §20.LL-L11 through L14, §23.3, §24.
   - PHASE_REPORT template.
   - If PM is suggesting folding v1.3 spec corrections now (before N2 fires), PM does that fold as a small jstudio-commander commit and references v1.3 in the paste prompt. If PM defers v1.3 fold, CODER uses v1.2 + §2 correction notes from this dispatch.

If PM finds scope gaps, incorrect effort calibrations, or ambiguities that warrant CTO ratification before firing: flag to Jose for CTO round-trip. Otherwise fire.

---

## §10 — What Jose does

1. Save this dispatch to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_DISPATCH_UI_SURFACES.md`.
2. Paste in PM thread per standing orders: "N2 dispatch saved at `docs/dispatches/N2_DISPATCH_UI_SURFACES.md`."
3. Wait for PM review + paste-to-CODER prompt.
4. Spawn fresh CODER (continuing the native-v1 arc; not an architectural reset — N1 foundation stands, N2 builds on it).
5. Paste PM's prompt into fresh CODER.
6. CODER executes over 6-8 working days. Jose checks in at task boundaries.
7. When CODER files PHASE_N2_REPORT.md, Jose carries to PM.
8. PM reviews; if closed cleanly, CTO drafts N3. If gaps, N2.1 addresses.
9. Optionally between N2 close and N3 start: Jose dogfoods N2 build for a few days. Verifies §1 criteria hold under real use. Reports feedback.

---

## §11 — Estimated duration + effort

- **Optimistic:** 6 days (SEA bundling works first approach, split view has no layout bugs, scrollback restore behaves).
- **Realistic:** 7 days.
- **Pessimistic:** 8 days (SEA bundling requires Option A → Option B pivot, split view edge cases take iteration, `.zshrc` timeout pattern requires debugging).

**Per-task effort:**
- Task 1 (SEA): 1-1.5 days, HIGH.
- Task 2 (ContextBar + state machine): 1.5 days, medium-high.
- Task 3 (STATE.md drawer): 1 day, medium.
- Task 4 (split view): 1.5 days, HIGH.
- Task 5 (workspace persistence): 0.5-1 day, medium.
- Task 6 (scrollback): 0.5 day, medium.
- Task 7 (.zshrc opt-in): 0.5 day, medium.
- Task 8 (durationMs): 0.25 day, low.
- Task 9 (WS heartbeat): 0.5 day, medium.
- Task 10 (smoke + report): 0.5 day, low.

Total: 7-8.25 days. Parallelism possible on Tasks 2/3/4 (independent UI components).

**Token budget:** $800-1500 estimated. N2 is larger than N1 in scope; cost scales accordingly.

---

## §12 — Closing instructions to CODER

N2 builds on N1's working foundation. Do not regress any N1 behavior.

Read in order before writing a line of code:

1. This dispatch (start to finish).
2. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md` — specifically §3 (deviations accepted) and §7 (v1.3 spec fold queue).
3. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N1_REPORT.md` — for the architectural decisions already made in N1.
4. `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 (with §2 of this dispatch noting v1.3 corrections).
5. `~/Desktop/Projects/jstudio-commander/docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md`.
6. `~/Desktop/Projects/jstudio-commander/docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` §4 + §10.
7. `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` §14.1, §15, §20.LL-L11 through L14, §23.3, §24.
8. `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`.

Execute 10 tasks in order. Commit at task boundaries. Test as you build. Ask PM for ambiguity — do not guess.

When all 10 §1 criteria + N1's 9 demonstrable criteria pass simultaneously: write PHASE_N2_REPORT.md, file at `native-v1/docs/phase-reports/PHASE_N2_REPORT.md`, notify Jose.

---

**End of N2 dispatch. Ready to fire.**
