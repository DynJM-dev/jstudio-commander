# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-13 after Phase 5 completion
> Model: Opus 4.6 (1M context)

## Current Status

**Phase 5: App Shell & Dark Glassmorphism Navigation — COMPLETE**
- Commit: `3a9baaf` — `feat: add app shell with dark glassmorphism navigation and routing`
- All 5 phases (1-5) committed and verified
- Ready for Phase 6: Session Management UI

## Git History

| Commit | Phase | Description |
|--------|-------|-------------|
| `109b705` | Phase 1 | Scaffold monorepo, SQLite schema, Tailwind v4 dark theme, dev servers |
| `f6361e4` | Phase 2 | tmux service, session CRUD, agent status detection, 7 REST endpoints |
| `c9f9bf9` | Phase 3 | JSONL parser, project scanner, token tracker, file watchers, data routes |
| `37e7fd1` | Phase 4 | WebSocket server, event bus, rooms, status poller, watcher bridge |
| `3a9baaf` | Phase 5 | App shell, sidebar, mobile nav, routing, shared UI primitives |

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
- `config.ts` — DB at ~/.jstudio-commander/commander.db, port 3001, project dirs
- `db/connection.ts` — better-sqlite3 singleton, WAL mode, runs schema.sql
- `db/schema.sql` — 11 tables, 9 indexes
- `index.ts` — Fastify entry, all plugins, graceful shutdown
- `services/tmux.service.ts` — execFileSync wrapper for tmux CLI
- `services/session.service.ts` — CRUD + auto-slug (20 adj × 20 nouns) + event logging
- `services/agent-status.service.ts` — pane content heuristic detection
- `services/jsonl-parser.service.ts` — full record type handling, thinking blocks use `thinking` key
- `services/jsonl-discovery.service.ts` — encodeProjectPath, find session files
- `services/token-tracker.service.ts` — usage extraction, cost calc, aggregation
- `services/project-scanner.service.ts` — STATE.md/PM_HANDOFF.md parsing, 29 projects found
- `services/file-watcher.service.ts` — chokidar, incremental byte-offset reads
- `services/status-poller.service.ts` — 5s interval, batch detect, emit on change
- `services/watcher-bridge.ts` — connects file-watcher to eventBus
- `ws/event-bus.ts` — typed EventEmitter (max 50 listeners)
- `ws/rooms.ts` — channel-based Map<string, Set<WebSocket>>
- `ws/handler.ts` — /ws route, heartbeat 15s, ping/pong 30s timeout 10s
- `ws/index.ts` — wires eventBus events to room broadcasts
- `routes/session.routes.ts` — 7 endpoints (CRUD + command + status)
- `routes/system.routes.ts` — health, config
- `routes/chat.routes.ts` — paginated messages, stats
- `routes/project.routes.ts` — list, detail, scan, state, handoff
- `routes/analytics.routes.ts` — today, daily, sessions, projects

### client/src/
- `main.tsx` — createRoot, no StrictMode
- `App.tsx` — BrowserRouter, WebSocketProvider, React.lazy routing, AnimatePresence transitions
- `index.css` — Tailwind v4 @theme, glass utilities, pulse-slow, slideUp, font-mono-stats, tap feedback
- `services/api.ts` — fetch wrapper with ApiError, get/post/patch/del
- `services/ws.ts` — WebSocket singleton, auto-reconnect 1s→30s exponential backoff
- `hooks/useWebSocket.tsx` — React Context provider {connected, subscribe, unsubscribe, send, lastEvent}
- `components/shared/ErrorBoundary.tsx` — catch + fallback UI
- `components/shared/Logo.tsx` — teal diamond + JSC text, collapsed/expanded
- `components/shared/GlassCard.tsx` — glass-card wrapper with hover glow
- `components/shared/StatusBadge.tsx` — pulsing dot + color + label
- `components/shared/EmptyState.tsx` — icon + title + description + action
- `components/shared/LoadingSkeleton.tsx` — card/list/text/chart variants
- `layouts/Sidebar.tsx` — collapsible 64↔240px, 5 nav items, localStorage, tunnel status
- `layouts/TopCommandBar.tsx` — sticky 48px, session context, WS status
- `layouts/MobileNav.tsx` — fixed bottom 64px, 4 tabs + More, safe-area-inset
- `layouts/MobileOverflowDrawer.tsx` — slide-up glass, Analytics + Tunnel + stats
- `layouts/DashboardLayout.tsx` — Sidebar + TopCommandBar + MobileNav + Outlet, pb-24 lg:pb-6
- `pages/SessionsPage.tsx` — placeholder with EmptyState
- `pages/ChatPage.tsx` — placeholder with EmptyState
- `pages/ProjectsPage.tsx` — placeholder with EmptyState
- `pages/ProjectDetailPage.tsx` — placeholder with useParams :id
- `pages/TerminalPage.tsx` — placeholder with EmptyState
- `pages/AnalyticsPage.tsx` — placeholder with EmptyState

