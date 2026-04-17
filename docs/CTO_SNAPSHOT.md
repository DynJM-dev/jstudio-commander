# CTO Snapshot — JStudio Commander

**Generated:** 2026-04-17 · **HEAD:** `557cbd2` · **Author:** coder-16 (PM pov)
**Scope:** reconnaissance only — no fixes, no code changes.

---

## Section 1 — Repo map

```
jstudio-commander/
├── CLAUDE.md, CODER_BRAIN.md, COMMANDER_IDE_RESEARCH.md, STATE.md, README.md
├── package.json            (pnpm workspace root, Node-type=module)
├── pnpm-workspace.yaml
├── turbo.json
├── client/                 React 19 + Vite 7 app (UI)
│   ├── e2e/                Playwright specs (few — scaffolded but thin)
│   ├── public/             static assets
│   ├── scripts/            preflight.mjs (kills stale Vite ports)
│   ├── src/
│   │   ├── components/     analytics · chat · city · projects · sessions · shared · terminal
│   │   ├── hooks/          useChat, useSessions, useWebSocket, useSessionTick, usePromptDetection, …
│   │   ├── layouts/        TopCommandBar (session tabs live here)
│   │   ├── pages/          ChatPage, SplitChatLayout, SessionsPage, TerminalPage, AnalyticsPage, CityPage, ProjectsPage
│   │   ├── services/       api.ts (fetch wrapper), ws.ts, projectsCache, serverHealth
│   │   └── utils/          chatMessageParser, contextBands, plans, sessionDisplay, teammateColors, …
│   └── package.json
├── docs/                   CTO_STATE, this snapshot
├── hooks/
│   └── commander-hook.sh   Claude Code hook receiver (PostToolUse / Stop — installed)
├── packages/
│   ├── shared/             shared TS types + constants (@commander/shared)
│   └── statusline/         statusline.mjs zero-dep forwarder (Phase M)
├── scripts/
│   ├── install-statusline.mjs / uninstall-statusline.mjs   ~/.claude/settings.json patcher
│   └── macos-launcher/     .app bundle builder
└── server/                 Fastify 5 + SQLite API (@commander/server)
    └── src/
        ├── db/             connection.ts (migrations here), schema.sql, instance-lock.ts
        ├── middleware/     pin-auth, security-headers
        ├── routes/         14 Fastify route modules (session, chat, hook-event, session-tick, terminal, …)
        ├── services/       19 services (tmux, session, status-poller, agent-status, file-watcher, jsonl-*, token-tracker, tunnel, …)
        └── ws/             event-bus, handler, rooms, index
```

