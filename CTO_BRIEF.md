# JStudio Commander — CTO Brief

**Prepared:** 2026-04-15
**Status:** v1 shipped + 40+ polish commits + 17 feature commits this week (plan widget, sticky plan, split-screen, PM init system, etc.)
**Stack:** Fastify 5 + SQLite (better-sqlite3) + React 19 + Vite 7 + Tailwind v4 + WebSockets + chokidar
**Deployment:** local-first; server on port 3002 (Codeman owns 3001), Vite dev on 5173, optional Cloudflare Quick Tunnel for remote access
**Repo:** `~/Desktop/Projects/jstudio-commander`

---

## 1. Executive summary

Commander is a local-first web command center replacing Codeman: connects to tmux sessions running Claude Code, renders JSONL transcripts as a structured chat UI, tracks projects via `STATE.md` / `PM_HANDOFF.md` parsing, supports remote access via Cloudflare tunnels with PIN auth. The v1 shipped earlier, followed by 40+ polish commits and a focused session this week that:

- Fixed Plan widget attribution (Feature 1)
- Shipped Sticky Plan Widget (Feature 2)
- Shipped PM↔Coder split-screen (Feature 3 MVP)
- Added compaction awareness, `waiting`-state yellow highlight, bulletproof interrupt
- Added activity chips for skill/agent/memory events
- Added nested teammate cards on the Sessions page
- Fixed per-session stats isolation (hook-event linking)
- Shipped a **PM initialization system** (auto-invoked `/pm` cold-start for every new PM session)

The OvaGas-class failure — *"Claude didn't invoke `/pm` or `/ui-expert` despite the task clearly needing them"* — is architecturally fixed.

---

## 2. Architecture snapshot

- **Stack:** React 19 + Vite 7 + TS strict + Tailwind v4 (frontend) · Fastify 5 + SQLite (better-sqlite3) + WebSockets + chokidar (backend) · Cloudflare Quick Tunnels + PIN auth
- **Monorepo:** pnpm workspaces — `packages/shared` (types, constants), `server`, `client`, `packages/ui` stub
- **Process model:** Claude Code runs independently in tmux. Commander is a *viewer/controller* — it reads JSONL transcripts, observes pane state, writes via `tmux send-keys`. Hook events deliver `transcript_path` for reliable per-session JSONL identification.
- **Design language:** dark glassmorphism, teal accent (#0E7C7B), Montserrat, lucide-react icons only, no emojis in code

### Why a PM Initialization System

Claude Code has an auto-skill-invocation heuristic. For standard tasks it often works, but we hit a clear failure mode with the OvaGas dogfood: user asked for a UI review, Claude did a `ToolSearch` + `Read STATE.md` + `Bash git status` + generic Agent spawn — never loaded `/pm` or `/ui-expert` despite both existing and being the canonical specialists. Fix is in three parts, described in §6.

### File tree (condensed)

```
client/src/
  components/
    chat/        ActivityChip, AgentPlan, AgentSpawnCard, AssistantMessage,
                 ChatThread, CodeBlock, ContextBar, MessageMeta, PermissionPrompt,
                 SessionTerminalPreview, StickyPlanWidget, ThinkingBlock,
                 ToolCallBlock, UserMessage
    sessions/    CommandInput, CreateSessionModal, SessionActions, SessionCard,
                 TeammateRow
    analytics/   CostChart, ModelBreakdown, SessionCostTable, TokenCard
    projects/    ModuleMap, PhaseTimeline, ProjectCard, StateViewer
    terminal/    TerminalPanel, TerminalTabs
    shared/      EmptyState, ErrorBoundary, GlassCard, LoadingSkeleton, Logo,
                 PinGate, StatusBadge
  hooks/         useAnalytics, useChat, useProjects, usePromptDetection,
                 useSessions, useTerminal, useWebSocket
  layouts/       DashboardLayout, MobileNav, MobileOverflowDrawer, Sidebar,
                 TopCommandBar
  pages/         AnalyticsPage, ChatPage, ProjectDetailPage, ProjectsPage,
                 SessionsPage, SplitChatLayout, TerminalPage
  services/      api.ts, ws.ts
  utils/         format.ts, plans.ts, text-renderer.tsx

server/src/
  routes/        analytics, auth, chat, hook-event, project, session, system,
                 teammates, terminal, tunnel
  services/      agent-status, file-watcher, jsonl-discovery, jsonl-parser,
                 project-scanner, session, status-poller, team-config,
                 terminal, tmux, token-tracker, tunnel, watcher-bridge
  db/            connection.ts (auto-migration), schema.sql
  ws/            event-bus.ts, handler.ts, index.ts, rooms.ts

packages/shared/src/
  constants/     models.ts, status.ts
  types/         analytics.ts, chat.ts, project.ts, session.ts, terminal.ts,
                 ws-events.ts
```

---

## 3. Current JSONL parser types

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'system_note'; text: string }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number };

