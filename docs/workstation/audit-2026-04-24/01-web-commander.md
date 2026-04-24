# Web Commander Audit — Input for JS WorkStation Rebuild

**Auditor:** Claude (subagent, read-only forensic pass)
**Date:** 2026-04-24
**Scope:** `server/src/`, `client/src/`, `packages/shared/` of `/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/`
**Purpose:** Extract what JS WorkStation must preserve, improve, and scrap from the web Commander that Jose uses daily.
**Corroboration:** Cross-referenced against `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md`, `docs/SESSION_SPAWN_BREAKDOWN.md`, `docs/phase-y-closeout.md` — those three documents are the calibration anchor; this report verifies their claims against actual code and adds forensic detail.

---

## 1. System architecture (as-built)

**Backend runtime.** Fastify 5 on Node (ESM build, `package.json` root imports). `server/src/index.ts:55` instantiates `Fastify({logger: {level: 'info'}})`; entry file is 373 lines of wiring. Plugins registered: `@fastify/cors`, `@fastify/static` (prod only), `@fastify/multipart` (10 MB cap per file, 5 files/request at `server/src/index.ts:85-87`), `@fastify/websocket`.

**Frontend stack.** React 19 + Vite on port 11573 (non-standard; `index.ts:119` VITE_URL fallback), TypeScript strict. State: React Context + useState — no Redux/Zustand. WebSocket singleton via `wsClient`. Animations: `framer-motion`. Icons: `lucide-react` exclusively. ANSI rendering: `ansi_up`. Markdown: remark/rehype stack (`text-renderer.tsx`, `CodeBlock.tsx`).

**Process model.** Single Fastify server process. Child processes are shelled out via `execFileSync('tmux', …)` at `server/src/services/tmux.service.ts:10-26` — no persistent child processes, tmux runs the Claude Code PTY behind the scenes. This is the architectural root cause of every Phase Y ceiling bug: Commander does not own the PTY, it observes it via shell-out + polling + chokidar.

**IPC / WS topology.**
- HTTP REST on `/api/*` for reads and one-shot writes (POST `/api/sessions`, POST `/api/sessions/:id/command`, POST `/api/sessions/:id/key`, etc.).
- WebSocket at `/ws` with an Origin allowlist (`server/src/ws/index.ts:18-25, 36-41`). Subscribe/unsubscribe protocol; server pushes typed events.
- Channels: see §3.

**Database.** `better-sqlite3` with WAL mode (`server/src/db/connection.ts:20`), `foreign_keys = ON`. Base schema: `server/src/db/schema.sql` (158 lines). Runtime-accreted migrations: `server/src/db/connection.ts:32-194` — 14 `ALTER TABLE` paths, 2 table creations (preferences, session_ticks), 1 retroactive heal, 1 UTC timestamp audit. Zero migration-version tracking; every add-column uses a `PRAGMA table_info` predicate for idempotency. This is the "accrete a column every rotation" pattern the v1 clean schema should replace.

**Bundle shape.** Client served from Vite in dev. Production `client/dist/` is gated on `NODE_ENV=production` at `server/src/index.ts:98-109` because a stale `dist/` silently shadowed the dev bundle on 2026-04-17 (inline comment preserves the postmortem). Bundle size not measured here — FEATURE_REQUIREMENTS_SPEC §15.Q5 flags `<5 MB served` as the target vs. N1 Attempt 1's 160 MB.

---

## 2. Session spawn flow (end-to-end)

The spawn flow is captured in `docs/SESSION_SPAWN_BREAKDOWN.md` in prose; this section verifies and supplements with line citations.

**Entry point:** POST `/api/sessions` → `server/src/routes/session.routes.ts:110-121` → `sessionService.createSession(opts)` at `server/src/services/session.service.ts:425-601`.

**Step 1 — cwd canonicalization.** `resolveSessionCwd(opts.projectPath, null)` at `session.service.ts:241-279, 446`. Tilde expansion + trailing-slash normalize + `realpathSync` to handle symlinks (`/tmp` → `/private/tmp`). Critical for JSONL-bind watcher working directory resolution (Issue 15.2).

**Step 2 — tmux session creation.** `tmuxService.createSession(tmuxName, inputCwd)` at `session.service.ts:447` → `tmux new-session -d -s jsc-<uuid-prefix> -c <cwd>` at `tmux.service.ts:48-54`. Session name = `jsc-` + first 8 hex of UUID.

**Step 3 — pane ID resolution.** `resolveFirstPaneId(tmuxName)` at `session.service.ts:459` → `tmux list-panes -t <name> -F '#{pane_id}'` → stores `%NN` pane id. Introduced in Phase S.1 Patch 1 to fix the OvaGas PM-to-Coder message leak: previously `tmux_session` held the session name, and `send-keys -t <name>` routed to whichever pane was active (the foot-gun). See `tmux.service.ts:56-83` for full rationale.

**Step 4 — canonical cwd via pane.** `tmuxService.resolvePaneCwd(paneId)` + `resolveSessionCwd(opts.projectPath, paneCwd)` at `session.service.ts:476-477`. Pane's real cwd becomes the source-of-truth if the user didn't supply one.

**Step 5 — JSONL bind watcher starts.** `bindClaudeSessionFromJsonl(id, canonicalCwd)` at `session.service.ts:497` — starts a chokidar watch on `~/.claude/projects/<encoded-cwd>/` BEFORE sending the `claude` keystroke. This is Phase T Patch 0. Without this, the first hook event races the bind and the `resolveOwner` cascade can't find an owner. Watcher implementation at `session.service.ts:282-357`; 30-second timeout.

**Step 6 — claude keystroke injection.** `setTimeout(() => tmuxService.sendKeys(sendTarget, 'claude --model \'claude-opus-4-7\''), 500)` at `session.service.ts:500-509`. 500ms shell-init delay. Single-quoted model flag prevents zsh globbing of `[1m]` (Issue 8 Part 1).

**Step 7 — DB row transaction.** `session.service.ts:524-546` — `db.transaction(() => { upsertSession(...); INSERT session_events })`. On transaction failure, kill the orphan tmux session (`session.service.ts:551-558`). Initial status = `'working'` because tmux + claude are launching.

**Step 8 — async ready-wait + effort + bootstrap.** `session.service.ts:573-596`. Async IIFE:
1. `waitForClaudeReady(tmuxName, 12_000)` — polls `capturePane` every 400ms looking for `❯` glyph or "? for shortcuts" text (`session.service.ts:110-120`). 12-second timeout.
2. `sendKeys('/effort <level>')` — effort from `SESSION_TYPE_EFFORT_DEFAULTS` (pm=high, coder/raw=medium), overridable via `opts.effortLevel`.
3. 800ms pause to let effort ack render.
4. `sendKeys(bootstrap)` if PM or Coder type. Bootstrap read from `~/.claude/prompts/pm-session-bootstrap.md` or `coder-session-bootstrap.md` (`session.service.ts:90-105`). Missing file → session continues without bootstrap.

**Timing characteristics (from code comments).** Tmux spawn latency 1.5-3s per FEATURE_REQUIREMENTS_SPEC §1.1 and confirmed in `session.service.ts:499` 500ms init pause + `waitForClaudeReady` 400ms poll cadence with 12s ceiling. Bootstrap injection adds ~800ms.

**Teammate path (separate).** Not user-initiated; driven by `team-config.service.ts` chokidar watcher on `~/.claude/teams/<name>/config.json`. `upsertTeammateSession()` at `session.service.ts:684-758`. Teammates carry `tmuxPaneId` from config, not tmux spawn.

---

## 3. Event pipeline + WS topology

