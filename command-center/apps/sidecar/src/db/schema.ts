// Drizzle SQLite schema — ARCHITECTURE_SPEC §3.2, all 9 v1 tables.
// Timestamps as ISO-8601 strings (text). UUIDs as text. JSON columns use
// `mode: 'json'` — Drizzle serializes/deserializes transparently.
//
// BOOT_SCHEMA_SQL (bottom of file) mirrors these definitions as idempotent
// CREATE TABLE IF NOT EXISTS DDL for N1's boot-time migration. N2+ replaces
// this with a proper drizzle-kit generate + migrator workflow (PHASE_REPORT §4).

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowIso = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    identityFilePath: text('identity_file_path').notNull(),
    createdAt: text('created_at').notNull().default(nowIso()),
    updatedAt: text('updated_at').notNull().default(nowIso()),
  },
  (t) => ({
    identityPathUnique: uniqueIndex('projects_identity_path_unique').on(t.identityFilePath),
  }),
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    layout: text('layout', { mode: 'json' }).$type<unknown>(),
    createdAt: text('created_at').notNull().default(nowIso()),
    updatedAt: text('updated_at').notNull().default(nowIso()),
  },
  (t) => ({
    projectIdx: index('workspaces_project_idx').on(t.projectId),
  }),
);

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    systemPromptMd: text('system_prompt_md'),
    model: text('model').notNull(),
    capabilityClass: text('capability_class').notNull().default('high'),
    maxIterations: integer('max_iterations'),
    maxWallClockSeconds: integer('max_wall_clock_seconds'),
    maxTokens: integer('max_tokens'),
    toolsJson: text('tools_json', { mode: 'json' }).$type<unknown>(),
    createdAt: text('created_at').notNull().default(nowIso()),
  },
  (t) => ({
    projectIdx: index('agents_project_idx').on(t.projectId),
  }),
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructionsMd: text('instructions_md').notNull(),
    status: text('status').notNull().default('todo'),
    createdAt: text('created_at').notNull().default(nowIso()),
    updatedAt: text('updated_at').notNull().default(nowIso()),
  },
  (t) => ({
    projectStatusIdx: index('tasks_project_status_idx').on(t.projectId, t.status),
  }),
);

// APPEND-ONLY per KB-P1.3 — no PATCH/DELETE path in HTTP API. Supersession
// handled via `supersededById` column pointing to the replacing entry.
export const knowledgeEntries = sqliteTable(
  'knowledge_entries',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentRunId: text('agent_run_id'),
    agentId: text('agent_id'),
    timestamp: text('timestamp').notNull().default(nowIso()),
    contentMd: text('content_md').notNull(),
    supersededById: text('superseded_by_id'),
  },
  (t) => ({
    taskTimestampIdx: index('knowledge_entries_task_ts_idx').on(t.taskId, t.timestamp),
  }),
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    sessionId: text('session_id'),
    status: text('status').notNull().default('queued'),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
    exitReason: text('exit_reason'),
    worktreePath: text('worktree_path'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    wallClockSeconds: integer('wall_clock_seconds').notNull().default(0),
  },
  (t) => ({
    taskStatusIdx: index('agent_runs_task_status_idx').on(t.taskId, t.status),
    sessionIdx: index('agent_runs_session_idx').on(t.sessionId),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    agentRunId: text('agent_run_id'),
    ptyPid: integer('pty_pid'),
    cwd: text('cwd').notNull(),
    claudeSessionId: text('claude_session_id'),
    status: text('status').notNull().default('initializing'),
    scrollbackBlob: text('scrollback_blob'),
    createdAt: text('created_at').notNull().default(nowIso()),
    endedAt: text('ended_at'),
  },
  (t) => ({
    agentRunIdx: index('sessions_agent_run_idx').on(t.agentRunId),
    claudeSessionIdx: index('sessions_claude_session_idx').on(t.claudeSessionId),
  }),
);

export const hookEvents = sqliteTable(
  'hook_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    eventName: text('event_name').notNull(),
    timestamp: text('timestamp').notNull().default(nowIso()),
    payloadJson: text('payload_json', { mode: 'json' }).notNull().$type<unknown>(),
  },
  (t) => ({
    sessionTimestampIdx: index('hook_events_session_ts_idx').on(t.sessionId, t.timestamp),
    eventTimestampIdx: index('hook_events_event_ts_idx').on(t.eventName, t.timestamp),
  }),
);

// KB-P1.16 — flow-gating state in DB. v1 single-user; PK 'local' sentinel
// until multi-user arrives (post-v1 hardening).
export const onboardingState = sqliteTable('onboarding_state', {
  userId: text('user_id').primaryKey().default('local'),
  completedSteps: text('completed_steps', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default([] as unknown as string[]),
  pluginInstalledAcknowledged: integer('plugin_installed_acknowledged', { mode: 'boolean' })
    .notNull()
    .default(false),
  firstProjectAdded: integer('first_project_added', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

// Exported as a map for table-count + introspection on the Debug tab.
export const TABLES = {
  projects,
  workspaces,
  agents,
  tasks,
  knowledge_entries: knowledgeEntries,
  agent_runs: agentRuns,
  sessions,
  hook_events: hookEvents,
  onboarding_state: onboardingState,
} as const;

export const TABLE_NAMES = Object.keys(TABLES) as (keyof typeof TABLES)[];

/**
 * Idempotent CREATE TABLE IF NOT EXISTS DDL mirroring the Drizzle definitions
 * above. Applied at sidecar boot (see db/client.ts). N1-only; N2 replaces with
 * drizzle-kit migrator (see PHASE_N1_REPORT §4).
 */
export const BOOT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  identity_file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_identity_path_unique ON projects (identity_file_path);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  layout TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS workspaces_project_idx ON workspaces (project_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  system_prompt_md TEXT,
  model TEXT NOT NULL,
  capability_class TEXT NOT NULL DEFAULT 'high',
  max_iterations INTEGER,
  max_wall_clock_seconds INTEGER,
  max_tokens INTEGER,
  tools_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS agents_project_idx ON agents (project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks (project_id, status);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_run_id TEXT,
  agent_id TEXT,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  content_md TEXT NOT NULL,
  superseded_by_id TEXT
);
CREATE INDEX IF NOT EXISTS knowledge_entries_task_ts_idx ON knowledge_entries (task_id, timestamp);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  ended_at TEXT,
  exit_reason TEXT,
  worktree_path TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  wall_clock_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_runs_task_status_idx ON agent_runs (task_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs (session_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT,
  pty_pid INTEGER,
  cwd TEXT NOT NULL,
  claude_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'initializing',
  scrollback_blob TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_agent_run_idx ON sessions (agent_run_id);
CREATE INDEX IF NOT EXISTS sessions_claude_session_idx ON sessions (claude_session_id);

CREATE TABLE IF NOT EXISTS hook_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hook_events_session_ts_idx ON hook_events (session_id, timestamp);
CREATE INDEX IF NOT EXISTS hook_events_event_ts_idx ON hook_events (event_name, timestamp);

CREATE TABLE IF NOT EXISTS onboarding_state (
  user_id TEXT PRIMARY KEY DEFAULT 'local',
  completed_steps TEXT NOT NULL DEFAULT '[]',
  plugin_installed_acknowledged INTEGER NOT NULL DEFAULT 0,
  first_project_added INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;
