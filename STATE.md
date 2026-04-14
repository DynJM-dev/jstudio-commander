# JStudio Commander — State

## Current State
- Phase: Post-v1 Polish (Coder-7) — IN PROGRESS
- Last updated: 2026-04-14
- Blockers: node-pty broken (posix_spawnp) — using capture-pane fallback
- Server port: **3002** (config.json override)

## Phases
- [x] Phase 0: Planning & Architecture
- [x] Phase 1: Foundation & Scaffold — monorepo, SQLite, Tailwind v4, dev servers
- [x] Phase 2: Backend — tmux service, session CRUD, 7 REST endpoints
- [x] Phase 3: Backend — JSONL parser, project scanner, token tracker, file watchers
- [x] Phase 4: WebSocket & Real-time — event bus, rooms, status poller, watcher bridge
- [x] Phase 5: App Shell & Navigation — sidebar, top bar, mobile nav, routing
- [x] Phase 6: Session Management UI — cards, create modal, real-time updates
- [x] Phase 7: Chat Conversation View — bubbles, tool calls, code blocks, Shiki
- [x] Phase 8: Project Dashboard — cards, phase timeline, module map, STATE.md viewer
- [x] Phase 9: Terminal Panel & Token Analytics — xterm.js, Recharts dashboards
- [x] Phase 10: Cloudflare Tunnel, Polish & Delivery — tunnel, PIN auth, production build

## Post-v1 Polish (Coders 3-6 + PM)

- [x] **Coder-3** (`e36d84f`): Pipeline fixes — chokidar glob, path decoding, empty command, polling fallback
- [x] **PM** (`3db42b5`): Session tabs in TopCommandBar, terminal preview, model selector, port 3002
- [x] **Coder-4** (`9f87287`): Chat overflow fix, avatars, thinking animations
- [x] **Coder-5** (`eab3d3d`): First chat redesign — flat timeline, no bubbles
- [x] **Coder-6** (`a1dd129`): Final chat rebuild — UserMessage, AssistantMessage, StatusStrip, ContextBar

## Coder-7 Work (17 commits, 2026-04-14)

### Chat UI Overhaul
- [x] CSS @import fix — Google Fonts before Tailwind (`e768815`)
- [x] 6 chat fixes: spacing, StatusStrip auto-clear, Crown icon, timeline dots (`6af9ae5`)
- [x] Consolidate StatusStrip + ResponseSummary into ContextBar (`bde70fd`)
- [x] Move ContextBar above input, remove session info bar (`6da7618`)
- [x] Fix text-renderer duplicate React keys (`6da7618`)
- [x] Merge consecutive assistant messages — one header per turn (`347d0fe`)
- [x] Message grouping — consecutive assistant msgs → single visual block (`9c82b87`)

### Permission Prompt Detection
- [x] PermissionPrompt component + usePromptDetection hook (`452059b`)
- [x] Enhanced backend detection: numbered choices, Allow/Deny, y/n, trust (`452059b`)
- [x] Full tool context extraction from terminal output (`1117320`)

### Reliability & Performance
- [x] Stats field mismatch fix (totalTokens not totalInputTokens) (`bb8989c`)
- [x] Stats polling — now refreshes every poll cycle, not just on mount (`bb8989c`)
- [x] ContextBar action detection — searches backwards for last assistant msg (`bb8989c`)
- [x] Adaptive polling: 1.5s when working, 5s when idle (`a3e8dda`)
- [x] Terminal hints for ContextBar — shows action before JSONL catches up (`a3e8dda`)
- [x] Favicon — teal diamond SVG (`bb8989c`)
- [x] "Sent ✓" indicator below input (`bb8989c`)

### Server Fixes
- [x] Agent status detection rewrite — skip decorators, detect ❯ prompt in tail, defaults to idle (`2122f45`)
- [x] Startup status cleanup — correct stale working status on boot (`2122f45`)
- [x] Terminal service rewrite — capture-pane -e 500ms polling fallback (node-pty broken) (`d09534e`)
- [x] Startup orphan recovery — discover jsc- tmux sessions not in DB (`d09534e`)
- [x] Gone session cleanup — mark stopped if tmux session no longer exists (`d09534e`)

## Known Technical Debt
- node-pty broken on this system — terminal uses capture-pane polling (not as smooth)
- Ralph Loop engine deferred to v2
- Push notifications deferred to v2
- Voice input deferred to v2
- Agent Teams visualization deferred (research done, see CODER_BRAIN.md)

## Resolved Decisions
- Session naming: auto-slug + optional user rename
- Project discovery: ~/Desktop/Projects/ default + configurable
- Remote auth: 4-6 digit PIN for tunnel access
- Ports: server **3002**, client dev 5173
- Chat layout: flat timeline, message grouping, ContextBar above input
- Stats API: returns `{totalTokens, totalCost, byModel}` (not separate input/output)
- Status detection: tmux pane heuristics (no live data in ~/.claude/sessions/*.json)
- Terminal: capture-pane -e fallback at 500ms (node-pty posix_spawnp fails)
- Context limits: opus 1M, sonnet 1M, haiku 200K