**Typed event bus.** `server/src/ws/event-bus.ts:16-132`. Extends `EventEmitter` (max listeners 50, line 134). Every emitter is a typed method — no direct `.emit('raw-string')` from callers. Event classes:

- **Session lifecycle:** `session:created`, `session:updated`, `session:status`, `session:deleted` (lines 18-32).
- **Chat:** `chat:message` (single), `chat:messages` (batch) (lines 35-41).
- **Projects:** `project:updated`, `project:scanned`, `project:state-md-updated` (per-session STATE.md) (lines 44-58).
- **Terminal mirror:** `session:pane-capture` (ANSI-preserved, per-session) (lines 62-65).
- **Analytics:** `analytics:token` (line 68-70).
- **Tunnel:** `tunnel:started`, `tunnel:stopped` (lines 73-79).
- **Teammates:** `teammate:spawned`, `teammate:dismissed` (lines 82-88).
- **Telemetry:** `session:tick` (statusline forwarder, Phase M), `session:heartbeat` (Phase N.0 Patch 3 proof-of-life) (lines 90-101).
- **System stats:** `system:stats`, `system:rate-limits` (Phase O host sampler) (lines 104-113).
- **Pre-compact:** `pre-compact:state-changed` (idle → warned → compacting → idle) (lines 118-120).
- **System:** `system:error`, `system:event` (lines 123-129).

**Typed WSEvent union.** `packages/shared/src/types/ws-events.ts:10-84`. 28 discriminated variants. Clients pattern-match on `event.type`. Includes forward-compat variants for `terminal:data` / `terminal:resize` that were stripped when Phase P.3 H4 deleted the half-built PTY preview (`server/src/index.ts:17-19` preserves the post-mortem comment).

**Rooms / channels.** `server/src/ws/rooms.ts:5-91`. In-memory `Map<string, Set<WebSocket>>`. Broadcast fan-out pattern:
- **Global:** `sessions`, `projects`, `analytics`, `system`.
- **Per-session:** `chat:<sessionId>`, `project-state:<sessionId>`, `pane-capture:<sessionId>`.

Event → channel wiring at `server/src/ws/index.ts:48-178`. Important duplication: `session:tick` broadcasts on BOTH `sessions` (for grid) AND `chat:<sessionId>` (for ContextBar). `session:pane-capture` only on `pane-capture:<sessionId>`.

**Frontend subscription.** `useWebSocket.tsx` (not inspected in full but referenced at `TmuxMirror.tsx:39-42`, `useSessionPaneActivity.ts:58-63`). Reference-counted subscriptions so split-view double-subscribes on the same channel without duplicating server-side emits (implied by comment at `useSessionPaneActivity.ts:56-57`).

**Cross-session isolation.**
- **Event-bus level:** per-session channels (`chat:<id>` / `pane-capture:<id>`) — Map keyed by string, no cross-contamination possible at the rooms layer.
- **React hook level:** `useSessionPaneActivity.ts:76-87` filters by `event.sessionId !== sessionId` — defense-in-depth.
- **DOM level:** `paneFocus.ts:25-38` `isActiveInDifferentPane` predicate — each pane stamps `data-pane-session-id={sessionId}` (`PaneContainer.tsx:256`), global ESC handlers check focus ownership before firing. This is Candidate 19 fix.
- **Health beacon:** separate 5s cadence at `server/src/ws/index.ts:175-177` — `broadcastAll('system:health')` — used as a server-down signal by clients (10s absence = banner).

---

## 4. JSONL parser + renderer registry

**Parser entry point.** `server/src/services/jsonl-parser.service.ts:192-251`. Two entry methods: `parseFile(filePath)` (full) and `parseLines(lines[])` (incremental from file-watcher). `parseRecord(raw)` dispatches on `record.type`:
- `'user'` → `parseUserRecord`
- `'assistant'` → `parseAssistantRecord`
- `'system'` → `parseSystemRecord`
- `'attachment'` → `parseAttachmentRecord`
- **Default** → `debug_unmapped` block (never silent drop) — Issue 5 invariant at lines 10-22.

**Drop policy.** Explicit denylists in `packages/shared/src/constants/event-policy.ts`: `DROP_RECORD_TYPES`, `DROP_SYSTEM_SUBTYPES`, `DROP_ATTACHMENT_TYPES`. "Default = render, never vanish" is the architectural principle. Unknown shapes surface as `<UnmappedEventChip>` with raw preview.

**Assistant block parsing.** `parseAssistantBlocks` at `jsonl-parser.service.ts:110-151`. Known types: `text`, `thinking` (with optional `signature`), `tool_use`. Unknown → `debug_unmapped` with kind `'assistant_block'`.

**ContentBlock union (client-visible renderer contract).** `packages/shared/src/types/chat.ts:17-84`. 15 typed variants:
- Primary: `text`, `thinking`, `tool_use`, `tool_result`
- System: `system_note`, `compact_boundary`, `compact_summary`, `inline_reminder`
- Attachments: `file_attachment`, `compact_file_ref`, `file_edit_note`, `skill_listing`, `invoked_skills`, `queued_command`, `local_command`
- Escape hatch: `debug_unmapped`

**Renderer dispatch.** `client/src/components/chat/ChatThread.tsx:542-627` renders groups; `SystemNote` (line 78-218) is the registry for system-role groups with 11 branches on `firstBlock.type`. Fall-through at line 117-127 surfaces `<UnmappedEventChip>` for anything with `type: 'debug_unmapped'`.

**Assistant rendering.** `ChatThread.tsx:614-621` → `<AssistantMessage>` (220 lines; `components/chat/AssistantMessage.tsx`, not fully audited but its block dispatcher has three render paths: Agent / ActivityChip / ToolCallBlock per FEATURE_REQUIREMENTS_SPEC §5.2).

**Tool chip rendering.** `client/src/components/chat/ToolCallBlock.tsx` (331 lines, not fully audited). Dispatches on `tool_use.name` for Read/Edit/Write/Bash/Agent/Task/Grep/Glob/Skill/SendMessage per `contextBarAction.ts` action-label derivation at `ContextBar.tsx:59-80`.

**Live activity row.** `client/src/components/chat/LiveActivityRow.tsx` — surfaces `SessionActivity` (verb/spinner/elapsed/tokens/effort) parsed from the tmux pane at `server/src/services/agent-status.service.ts:112-178` by the `ACTIVITY_RE` regex (line 80-82). Verb morphology filter (Issue 8 Part 3) at line 139-140: accept `-ing` / `-ed` / `Idle` only, reject reply-content false positives like "Opus 4.7…".

**Known renderer gaps (still open in code).** Per FEATURE_REQUIREMENTS_SPEC §5.4:
- Candidate 29 / 35 / 40 — `task_reminder`, `api_error`, and other unmapped system subtypes fall through to the generic `debug_unmapped` chip rather than a typed renderer. Surface is not broken but quality is degraded. Deferred to native rebuild.
- Candidate 30 — markdown parity with VSCode Claude (headings, lists, code-span styling). Deferred.

---

## 5. Approval modal path (Item 3 sacred)

This is the safety-critical consent surface. Preserved byte-identical through every rotation since `00f1c30`.

