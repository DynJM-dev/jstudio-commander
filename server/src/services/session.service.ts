import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Session, SessionStatus } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { tmuxService } from './tmux.service.js';
import { agentStatusService } from './agent-status.service.js';
import { eventBus } from '../ws/event-bus.js';

const getClaudeEffortLevel = (): string => {
  try {
    const p = join(homedir(), '.claude', 'settings.json');
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf-8')) as { effortLevel?: string };
      if (s.effortLevel) return s.effortLevel;
    }
  } catch { /* default */ }
  return 'medium';
};

// Auto-slug generator: adjective-noun
const ADJECTIVES = [
  'quiet', 'brave', 'swift', 'bold', 'keen',
  'sharp', 'calm', 'dark', 'wild', 'bright',
  'noble', 'rapid', 'wise', 'cool', 'deep',
  'iron', 'free', 'sure', 'vast', 'warm',
];

const NOUNS = [
  'falcon', 'otter', 'badger', 'wolf', 'hawk',
  'tiger', 'raven', 'cobra', 'lynx', 'viper',
  'eagle', 'shark', 'crane', 'fox', 'bear',
  'puma', 'bison', 'owl', 'pike', 'elk',
];

const generateSlug = (): string => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj}-${noun}`;
};

const generateTmuxName = (id: string): string => `jsc-${id.slice(0, 8)}`;

interface CreateSessionOpts {
  name?: string;
  projectPath?: string;
  model?: string;
}

const rowToSession = (row: Record<string, unknown>): Session => ({
  id: row.id as string,
  name: row.name as string,
  tmuxSession: row.tmux_session as string,
  projectPath: row.project_path as string | null,
  claudeSessionId: row.claude_session_id as string | null,
  status: row.status as SessionStatus,
  model: row.model as string,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  stoppedAt: row.stopped_at as string | null,
  stationId: row.station_id as string | null,
  agentRole: row.agent_role as string | null,
  effortLevel: (row.effort_level as string) ?? 'medium',
  parentSessionId: (row.parent_session_id as string | null) ?? null,
  teamName: (row.team_name as string | null) ?? null,
});

export const sessionService = {
  createSession(opts: CreateSessionOpts): Session {
    const db = getDb();
    const id = uuidv4();
    const slug = opts.name || generateSlug();
    const tmuxName = generateTmuxName(id);
    const model = opts.model || 'claude-opus-4-6';

    // Create tmux session (in project directory if specified)
    tmuxService.createSession(tmuxName, opts.projectPath);

    // Auto-start Claude Code in the tmux session
    // Build the claude command with the selected model
    const modelFlag = model ? `--model ${model}` : '';
    const claudeCmd = `claude ${modelFlag}`.trim();

    // Small delay to let the shell initialize, then send the claude command
    setTimeout(() => {
      try {
        tmuxService.sendKeys(tmuxName, claudeCmd);

        // The UI will detect and surface any interactive prompts (trust, permissions)
        // via the /api/sessions/:id/output endpoint
      } catch {
        // Session may have been killed before claude could start
      }
    }, 500);

    // Insert into database
    const now = new Date().toISOString();
    const effortLevel = getClaudeEffortLevel();
    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, project_path, status, model, effort_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'working', ?, ?, ?, ?)
    `).run(id, slug, tmuxName, opts.projectPath ?? null, model, effortLevel, now, now);

    // Log event
    db.prepare(`
      INSERT INTO session_events (session_id, event, detail)
      VALUES (?, 'created', ?)
    `).run(id, JSON.stringify({ name: slug, tmuxSession: tmuxName, projectPath: opts.projectPath, claudeCmd }));

    const session = this.getSession(id)!;
    eventBus.emitSessionCreated(session);
    return session;
  },

  // Register a teammate discovered from a team config file. The teammate's
  // "tmux session" is actually a pane ID (e.g. "%35") — tmux send-keys -t <pane>
  // works identically to send-keys -t <session>, so we store it directly.
  // Idempotent: called on every config file mutation; upserts.
  //
  // `live` controls resurrection semantics: true = flip stopped → idle
  // (there's evidence the underlying Claude process is alive), false =
  // preserve whatever status the row currently has. Callers (team-config)
  // decide liveness via tmux pane check or recent JSONL/hook activity.
  upsertTeammateSession(opts: {
    sessionId: string;
    name: string;
    tmuxTarget: string;
    projectPath: string | null;
    role: string;
    teamName: string;
    parentSessionId: string | null;
    model?: string;
    live: boolean;
  }): Session {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(opts.sessionId) as { id: string } | undefined;
    const now = new Date().toISOString();

    if (existing) {
      // When live=true we resurrect a stopped row to idle (the config +
      // evidence agree the member is alive again). When live=false we
      // preserve status so killed-but-still-in-config sessions stay dead.
      const statusExpr = opts.live
        ? "CASE WHEN status = 'stopped' THEN 'idle' ELSE status END"
        : 'status';
      const stoppedAtExpr = opts.live
        ? "CASE WHEN status = 'stopped' THEN NULL ELSE stopped_at END"
        : 'stopped_at';
      db.prepare(`
        UPDATE sessions
        SET name = ?, tmux_session = ?, project_path = ?, agent_role = ?,
            team_name = ?, parent_session_id = ?, updated_at = ?,
            status = ${statusExpr},
            stopped_at = ${stoppedAtExpr}
        WHERE id = ?
      `).run(
        opts.name,
        opts.tmuxTarget,
        opts.projectPath,
        opts.role,
        opts.teamName,
        opts.parentSessionId,
        now,
        opts.sessionId,
      );
    } else {
      // Fresh row — default to idle iff the caller has evidence the member
      // is alive. Otherwise start stopped and let a later hook/tmux probe
      // promote the session.
      const initialStatus = opts.live ? 'idle' : 'stopped';
      const initialStoppedAt = opts.live ? null : now;
      db.prepare(`
        INSERT INTO sessions (
          id, name, tmux_session, project_path, status, model, effort_level,
          agent_role, team_name, parent_session_id, stopped_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'medium', ?, ?, ?, ?, ?, ?)
      `).run(
        opts.sessionId,
        opts.name,
        opts.tmuxTarget,
        opts.projectPath,
        initialStatus,
        opts.model ?? 'claude-opus-4-6',
        opts.role,
        opts.teamName,
        opts.parentSessionId,
        initialStoppedAt,
        now,
        now,
      );
    }

    // Record the parent/child edge. If the row already exists with an
    // ended_at (previous dismissal), clear it — this teammate is being
    // respawned and the listTeammates query filters on ended_at IS NULL.
    if (opts.parentSessionId && opts.parentSessionId !== opts.sessionId) {
      db.prepare(`
        INSERT INTO agent_relationships (parent_session_id, child_session_id, relationship)
        VALUES (?, ?, 'spawned_by')
        ON CONFLICT(parent_session_id, child_session_id) DO UPDATE SET ended_at = NULL
      `).run(opts.parentSessionId, opts.sessionId);
    }

    const session = this.getSession(opts.sessionId)!;
    eventBus.emitSessionUpdated(session);
    return session;
  },

  markTeammateDismissed(sessionId: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, sessionId);
    db.prepare(`
      UPDATE agent_relationships SET ended_at = ? WHERE child_session_id = ? AND ended_at IS NULL
    `).run(now, sessionId);
  },

  // The requested ID may be Commander's own session UUID or the Claude Code
  // leadSessionId stored in the team config. Teams link teammates to whichever
  // ID the PM wrote, so we resolve both and match either.
  listTeammates(parentSessionId: string): Session[] {
    const db = getDb();
    const pm = db.prepare(
      'SELECT id, claude_session_id FROM sessions WHERE id = ? OR claude_session_id = ? LIMIT 1'
    ).get(parentSessionId, parentSessionId) as { id: string; claude_session_id: string | null } | undefined;

    const candidates = new Set<string>([parentSessionId]);
    if (pm) {
      candidates.add(pm.id);
      if (pm.claude_session_id) candidates.add(pm.claude_session_id);
    }

    const placeholders = Array.from(candidates).map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT s.* FROM sessions s
      INNER JOIN agent_relationships r ON r.child_session_id = s.id
      WHERE r.parent_session_id IN (${placeholders}) AND r.ended_at IS NULL
      ORDER BY s.created_at ASC
    `).all(...Array.from(candidates)) as Record<string, unknown>[];
    return rows.map((row) => rowToSession(row));
  },

  listSessions(): Session[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as Record<string, unknown>[];

    // Return cached status from DB — the status poller (5s interval) keeps this fresh
    // No live tmux detection here to keep the endpoint fast
    return rows.map((row) => rowToSession(row));
  },

  getSession(id: string): Session | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    // Return cached status — status poller keeps it fresh
    return rowToSession(row);
  },

  deleteSession(id: string): Session | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const session = rowToSession(row);

    // Team-linked rows: hard-delete + archive or mutate the team config so
    // the next reconcile pass doesn't resurrect them.
    if (session.teamName) return this.purgeTeamSession(session);

    if (tmuxService.hasSession(session.tmuxSession)) {
      try { tmuxService.killSession(session.tmuxSession); } catch { /* gone */ }
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id);
    db.prepare(`
      INSERT INTO session_events (session_id, event, detail)
      VALUES (?, 'killed', ?)
    `).run(id, JSON.stringify({ reason: 'user_requested' }));

    session.status = 'stopped';
    session.stoppedAt = now;
    eventBus.emitSessionDeleted(id);
    return session;
  },

  // Delete a team-linked session row. If this row is the team's lead,
  // archive the whole team config to ~/.claude/teams/.trash/<name>-<ts>/
  // so reconciliation stops picking it up. Otherwise remove just this
  // member from the team config's members array.
  purgeTeamSession(session: Session): Session {
    if (!session.teamName) return session;
    const db = getDb();
    const configPath = join(homedir(), '.claude', 'teams', session.teamName, 'config.json');

    try {
      if (existsSync(configPath)) {
        const raw = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as {
          leadAgentId?: string;
          leadSessionId?: string;
          members?: Array<{ agentId?: string }>;
        };
        const isLead =
          (config.leadSessionId && session.id === config.leadSessionId) ||
          (config.leadAgentId && session.id === config.leadAgentId);

        if (isLead) {
          // Archive the whole team directory
          const teamDir = dirname(configPath);
          const trashRoot = join(homedir(), '.claude', 'teams', '.trash');
          mkdirSync(trashRoot, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const target = join(trashRoot, `${session.teamName}-${ts}`);
          renameSync(teamDir, target);
          console.log(`[sessions] archived team ${session.teamName} → ${target}`);
        } else {
          // Remove just this member from members[]
          config.members = (config.members ?? []).filter((m) => m.agentId !== session.id);
          writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
          console.log(`[sessions] removed member ${session.id} from team ${session.teamName}`);
        }
      }
    } catch (err) {
      console.warn(`[sessions] team cleanup failed for ${session.id}:`, (err as Error).message);
    }

    // Kill tmux if real pane, then drop DB rows.
    if (session.tmuxSession && !session.tmuxSession.startsWith('agent:') && tmuxService.hasSession(session.tmuxSession)) {
      try { tmuxService.killSession(session.tmuxSession); } catch { /* gone */ }
    }
    db.prepare('DELETE FROM agent_relationships WHERE parent_session_id = ? OR child_session_id = ?').run(session.id, session.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

    eventBus.emitSessionDeleted(session.id);
    session.status = 'stopped';
    return session;
  },

  sendCommand(id: string, command: string): { success: boolean; error?: string } {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: 'Session not found' };

    const session = rowToSession(row);
    if (session.status === 'stopped') {
      return { success: false, error: 'Session is stopped' };
    }

    if (!tmuxService.hasSession(session.tmuxSession)) {
      // Mark as stopped since tmux session is gone
      db.prepare('UPDATE sessions SET status = \'stopped\', stopped_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
        .run(id);
      return { success: false, error: 'Tmux session no longer exists' };
    }

    tmuxService.sendKeys(session.tmuxSession, command);

    // Log event
    db.prepare(`
      INSERT INTO session_events (session_id, event, detail)
      VALUES (?, 'command_sent', ?)
    `).run(id, JSON.stringify({ command }));

    return { success: true };
  },

  updateSession(id: string, updates: { name?: string; model?: string; effortLevel?: string }): Session | null {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.model !== undefined) {
      sets.push('model = ?');
      values.push(updates.model);
    }
    if (updates.effortLevel !== undefined) {
      sets.push('effort_level = ?');
      values.push(updates.effortLevel);
    }

    if (sets.length === 0) return this.getSession(id);

    sets.push('updated_at = datetime(\'now\')');
    values.push(id);

    db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const updated = this.getSession(id);
    if (updated) eventBus.emitSessionUpdated(updated);
    return updated;
  },

  getSessionStatus(id: string): { status: SessionStatus } | null {
    const db = getDb();
    const row = db.prepare('SELECT tmux_session, status FROM sessions WHERE id = ?').get(id) as { tmux_session: string; status: string } | undefined;
    if (!row) return null;

    if (row.status === 'stopped') return { status: 'stopped' };

    const liveStatus = tmuxService.hasSession(row.tmux_session)
      ? agentStatusService.detectStatus(row.tmux_session)
      : 'stopped';

    // Update if changed
    if (liveStatus !== row.status) {
      const db2 = getDb();
      db2.prepare('UPDATE sessions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(liveStatus, id);
    }

    return { status: liveStatus };
  },
};
