-- JStudio Commander v1 — migration 0001
-- Canonical schema per ARCHITECTURE_SPEC v1.2 §10 with PM v1.2 folds.
-- Mirrors packages/db/src/schema.ts; raw SQL handles primitives Drizzle's
-- SQLite DSL cannot express directly (partial indexes, updatedAt triggers).

PRAGMA foreign_keys = ON;

-- ============================================================
-- projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  path                TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL CHECK (type IN ('erp', 'landing', 'dashboard', 'redesign', 'bundle', 'licitaciones', 'other')),
  client              TEXT,
  last_state_md_mtime INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

-- ============================================================
-- session_types (seeded in 0002)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_types (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  bootstrap_path  TEXT,
  effort_default  TEXT NOT NULL CHECK (effort_default IN ('low', 'medium', 'high', 'xhigh')),
  client_binary   TEXT NOT NULL DEFAULT 'claude',
  spawn_args      TEXT,
  icon            TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

-- ============================================================
-- sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_type_id    TEXT NOT NULL REFERENCES session_types(id),
  effort             TEXT NOT NULL CHECK (effort IN ('low', 'medium', 'high', 'xhigh')),
  parent_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  claude_session_id  TEXT,
  display_name       TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'working', 'waiting', 'idle', 'stopped', 'error')),
  cwd                TEXT NOT NULL,
  pty_pid            INTEGER,
  scrollback_blob    BLOB,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  stopped_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent  ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_claude  ON sessions(claude_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status);

-- PM v1.2 fold: partial index excluding stopped rows — most status queries
-- filter active/working/idle; stopped is long-tail and cheap to scan less.
CREATE INDEX IF NOT EXISTS idx_sessions_active_status
  ON sessions(status)
  WHERE status != 'stopped';

-- ============================================================
-- session_events + FTS5 virtual table + sync triggers
-- ============================================================
CREATE TABLE IF NOT EXISTS session_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  payload      TEXT NOT NULL,
  timestamp    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_events_session       ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_timestamp     ON session_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_type          ON session_events(event_type);
-- PM v1.2 fold: composite idx (session_id, event_type) for per-session-per-type.
CREATE INDEX IF NOT EXISTS idx_session_events_session_type  ON session_events(session_id, event_type);

-- FTS5 virtual table for payload full-text search.
-- external-content mode: content lives in session_events, mirrored via triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS session_events_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  event_type,
  payload,
  content='session_events',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- FTS5 sync triggers.
CREATE TRIGGER IF NOT EXISTS session_events_ai AFTER INSERT ON session_events BEGIN
  INSERT INTO session_events_fts(rowid, id, session_id, event_type, payload)
  VALUES (new.rowid, new.id, new.session_id, new.event_type, new.payload);
END;
CREATE TRIGGER IF NOT EXISTS session_events_ad AFTER DELETE ON session_events BEGIN
  INSERT INTO session_events_fts(session_events_fts, rowid, id, session_id, event_type, payload)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.event_type, old.payload);
END;
CREATE TRIGGER IF NOT EXISTS session_events_au AFTER UPDATE ON session_events BEGIN
  INSERT INTO session_events_fts(session_events_fts, rowid, id, session_id, event_type, payload)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.event_type, old.payload);
  INSERT INTO session_events_fts(rowid, id, session_id, event_type, payload)
  VALUES (new.rowid, new.id, new.session_id, new.event_type, new.payload);
END;

-- ============================================================
-- cost_entries (single source of truth)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_entries (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model               TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  thinking_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL,
  turn_index          INTEGER NOT NULL,
  timestamp           INTEGER NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_session   ON cost_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_entries(timestamp);
-- C26 structural fix: no duplicate turn rows possible.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_cost_session_turn
  ON cost_entries(session_id, turn_index);

-- ============================================================
-- tool_events
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_use_id   TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  tool_input    TEXT NOT NULL,
  tool_result   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'error')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_events_session   ON tool_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_events_use_id    ON tool_events(tool_use_id);

-- ============================================================
-- approval_prompts (Item 3 sacred)
-- ============================================================
CREATE TABLE IF NOT EXISTS approval_prompts (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_use_id     TEXT NOT NULL,
  prompt_payload  TEXT NOT NULL,
  resolution      TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN ('allow', 'deny', 'custom', 'pending')),
  resolved_at     INTEGER,
  created_at      INTEGER NOT NULL
);

-- ============================================================
-- preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS preferences (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'session', 'project')),
  scope_id    TEXT,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preferences_scope ON preferences(scope, scope_id);

-- ============================================================
-- workspaces + workspace_panes
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_panes (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_index     INTEGER NOT NULL,
  session_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  drawer_states  TEXT NOT NULL DEFAULT '{}',
  sizes          TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_workspace_panes_ws ON workspace_panes(workspace_id);
-- PM v1.2 fold: UNIQUE structural guarantee (applies C26 lesson proactively).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_workspace_pane_slot
  ON workspace_panes(workspace_id, pane_index);

-- ============================================================
-- three_role_links
-- ============================================================
CREATE TABLE IF NOT EXISTS three_role_links (
  id          TEXT PRIMARY KEY,
  link_type   TEXT NOT NULL CHECK (link_type IN ('cto_brief_to_pm_dispatch', 'pm_dispatch_to_coder_report', 'coder_report_to_pm_synthesis')),
  source_ref  TEXT NOT NULL,
  target_ref  TEXT NOT NULL,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_three_role_source ON three_role_links(source_ref);
CREATE INDEX IF NOT EXISTS idx_three_role_target ON three_role_links(target_ref);

-- ============================================================
-- updated_at triggers (auto-touch on row update)
-- Drizzle's timestamp_ms mode doesn't generate SQLite triggers; explicit here.
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_projects_updated_at
  AFTER UPDATE ON projects
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE projects SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at
  AFTER UPDATE ON sessions
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE sessions SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_workspaces_updated_at
  AFTER UPDATE ON workspaces
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE workspaces SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_preferences_updated_at
  AFTER UPDATE ON preferences
  FOR EACH ROW
  WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE preferences SET updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE key = OLD.key;
END;