**Detection chain.**
1. **Server:** `agentStatusService.classifyStatusFromPane` at `server/src/services/agent-status.service.ts:378-487`. Branches for `hasNumberedChoiceInTail`, `hasNumberedChoiceBlock`, then `WAITING_INDICATORS` regex (lines 212-225) — all require **explicit option tokens** (Issue 9 Part 2). Result: `SessionStatus = 'waiting'`.
2. **Hook-yield gate bypassed:** `status-poller.service.ts:358-364` — `pendingToolUse` override even fires from `'waiting'` upward to `'working'` if JSONL has unmatched tool_use (Issue 15.3 Phase 1.1).
3. **Client fetch:** `client/src/hooks/usePromptDetection.ts:62-145` polls `GET /api/sessions/:id/output?lines=15` at a cadence of 1s (userJustSent or waiting), 2s (working), 8s (idle) per `computePromptDetectionCadence` at lines 32-39. **No gate on `isActive`** — Issue 15.3 Tier A Item 3 explicitly removed that gate because it killed polling during force-idle-mid-approval (v5 §11.3 Class A bug).
4. **Server-side prompt detection:** `server/src/services/prompt-detector.service.ts:66-153`. Four explicit branches: `trust this folder` (lines 74-80), numbered ❯ 1. choice block (lines 85-108), Allow+Deny pair (lines 112-128), (y/n) parenthetical (lines 132-137). Explicit kill-switches at lines 57-64 (bypass-permissions footer, teammate-waiting).
5. **Client mount:** `ChatPage.tsx` wires `usePromptDetection` → `<PermissionPrompt>` above the `<ContextBar>`. See `PermissionPrompt.tsx:22-192`.
6. **Waiting-passthrough preservation:** `client/src/utils/contextBarAction.ts:108-120` `resolveEffectiveStatus` — **line 114 is load-bearing:** `if (sessionStatus === 'waiting') return 'waiting'`. This short-circuits every other derivation (codeman, paneActive, legacy). Any edit to `resolveEffectiveStatus` must preserve this first branch.

**Dispatch.** `PermissionPrompt.tsx:26-39`: `api.post('/sessions/:id/key', {key})` for Escape; `api.post('/sessions/:id/command', {command})` for allow/deny/numbered/custom. Key endpoint at `server/src/routes/session.routes.ts:197-224` — `sendRawKey` (no Enter append). Command endpoint at line 179-194 — `sendKeys` (Enter appended).

**Why "sacred."** The approval modal is the surface that says "yes I authorize this destructive Bash/Write/Edit." Any regression here means Jose either misses an approval (silent deny) or Claude proceeds without consent (safety hole). The waiting-passthrough at `contextBarAction.ts:114` and the always-poll cadence at `usePromptDetection.ts:102-143` are both tested in `phase-y-rotation-1-5-hotfix.test.ts:54-64` and `phase-y-tool-execution-state.test.ts:495-509` ("Phase Y hook must not couple to Item 3 approval path").

---

## 6. ContextBar (status + actions)

**File:** `client/src/components/chat/ContextBar.tsx` (861 lines — the single most dense surface in the codebase, product of 5+ rotations of Phase Y arc).

**Status derivation chain (top to bottom):**
1. `useSessionPaneActivity(sessionId)` → `paneActivelyChanging: boolean` (lines 446-447). This is Phase T ground truth (pane-delta WS signal).
2. `resolveEffectiveStatus(sessionStatus, codemanState.isWorking, isWorking, paneActive)` at line 466-471 → `effectiveStatus`. Precedence (per `utils/contextBarAction.ts:108-120`):
   - `sessionStatus === 'waiting'` → always `'waiting'` (Item 3 sacred).
   - `paneActive` → `'working'` (Phase T pane ground truth).
   - `codemanState.isWorking === true` → `'working'`.
   - `codemanState.isWorking === false` → `'idle'`.
   - Fallback: legacy `isWorking && sessionStatus !== 'working' ? 'working' : sessionStatus`.

**Label derivation.** `resolveActionLabel` at `contextBarAction.ts:200-282`. Priority: typed `sessionState.kind` (server-emitted canonical state) > `jsonlLabel` (client-derived via `getActionInfo` at `ContextBar.tsx:44-83`) > `terminalHint` fallback. Special cases:
- `Compacting` kind always wins ("Compacting context...").
- `WaitingForInput` switches on subtype (Approval/TrustFolder/NumberedChoice/YesNo/Generic).
- `Working:ToolExec` inverts: prefer `jsonlLabel` first (getActionInfo has richer context like "Reading STATE.md…"), then typed subtype fallback (Issue 15.3 §6.1 inversion).
- `Working:Generic` + stale Idle guard: if `isWorking && jsonlLabel` → return jsonlLabel even when sessionState.kind is stale Idle (Issue 15.3 Fix 2, lines 252-266).

**Codeman parallel run.** `useCodemanDiffLogger` at line 404-411 emits `[codeman-diff]` divergence log for the Rotation 1 parallel-run evidence collection. This is the `useToolExecutionState` transcript-authoritative hook. Per Phase Y closeout, this architecture has a ceiling — silently deleted in v1 per FEATURE_REQUIREMENTS_SPEC §13.1.

**Stop button.** Lines 687-708. Visibility gate: `onInterrupt && (paneActive || isWorking || hasPrompt || interrupting)`. Post-Finalizer this is the ground-truth visibility: pane delta is authoritative. Click dispatches ESC/Cmd+. to the PTY via `/key` endpoint.

**Effort dropdown.** Lines 298-341, 801-858. `EFFORT_LEVELS` imported from `@commander/shared` (Issue 8 Part 2 full ladder: low/medium/high/xhigh/max). Click dispatches `POST /sessions/:id/command {command: '/effort <level>'}` then `PATCH /sessions/:id {effortLevel}` to persist.

**Token/cost/context display.** Lines 742-789. `formatTokens(displayTokens)`, `Brain` icon + context-% with `bandColor(bandForPercentage())` from `contextBands.ts`. Context % resolution at `resolveContextPercent` (lines 271-280) — tick-first, token/contextLimit ratio fallback.

**Teammate count label.** Lines 418-434, 141-150, 155-161. Counts sessions where `parent_session_id === sessionId || parent_session_id === claudeId`. Labels:
- PM waiting + teammates working → "Monitoring N teammates" (not "Waiting for input").
- PM idle + teammates working → same label with teal-blue dot.

**Manual refresh.** Lines 303-314, 716-740. Calls `onRefresh` (wired to `useChat.refetch()` + `POST /sessions/:id/rescan`). 1s `Check` icon confirms success.

**Long-task pill.** Lines 525-527, 659-675. Elapsed ≥60s shows "Long task" or plan progress "Step M/N" when `getActivePlan(messages)` returns a Plan tool invocation.

**Elapsed counter.** `LiveElapsed` at line 87-106 — rAF-driven millisecond ticker. Anchored on `lastBoundaryTs` — last user message OR first assistant-after-user (line 583-598). Reset on turn boundary, not on isWorking flip.

---

## 7. Preferences + persistence

**SQLite preferences table.** Created in `server/src/db/connection.ts:199-205`:
```sql
CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
```
Single k/v store. No schema, no types — caller serializes to JSON.

**usePreference pattern.** `client/src/hooks/usePreference.ts:76-156`.
- Module-level `cache: Map<string, unknown>` for intra-tab dedup (line 8).
- Module-level `subscribers: Map<string, Set<listener>>` for same-tab peer sync (lines 25-56) — Phase T hotfix `9bba6ab`. Without this, two instances of `useSessionUi(id)` in PaneHeaderWithMirror + Pane diverged on local state until cross-tab WS echo arrived.
- Cross-tab sync: WS `preference:changed` event (lines 130-139).
- Writer path: `update(next)` sets cache, calls setValue, notifies peers, fires `PUT /preferences/:key` (fire-and-forget with silent catch — banner surfaces server downtime elsewhere).

**What is persisted where:**
- Global pane state: `preferences.'pane-state'` (PaneState shape at `packages/shared/src/types/pane-state.ts:18-22`). Right session id + divider ratio + focus. URL owns left.
- Per-session UI: `preferences.'session-ui.<sessionId>'` (SessionUi shape at lines 40-50). `terminalDrawerOpen`, `terminalDrawerHeightPx`, `mirrorVisible`.
- Legacy `split-state.*` keys migrated one-shot to `pane-state` at `server/src/index.ts:141-142` via `migrateLegacySplitState`.

