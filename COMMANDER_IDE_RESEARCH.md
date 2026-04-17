# Commander Research Brief — IDE Integration Patterns & Token Telemetry

> Research commissioned by Jose Bonilla for JStudio Commander. The goal: understand
> how IDEs (VS Code, Cursor, JetBrains, the Claude Desktop app, Emacs, and dozens of
> third-party dashboards) integrate with Claude Code — especially how they surface
> live context/token data — so Commander can become the best-in-class Claude Code
> terminal UI.
>
> **Author:** CTO (Claude.ai)
> **Date:** 2026-04-17
> **Audience:** PM + Commander coder
> **Source data:** Official Claude Code docs, community tooling (ccstatusline,
> ccusage, claude-control, claude-code-monitor, claude-mem, Oolab IDE bridge),
> and reverse-engineered session file formats.

---

## TL;DR (for the impatient)

Claude Code is an open platform. It exposes **eight integration surfaces** that
any external tool (like Commander) can tap into. In priority order for Commander:

1. **statusLine JSON-on-stdin** — the single richest real-time feed. One tick per
   message, every field you'd ever want: context_window, rate_limits, cost, model,
   worktree, session_id. This is how ccstatusline/ccusage build their magic.
2. **Lifecycle hooks** — 13 events (SessionStart, SessionEnd, PreCompact,
   PreToolUse, PostToolUse, Stop, SubagentStop, UserPromptSubmit, Notification,
   etc.) that fire throughout a session. Commander can register them once and
   observe every session system-wide without modifying individual sessions.
3. **JSONL transcripts** at `~/.claude/projects/<hash>/*.jsonl` — append-only
   event streams Commander can tail with chokidar (which you already use).
4. **MCP servers** — the protocol Claude Code uses to talk to IDEs. Commander
   can ship its own MCP server and become a first-class integration surface
   rather than just a wrapper.
5. **OAuth usage API** (`https://api.anthropic.com/api/oauth/usage`) — the
   endpoint VS Code and the CLI hit to get the authoritative 5-hour and 7-day
   rate limit numbers. Commander can call it too.
6. **~/.claude/history.jsonl** — global index of every prompt across every
   session. Commander's cross-project search goldmine.
7. **Custom slash commands** (`~/.claude/commands/`) — Commander can ship
   Commander-specific commands that every session picks up.
8. **tmux/terminal introspection** — process-tree walking to detect which
   terminal/tab is running which session. This is how claude-control maps
   sessions → tabs and enables one-click focus.

Commander already uses chokidar + WebSocket + SQLite — the ideal stack for
building this. The research below shows exactly what to plug into.

---

## Part 1 — The statusLine JSON Feed (Most Important)

### 1.1 What it is

Claude Code has a built-in `/statusLine` mechanism: you register a shell command
in `~/.claude/settings.json`, and Claude Code pipes a rich JSON object to that
command's stdin on every message tick (throttled to 300ms). Whatever the command
prints to stdout (first line only) becomes the bottom status bar.

**Why this matters for Commander:** This is the cleanest, most up-to-date data
feed available. It includes everything Commander needs to display token/context/rate
limit/cost info for *any* session, not just ones running inside Commander's tmux
control.

### 1.2 The full JSON schema (as of Claude Code 2.1.90+)

```json
{
  "hook_event_name": "Status",
  "session_id": "abc123-def456-...",
  "session_name": "my-session",
  "transcript_path": "/Users/josemiguelbonilla/.claude/projects/<hash>/<session>.jsonl",
  "cwd": "/Users/josemiguelbonilla/Desktop/Projects/jlp-family-office",
  "model": {
    "id": "claude-opus-4-7",
    "display_name": "Opus 4.7"
  },
  "workspace": {
    "current_dir": "/Users/...",
    "project_dir": "/Users/...",
    "added_dirs": [],
    "git_worktree": "feature-payments"
  },
  "version": "2.1.90",
  "output_style": { "name": "default" },
  "cost": {
    "total_cost_usd": 0.42,
    "total_duration_ms": 120000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15234,
    "total_output_tokens": 4521,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "rate_limits": {
    "five_hour": {
      "used_percentage": 38,
      "resets_at": "2026-04-17T16:30:00Z"
    },
    "seven_day": {
      "used_percentage": 87,
      "resets_at": "2026-04-24T09:15:00Z"
    }
  }
}
```

### 1.3 Critical fields for Commander

| Field | Use Case in Commander |
|-------|----------------------|
| `context_window.used_percentage` | **The number you asked about** — live context usage, pre-calculated by Claude Code. More accurate than parsing transcripts. |
| `context_window.context_window_size` | 200k for base, 1M for Opus 4.7 on Max/Team/Enterprise |
| `context_window.remaining_percentage` | Inverse — drives "compact now?" warning |
| `rate_limits.five_hour.used_percentage` | The Claude.ai subscription 5-hour window |
| `rate_limits.five_hour.resets_at` | Show countdown timer in Commander |
| `rate_limits.seven_day.used_percentage` | The weekly limit (shows as `7d: 87%`) |
| `model.id` | Surface in Commander's SessionCard (e.g., `claude-opus-4-7`) |
| `cost.total_cost_usd` | Session cost for budget tracking |
| `cost.total_lines_added/removed` | Velocity metric for the session |
| `workspace.git_worktree` | Critical for multi-worktree parallel workflows |
| `session_id` | Join key for Commander's SQLite tables |
| `transcript_path` | Path to the full JSONL transcript — chokidar watches this |
| `exceeds_200k_tokens` | Boolean — lets Commander show a ⚠️ badge |

### 1.4 Gotchas from the research

- **`current_usage` is null before the first API call** of a session. Use `// 0`
  fallback everywhere.
