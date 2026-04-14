# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-14 — consolidated stats into ContextBar, removed StatusStrip/ResponseSummary, fixed input bugs
> Model: Opus 4.6 (1M context)

## Current Status

**v1 COMPLETE + Post-v1 Polish Done**
- All 10 original phases (1-10) committed and verified
- 4 additional post-v1 polish commits landed (pipeline fixes, chat redesign x3, PM UI fixes)
- Server runs on port **3002** (changed from 3001 via `~/.jstudio-commander/config.json`)
- Vite proxy targets port 3002

## Git History

| Commit | Phase/Author | Description |
|--------|-------------|-------------|
| `109b705` | Phase 1 | Scaffold monorepo, SQLite schema, Tailwind v4 dark theme, dev servers |
| `f6361e4` | Phase 2 | tmux service, session CRUD, agent status detection, 7 REST endpoints |
| `c9f9bf9` | Phase 3 | JSONL parser, project scanner, token tracker, file watchers, data routes |
| `37e7fd1` | Phase 4 | WebSocket server, event bus, rooms, status poller, watcher bridge |
| `3a9baaf` | Phase 5 | App shell, sidebar, mobile nav, routing, shared UI primitives |
| `bbaf055` | Phase 6 | Session management UI: cards, create modal, command input, real-time updates |
| `6b2c6e1` | Phase 7 | Chat conversation view: bubbles, tool calls, code blocks, thinking, Shiki |
| `26eff2b` | Phase 8 | Project dashboard: cards, phase timeline, module map, STATE.md viewer |
| `011d343` | Phase 9 | Terminal panel (xterm.js + node-pty) + Analytics dashboard (Recharts) |
| `f894106` | Phase 10 | Cloudflare tunnel, PIN auth, sidebar controls, polish, production build |
| `e36d84f` | Coder-3 | Fix 4 pipeline bugs: chokidar glob, path decoding, empty command, polling fallback |
| `3db42b5` | PM direct | Session tabs in TopCommandBar, terminal preview, model selector, port 3002, misc UI |
| `9f87287` | Coder-4 | Fix chat layout overflow (sidebar stays fixed), avatars, thinking animations, tool call status icons |
| `eab3d3d` | Coder-5 | First chat redesign: flat timeline layout, no bubbles |
| `a1dd129` | Coder-6 | Final chat rebuild: UserMessage, AssistantMessage, StatusStrip, ContextBar, ResponseSummary, glass code blocks, compact tool calls, rich input |
| `e768815` | Coder-7 | State files audit, CSS @import fix |
| `6af9ae5` | Coder-7 | 6 chat fixes: spacing, StatusStrip auto-clear, varied status text, ContextBar model limits, Crown icon, timeline dots |
| `bde70fd` | Coder-7 | Consolidate stats into ContextBar (action + tokens + elapsed + context %), remove StatusStrip/ResponseSummary, fix Enter key + duplicate keys |

## File Inventory

### packages/shared/src/
- `types/session.ts` — Session, SessionStatus ('idle'|'working'|'waiting'|'stopped'|'error'), SessionEvent
- `types/chat.ts` — ChatMessage, ContentBlock (text|thinking|tool_use|tool_result|system_note), TokenUsage
- `types/project.ts` — Project, PhaseStatus, PhaseLog
- `types/terminal.ts` — TerminalSession, TerminalResize
- `types/analytics.ts` — TokenUsageEntry, CostEntry, DailyStats
- `types/ws-events.ts` — WSEvent (18 types), WSCommand (5 types)
- `constants/models.ts` — MODEL_PRICING per 1M tokens
- `constants/status.ts` — STATUS_COLORS, STATUS_LABELS

### server/src/
- `config.ts` — DB at ~/.jstudio-commander/commander.db, reads config.json for port/pin/projectDirs, default port 3001 (overridden to 3002 via config.json)
- `db/connection.ts` — better-sqlite3 singleton, WAL mode, runs schema.sql
- `db/schema.sql` — 11 tables, 9 indexes
- `index.ts` — Fastify entry, all plugins, graceful shutdown
- `services/tmux.service.ts` — execFileSync wrapper for tmux CLI
- `services/session.service.ts` — CRUD + auto-slug (20 adj × 20 nouns) + event logging + session tabs support
- `services/agent-status.service.ts` — pane content heuristic detection
- `services/jsonl-parser.service.ts` — full record type handling, thinking blocks use `thinking` key
- `services/jsonl-discovery.service.ts` — encodeProjectPath, find session files
- `services/token-tracker.service.ts` — usage extraction, cost calc, aggregation
- `services/project-scanner.service.ts` — STATE.md/PM_HANDOFF.md parsing
- `services/file-watcher.service.ts` — chokidar with fixed glob matching, incremental byte-offset reads
- `services/status-poller.service.ts` — 5s interval, batch detect, emit on change, polling fallback
- `services/watcher-bridge.ts` — connects file-watcher to eventBus, fixed path decoding
- `ws/event-bus.ts` — typed EventEmitter (max 50 listeners)
- `ws/rooms.ts` — channel-based Map<string, Set<WebSocket>>
- `ws/handler.ts` — /ws route, heartbeat 15s, ping/pong 30s timeout 10s
- `ws/index.ts` — wires eventBus events to room broadcasts
- `routes/session.routes.ts` — 7 endpoints (CRUD + command + status)
- `routes/system.routes.ts` — health, config
- `routes/chat.routes.ts` — paginated messages, stats
- `routes/project.routes.ts` — list, detail, scan, state, handoff
- `routes/analytics.routes.ts` — today, daily, sessions, projects