**One-sentence take per top-level:**
- **client/** — React UI, Vite dev on :11573, talks to server over REST + WebSocket.
- **server/** — Fastify API on :11002, owns SQLite, spawns tmux, watches JSONL transcripts.
- **packages/shared/** — cross-compiled TypeScript types + ws-event union shared by client/server.
- **packages/statusline/** — tiny Node CLI Claude Code invokes on every 300ms statusline tick; POSTs to `/api/session-tick`.
- **hooks/** — shell script Claude Code invokes on PostToolUse/Stop; POSTs to `/api/hook-event`.
- **scripts/** — install/uninstall helpers for the statusline + macOS `.app` bundler.
- **docs/** — CTO_STATE snapshot files (not auto-generated).

---

## Section 2 — Tech stack as actually installed

**Runtime:** No `engines` field, no `.nvmrc`. `@types/node ^22.14.1` implies Node 22+ target; `pnpm.onlyBuiltDependencies` includes `better-sqlite3`, `esbuild`, `node-pty` (installed but unused — see §6).

**Server (`server/package.json`):**
- `fastify ^5.2.2`
- `@fastify/cors ^11.0.0`, `@fastify/websocket ^11.0.0`, `@fastify/static ^8.1.0`
- `better-sqlite3 ^11.9.1`
- `chokidar ^4.0.3`
- `node-pty ^1.1.0` — **declared but NOT imported anywhere.** Terminal service uses `child_process.spawn('tmux attach …')` instead.
- `uuid ^11.1.0`
- dev: `tsx ^4.19.4` (dev server + tests), `typescript ^5.8.3`

**Client (`client/package.json`):**
- `react ^19.1.0`, `react-dom ^19.1.0`, `react-router-dom ^7.5.0`
- `vite ^6.3.2` + `@vitejs/plugin-react ^4.4.1`
- `tailwindcss ^4.1.4` + `@tailwindcss/vite ^4.1.4`
- `framer-motion ^12.7.3`
- `lucide-react ^0.477.0`
- `@xterm/xterm ^6.0.0`, `@xterm/addon-fit`, `@xterm/addon-webgl` — **declared**; actual pane rendering is a polling capture (ANSI text in a `<pre>`), see §6.
- `recharts ^3.8.1` (analytics lazy)
- `react-markdown`, `remark-gfm`, `shiki` (chat rendering)
- `qrcode.react` (tunnel QR)
- dev: `@playwright/test ^1.59.1`

**Terminal-related deps:** `@xterm/*` + `node-pty` installed; **neither currently runs**. Terminal is tmux `capture-pane` polling via `child_process.spawn`.

**Layout deps:** No `react-resizable-panels`. Split-pane is hand-rolled in `SplitChatLayout.tsx` — `mousedown/mousemove/mouseup` listeners clamping 30-70 % into a preference write.

**State management:** Context + hooks only. `useWebSocket` exposes a React context, `usePreference` reads/writes `/api/preferences`. No Redux, no Zustand.

**Root (`package.json`):** `type: module`, pnpm workspaces across `client`, `server`, `packages/*`. Build order: `shared → client → server`. Dev runs client + server in parallel.

---

## Section 3 — Session model

### Create path
- UI: `CreateSessionModal.tsx` posts to `POST /api/sessions` (`session.routes.ts:47`) with `{ name?, projectPath?, model?, sessionType? }`.
- Handler calls `sessionService.createSession(opts)` (`session.service.ts:240`).
  1. Generates UUID + `jsc-<short>` tmux session name.
  2. `tmuxService.createSession(tmuxName, projectPath)` runs `tmux new-session -d …`.
  3. `setTimeout(500ms, …)` then `tmux send-keys "claude --model '<model>'"`.
  4. `db.transaction(() => upsertSession + INSERT session_events)` commits the row with `status='working'`.
  5. Async post-boot: `waitForClaudeReady()` polls tmux for the Claude ready-glyph, then `send-keys('/effort xhigh')`, then (for `sessionType='pm'`) sends a bootstrap prompt from `~/.claude/prompts/pm-session-bootstrap.md`.
  6. On DB txn failure, the orphan tmux session is killed.

### Storage
- **SQLite** via `better-sqlite3`, WAL mode, path from `config.dbPath`.
- `sessions` table columns (schema + migrations): `id, name, tmux_session (UNIQUE), project_path, claude_session_id, status, model, created_at, updated_at, stopped_at, station_id, agent_role, transcript_path (legacy), effort_level, parent_session_id, team_name, session_type ('pm'|'raw'), transcript_paths (JSON array)`.
- Migrations are inline in `server/src/db/connection.ts` — additive `ALTER TABLE IF NOT EXISTS`, run at boot.

### "Active" signals (every signal currently used)
1. **Status poller** (`status-poller.service.ts`) — 5 s `setInterval`, runs `tmux capture-pane -p -t <name>` for every non-stopped session, passes tail to `agentStatusService.classifyStatusFromPane()`, writes back to `sessions.status`.
2. **Agent-status detector** (`agent-status.service.ts`) — regex cascade over pane tail: spinner glyphs, verb allowlist (`IDLE_VERBS`), past-tense allowlist (`COMPLETION_VERBS` + `/ed$/`), stale-elapsed gate (>600 s), numbered-choice prompt, `❯` idle prompt, error patterns. Returns `{ status, evidence, activity }`.
3. **Hook events** (`POST /api/hook-event` ← `commander-hook.sh`) — `PostToolUse` + `Stop` append the Claude transcript path to `sessions.transcript_paths` via `resolveOwner`'s 5-strategy cascade.
4. **Statusline ticks** (`POST /api/session-tick` ← `packages/statusline/statusline.mjs`) — ~300 ms cadence, carries context %, tokens, cost, rate limits. Stored in `session_ticks`; dedup 250 ms.
5. **Chokidar file watcher** (`file-watcher.service.ts` + `watcher-bridge.ts`) — fs-level tail of each transcript JSONL; emits `chat:messages` on append.
6. **Team config watcher** (`team-config.service.ts`) — reconciles Codeman `team.json` files into teammate rows; emits `teammate:spawned` / `teammate:dismissed`.
7. **Tmux presence check** (`tmuxService.hasSession`) — boot-time sweep marks rows whose tmux is gone as `stopped`; pane-target safety net in the poller un-stops rows whose `tmux_session` starts with `%` if tmux still reports them alive.

### Update push
- **WebSocket** (`server/src/ws/`) — `@fastify/websocket`, one connection per client, channel subscribe (`sessions`, `terminal`, `analytics`, …). Union type `WSEvent` in `packages/shared/src/types/ws-events.ts`:
  - `session:created|updated|deleted|status|tick`, `chat:message|messages`, `project:updated|scanned`, `terminal:data|resize`, `analytics:token|daily`, `tunnel:*`, `system:error|heartbeat|health`, `preference:changed`, `teammate:spawned|dismissed`.
- **No SSE.** **No long-polling.** Client also re-fetches via REST on WS event as a safety net (e.g. `refreshTeammates`).

### Session state enum
`packages/shared/src/types/session.ts:1`:
```ts
export type SessionStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';
```
Effort is a parallel enum: `'high' | 'xhigh' | 'max'` (legacy `'low' | 'medium'` healed to `'xhigh'` at boot). Display-side projection lives in `client/src/utils/sessionDisplay.ts`:
```ts
export type DisplayStatus = 'working' | 'waiting' | 'teammate-active' | 'idle' | 'stopped' | 'error';
```
`'teammate-active'` is a PM-specific synthetic — raw `idle` + any teammate working.

---

## Section 4 — The "stuck state" bug specifically

Grep across `.ts`/`.tsx` under `client/src` + `server/src` for the literals `"thinking" | "composing" | "working" | "idle" | "waiting"` (tests excluded).

### Server

| File:line | Literal | Purpose |
|---|---|---|
| `services/status-poller.service.ts:88` | `'idle'` | Pane-safety-net override when a `%` pane-id row was mis-classified `stopped`. Set by poller every 5 s. **Reset path: poller itself on next cycle.** |
| `services/status-poller.service.ts:98, 124, 160` | `'working'` / `'idle'` | Grace-period state machine: `working → idle` gated by 8 s `IDLE_GRACE_MS`; `working → waiting` bypasses grace. **Reset: each poll cycle, with `workingSince` map cleared on exit.** |
| `services/agent-status.service.ts:289, 306, 309, 313, 316, 322, 333, 337, 342, 347, 351, 355` | all five | Pure classifier — returns `{status, evidence}` based on pane tail. **Reset path is structural: classifier is stateless, called every 5 s.** |
| `services/jsonl-parser.service.ts:98-100` | `'thinking'` | Renders Claude `thinking` blocks into chat messages. Not a session-state; content-type marker. **N/A reset.** |
| `services/city-state.service.ts:21, 22, 68-70` | `'working'` / `'waiting'` / `'idle'` | Aggregates `GROUP BY status` for the `/city` view. Read-only aggregation. **N/A reset.** |
| `services/session.service.ts:210, 284, 402, 405, 410` | `'idle'` / `'working'` | Defaults on row creation + `live` vs `stopped` flip in the reconciler. **Reset: driven by `opts.live` + `opts.status`; caller must set correctly.** |

### Client

| File:line | Literal | Purpose |
|---|---|---|
| `pages/SplitChatLayout.tsx:302, 367, 419, 443, 496` | `'waiting'` / `'working'` | Tab pulse + glow; reads `t.status`. Purely derived — **N/A reset**. |
| `pages/ChatPage.tsx:211, 226, 233, 293-297, 324-325, 622-627` | `'working'` / `'waiting'` / `'thinking'` | Drives shimmer state (`'thinking' | 'tooling' | 'waiting'`) + "Sent" banner. Derived from `session?.status`. **N/A reset.** |
| `hooks/usePromptDetection.ts:111, 133, 140, 156` | `'idle'` / `'working'` / `'waiting'` | Gate for the permission-prompt poller; 1 s when `waiting`, 2 s when `working`, stops on `idle`/`stopped`. **Reset: poller reacts to status changes from WS.** |
| `hooks/useChat.ts:181` | `'working'` / `'waiting'` | Poll-or-stream switch. Derived. **N/A reset.** |
| `components/chat/ChatThread.tsx:252-254, 271, 581` | `'thinking' | 'tooling' | 'waiting'` | `shimmerState` prop type + className branching. Pure render. **N/A reset.** |
| `components/chat/ContextBar.tsx:43, 108, 115, 140, 268-299, 305, 435, 448` | `'thinking'` / `'working'` / `'waiting'` | Status label + color + `bar-working`/`bar-waiting` classes. Derived. **N/A reset.** |
| `components/city/*` | `'working'` / `'waiting'` / `'thinking'` | City/pixel animation state — purely derived from `session.status` via WS. **N/A reset.** |
| `layouts/TopCommandBar.tsx:72, 120, 126, 130, 199, 201, 205, 332, 372, 374, 378` | `'working'` / `'waiting'` / `'idle'` | Tab classname + counts. Derived. **N/A reset.** |
| `components/chat/AgentSpawnCard.tsx:17, 36` | `'working'` | Sub-agent spawn card icon — unrelated to session state (it's Claude's `Task` tool status). **N/A reset.** |
| `components/chat/AssistantMessage.tsx:44` | `'thinking'` | Block-type renderer for Claude's internal thinking. **N/A reset.** |
| `utils/sessionDisplay.ts:8-27` | all five | `DisplayStatus` projection. Pure function. **N/A reset.** |

### NO RESET PATH flags

**None found in this grep pass.** Every location in `client/src` and `server/src` either:
1. Is a pure derivation from `session.status` (client), OR
2. Is the poller itself — which runs every 5 s and will re-write the status on the next cycle, OR
3. Is `session.service.ts`'s create/dismiss/reconcile, which is explicitly driven by caller intent.

**Historical context Jose should know:** the "stuck state" symptom the CTO is asking about is not from a missing reset path — it's from a **misclassification** path. Claude Code's pane footer lingers on post-turn past-tense verbs (`✻ Cooked / 21261s`) with the spinner glyph still drawn; the old detector treated spinner-present as `working`, and the row would read `working` indefinitely. Phase L B1 (`5d22eb2`) fixed this with `COMPLETION_VERBS` + `/ed$/` fallback + `STALE_ELAPSED_SECONDS = 600` gate — `agent-status.service.ts:252-273, 303-315`. **The path exists; the question is whether the heuristic keeps up with Claude Code UI changes** (see §7).

---

## Section 5 — Tabs & layout (current state)

**Implementation files:**
- `client/src/layouts/TopCommandBar.tsx` — top strip of session tabs (top-level sessions only, `!parentSessionId`).
- `client/src/pages/SplitChatLayout.tsx` — split-pane container with in-pane "teammate tabs" along the right side.

**Tab reorder:** **No.** `topBarSessions` sorts by `sessions.filter(!parentSessionId)` order (server-delivered, `created_at` effectively); `SplitChatLayout.refreshTeammates` sorts by `createdAt ASC`. No drag handles. No `react-dnd`/`@dnd-kit`.

**Drag to split groups:** **No.** There is no concept of multiple editor groups. `SplitChatLayout` is a 2-pane fixed layout — left = PM chat, right = one active teammate. The right pane has up to 3 teammate "tabs" (capped by `MAX_TEAMMATES = 3`) but they switch the active right-pane only; they do not create new groups.

**Close with shortcut:** **No.** Close is a click on an `X` inside the in-pane tab or via the Force-Close modal (`ForceCloseTeammateModal.tsx`). No keybinding is registered.

**Max tabs:** Top bar — `MAX_TABS_LG=5`, `MAX_TABS_MD=3`, overflow goes into a dropdown (`TopCommandBar.tsx:15-16, 27, 332+`). Teammate pane — `MAX_TEAMMATES=3` (`SplitChatLayout.tsx:20`).

**Persistence:** Yes — per-PM preference key `split-state.<pmSessionId>` via `usePreference` → `POST /api/preferences`. Shape: `{ activeTabId, tabIds?, minimized?, percent }`. Legacy `localStorage` key `jsc-split-state-v1` is migrated once on mount.

**Layout diagram (current runtime):**

```
┌────────────────────────────────────────────────────────────────────┐
│ TopCommandBar : [session tab 1] [session tab 2] … [+]   … [WiFi]  │ ← 48px
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────────────────────────────┐  │  ┌──────────────────────┐   │
│   │   PM chat (ChatPage)          │  │  │  teammate strip:     │   │
│   │                               │  ╎  │  [tab 1]             │   │
│   │   ContextBar (status + effort)│  ║  │  [tab 2]             │   │
│   │   ChatThread (messages)       │  ╎  │  [tab 3]             │   │
│   │   StickyPlanWidget (if any)   │  │  │                      │   │
│   │   LiveActivityRow (live turn) │  │  │  ChatPage(teammate)  │   │
│   │   Command input               │  │  │                      │   │
│   │                               │  │  │                      │   │
│   └──────────────────────────────┘  │  └──────────────────────┘   │
│        left = percent %             ║        right = 100-percent  │
│                                drag handle 30..70                  │
│                                                                    │
│   (mobile/minimized: right collapses to 64 px icon strip)          │
└────────────────────────────────────────────────────────────────────┘
```

**There are no VS Code-style editor groups.** The "mostly done" characterization refers to the 2-pane split + tabbed right side. Re-groupable panes, drag-to-split, per-group tab bars — not built.

---

## Section 6 — What's wired to Claude Code today

Checked against `~/.claude/settings.json` and the hook/statusline files in this repo.

- [x] **statusLine hook installed and forwarding to Commander?** **Yes.** `~/.claude/settings.json` has `statusLine` block; script at `packages/statusline/statusline.mjs`; endpoint at `server/src/routes/session-tick.routes.ts` (`POST /api/session-tick`, loopback-only).
- [ ] **SessionStart hook wired?** **No.** Not present in `~/.claude/settings.json`. Effort: ~1 h to wire (re-use `commander-hook.sh` + add a matcher).
- [ ] **SessionEnd hook wired?** **No.** Same as above. Effort: ~1 h to wire; auto-capture summarizer (Sonnet Agent) is a separate build: ~1 day.
- [ ] **Stop hook wired?** **Yes.** `~/.claude/settings.json` routes Stop to `commander-hook.sh` but the hook is an undifferentiated POST to `/api/hook-event`; the server treats it the same as any other event. Not specifically acted on.
- [ ] **PreCompact hook wired?** **No.** Effort: ~0.5 h to wire the shell script + ~1 day to build the JSONL backup service.
- [x] **JSONL tailing via chokidar?** **Yes.** `server/src/services/file-watcher.service.ts` + `watcher-bridge.ts`.
- [ ] **tmux pipe-pane for session logging?** **Partial.** `terminal.service.ts:16-27` attempts `tmux attach -r` as pipe; falls back to `capture-pane` polling via `startPolling`. Not true `pipe-pane`.
- [ ] **node-pty for actual terminal rendering?** **No.** Package installed; not imported. Pane rendering is ANSI text polled and dumped into `<pre>`. Effort to switch: ~2-3 days (node-pty has build issues on this setup per `STATE.md:95`).
- [ ] **Commander MCP server exposed?** **No.** No MCP module. `COMMANDER_IDE_RESEARCH.md` §4 is the design brief. Effort: ~3-5 days for a minimal MCP surface (session tools + project tools).

---

## Section 7 — Pain points PM has observed (across phases I–M)

- **Statusline ticks are frozen until the next turn.** Claude Code only fires the statusline update when it emits output. A PM sitting at 100 % context after `/compact` keeps showing 100 % in Commander's footer until the next message, because `statusline.mjs` is only invoked by Claude. This was flagged at the top of the Phase N brief by team-lead — it is real, and it isn't just a display lag, it's a data-freshness lag that breaks the "live context %" promise of Phase M B2's toast. `c3fd10b`.

- **Agent-status classifier is chasing Claude's UI verbs.** Every minor Claude Code release adds new past-tense verbs (`✻ Cooked`, `✻ Crunched`, `✻ Brewed`, …) that the spinner-hoist hoists into `working` until the allowlist catches up. Phase L B1 (`5d22eb2`) is the most recent mop-up — it includes `/ed$/` as a fallback but that's a delay-not-a-fix. `STATE.md:97` explicitly calls out "agent-status heuristic is regex-based — evolves with each Claude Code UI change. Consider `.claude/status.json` if exposed upstream." Phase N (F3+F4 transcript tailing + hooks) is meant to retire this layer, per team-lead's brief.

- **The hook `resolveOwner` cascade is 5 strategies deep and still drops events.** Phase L B2 + refinement (`da96818`, `932c152`) added `pm-cwd-rotation` and `coder-team-rotation` strategies plus the `jsonl-origin.service.ts` discriminator, and it finally closed the cross-session tool-call leak into PM chat that the user reported mid-phase. The cascade works, but every coder-phase lately has needed one more branch — the root cause is that the hook payload doesn't include enough identity (only `session_id`, `transcript_path`, `cwd`) to bind unambiguously. More strategies mean more drop paths.

- **`tsx watch` does not hot-reload server changes reliably.** `STATE.md:94` pins this as a known issue. Server dev loop needs a manual restart after edits. Phase N will add more server code; without a resolution, iteration cost climbs.

- **`client/dist` silently shadows Vite in dev.** `server/src/index.ts:71-90` added an explicit `NODE_ENV !== 'production'` gate after three Wave 2 features appeared to regress on 2026-04-17 because fastify-static was serving an Apr-14 `client/dist`. The gate warns now, but the trap is still reachable if a user runs a one-off build in a dev checkout. Feedback memory `feedback_dist_shadows_vite.md` confirms.

- **`node-pty` declared but broken; xterm unused.** The terminal page is ANSI text in a `<pre>` polled from `capture-pane`. It works, but it's not a terminal — no alternate-screen, no mouse, no PTY signals. Anything the user wants to do interactively in the Terminal tab degrades.

- **Tabs don't reorder, don't drag-to-split, don't support groups.** `SplitChatLayout` + `TopCommandBar` are two separate tab systems with different state stores. The Phase N brief reframes this as a Code-like layout — it's not incremental from here, it's a rewrite.

- **Session create is 3 setTimeouts.** `session.service.ts:240+` spawns tmux, then 500 ms later sends `claude`, then `waitForClaudeReady` polls tmux for the ready glyph, then sends `/effort xhigh`, then (PM) the bootstrap prompt. Any step can miss. It has been Good Enough but every timing change in Claude Code's boot sequence reverberates here.

---

## Section 8 — What PM thinks should happen next (top 3)

Written from PM pov — informed by Phases I–M, the Phase N brief team-lead previewed, and the pain points above.

### 1. Retire the pane-regex classifier by wiring JSONL tailing + lifecycle hooks (**what team-lead is asking for as Phase N — F3 + F4**)

**Why this is #1:** every classifier-related phase (G.1, J, J.1, L-B1) ended with "we caught the current verbs; the next Claude Code release will add new ones." The Claude Code transcript JSONL carries authoritative `type` markers (`assistant_turn_start`, `tool_use`, `stop`, etc.) that say **what actually happened**, not what the footer renders. Combined with `SessionStart` / `Stop` / `PreCompact` / `UserPromptSubmit` hooks for lifecycle transitions, we can drop the 5-second tmux `capture-pane` poll entirely. Commander is already doing JSONL tailing (`file-watcher.service.ts`) — it just isn't using the signals yet.

**Secondary win:** closes the Phase-N-brief opener ("statusline ticks frozen between turns") because a `PostToolUse` hook fires DURING the turn, giving Commander a ground-truth "session is mid-turn" signal independent of whether the statusline has re-run.

### 2. Fix the statusline freshness gap before building on top of it

**Why:** Phase M B2 shipped an orange/red context-low toast driven by `tick.contextWindow.usedPercentage`. The toast is load-bearing for cost control — a user needs to see "you're at 90 %" before they hit 100 %. If the tick only refreshes on Claude output, the toast fires **after** the turn the user was worried about. Phase N's hook-based lifecycle will help but isn't sufficient (a 60 s idle at 97 % still won't re-tick). Options: a synthetic tick on idle from the server (cheap, just re-broadcast last known with a stale flag) or piggy-back on the `Stop` hook we already have (decode transcript for the latest `usage` record and synthesize a tick). Either way, before we build more UI on `useSessionTick`, we need to agree on the tick contract.

### 3. Terminal page — commit or remove

**Why:** `@xterm/*` + `node-pty` are installed, terminal-related code exists across `terminal.service.ts` + `TerminalPanel.tsx` + `useTerminal.ts`, but the runtime is `capture-pane` polling rendered into a `<pre>`. Users get a read-only ANSI dump that pretends to be a terminal. Two credible paths:
- **Commit:** switch the server to true `tmux pipe-pane` (stream mode) + wire xterm.js on the client with the PTY binary data. ~2-3 days. Real terminal.
- **Remove:** delete the `/terminal/:id` page and the Terminal tab; rely on users attaching with `tmux attach` when they need a real pane. ~1 hour.

Either is fine. The current half-built state is the pain — it looks like a feature but disappoints anyone who uses it. My preference is **commit**, because the session view is otherwise read-only (no mouse, no vim keys) and a real terminal is how Jose would debug a stuck coder. But the cost of **remove** is also small.

---

## Appendix — Numbers

- 19 server services, 14 routes, 7 shared types, 1 hook script, 1 statusline forwarder.
- `session.service.ts` 995 lines (largest service).
- `SplitChatLayout.tsx` 674 lines; `TopCommandBar.tsx` 424 lines (tabs).
- Tests: 93 client (`src/utils/__tests__/*.test.ts`), 64 server (`src/services/__tests__/*.test.ts`), 0 E2E committed past scaffolding.
- Schema: 9 tables — `sessions`, `projects`, `token_usage`, `cost_entries`, `session_events`, `file_watch_state`, `agent_relationships`, `phase_logs`, `skill_usage`, `notifications`, `preferences`, `session_ticks` (12 total with migrations-only).
- HEAD `557cbd2` (`fix(chat): agent_role filter includes 'pm' not just 'lead-pm'`); last 20 commits span Phases J.1 → M.

— end —