- **`used_percentage` uses input tokens only** — `input_tokens +
  cache_creation + cache_read`. Output tokens are NOT counted (because output
  generates, doesn't consume the window the same way).
- **`total_input_tokens` is cumulative across the session**, not current context
  size. Can exceed 200k on long sessions even though context is compacted.
  Always prefer `used_percentage` over manual math.
- **`rate_limits` only arrived in Claude Code v1.2.80**. Earlier versions omit
  the field entirely. Commander must handle absence gracefully.
- **Throttle is 300ms.** Don't expect more frequent updates than that.
- **Statusline scripts that hang block the display.** Keep anything Commander
  hooks in under 100ms.

### 1.5 How Commander can consume this

Two viable patterns:

**Pattern A — Commander ships a statusline script that forwards to Commander's websocket**

```bash
# ~/.claude/statusline-jsc.sh (installed by Commander on first run)
input=$(cat)
# Forward to Commander
curl -s -X POST "http://localhost:3002/api/session-tick" \
  -H "Content-Type: application/json" \
  --data "$input" > /dev/null &
# Also print the statusline (can be whatever user wants)
echo "$input" | jq -r '"\(.model.display_name) | \(.context_window.used_percentage)% | $\(.cost.total_cost_usd)"'
```

Pros: zero extra process, every user's Claude Code sessions feed Commander.
Cons: requires Commander to be running; statusline has to do double duty.

**Pattern B — Commander registers its OWN statusline and owns the display**

The `statusLine` config in settings.json can point to Commander's CLI, which
forwards to the WebSocket AND produces a polished status display.

```json
// ~/.claude/settings.json
{
  "statusLine": {
    "type": "command",
    "command": "jsc statusline",
    "padding": 0
  }
}
```

Pros: Commander fully owns the user experience. Cons: conflicts with any other
statusline tool the user has installed.

**Recommendation:** Start with Pattern A (optional forwarding). Pattern B as an
opt-in "Commander Enhanced Mode."

---

## Part 2 — Lifecycle Hooks (13 Events)

### 2.1 What they are

Hooks are commands registered in `~/.claude/settings.json` (global) or
`.claude/settings.json` (per-project) that Claude Code invokes at specific
lifecycle points. Each hook receives JSON on stdin describing the event.

### 2.2 The 13 events (current as of Claude Code 2.1.x)

| Event | When it fires | Commander use case |
|-------|---------------|-------------------|
| **SessionStart** | Session begins or resumes (`startup`/`resume`/`clear`/`compact` matcher) | Register session in Commander's SQLite. Inject CTO_STATE.md / PM_BRAIN.md context via `hookSpecificOutput.additionalContext`. |
| **SessionEnd** | Session terminates | Mark session complete. Trigger auto-capture: spawn cheap Sonnet to summarize the JSONL transcript into PM_BRAIN.md. |
| **Setup** | `init` (new repo) or `maintenance` (periodic) | Install project-specific hooks, verify env, run migrations. |
| **UserPromptSubmit** | Every user prompt | Log to observations DB. Inject additional context. Can block bad prompts with exit 2. |
| **PreToolUse** | Before any tool call | Gate destructive operations. Log tool calls for audit. |
| **PermissionRequest** | When Claude asks permission | Commander could auto-respond based on rules — careful here. |
| **PostToolUse** | After tool call succeeds | Run formatters, linters, tests. Log file changes to observations. |
| **PostToolUseFailure** | After tool call fails | Capture the failure + context; feed to CODER_BRAIN.md. |
| **SubagentStart** | A Task/Agent subagent spawns | Track teammate lifecycle in Commander's session tree. |
| **SubagentStop** | A subagent finishes | Close the teammate row in Commander. |
| **Notification** | Async notification (MCP server errors, context-low warnings) | Show in Commander's notification pane. |
| **Stop** | Claude finishes responding (turn complete) | Update session state to idle. Good time to refresh Commander. |
| **StopFailure** | Claude's response fails | Mark session errored in Commander. |
| **PreCompact** | Just before `/compact` runs | **Critical** — back up JSONL transcript, capture state snapshot before the compression loses detail. |
| **Elicitation** | MCP server asks for user input | Commander can surface the prompt in its UI. |
| **CwdChanged** | Working directory changes | Track project switches. Reload project context. |

### 2.3 Hook JSON payload (common fields)

Every hook receives these base fields plus event-specific ones:

```json
{
  "session_id": "abc123...",
  "transcript_path": "/Users/.../transcript.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "SessionStart",
  // event-specific fields (e.g., source, model, agent_type for SessionStart)
}
```

### 2.4 Hook output control

Hooks can return JSON to influence Claude's behavior:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "=== INJECTED BY COMMANDER ===\nCurrent project: JLP Family Office\nPhase: 7b\nLast coder: coder-11 (stood down 2 hrs ago)\n..."
  }
}
```

For SessionStart and UserPromptSubmit, **stdout IS injected as context to Claude**.
For other hooks, stdout is only shown in verbose mode; stderr with exit code 2
blocks the operation.

### 2.5 What Commander should hook — recommended minimum

**Global hooks (installed in `~/.claude/settings.json`):**

- `SessionStart` → Register session in Commander DB. Inject CTO_STATE + PM_BRAIN
  context for the current project (this replaces manual "read PM_BRAIN.md first").
- `SessionEnd` → Auto-capture: spawn Sonnet Agent that summarizes the session
  JSONL and appends observations to Commander's SQLite.
- `PreCompact` → Snapshot the JSONL to backup, capture pre-compact state.
- `SubagentStart`/`SubagentStop` → Track teammate tree.
- `Stop` → Mark session idle in Commander UI.

**Project hooks (per-project `.claude/settings.json`, Commander can auto-install):**

- `PostToolUse` with matcher `Edit|Write` → typecheck, lint, format.
- `UserPromptSubmit` → detect patterns like "tengo sed" / "migraña" / etc. and
  suggest break (Jose personal — opt-in).

### 2.6 Gotchas from research

- **Hooks MUST be fast (<1 second ideal)**. Slow hooks block Claude Code. The
  claude-mem pattern is key: **hook enqueues, background worker processes**.
  Use `(slow stuff) &>/dev/null &` idiom.
- **SessionStart additionalContext is now silent** (as of Claude Code 2.1.0
  ultrathink update). No visible "context loaded" message — Claude just gets
  the context silently. Don't display status messages from SessionStart.
- **Default timeouts** — command hooks default to 600s, prompt hooks 30s, agent
  hooks 60s. Always set explicit timeouts to document intent.
- **`$CLAUDE_PROJECT_DIR`** — env var set in every hook, points to project root.
  Use this, not `$PWD`.
- **`CLAUDE_ENV_FILE`** — for SessionStart and CwdChanged hooks, variables
  written here persist into the subsequent Bash session. Commander can use this
  to inject its own env vars.

---

## Part 3 — JSONL Transcript Format

### 3.1 Where they live

```
~/.claude/
├── history.jsonl                     # Global prompt index (every prompt, every project)
├── projects/
│   └── <hash-of-cwd>/                # One dir per project (hash of absolute path)
│       ├── sessions-index.json       # Metadata (summaries, msg counts, git branches)
│       └── <session-uuid>.jsonl      # Full transcript per session
├── debug/                             # Diagnostic logs
├── session-env/                       # Env var state
└── settings.json                      # Global config
```

### 3.2 JSONL transcript structure

Each line is a JSON object representing one event. Event types include:

- User messages (`type: "user"`)
- Assistant messages (`type: "assistant"`, which may contain multiple tool calls)
- Tool results (`type: "tool_result"`)
- System messages / summaries (`type: "system"`)
- Model changes (when `/model` is invoked)

Every line carries the same `sessionId` UUID and a `timestamp`. Session files are
**append-only** — messages are never rewritten, only added. This makes `fs.watch`
/ chokidar tailing safe and race-free.

### 3.3 Project hashing

The directory name under `~/.claude/projects/` is a hash of the project's
absolute path. Example: `/Users/josemiguelbonilla/Desktop/Projects/jlp-family-office`
→ hashes to something like `abc123def456`.

**For Commander:** to find transcripts for a project, hash the cwd the same way.
The exact algorithm isn't publicly documented but community tools have
reverse-engineered it (see `claude-code-log`, `claude-code-transcripts`,
`Claudex`).

Alternatively, **just scan every project dir and filter by the `cwd` field
inside the first few lines of each JSONL** — more robust than depending on
the hash function.

### 3.4 What Commander should read from transcripts

- **Session summaries** — in `sessions-index.json`, auto-generated summaries for
  each session. Surface these in Commander's session list.
- **Tool call history** — every Bash, Edit, Write, etc. is logged. Commander's
  "what did this coder do?" view reads this.
- **Thinking content** (when interleaved thinking is enabled) — appears as
  special blocks in the transcript.
- **Cost / token data** — each message block contains `usage` with the token
  breakdown. Commander can reconstruct per-message cost.
- **Session chains** — Sessions reference parent sessions via UUID when resumed
  or when subagents spawn. Commander can build a session tree view.

### 3.5 Key learning: the `/resume` mechanism

When a user runs `claude --resume`, Claude Code:
1. Hashes the current cwd
2. Lists all `.jsonl` files in `~/.claude/projects/<hash>/`
3. Sorts by modification time
4. Shows the picker
5. On selection, **replays the entire JSONL into the model's context**

Commander could replicate this selector as a fancy UI OR expose its own
"resume from any session, any project, with search" cross-project view.

---

## Part 4 — MCP Servers (The Real IDE Protocol)

### 4.1 What MCP is

The **Model Context Protocol** is an open standard (maintained by Anthropic)
for connecting AI models to external tools/data. It's what Claude Code uses
to talk to IDEs — and what Commander should use to become an IDE-class citizen.

**Key insight from research:** The VS Code extension's "magic" (diff viewing,
diagnostics sharing, file context) isn't proprietary — it's exposed via the
`mcp__ide__*` tool prefix. When Claude Code detects it's running inside VS
Code/Cursor/Windsurf, it auto-connects to the IDE's MCP server and exposes:

- `mcp__ide__getDiagnostics(uri)` — Pull LSP/language server errors
- `mcp__ide__executeCode(code, language)` — Run code in Jupyter kernel
- System reminders like `<system-reminder>The user opened the file X...</system-reminder>`

### 4.2 Transport options

MCP supports three transport types:

| Transport | Use case |
|-----------|----------|
| **stdio** | Local process, spawned by Claude Code. Fastest, simplest. |
| **HTTP / Streamable HTTP** | Remote MCP server. Production standard. Supports OAuth. |
| **SSE** | Deprecated. Don't use. |

### 4.3 How Commander can use MCP

**Option A: Commander exposes an MCP server** that Claude Code sessions connect to.

Example capabilities Commander could expose:

```typescript
// Commander's MCP tools (accessed from any Claude Code session as mcp__commander__*)

