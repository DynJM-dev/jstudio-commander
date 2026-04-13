# JStudio Commander — PM Handoff Document

## 1. Project Overview

| Field | Value |
|-------|-------|
| **Project Name** | JStudio Commander |
| **Type** | Business Analytics Dashboard / Custom Dev Tool |
| **Client** | Internal — JStudio (Jose Miguel Bonilla) |
| **Purpose** | Web-based command center replacing Codeman for managing Claude Code agent sessions, projects, and development studio |
| **Tier** | Standalone (NOT in monorepo) |
| **UI Language** | English (developer tool) |
| **Target Users** | Single user (Jose) — local + remote via phone |
| **Deployment** | Local machine + Cloudflare Quick Tunnel for remote |
| **Stack** | React 19 + Vite 7 + TypeScript + Tailwind v4 (frontend) / Fastify + Node.js + WebSocket (backend) / SQLite (persistence) |
| **Terminal** | xterm.js embedded panels |
| **Location** | `~/Desktop/Projects/jstudio-commander` |
| **GitHub** | TBD |

### What It Replaces

Codeman (`~/.codeman/`) — a CLI + Fastify web server that wraps Claude Code sessions in tmux. JStudio Commander inherits the core concept but upgrades:
- Raw terminal output → **clean chat UI** with parsed JSONL conversations
- JSON flat-file state → **SQLite** with proper schema
- Basic session list → **project dashboard** with phase progress from STATE.md/PM_HANDOFF.md
- Same ephemeral Cloudflare tunnels, but with a premium glassmorphism UI
- Full mobile responsive — usable from phone

### What It Does NOT Replace (v1)

- Ralph Loop engine (autonomous agent driver) — v2
- Respawn controller (auto-restart stalled agents) — v2
- Orchestrator/plan execution — v2
- Web Push notifications — v2
- Voice input — v2

---

## 2. Architecture

### Monorepo Structure (pnpm workspaces)

```
jstudio-commander/
├── package.json              # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.base.json        # Shared TS config
├── PM_HANDOFF.md
├── STATE.md
├── CLAUDE.md
│
├── packages/
│   └── shared/               # Shared types between client & server
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── types/
│           │   ├── session.ts        # Session, SessionStatus
│           │   ├── chat.ts           # ChatMessage, ToolCall, ContentBlock
│           │   ├── project.ts        # Project, PhaseStatus, ModuleMap
│           │   ├── terminal.ts       # TerminalSession, TerminalResize
│           │   ├── analytics.ts      # TokenUsage, CostEntry, DailyStats
│           │   └── ws-events.ts      # WebSocket event types (discriminated union)
│           └── constants/
│               ├── models.ts         # Model IDs, pricing per token
│               └── status.ts         # Session status enums
│
├── server/                   # Fastify backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # Server entry — Fastify + WebSocket + graceful shutdown
│       ├── config.ts                 # Env vars, paths, ports
│       ├── db/
│       │   ├── schema.sql            # Full SQLite DDL
│       │   ├── connection.ts         # better-sqlite3 singleton
│       │   └── migrations/           # Versioned migrations
│       ├── services/
│       │   ├── tmux.service.ts       # tmux CLI wrapper (list, create, kill, send-keys, capture-pane)
│       │   ├── session.service.ts    # Session CRUD + status tracking (SQLite)
│       │   ├── jsonl-parser.service.ts   # JSONL → ChatMessage[] transformer
│       │   ├── project-scanner.service.ts # Finds projects, reads STATE.md/PM_HANDOFF.md
│       │   ├── file-watcher.service.ts   # chokidar watchers on JSONL dirs + STATE.md files
│       │   ├── terminal.service.ts   # node-pty for xterm.js WebSocket bridge
│       │   ├── token-tracker.service.ts  # Parses usage from JSONL, calculates costs
│       │   ├── tunnel.service.ts     # Cloudflare Quick Tunnel spawner
│       │   └── agent-status.service.ts   # Detects working/idle/waiting from tmux pane content
│       ├── routes/
│       │   ├── session.routes.ts     # /api/sessions — CRUD + control
│       │   ├── chat.routes.ts        # /api/chat/:sessionId — conversation messages
│       │   ├── project.routes.ts     # /api/projects — dashboard data
│       │   ├── terminal.routes.ts    # /api/terminal — pty session management
│       │   ├── analytics.routes.ts   # /api/analytics — token/cost data
│       │   ├── tunnel.routes.ts      # /api/tunnel — start/stop/status
│       │   └── system.routes.ts      # /api/system — health, version, config
│       └── ws/
│           ├── handler.ts            # WebSocket upgrade + room routing
│           ├── rooms.ts              # Room manager: sessions, terminal, filewatcher
│           └── events.ts             # Event emitter bridge → WebSocket broadcast
│
├── client/                   # React SPA
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx                  # App entry (NO StrictMode)
│       ├── App.tsx                   # Router + layout wrapper
│       ├── index.css                 # Tailwind v4 @theme block + glass classes
│       ├── fonts/                    # Montserrat WOFF2 self-hosted
│       ├── hooks/
│       │   ├── useWebSocket.ts       # WebSocket connection + reconnect
│       │   ├── useSessions.ts        # Session list + real-time updates
│       │   ├── useChat.ts            # Chat messages for a session
│       │   ├── useProjects.ts        # Project dashboard data
│       │   ├── useTerminal.ts        # xterm.js terminal bridge
│       │   └── useAnalytics.ts       # Token/cost data
│       ├── services/
│       │   ├── api.ts                # Fetch wrapper for REST endpoints
│       │   └── ws.ts                 # WebSocket client singleton
│       ├── layouts/
│       │   ├── DashboardLayout.tsx   # Glass sidebar + main content + mobile nav
│       │   └── MobileNav.tsx         # Bottom tab bar (mobile)
│       ├── pages/
│       │   ├── SessionsPage.tsx      # Session management grid
│       │   ├── ChatPage.tsx          # Conversation view for a session
│       │   ├── ProjectsPage.tsx      # Project dashboard
│       │   ├── ProjectDetailPage.tsx # Single project deep dive
│       │   ├── TerminalPage.tsx      # xterm.js terminal panel
│       │   └── AnalyticsPage.tsx     # Token/cost analytics
│       ├── components/
│       │   ├── sessions/
│       │   │   ├── SessionCard.tsx       # Glass card with status indicator
│       │   │   ├── SessionActions.tsx    # Kill, restart, send command
│       │   │   ├── CreateSessionModal.tsx
│       │   │   └── CommandInput.tsx      # Send text to tmux session
│       │   ├── chat/
│       │   │   ├── ChatThread.tsx        # Full conversation thread
│       │   │   ├── UserBubble.tsx        # Right-aligned user message
│       │   │   ├── AssistantBubble.tsx   # Left-aligned assistant message
│       │   │   ├── ToolCallBlock.tsx     # Collapsible tool invocation
│       │   │   ├── CodeBlock.tsx         # Syntax-highlighted + copy button
│       │   │   ├── ThinkingBlock.tsx     # Collapsible thinking indicator
│       │   │   └── MessageMeta.tsx       # Timestamp, model, tokens
│       │   ├── projects/
│       │   │   ├── ProjectCard.tsx       # Glass card with phase progress
│       │   │   ├── PhaseTimeline.tsx     # Visual phase progress bar
│       │   │   ├── ModuleMap.tsx         # Module grid from PM_HANDOFF
│       │   │   └── StateViewer.tsx       # Rendered STATE.md
│       │   ├── terminal/
│       │   │   ├── TerminalPanel.tsx     # xterm.js container
│       │   │   └── TerminalTabs.tsx      # Multi-session terminal tabs
│       │   ├── analytics/
│       │   │   ├── TokenCard.tsx         # Stat card for token usage
│       │   │   ├── CostChart.tsx         # Recharts daily cost line
│       │   │   ├── ModelBreakdown.tsx    # Cost by model pie/bar
│       │   │   └── SessionCostTable.tsx  # Per-session cost table
│       │   └── shared/
│       │       ├── GlassCard.tsx         # Reusable glass surface
│       │       ├── StatusBadge.tsx       # working/idle/waiting indicator
│       │       ├── EmptyState.tsx        # Themed empty state
│       │       ├── LoadingSkeleton.tsx   # Pulse skeleton
│       │       └── ErrorBoundary.tsx     # Fallback UI
│       └── utils/
│           ├── format.ts             # Number, date, duration formatters
│           ├── cost.ts               # Token → USD calculation
│           └── markdown.ts           # Markdown renderer for STATE.md
```

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (React)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Sessions  │  │   Chat   │  │ Projects │  ...      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │             │                  │
│       └──────────┬───┘─────────────┘                  │
│            REST + WebSocket                           │
└─────────────────┬─────────────────────────────────────┘
                  │
