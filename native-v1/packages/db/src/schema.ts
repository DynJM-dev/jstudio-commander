// Drizzle schema — exact implementation of ARCHITECTURE_SPEC v1.2 §10.
// Includes PM v1.2 folds: composite idx_session_events_session_type,
// uidx_workspace_pane_slot (UNIQUE). FTS5 virtual table, partial index on
// sessions WHERE status != 'stopped', and updatedAt triggers live in the raw
// migration SQL at ./migrations/*.sql — Drizzle's SQLite DSL doesn't express
// those primitives directly.

import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// Core: projects + sessions
// ============================================================

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull().unique(),
    type: text('type', {
      enum: ['erp', 'landing', 'dashboard', 'redesign', 'bundle', 'licitaciones', 'other'],
    }).notNull(),
    client: text('client'),
    lastStateMdMtime: integer('last_state_md_mtime'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    pathIdx: index('idx_projects_path').on(table.path),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionTypeId: text('session_type_id')
      .notNull()
      .references(() => sessionTypes.id),
    effort: text('effort', { enum: ['low', 'medium', 'high', 'xhigh'] }).notNull(),
    parentSessionId: text('parent_session_id').references((): any => sessions.id, {
      onDelete: 'set null',
    }),
    claudeSessionId: text('claude_session_id'),
    displayName: text('display_name'),
    status: text('status', {
      enum: ['active', 'working', 'waiting', 'idle', 'stopped', 'error'],
    })
      .notNull()
      .default('active'),
    cwd: text('cwd').notNull(),
    ptyPid: integer('pty_pid'),
    scrollbackBlob: blob('scrollback_blob'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    projectIdx: index('idx_sessions_project').on(table.projectId),
    parentIdx: index('idx_sessions_parent').on(table.parentSessionId),
    claudeIdx: index('idx_sessions_claude').on(table.claudeSessionId),
    statusIdx: index('idx_sessions_status').on(table.status),
  }),
);

// ============================================================
// Extensible session-type registry (ARCHITECTURE_SPEC §15 multi-AI preserved)
// ============================================================

export const sessionTypes = sqliteTable('session_types', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  bootstrapPath: text('bootstrap_path'),
  effortDefault: text('effort_default', {
    enum: ['low', 'medium', 'high', 'xhigh'],
  }).notNull(),
  clientBinary: text('client_binary').notNull().default('claude'),
  spawnArgs: text('spawn_args'),
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ============================================================
// Session events + scrollback + FTS5
// ============================================================

export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_session_events_session').on(table.sessionId),
    timestampIdx: index('idx_session_events_timestamp').on(table.timestamp),
    typeIdx: index('idx_session_events_type').on(table.eventType),
    // PM v1.2 fold: composite (session_id, event_type) for per-session-per-type
    // queries. Load-bearing for v1.1 analytics drill-down + command-palette
    // recent-commands per session.
    sessionTypeIdx: index('idx_session_events_session_type').on(
      table.sessionId,
      table.eventType,
    ),
  }),
);

// ============================================================
// Cost telemetry (single source of truth — resolves v2's two-source divergence)
// ============================================================

export const costEntries = sqliteTable(
  'cost_entries',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    thinkingTokens: integer('thinking_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull(),
    turnIndex: integer('turn_index').notNull(),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_cost_session').on(table.sessionId),
    timestampIdx: index('idx_cost_timestamp').on(table.timestamp),
    // Applies the C26 lesson structurally: no duplicate turn rows possible.
    uniqueTurn: index('uidx_cost_session_turn').on(table.sessionId, table.turnIndex),
  }),
);

// ============================================================
// Tool events (renderer-registry backing store)
// ============================================================

export const toolEvents = sqliteTable(
  'tool_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    toolUseId: text('tool_use_id').notNull(),
    toolName: text('tool_name').notNull(),
    toolInput: text('tool_input').notNull(),
    toolResult: text('tool_result'),
    status: text('status', { enum: ['pending', 'complete', 'error'] }).notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => ({
    sessionIdx: index('idx_tool_events_session').on(table.sessionId),
    toolUseIdx: index('idx_tool_events_use_id').on(table.toolUseId),
  }),
);

// ============================================================
// Approval prompts (Item 3 sacred — byte-identical semantics per §4.7)
// ============================================================

export const approvalPrompts = sqliteTable('approval_prompts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  toolUseId: text('tool_use_id').notNull(),
  promptPayload: text('prompt_payload').notNull(),
  resolution: text('resolution', { enum: ['allow', 'deny', 'custom', 'pending'] })
    .notNull()
    .default('pending'),
  resolvedAt: integer('resolved_at'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ============================================================
// Preferences (typed, scoped to global/session/project)
// ============================================================

export const preferences = sqliteTable(
  'preferences',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    scope: text('scope', { enum: ['global', 'session', 'project'] })
      .notNull()
      .default('global'),
    scopeId: text('scope_id'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    scopeIdx: index('idx_preferences_scope').on(table.scope, table.scopeId),
  }),
);

// ============================================================
// Workspaces (§8.2 workspace persistence)
// ============================================================

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  layoutJson: text('layout_json').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const workspacePanes = sqliteTable(
  'workspace_panes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    paneIndex: integer('pane_index').notNull(),
    sessionId: text('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    drawerStates: text('drawer_states').notNull().default('{}'),
    sizes: text('sizes').notNull().default('{}'),
  },
  (table) => ({
    workspaceIdx: index('idx_workspace_panes_ws').on(table.workspaceId),
    // PM v1.2 fold: UNIQUE on (workspace_id, pane_index) — structural guarantee
    // against duplicate pane slots. Enforced via raw migration SQL (CREATE
    // UNIQUE INDEX) in 0001_init.sql; Drizzle DSL only marks the shape.
    uniqueWsPaneIndex: index('uidx_workspace_pane_slot').on(
      table.workspaceId,
      table.paneIndex,
    ),
  }),
);

// ============================================================
// Three-role UI routing graph (§12 of FEATURE_REQUIREMENTS_SPEC)
// ============================================================

export const threeRoleLinks = sqliteTable(
  'three_role_links',
  {
    id: text('id').primaryKey(),
    linkType: text('link_type', {
      enum: [
        'cto_brief_to_pm_dispatch',
        'pm_dispatch_to_coder_report',
        'coder_report_to_pm_synthesis',
      ],
    }).notNull(),
    sourceRef: text('source_ref').notNull(),
    targetRef: text('target_ref').notNull(),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    sourceIdx: index('idx_three_role_source').on(table.sourceRef),
    targetIdx: index('idx_three_role_target').on(table.targetRef),
  }),
);

// ============================================================
// Re-export convenient aggregate types for consumers
// ============================================================

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type SessionType = typeof sessionTypes.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;
export type NewCostEntry = typeof costEntries.$inferInsert;
export type Preference = typeof preferences.$inferSelect;
