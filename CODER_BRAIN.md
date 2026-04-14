# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-14 — pre-compaction dump, 42 Coder-7 commits
> Coder: Coder-7 (Opus 4.6, 1M context)

## CRITICAL LESSONS

### tsx watch DOES NOT hot-reload server changes reliably
The server ran from 6:08 AM without reloading ANY code changes for 4+ hours. All server-side fixes (sendKeys, status detection, hook endpoint, terminal service) were NOT running despite tsx watch being active. **ALWAYS manually restart the server after ANY server-side code change:**
```bash
lsof -ti:3002 | xargs kill -9; cd server && npx tsx src/index.ts &>/tmp/jsc-server.log &
```

### Many "bugs" were actually "server not restarted"
- "sendKeys not delivering Enter" → fix was committed but not running
- "status stuck on working" → detection rewrite not loaded
- "messages not appearing" → polling dedup fix not active
- "hooks not firing" → hook endpoint not registered

## Current Status

**v1 COMPLETE + 42 Coder-7 commits**
- Server port: **3002** (config.json)
- node-pty: **BROKEN** (`posix_spawnp failed`) — terminal uses capture-pane -e 500ms polling
- Claude Code hooks: **CONFIGURED** in `~/.claude/settings.json` (PostToolUse, Stop)
- Hooks only work for sessions started AFTER hook configuration — existing sessions need restart

## Coder-7 Commits (42 total)

