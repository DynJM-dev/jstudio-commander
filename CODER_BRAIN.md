# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-14 — comprehensive update after 17 Coder-7 commits
> Coder: Coder-7 (Opus 4.6, 1M context)

## Current Status

**v1 COMPLETE + Coder-7 Post-v1 Polish (17 commits)**
- All 10 original phases delivered
- 5 post-v1 polish commits from Coders 3-6 + PM
- 17 Coder-7 commits: chat redesign, reliability fixes, terminal fallback, status detection, message grouping
- Server port: **3002** (config.json override)
- node-pty: **BROKEN** on this system (`posix_spawnp failed`) — terminal uses capture-pane fallback

## Git History

| Commit | Author | Description |
|--------|--------|-------------|
| `109b705` | Phase 1 | Scaffold monorepo, SQLite, Tailwind v4, dev servers |
| `f6361e4` | Phase 2 | tmux service, session CRUD, 7 REST endpoints |
| `c9f9bf9` | Phase 3 | JSONL parser, project scanner, token tracker, file watchers |
| `37e7fd1` | Phase 4 | WebSocket server, event bus, rooms, status poller |
| `3a9baaf` | Phase 5 | App shell, sidebar, mobile nav, routing, shared UI |
| `bbaf055` | Phase 6 | Session management UI: cards, create modal, real-time |
| `6b2c6e1` | Phase 7 | Chat bubbles, tool calls, code blocks, Shiki |
| `26eff2b` | Phase 8 | Project dashboard: cards, phase timeline, module map |
| `011d343` | Phase 9 | Terminal panel (xterm.js) + Analytics (Recharts) |
| `f894106` | Phase 10 | Cloudflare tunnel, PIN auth, production build |
| `e36d84f` | Coder-3 | Pipeline fixes: chokidar glob, path decoding, polling fallback |
| `3db42b5` | PM | Session tabs, terminal preview, model selector, port 3002 |
| `9f87287` | Coder-4 | Chat overflow fix, avatars, thinking animations |
| `eab3d3d` | Coder-5 | First chat redesign: flat timeline, no bubbles |
| `a1dd129` | Coder-6 | Final chat rebuild: UserMessage, AssistantMessage, StatusStrip, ContextBar |
| `e768815` | Coder-7 | State files audit, CSS @import fix (Google Fonts before Tailwind) |
| `6af9ae5` | Coder-7 | 6 chat fixes: spacing, StatusStrip auto-clear, varied status text, Crown icon, timeline dots |
| `bde70fd` | Coder-7 | Consolidate stats into ContextBar, remove StatusStrip/ResponseSummary, fix Enter key + duplicate keys |
| `6da7618` | Coder-7 | Move ContextBar above input, remove session info bar, fix text-renderer duplicate keys |
| `452059b` | Coder-7 | Permission prompt detection: PermissionPrompt component, usePromptDetection hook |
| `1117320` | Coder-7 | Redesign PermissionPrompt: full tool context display, plain text info above buttons |
| `347d0fe` | Coder-7 | Merge consecutive assistant messages (one header per turn) |
| `bb8989c` | Coder-7 | Reliability audit: stats polling, field mismatch fix, action detection, favicon, sent indicator |
| `a3e8dda` | Coder-7 | Adaptive polling (1.5s working / 5s idle), terminal hints for ContextBar |
| `2122f45` | Coder-7 | Rewrite agent-status heuristics: skip decorators, detect ❯ prompt, startup status cleanup |
| `d09534e` | Coder-7 | Terminal fallback (capture-pane -e 500ms polling), startup orphan recovery |
| `9c82b87` | Coder-7 | Message grouping: consecutive assistant messages → one visual block with one header |

## File Inventory

### packages/shared/src/
- `types/session.ts` — Session, SessionStatus, SessionEvent
- `types/chat.ts` — ChatMessage, ContentBlock, TokenUsage
- `types/project.ts` — Project, PhaseStatus, PhaseLog
- `types/terminal.ts` — TerminalSession, TerminalResize
- `types/analytics.ts` — TokenUsageEntry, CostEntry, DailyStats
- `types/ws-events.ts` — WSEvent (18 types), WSCommand (5 types)
- `constants/models.ts` — MODEL_PRICING per 1M tokens, DEFAULT_MODEL
- `constants/status.ts` — STATUS_COLORS, STATUS_LABELS