**Typed API caveat.** String keys are scattered across call sites. `usePreference<T>(key, defaultValue)` is generic but nothing forces the key string to be declared anywhere. FEATURE_REQUIREMENTS_SPEC §10.2 flags "typed preference API (no string keys scattered)" as a v1 acceptance criterion.

**App-quit safety.** Writes are fire-and-forget PUT. A crash between cache.set and PUT resolution means the server has a stale value. Not catastrophic (next writer wins), but not guaranteed persistent.

---

## 8. Multi-session / split view

**PaneContainer.** `client/src/pages/PaneContainer.tsx` (612 lines). URL param `:sessionId` = left pane (line 342). `paneState.rightSessionId` = right pane (line 349). Explicit "never paint same session on both sides" filter at line 354.

**Per-pane isolation:**
- Each `<Pane>` stamps `data-pane-session-id={sessionId}` on its root (line 256). This is the DOM marker `paneFocus.ts` uses for cross-pane ESC / Cmd+. guard.
- Each pane mounts its own `<ChatPage sessionIdOverride={sessionId} />` (line 273) → independent React hook instances for `useChat`, `useSessions`, `usePromptDetection`, etc. No shared state.
- Each pane owns its own `<TmuxMirror sessionId={sessionId} />` (line 263) conditioned on `sessionUi.mirrorVisible`.

**Layout persistence.** Pane state (right + divider + focus) persists in the `preferences.pane-state` row. Note: this persists ACROSS APP RESTARTS only if preference DB is intact. Per-pane drawer state (terminal / STATE.md height) per FEATURE_REQUIREMENTS_SPEC §7.1 was deferred beyond M7 MVP — drawers close on pane re-mount.

**Termination cascade.** `PaneContainer.tsx:394-421`. When server fires `session:deleted` or `session:updated` with status=stopped:
- If goneId === leftId: toast + navigate to right-promotes-to-left or /sessions.
- If goneId === effectiveRightId: toast + keep left.

**Dual-view button.** `<SplitViewButton>` in `components/chat/` — not audited. Per-pane header at `PaneContainer.tsx:68-128`.

**Known split-view bugs per FEATURE_REQUIREMENTS_SPEC and verified in code:**
- Candidate 19 (ESC cross-pane leak) — fixed via `paneFocus.ts` predicate.
- Candidate 36 (effort display leak in tmux mirror) — still open in code; send path proven clean in commit `05bb3c7`, display-layer bug suspected. Structurally eliminated in v1 per spec §13.

---

## 9. Tmux service + mirror

**tmux.service.ts** (199 lines). Thin `execFileSync('tmux', args, {encoding: 'utf-8', timeout: 5000})` wrapper at lines 10-26. Operations:
- `listSessions()` — for boot orphan-discovery.
- `createSession(name, cwd)` — `new-session -d -s <name> -c <cwd>`.
- `resolveFirstPaneId(sessionName)` — `list-panes -t <name> -F '#{pane_id}'` → `%NN`.
- `killSession(name)` — `kill-session -t <name>`.
- `sendKeys(name, keys)` — two calls: `send-keys -t <target> -l <text>` then `send-keys -t <target> Enter`. Target guard at lines 102-110: throws in dev on non-`%NN` / non-`retired:` targets (Phase S.1 Patch 3 foot-gun protection).
- `sendRawKey(name, key)` — single `send-keys -t <target> <key>` (for Escape/Tab/Enter).
- `capturePane(name, lines, {preserveAnsi})` — `capture-pane -t <name> -p -S -<lines> [-e]`. `-e` preserves ANSI for the mirror tee; default strips.
- `hasSession(name)` — for pane IDs uses `display-message -t <name> -p '#{pane_id}'` + equality check; for session names uses `has-session`.
- `resolvePaneCwd(target)` — `display-message -t <target> -p '#{pane_current_path}'`.
- `listAllPanes()` — `list-panes -a -F '#{pane_id}|#{pane_current_path}|#{session_name}|#{pane_current_command}'` for sentinel resolution.

**Polling cadence.** `status-poller.service.ts:18` `POLL_INTERVAL = 1_500ms`. Dropped from 5000ms → 1500ms in Issue 15.3 §6.4 Delta 1 to match client's active-poll window. Each tick:
1. Batch `capturePane` across every active pane (`agent-status.service.ts:593-599`).
2. `classifyStatusFromPane` + `applyActivityHints` + `hasPendingToolUseInTranscript` overrides.
3. Hook-yield gate (`HOOK_YIELD_MS = 60_000`) — skip reclassification for 60s after any hook.
4. Force-idle cooldown (`FORCE_IDLE_COOLDOWN_MS = 60_000`).
5. Stale-activity force-idle (`STALE_ACTIVITY_MS = 90_000`).
6. Second `capturePane` with `-e` for mirror tee (`status-poller.service.ts:262-277`), deduped on content change.
7. Compute typed `SessionState` and emit on subtype change even when coarse status didn't flip (line 549-560).

**TmuxMirror.** `client/src/components/chat/TmuxMirror.tsx` (125 lines). Subscribe to `pane-capture:<sessionId>`, render via `ansi_up` → HTML. Height: 200px fixed. Scroll-pin follow-bottom logic at lines 64-77. Filter `event.sessionId !== sessionId` at line 57 — defense against split-view cross-contamination.

**Why tmux is in the architecture.** Per phase-y-closeout.md §3: Commander shelled out to tmux because tmux handles the PTY + scrollback + pane navigation "for free"; node-pty + xterm.js would have been a larger upfront build. The cost of this choice: 5-rotation Phase Y arc chasing derivation lag that's structurally unavoidable when you don't own the PTY. V1 replaces this entirely per FEATURE_REQUIREMENTS_SPEC §13.2-13.3.

---

## 10. Cost telemetry + analytics

**Three tables, two sources of truth (known debt).**
1. **`token_usage`** (`db/schema.sql:43-58`). One row per JSONL-parsed assistant message. Fields: `session_id`, `project_id`, `message_id`, `model`, 4 token counts, `cost_usd`, `timestamp`. Written by `token-tracker.service.ts:36-80` `recordUsage()` from `watcher-bridge.ts:117` for every JSONL append.

2. **`cost_entries`** (`db/schema.sql:60-74`). Daily aggregate. Keyed `UNIQUE(date, session_id, model)`. Upserted in same transaction as `token_usage` via `ON CONFLICT DO UPDATE` accumulator at `token-tracker.service.ts:46-56`.

3. **`session_ticks`** (`db/connection.ts:213-241`). One row per Commander session (`PRIMARY KEY (session_id)`, upsert-latest-wins). Written by `session-tick.service.ts:112+` from the Claude Code statusline forwarder hitting `POST /api/session-tick`. Carries: context %, cost USD, durations, lines added/removed, token totals, model, worktree, cwd, 5h/7d rate-limit windows.

