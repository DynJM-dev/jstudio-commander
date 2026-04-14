-- ============================================================
-- JStudio Commander — SQLite Schema v1
-- ============================================================

-- Sessions: tracks tmux-backed Claude Code sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tmux_session TEXT NOT NULL UNIQUE,
  project_path TEXT,
  claude_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  model TEXT DEFAULT 'claude-opus-4-6',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT,
  station_id TEXT,
  agent_role TEXT,
  transcript_path TEXT
);

-- Projects: discovered from filesystem, enriched with parsed STATE.md
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  has_state_md INTEGER NOT NULL DEFAULT 0,
  has_handoff_md INTEGER NOT NULL DEFAULT 0,
  current_phase TEXT,
  current_phase_status TEXT,
  total_phases INTEGER DEFAULT 0,
  completed_phases INTEGER DEFAULT 0,
  last_scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  station_x INTEGER,
  station_y INTEGER,
  station_sprite TEXT
);

-- Token usage: per-message token data parsed from JSONL
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  message_id TEXT,
  request_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  phase_id TEXT,
  skill_name TEXT
);

-- Cost entries: daily aggregated costs
CREATE TABLE IF NOT EXISTS cost_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
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
  event TEXT NOT NULL,
  detail TEXT,
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

-- v2 placeholder tables

-- Agent relationships: PM → coder → subagent graph (v2)
CREATE TABLE IF NOT EXISTS agent_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
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
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  duration_minutes INTEGER,
  files_created INTEGER DEFAULT 0,
  files_modified INTEGER DEFAULT 0,
  migrations_run INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  notes TEXT,
  UNIQUE(project_id, phase_number)
);

-- Skill usage stats (v2)
CREATE TABLE IF NOT EXISTS skill_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  skill_name TEXT NOT NULL,
  invoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  tokens_used INTEGER DEFAULT 0
);

-- Notifications (v2)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
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