### client/src/ — Chat Components (Post-v1 Redesign)
- `components/chat/UserMessage.tsx` — flat left-aligned user message, skips tool_result-only messages, Framer Motion entry
- `components/chat/AssistantMessage.tsx` — flat assistant message with content block rendering (text, thinking, tool calls)
- `components/chat/ChatThread.tsx` — scrollable timeline, auto-scroll, "New messages ↓" pill, load older, groups messages into user→assistant turns
- `components/chat/ContextBar.tsx` — unified top bar: model, action status (Cogitating/Reading/Editing/Running/Searching/Delegating/Composing), live token count, cost, elapsed timer, context % bar with color warnings
- `components/chat/ToolCallBlock.tsx` — collapsible tool calls with icon mapping, special Bash/Edit/Write rendering, compact layout
- `components/chat/CodeBlock.tsx` — Shiki syntax highlighting (lazy), copy button, language label, line numbers, glass styling
- `components/chat/ThinkingBlock.tsx` — collapsible thinking with BrainCircuit icon, brain-glow animation, handles redacted
- `components/chat/MessageMeta.tsx` — model pill + token count + timestamp (simplified)
- `components/chat/SessionTerminalPreview.tsx` — embedded terminal preview inside chat page (263 lines)

### client/src/ — Chat Components REMOVED
- `components/chat/UserBubble.tsx` — DELETED (replaced by UserMessage.tsx)
- `components/chat/AssistantBubble.tsx` — DELETED (replaced by AssistantMessage.tsx)
- `components/chat/StatusStrip.tsx` — DELETED (merged into ContextBar)
- `components/chat/ResponseSummary.tsx` — DELETED (inline token summaries removed per user request)

### client/src/ — Layouts
- `layouts/Sidebar.tsx` — collapsible 64↔240px, 5 nav items, localStorage, tunnel status
- `layouts/TopCommandBar.tsx` — session tabs (clickable, navigate to /chat/:id), overflow dropdown, model selector with pricing, WS status, daily stats (364 lines, heavily expanded post-v1)
- `layouts/DashboardLayout.tsx` — Sidebar + TopCommandBar + MobileNav + Outlet, pb-24 lg:pb-6
- `layouts/MobileNav.tsx` — fixed bottom 64px, 4 tabs + More, safe-area-inset
- `layouts/MobileOverflowDrawer.tsx` — slide-up glass, Analytics + Tunnel + real stats

### client/src/ — Pages
- `pages/SessionsPage.tsx` — session grid (active + collapsible stopped), create modal
- `pages/ChatPage.tsx` — full conversation view: StatusStrip, ContextBar, ChatThread, ResponseSummary, rich input area (323 lines, redesigned)
- `pages/ProjectsPage.tsx` — project grid with filter pills
- `pages/ProjectDetailPage.tsx` — header, phase timeline, module map, STATE.md viewer
- `pages/TerminalPage.tsx` — xterm.js terminal with session tabs
- `pages/AnalyticsPage.tsx` — stat cards + daily cost chart + model breakdown + session table

### client/src/ — Hooks, Services, Utils
- `hooks/useWebSocket.tsx` — React Context provider (uses .Provider pattern for TS compat)
- `hooks/useSessions.ts` — fetch sessions, WS subscription, CRUD actions
- `hooks/useChat.ts` — fetch messages, WS subscription, smart scroll, loadMore, stats
- `hooks/useProjects.ts` — fetch projects, WS subscription, rescan
- `hooks/useTerminal.ts` — xterm.js + WebSocket bridge to node-pty, resize handling
- `hooks/useAnalytics.ts` — fetch today/daily/session/project analytics, WS subscription
- `services/api.ts` — fetch wrapper with ApiError, PIN header injection
- `services/ws.ts` — WebSocket singleton, auto-reconnect, PIN injection
- `utils/format.ts` — formatTokens, formatCost, formatDuration, formatTime, formatRelativeTime
- `utils/text-renderer.tsx` — lightweight markdown renderer
- `components/shared/` — ErrorBoundary, Logo, GlassCard, StatusBadge, EmptyState, LoadingSkeleton