┌─────────────────┴─────────────────────────────────────┐
│                   SERVER (Fastify)                      │
│                                                        │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ tmux.service  │  │ jsonl-parser│  │ file-watcher │ │
│  │  (child_proc) │  │  (fs.read)  │  │  (chokidar)  │ │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘ │
│         │                 │                 │          │
│  ┌──────┴─────────────────┴─────────────────┴───────┐ │
│  │              WebSocket Event Bus                   │ │
│  └──────────────────────┬────────────────────────────┘ │
│                         │                              │
│  ┌──────────────────────┴────────────────────────────┐ │
│  │                    SQLite                          │ │
│  │  sessions | projects | token_usage | cost_entries  │ │
│  └───────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
                  │
    ┌─────────────┴──────────────┐
    │     SYSTEM RESOURCES        │
    │  • tmux sessions            │
    │  • ~/.claude/projects/*.jsonl│
    │  • ~/Desktop/Projects/*/    │
    │  •   STATE.md, PM_HANDOFF.md│
    │  • cloudflared binary       │
    └────────────────────────────┘
```

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Database** | SQLite via `better-sqlite3` | Local-only app, no need for Supabase. Synchronous API is simpler. Single file backup. |
| **Backend framework** | Fastify | Fast, TypeScript-native, built-in WebSocket support via `@fastify/websocket` |
| **WebSocket** | `@fastify/websocket` + `ws` | Real-time updates for sessions, chat, file changes, terminal |
| **Terminal** | `node-pty` + `xterm.js` | Industry standard for web terminal embedding. node-pty spawns real PTY, xterm.js renders it. |
| **File watching** | `chokidar` | Watches JSONL files, STATE.md, PM_HANDOFF.md for changes → push via WebSocket |
| **JSONL parsing** | Custom streaming parser | Claude Code JSONL format is specific — needs custom parser that understands all record types |
| **Markdown rendering** | `react-markdown` + `remark-gfm` | For rendering STATE.md and PM_HANDOFF.md in project dashboard |
| **Syntax highlighting** | `shiki` (lazy loaded) | Modern, VSCode-quality highlighting for code blocks in chat view |
| **Tunnel** | `cloudflared` child process | Same ephemeral Quick Tunnel approach as Codeman — no persistent config needed |
| **Cost calculation** | Hardcoded model pricing table | Prices from Anthropic pricing page, updated manually. Calculated from JSONL `usage` fields. |
| **State management** | React Context + useState | Per CLAUDE.md rules — no Redux/Zustand |

---

## 3. SQLite Schema

### Core Tables (v1)

```sql
-- ============================================================
-- JStudio Commander — SQLite Schema v1
-- ============================================================

-- Sessions: tracks tmux-backed Claude Code sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- UUID
  name TEXT NOT NULL,                     -- Human-readable name
  tmux_session TEXT NOT NULL UNIQUE,      -- tmux session name (e.g., "commander-abc123")
  project_path TEXT,                      -- Absolute path to project directory
  claude_session_id TEXT,                 -- Claude Code session UUID (from JSONL)
  status TEXT NOT NULL DEFAULT 'idle',    -- 'idle' | 'working' | 'waiting' | 'stopped' | 'error'
  model TEXT DEFAULT 'claude-opus-4-6',   -- Active model
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT,                        -- When session was killed/stopped
  -- v2 future columns
  station_id TEXT,                        -- Links to pixel-art station (v2)
  agent_role TEXT                         -- 'pm' | 'coder' | 'specialist' (v2 gamification)
);