### server/src/
- `config.ts` — reads ~/.jstudio-commander/config.json for port/pin/projectDirs
- `index.ts` — Fastify entry + **startup recovery** (stale status cleanup, orphan tmux discovery, gone session marking)
- `db/connection.ts` — better-sqlite3 singleton, WAL mode
- `db/schema.sql` — 11 tables, 9 indexes
- `services/tmux.service.ts` — execFileSync wrapper for tmux CLI
- `services/session.service.ts` — CRUD + auto-slug + event logging
- `services/agent-status.service.ts` — **REWRITTEN**: skips decorator lines, searches ❯ prompt in tail, active indicators (Thinking/Nesting/Running/esc to interrupt), Claude Code process defaults to idle
- `services/terminal.service.ts` — **REWRITTEN**: tries child_process.spawn('tmux attach') first, falls back to capture-pane -e polling at 500ms. No node-pty dependency.
- `services/jsonl-parser.service.ts` — full record type handling
- `services/jsonl-discovery.service.ts` — encodeProjectPath, find session files
- `services/token-tracker.service.ts` — usage extraction, cost calc, aggregation (returns `{totalTokens, totalCost, byModel}`)
- `services/project-scanner.service.ts` — STATE.md/PM_HANDOFF.md parsing
- `services/file-watcher.service.ts` — chokidar, incremental byte-offset reads
- `services/status-poller.service.ts` — 5s interval, batch detect
- `services/watcher-bridge.ts` — connects file-watcher to eventBus
- `ws/` — event-bus, rooms, handler (/ws route), index (wires events to broadcasts)
- `routes/session.routes.ts` — 7 endpoints + /output with **enhanced prompt detection** (numbered choices via ❯ marker in last 10 lines, Allow/Deny, y/n, trust, tool context extraction)
- `routes/terminal.routes.ts` — **REWRITTEN**: WebSocket /ws/terminal/:sessionId, uses new terminal.service callback API
- `routes/chat.routes.ts` — paginated messages, stats
- `routes/project.routes.ts` — list, detail, scan, state, handoff
- `routes/analytics.routes.ts` — today, daily, sessions, projects