export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  content: ContentBlock[];
  model?: string;
  usage?: TokenUsage;
  sessionSlug?: string;
  isSidechain: boolean;
  agentId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
```

Claude Code JSONL records are mapped 1:1 to `ChatMessage`. The parser handles `permission-mode`, `file-history-snapshot`, `attachment`, and `system/subtype=compact_boundary` synthetic events. `tool_result` content is normalized to a string regardless of raw shape (array of text blocks, plain string, etc.).

---

## 4. WebSocket event list

```ts
// Server → Client
session:created | session:updated | session:deleted | session:status
chat:message   | chat:messages
project:updated | project:scanned
terminal:data  | terminal:resize
analytics:token | analytics:daily
tunnel:started | tunnel:stopped | tunnel:error
system:error   | system:heartbeat
teammate:spawned | teammate:dismissed

// Client → Server
terminal:input | terminal:resize
session:command
subscribe | unsubscribe   // channels: sessions, chat:<id>, terminal:<id>, analytics, tunnels
```

Channel-based subscriptions; `rooms.ts` manages fan-out. `event-bus.ts` is the internal pub/sub; WS forwarding is thin.

### Session model

```ts
export type SessionStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';

export interface Session {
  id: string;
  name: string;
  tmuxSession: string;          // pane ID (%35) or sentinel (agent:…)
  projectPath: string | null;
  claudeSessionId: string | null;
  status: SessionStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  stationId: string | null;
  agentRole: string | null;
  effortLevel: string;
  parentSessionId: string | null;  // set when spawned via TeamCreate
  teamName: string | null;         // which team config this belongs to
  sessionType: 'pm' | 'raw';       // controls bootstrap auto-injection
}