-- Projects: discovered from filesystem, enriched with parsed STATE.md
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,                    -- UUID
  name TEXT NOT NULL,                     -- Project name (from directory or STATE.md)
  path TEXT NOT NULL UNIQUE,              -- Absolute path to project root
  has_state_md INTEGER NOT NULL DEFAULT 0,
  has_handoff_md INTEGER NOT NULL DEFAULT 0,
  current_phase TEXT,                     -- e.g., "Phase 3: First Feature Module"
  current_phase_status TEXT,              -- 'in_progress' | 'complete' | 'blocked'
  total_phases INTEGER DEFAULT 0,
  completed_phases INTEGER DEFAULT 0,
  last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- v2 future columns
  station_x INTEGER,                      -- Pixel-art station position (v2)
  station_y INTEGER,
  station_sprite TEXT                     -- Sprite sheet reference (v2)
);

-- Token usage: per-message token data parsed from JSONL
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  message_id TEXT,                        -- Claude API message ID (msg_01...)
  request_id TEXT,                        -- requestId from JSONL
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,     -- Calculated cost
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  -- v2 future columns
  phase_id TEXT,                          -- Link to phase for per-phase cost (v2)
  skill_name TEXT                         -- Which skill was active (v2)
);

-- Cost entries: daily aggregated costs
CREATE TABLE IF NOT EXISTS cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                     -- YYYY-MM-DD
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  message_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, session_id, model)
);

-- Session events: lifecycle log (append-only)
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event TEXT NOT NULL,                    -- 'created' | 'started' | 'stopped' | 'killed' | 'command_sent' | 'error'
  detail TEXT,                            -- JSON payload with event-specific data
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- File watch state: tracks last-read position for incremental JSONL parsing
CREATE TABLE IF NOT EXISTS file_watch_state (
  file_path TEXT PRIMARY KEY,
  last_byte_offset INTEGER NOT NULL DEFAULT 0,
  last_line_count INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE
);

-- v2 placeholder tables (created now for schema stability, not populated in v1)

-- Agent relationships: PM → coder → subagent graph (v2)
CREATE TABLE IF NOT EXISTS agent_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,             -- 'spawned' | 'delegated' | 'team_member'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  UNIQUE(parent_session_id, child_session_id)
);

-- Phase logs: detailed per-phase tracking (v2)
CREATE TABLE IF NOT EXISTS phase_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  phase_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'complete' | 'blocked'
  started_at TEXT,
  completed_at TEXT,
  duration_minutes INTEGER,
  files_created INTEGER DEFAULT 0,
  files_modified INTEGER DEFAULT 0,
  migrations_run INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  notes TEXT,                             -- JSON
  UNIQUE(project_id, phase_number)
);

-- Skill usage stats (v2)
CREATE TABLE IF NOT EXISTS skill_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  skill_name TEXT NOT NULL,               -- '/pm', '/db-architect', '/ui-expert', etc.
  invoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  tokens_used INTEGER DEFAULT 0
);

-- Notifications (v2 — webhook/push)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                     -- 'phase_complete' | 'error' | 'blocked' | 'idle'
  title TEXT NOT NULL,
  body TEXT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  read INTEGER NOT NULL DEFAULT 0,
  sent_push INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_project ON token_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_cost_entries_date ON cost_entries(date);
CREATE INDEX IF NOT EXISTS idx_cost_entries_project ON cost_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_timestamp ON session_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_phase_logs_project ON phase_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
```

### Model Pricing Table (Constants — not in DB)

```typescript
// packages/shared/src/constants/models.ts
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
  'claude-opus-4-6':       { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-6':     { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
  'claude-haiku-4-5':      { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheCreation: 1.00 },
  // Legacy models (may appear in older JSONL files)
  'claude-opus-4-5-20251101': { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-5-20241022': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
};
// All prices are per 1M tokens
```

---

## 4. JSONL Parser Design

The parser is the most critical backend service. It transforms Claude Code's JSONL conversation logs into structured chat messages.

### Record Type → Chat Message Mapping

| JSONL Record Type | Parser Action |
|-------------------|---------------|
| `permission-mode` | Store session metadata (permission mode). Skip from chat. |
| `file-history-snapshot` | Skip from chat (internal bookkeeping). |
| `user` (string content) | → `ChatMessage { role: 'user', content: text }` |
| `user` (tool_result content) | → Attach as tool result to the preceding assistant tool_use |
| `assistant` (text content) | → `ChatMessage { role: 'assistant', content: text }` |
| `assistant` (thinking content) | → `ThinkingBlock` nested in the assistant message (collapsible) |
| `assistant` (tool_use content) | → `ToolCallBlock` nested in the assistant message (collapsible) |
| `attachment` | Skip most. Show `skill_listing` and `edited_text_file` as system notes. |
| `system` | Skip from chat (telemetry). Extract `turn_duration` for performance stats. |
| `queue-operation` | Skip from chat. |

### Chat Message Shape

```typescript
interface ChatMessage {
  id: string;                    // uuid from JSONL record
  parentId: string | null;       // parentUuid — for thread reconstruction
  role: 'user' | 'assistant' | 'system';
  timestamp: string;             // ISO 8601
  content: ContentBlock[];
  model?: string;                // From assistant message
  usage?: TokenUsage;            // From assistant message.usage
  sessionSlug?: string;          // Human-readable session name
  isSidechain: boolean;          // true = subagent message
  agentId?: string;              // If from a subagent
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'system_note'; text: string };
```

### Incremental Parsing Strategy

1. On first load: parse entire JSONL file, store `file_watch_state.last_byte_offset`
2. On file change (chokidar): read only new bytes from `last_byte_offset`, parse new lines, emit via WebSocket
3. Group records by `message.id` (assistant) or `uuid` (user) to reconstruct full turns
4. Filter `isMeta: true` records — these are harness bookkeeping, not user-visible

---

## 5. WebSocket Event Protocol

All real-time communication uses a single WebSocket connection with typed events.

```typescript
// packages/shared/src/types/ws-events.ts

type WSEvent =
  // Session events
  | { type: 'session:created'; session: Session }
  | { type: 'session:updated'; session: Session }
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:status'; sessionId: string; status: SessionStatus }
  // Chat events (real-time message streaming)
  | { type: 'chat:message'; sessionId: string; message: ChatMessage }
  | { type: 'chat:messages'; sessionId: string; messages: ChatMessage[] }  // Batch on connect
  // Project events
  | { type: 'project:updated'; project: Project }
  | { type: 'project:scanned'; projects: Project[] }
  // Terminal events
  | { type: 'terminal:data'; sessionId: string; data: string }    // PTY output
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  // Analytics events
  | { type: 'analytics:token'; entry: TokenUsage }
  | { type: 'analytics:daily'; stats: DailyStats }
  // Tunnel events
  | { type: 'tunnel:started'; url: string }
  | { type: 'tunnel:stopped' }
  | { type: 'tunnel:error'; error: string }
  // System events
  | { type: 'system:error'; error: string }
  | { type: 'system:heartbeat'; timestamp: string };

// Client → Server commands
type WSCommand =
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'session:command'; sessionId: string; command: string }
  | { type: 'subscribe'; channels: string[] }    // e.g., ['session:abc', 'chat:abc']
  | { type: 'unsubscribe'; channels: string[] };