### client/src/index.css — Key Additions (Post-v1)
- `.timeline-line` / `.timeline-line-accent` — left-border timeline for chat
- `.turn-separator` — thin divider between turns
- `.text-pulse` — thinking text animation
- `.chat-input` — auto-growing textarea with `field-sizing: content`
- `.status-pulse` — status strip pulse animation
- `@media (prefers-reduced-motion: reduce)` — disables all animations
- Google Fonts `@import` moved to top of file (before Tailwind @import)

## Coding Patterns & Conventions

- `const M = 'Montserrat, sans-serif'` at top of every component, applied via `style={{ fontFamily: M }}`
- Colors via CSS variables: `var(--color-text-primary)`, `var(--color-accent)`, etc.
- Glass classes: `glass-surface`, `glass-nav`, `glass-card`, `glass-modal`
- No StrictMode (following global rules)
- lucide-react ONLY icon library
- React Context + useState for state (no Redux/Zustand)
- Arrow functions for components
- TypeScript strict, no `any`
- UI is English (developer tool)
- `pb-24 lg:pb-6` for mobile nav clearance
- `hidden lg:flex` for desktop sidebar, `lg:hidden` for mobile nav
- WebSocket.Provider uses `.Provider` pattern (not React 19 shorthand — TS compatibility)
- Framer Motion `ease: 'easeOut' as const` for strict typing
- `prefersReducedMotion()` helper used in chat components to skip animations
- Chat uses flat timeline layout (no bubbles) — UserMessage left-aligned, AssistantMessage with content blocks
- TopCommandBar has clickable session tabs that navigate to /chat/:id

## Problems Encountered & Fixed

1. **pnpm build scripts blocked** — better-sqlite3/esbuild needed `pnpm.onlyBuiltDependencies` in root package.json
2. **pino-pretty not installed** — simplified logger to `{ level: 'info' }` only
3. **tsconfig project references (TS6306)** — dropped `references` arrays, rely on workspace resolution
4. **Port conflicts** — `lsof -ti:PORT | xargs kill -9` before starting
5. **macOS no `timeout` command** — used background process + sleep
6. **@types/ws missing** — `pnpm add -D @types/ws`
7. **React 19 Context shorthand fails TS** — used `Context.Provider` instead
8. **Framer Motion ease type** — `'easeOut' as const` for strict typing
9. **Chokidar glob matching** (Coder-3) — fixed glob patterns for JSONL file watching
10. **Path decoding** (Coder-3) — fixed encodeProjectPath in watcher bridge
11. **Empty command validation** (Coder-3) — reject empty strings in send-keys
12. **Polling fallback** (Coder-3) — status poller works when file watcher fails
13. **Chat layout overflow** (Coder-4) — sidebar stays fixed, chat scrolls independently
14. **Port change to 3002** (PM) — config.json overrides default, vite proxy updated

## Key Architecture Notes

- Server port **3002** (via config.json override), client dev port 5173
- Production: Fastify serves client dist via @fastify/static
- SQLite at `~/.jstudio-commander/commander.db` with WAL mode
- JSONL files at `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl`
- Project discovery scans `~/Desktop/Projects/` by default (configurable via config.json)
- WebSocket at `/ws` with channel subscriptions (rooms pattern)
- Status poller runs every 5s, detects agent status from tmux pane content
- File watcher uses chokidar with incremental byte-offset reads via `file_watch_state` table
- Token pricing from `@commander/shared` constants (opus/sonnet/haiku per 1M tokens)

## Notes for Next Coder

- **Kill port 3002 before starting server** — `lsof -ti:3002 | xargs kill -9`
- **Chat was redesigned 3 times** — current state is Coder-6's "2030 AI terminal" layout (no bubbles, flat timeline, StatusStrip, ContextBar). Don't reference UserBubble/AssistantBubble — they're deleted.
- **TopCommandBar is 364 lines** — it has session tabs, model selector, overflow dropdown. Heavy component.
- **SessionTerminalPreview** (263 lines) — embedded terminal inside chat page, added by PM
- **Vite proxy is on port 3002** — if server port changes, update `client/vite.config.ts` proxy target too
- **Google Fonts @import must stay at TOP of index.css** — before `@import "tailwindcss"`, or fonts won't load
- **Use subagents for file exploration** — reading too many files caused forced compaction in earlier phases