mcp__commander__get_project_state(project_path)
  → Returns current STATE.md, PM_BRAIN.md, CTO_STATE.md content

mcp__commander__search_memory(query, scope)
  → Progressive disclosure search across projects (like claude-mem)

mcp__commander__get_observations(project_path, limit)
  → Returns structured observations (the pattern from Part 15.4 of OPERATING_SYSTEM.md)

mcp__commander__spawn_teammate(project, role, prompt)
  → TeamCreate wrapper that registers in Commander's DB

mcp__commander__get_sibling_sessions(current_session_id)
  → What other sessions are active in this project right now?

mcp__commander__get_phase_reports(project, last_n)
  → Structured phase reports for course-correction briefs
```

This is how Commander goes from "tmux session orchestrator" to "first-class
IDE for multi-session Claude workflows."

**Option B: Commander MCP bridge for external tools** (like Oolab's
claude-ide-bridge). Less urgent — Option A is the real prize.

### 4.4 Registration

An MCP server is registered in Claude Code via:

```bash
# Local stdio server
claude mcp add --transport stdio commander "node" "/path/to/commander-mcp/index.js"

# Or HTTP server
claude mcp add --transport http commander "http://localhost:3002/mcp"
```

Or Commander can ship its own registration command (`jsc install`) that writes
to `~/.claude.json`.

### 4.5 Plugin bundling

Commander could also ship as a **Claude Code plugin** — a bundle that includes:

- Slash commands (`/jsc-status`, `/jsc-memory`, `/jsc-new-project`)
- MCP server
- Hooks (SessionStart/End auto-capture)
- Skills (or references to the JStudio skills)

Plugin manifest lives in `plugin.json` with optional `.mcp.json`:

```json
{
  "name": "jstudio-commander",
  "mcpServers": {
    "commander": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/commander-mcp"
    }
  },
  "hooks": { /* SessionStart, SessionEnd, etc. */ },
  "commands": [ /* slash commands */ ],
  "skills": [ /* references to jstudio-pm, etc. */ ]
}
```

This packages the whole JStudio operational surface into something any new
Claude Code user could `claude plugin install` and inherit.

---

## Part 5 — OAuth Usage API (Authoritative Rate Limits)

### 5.1 The endpoint

Claude Code calls `GET https://api.anthropic.com/api/oauth/usage` to get
the authoritative 5-hour and 7-day rate limit data for the logged-in account.