```

---

## 6. Design System — Dark Glassmorphism

### Theme Tokens (`@theme` block in `index.css`)

```css
@theme {
  /* === Base Palette === */
  --color-bg-deep:        #0A0E14;     /* Deepest background */
  --color-bg-base:        #0F1419;     /* Main background */
  --color-bg-surface:     #151B23;     /* Card/panel surfaces */
  --color-bg-elevated:    #1A2230;     /* Elevated elements */

  /* === Glass Surfaces === */
  --color-glass-light:    rgba(255, 255, 255, 0.04);
  --color-glass-medium:   rgba(255, 255, 255, 0.07);
  --color-glass-strong:   rgba(255, 255, 255, 0.10);
  --color-glass-border:   rgba(255, 255, 255, 0.08);

  /* === Accent — Teal/Green (JStudio Commander) === */
  --color-accent:         #0E7C7B;     /* Primary accent */
  --color-accent-light:   #12A5A4;     /* Hover/active states */
  --color-accent-dark:    #0A5C5B;     /* Pressed states */
  --color-accent-glow:    rgba(14, 124, 123, 0.20);  /* Glow effects */
  --color-accent-subtle:  rgba(14, 124, 123, 0.10);  /* Subtle backgrounds */

  /* === Status Colors === */
  --color-working:        #22C55E;     /* Green — session actively working */
  --color-idle:           #F59E0B;     /* Amber — session idle */
  --color-waiting:        #3B82F6;     /* Blue — waiting for input */
  --color-error:          #EF4444;     /* Red — error state */
  --color-stopped:        #6B7280;     /* Gray — stopped/dead */

  /* === Text === */
  --color-text-primary:   #E6EDF3;     /* Primary text */
  --color-text-secondary: #8B949E;     /* Secondary/muted text */
  --color-text-tertiary:  #484F58;     /* Disabled/hint text */
  --color-text-accent:    #12A5A4;     /* Accent text */

  /* === Spacing, Radius, Shadows === */
  --radius-sm:  8px;
  --radius-md:  12px;
  --radius-lg:  16px;
  --radius-xl:  24px;

  --shadow-glass: 0 4px 24px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-glow:  0 0 20px var(--color-accent-glow);

  --blur-glass:   blur(24px) saturate(180%);
}
```

### Glass Utility Classes (in `index.css`)

```css
.glass-surface {
  background: var(--color-glass-medium);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-glass);
}

.glass-nav {
  background: rgba(15, 20, 25, 0.85);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border-right: 1px solid var(--color-glass-border);
}

.glass-card {
  background: var(--color-glass-light);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-glass);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.glass-card:hover {
  border-color: var(--color-accent-glow);
  box-shadow: var(--shadow-glass), var(--shadow-glow);
}