**Per FEATURE_REQUIREMENTS_SPEC §10.3:** `session_ticks.sum_cost_reported` (statusline's rollup) diverges from `cost_entries.cost_usd` (JSONL parse). Two sources of truth. V1 must unify.

**Per Candidate 26 (flagged in spec):** `session_ticks` has no UNIQUE constraint enforcement beyond the PK, and the INSERT at `session-tick.service.ts:112+` uses `INSERT OR IGNORE` which is a no-op on PK collision — but the PK is already the session_id so the writer relies on INSERT-or-REPLACE semantics implicitly. Net: retention + uniqueness needs a rebuild.

**5h budget visibility.** `session_ticks.five_hour_pct` and `seven_day_pct` feed `HeaderStatsWidget` via `system:rate-limits` aggregate event. Freshness window: `RATE_LIMIT_STALE_MS = 10 * 60_000` at `session-tick.service.ts:13`. Per-session tick dedup: `DEDUP_WINDOW_MS = 250ms` at line 19.

**Aggregate analytics.** Queryable via `/api/analytics` routes (not audited). External tools (`TOKEN_ANALYTICS_*.md` reports) read the DB directly per spec.

---

## 11. Named architectural patterns + conventions

**Single write surface (SSOT).** `sessionService.upsertSession(input)` at `session.service.ts:365-423`. Every other write to `sessions` funnels through this. Sparse update semantics: only provided keys get written; defaults live in one place. This is the fix for the "#175 class of bug where two INSERT sites diverged."

**Pattern-matching constraint (§24).** Stated formally at `agent-status.service.ts:4-57`. Key rules:
- Character-presence alone is not a safe match.
- Verbs must be `-ing` / `-ed` + Idle-allowlist.
- Spinner glyphs must be line-start-anchored (client-side mirror at `parseTerminalHint.ts`).
- Approval-prompt classifiers match on explicit tokens only.
- Stale-elapsed heuristics gated on completion-verb morphology.
- Structured signals (JSONL tool pairing) preferred over pane-text pattern matching.

**Manual-bridge invariant.** Enforced by absence — search of `server/src/services/session.service.ts` reveals zero auto-forwarding code. Teammate relationships are display-only. Verified at `session.service.ts:744-753` where `agent_relationships` records the edge but nothing dispatches text across it.

**Per-session isolation by construction:**
- Event channels scoped by sessionId at `ws/rooms.ts`.
- React hook instances per-pane.
- DOM `data-pane-session-id` attribute + `paneFocus.ts` predicate for global handlers.
- Runtime filter at `useSessionPaneActivity.ts:76-87` — defense-in-depth.

**§20.LL references in code.**
- `ContextBar.tsx:43` — "textContent (§20.LL-L10 discipline)."
- Several tests cite §20.LL-L10 (assertion is a user-visible DOM string, not internal computation).
- §23.3 / §23.7 (SSOT invariants) cited at `session.service.ts:249` (realpath canonicalization) and `retention.service.ts:12` (retention SSOT).

**Naming conventions.**
- Files: kebab-case.
- Exports: camelCase or PascalCase for components/types.
- TS strict, no `any`, uses generated shape types.
- `@commander/shared` is the single source of truth for cross-cutting types.
- Spanish UI text; English code.
- Fonts: `const M = 'Montserrat, sans-serif'` declared at top of every component, applied via `style={{ fontFamily: M }}`.

**Route organization.**
- `/api/sessions*` — session CRUD + send commands/keys.
- `/api/chat/*` — chat reads + rescan.
- `/api/projects/*` — project scan.
- `/api/preferences/:key` — k/v store.
- `/api/hook-event` — Claude Code hook ingress.
- `/api/session-tick` — statusline forwarder ingress.
- `/api/debug/codeman-diff` — Phase Y Rotation 1 temp debug.
- `/api/tunnel/*`, `/api/auth/*`, `/api/teammates/*`, `/api/analytics/*`, `/api/maintenance/*`, `/api/upload/*`, `/api/pre-compact/*`, `/api/city/*` — various.

---

## 12. Live bugs still in the running code

All items below cross-checked against FEATURE_REQUIREMENTS_SPEC and verified as present or fixed in current code.

**Candidate 36 — cross-session effort display leak.** Status: **OPEN** (structural ceiling). Send path clean (commit `05bb3c7`). Display-layer bug in TmuxMirror suspected but not isolated. `TmuxMirror.tsx:57` filters `event.sessionId !== sessionId` — so the bug is likely upstream of this filter (server-side emission routing? ws client subscription counting?). Deferred to v1 per spec §1.3.

**Candidate 26 — session_ticks retention + UNIQUE constraint missing.** Status: **OPEN**. Schema at `db/connection.ts:213-241` has no constraints beyond PK; `INSERT OR IGNORE` at `session-tick.service.ts` is effectively a no-op because PK is `session_id` (single row per session). No age-out retention. FEATURE_REQUIREMENTS_SPEC §10.1 flags for v1 rebuild.

**Candidate 32 / 33 — pane-regex classifier lag.** Status: **OPEN** (worked around by Finalizer Track 1's `useSessionPaneActivity`). Root cause: pane text is sampled at 1.5s, classification runs post-capture, many frames of truth missed. `agent-status.service.ts:378-487` is 100+ lines of pattern matching that cannot keep up with real-time. Structurally eliminated in v1 per spec §13.1.

**Candidate 37 — `can't find pane: %NNN` stderr spam.** Status: **OPEN** (low-priority). Stale `tmux_session` rows in DB cause repeated failed `capturePane` calls. The tmux.service.ts error-wrapping at `tmux.service.ts:16-25` returns empty string on "session not found" but the 2x post-Phase-T rate was noted. Structurally eliminated in v1 per spec §13.3.

**Candidate 38 / 41 — pendingLocal retention past turn-end.** Status: **OPEN**. Client-side optimistic-message retention doesn't clear on some turn-end paths. Hinted at in `utils/pendingLocalFilter.ts:3`. Refresh clears. Deferred.

**Candidate 42 — liveThinking bleed-through.** Status: **FIXED** in Rotation 1.7.C per phase-y-closeout.md §7. Verified at `utils/liveActivity.ts:5` comment preserving the fix rationale.

**Candidate 44 — attachment drop preventDefault contract.** Status: **FIXED**. `useAttachments.ts:190` + test at `candidate-44-drop-preventdefault.test.ts`.

**Candidate 45 — detectExistingCommander preflight-miss.** Status: **FLAGGED for v1**. N1 Attempt 1 saw IPv4/IPv6 resolver race during instance-lock-hit. Not a runtime bug in current code — it's a startup-collision failure mode.

**Candidate 19 — ESC cross-pane interrupt leak.** Status: **FIXED** via `paneFocus.ts`.

**Candidate 27 — synthetic-id reconciliation on orphan adoption.** Status: **FIXED** at `server/src/index.ts:275-303` (a6ca156). Adoption path captures `paneCwd` and writes to `project_path` so hook events can bind.

**Candidate 20 / 21 / 22 — waiting prompt tabular false-fires + Plan detection.** Status: **FIXED**. Issue 9 Part 2 narrowed WAITING_INDICATORS; Candidate 22 removed markdown-shape Plan detection.

**Candidate 29 / 30 / 35 / 40 — renderer registry gaps (task_reminder, api_error, markdown parity).** Status: **OPEN**. Deferred to native rebuild.

**Phase Y architectural ceiling.** Status: **ACKNOWLEDGED, not fixable in web.** Per phase-y-closeout.md §3: transcript-authoritative derivation cannot surface mid-turn state when JSONL writes at turn-end. Fix is architectural (node-pty direct).

---

## 13. Candidates 1-45 catalog

Exhaustive code-search (§1-§5 scope): `Candidate N` references (in comments / tests) found for:

| # | Status | File:line evidence | Notes |
|---|--------|--------------------|-------|
| 19 | Fixed | `utils/paneFocus.ts:1`, `__tests__/paneFocus.test.ts:25` | ESC cross-pane leak guard |
| 20 | Fixed | `session-state.service.ts:199`, `__tests__/session-state.test.ts:151` | Idle:MonitoringSubagents subtype |
| 21 | Fixed | `types/session-state.ts:50`, `__tests__/session-state.test.ts:49` | Explicit approval-token detection |
| 22 | Fixed | `__tests__/text-renderer-candidate-22.test.ts:10,38` | Markdown-shape Plan removed |
| 26 | Open | Flagged in spec §10.1 | session_ticks retention |
| 27 | Fixed | `index.ts:296`, `__tests__/candidate-27-synthetic-id-reconciliation.test.ts` | Orphan-adoption cwd capture |
| 29 | Open | Flagged in spec §3.1, §5.4 | task_reminder renderer |
| 30 | Open | Flagged in spec §5.3 | Markdown parity |
| 32 | Open | Flagged in spec §1.7 | Pane-regex lag |
| 33 | Open | Flagged in spec §1.7 | Pane-regex lag |
| 35 | Open | Flagged in spec §5.4 | Renderer rewrite bundle |
| 36 | Open | `__tests__/useSessionPaneActivity.test.ts:250` | Effort display leak |
| 37 | Open | Flagged in spec §2.1 | Stale pane stderr |
| 38 | Open | `utils/pendingLocalFilter.ts:3`, `__tests__/candidate-38-send-error.test.ts:4` | pendingLocal |
| 39 | Fixed | `ChatThread.tsx:433`, `__tests__/candidate-39-scroll-anchor.test.ts:4` | User-send scroll anchor |
| 40 | Open | Flagged in spec §5.4 | api_error renderer |
| 41 | Open | `utils/pendingLocalFilter.ts:3` | Merged with C38 |
| 42 | Fixed | `utils/liveActivity.ts:5`, `__tests__/phase-y-rotation-1-7-closeout.test.ts:76` | liveThinking bleed |
| 44 | Fixed | `hooks/useAttachments.ts:190`, `__tests__/candidate-44-drop-preventdefault.test.ts:4` | Drop preventDefault |
| 45 | Flagged | preflight-miss, spec §1.8 | N1 startup collision |

Unreferenced in code for numbers 1–18, 23–25, 28, 31, 34, 43 — either predate the numbering system (Phase H and earlier) or were catalogued in docs that aren't part of this repo's code search path.

---

## 14. What JS WorkStation MUST preserve from web Commander

**Non-negotiables — "if JS WorkStation breaks these, Jose can't use it":**

1. **Item 3 approval-modal path byte-identical.** `resolveEffectiveStatus` must preserve `sessionStatus === 'waiting'` as top-of-chain. `usePromptDetection` must always poll (no `isActive` gate). `PermissionPrompt` dispatches Allow/Deny/Custom/Escape via `/command` or `/key`. Test asserts at `phase-y-rotation-1-5-hotfix.test.ts:54-64`.

2. **Three session types (pm/coder/raw) with bootstrap injection.** PM auto-injects `~/.claude/prompts/pm-session-bootstrap.md` at `/effort high`. Coder injects `coder-session-bootstrap.md` at `/effort medium`. Raw is plain at `/effort medium`. `SESSION_TYPE_EFFORT_DEFAULTS` is SSOT. Bootstrap file missing → warn but session continues.

3. **Effort override at spawn + mid-session.** CreateSessionModal + ContextBar dropdown + SessionCard click-to-adjust. Full ladder (low/medium/high/xhigh/max) exposed. Per-session (not global). Dispatches `/effort <level>` then `PATCH /sessions/:id`.

4. **Per-session event + state isolation.** Channels scoped by sessionId, hook instances per-pane, DOM `data-pane-session-id` marker, structural tests that enforce this (not just integration).

5. **Teammate count label semantics.** "Monitoring N teammates" vs. "Waiting for input" distinction. Teal dot on PM waiting/idle when children are working. Zero auto-forwarding.

6. **ContextBar token/cost/context% display with color bands.** Brain icon for context % (EC4899 pink). Band thresholds from `contextBands.ts`. Click-to-expand per-model breakdown.

7. **Manual refresh button.** Present in ContextBar as an explicit escape hatch. 1s checkmark confirmation on success.

8. **Split-view with pane isolation.** Right pane + divider + focus persisted. Pane close "right promotes to left." Termination cascade navigates/toasts.

9. **Cmd+J terminal drawer, Cmd+Shift+S STATE.md drawer, Escape + Cmd+. Stop.** Keyboard shortcuts preserved.

10. **ESC handler scoped to focused pane.** Per `paneFocus.ts:25-38`.

11. **Manual-bridge invariant.** Nothing crosses between PM and Coder automatically.

12. **STATE.md live view per session.** FSEvents-driven update; drawer per pane.

13. **Session-type icons + colors in sidebar card.** PM=teal-accent, Coder=amber, Raw=neutral. `SESSION_TYPE_OPTIONS` at `CreateSessionModal.tsx:122-155`.

14. **Tool chip incremental rendering.** Every Claude Code tool (Read/Edit/Write/Bash/Agent/Task/Grep/Glob/Skill/SendMessage) must have a chip with tool name + params + status.

15. **Compact boundary + compact_summary + post-compact file_ref rendering.** Visual separator, summary collapsible, historical references muted.

16. **Scroll anchor discipline.** User-send always scrolls to bottom (C39). Assistant streaming respects scroll position.

17. **PM/Coder bootstrap hot-reload via new session spawn** (current workflow). V1 can add in-place reload but must not remove re-spawn path.

---

## 15. What JS WorkStation SHOULD improve from web Commander

**Highest-impact improvements:**

1. **Spawn latency 1.5-3s → <1s.** Root cause: tmux shell-out + 500ms shell-init sleep + 400ms polling in `waitForClaudeReady`. Native node-pty attach eliminates tmux step and replaces polling with byte-stream event. Per spec §1.1.

2. **Real-time status accuracy.** Phase Y ceiling (pure-text turns show idle in ContextBar) is architectural. OSC 133 + node-pty data events + pty exit give typed ground truth. Per spec §2.3.

3. **ContextBar status latency 1.5s (poll) → <50ms (event-driven).** Replace `status-poller.service.ts` entirely.

4. **Terminal pane live.** Currently Phase T mirror samples at 1.5s with ANSI re-render. Real xterm.js attached to pty → full fidelity scrollback, select-copy, search, resize, spinners, progress bars.

5. **Renderer registry exhaustive.** Candidate 29/30/35/40 — task_reminder, api_error, markdown parity, skill_listing details, invoked_skills path. Single phase of renderer rewrite.

6. **Unified cost source of truth.** Replace `session_ticks.sum_cost_reported` vs `cost_entries.cost_usd` divergence with single Drizzle schema.

7. **Typed preference API.** Replace string keys with compile-time-typed preference declarations.

8. **Multi-file STATE.md drawer.** M7 full scope (CLAUDE.md, PROJECT_DOCUMENTATION.md, STATE.md, DECISIONS.md tabbed) was deferred; clean rewrite can ship it.

9. **Workspace layout persistence.** Currently pane layout lost on app quit; only sessions + right-pane-id + divider persist. Full state (sizes, drawer states, drawer heights per pane) should round-trip.

10. **Attachment submit end-to-end.** C44 client fix shipped; C44 residual server-side relay via tmux layer still broken. Native pty send can bypass tmux's attachment quirks.

11. **Three-role UI.** CTO brief → PM dispatch → CODER report routing graph. Currently three separate browser tabs; v1 unifies in one window per spec §12.

12. **Session graph persistence.** Parent/teammate relationships currently display-only; v1 could surface the full "which CTO decision → which PM dispatch → which CODER ship" graph.

13. **Projects surface.** M7 deferred scope — dedicated project view with stack badges, phase indicators, recent activity.

14. **In-app analytics.** TOKEN_ANALYTICS is external tooling; v1 can embed.

15. **First-run Gatekeeper UX.** Signed binary vs. unsigned + "right-click → Open" per spec §15.Q8.

---

## 16. What JS WorkStation SHOULD SCRAP from web Commander

**Things that exist ONLY because of web-architecture constraints:**

1. **`tmux.service.ts` entirely.** 199 lines of shell-out. Not needed with node-pty direct.

2. **`status-poller.service.ts` polling loop.** 609 lines. 1.5s `setInterval`, pane capture, pattern classification, hook-yield gates, force-idle cooldowns, oscillation telemetry — all speculative inference that OSC 133 makes explicit.

3. **`agent-status.service.ts` classifier (600 lines).** `classifyStatusFromPane`, `detectActivity`, `applyActivityHints`, ACTIVE_INDICATORS, IDLE_INDICATORS, WAITING_INDICATORS, SPINNER_GLYPHS, COMPLETION_VERBS, STATUSLINE_CHROME_MARKERS, STALE_ELAPSED_SECONDS — the entire pattern-matching apparatus is obsolete once you own the pty.

4. **`TmuxMirror.tsx` + `useSessionPaneActivity.ts` + `session:pane-capture` WS event.** Replaced by xterm.js attached to pty.

5. **`useToolExecutionState.ts` + `useCodemanDiffLogger.ts` + codeman parallel-run logger.** Phase Y Rotation 1 artifacts. Spec §13.1 explicitly deletes these.

6. **`resolveEffectiveStatus` predicate chain + Phase Y legacy guards.** `typedIdleFreshKillSwitch`, `lastTurnEndTs`, `isSessionWorking` OR-chain, Fix 1/2, Option 2/4, Activity-gap, heartbeat-stale gate — all derivation stacked on derivation. OSC 133 makes this unnecessary.

7. **`debug.routes.ts` + `~/.jstudio-commander/codeman-diff.jsonl`.** Temporary parallel-run persistence. Spec §13.1.

8. **Orphan-tmux-adoption path** (`server/src/index.ts:268-326`). 60 lines of "restart while tmux-alive → synthetic-id → reconcile on first hook." If we own the pty, there's no orphan tmux to adopt; pty exits with commander.

9. **`sessions.tmux_session` column.** Replace with pty handle / Rust process id.

10. **`sessions.status` as pane-regex-derived string.** Replace with typed SessionState from OSC 133 + tool events + pty exit.

11. **Synthetic-id shape (`...-0000-0000-0000-000000000000`).** Artifact of orphan adoption. Native spawn is always own the pty from t=0.

12. **`resolveSessionCwd` realpath canonicalization** (mostly). Less critical when JSONL-bind watcher goes away with node-pty direct; cwd still resolved at spawn but doesn't need to match JSONL encoding (since we don't watch JSONL for state).

13. **`jsonlDiscoveryService.encodeProjectPath`.** Encoding scheme only matters because Claude Code writes JSONL to `~/.claude/projects/<encoded>/`. Stays if JSONL is still the source of chat content; goes away if we capture from pty directly.

14. **`file_watch_state` table + byte-offset incremental tracking.** If JSONL watching stays it stays; if pty capture replaces it, drops.

15. **`health-beacon` 5s broadcast.** Artifact of long-uptime WS restart detection. Native app is single-process with typed IPC.

16. **CORS + PIN auth middleware + tunnel integration.** Artifact of browser + remote-access model. Native app has no CORS, no PIN, no tunnel.

17. **`@fastify/multipart` for uploads.** Artifact of browser file upload. Native app has drag-and-drop to native file handles.

18. **`detectExistingCommander` preflight** (`server/src/index.ts:50-53`). Single-instance enforcement via signed health endpoint check. Native apps use macOS NSWorkspace / LSApplicationIsActive.

19. **`instance-lock.ts` SQLite locking.** Artifact of multiple-process-one-db concern. Native app owns its data.

20. **Vite dev server + `/` → VITE_URL redirect.** Artifact of dev-mode browser. Native app is one bundle.

---

## 17. Surprises / anti-patterns / cautionary tales

**Anti-patterns (document so future JS WorkStation devs know why these happened):**

1. **14 `ALTER TABLE` migrations accreted in `connection.ts:32-194`.** One migration per feature rotation. Idempotency via `PRAGMA table_info` predicate each time. No version tracking. **Takeaway: v1 should use Drizzle migrations with explicit version table from day one.**

2. **`sessions.status` string + server-side pane-regex derivation + client-side `resolveEffectiveStatus` override.** Status flows through three layers (pane → server → client), each with its own derivation logic, with predicate chains like `codemanState?.isWorking ?? legacyIsWorking` layered on top. This is what the Phase Y arc was fighting. **Takeaway: v1 drives status from ground-truth (OSC 133 + tool events), passes through typed, never re-derives.**

3. **Pattern-matching constraint §24 was retrofitted after the `⏺` reply-bullet class of bug (Issue 8 P0).** The cautionary comment at `agent-status.service.ts:4-57` is the documentation of "never do string-only matching again." **Takeaway: v1 spec explicitly forbids pattern matching where structured signals are available (OS §20.LL-L14 ground-truth invariant).**

4. **`ContextBar.tsx` is 861 lines and composes 7+ derivation helpers** (`resolveEffectiveStatus`, `resolveActionLabel`, `resolveActionLabelForParallelRun`, `getActionInfo`, `isActivityStale`, `resolveContextPercent`, `useSessionPaneActivity`, `useCodemanDiffLogger`). Each was the right call at the time; together they form a derivation cascade that's hard to reason about. **Takeaway: v1 ContextBar should be a pure renderer over a typed SessionState; zero derivation in the component.**

5. **Fix-stacking:** `applyActivityHints` has 15.1-D's allowlist (`FALLTHROUGH_EVIDENCE`), commenting on M1's earlier denylist form that caused the 15.1-D P0 regression (`agent-status.service.ts:523-540`). Status poller has Fix 1 cooldown + Fix 2 chrome-exclusion + Fix 3 oscillation telemetry (Phase U.1). Each fix is a scar tissue layer. **Takeaway: When v1 ships, measure the primary signal quality — don't accrete guards.**

6. **WS `pane-capture` channel is both data source AND ground-truth signal.** TmuxMirror renders it; `useSessionPaneActivity` uses it as the proof-of-life heartbeat for the Stop button and ContextBar status. This is clever (saves a separate channel) but overloads one signal's purpose. **Takeaway: v1 should separate "render this for the user" from "derive this for state" — different events, different consumers.**

7. **`sessions.tmux_session` column went through three shapes:** session name (`jsc-uuid`), then pane id (`%NN`), then sentinels (`agent:id`, `retired:id`). `healLegacySessionNameTmuxTargets` at `session.service.ts:1076-1118` is the boot-time migrator. **Takeaway: v1's equivalent column should be strictly typed (union) from day one, not a stringly-typed foot-gun.**

8. **`better-sqlite3` + `INSERT OR IGNORE` + upsert semantics vary by table.** `session_ticks` uses implicit REPLACE via PK; `cost_entries` uses explicit `ON CONFLICT ... DO UPDATE`; `token_usage` uses `INSERT OR IGNORE`. No unified pattern. **Takeaway: v1 schema + Drizzle should standardize upsert vs. insert-only.**

9. **`status-poller.service.ts:183-563` is 380 lines of nested `if/else` branches.** Stale-activity force-idle, cooldown, hook-yield, pending-tool override, grace period — each a separate decision. `recordFlip`, `trackOscillation`, `workingSince`, `idleSince`, `lastKnownStatus`, `lastKnownStateKey`, `lastKnownActivity`, `lastEmittedByCapture` are 8 module-level Maps. **Takeaway: State machine abstraction absent. v1 should use a typed state machine library (xstate?) or hand-roll a pure transition function.**

10. **Candidate 36 display leak isolated to `TmuxMirror` + `useSessionPaneActivity` despite multiple diagnostic rotations.** The DOM filter is correct, the WS event scoping is correct, and yet split-view shows cross-pane effort commands. **Takeaway: The remaining leak is almost certainly in the subscription reference-counting of the shared `useWebSocket` context. Per spec §13, v1 eliminates structurally — don't try to fix here, rebuild.**

11. **`detectActivity` regex in `agent-status.service.ts:80-82`:**
    ```
    `([${SPINNER_GLYPHS}])\\s+([A-Z][a-z]+)(?:…|\\.\\.\\.)?(?:\\s*\\(([^)]*)\\))?`
    ```
    Parses `"✽ Ruminating… (1m 49s · ↓ 430 tokens · thinking with xhigh effort)"`. The whole regex mechanism exists because tmux has already rendered Claude's footer to a string — we can't ask Claude "what are you doing" directly. **Takeaway: Structural reminder that Commander is the audience of a render, not a participant in the session.**

