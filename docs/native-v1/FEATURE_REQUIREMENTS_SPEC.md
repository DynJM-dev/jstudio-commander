# Native Commander v1 — Feature Requirements Spec (N0 Deliverable 1)

**From:** PM (Commander, 2026-04-22)
**To:** CTO (Claude.ai) for review + folding into Deliverable 2 Architectural Spec
**Scope:** Implementation-agnostic requirements. Feature-by-feature walk of current web Commander. Captures what each feature does for the user, why it matters for JStudio operations, known pain points, and acceptance criteria for v1 native implementation.
**Non-scope:** No architectural prescriptions. No file-layout proposals. No fix dispatches for the bugs catalogued.
**Status:** Draft ready for CTO review.

---

## §0 — Purpose + how to read

Current web Commander is a React + Fastify application that orchestrates Claude Code sessions running inside tmux panes. Jose uses it as the day-to-day surface for running JStudio's AI-led development workflow (CTO strategic thread → PM Commander pane → CODER Commander pane, routed manually).

Native v1 rebuilds Commander as a macOS desktop app (Tauri shell, direct node-pty attach, unified three-role UI). The migration plan is 12/12 complete on the file layout / documentation / workflow side; Phase Y closeout documented that real-time chat status is architecturally unachievable in the web platform's transcript-pipeline model. Native v1 is the structural fix.

This spec catalogs **what native v1 must do for Jose**, not how to build it. File-path pointers reference current implementation for the architect's convenience only — they are not prescriptive for v1.

Each feature block follows the structure:

- **Feature** — name.
- **User-facing description** — what Jose experiences.
- **Why it matters** — the JStudio operational need it serves.
- **Current implementation pointer** — file paths for reference, not prescriptive.
- **Known bugs / pain points** — symptom + impact, not proposed fix.
- **v1 acceptance** — user-observable behavior the native implementation must deliver.

The "why it matters" line is the load-bearing one. If a feature's why-it-matters line is weak, the feature is likely a candidate for the deliberately-left-behind list (§13).

---

## §1 — Session management

### 1.1 — Session spawning

- **User-facing description.** Jose clicks "New Session" → modal prompts session type (PM / Coder / Raw) + effort level (low / medium / high / xhigh) + project path. Session appears in sidebar, enters running state, Claude Code boots inside a terminal with the right bootstrap injected.
- **Why it matters.** Every piece of JStudio work starts here. Session spawn is the primary interaction point; any friction here compounds across 30-50 sessions per day during heavy work.
- **Current implementation pointer.** `client/src/components/sessions/CreateSessionModal.tsx`, `server/src/services/session.service.ts`, `server/src/services/tmux.service.ts`.
- **Known bugs / pain points.**
  - Spawn is reliable today but goes through tmux shell-out, which means startup latency is ~1.5-3s before the session is interactive.
  - No pre-warm option — every spawn is cold.
  - CreateSessionModal effort override shipped as M8 Secondary, but the full spawn flow doesn't surface recent project selection, recent session templates, or "resume a stopped session" in a discoverable way.
- **v1 acceptance.**
  - New-session action available in ≤2 clicks from anywhere in the app.
  - Session is interactive within 1-2s of the modal submit (node-pty attach is faster than tmux shell-out).
  - Session appears in sidebar immediately with accurate initial state (not "pending" for 2-3s).
  - Session type, effort, project path, and optional parent-teammate relationship set at spawn.
  - "Recent projects" list + "resume recently-stopped session" surfaced in modal.

### 1.2 — Session types (PM / Coder / Raw)

- **User-facing description.** Three session types distinguish Jose's orchestration roles. PM sessions inject `pm-session-bootstrap.md` and default to high effort. Coder sessions inject `coder-session-bootstrap.md` and default to medium. Raw sessions are bare Claude Code with no bootstrap injection.
- **Why it matters.** PM and Coder personas are JStudio-constitutional (manual-bridge model, different responsibilities, different context windows). The distinction drives bootstrap injection, effort defaults, and UI affordances (only PM sessions can cc a Coder in the three-role UI).
- **Current implementation pointer.** `server/src/services/session.service.ts` bootstrap path resolution, `packages/shared/src/types/session.ts` `SessionType` enum, `CreateSessionModal` session-type selector.
- **Known bugs / pain points.** None functional. The enum is stable post-M1.
- **v1 acceptance.**
  - Three types preserved: `pm`, `coder`, `raw`.
  - Bootstrap file path resolved per type at spawn; bootstrap text injected before Jose's first prompt.
  - UI labels and icons distinguish session types consistently across sidebar, session cards, context bar.

### 1.3 — Effort level (per-session, adjustable)

- **User-facing description.** Each session has a current effort level (low / medium / high / xhigh). PM defaults to high, Coder/Raw default to medium. Jose can change effort at spawn (CreateSessionModal) or mid-session (SessionCard dropdown or ContextBar dropdown).
- **Why it matters.** Effort directly controls token burn + response quality. Jose's 5-hour rolling budget shows daily spend in the $500-$4,500 range (per TOKEN_ANALYTICS 2026-04-17); effort calibration is a primary cost lever. Without per-session control, Jose can't parallelize high-effort strategic work with medium-effort implementation work cost-effectively.
- **Current implementation pointer.** `SESSION_TYPE_EFFORT_DEFAULTS` constant in `packages/shared/`, `effortCard.ts` helpers in `client/src/components/sessions/`, M8 Primary `SessionCard.tsx` click-to-adjust, M8 Secondary `CreateSessionModal.tsx` spawn override.
- **Known bugs / pain points.**
  - Candidate 36 (effort cross-session display leak in split view) — changing PM's effort caused CODER's Live Terminal mirror to show the `/effort` command. Send path is CLEAN (diagnostic `05bb3c7` proved routing correct); bug is in Phase T mirror display layer. **Structurally eliminated in v1 by per-pane xterm.js terminal — not a shared-channel broadcast, so no cross-pane leak is possible.**
- **v1 acceptance.**
  - Effort level visible per session on sidebar card + context bar.
  - Click-to-adjust works from both surfaces.
  - Change takes effect on the next Claude Code turn.
  - No cross-session display artifacts in split view (verify post-ship per N2 acceptance).

### 1.4 — Bootstrap injection

