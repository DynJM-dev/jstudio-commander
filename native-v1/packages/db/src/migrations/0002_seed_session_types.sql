-- JStudio Commander v1 — migration 0002
-- Seed the three canonical session_types rows: pm, coder, raw.
-- ARCHITECTURE_SPEC v1.2 §10 seed block; dispatch §3 Task 3 acceptance.
--
-- INSERT OR IGNORE makes this safe to re-run (matches Drizzle migrator's
-- re-entrance guarantee — first-run initializes, subsequent startups skip).

INSERT OR IGNORE INTO session_types
  (id, label, bootstrap_path, effort_default, client_binary, spawn_args, icon, sort_order, created_at)
VALUES
  (
    'pm',
    'PM',
    '~/.claude/prompts/pm-session-bootstrap.md',
    'high',
    'claude',
    NULL,
    NULL,
    1,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  ),
  (
    'coder',
    'Coder',
    '~/.claude/prompts/coder-session-bootstrap.md',
    'medium',
    'claude',
    NULL,
    NULL,
    2,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  ),
  (
    'raw',
    'Raw',
    NULL,
    'medium',
    'claude',
    NULL,
    NULL,
    3,
    CAST(strftime('%s','now') AS INTEGER) * 1000
  );