| Commit | Description |
|--------|-------------|
| `e768815` | State files audit, CSS @import fix |
| `6af9ae5` | 6 chat fixes: spacing, Crown icon, timeline dots, varied status text |
| `bde70fd` | Consolidate StatusStrip+ResponseSummary into ContextBar, fix Enter key |
| `6da7618` | Move ContextBar above input, remove session info bar, fix text-renderer keys |
| `452059b` | Permission prompt detection: PermissionPrompt + usePromptDetection hook |
| `1117320` | Redesign PermissionPrompt: full tool context display |
| `347d0fe` | Merge consecutive assistant messages (one header per turn) |
| `bb8989c` | Reliability audit: stats polling, field mismatch fix, favicon |
| `a3e8dda` | Adaptive polling (1.5s working / 5s idle), terminal hints |
| `2122f45` | Rewrite agent-status heuristics: skip decorators, detect ❯ in tail |
| `d09534e` | Terminal fallback (capture-pane -e 500ms), startup orphan recovery |
| `9c82b87` | Message grouping: consecutive assistant msgs → one visual block |
| `5490453` | First message appears immediately (before API call) + tool_result grouping |
| `cefdcde` | Plan card rendering + EMFILE file watcher crash fix (usePolling) |
| `19a9b0d` | Plan card auto-check with progress bar |
| `e6ba748` | Smoke test: stats always from JSONL, EMFILE fix (polling watcher) |
| `d6a5081` | ContextBar redesign: always-visible status, glow animation |
| `47895c4` | Accept-edits prompt detection + raw key endpoint (/api/sessions/:id/key) |
| `d204b11` | False positive prompts: only check last 3 lines, 5s dismiss debounce |
| `d24ed0d` | Bulletproof permission prompt: no duplicates, clean edge cases |
| `34527f6` | Remove accept_edits from prompt detection (it's a mode indicator, not prompt) |
| `e1998b5` | Claude Code hook endpoint (/api/hook-event) + specific file watching |
| `ebb6fd1` | Configure hooks in ~/.claude/settings.json (PostToolUse, Stop) |
| `86e2c64` | Filter chat messages by session creation time |
| `af052e9` | Session isolation via transcript_path from hooks |
| `5e45b4d` | Hide stopped sessions from Sessions page |
| `15c7205` | AgentPlan component with animated task tracking |
| `e980b30` | Message queued indicator when Claude is busy |
| `c637c85` | Effort level selector in ContextBar (CircleGauge icon + dropdown) |
| `7bda485` | Optimistic working status — instant "Processing..." on send |
| `99730bb` | Persist effort to ~/.claude/settings.json (later reverted to per-session) |
| `b269d9f` | Per-session effort level: DB column, PATCH handler, Session type |
| `4bc0ddf` | Effort command collision fix (await) + filter internal XML from chat |
| `2224e72` | Render interrupt messages as subtle inline dividers |
| `5463ee6` | New sessions inherit effort level from Claude settings |
| `0b4a7b3` | Numbered choice prompt (❯ 1.) detected as waiting, not idle |
| `453beb1` | sendKeys uses -l flag for literal text + separate Enter call |
| `c56e40d` | Polling dedup: ID set comparison (replaced next commit) |
| `1459423` | Simplified polling: count + last ID compare, server is source of truth |

## File Inventory

### server/src/ — Key Files
- `index.ts` — Fastify entry + startup recovery (stale status, orphan tmux, gone sessions)
- `config.ts` — reads ~/.jstudio-commander/config.json
- `db/connection.ts` — SQLite + migrations (transcript_path, effort_level columns)
- `db/schema.sql` — 11 tables + transcript_path + effort_level columns
- `services/tmux.service.ts` — sendKeys with `-l` literal + separate Enter, sendRawKey for Escape/Tab
- `services/session.service.ts` — CRUD, auto-slug, effortLevel from Claude settings on create
- `services/agent-status.service.ts` — hasIdlePromptInTail vs hasNumberedChoiceInTail, skip decorators
- `services/terminal.service.ts` — capture-pane -e 500ms polling fallback (node-pty broken)
- `services/file-watcher.service.ts` — chokidar (usePolling) + watchSpecificFile (fs.watch from hooks)
- `services/watcher-bridge.ts` — JSONL → chat events + token tracking
- `routes/session.routes.ts` — CRUD + /command + /key + /output (prompt detection: last 3 lines)
- `routes/chat.routes.ts` — messages + stats from transcript_path or findLatestSessionFile
- `routes/hook-event.routes.ts` — receives PostToolUse/Stop from Claude Code, stores transcript_path
- `routes/terminal.routes.ts` — WebSocket /ws/terminal/:sessionId
- `routes/system.routes.ts` — health, config (reads effortLevel from Claude settings)

### client/src/ — Key Files
- `components/chat/AssistantMessage.tsx` — accepts messages[] array, renders AgentPlan for TaskCreate/TaskUpdate
- `components/chat/ChatThread.tsx` — MessageGroup[] grouping, filters tool_result/XML/interrupt messages, SystemNote component
- `components/chat/ContextBar.tsx` — always-visible status, effort selector dropdown, optimistic userJustSent, bar-glow animation
- `components/chat/PermissionPrompt.tsx` — amber card for prompts, sendAction (command vs raw key)
- `components/chat/AgentPlan.tsx` — animated task list with status icons, expandable subtasks, progress bar
- `components/chat/UserMessage.tsx` — Crown icon + "JB"
- `hooks/useChat.ts` — adaptive polling (1.5s/5s), simplified dedup (count + last ID), accepts sessionStatus
- `hooks/usePromptDetection.ts` — prompt detection + terminal hints + messagesQueued + fast poll when userJustSent
- `pages/ChatPage.tsx` — optimistic userJustSent, queued indicator, interrupt via Escape
- `pages/SessionsPage.tsx` — active sessions only (stopped hidden)
- `utils/text-renderer.tsx` — AgentPlan for numbered lists, code blocks, inline formatting
- `public/favicon.svg` — teal diamond

### Deleted Files
- StatusStrip.tsx, ResponseSummary.tsx, UserBubble.tsx, AssistantBubble.tsx

### New Files (Coder-7)
- `components/chat/AgentPlan.tsx`, `components/chat/PermissionPrompt.tsx`
- `hooks/usePromptDetection.ts`
- `routes/hook-event.routes.ts`
- `hooks/commander-hook.sh` (in project root + ~/.claude/hooks/)
- `public/favicon.svg`

## Key Architecture

- **Polling chain:** useChat polls every 1.5s (working) or 5s (idle). Server reads JSONL file, returns messages. Frontend replaces if count or last ID differs.
- **Hook chain:** Claude Code → PostToolUse hook → curl POST /api/hook-event → watchSpecificFile(transcript_path) → fs.watch detects change → bridge reads new lines → WS broadcast
- **Status detection:** tmux capture-pane → skip decorators → check numbered choices (❯ N. = waiting) → check idle prompt (❯ alone = idle) → check active indicators (✻, Nesting, esc to interrupt = working) → default idle
- **Session isolation:** transcript_path column stores exact JSONL file path from hooks. Chat API uses it instead of scanning directory.
- **Effort level:** per-session in DB (effort_level column), selector in ContextBar sends /effort command + PATCH to session

## Bugs Found & Fixed (Major)

1. **Stats always 0** — watcher-bridge never called tokenTrackerService; stats endpoint now calculates from JSONL directly
2. **Stats field mismatch** — backend {totalTokens} vs frontend {totalInputTokens} → fixed interface
3. **Polling dedup blocked updates** — `length <= prev.length` skipped new messages → simplified to count + last ID
4. **Numbered choice = idle** — `❯ 1. Yes` matched as idle prompt → split into hasIdlePrompt vs hasNumberedChoice
5. **sendKeys missing Enter** — rapid commands caused tmux buffering → -l flag + separate Enter call
6. **EMFILE crash** — chokidar watched 826K files → usePolling + depth:1 + ignored patterns
7. **Old conversation in new session** — findLatestSessionFile loaded old JSONL → transcript_path isolation
8. **tsx watch unreliable** — server-side changes not hot-reloaded for hours → ALWAYS manually restart
9. **accept_edits false prompt** — ⏵⏵ is a mode indicator, not actionable → removed from detection
10. **Effort command collision** — /effort concatenated with next message → await before allowing next send
11. **Raw XML in chat** — <command-name> tags from /effort → filtered in ChatThread grouping
12. **First message not appearing** — local message created after API await → moved before API call

## Notes for Next Coder

- **RESTART SERVER after every server-side change** — `lsof -ti:3002 | xargs kill -9; cd server && npx tsx src/index.ts`
- **node-pty is BROKEN** — posix_spawnp failed. Don't try to fix it. Terminal uses capture-pane.
- **AssistantMessage takes messages[] array** — NOT single message
- **StatusStrip and ResponseSummary are DELETED** — all in ContextBar
- **Stats API returns {totalTokens, totalCost, byModel}** — NOT totalInputTokens
- **Hooks only fire for NEW Claude sessions** — existing sessions need restart to pick up settings.json changes
- **Sonnet context limit is 1M** (user corrected)
- **Session has effort_level column** — read via session.effortLevel, change via PATCH + /effort command
- **transcript_path column** — set by hooks, used by chat API for JSONL isolation
- **sendKeys uses -l flag** — literal text, then separate Enter call