## Coding Patterns & Conventions

- `const M = 'Montserrat, sans-serif'` at top of every component, applied via `style={{ fontFamily: M }}`
- Colors via CSS variables: `var(--color-text-primary)`, `var(--color-accent)`, etc.
- Glass classes: `glass-surface`, `glass-nav`, `glass-card`, `glass-modal`
- No StrictMode (causes Supabase navigator.locks deadlock — though no Supabase here, following global rules)
- lucide-react ONLY icon library
- React Context + useState for state (no Redux/Zustand)
- Arrow functions for components
- TypeScript strict, no `any`
- Spanish UI text / English code — BUT this is a dev tool so UI is English
- `pb-24 lg:pb-6` for mobile nav clearance
- `hidden lg:flex` for desktop sidebar, `lg:hidden` for mobile nav
- WebSocket.Provider uses `.Provider` pattern (not React 19 shorthand — TS compatibility)
- Framer Motion `ease: 'easeOut' as const` to satisfy strict typing

## Problems Encountered & Fixed

1. **pnpm build scripts blocked** — better-sqlite3/esbuild needed `pnpm.onlyBuiltDependencies` in root package.json
2. **pino-pretty not installed** — simplified logger to `{ level: 'info' }` only
3. **tsconfig project references (TS6306)** — dropped `references` arrays, rely on workspace resolution
4. **Port 3001 in use** — `lsof -ti:3001 | xargs kill -9`
5. **Port 5173 occupied** — Vite auto-picks next available
6. **macOS no `timeout` command** — used background process + sleep
7. **@types/ws missing** — `pnpm add -D @types/ws`
8. **ws module not found in test** — installed as root dev dep
9. **React 19 Context shorthand fails TS** — used `Context.Provider` instead of `<Context value=...>`
10. **Framer Motion ease type** — `'easeOut' as const` for strict typing

## Remaining Phases

- **Phase 6**: Session Management UI — session cards, create/delete, real-time status, detail drawer
- **Phase 7**: Chat Conversation View — message rendering, thinking blocks, tool calls, streaming
- **Phase 8**: Project Dashboard — project cards, phase progress bars, STATE.md rendering
- **Phase 9**: Terminal Panel & Token Analytics — xterm.js, Recharts dashboards
- **Phase 10**: Cloudflare Tunnel, Polish & Delivery — tunnel management, PWA, final polish

## Key Architecture Notes

- Server port 3001, client dev port 5173, production: Fastify serves client dist via @fastify/static
- SQLite at `~/.jstudio-commander/commander.db` with WAL mode
- JSONL files at `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl`
- Project discovery scans `~/Desktop/Projects/` by default
- WebSocket at `/ws` with channel subscriptions (rooms pattern)
- Status poller runs every 5s, detects agent status from tmux pane content
- File watcher uses chokidar with incremental byte-offset reads via `file_watch_state` table
- Token pricing from `@commander/shared` constants (opus/sonnet/haiku per 1M tokens)