12. **`session:heartbeat` event is separate from `session:tick` is separate from `session:status`.** Three proof-of-life signals, three event types, three consumers. Heartbeat: last_activity_at bump only. Tick: full statusline payload. Status: classifier flip. **Takeaway: v1 could collapse these into a single typed signal stream.**

13. **`session.service.ts` is 1440 lines and exports one object literal** (`sessionService = { … }`). Methods include createSession, upsertSession, upsertTeammateSession, adoptPmIntoTeam, findAdoptablePmAtCwd, detectCrossSessionPaneOwner, healCrossSessionTeammates, resolveSentinelTargets, healOrphanedTeamSessions, healLegacySessionNameTmuxTargets, markTeammateDismissed, listTeammates, listSessions, getSession, deleteSession, purgeTeamSession, sendCommand, updateSession, getSessionStatus, rescan, cleanupStaleTeammates, bumpLastActivity, bumpLastHookAt, appendTranscriptPath. **Takeaway: Split into SessionCrud + SessionHealing + TeammateLifecycle + TmuxMediator in v1.**

14. **`server/src/index.ts:222-346` has 124 lines of boot-recovery logic** (stale-status flip, tmux-gone detection, orphan discovery, case-collision adoption, teammate sweep, retention purge). This is because Commander can crash / restart while tmux sessions are alive. **Takeaway: v1's node-pty ownership means pty exits WITH Commander — recovery logic is largely moot, but the retention policy stays.**

