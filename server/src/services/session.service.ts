import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  upsertTeammateSession(opts: {
    sessionId: string;
    name: string;
    tmuxTarget: string;
    projectPath: string | null;
    role: string;
    teamName: string;
    parentSessionId: string | null;
    model?: string;
  }): Session {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(opts.sessionId) as { id: string } | undefined;
    const now = new Date().toISOString();

    if (existing) {
      // If the session was previously stopped but the team config still lists
      // them, flip back to idle — the config is the source of truth for
      // "is this teammate currently alive?", not whatever state the poller
      // wrote before the fix for pane-ID targets landed.
      db.prepare(`
        UPDATE sessions
        SET name = ?, tmux_session = ?, project_path = ?, agent_role = ?,
            team_name = ?, parent_session_id = ?, updated_at = ?,
            status = CASE WHEN status = 'stopped' THEN 'idle' ELSE status END,
            stopped_at = CASE WHEN status = 'stopped' THEN NULL ELSE stopped_at END
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
      // New teammate row — default to idle, not working. We don't know if
      // Claude is mid-generation; let the poller discover that on its next
      // pass. 'idle' is the safer assumption for fresh rows.
      db.prepare(`
        INSERT INTO sessions (
          id, name, tmux_session, project_path, status, model, effort_level,
          agent_role, team_name, parent_session_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'idle', ?, 'medium', ?, ?, ?, ?, ?)
      `).run(
        opts.sessionId,
        opts.name,
        opts.tmuxTarget,
        opts.projectPath,
        opts.model ?? 'claude-opus-4-6',
        opts.role,
        opts.teamName,
        opts.parentSessionId,
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

    // Kill tmux session if it exists
    if (tmuxService.hasSession(session.tmuxSession)) {
      try {
        tmuxService.killSession(session.tmuxSession);
      } catch {
        // Session may already be gone
      }
    }

    // Update database
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id);

    // Log event
    db.prepare(`
      INSERT INTO session_events (session_id, event, detail)
      VALUES (?, 'killed', ?)
    `).run(id, JSON.stringify({ reason: 'user_requested' }));

    session.status = 'stopped';
    session.stoppedAt = now;
    eventBus.emitSessionDeleted(id);
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