- **User-facing description.** PM and Coder sessions start with their persona bootstrap text pre-injected, so Claude Code enters "knows its role" state before Jose types.
- **Why it matters.** Personas are the enforcement mechanism for the manual-bridge model. Without bootstrap injection, PM sessions would behave like Raw sessions and the three-role boundary dissolves.
- **Current implementation pointer.** `~/.claude/prompts/pm-session-bootstrap.md` + `~/.claude/prompts/coder-session-bootstrap.md`, injection path in `session.service.ts`.
- **Known bugs / pain points.** Stale ERP_STANDARDS.md reference at pm-session-bootstrap.md:100 was fixed 2026-04-22 (bare file edit, since `~/.claude` is not git-tracked).
- **v1 acceptance.**
  - Bootstrap file path is configurable (currently hardcoded path).
  - Bootstrap injection happens before the first Claude Code prompt is visible; Jose never sees "empty Claude Code" UI state.
  - If bootstrap file is missing, session spawn fails cleanly with a user-visible error (not silent fallback to Raw).

### 1.5 — Session cwd resolution

- **User-facing description.** When Jose spawns a session on a project, Claude Code starts with that project as its working directory. `ls`, `git status`, file paths in Claude's responses all resolve to the project root.
- **Why it matters.** JStudio's codebase is organized by project (`~/Desktop/Projects/*`). Without correct cwd, every tool call would reference the wrong paths.
- **Current implementation pointer.** `resolveSessionCwd` SSOT per Issue 10 (OS §23.7 v2 changelog), `session.service.ts`.
- **Known bugs / pain points.** Historically broken (Issue 10 `execFile('tmux', ['new-session', '-c', '~/...'])` didn't expand `~`). Fixed via `resolveSessionCwd` helper. Stable since 2026-04-18.
- **v1 acceptance.** Session's pty attaches at the correct working directory from first byte. Tilde expansion, symlink resolution, and missing-directory error handling all behave consistently.

### 1.6 — Parent/teammate relationship

- **User-facing description.** A session can have a `parent_session_id` linking it to another session as a "teammate." Jose sees the teammate count in the PM session's ContextBar ("Monitoring 2 teammates"). Used for tracking which Coder sessions are children of which PM.
- **Why it matters.** Visual orientation during parallel work. Jose often runs 3-5 concurrent sessions; the teammate relationship clarifies which Coder is working on which PM's dispatch.
- **Current implementation pointer.** `parent_session_id` column on sessions table, `active-teammate-count` derivation in `ContextBar.tsx`.
- **Known bugs / pain points.**
  - Relationship is display-only — no auto-forwarding between parent and teammate (manual-bridge model enforced).
  - M6 phase confirmed zero auto-forwarding code exists.
- **v1 acceptance.**
  - Parent relationship settable at spawn.
  - Teammate count accurate in ContextBar.
  - Three-role UI (§12) surfaces the relationship visually — Coder's PHASE_REPORT can be routed back to the correct parent PM's compose pane with source attribution.
  - Zero auto-forwarding. Jose presses the button.

### 1.7 — Session lifecycle (active / waiting / working / stopped)

- **User-facing description.** Each session has a current status shown in sidebar card + ContextBar: green (idle/active), yellow (waiting on approval), blue (working), grey (stopped). Visual coherence tells Jose at a glance which sessions need attention.
- **Why it matters.** In split view with 3-5 sessions, status color is the primary signal for "where do I look now?" A wrong status means Jose looks at the wrong pane.
- **Current implementation pointer.** `session.status` field (server-side), `sessionState.kind` typed classifier (Phase U), `effectiveStatus` derivation in `ContextBar.tsx`, Finalizer Track 1 `useSessionPaneActivity` for real-time override.
- **Known bugs / pain points.**
  - Phase Y arc: five rotations of derivation fixes before Finalizer Track 1 ground-truth pivot closed the bulk of status inaccuracy.
  - Even post-Finalizer, end-of-turn jitter (Working → Composing → Working → Idle over ~3s) happens as pane stabilizes. Acceptable in web, polish in native.
  - `session.status` pane-regex classifier lag was the root cause of multiple 15.3 residuals (Candidates 32/33). **Structurally eliminated in v1 by direct node-pty attach — no pane-regex required.**
- **v1 acceptance.**
  - Status flips to "working" within 1s of actual pty activity start.
  - Status flips to "idle" within 1-2s of pty settling (no 3s flicker).
  - "Waiting" status fires immediately when approval modal mounts (Item 3 sacred).
  - No speculative predicate chains driving status — ground-truth pty attach.

### 1.8 — Synthetic-id reconciliation on orphan adoption

- **User-facing description.** If Commander restarts while a tmux session is still alive, Commander adopts it as a session row. The row was previously stuck with a synthetic id (`...-0000-0000-0000-000000000000`) and `recovered-jsc-*` display name until Candidate 27 fix (`a6ca156`) added first-hook reconciliation.
- **Why it matters.** Without reconciliation, orphan-adopted sessions would stay "anonymous" forever, and all cross-referencing (Claude Code logs, agent relationships, token analytics) would break for those rows.
- **Current implementation pointer.** `server/src/index.ts:275-303` (adoption path), C27 fix adds reconcile-on-first-hook.
- **Known bugs / pain points.** Fixed 2026-04-22. Also: Candidate 45 (detectExistingCommander preflight-miss → instance-lock-hit during N1 Attempt 1) suggests the startup collision check has a resolver race worth auditing in v1.
- **v1 acceptance.**
  - If Commander restarts while a session's terminal is alive, the session reconciles on the first Claude Code event with correct id + display name.
  - Startup collision-detection preflight returns accurate results (no IPv4/IPv6 resolver race).

---

## §2 — Terminal integration (v1: direct node-pty)

### 2.1 — Terminal session spawn + attach

- **User-facing description.** Each Commander session owns a terminal. In v1, this is a node-pty-attached pty, rendered via xterm.js. Jose sees the same thing Claude Code sees — no fidelity loss.
- **Why it matters.** The terminal is ground truth. Every Phase Y arc rotation failed because derivation chains couldn't match what the terminal already knew. V1 eliminates the derivation by making the terminal itself the UI.
- **Current implementation pointer.** Current Commander shells out to `tmux new-session` + `tmux send-keys` + polls `tmux capture-pane` at 1.5s cadence. V1 replaces all three with node-pty direct.
- **Known bugs / pain points.**
  - Tmux shell-out has 1.5-3s spawn latency.
  - Pane-regex classifier (deriving session state from capture text) has persistent lag that Candidates 32/33 tracked and Finalizer Track 1 partially worked around.
  - Candidate 37 (`can't find pane: %NNN` stderr spam, 2x post-Phase-T): stale-`tmux_session` rows cause repeated failed captures. **Structurally eliminated when tmux is removed.**
- **v1 acceptance.**
  - Terminal spawns in ≤1s from node-pty attach command.
  - Every byte Claude Code writes to pty is observable by v1 within ~50ms.
  - No polling. No shell-out.
  - Terminal emulator is fully interactive (scrollback, copy-select, search, resize).

### 2.2 — Sending input to terminal

- **User-facing description.** Jose types in the ContextBar input (or types directly in the terminal pane), hits Enter, Claude Code receives it.
- **Why it matters.** Primary interaction. If input has even 100-300ms lag (as current tmux send-keys occasionally does on macOS), it breaks flow.
- **Current implementation pointer.** `tmux send-keys -t <pane> -l <text>` + newline; server-side at `tmux.service.ts:sendKeys`. Client-side issues POST `/sessions/:id/command` which triggers the send-keys.
- **Known bugs / pain points.**
  - Current send is server-hop (client → server → tmux) — ~50-200ms round-trip.
  - Attachment flow (C44 residual) doesn't relay attachments through the tmux layer even though client-side C44 fix shipped; full attachment submit still broken.
- **v1 acceptance.**
  - Input latency from keystroke to pty write ≤30ms (direct stdin write, no server hop — or minimal Rust IPC hop).
  - Attachment submit works end-to-end (drag-drop file, empty text, Enter → Claude Code receives the `@<path>` syntax or equivalent attachment token).
  - Multi-line paste handled cleanly (bracketed paste support).

### 2.3 — OSC 133 shell integration (new in v1)

- **User-facing description.** Terminal knows when a command starts and when it ends, via OSC 133 escape sequences. V1 uses this to power real-time status signaling (instead of pane-regex classifier).
- **Why it matters.** This is the architectural fix for the Phase Y ceiling. OSC 133 emits `PromptStart`, `CommandStart`, `CommandEnd` explicitly — no guessing.
- **Current implementation pointer.** Not present today; v1 net-new.
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - Terminal's shell (zsh) emits OSC 133 markers around each command.
  - xterm.js (or v1's terminal layer) parses markers and emits typed events (`command:started`, `command:ended`).
  - Session status driven by these events, not regex.
  - Claude Code's tool turns map to OSC 133 markers naturally (Claude emits the commands, shell emits the markers).

---

## §3 — Real-time event pipeline

### 3.1 — Typed event bus

- **User-facing description.** Internal to the app, but visible to Jose when something goes wrong — e.g. ContextBar status lags because an event didn't fire. When events are typed correctly, the UI stays accurate.
- **Why it matters.** Every visible Commander surface (sidebar, ContextBar, ChatThread, Live Terminal, STATE.md drawer) is a subscriber to events. Event correctness = UI correctness.
- **Current implementation pointer.** `server/src/ws/event-bus.ts` (typed EventEmitter), `server/src/ws/rooms.ts` (broadcast/subscribe helpers), `server/src/ws/index.ts` (event → channel mapping).
- **Event catalog (current web — reference only):**
  - Global channels: `sessions`, `projects`, `analytics`, system events.
  - Per-session channels: `chat:<sessionId>`, `project-state:<sessionId>`, `pane-capture:<sessionId>`.
  - Types: `session:created`, `session:updated`, `session:status`, `session:deleted`, `chat:message`, `chat:messages`, `project:updated`, `project:scanned`, `project:state-md-updated`, `session:pane-capture`, `session:tick`, `session:heartbeat`, `teammate:spawned`, `teammate:dismissed`, `analytics:token`, `pre-compact:state-changed`, `system:stats`, `system:rate-limits`, `system:error`, `system:event`, `tunnel:started`, `tunnel:stopped`.
- **Known bugs / pain points.**
  - `session:pane-capture` is the load-bearing event that Finalizer Track 1 subscribes to; it ships ~1.5s pane text diffs which is cheap-but-not-free. V1 replaces with OSC 133 + node-pty data events (ground truth).
  - No renderer-registry event type (Candidate 29 / 35 / 40 — `task_reminder` + `api_error` + other unmapped attachments fall through to generic renderers).
- **v1 acceptance.**
  - Typed event catalog enumerated exhaustively (no generic fallback for known-possible types).
  - Per-session event channels isolate correctly (no cross-session leaks like Candidate 36).
  - Events emit within ~10-50ms of the underlying signal (not 1.5s polling).
  - Renderer registry exhaustive by type — every Claude Code output shape has a typed renderer or explicit suppression.

### 3.2 — File watchers

- **User-facing description.** Commander watches filesystem paths and surfaces changes. Chokidar watches project STATE.md for live-update in M7 pane. JSONL transcript files are watched for new Claude Code events to render.
- **Why it matters.** STATE.md pane + ChatThread both depend on filesystem-driven updates. Without the watcher, Jose would have to manually refresh.
- **Current implementation pointer.** `server/src/services/watcher-bridge.ts` + `server/src/services/file-watcher.service.ts` (chokidar wrapping).
- **Known bugs / pain points.**
  - Chokidar polls on some macOS configurations (fsevents flaky), adding latency.
  - Watcher-bridge emission timing was identified as one possible upstream mechanism for the Phase Y ceiling (never fully investigated per cost-bounded call).
- **v1 acceptance.**
  - File changes surface in UI within ~100-500ms.
  - Uses FSEvents on macOS (no polling fallback needed for v1 since we're macOS-only).
  - Watcher crash doesn't degrade app — auto-reconnect + user-visible error if persistent.

### 3.3 — Per-session isolation

- **User-facing description.** Changing session A doesn't affect session B's UI. Split-view rendering stays isolated.
- **Why it matters.** Concurrent sessions are the primary JStudio workflow. Any cross-talk (like Candidate 36's effort display leak) undermines trust in the surface.
- **Current implementation pointer.** Per-session channels on the event bus, per-session React hook instances.
- **Known bugs / pain points.**
  - Candidate 36 (mirror display layer) — subscription layer proven clean, display layer suspected. Structurally eliminated in v1 via per-pane terminal.
  - usePreference same-tab sync gap (Phase T hotfix `9bba6ab`) — subtle React hook-instance interaction bug; v1's architecture should avoid by construction.
- **v1 acceptance.**
  - Events scoped to sessionId never reach a different session's subscribers.
  - UI surfaces (ContextBar, ChatThread, terminal pane, STATE.md drawer) verify isolation via structural tests, not just integration.

---

## §4 — ContextBar

### 4.1 — Status + action label

- **User-facing description.** Bottom bar of each session pane shows current status (idle / working / waiting / stopped) with colored dot + action label ("Running command...", "Composing response...", "Working...", "Waiting for input").
- **Why it matters.** Primary status surface. Jose glances here to decide "is this session done?"
- **Current implementation pointer.** `client/src/components/chat/ContextBar.tsx`, `resolveEffectiveStatus` helper, Finalizer Track 1 `useSessionPaneActivity` wiring.
- **Known bugs / pain points.**
  - Five Phase Y rotations fought this surface. Current (post-Finalizer) state is acceptable but has end-of-turn jitter.
  - Label derivation (`resolveActionLabelForParallelRun`) still has legacy-guard residue (Class 2 divergences ~56% of JSONL entries pre-Finalizer).
- **v1 acceptance.**
  - Status flips to "working" within 1s of pty activity start.
  - Action label matches tool in flight (e.g. "Reading file.ts" while a Read tool runs).
  - Status flips to "idle" within 1-2s of pty settling.
  - No predicate-chain fallback layers — single typed state from OSC 133 + tool-event stream.

### 4.2 — Effort indicator + dropdown

- **User-facing description.** Effort level badge on right side of ContextBar. Click opens dropdown (low / medium / high / xhigh). Selection dispatches `/effort <level>` to the session.
- **Why it matters.** Per §1.3 — cost lever.
- **Current implementation pointer.** `ContextBar.tsx`, `effortCard.ts` helpers shared with SessionCard (M8 Primary DUPLICATION pattern).
- **Known bugs / pain points.** Candidate 36 (cross-session display leak) — structurally eliminated in v1.
- **v1 acceptance.** Same as §1.3.

### 4.3 — Stop button

- **User-facing description.** When session is actively working, red Stop button appears in ContextBar. Click interrupts Claude Code (sends ESC or Cmd+.).
- **Why it matters.** Safety control. Without a visible Stop, Jose can't interrupt a runaway turn from the UI (ESC shortcut works but is non-discoverable).
- **Current implementation pointer.** `ContextBar.tsx:696` visibility gate `(isActivelyWorking || hasPrompt || interrupting)`. Visibility gated on Finalizer Track 1 ground-truth signal.
- **Known bugs / pain points.**
  - Pre-Finalizer, Stop was invisible during long pure-text streaming (Phase Y ceiling).
  - Finalizer closed the visibility bug. Stop click routing is per-pane by React construction (paneFocus.ts predicate only needed for global ESC handler).
- **v1 acceptance.**
  - Stop button visible whenever the session's pty is actively producing output.
  - Click immediately interrupts the current turn (send Cmd+. / ESC to pty).
  - Routes to the correct session in split view — no cross-pane interrupts.
  - Hidden within 1-2s of pty settling.

### 4.4 — Token + cost + context-window display

- **User-facing description.** ContextBar shows current session's token count, cost in $, and context-window fill percentage (color band: green / yellow / orange / red).
- **Why it matters.** Cost visibility + compaction timing. If Jose doesn't see 5h-budget approaching, he hits rate limit mid-work.
- **Current implementation pointer.** `session_ticks` SQLite table, `useChat` stats, `contextBands.ts` for color thresholds.
- **Known bugs / pain points.**
  - Context-% sometimes stale post-compact until next turn (Issue 15.1-C force-refresh mitigation).
  - Token analytics queryable via TOKEN_ANALYTICS_* reports (external tooling).
- **v1 acceptance.**
  - Token + cost update within ~1-2s of turn completion.
  - Context-% fills within 3s of compact-boundary event.
  - Color bands match current thresholds (reference `contextBands.ts`).
  - Click-to-expand reveals per-model breakdown + 5h budget status.

### 4.5 — Teammate count label

- **User-facing description.** When a session has active teammates (Coders spawned under a PM), ContextBar shows "Monitoring N teammates" or "N working / M total teammates" — prevents misleading "Waiting for input" when teammates are actually busy.
- **Why it matters.** Visual orientation during parallel work — Jose needs to know the PM is "paused because teammates are working," not "paused because it needs my input."
- **Current implementation pointer.** `ContextBar.tsx:418-434` activeTeammate count derivation.
- **Known bugs / pain points.** None known.
- **v1 acceptance.** Same behavior preserved. Count accurate. Label doesn't confuse "paused waiting" vs "paused monitoring."

### 4.6 — Manual refresh button

- **User-facing description.** Small refresh icon in ContextBar. Click force-refreshes chat state. 1s checkmark confirms success.
- **Why it matters.** Escape hatch for when the reactive pipeline misses a beat. Jose's confidence in the app requires a "manually re-sync" option.
- **Current implementation pointer.** `useChat.refetch()`, `ContextBar.tsx:725+`.
- **Known bugs / pain points.** Used to be needed more often pre-Finalizer; now mostly vestigial.
- **v1 acceptance.**
  - Refresh button present (discoverability for edge-case debugging).
  - In normal operation, Jose should never need it — v1's ground-truth architecture should eliminate stale state.

### 4.7 — Approval modal mount point (Item 3 sacred)

- **User-facing description.** When Claude Code hits an approval prompt (permission needed for Edit, Write, Bash, etc.), a modal appears above ContextBar with Allow / Deny / Custom options.
- **Why it matters.** JStudio's permission model enforces explicit user consent. Approval path is the surface where Jose says "yes I authorize this."
- **Current implementation pointer.** `client/src/hooks/usePromptDetection.ts`, `client/src/components/chat/PermissionPrompt.tsx`, ContextBar mount point. Waiting-passthrough in `resolveEffectiveStatus` preserves this path byte-identical through every rotation.
- **Known bugs / pain points.**
  - Shipped in Item 3 (`00f1c30`). Stable.
  - Currently derives from tmux pane regex — fragile.
- **v1 acceptance.**
  - Approval modal mounts within ~100-500ms of Claude Code's prompt appearing in pty output.
  - Allow / Deny selections dispatch to Claude Code correctly.
  - Custom option available for edits requiring modification.
  - Modal dismissal on approval → status flips back to "working" within 1s.

---

## §5 — ChatThread + assistant rendering

### 5.1 — Message grouping

- **User-facing description.** User messages render individually; assistant messages group consecutively under a single bubble; tool_result blocks attach to the tool_use that triggered them.
- **Why it matters.** Reading experience. Unfragmented assistant turns scroll naturally; grouped user messages would feel awkward.
- **Current implementation pointer.** `client/src/utils/plans.ts` grouping logic, `ChatThread.tsx:529-599` render.
- **Known bugs / pain points.** Stable.
- **v1 acceptance.**
  - Group semantics preserved: assistant grouped, user individual, tool_result attached to parent tool_use.
  - Render performance handles 1000-message scrollback without lag.

### 5.2 — Tool chip rendering

- **User-facing description.** Each `tool_use` block renders as a chip (Read, Edit, Write, Bash, Agent, Task, Grep, Glob, etc.) with tool name + params + status. Result block appears below when the tool completes.
- **Why it matters.** Primary signal for "what is Claude doing right now." The tool chip + its result are often the only way to verify "did the right thing happen?"
- **Current implementation pointer.** `client/src/components/chat/ToolCallBlock.tsx`, `AssistantMessage.tsx` block dispatcher, three render paths (Agent / ActivityChip / ToolCallBlock).
- **Known bugs / pain points.**
  - Finalizer smoke showed tool chips sometimes arrive all-at-end (upstream transcript pipeline batches), not incrementally. **Structurally eliminated in v1 via node-pty direct.**
  - Candidate 29/35/40 — unmapped renderer for `task_reminder` + `api_error` + other system subtypes. Defer to native rebuild.
- **v1 acceptance.**
  - Every Claude Code tool has a typed chip renderer (exhaustive registry).
  - Tool chips arrive incrementally as Claude emits them (not batched to end-of-turn).
  - Unknown tools render as typed "generic" chip with tool name visible (not silently dropped).

### 5.3 — Assistant text block rendering + markdown

- **User-facing description.** Assistant text renders with markdown formatting — headings, lists, bold, italic, inline code, code fences with syntax highlighting, tables, blockquotes, horizontal rules.
- **Why it matters.** Assistant responses are the primary output; markdown parity with VSCode Claude is the quality bar (Candidate 30).
- **Current implementation pointer.** `text-renderer.tsx`, `CodeBlock.tsx`, remark/rehype stack.
- **Known bugs / pain points.** Candidate 30 (markdown parity with VSCode Claude). Defer to native rebuild. Headings, lists, code spans are ~80% of perceived quality gap.
- **v1 acceptance.**
  - Visual parity with VSCode Claude sidebar render for identical source markdown.
  - Code-fence syntax highlighting present (rehype-highlight or equivalent).
  - Tables, blockquotes, task lists, inline emoji all render correctly.
  - Dark-mode-aware (matches v1 theme system).

### 5.4 — Inline reminder + attachment rendering

- **User-facing description.** Claude Code emits system subtypes like `task_reminder`, `api_error`, CLI-command echoes, local-command stdout blocks, attachment uploads. Each needs a discrete render treatment.
- **Why it matters.** Defensive communication + debugging context. When Claude hits an api_error, Jose needs to see it, not have it silently dropped.
- **Current implementation pointer.** `jsonl-parser.service.ts:512` (task_reminder routing), `InlineReminderNote.tsx`, various block-type renderers scattered.
- **Known bugs / pain points.** Renderer registry gaps (C29 / C35 / C40). Defer to native rebuild.
- **v1 acceptance.**
  - Exhaustive typed registry — every known Claude Code attachment type + system subtype has a typed renderer.
  - New types caught at registry-audit time (Candidate 35 merged with C29 + C30 + C40 as a single renderer-rewrite phase).
  - Unknown types render as labeled "Unmapped (<type>)" with raw content visible — not silent drop.

### 5.5 — Approval prompt rendering (in-thread variant)

- **User-facing description.** Some approval prompts render as in-thread choice chips (Allow / Deny / Custom) rather than modal overlay, depending on the prompt shape.
- **Why it matters.** Contextual permission — Jose sees the prompt where the operation is, not always in a blocking modal.
- **Current implementation pointer.** `PermissionPrompt.tsx`, shared with modal path.
- **Known bugs / pain points.** None known.
- **v1 acceptance.** Same inline-vs-modal dispatch logic preserved. Choice dispatch routes to the right pty.

### 5.6 — LiveActivityRow (thinking-block surface)

- **User-facing description.** When Claude is mid-thought (thinking block active), a small "Cogitating..." row appears with animated verb + elapsed time. Disappears when text or tool_use takes over.
- **Why it matters.** Signals "Claude is still working, not hung."
- **Current implementation pointer.** `LiveActivityRow.tsx`, `liveActivity.ts::extractLiveThinkingText` (C42 pre-text scan narrowing).
- **Known bugs / pain points.** C42 bleed fixed in Rotation 1.7.C. Post-text thinking no longer bleeds response content into the activity row.
- **v1 acceptance.**
  - Thinking block renders during thinking; replaced by text/tool on transition.
  - No bleed from post-text thinking.
  - Real-time elapsed counter (seconds since thinking started).

### 5.7 — Scroll anchor behavior

- **User-facing description.** When Jose's scroll position is at the bottom, new messages push down smoothly. When scrolled up, a "new messages" pill appears instead of jumping the viewport. User's own sends ALWAYS scroll to bottom (C39 fix).
- **Why it matters.** Scroll discipline is a quality-of-life feature. Wrong scroll-anchor behavior is disorienting.
- **Current implementation pointer.** `ChatThread.tsx:434` auto-scroll gate, C39 user-sent override branch.
- **Known bugs / pain points.** C39 fixed 2026-04-22. Stable.
- **v1 acceptance.**
  - User-send always scrolls to bottom.
  - Assistant streaming respects scroll position (doesn't yank viewport if user is reading older content).
  - "New messages" pill fallback when scrolled above fold.

### 5.8 — Compact-boundary rendering

- **User-facing description.** When `/compact` runs, a visual divider appears in the transcript with summary of what was compacted. Post-compact context-% resets.
- **Why it matters.** Jose needs to know when compaction happened and roughly what was condensed.
- **Current implementation pointer.** `compact_boundary` + `compact_summary` block types, inline divider renderer.
- **Known bugs / pain points.** None known.
- **v1 acceptance.** Visual divider + summary visible. Context-% refresh fires within 3s of boundary event (Issue 15.1-C).

---

## §6 — Terminal pane (v1: real xterm.js, replacing Phase T mirror)

### 6.1 — Real-time terminal view per session

- **User-facing description.** Each session has a terminal pane showing live pty output. Jose sees exactly what Claude Code sees — same characters, same colors, same spinner animations, same progress bars.
- **Why it matters.** Ground truth. Debugging Claude Code tool failures, seeing shell output, watching compilation progress — all require fidelity.
- **Current implementation pointer.** `TmuxMirror.tsx` renders `ansi_up`-converted capture-text tail at 1.5s cadence. V1 replaces with xterm.js attached to pty.
- **Known bugs / pain points.**
  - Current Phase T mirror is sampled, not live — misses fast updates.
  - Candidate 36 (display leak between split-view sessions) suspected to be a render-layer bug in the capture-to-HTML path. Structurally eliminated in v1 via per-pane xterm.js instance.
- **v1 acceptance.**
  - Terminal pane is a real xterm.js instance (or equivalent) attached to the session's pty.
  - Scrollback, select-copy, search, resize all work.
  - ANSI colors, spinners, progress bars render with full fidelity.
  - Zero cross-session display artifacts in split view.
  - Per-session toggle to hide/show (keyboard: Cmd+J carries over).

### 6.2 — Terminal input (optional — typing directly into terminal)

- **User-facing description.** Jose can click into the terminal pane and type directly, like a normal terminal. Complement to ContextBar input.
- **Why it matters.** Some interactions (e.g. password prompts, curses-style TUIs, fzf) require direct terminal interaction.
- **Current implementation pointer.** Not present — Phase T mirror is read-only.
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - Click to focus terminal, type, Enter dispatches to pty.
  - Focus shares with ContextBar input (either can send).
  - No input drops under normal typing speed.

---

## §7 — STATE.md pane + project state

### 7.1 — Live STATE.md view per session

- **User-facing description.** Each session can open a drawer showing the project's STATE.md. Live-updates when STATE.md file changes (no manual refresh).
- **Why it matters.** STATE.md is the PM's primary "where are we now" doc. Live view keeps Jose oriented without tab-switching to an editor.
- **Current implementation pointer.** `ProjectStateDrawer.tsx`, `useProjectStateMd` hook, `watcher-bridge.ts` project-state path, `StateViewer.tsx` markdown renderer.
- **Known bugs / pain points.**
  - M7 MVP only shipped STATE.md — full M7 scope (four-file tabbed view, project-type badge, recent activity feed, DECISIONS filter) deferred indefinitely.
  - Preference persistence (drawer open/heightPx per-session in DB) deferred to full-M7.
- **v1 acceptance.**
  - STATE.md live view per session.
  - File changes reflect within ~200-500ms.
  - Drawer toggle via keyboard shortcut (currently Cmd+Shift+S).
  - Mutual exclusion with terminal drawer (can't have both open).
  - **v1 upgrade:** multi-file tabbed view of canonical docs (CLAUDE.md, PROJECT_DOCUMENTATION.md, STATE.md, DECISIONS.md) per M7 full scope — now in v1 since it's a clean rewrite opportunity.

### 7.2 — Project metadata display

- **User-facing description.** Session header (or dedicated project pane) shows project name, client, industry, stack badges, current phase (parsed from STATE.md).
- **Why it matters.** Visual orientation — which project is this session working on?
- **Current implementation pointer.** Not fully shipped — plan §M7 originally scoped this, MVP deferred it.
- **Known bugs / pain points.** N/A (new in v1).
- **v1 acceptance.**
  - Project view in native v1 (new route or pane).
  - Shows all active projects with current phase, last activity, associated sessions.
  - Clicking a project card navigates to session list or file links.
  - Filesystem-driven (no manual project registration).

---

## §8 — Split view

### 8.1 — Multi-session side-by-side

- **User-facing description.** Jose can have 2-3 sessions visible simultaneously, each with its own ContextBar, ChatThread, terminal pane, and STATE.md drawer.
- **Why it matters.** Parallel work is the JStudio default — PM + Coder concurrent, or multiple Coders running parallel migrations.
- **Current implementation pointer.** `PaneContainer.tsx` with `data-pane-session-id` stamping, per-pane ChatPage instances.
- **Known bugs / pain points.**
  - Candidate 19 (ESC cross-pane interrupt leak) fixed via `paneFocus.ts` predicate.
  - Candidate 36 (effort display leak) — structurally eliminated in v1.
  - usePreference same-tab sync hotfix (`9bba6ab`) — subtle React-instance interaction bug.
- **v1 acceptance.**
  - 2-3 sessions visible at once without layout friction.
  - Each pane fully independent — events, state, focus all isolated.
  - Pane reorder via drag.
  - Keyboard shortcut to cycle focus (Cmd+Opt+→ / ←).
  - Pane close via Cmd+W (closes pane, not app).

### 8.2 — Workspace persistence

- **User-facing description.** Jose closes Commander; next launch restores the split-view layout that was active.
- **Why it matters.** Resume where you left off. Rebuilding the layout every launch is friction.
- **Current implementation pointer.** Partial — sessions persist, layout does not (last active pane restored per-session).
- **Known bugs / pain points.** Layout is lost on close.
- **v1 acceptance.**
  - Full workspace state (which sessions in which panes, sizes, drawer states) persists across app quit/restart.
  - Named workspaces ("morning work," "client-X audit") optional v1 polish.

---

## §9 — Session management surfaces

### 9.1 — SessionCard (sidebar card per session)

- **User-facing description.** Each session shows as a card in the sidebar: status dot, session type icon, project name, last-activity timestamp, effort badge, teammate count (if parent).
- **Why it matters.** At-a-glance inventory of running sessions.
- **Current implementation pointer.** `SessionCard.tsx`, effortCard.ts (M8 click-to-adjust).
- **Known bugs / pain points.** None functional.
- **v1 acceptance.**
  - All current info visible per card.
  - Drag-and-drop to reorder sidebar.
  - Right-click menu: open / rename / stop / delete / clone.
  - "Recently stopped" section for session revival.

### 9.2 — CreateSessionModal

- **User-facing description.** Modal with session type selector (PM / Coder / Raw), project path picker, effort dropdown (default per type), optional parent teammate selector.
- **Why it matters.** Primary spawn surface.
- **Current implementation pointer.** `CreateSessionModal.tsx`, M8 Secondary effort override.
- **Known bugs / pain points.** None functional.
- **v1 acceptance.**
  - Keyboard-first: Cmd+N opens modal, tab navigation through fields, Enter submits.
  - Recent projects list (filesystem-driven) at top.
  - Recent session templates (common type + project combos).
  - Effort override at spawn.
  - Parent teammate selector with visible relationship hint.

### 9.3 — Sidebar (navigation + filtering)

- **User-facing description.** Left column. Session list grouped by project (or filter by type). Filters: active / stopped / all, by type, by effort, by parent.
- **Why it matters.** Session management at scale (10-20 sessions across 5 projects).
- **Current implementation pointer.** `Sidebar.tsx`.
- **Known bugs / pain points.** None functional.
- **v1 acceptance.**
  - Grouped view + flat view toggles.
  - Filter chips.
  - Search.
  - Keyboard navigation (Cmd+1/2/3 to jump between active sessions).

### 9.4 — Project view (v1-new surface, was M7-deferred)

- **User-facing description.** Dedicated view listing all JStudio projects with per-project card: name, stack badges, current phase from STATE.md, last activity, associated sessions (PM + Coder for this project), quick links to open canonical files in editor.
- **Why it matters.** Cross-project overview — "where is my portfolio?" — currently requires manually checking each project's STATE.md.
- **Current implementation pointer.** Not shipped — M7 deferred beyond MVP.
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - Shows all active projects (filesystem-driven, no manual registration).
  - Per-project card per §7.2.
  - Click project card → project view with associated session list + STATE.md + DECISIONS.md accessible.
  - New projects appear automatically when a new directory with `CLAUDE.md` is added to `~/Desktop/Projects/`.

---

## §10 — Preferences + persistence

### 10.1 — SQLite database

- **User-facing description.** Commander persists everything locally. Sessions, messages, token counts, cost, user preferences, project metadata, session_ticks telemetry — all in `~/.jstudio-commander/commander.db`.
- **Why it matters.** Offline-first, no cloud dependency, Jose owns his data.
- **Current implementation pointer.** `better-sqlite3`, `server/src/db/schema.sql` + migrations in `server/src/db/connection.ts`.
- **Known bugs / pain points.**
  - Candidate 26 — session_ticks retention + UNIQUE constraint missing (750 rows / 5 sessions observed; `INSERT OR IGNORE` is no-op). Defer to native rebuild.
  - Schema accumulated 20+ ALTER migrations — worth consolidating into clean v1 schema.
- **v1 acceptance.**
  - Fresh v1 schema with proper constraints (UNIQUE, CHECK, foreign keys).
  - Retention policy built-in (session_ticks, cost_entries age-out).
  - Migration strategy from existing web commander.db (first-launch one-shot).
  - Drizzle ORM (per CTO scoping brief primitive choice) for type-safe queries.

### 10.2 — usePreference pattern (per-key UI state)

- **User-facing description.** UI state like "terminal drawer height," "STATE.md drawer open," "mirror visible" persist per-session (or globally for app-level prefs). Change in one pane syncs to others.
- **Why it matters.** Resume-where-you-left-off + consistent UI state across panes.
- **Current implementation pointer.** `usePreference.ts`, preferences table in SQLite, Phase T hotfix `9bba6ab` same-tab peer sync.
- **Known bugs / pain points.**
  - Subtle React hook-instance interaction bugs (Phase T Fix Z). V1 architecture should avoid by construction.
- **v1 acceptance.**
  - Typed preference API (no string keys scattered).
  - Cross-instance sync correct by default.
  - App-quit-safe (no data loss on crash).

### 10.3 — Cost telemetry + token analytics

- **User-facing description.** Commander aggregates token usage + cost per session, per model, per project. Queryable for daily reports (e.g. TOKEN_ANALYTICS_*.md).
- **Why it matters.** Cost governance. Without visibility, spend spirals.
- **Current implementation pointer.** `session_ticks`, `cost_entries`, `token_usage` tables; `analytics:token` event.
- **Known bugs / pain points.**
  - Stats reported via statusline (`session_ticks.sum_cost_reported`) diverge from actual (`cost_entries.cost_usd`) — two sources of truth. Visible in analytics as "reported vs actual."
- **v1 acceptance.**
  - Unified cost source of truth.
  - In-app analytics view (top sessions, per-project breakdown, last 14 days, per-model).
  - Budget warning when 5h-rolling spend approaches threshold.
  - Export to markdown/CSV for external analysis.

---

## §11 — Skill + persona integration

### 11.1 — PM / Coder bootstrap loading

- **User-facing description.** When a PM or Coder session spawns, the corresponding bootstrap file is injected as the first message, so Claude Code enters the session knowing its role.
- **Why it matters.** Persona enforcement — see §1.4.
- **Current implementation pointer.** `~/.claude/prompts/pm-session-bootstrap.md` + `~/.claude/prompts/coder-session-bootstrap.md`; injection path in `session.service.ts`.
- **Known bugs / pain points.** Stale ERP_STANDARDS reference fixed.
- **v1 acceptance.**
  - Bootstrap file path configurable per session type.
  - In-app bootstrap reloader (per CTO catalog adjustment — skill hot-reload consideration for N3 brief, equivalent utility for bootstraps).
  - Bootstrap file watch-reload during dev for fast iteration.

### 11.2 — Standards + OS reference

- **User-facing description.** Sessions have access to `~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` + `standards/*.md` (LANDING, DASHBOARD, REDESIGN, INVESTIGATION_DISCIPLINE) — loaded on demand when dispatches reference them.
- **Why it matters.** Single source of truth for JStudio conventions.
- **Current implementation pointer.** File paths referenced in bootstraps + dispatches.
- **Known bugs / pain points.** None.
- **v1 acceptance.** Preserved paths. V1 doesn't bundle ops docs inside the app (they stay in jstudio-meta).

### 11.3 — Slash command hot-reload (new in v1)

- **User-facing description.** Jose can reload PM/Coder bootstraps without restarting the session via a reload button or keyboard shortcut.
- **Why it matters.** Fast iteration on persona tuning. Currently requires spawning a new session.
- **Current implementation pointer.** Not present.
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - Reload button in session header or settings pane.
  - Re-injects bootstrap as a system message into the current session.
  - Preserves chat history — bootstrap appears as an injected reminder, not a reset.

---

## §12 — Three-role UI (new in v1 — the biggest qualitative leap)

### 12.1 — Unified window with three panes

- **User-facing description.** One Commander window contains three named panes:
  - **Brief review** — shows CTO output Jose pasted in from the Claude.ai thread.
  - **Dispatch compose** — PM's output (dispatch draft), with "copy to CODER" affordance.
  - **Report consumption** — CODER's PHASE_REPORT incoming, routed back toward the correct parent PM.
- **Why it matters.** Replaces the current three-browser-tab routing. Reduces bridge friction while preserving the human-in-loop invariant.
- **Current implementation pointer.** Not present — new in v1.
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - Single Commander window exposes all three panes.
  - Panes visually distinct (different accent colors, labels, icons).
  - Source attribution visibly shown per pane: "from: CTO (Claude.ai)", "from: PM", "from: CODER" — per CTO §7 framing addition.
  - Jose pastes CTO text into brief-review pane; PM pane pre-populates with context; "send to CODER" button copies text to clipboard AND highlights the target CODER pane.
  - No auto-forwarding. Jose presses the button. Nothing leaves a pane without his action.

### 12.2 — Context inheritance across panes

- **User-facing description.** When Jose clicks "draft dispatch from this CTO brief," the PM pane opens with the brief's context loaded. When CODER's PHASE_REPORT comes back, it routes to the PM pane that spawned it.
- **Why it matters.** Currently Jose manually cross-references which CTO decision → which PM dispatch → which CODER ship. Native can make the graph explicit.
- **Current implementation pointer.** Not present.
- **Known bugs / pain points.** N/A.
- **v1 acceptance.**
  - Relationship graph visible (CTO brief → PM dispatch → CODER commit/report).
  - Jose can jump between related documents with one click.
  - Graph persists across app restarts.
  - No auto-action — only navigation aids.

### 12.3 — Clipboard routing safety

- **User-facing description.** "Copy to CODER" puts text on clipboard + highlights CODER pane. Jose still presses Enter (or pastes manually). No auto-paste, no auto-submit.
- **Why it matters.** Manual-bridge invariant is constitutional. V1 reduces friction without removing agency.
- **Current implementation pointer.** N/A (new).
- **Known bugs / pain points.** N/A (new).
- **v1 acceptance.**
  - "Copy" action: text to clipboard + visual confirmation + target pane highlight.
  - No auto-dispatch, no auto-send.
  - Undo affordance: if Jose clicks copy by mistake, clipboard restored.

---

## §13 — Deliberately left behind (v1 does NOT port these)

V1 architecture structurally eliminates these — porting them would be carrying dead weight:

### 13.1 — Phase Y transcript-authoritative derivation chain

- `useToolExecutionState` hook and its subtype union.
- `useCodemanDiffLogger` parallel-run logger.
- `~/.jstudio-commander/codeman-diff.jsonl` file.
- `debug.routes.ts` (loopback-IP-gated endpoint for JSONL append).
- All 15.3-arc legacy guards: `typedIdleFreshKillSwitch`, `lastTurnEndTs`, `isSessionWorking` OR-chain, Fix 1/2, Option 2/4, Activity-gap, heartbeat-stale gate.
- `resolveEffectiveStatus` and `resolveActionLabelForParallelRun` predicate chains.

**Why:** all of these derive status from the transcript pipeline, which is structurally laggy. V1's OSC 133 + node-pty data events + pty exit code give typed, real-time, ground-truth status with none of these derivations needed.

### 13.2 — Phase T tmux-capture mirror

- `TmuxMirror.tsx` (ansi_up-converted pane capture rendering).
- Phase T pane-capture polling at 1.5s cadence.
- `session:pane-capture` event.
- `useSessionPaneActivity` hook (Finalizer Track 1 workaround).

**Why:** v1 renders a real xterm.js terminal attached to pty directly. The capture-and-re-render approach is a hack; v1 has no need for it.

### 13.3 — Tmux capture-pane infrastructure

- `tmux.service.ts` capturePane + sendKeys shell-out.
- `status-poller.service.ts` (1.5s tick).
- Pane-regex classifier in `agent-status.service.ts` (Candidates 32/33 root cause).
- Orphan-tmux-adoption path (Commander restart + tmux-alive).
- `check-case-collisions.sh` script (OS-level tmux folder case safety).

**Why:** v1 owns the pty directly. Tmux is not in the picture. No tmux-layer pane aliasing (Candidate 36), no stale-pane stderr (Candidate 37), no case-collision risk.

### 13.4 — Server-side `session.status` string derivation

- The `session.status` field as a pane-regex-derived string.

**Why:** v1 drives status from OSC 133 + tool-event stream + pty exit. Typed, not a string.

### 13.5 — Attempt 1 Tauri wrapper scaffold

- `src-tauri/**` in current working directory from N1 Attempt 1.
- `scripts/prepare-sidecar.sh`.
- Placeholder-dist workaround.
- Node-binary-bundling approach (copy host $(which node) verbatim).

**Why:** v1 is ground-up per CTO ratification 2026-04-22. Attempt 1 scaffold stays on disk as reference but is not the v1 starting point.

---

## §14 — Cross-subsystem invariants

### 14.1 — Manual-bridge model

**Constitutional.** Jose is the sole routing agent between CTO ↔ PM ↔ CODER. No persona bypass, no auto-forwarding, no auto-dispatch. V1 reduces bridge friction via unified UI; v1 does NOT reduce bridge *control*. Every dispatch requires Jose pressing a button or pasting text.

### 14.2 — Ground truth over derivation (OS §20.LL-L14)

V1 subscribes to pty data events, OSC 133 markers, filesystem FSEvents. V1 does NOT derive state from downstream artifacts when a ground-truth signal exists. Architectural spec must audit every derivation chain it introduces against the L14 test.

### 14.3 — Plain-language reframe signal (OS §20.LL-L13)

V1 architecture decisions ratified by CTO should match how Jose would describe the system to a new dev in plain English. If the architecture diverges from the plain-language description, the architecture is wrong.

### 14.4 — Item 3 waiting-passthrough sacred

The approval-modal path (`usePromptDetection`, Item 3 `00f1c30`) must survive byte-identical semantics in v1. It is the safety-critical consent surface; any regression is ship-blocker.

### 14.5 — Per-session isolation by construction

Events, state, rendering — per-session scoping is not a runtime check but a structural property. V1 architecture spec must make cross-session leakage impossible, not merely unlikely.

### 14.6 — Token/cost governance

Visibility into 5h-rolling budget + daily spend is not optional. V1 must surface rate-limit proximity before Jose hits it.

---

## §15 — Open questions for Deliverable 2 (Architecture Spec)

PM recommendations that CTO should ratify or adjust in Deliverable 2:

1. **OSC 133 shell integration strategy** — zsh has OSC 133 support via a shell hook; what Claude Code emits via stdout mapping into OSC 133 needs architectural decision.
2. **Renderer registry exhaustive type design** — how to guarantee every Claude Code output shape has a typed renderer. Compile-time type check? Runtime registry audit?
3. **Three-role UI routing graph** — what's the data model for CTO brief → PM dispatch → CODER report relationships? Explicit graph table? Derived from clipboard-event log?
4. **Drizzle schema first pass** — sessions, session_ticks, cost_entries, preferences, tool_events, permissions, project_metadata. CTO drafts clean v1 schema.
5. **Bundle size target** — web Commander <5 MB served vs N1 Attempt 1's 160 MB bundle. What's the v1 target?
6. **IPC contract** — Tauri Rust ↔ Node/Bun sidecar ↔ React frontend. Which primitives for which communications? Tauri IPC for UI, WebSocket for streaming, HTTP for query?
7. **Sidecar process model** — `tauri-plugin-shell` managed vs raw `std::process::Command` + crash-recovery loop? Heartbeat?
8. **First-run Gatekeeper UX** — signed from v1 (requires Apple Developer cert $99/yr) or unsigned with "right-click → Open" on first launch?
9. **Workspace persistence schema** — pane layout, sizes, drawer states persist how? Dedicated workspaces table?
10. **Migration from web commander.db** — one-shot first-launch copy, or fresh v1 database + manual import on demand?
11. **Claude CLI invocation** — path discovery (`which claude`), version pinning, update-check on launch?
12. **Future-scope invariants** — what architectural choices preserve optionality for (a) multi-AI terminals (Codex, Cursor, Aider in addition to Claude Code), (b) workspace grids (10+ sessions visible), (c) swarm orchestration (PM dispatches to N Coders in parallel), (d) external distribution (team members / clients using Commander)?

---

## §16 — End of spec

This spec captures every user-visible Commander feature, mapped against v1 native acceptance criteria, with bugs logged for architectural absorption, not mid-audit fixing. Deliberately-left-behind list documents what v1 shrinks.

Total ~4500 words. Ready for CTO review.

**N0 Deliverable 1 complete, ready for CTO architectural spec draft.**
