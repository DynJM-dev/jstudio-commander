# JStudio Commander — State

## Current State
- Phase: Post-v1 Polish (Coder-7) — IN PROGRESS
- Last updated: 2026-04-14
- Blockers: node-pty broken (posix_spawnp), tsx watch unreliable for server changes
- Server port: **3002** (config.json override)

## Phases
- [x] Phase 0-10: v1 Complete (see PM_HANDOFF.md for details)

## Post-v1 Polish (Coders 3-6 + PM)
- [x] Coder-3: Pipeline fixes (chokidar, path decoding, polling fallback)
- [x] PM: Session tabs, terminal preview, model selector, port 3002
- [x] Coder-4: Chat overflow fix, avatars, animations
- [x] Coder-5: Flat timeline layout, no bubbles
- [x] Coder-6: UserMessage, AssistantMessage, StatusStrip, ContextBar rebuild

## Coder-7 Work (42 commits, 2026-04-14)

### Chat UI
- [x] CSS @import order fix
- [x] 6 initial chat fixes (spacing, Crown icon, timeline dots)
- [x] Consolidate StatusStrip + ResponseSummary into ContextBar
- [x] Move ContextBar above input, remove session info bar
- [x] Message grouping (consecutive assistant msgs → one block)
- [x] tool_result user messages folded into assistant groups
- [x] Internal XML command messages filtered (<command-name> etc.)
- [x] Interrupt messages rendered as subtle "— Interrupted —" dividers
- [x] First message appears immediately (before API call)
- [x] "Sent ✓" / "Queued — Claude is still working" indicator
- [x] Optimistic working status (instant "Processing..." on send)
- [x] Plan card rendering → AgentPlan component with animated tasks
- [x] Plan auto-check (✓/✅/~~done~~ detection + progress bar)
- [x] Text-renderer duplicate key fixes (hierarchical prefixes)

### ContextBar
- [x] Always-visible status (idle/waiting/working with colored dots)
- [x] Bar-glow animation when working (shadow-only, no opacity changes)
- [x] Effort level selector (CircleGauge icon + upward dropdown)
- [x] Per-session effort persistence (DB column + PATCH)
- [x] Terminal hints as action fallback (before JSONL catches up)
- [x] Message queued indicator ("(queued)" suffix)
- [x] Model context limits (1M opus/sonnet, 200K haiku)

### Permission Prompts
- [x] PermissionPrompt component (numbered choices, Allow/Deny, y/n, trust)
- [x] Raw key endpoint (/api/sessions/:id/key) for Enter/Escape
- [x] Full tool context extraction from terminal output
- [x] False positive fix (only check last 3 lines of pane)
- [x] 5-second dismiss debounce
- [x] accept_edits removed (mode indicator, not prompt)
- [x] Numbered choice ❯ 1. detected as waiting (not idle)

### Real-Time Pipeline
- [x] Claude Code hook endpoint (/api/hook-event)
- [x] Hook script (~/.claude/hooks/commander-hook.sh)
- [x] Hooks configured in ~/.claude/settings.json (PostToolUse, Stop)
- [x] Specific file watching (fs.watch on exact JSONL from hooks)
- [x] Adaptive polling (1.5s working / 5s idle)
- [x] Fast polling (1s) when userJustSent
- [x] Simplified polling dedup (count + last ID compare)
- [x] Watcher bridge records token usage

### Session Management
- [x] Session isolation via transcript_path from hooks
- [x] Startup recovery (stale status, orphan tmux, gone sessions)
- [x] Per-session effort_level column + migration
- [x] New sessions inherit effort from Claude settings
- [x] Hide stopped sessions from Sessions page
- [x] sendKeys with -l literal flag + separate Enter

### Server Fixes
- [x] Agent-status rewrite (skip decorators, split idle vs numbered choice)
- [x] Terminal service rewrite (capture-pane -e fallback, node-pty broken)
- [x] EMFILE fix (usePolling + depth:1 for project watcher)
- [x] Stats always from JSONL (not empty token_usage table)
- [x] Stats field mismatch fix (totalTokens not totalInputTokens)
- [x] Favicon (teal diamond SVG)

### Other
- [x] AgentPlan component (animated tasks, status icons, expandable subtasks)
- [x] Effort command collision fix (await before next send)

## Known Issues
- tsx watch does NOT hot-reload server changes reliably — MUST manually restart
- node-pty broken on this system — terminal uses capture-pane polling
- Hooks only fire for sessions started after hook configuration
- Claude Code reads settings.json hooks only on startup

## Resolved Decisions
- Chat layout: flat timeline, message grouping, ContextBar above input
- Stats: calculated from JSONL directly (not DB table)
- Status detection: tmux pane heuristics (no live data in ~/.claude/sessions/*.json)
- Terminal: capture-pane -e at 500ms (node-pty posix_spawnp fails)
- Session isolation: transcript_path from hooks, fallback to recent file discovery
- Effort: per-session DB column, not global settings
- Context limits: opus 1M, sonnet 1M, haiku 200K
- sendKeys: -l literal flag + separate Enter