15. **`session_ticks.raw_json` text column** (`db/connection.ts:238`) is the forward-compat escape hatch for statusline schema drift. **Takeaway: keep this pattern in v1 for any external-source ingestion; typed columns + raw_json for unknown fields is a good posture.**

16. **`usePreference` same-tab pub-sub hotfix (`usePreference.ts:25-56`) was not the bug it appeared to be.** React hooks sharing a key in the same tab have independent useState instances; the cache dedup was correct for request-dedup but left local state divergent. The fix is a second coordination layer. **Takeaway: v1's preference API should be a store (subscribe-semantics) from day one, not a hook wrapper around fetch+cache.**

17. **`tmux.service.ts:102-110` sendKeys target guard throws in dev.** This is a foot-gun defense — non-`%NN` targets historically misrouted. Dev-mode assertion surfaces the regression at test time. **Takeaway: v1 should keep this discipline — dev-mode assertions for routing contracts.**

18. **`HOOK_YIELD_MS = 60_000` at `status-poller.service.ts:80`.** The rationale is "hook cascade is authoritative, skip pane-regex reclassification for 60s." But if the hook itself lied (wrong owner), the poller can't correct for 60s. **Takeaway: Single-source-of-truth signals can lie — v1 still needs reconciliation, just less frequently.**