```
GET https://api.anthropic.com/api/oauth/usage
Headers:
  Authorization: Bearer <oauth-token>
  anthropic-beta: oauth-2025-04-20
  User-Agent: claude-code/<version>
  Accept: application/json

Response:
{
  "five_hour": {
    "utilization": 38.2,        // percent used
    "resets_at": "2026-04-17T16:30:00Z"
  },
  "seven_day": {
    "utilization": 87.0,
    "resets_at": "2026-04-24T09:15:00Z"
  }
}
```

### 5.2 Where the token is stored

macOS: **Keychain** under the name `Claude Code-credentials`:

```bash
security find-generic-password -s "Claude Code-credentials" -w
```

Returns JSON:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "...",
    "expiresAt": 1234567890,
    "scopes": ["..."],
    "subscriptionType": "pro"
  }
}
```

Linux/Windows have equivalent credential stores.

### 5.3 Why this matters for Commander

The statusline JSON already includes `rate_limits.five_hour` — so for
**interactive** Claude Code sessions, Commander gets this data for free.

But for **ambient monitoring** (e.g., Commander showing "you have 62% of your
5-hour budget left" even when no session is active), Commander can hit this
endpoint directly. Great for:

- Dashboard home — always show current limit status
- Warnings before spawning a teammate ("you're at 85% — are you sure?")
- Weekly burn charts in Commander's analytics page
- Multi-account support (if Jose has multiple Anthropic accounts)

### 5.4 Security

The OAuth token is sensitive. Commander should:

- Never log it
- Never display it in the UI
- Never transmit it off the machine (no analytics beacons)
- Use the keychain directly rather than caching it

---

## Part 6 — Multi-Session Process Detection

### 6.1 The problem

Jose runs multiple Claude Code sessions in parallel (PM + main coder + specialists
+ maybe JLP session + Commander session). Each lives in a different tmux pane
or terminal tab. Commander needs to know **which terminal hosts which session**.

### 6.2 How claude-control does it (reverse-engineered from the repo)

1. List all running `claude` processes via `ps`
2. For each PID, walk the process tree up to find the terminal emulator
3. Match the TTY (e.g., `/dev/ttys001`) to terminal tabs

Terminal-specific APIs:

| Terminal | Method | Capability |
|----------|--------|-----------|
| **iTerm2** | AppleScript + System Events | Tab-level focus, text input, keystroke send |
| **Terminal.app** | AppleScript, match by TTY path | Full control |
| **Ghostty** | AppleScript | Tab-level focus |
| **Kitty** | `kitten @` IPC (unix socket) | Window-level focus, text send |
| **WezTerm** | `wezterm cli` | Pane-level focus, text send |
| **tmux** | `tmux send-keys`, `tmux select-window` | Full control |

### 6.3 What Commander already does + what it should add

Commander runs on port 3002 and uses chokidar + WebSocket. From memory,
Commander already has multi-session awareness via TeamCreate → tmux.

**Additions from research:**

- **Ambient session detection** — watch `~/.claude/projects/` for new JSONL
  files appearing. Each new file = new session. Detect the cwd from the
  JSONL's first few lines. Surface in Commander even if user spawned it
  outside Commander (e.g., manually typed `claude` in a terminal).
- **Focus-to-tab button** — clicking a session in Commander should switch
  focus to the exact terminal tab running that session. claude-control has
  shown how; copy the pattern.
- **Process-tree walking** — when Commander detects a new session's JSONL,
  correlate with active `claude` processes to tag the session with its
  terminal.

---

## Part 7 — What Every Serious Dashboard Does (State of the Art)

Summary of the ~15 tools in the ecosystem, what they do, and what Commander
should steal/absorb.

### 7.1 ccstatusline (sirmalloc/ccstatusline)

- Widgets: model, context bar, 5h usage, 7d usage, block reset timer, token
  speed (input/output/total), git branch, git root, cwd, session name,
  account email, vim mode, thinking effort
- Powerline theme support
- 30+ configurable widgets in a single statusline
- **For Commander:** the widget catalog is a UX reference for what users
  want to see at a glance. Commander's SessionCard should display the
  top 6–8 of these.

### 7.2 ccusage (ccusage.com)

- Tracks per-session cost
- Today's total cost (daily aggregation)
- 5-hour billing block burn rate + projection
- Burn rate visual indicators 🔥
- Active model display
- Session-specific cost tracking
- Offline mode (calculates from session data without API calls)
- Exposes `bun x ccusage statusline` as a drop-in statusline command
- **For Commander:** the cost aggregation logic is worth borrowing.
  `--cost-source cc|ccusage|both` pattern is clever — Commander could show
  both Claude Code's stated cost and an independent calculation.

### 7.3 claude-mem (thedotmack, 58k stars)

Already analyzed in our prior conversation. Key patterns Commander should absorb:

- **Auto-capture on SessionEnd** — cheap Sonnet summarizer
- **Observations table** — structured facts with citations
- **Progressive disclosure search** — search → timeline → get
- **Background worker** — hooks enqueue, worker processes async (so hooks
  stay fast)
- **SQLite + Chroma vector DB** — Chroma optional for Commander; SQLite is
  already there

### 7.4 claude-control (sverrirsig/claude-control)

- Live status classification: Working / Idle / Waiting / Errored / Finished
  (uses hook events with CPU + JSONL heuristic fallback)
- Git integration: branch, changed files, +/- stats, open PR detection via `gh`
- **PR status badges** — CI rollup, review decision, unresolved threads,
  merge conflicts, merged/closed state
- **Task context** — extracts Linear issue titles from MCP tool results
- **Approve/reject from dashboard** — permission prompts answered without
  switching to terminal (this is HUGE — one of the most-requested features)
- Keyboard shortcuts: number keys to select, Tab cycle, A/X approve/reject,
  E/G/F/P for editor/git/finder/PR
- Multi-monitor support
- Worktree cleanup (removes worktree, branch, kills session in two-step confirm)
- **For Commander:** the status classification algorithm, PR badges, and
  remote permission approval are the killer features to steal.

### 7.5 claude-code-monitor (onikan27)

- Real-time dashboard
- Mobile web UI with QR code access
- Tailscale support for remote access
- Token auth on local network
- Server-side validation of shell commands (blocks dangerous ones)
- **For Commander:** the mobile + Tailscale integration is Jose's "remote VS
  Code from phone" ask from a previous conversation. Commander could adopt
  this directly.

### 7.6 Claude Desktop (official Anthropic)

- Parallel sessions with automatic git worktree isolation
- Drag-and-drop pane layout (chat, diff, preview, terminal, file, plan, tasks, subagent)
- Integrated terminal sharing Claude's working directory
- Side chats that branch off without affecting the main thread
- Remote sessions on Anthropic cloud (continue when laptop sleeps)
- Visual diff review before accepting
- PR monitoring with auto-fix + auto-merge toggles
- Auto-archive sessions when PR merges/closes
- **For Commander:** the pane layout model (draggable, resizable, closable
  with `Cmd+\`) is the UX standard to benchmark against. Commander's
  multi-tab teammate pane should follow this model.

### 7.7 claude-code-usage-bar (leeguooooo)

- Single-line compact statusline: `5h[███38%░░░░]⏰2h14m | 7d[███87%███░]⏰3d05h | Opus 4.6(90.0k/1.0M) | ᓚᘏᗢ Giga:working!`
- Color thresholds: green <30%, yellow <70%, red ≥70%
- Optional ASCII pet (playful)
- **For Commander:** the visual density of information in one line is
  impressive. Commander's SessionCard in mobile view should strive for
  this level of information compression.

### 7.8 Simon Willison's claude-code-transcripts

- Converts JSONL sessions to mobile-friendly paginated HTML
- Supports both local JSONL and web session extraction
- Gist upload via `gh`
- **For Commander:** the export-to-HTML pattern is useful for client reports
  (e.g., "here's what we shipped this phase" sent to Jose as a single HTML).

### 7.9 Claudex

- Web-based browser for Claude Code conversation history across projects
- Indexes codebase for full-text search
- Dashboard with high-level analytics
- Export options
- Completely local, no telemetry
- **For Commander:** this is essentially the "cross-project memory/knowledge
  page" from our prior plan. Validates the direction.

### 7.10 claude-esp (phiat)

- Go TUI that streams Claude Code's hidden output (thinking, tool calls,
  subagents) to a separate terminal
- Watch multiple sessions simultaneously
- Filter by content type
- Track background tasks
- **For Commander:** the "separate observer terminal" pattern. Commander
  already does this via its web UI, but a CLI `jsc tail` command that
  streams a specific session's activity to the terminal would complement.

### 7.11 claude-tmux (nielsgroeneveld)

- Manage Claude Code within tmux popup
- Quick session switching
- Status monitoring
- Session lifecycle management
- Git worktree + PR support
- **For Commander:** the tmux popup pattern is a lightweight alternative to
  the web UI for Jose's "hands-on-keyboard" moments.

---

## Part 8 — Commander Roadmap Recommendations

Translating the research into concrete features for Commander, prioritized.

### 8.1 Tier 1 — Must-Have (implement next)

These are the features that move Commander from "internal tool" to
"best-in-class Claude Code terminal UI."

#### F1. Statusline Forwarder → Real-Time Session Tick Feed

- Ship a `jsc statusline` binary Commander installs to `~/.claude/statusline-jsc.sh`
- Forward every tick (300ms) to Commander via WebSocket POST to `localhost:3002/api/session-tick`
- SessionCard in Commander UI updates live — context %, 5h usage, cost, model, worktree
- **Implementation:** ~200 lines of TypeScript. 1 day of work.
- **Why first:** directly answers Jose's question ("how do I see tokens left?").
  Zero conflicts with existing tools — user can keep their existing statusline
  display and Commander just observes.

#### F2. Global Hook Installation

- Commander auto-installs `SessionStart`, `SessionEnd`, `PreCompact`,
  `SubagentStart`, `SubagentStop`, `Stop` hooks to `~/.claude/settings.json`
- On install, Commander backs up existing settings.json and merges hook arrays
- Each hook enqueues an event to Commander's SQLite (fast!) and returns immediately
- Background worker processes enqueued events
- **Implementation:** ~400 lines. 2 days.
- **Why second:** lets Commander observe EVERY Claude Code session system-wide,
  not just ones spawned via Commander.

#### F3. JSONL Transcript Tailing

- Commander watches `~/.claude/projects/**/*.jsonl` with chokidar (already in stack!)
- New file → new session registered
- File grows → parse new lines, update session state (last message, tool calls, cost)
- **Implementation:** ~300 lines. 1.5 days.
- **Why critical:** catches sessions spawned outside Commander. Complete coverage.

#### F4. Session State Classifier (Working / Idle / Waiting / Errored / Finished)

- Based on hook events (Stop → Idle, PermissionRequest → Waiting, etc.)
- Fallback heuristics for pre-hook-installation sessions: CPU + JSONL growth rate
- SessionCard badge shows current state with color
- **Implementation:** ~200 lines. 1 day.
- **Why:** solves the "which session needs my attention?" problem directly.

#### F5. Context Low Warning

- When `context_window.used_percentage >= 85`, SessionCard shows ⚠️ badge + toast
  notification
- Auto-suggest `/compact` via a Commander button that sends the keystroke via tmux
- **Implementation:** ~100 lines. Half a day.
- **Why:** the "am I about to run out of context?" anxiety is the #1 pain point
  in the community.

### 8.2 Tier 2 — High Value (next sprint)

#### F6. Commander MCP Server

- Expose `mcp__commander__*` tools (get_project_state, search_memory,
  spawn_teammate, get_observations, etc.) — see [§4.3](#43-how-commander-can-use-mcp)
- Auto-register on first run via `claude mcp add`
- **Implementation:** ~800 lines + MCP SDK setup. 3–4 days.
- **Why:** this is how Commander becomes a platform, not just a UI. Every
  Claude Code session gets access to Commander's memory and orchestration
  capabilities.

#### F7. Remote Permission Approval

- PermissionRequest hook fires → Commander surfaces the prompt in the UI
- User clicks Approve/Reject → Commander sends keystrokes via tmux to the
  session's pane
- Works from mobile too (if Tailscale-connected per F12)
- **Implementation:** ~300 lines. 2 days.
- **Why:** this is what made claude-control famous. Massive UX win.

#### F8. Auto-Capture on SessionEnd (Memory Pattern)

- SessionEnd hook spawns a cheap Sonnet Agent
- Agent reads the JSONL, produces a ~500-token summary
- Summary appends to the project's PM_BRAIN.md (or CODER_BRAIN.md if it was a
  coder session)
- Structured observations also insert into SQLite `observations` table with
  type/summary/details/citations
- **Implementation:** ~500 lines. 2–3 days.
- **Why:** this is the claude-mem pattern we discussed. Biggest ROI for cross-
  session continuity.

#### F9. Cross-Project Memory Search Page

- Commander's new Memory tab
- Progressive disclosure: search query → list of sessions/observations →
  timeline for one session → full observation details
- FTS5 indexing on observations table (SQLite native)
- Filter by project, date, session type
- **Implementation:** ~700 lines (React + API). 3 days.
- **Why:** answers "what did I decide about X last month?" across all projects.

#### F10. Process-Tree → Terminal Tab Mapping

- Detect which tmux/iTerm/Terminal tab hosts each session
- Commander's "Focus Session" button switches the OS focus to that tab
- **Implementation:** ~400 lines (AppleScript + process tree walking). 2 days.
- **Why:** complements Commander's web UI. When Jose wants to type directly,
  one click takes him there.

### 8.3 Tier 3 — Nice-to-Have (post-Tier 1 & 2)

#### F11. Authoritative Rate Limit Panel

- Read OAuth token from Keychain
- Hit `api.anthropic.com/api/oauth/usage` every 60 seconds
- Dashboard shows 5h and 7d utilization + countdown + weekly burn chart
- **Implementation:** ~200 lines. 1 day.
- **Why:** gives Jose a "budget panel" independent of any specific session.

#### F12. Tailscale + Mobile Web UI

- Reuse the claude-code-monitor pattern
- QR code for local access, Tailscale for remote
- Token auth (already in Commander's stack)
- Mobile-optimized responsive UI (already have Tailwind v4)
- **Implementation:** ~500 lines + network config. 2–3 days.
- **Why:** enables Jose's "remote monitoring from padel/travel" use case.

#### F13. Commander Plugin Bundle

- Package Commander as a Claude Code plugin
- Includes: MCP server, slash commands (`/jsc-*`), hooks, skill references
- `claude plugin install jstudio-commander` works out of the box
- **Implementation:** mostly packaging. 2 days.
- **Why:** future-proofs Commander as a distributable product if Jose ever
  wants to open-source or commercialize.

#### F14. HTML Session Export

- Simon Willison pattern: convert JSONL to paginated HTML
- "Export this session" button on SessionCard
- Optional `gh gist create` for shareable URL
- **Implementation:** ~300 lines. 1.5 days.
- **Why:** client reports, audit trails, archived work.

#### F15. Token Speed / Burn Rate Widget

- Calculate input/output tokens per minute over a rolling 60s window
- Show in SessionCard as a mini sparkline
- Highlights when a session is cache-heavy (input_tokens high but
  cache_read_input_tokens much higher)
- **Implementation:** ~200 lines. 1 day.
- **Why:** helps detect runaway sessions early.
- **Status (Phase O, 2026-04-17):** partially covered. The top-right
  `HeaderStatsWidget` now surfaces CPU / memory / 5h / 7d budgets
  account-wide, which was the MVP slice of this feature. A per-session
  sparkline + rolling-60s tokens-per-minute is still open — revisit
  when session-card density work lands.

#### F16. PR Status Integration

- Watch for `gh pr view`-able PRs in session worktrees
- Show CI status (passing/failing/pending), review decision, conflicts
- **Implementation:** ~400 lines + `gh` shelling. 2 days.
- **Why:** closes the loop from code → PR → merge without leaving Commander.

#### F17. Approve Slack-Style Notifications

- Browser notification API for SessionEnd, blocking errors, compaction warnings
- Optional: Telegram webhook forwarding (some tools already do this)
- **Implementation:** ~200 lines. 1 day.
- **Why:** Jose doesn't need to stare at Commander — notifications bring him back.

### 8.4 Anti-Recommendations (what NOT to build)

- **Don't build tab completions.** That's Cursor's job. Commander is an
  orchestrator, not an editor.
- **Don't build your own LLM chat UI.** Claude Code's terminal UI is fine;
  Commander wraps it, doesn't replace it.
- **Don't duplicate the VS Code extension.** It exists and is good. If Jose
  wants in-IDE, he should use it. Commander's edge is multi-session
  orchestration.
- **Don't hard-fork a third-party tool.** The temptation to fork ccstatusline
  is real, but the API surface is stable — better to import/reference than
  fork-and-maintain.

---

## Part 9 — Token Detection: The Definitive Answer

Jose asked specifically about how tools detect tokens remaining. Here's the
full picture, ranked by accuracy and ease:

### 9.1 Most accurate: The statusline JSON `context_window.used_percentage`

This is pre-calculated by Claude Code itself, using the authoritative formula:

```
used_percentage = (input_tokens + cache_creation + cache_read) / context_window_size × 100
```

**Why it's the best:**
- Claude Code knows its own state
- Accounts for system prompt + tool definitions + MCP tools + CLAUDE.md (which
  manual calculations miss — a bug that affects ccstatusline and others)
- Available every 300ms via statusline tick
- Works for 200k AND 1M context windows (Opus 4.7 on Max)

**Caveat:** There's an open issue (#12510) noting that statusline's
`used_percentage` may still differ from `/context`'s output because they're
calculated at different moments. For Commander's purposes, `used_percentage`
is the right signal.

### 9.2 Manually parsing JSONL (what some tools do)

Some tools read `~/.claude/projects/<hash>/<session>.jsonl` and sum the usage
fields from assistant messages. This is LESS accurate because:

- System prompt tokens aren't in the JSONL
- MCP tool definitions aren't in the JSONL
- CLAUDE.md loaded tokens aren't fully tracked

If Commander ever needs to calculate from JSONL (e.g., for sessions that never
had the statusline hook installed), use the formula but add a disclaimer.

### 9.3 The OAuth /usage endpoint (for rate limits, not context)

This is for **5-hour billing block and 7-day subscription limits**, NOT
context window. Don't conflate the two:

- **Context window** = per-session; 200k or 1M tokens; filled by conversation
- **Rate limits** = per-account; 5-hour billing blocks + 7-day rolling window;
  filled by cumulative API calls across all sessions

Commander should show BOTH, clearly labeled. Community tools often blur them
and confuse users.

### 9.4 What `/context` and `/cost` show

These are interactive slash commands in Claude Code:

- `/context` — breakdown of where tokens are going: system prompt, tools,
  memory files, skills, conversation history
- `/cost` — total session cost in USD

Commander can't invoke these programmatically (they're interactive UI
commands), but can show equivalent information from the statusline JSON
(`cost.total_cost_usd`) and by parsing the JSONL.

### 9.5 The "compact threshold" signal

Claude Code has an `auto_compact_threshold_percent` (usually 80%) — when
context exceeds this, a compaction is triggered. **This field isn't in the
statusline JSON yet** (open issue #12510 requests it), but the 80% threshold
is a safe assumption.

Commander should:
- Green bar: 0–50%
- Yellow bar: 50–79%
- Orange bar: 80–89% ("compaction imminent")
- Red bar: 90%+ ("compact now or lose context")

### 9.6 The token-count formula for manual calculation

If Commander ever needs to calculate manually (e.g., pre-statusline sessions):

```typescript
function calculateContextPercent(sessionJsonl: string): number {
  const lines = sessionJsonl.split('\n').filter(Boolean)
  let totalInput = 0
  let totalCacheCreate = 0
  let totalCacheRead = 0
  for (const line of lines) {
    const event = JSON.parse(line)
    if (event.type === 'assistant' && event.message?.usage) {
      const u = event.message.usage
      totalInput += u.input_tokens ?? 0
      totalCacheCreate += u.cache_creation_input_tokens ?? 0
      totalCacheRead += u.cache_read_input_tokens ?? 0
    }
  }
  const windowSize = 200_000  // or 1_000_000 for Opus 4.7 on Max
  return ((totalInput + totalCacheCreate + totalCacheRead) / windowSize) * 100
}
```

Note: this is the **cumulative** calculation, not current context size after
compactions. For display, prefer `used_percentage` from statusline.

---

## Part 10 — Prioritized Next 3 Weeks for Commander

Based on the above, here's a concrete 3-sprint plan Commander's PM can execute.

### Sprint 1 (Week 1): Real-Time Session Telemetry

- F1: Statusline forwarder → WebSocket
- F3: JSONL transcript tailing
- F4: Session state classifier
- F5: Context low warning

**Outcome:** Commander's SessionCard shows live token %, 5h usage, cost, state
for every session, updating every 300ms.

### Sprint 2 (Week 2): Hook Install + Memory Pattern

- F2: Global hook installation (SessionStart/End/PreCompact/SubagentStart/Stop)
- F8: Auto-capture on SessionEnd (Sonnet summarizer → PM_BRAIN.md + observations)
- F11: Authoritative rate limit panel

**Outcome:** Every session system-wide feeds Commander's memory. Rate limit
budget dashboard exists.

### Sprint 3 (Week 3): MCP Server + Remote Approval

- F6: Commander MCP server (exposes `mcp__commander__*` tools to every session)
- F7: Remote permission approval (Approve/Reject from Commander UI)
- F9: Cross-project memory search page

**Outcome:** Commander becomes a platform. Every Claude Code session on Jose's
machine can query Commander's memory, and Jose can approve permissions from
his laptop, phone, or iPad.

Post-3-weeks, pick from Tier 3 based on what Jose's workflow needs most.

---

## Appendix A — Key URLs for PM to Study

**Official Anthropic docs:**
- Statusline reference: https://code.claude.com/docs/en/statusline
- Hooks reference: https://code.claude.com/docs/en/hooks
- MCP integration: https://code.claude.com/docs/en/mcp
- VS Code extension: https://code.claude.com/docs/en/vs-code
- Claude Desktop: https://code.claude.com/docs/en/desktop

**Reference implementations to study:**
- ccstatusline (widget catalog): https://github.com/sirmalloc/ccstatusline
- ccusage (cost tracking): https://ccusage.com/guide/statusline
- claude-control (status detection, PR integration, remote approval):
  https://github.com/sverrirsig/claude-control
- claude-code-monitor (mobile + Tailscale):
  https://github.com/onikan27/claude-code-monitor
- claude-mem (memory pattern): https://github.com/thedotmack/claude-mem
- claude-ide-bridge (MCP bridge example):
  https://github.com/Oolab-labs/claude-ide-bridge
- claude-code-hooks-mastery (all 13 hooks reference):
  https://github.com/disler/claude-code-hooks-mastery
- awesome-claude-code (the whole ecosystem):
  https://github.com/hesreallyhim/awesome-claude-code

**Community write-ups:**
- Simon Willison on transcripts: https://github.com/simonw/claude-code-transcripts
- ksred on dashboard building:
  https://www.ksred.com/managing-multiple-claude-code-sessions-building-a-real-time-dashboard/
- codelynx on OAuth usage API reverse-engineering:
  https://codelynx.dev/posts/claude-code-usage-limits-statusline
- DanDoesCode on statusline: https://www.dandoescode.com/blog/claude-code-custom-statusline

---

## Appendix B — Commander's Unique Advantages

What Commander has that no other tool has:

1. **JStudio-specific context** — knows about PM_HANDOFF, STATE.md, CTO_STATE,
   coder-brain, phase-protocol. Can inject project-specific context automatically.
2. **Multi-project awareness** — most tools are single-project. Commander sees
   all JStudio projects simultaneously.
3. **Jose-specific preferences** — Montserrat, glass system, Opus 4.7 defaults,
   effort routing matrix. Already baked in.
4. **Spanish + DR market awareness** — useful when surfacing client-facing
   content (e.g., "exported report in Spanish").
5. **Integrated with the skill ecosystem** — 12 JStudio skills + ui-ux-pro-max.
   Can suggest the right skill for the task.
6. **Own stack (Fastify/React/SQLite)** — no dependency on external dashboards.
   Jose owns the roadmap, no upstream breaking changes.

Commander should lean into these. Don't try to beat ccstatusline at being
ccstatusline — be the tool that understands JStudio's entire operational
surface and orchestrates it.

---

## Appendix C — Open Questions for Jose

Before PM starts implementing, these decisions from Jose would lock in the
architecture:

1. **Is global hook installation OK?** Commander writing to `~/.claude/settings.json`
   affects every Claude Code session on the machine — including ones unrelated
   to JStudio. Alternative: only install per-project (`.claude/settings.json`)
   for JStudio projects. Tradeoff: less coverage, but zero pollution.

2. **MCP server transport: stdio or HTTP?** stdio spawns a child per session
   (isolated), HTTP runs one Commander server all share (already matches
   Commander's port 3002). HTTP is cleaner for your architecture.

3. **Memory storage location:** Commander's SQLite (already at port 3002's
   data dir) or per-project `.jsc/memory.db`? Centralized is faster to query
   across projects; per-project is cleaner for git ignore and portability.

4. **Tailscale support:** is this actually needed, or is local-network + QR
   code enough? (Jose's earlier research indicated Tailscale was the preferred
   remote-access path — confirm still true.)

5. **Hook ownership:** if Jose already has other tools writing to
   `~/.claude/settings.json` hooks (ccstatusline, ccusage, etc.), Commander
   should merge hook arrays rather than overwrite. PM to verify during install.

6. **Plugin packaging (F13):** is this a now-priority or a later-priority?
   Packaging Commander as a Claude Code plugin is ~2 days of work but would
   make it distributable. Only worth it if there's a business reason.

---

**End of research brief.**

> When PM is ready to implement, start with Sprint 1 (F1–F5). Those five
> features alone would make Commander the best Claude Code terminal UI
> that exists today — and they build the foundation for everything else.