.glass-modal {
  background: rgba(15, 20, 25, 0.92);
  backdrop-filter: blur(32px) saturate(200%);
  -webkit-backdrop-filter: blur(32px) saturate(200%);
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-xl);
}
```

### Typography

- Font: Montserrat (self-hosted WOFF2)
- Applied via `style={{ fontFamily: M }}` where `const M = 'Montserrat, sans-serif'`
- Weights: 400 body, 500 labels/nav, 600 headings, 700 stats/numbers, 800 badges
- Code: `JetBrains Mono` or system monospace for terminal + code blocks

### Status Indicators

Each session card shows a pulsing dot with status color:
- **Working** (green, pulsing): Agent is actively generating output
- **Idle** (amber, steady): Session exists but no activity
- **Waiting** (blue, slow pulse): Agent is waiting for user input
- **Error** (red, steady): Session encountered an error
- **Stopped** (gray, no animation): Session terminated

---

## 7. Module Map

| Module | Priority | Description |
|--------|----------|-------------|
| **Session Management** | P0 | Create, kill, list, control tmux sessions running Claude Code |
| **Chat Conversation View** | P0 | Parse JSONL → chat thread with tool calls, code blocks, thinking |
| **Project Dashboard** | P0 | Read STATE.md/PM_HANDOFF.md → phase progress, module map |
| **Terminal Panel** | P1 | xterm.js embedded terminal attached to tmux sessions |
| **Token & Cost Tracking** | P1 | Parse JSONL usage → per-session/project costs, daily charts |
| **Real-time Updates** | P1 | File watchers + WebSocket push for live status |
| **Agent Status Detection** | P1 | Read tmux pane content to determine working/idle/waiting |
| **Cloudflare Tunnel** | P1 | Ephemeral Quick Tunnel for remote mobile access |
| **Gamified View** | P2 (v2) | Pixel-art station map with animated agent characters |
| **Historical Analytics** | P2 (v2) | Timelines, phase durations, cost-per-phase, skill usage |
| **Agent Graph** | P2 (v2) | Live PM → coder → subagent relationship visualization |
| **Push Notifications** | P2 (v2) | Webhook/push to phone on events |
| **Voice Input** | P2 (v2) | Voice commands to agents |

---

## 8. Phase Plan

### Phase 1: Foundation & Scaffold
**Goal:** Set up the monorepo, install all dependencies, create the SQLite schema, configure Tailwind v4 dark theme, and verify both dev servers run.

**Files to create:**
- `package.json` — Root workspace config
- `pnpm-workspace.yaml` — Workspace definition
- `tsconfig.base.json` — Shared TypeScript config
- `packages/shared/package.json` + `tsconfig.json` + `src/index.ts`
- `packages/shared/src/types/session.ts`, `chat.ts`, `project.ts`, `terminal.ts`, `analytics.ts`, `ws-events.ts`
- `packages/shared/src/constants/models.ts`, `status.ts`
- `server/package.json` + `tsconfig.json` + `src/index.ts` + `src/config.ts`
- `server/src/db/schema.sql` + `connection.ts`
- `client/package.json` + `tsconfig.json` + `vite.config.ts` + `index.html`
- `client/src/main.tsx` + `App.tsx` + `index.css` (with full @theme block + glass classes)
- `client/src/fonts/` — Montserrat WOFF2
- `.gitignore`

**Dependencies:**
- Root: `typescript`, `pnpm`
- Server: `fastify`, `@fastify/websocket`, `@fastify/cors`, `@fastify/static`, `better-sqlite3`, `chokidar`, `node-pty`, `uuid`
- Client: `react`, `react-dom`, `react-router-dom`, `framer-motion`, `lucide-react`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `react-markdown`, `remark-gfm`, `shiki`
- Shared: (types only — no runtime deps)

**Verification:**
- [ ] `pnpm install` succeeds
- [ ] `pnpm --filter server dev` starts Fastify on port 3001
- [ ] `pnpm --filter client dev` starts Vite on port 5173
- [ ] SQLite database file is created at `~/.jstudio-commander/commander.db`
- [ ] Visiting `localhost:5173` shows a dark-themed shell with "JStudio Commander" text

---

### Phase 2: Backend Services — tmux & Sessions
**Goal:** Build the core backend services for tmux session management and the session CRUD API.

**Files to create/modify:**
- `server/src/services/tmux.service.ts` — Wrapper around tmux CLI (list-sessions, new-session, kill-session, send-keys, capture-pane)
- `server/src/services/session.service.ts` — Session CRUD in SQLite, maps to tmux sessions
- `server/src/services/agent-status.service.ts` — Captures tmux pane output, detects status (working/idle/waiting) by regex patterns
- `server/src/routes/session.routes.ts` — REST endpoints: GET /api/sessions, POST /api/sessions, DELETE /api/sessions/:id, POST /api/sessions/:id/command, GET /api/sessions/:id/status
- `server/src/routes/system.routes.ts` — GET /api/system/health

**tmux naming convention:** `jsc-{shortId}` (e.g., `jsc-a1b2c3d4`)

**Agent status detection heuristics:**
- Working: tmux pane last line contains spinner characters, or output is actively growing (new bytes in last 2s)
- Waiting: pane content contains `>` prompt at last line with no recent output
- Idle: session exists but no Claude Code process running in pane
- Error: pane content contains error stack trace patterns

**Verification:**
- [ ] `POST /api/sessions` creates a tmux session and returns session object
- [ ] `GET /api/sessions` lists all sessions with status
- [ ] `POST /api/sessions/:id/command` sends text to the tmux pane
- [ ] `DELETE /api/sessions/:id` kills the tmux session
- [ ] `GET /api/sessions/:id/status` returns working/idle/waiting

---

### Phase 3: Backend Services — JSONL Parser & File Watchers
**Goal:** Build the JSONL parser that transforms Claude Code conversation logs into structured chat messages, and the file watcher service.

**Files to create/modify:**
- `server/src/services/jsonl-parser.service.ts` — Full JSONL parser implementing the mapping from Section 4
- `server/src/services/file-watcher.service.ts` — chokidar watchers on `~/.claude/projects/` and project directories
- `server/src/services/token-tracker.service.ts` — Extracts usage from parsed JSONL assistant messages, calculates costs
- `server/src/services/project-scanner.service.ts` — Scans `~/Desktop/Projects/` for projects with STATE.md/PM_HANDOFF.md
- `server/src/routes/chat.routes.ts` — GET /api/chat/:sessionId (returns ChatMessage[])
- `server/src/routes/project.routes.ts` — GET /api/projects, GET /api/projects/:id
- `server/src/routes/analytics.routes.ts` — GET /api/analytics/tokens, GET /api/analytics/costs

**JSONL file discovery:** Map session's `project_path` → encoded path in `~/.claude/projects/` → find latest `.jsonl` file by modification time

**STATE.md parser:** Extract with regex:
- `Phase: N Name — STATUS` → current phase
- `- [x] Phase N: Name` → completed phases count
- `- [ ] Phase N: Name` → remaining phases count

**Verification:**
- [ ] Parser correctly handles all JSONL record types (user, assistant, attachment, system)
- [ ] Tool calls are properly paired (tool_use → tool_result)
- [ ] Token usage is extracted and cost calculated
- [ ] File watcher detects new JSONL lines appended
- [ ] Project scanner finds projects and parses STATE.md

---

### Phase 4: WebSocket Server & Real-time Engine
**Goal:** Set up the WebSocket server with subscription-based channels, connect file watchers to WebSocket broadcast, and implement the heartbeat.

**Files to create/modify:**
- `server/src/ws/handler.ts` — WebSocket upgrade handler, authentication (optional in v1)
- `server/src/ws/rooms.ts` — Room/channel manager: clients subscribe to `session:{id}`, `chat:{id}`, `projects`, `analytics`
- `server/src/ws/events.ts` — EventEmitter bridge: services emit events → rooms broadcast to subscribers
- `server/src/index.ts` — Wire up WebSocket to Fastify, connect services to event bus

**Event flow:**
1. File watcher detects JSONL change → JSONL parser processes new lines → emits `chat:message` events
2. Agent status poller (5s interval) → captures tmux panes → emits `session:status` events
3. Project scanner (30s interval) → re-reads STATE.md files → emits `project:updated` events
4. Heartbeat every 15s to keep connections alive through Cloudflare

**Verification:**
- [ ] WebSocket connects from browser dev tools
- [ ] Subscribe to `chat:{sessionId}` → receive new messages when JSONL changes
- [ ] Subscribe to `sessions` → receive status updates every 5s
- [ ] Heartbeat keeps connection alive
- [ ] Multiple clients receive the same broadcasts

---

### Phase 5: App Shell & Navigation
**Goal:** Build the DashboardLayout with glass sidebar, mobile bottom tab bar, page routing, and Framer Motion transitions.

**Files to create:**
- `client/src/layouts/DashboardLayout.tsx` — Glass sidebar (desktop) + main content area
- `client/src/layouts/MobileNav.tsx` — Bottom tab bar with 5 tabs (Sessions, Chat, Projects, Terminal, Analytics)
- `client/src/components/shared/GlassCard.tsx` — Reusable glass surface component
- `client/src/components/shared/StatusBadge.tsx` — Pulsing status dot
- `client/src/components/shared/EmptyState.tsx` — Themed empty state
- `client/src/components/shared/LoadingSkeleton.tsx` — Pulse skeleton
- `client/src/components/shared/ErrorBoundary.tsx` — Fallback UI
- `client/src/hooks/useWebSocket.ts` — WebSocket connection with auto-reconnect
- `client/src/services/api.ts` — Fetch wrapper
- `client/src/services/ws.ts` — WebSocket client singleton
- `client/src/App.tsx` — Update with routes and layout

**Navigation items:**
1. Sessions (Monitor icon) — `/sessions`
2. Chat (MessageSquare icon) — `/chat`
3. Projects (FolderKanban icon) — `/projects`
4. Terminal (Terminal icon) — `/terminal`
5. Analytics (BarChart3 icon) — `/analytics`

**Sidebar:** Fixed left, 240px wide, `glass-nav`, JStudio Commander logo at top, nav items with active indicator (accent border-left), collapse to icons on tablet.

**Mobile:** Sidebar hidden, bottom tab bar with icons + labels, `pb-24` on pages for clearance.

**Page transitions:** Framer Motion `AnimatePresence` with fade + slight Y translate.

**Verification:**
- [ ] Sidebar renders with all 5 nav items on desktop
- [ ] Bottom tab bar shows on mobile (< 768px)
- [ ] Route transitions animate smoothly
- [ ] Glass surfaces render with blur and borders
- [ ] WebSocket connects on app mount and auto-reconnects

---

### Phase 6: Session Management UI
**Goal:** Build the session management page — session cards with real-time status, create/kill actions, and command input.

**Files to create:**
- `client/src/pages/SessionsPage.tsx` — Session grid layout
- `client/src/hooks/useSessions.ts` — Fetches sessions, subscribes to WebSocket updates
- `client/src/components/sessions/SessionCard.tsx` — Glass card: name, status dot, model, project path, uptime, token count
- `client/src/components/sessions/SessionActions.tsx` — Kill, restart buttons + command input
- `client/src/components/sessions/CreateSessionModal.tsx` — Modal: name, project path (autocomplete from projects), model selector
- `client/src/components/sessions/CommandInput.tsx` — Text input + send button to pipe commands to tmux

**Session card layout:**
```
┌─────────────────────────────┐
│ ● Working    jsc-a1b2c3d4   │
│ Session Name                │
│ ~/Desktop/Projects/erp      │
│ claude-opus-4-6             │
│ ─────────────────────────── │
│ 12.4K tokens  $0.42  45m   │
│ [Send Command...] [Kill]    │
└─────────────────────────────┘
```

**Verification:**
- [ ] Session cards display with real-time status (pulsing green when working)
- [ ] Create modal opens, creates session, card appears
- [ ] Kill button kills session with confirmation
- [ ] Command input sends text to session's tmux pane
- [ ] Mobile: cards stack vertically, full width

---

### Phase 7: Chat Conversation View
**Goal:** Build the chat-style conversation view — parse JSONL into a clean chat thread with user/assistant bubbles, collapsible tool calls, syntax-highlighted code blocks.

**Files to create:**
- `client/src/pages/ChatPage.tsx` — Session selector + chat thread
- `client/src/hooks/useChat.ts` — Fetches chat messages, subscribes to real-time updates
- `client/src/components/chat/ChatThread.tsx` — Scrollable message list with auto-scroll
- `client/src/components/chat/UserBubble.tsx` — Right-aligned, glass-surface, user message
- `client/src/components/chat/AssistantBubble.tsx` — Left-aligned, wider, assistant message with content blocks
- `client/src/components/chat/ToolCallBlock.tsx` — Collapsible: tool name + chevron → expands to show input params + result
- `client/src/components/chat/CodeBlock.tsx` — Shiki syntax highlighting + copy button + language label
- `client/src/components/chat/ThinkingBlock.tsx` — Collapsible "Thinking..." indicator (shows thinking text if available)
- `client/src/components/chat/MessageMeta.tsx` — Timestamp, model badge, token count

**Chat layout:**
```
┌─ Session: goofy-exploring-badger ──────────────────┐
│                                                      │
│                        ┌──────────────────┐          │
│                        │ Add dark mode to  │  User   │
│                        │ the sidebar       │          │
│                        └──────────────────┘          │
│                                                      │
│  ┌──────────────────────────────────┐                │
│  │ I'll add dark mode to the        │  Assistant     │
│  │ sidebar. Let me start by...      │                │
│  │                                  │                │
│  │ ▶ Read src/Sidebar.tsx           │  (collapsible) │
│  │                                  │                │
│  │ ```tsx                           │                │
│  │ // Updated code...          [📋] │  (copy button) │
│  │ ```                              │                │
│  │                                  │                │
│  │ ▶ Edit src/Sidebar.tsx           │  (collapsible) │
│  │                                  │                │
│  │ Done! The sidebar now supports   │                │
│  │ dark mode via...                 │                │
│  │                                  │                │
│  │ opus-4-6 · 2.1K tokens · 12:34  │  (meta)        │
│  └──────────────────────────────────┘                │
│                                                      │
│  [Select session ▾]                                  │
└──────────────────────────────────────────────────────┘
```

**Code block features:**
- Language detection from tool context (file extension) or Shiki auto-detect
- Copy button (top-right, clipboard icon → check icon on success)
- Line numbers for blocks > 5 lines
- Max height with scroll for blocks > 30 lines

**Verification:**
- [ ] User messages appear right-aligned in glass bubbles
- [ ] Assistant messages appear left-aligned with proper content blocks
- [ ] Tool calls show as collapsible blocks (collapsed by default)
- [ ] Code blocks have syntax highlighting and working copy button
- [ ] New messages auto-scroll to bottom
- [ ] Session selector switches between conversations
- [ ] Mobile: full-width bubbles, smaller text

---

### Phase 8: Project Dashboard
**Goal:** Build the project dashboard — project cards with phase progress, STATE.md viewer, module map from PM_HANDOFF.md.

**Files to create:**
- `client/src/pages/ProjectsPage.tsx` — Project grid
- `client/src/pages/ProjectDetailPage.tsx` — Single project deep dive
- `client/src/hooks/useProjects.ts` — Fetches projects, subscribes to updates
- `client/src/components/projects/ProjectCard.tsx` — Glass card: name, path, phase progress bar, status badge
- `client/src/components/projects/PhaseTimeline.tsx` — Visual horizontal timeline with completed/active/pending phases
- `client/src/components/projects/ModuleMap.tsx` — Grid of modules from PM_HANDOFF.md with priority badges
- `client/src/components/projects/StateViewer.tsx` — Rendered STATE.md with react-markdown

**Project card layout:**
```
┌──────────────────────────────────────┐
│ OvaGas ERP                           │
│ ~/Desktop/Projects/OvaGas-ERP        │
│                                      │
│ Phase 5 of 10: Dashboard & Analytics │
│ ████████████░░░░░░░░░░ 50%          │
│ Status: In Progress                  │
│                                      │
│ 3 active sessions · $12.40 today     │
│ [View Details →]                     │
└──────────────────────────────────────┘
```

**Project detail page sections:**
1. Header: project name, path, status badge
2. Phase timeline (horizontal, scrollable)
3. Module map (grid of P0/P1/P2 modules)
4. STATE.md rendered (markdown)
5. PM_HANDOFF.md rendered (markdown, collapsible sections)
6. Active sessions linked to this project
7. Cost summary for this project

**Verification:**
- [ ] Projects page shows cards for all discovered projects
- [ ] Phase progress bar accurately reflects STATE.md
- [ ] Project detail page renders STATE.md and PM_HANDOFF.md
- [ ] Phase timeline visually shows completed vs pending
- [ ] Mobile: cards stack, timeline scrolls horizontally

---

### Phase 9: Terminal Panel & Token Analytics
**Goal:** Embed xterm.js terminal attached to tmux sessions, and build the token/cost analytics page with charts.

**Files to create:**
- `client/src/pages/TerminalPage.tsx` — Terminal container with session tabs
- `client/src/hooks/useTerminal.ts` — xterm.js initialization + WebSocket PTY bridge
- `client/src/components/terminal/TerminalPanel.tsx` — xterm.js container with fit addon
- `client/src/components/terminal/TerminalTabs.tsx` — Tab bar for multiple terminal sessions
- `server/src/services/terminal.service.ts` — node-pty spawn + WebSocket data bridge
- `server/src/routes/terminal.routes.ts` — POST /api/terminal/attach/:sessionId
- `client/src/pages/AnalyticsPage.tsx` — Token/cost analytics dashboard
- `client/src/hooks/useAnalytics.ts` — Fetches token/cost data
- `client/src/components/analytics/TokenCard.tsx` — Stat card (total tokens, cost today, etc.)
- `client/src/components/analytics/CostChart.tsx` — Recharts daily cost line chart
- `client/src/components/analytics/ModelBreakdown.tsx` — Cost breakdown by model (bar chart)
- `client/src/components/analytics/SessionCostTable.tsx` — Per-session cost table

**Terminal architecture:**
- Client: xterm.js instance → writes input to WebSocket → reads output from WebSocket
- Server: WebSocket upgrade → node-pty spawn `tmux attach-session -t {tmuxName}` → pipe stdin/stdout over WebSocket
- Fit addon auto-resizes on window resize
- WebGL addon for GPU-accelerated rendering

**Analytics page layout:**
```
┌─ Today ──────┐ ┌─ This Week ──┐ ┌─ Total ────────┐
│ $4.20        │ │ $28.50       │ │ $142.00        │
│ 45.2K tokens │ │ 312K tokens  │ │ 1.4M tokens    │
│ 8 sessions   │ │ 42 sessions  │ │ 156 sessions   │
└──────────────┘ └──────────────┘ └────────────────┘