19. **`packages/shared/src/types/ws-events.ts` has 28 typed variants including deprecated `terminal:data` / `terminal:resize`** that were stripped when Phase P.3 H4 deleted the half-built PTY preview. **Takeaway: When v1 ships, there will be similar "here's the leftover of a deleted feature" schema debris. Plan for it.**

20. **The `[1m]` model suffix (`claude-opus-4-7[1m]`) gets single-quoted in shell args** at `session.service.ts:489-490` because bash/zsh glob-expand `[1m]` otherwise. Native spawn via `execFile` or typed IPC eliminates this concern. **Takeaway: v1's Claude CLI invocation should use structured args, not shell strings.**

---

## Appendix — Quick-reference file index

**Server core:**
- `server/src/index.ts` — boot sequence (374 lines).
- `server/src/services/session.service.ts` — session lifecycle (1440 lines).
- `server/src/services/tmux.service.ts` — tmux shell-out (199 lines).
- `server/src/services/status-poller.service.ts` — 1.5s poll loop (609 lines).
- `server/src/services/agent-status.service.ts` — pane classifier (600 lines).
- `server/src/services/jsonl-parser.service.ts` — transcript parse (701 lines).
- `server/src/services/session-state.service.ts` — typed SessionState (256 lines).
- `server/src/services/watcher-bridge.ts` — chokidar → event-bus (197 lines).
- `server/src/services/session-tick.service.ts` — statusline ingress (308 lines).
- `server/src/services/token-tracker.service.ts` — cost aggregation (193 lines).
- `server/src/services/prompt-detector.service.ts` — approval prompts (153 lines).
- `server/src/routes/hook-event.routes.ts` — resolveOwner cascade (498 lines).
- `server/src/routes/session.routes.ts` — session CRUD + send (293 lines).
- `server/src/ws/event-bus.ts` — typed EventEmitter (134 lines).
- `server/src/ws/index.ts` — event→channel wiring (181 lines).
- `server/src/ws/rooms.ts` — subscription manager (91 lines).
- `server/src/db/schema.sql` + `server/src/db/connection.ts` — SQLite schema + 14 migrations.

**Client core:**
- `client/src/components/chat/ContextBar.tsx` — status bar (861 lines).
- `client/src/components/chat/ChatThread.tsx` — transcript render (796 lines).
- `client/src/components/chat/TmuxMirror.tsx` — ANSI mirror (125 lines).
- `client/src/components/chat/PermissionPrompt.tsx` — approval modal (192 lines).
- `client/src/components/chat/ProjectStateDrawer.tsx` — STATE.md pane (140 lines).
- `client/src/components/sessions/CreateSessionModal.tsx` — spawn UI (574 lines).
- `client/src/components/sessions/SessionCard.tsx` — sidebar card (601 lines).
- `client/src/pages/PaneContainer.tsx` — split view (612 lines).
- `client/src/pages/ChatPage.tsx` — per-session chat surface (1048 lines).
- `client/src/hooks/useChat.ts` — chat hydrate + poll (548 lines).
- `client/src/hooks/usePromptDetection.ts` — approval poll (146 lines).
- `client/src/hooks/usePreference.ts` — k/v preference (156 lines).
- `client/src/hooks/useSessionPaneActivity.ts` — pane delta signal (119 lines).
- `client/src/utils/contextBarAction.ts` — status + label derivation (282 lines).
- `client/src/utils/paneFocus.ts` — cross-pane guard (38 lines).

**Shared:**
- `packages/shared/src/types/session.ts` — Session, SessionStatus, SessionType, EffortLevel (115 lines).
- `packages/shared/src/types/session-state.ts` — typed SessionState (94 lines).
- `packages/shared/src/types/chat.ts` — ChatMessage, ContentBlock union (105 lines).
- `packages/shared/src/types/ws-events.ts` — WSEvent union (92 lines).
- `packages/shared/src/types/pane-state.ts` — PaneState, SessionUi (65 lines).
- `packages/shared/src/constants/event-policy.ts` — JSONL drop policy (not audited).
- `packages/shared/src/constants/models.ts` — MODEL_PRICING, contextLimits (not audited).

**End of audit.**