export interface Teammate {
  sessionId: string;
  sessionName: string;
  role: string;
  teamName: string;
  parentSessionId: string;
  color?: string;
  tmuxPaneId?: string;
}
```

---

## 5. Features implemented this session

| # | Feature | Commit |
|---|---|---|
| 168 | Plan card attribution: TodoWrite tool calls now render inside Claude's message (not the user's) | `cec1bc9` |
| 171 | Plan live updates via real task IDs parsed from `"Task #N created"` tool_result | `bfe82bb` |
| 169 | **Sticky Plan Widget** — floating glass pill above chat input with X close button; appears when inline card is off-screen; auto-fade 3s after allDone; IntersectionObserver threshold 0.5 | `5263bd7`→`6627d57`→`c1c886f`→`8d2d981` |
| 170 | **Split-screen teammate pane** — team config (`~/.claude/teams/*/config.json`) watched via chokidar, emits `teammate:spawned`/`dismissed`; SplitChatLayout mounts ChatPage twice; drag-resize clamped 30–70%; localStorage restore; WS-driven open/close | `e9f651b`→`cf9b94f`→`5598bb8` |
| 172 | **Compaction support** — parses `compact_boundary` JSONL event, banner in chat (`Compacted (manual) — freed 886.5k tokens`), `contextTokens` stat resets post-boundary | `fdb2485` |
| 173 | **Waiting yellow highlight** — SessionCard glows yellow when session or any teammate is waiting on prompt; StatusBadge halo; SplitChatLayout right-pane glow | `9929f8a` |
| 174 | **Bulletproof interrupt** — global ESC listener (works regardless of textarea content/focus), Cmd+./Ctrl+. shortcut, `data-escape-owner` for menus/prompts, double-tap Escape 80ms apart, Stop button always visible during activity, "Stopping…" optimistic state, error toast on failed interrupt | `4f3b9c7` |
| 175 | Teammate `status=stopped` blocker — default idle on insert; `agent_relationships` upsert respects respawn; poller skips `agent:*` sentinel targets | `5f90cf8` |
| 176 | **Nested teammate tree** on Sessions page — teammates indent under parent PM with tree line; click row opens split directly to that teammate via localStorage seed; parent glows yellow when any teammate is waiting | `2150129` |
| 177 | **Per-session stats isolation** — model `[1m]` suffix + short-form (`opus`, `sonnet`) normalization; `/chat` and `/stats` reject cwd-fallback for rows with `parent_session_id`; 4-strategy hook-event matcher (claudeSessionId → transcript_path UUID → unclaimed-cwd → skip); boot-heal backfills UUID IDs and clears stomped transcript_paths | `35ef990` |
| 179 | **Activity chips** — `ActivityChip` (Skill/Brain/blue, SendMessage/Send/cyan, TeamCreate/Users/purple, ToolSearch/Search/muted, TaskList/ListTree/muted) + `AgentSpawnCard` with live Spawning→Working→done/error state; Read path-classified to skill/memory/doc chips | `a42a1b4` |
| 180 | Session card shows `teamName` as muted suffix to disambiguate same-named team-leads | `853e477` |
| 181 | Boot-heal liveness gate (tmux pane live OR JSONL mtime <10min OR recent hook) prevents zombie resurrection; `DELETE /api/sessions/:id` archives team config to `.trash/` | `53c32c5` |
| 178 | PM tmux pane resolution — `tmux list-panes -a` + cwd match adopts real pane ID for sentinel-targeted rows; status-poller un-sticks pane-backed rows | `95aacef` |
| 182 | Text tokens brightened (`text-tertiary` bumped most); live in-flight `thinking` text preview under shimmer with 4-line clamp + crossfade | `38023cb` |
| 183 | **State-aware shimmer** — thinking (slow teal) / tooling (fast teal-light + glow) / waiting (paused idle-yellow); `.bar-working` + `.bar-waiting`; live skill/agent/memory indicators between header and shimmer; ContextBar action labels get per-tool-family icons | `043dc5f` |
| 184 | **PM vs Raw session toggle** in CreateSessionModal (defaults PM); server polls for Claude ready prompt up to 12s then `tmux send-keys` bootstrap text for PM sessions; `session_type` field, PM badge pill on cards | `587e508` |

---

## 6. PM Initialization System (Parts 1–3)

The OvaGas failure motivated a full architectural fix. Every PM session now self-bootstraps:

### Part 1 — Cold-Start protocol in `/pm` skill

`~/.claude/skills/jstudio-pm/SKILL.md` has a mandatory Cold Start section at the top of its body. On invocation, the PM runs silently:

1. Read `~/.claude/CLAUDE.md` (stack rules, blast walls, DGII, available skills)
2. Inventory `ls ~/.claude/skills/` (db, ui, scaffold, qa, e2e, landing, security, supabase, ui-ux-pro-max)
3. Read project state (`./CLAUDE.md`, `./STATE.md`, `./PM_HANDOFF.md` — skeletons flagged if absent)
4. Scan `~/.claude/projects/<slug>/memory/MEMORY.md` for user prefs/feedback
5. Report readiness in one compact paragraph

Plus an "Invoking Specialists" matrix clarifying Skill tool (load into context) vs Agent tool (sandboxed subagent) vs TeamCreate (long-lived coder) — with an explicit warning: *"Never call `Agent({ subagent_type: "ui-ux-pro-max" })` — that's a skill, not a subagent type."*

### Part 2 — Canonical bootstrap prompt

`~/.claude/prompts/pm-session-bootstrap.md`:
> *"You are the Lead PM for JStudio. Invoke /pm and run its cold-start protocol. Wait for my pitch. Do not begin work until I provide it."*

### Part 3 — Commander auto-injection

New `session_type: 'pm' | 'raw'` column on sessions. `CreateSessionModal` defaults to PM. After tmux session creation, server polls `capture-pane` every 400ms for up to 12s looking for `❯` or `? for shortcuts`, then `sendKeys` the bootstrap text. Missing prompt file → warn + skip (never fails session create). Raw sessions bypass injection entirely.

### Verified live

Fresh PM session → bootstrap injected → `/pm` loaded → cold-start ran → readiness reported. User asked *"review the OvaGas ERP UI"* → PM proposed invoking `ui-ux-pro-max` + `/ui-expert` as the first action (vs. the pre-fix behavior of ToolSearch + generic Agent). The architectural fix works.

---

## 7. Bugs fixed vs still open

### Fixed this session

- Plan card attached to wrong message (user vs assistant)
- Plan tasks keyed by auto-incrementing counter instead of real Claude Code task ID → updates silently dropped
- Plan events in different assistant groups (split by user "Proceed" messages) → multi-group plans didn't update
- `deleted` TaskUpdate status crashed STATUS_CONFIG lookup → AgentPlan + StickyPlanWidget defensive fallback
- Sticky widget persisted through all-done state
- Sticky widget always visible → contextual with IntersectionObserver
- Split-pane teammate rows had `status=stopped` default → never rendered
- `agent_relationships.ended_at` not reset on teammate respawn
- Status poller stomping sentinel targets back to stopped every 5s
- Multiple Vite dev servers serving stale client code (Vite cache + duplicate processes)
- Hook-event route matched by cwd alone → PM + teammate sharing cwd clobbered each other's `transcript_path`
- Model `[1m]` suffix + short-form (`opus`) not in context-limit map → 319K / 200K = 100% clamped display
- Teammate stats fell back to parent's JSONL via cwd-match → identical token counts
- Boot-heal unconditionally flipped stopped→idle → zombie resurrection of dead PMs (vetcare)
- ESC interrupt gated on empty textarea → unusable while typing
- Stop button hidden during 1.5s status-poll lag
- Silent `.catch(() => {})` on interrupt failures → user spam-clicks thinking nothing happened
- Single Escape key occasionally missed during tmux-render cycles → double-tap 80ms apart
- Live "Thinking…" showed nothing about what Claude was doing → live thinking preview + state-aware shimmer + tool-family icons
- Skill loads rendered as generic tool blocks → Brain/blue ActivityChip
- Agent spawn cards were static → live Spawning→Working→done lifecycle
- OvaGas-class auto-skill-invocation miss → PM init system (Parts 1–3)
- Duplicate team-leads from multiple teams indistinguishable → `teamName` suffix on card

### Known open / deferred

- **Multi-tab teammate pane** (Feature 170.1) — currently single-slot. If more than one teammate is active, split only shows the most recent by default; user can click a specific one from the Sessions tree. Tabs inside the right pane + minimize-to-strip deferred.
- **Direct Mode badge** (deferred 170.1): when user is typing in the coder pane, PM pane should show a muted "Direct Mode" overlay.
- **Project CLAUDE.md scaffolding template / `jstudio-init-project` helper** (deferred Part 4 of PM init): approved to defer. Cold-start in `/pm` handles skeleton-creation hints when it encounters a missing project doc.
- **`file-watcher.service.ts:90`** pre-existing TS error (Error/unknown mismatch) — cosmetic, doesn't affect runtime.
- **Status poller edge case** on real pane-ID teammates between turns: may briefly classify as `stopped` vs `idle`. Cleanup pass merited before major multi-teammate work.
- **Agent subagent calls for Claude Code built-in types** (Explore, Plan) don't currently render with distinct visual affordance vs our Agent chip — both use the Zap icon. Consider differentiating later.

---

## 8. Tech debt introduced or surfaced

1. **Two write paths for session rows.** Team-config reconciliation and the legacy `sessionService.createSession` both write to the `sessions` table. Diverged defaults were the root cause of #175. Consolidate to a single `upsertSession` facade.
2. **Boot-heal liveness check** (#181) does filesystem mtime checks synchronously on startup. Fine for small session counts; if the sessions table grows to >100 inactive rows, worth adding an index on `updated_at` and batching the heal.
3. **Hook-event matcher** (#177) has 4 strategies including a cwd-tiebreaker. Deterministic today but adds branching complexity. If we ever get Claude Code hooks that include pane ID directly, collapse the matcher to a single lookup.
4. **Activity chip dispatch** (#179) is a growing switch in `AssistantMessage.tsx`. As we add more tool-specific affordances (Commit, PR, Deploy, etc.), worth factoring to a registry pattern.
5. **Token normalization** (#177) handles `[1m]` and short forms. Claude Code's model naming conventions are external — if they change, `MODEL_CONTEXT_LIMITS` needs updates. Should move to a versioned constants file in `packages/shared` and add unit tests.
6. **Sticky widget IntersectionObserver** re-queries by attribute on every planKey change. Cheap but not zero. If we ever have multiple simultaneous plans, migrate to a React ref passed through context.
7. **`tsx watch` dev unreliability** is a known hazard. Production build uses compiled Node so the issue is dev-only.
8. **Vite HMR stale code via duplicate dev servers** caused a debugging blackhole earlier this week. The client-side equivalent of the `tsx watch` issue. Worth adding a dev-mode health check banner showing the loaded bundle hash.
9. **No E2E test coverage** for Commander itself yet. All verification is manual or curl-based. Bootstrapping Playwright against the dev server is a natural next step once feature churn slows.
10. **Split-screen state** is stored in localStorage (`jsc-split-state-v1`). Doesn't survive clearing site data or incognito. Move to DB-persisted preferences once we add user accounts.
11. **Team config watcher uses chokidar with polling** because chokidar 4 dropped glob support. Works but adds a 10s poll loop for new team directories. Minor.

---

## 9. Recommended next moves

1. **Multi-tab teammate pane** (Feature 170.1) — unlocks real multi-specialist workflows (QA + Security audit in parallel).
2. **E2E coverage** via Playwright on the feature set we just shipped, before adding more.
3. **Memory/skill inventory view** — small panel in Commander showing what skills are currently loaded per session, which memory files are being referenced. Makes "did it use /pm?" self-answering without curl.
4. **Move session preferences (split state, effort, theme) to DB** — kills localStorage edge cases and prepares for multi-device access via tunnel.
5. **Audit + prune stopped teammate rows** accumulated in the DB during testing. A weekly cleanup cron would keep the Sessions page tight.
6. **Unit tests on `utils/plans.ts`** — the plan extraction + compaction logic is the trickiest bit we've shipped. Would benefit from fixtures based on real JSONL samples we already have.
7. **Feature flag for auto-skill-invocation hints** — if a PM has cold-started but is about to do domain work without invoking the specialist, inline a gentle nudge: *"This looks like UI work — invoke `/ui-expert`?"* Optional, low-priority.

End of brief.