┌─ Daily Cost (Last 30 Days) ──────────────────────┐
│  $8 ╷                                            │
│     │      ╭╮                                    │
│  $4 │  ╭╮╭╯╰╮    ╭╮                             │
│     │╭╯╰╯   ╰╮╭╮╭╯╰╮╭─                         │
│  $0 ┼────────────────────                        │
│     Mar 15        Mar 30        Apr 13           │
└──────────────────────────────────────────────────┘

┌─ Cost by Model ──┐  ┌─ Per-Session Costs ────────┐
│ ███ Opus   $120  │  │ goofy-badger  $4.20  45m  │
│ ██  Sonnet  $18  │  │ quiet-fox     $2.10  22m  │
│ █   Haiku    $4  │  │ ...                        │
└──────────────────┘  └────────────────────────────┘
```

**Verification:**
- [ ] Terminal connects to a tmux session and displays output
- [ ] Terminal accepts keyboard input
- [ ] Terminal resizes correctly on window resize
- [ ] Multiple terminal tabs work
- [ ] Analytics cards show correct token counts and costs
- [ ] Cost chart renders with daily data
- [ ] Model breakdown chart renders
- [ ] Mobile: terminal full-width, charts stack vertically

---

### Phase 10: Cloudflare Tunnel, Polish & Delivery
**Goal:** Add Cloudflare tunnel management, complete mobile responsive pass, empty states, loading skeletons, and final polish.

**Files to create/modify:**
- `server/src/services/tunnel.service.ts` — Spawn `cloudflared tunnel --url` + parse URL + lifecycle management
- `server/src/routes/tunnel.routes.ts` — POST /api/tunnel/start, POST /api/tunnel/stop, GET /api/tunnel/status
- `client/src/components/shared/TunnelBadge.tsx` — Shows tunnel URL/status in sidebar footer
- All pages: add `EmptyState` components for zero-data scenarios
- All pages: add `LoadingSkeleton` components for loading states
- `client/src/components/shared/ErrorBoundary.tsx` — Wire up at page outlet level
- Mobile responsive audit on ALL pages (360px, 390px, 768px, 1280px)
- Touch targets audit (minimum 44px)
- Performance: lazy-load TerminalPage and AnalyticsPage (Recharts + xterm.js are heavy)

**Empty states needed:**
- Sessions: "No active sessions. Create one to start working." + Create button
- Chat: "Select a session to view its conversation." + Session picker
- Projects: "No projects found. Add project directories in settings."
- Terminal: "No sessions available. Create a session first."
- Analytics: "No usage data yet. Start a session to begin tracking."

**Tunnel UI in sidebar footer:**
```
┌────────────────────────┐
│ 🌐 Tunnel: Active      │
│ abc123.trycloudflare.com│
│ [Copy URL] [Stop]      │
└────────────────────────┘
```

**Verification:**
- [ ] Tunnel starts and URL is displayed
- [ ] App is accessible via tunnel URL from phone
- [ ] All pages have empty states
- [ ] All pages have loading skeletons
- [ ] ErrorBoundary catches and displays errors gracefully
- [ ] Mobile responsive at 360px, 390px, 768px, 1280px
- [ ] Touch targets >= 44px on mobile
- [ ] Lazy loading works for Terminal and Analytics pages
- [ ] No console errors
- [ ] `pnpm build` succeeds for both client and server

---

## 9. Resolved Decisions

- [x] **Session naming**: Both — auto-generated slug as default, user can rename. UI shows both slug and custom name.
- [x] **Project discovery paths**: Scan `~/Desktop/Projects/` by default. Settings page allows adding more directories.
- [x] **Authentication**: Simple 4-6 digit PIN for tunnel access. Nothing fancy.
- [x] **Codeman migration**: Start fresh. No import from `~/.codeman/state.json`.
- [x] **Port numbers**: Server on 3001, client dev on 5173, production client served by Fastify from `client/dist/`.

---

## 10. Known Technical Debt (Deferred to v2)

| Item | Reason Deferred | When to Address |
|------|----------------|-----------------|
| Ralph Loop engine | Complex autonomous agent driver — v1 focuses on session management | v2: Gamification phase |
| Respawn controller | Depends on Ralph Loop | v2 |
| Push notifications | Requires service worker + push subscription | v2: Notifications phase |
| Voice input | Web Speech API + command parsing | v2: Voice phase |
| Agent relationship graph | Needs subagent tracking infrastructure | v2: Analytics phase |
| Historical phase analytics | Needs phase_logs table populated | v2: Analytics phase |
| Auth for remote access | Simple PIN is sufficient for v1 | v2 if multi-user needed |
| Production build serving | Dev servers fine for v1 local use | v2: proper Fastify static serving |

---

## 11. Execution Notes

### What Makes This Project Unique (vs Standard JStudio ERP)

1. **No Supabase** — SQLite via `better-sqlite3`. No RLS, no tenant_id, no auth.users table. Single-user local app.
2. **No monorepo blast walls** — This project IS a monorepo, but packages/shared is just types. No packages/ui, packages/database, packages/auth.
3. **Node.js backend required** — Can't be a pure SPA. tmux, file watchers, PTY, and tunnel require server-side Node.js.
4. **System integration** — Heavy use of child processes (tmux CLI, cloudflared, node-pty). Error handling for process crashes is critical.
5. **Real-time first** — WebSocket is the primary data channel, REST is secondary for initial loads.
6. **Developer tool aesthetic** — Not a client-facing app. Dark theme only. No light mode. No i18n. English only.

### Critical Path

```
Phase 1 (Foundation) → Phase 2 (tmux Backend) → Phase 3 (JSONL Parser) → Phase 4 (WebSocket)
                                                                                    ↓
Phase 5 (App Shell) ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ┘
    ↓
Phase 6 (Sessions UI) + Phase 7 (Chat View) + Phase 8 (Project Dashboard)  [semi-parallel, share shell]
    ↓
Phase 9 (Terminal + Analytics)
    ↓
Phase 10 (Tunnel + Polish)
```

Phases 6, 7, 8 can be built in any order once the shell (Phase 5) and backend (Phases 2-4) are complete. They share the same layout and WebSocket infrastructure but don't depend on each other.