### client/src/ — Chat Components
- `components/chat/AssistantMessage.tsx` — accepts `messages: ChatMessage[]` (array), renders ONE header + all content blocks from all messages in the group
- `components/chat/ChatThread.tsx` — builds `MessageGroup[]` via useMemo, renders groups (not individual messages), one timeline dot per assistant group, dividers only between groups
- `components/chat/ContextBar.tsx` — unified bar above input: model, action status (JSONL-derived → terminal hint fallback), live tokens, cost, elapsed timer, context % bar (model-aware limits: 1M opus, 200K haiku)
- `components/chat/PermissionPrompt.tsx` — amber-tinted card for interactive prompts, shows full tool context as monospace text, action buttons + custom response input
- `components/chat/UserMessage.tsx` — Crown icon (#EAB308) + "JB" label, left-aligned with teal border
- `components/chat/ToolCallBlock.tsx` — collapsible tool calls, compact layout
- `components/chat/CodeBlock.tsx` — Shiki syntax highlighting (lazy), copy button
- `components/chat/ThinkingBlock.tsx` — collapsible thinking, brain-glow animation
- `components/chat/MessageMeta.tsx` — model pill + token count + timestamp
- `components/chat/SessionTerminalPreview.tsx` — embedded terminal for fresh sessions

### client/src/ — Chat Components DELETED
- `UserBubble.tsx`, `AssistantBubble.tsx` — replaced by UserMessage/AssistantMessage
- `StatusStrip.tsx` — merged into ContextBar
- `ResponseSummary.tsx` — removed (no inline token summaries)

### client/src/ — Hooks
- `hooks/useChat.ts` — **adaptive polling** (1.5s when working, 5s when idle), polls both messages + stats, accepts sessionStatus param
- `hooks/usePromptDetection.ts` — polls /output for interactive prompts + **terminal hints** (Cogitating/Delegating/Running/Searching/Writing/Working) for ContextBar fallback
- `hooks/useWebSocket.tsx` — React Context provider
- `hooks/useSessions.ts`, `hooks/useProjects.ts`, `hooks/useAnalytics.ts`, `hooks/useTerminal.ts`

### client/src/ — Pages
- `pages/ChatPage.tsx` — full chat: ChatThread + ContextBar (above input) + PermissionPrompt + input area with "Sent ✓" indicator, passes sessionStatus to useChat for adaptive polling
- `pages/SessionsPage.tsx`, `pages/ProjectsPage.tsx`, `pages/ProjectDetailPage.tsx`, `pages/TerminalPage.tsx`, `pages/AnalyticsPage.tsx`

### client/src/ — Other
- `layouts/` — Sidebar, TopCommandBar (364 lines), DashboardLayout, MobileNav, MobileOverflowDrawer
- `services/api.ts`, `services/ws.ts` — fetch wrapper, WebSocket singleton
- `utils/format.ts`, `utils/text-renderer.tsx` — formatting + lightweight markdown (unique key prefixes)
- `index.css` — Tailwind v4 @theme, glass utilities, timeline styles, chat-input, animations, prefers-reduced-motion
- `public/favicon.svg` — teal diamond SVG favicon

## Bugs Found & Fixed by Coder-7

1. **CSS @import order** — Google Fonts import must be before Tailwind @import
2. **StatusStrip stuck on "Thinking"** — no timeout/clear logic → merged into ContextBar entirely
3. **ContextBar not connected to real data** — hardcoded 200K context limit → model-aware limits
4. **Duplicate React key errors** — text-renderer used `t0`/`raw` keys that collided across lines → hierarchical prefixes
5. **Enter key not sending / first message not appearing** — `allMessages` logic hid local commands once JSONL existed → now appends pending local commands newer than last JSONL timestamp
6. **Stats field mismatch** — backend returns `{totalTokens, totalCost}`, frontend expected `{totalInputTokens, totalOutputTokens, totalCostUsd}` → fixed interface
7. **Stats never refreshed** — polling only fetched messages, not stats → polls both
8. **ContextBar action detection** — checked last message (user msg after send) → searches backwards for last assistant message
9. **ContextBar border direction** — borderBottom when positioned above input → borderTop
10. **Stale "working" status** — decorator lines (`────`) treated as content, Claude Code process defaulted to "working" → rewrite: skip decorators, detect ❯ in tail, default to idle
11. **node-pty posix_spawnp failed** — terminal service rewritten to use capture-pane -e polling fallback
12. **No favicon** — created teal diamond SVG
13. **Sonnet context limit** — was 200K, corrected to 1M (user edit)
14. **Session info bar redundant** — removed, TopCommandBar already shows session tabs

## Key Architecture Notes

- Server port **3002**, client dev port 5173 (Vite proxy to 3002)
- SQLite at `~/.jstudio-commander/commander.db` with WAL mode
- JSONL at `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl`
- `~/.claude/sessions/[PID].json` — static only (pid, sessionId, cwd), no live status
- WebSocket at `/ws` with channel subscriptions; terminal at `/ws/terminal/:sessionId`
- Adaptive polling: 1.5s when working, 5s when idle
- Terminal: capture-pane -e at 500ms (node-pty broken on this system)
- Startup recovery: checks all non-stopped sessions, marks gone as stopped, discovers orphaned jsc- tmux sessions

## Notes for Next Coder

- **Kill port 3002 first** — `lsof -ti:3002 | xargs kill -9`
- **node-pty is BROKEN** — `posix_spawnp failed`. Terminal uses capture-pane fallback. Don't try to fix node-pty.
- **AssistantMessage takes messages[] array** — NOT a single message. ChatThread groups consecutive assistant messages.
- **StatusStrip and ResponseSummary are DELETED** — all status info lives in ContextBar
- **ContextBar is ABOVE the input**, not above the chat area
- **Stats API returns `{totalTokens, totalCost, byModel}`** — NOT `totalInputTokens`/`totalOutputTokens`
- **Google Fonts @import must stay at TOP of index.css** — before `@import "tailwindcss"`
- **Sonnet context limit is 1M** (user corrected from 200K)
- **After every task: update CODER_BRAIN.md + send formal report via SendMessage**
