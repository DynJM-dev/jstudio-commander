import { v4 as uuidv4 } from 'uuid';
import type { Session, SessionStatus } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { tmuxService } from './tmux.service.js';
import { agentStatusService } from './agent-status.service.js';
import { eventBus } from '../ws/event-bus.js';

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
    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, project_path, status, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'working', ?, ?, ?)
    `).run(id, slug, tmuxName, opts.projectPath ?? null, model, now, now);

    // Log event
    db.prepare(`
      INSERT INTO session_events (session_id, event, detail)
      VALUES (?, 'created', ?)
    `).run(id, JSON.stringify({ name: slug, tmuxSession: tmuxName, projectPath: opts.projectPath, claudeCmd }));

    const session = this.getSession(id)!;
    eventBus.emitSessionCreated(session);
    return session;
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

  updateSession(id: string, updates: { name?: string; model?: string }): Session | null {
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
