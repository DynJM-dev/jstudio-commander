import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Session, SessionStatus, EffortLevel } from '@commander/shared';

// Coerce any legacy or malformed effort_level value (pre-migration
// 'low'/'medium', NULL from a row that pre-dates the column default
// migration, junk from direct SQL) to a valid EffortLevel. The boot
// heal migration in connection.ts handles persisted rows; this handles
// the in-memory read path so a stale row never breaks the typed API.
const normalizeEffortLevel = (raw: string | null | undefined): EffortLevel => {
  if (raw === 'high' || raw === 'xhigh' || raw === 'max') return raw;
  return 'xhigh';
};
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
  return 'max';
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
  sessionType?: 'pm' | 'raw';
}

const PM_BOOTSTRAP_PATH = join(homedir(), '.claude', 'prompts', 'pm-session-bootstrap.md');

const readPmBootstrap = (): string | null => {
  try {
    if (!existsSync(PM_BOOTSTRAP_PATH)) return null;
    return readFileSync(PM_BOOTSTRAP_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
};

// Poll the tmux pane until Claude Code's idle prompt shows — then we can
// safely inject the bootstrap text. Times out after ~12s; if the UI isn't
// ready we abort the injection quietly.
const waitForClaudeReady = async (tmuxName: string, timeoutMs = 12_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pane = tmuxService.capturePane(tmuxName, 12);
      if (/❯/.test(pane) || /\? for shortcuts/i.test(pane)) return true;
    } catch { /* tmux hiccup — retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

const parseTranscriptPaths = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
};

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
  effortLevel: normalizeEffortLevel(row.effort_level as string | null | undefined),
  parentSessionId: (row.parent_session_id as string | null) ?? null,
  teamName: (row.team_name as string | null) ?? null,
  sessionType: ((row.session_type as string) ?? 'raw') as 'pm' | 'raw',
  transcriptPaths: parseTranscriptPaths(row.transcript_paths),
});

// Column mapping kept in one place so every write surface applies the same
// defaults. Missing input fields fall through to schema defaults via `null`
// — the schema owns status='idle', session_type='raw', effort_level='max'.
// The one exception is effort_level, which takes the value returned by
// getClaudeEffortLevel() when unspecified so new sessions inherit the user's
// Claude Code default.
interface UpsertSessionInput {
  id: string;
  name?: string;
  tmuxSession?: string;
  projectPath?: string | null;
  claudeSessionId?: string | null;
  status?: SessionStatus;
  // Narrow EffortLevel type kept on the UpsertSessionInput — shared
  // EFFORT_LEVELS union enforced at the boundary.
  model?: string;
  effortLevel?: string;
  stoppedAt?: string | null;
  agentRole?: string | null;
  teamName?: string | null;
  parentSessionId?: string | null;
  sessionType?: 'pm' | 'raw';
  transcriptPath?: string | null;
  transcriptPaths?: string[];
  stationId?: string | null;
}

// Columns whose values aren't primitive strings/numbers — SQLite doesn't
// have a native JSON type, so we serialize to text on write and parse on
// read (rowToSession handles the parse side).
const serializeCol = (col: string, value: unknown): unknown => {
  if (col === 'transcript_paths' && Array.isArray(value)) return JSON.stringify(value);
  return value;
};

// Keys in the DB schema order — the SQL generator uses this array to build
// both the INSERT column list and the ON CONFLICT update list.
const SESSION_COL_MAP: Array<{ col: string; key: keyof UpsertSessionInput }> = [
  { col: 'name',              key: 'name' },
  { col: 'tmux_session',      key: 'tmuxSession' },
  { col: 'project_path',      key: 'projectPath' },
  { col: 'claude_session_id', key: 'claudeSessionId' },
  { col: 'status',            key: 'status' },
  { col: 'model',             key: 'model' },
  { col: 'stopped_at',        key: 'stoppedAt' },
  { col: 'station_id',        key: 'stationId' },
  { col: 'agent_role',        key: 'agentRole' },
  { col: 'transcript_path',   key: 'transcriptPath' },
  { col: 'transcript_paths',  key: 'transcriptPaths' },
  { col: 'effort_level',      key: 'effortLevel' },
  { col: 'parent_session_id', key: 'parentSessionId' },
  { col: 'team_name',         key: 'teamName' },
  { col: 'session_type',      key: 'sessionType' },
];

export const sessionService = {
  // Single write surface for every caller that wants to create or modify a
  // session row. Takes a sparse input — only the keys the caller sets end up
  // in the SQL. Defaults live here (status='idle', sessionType='raw', …) so
  // every path through the service applies the same rules and there's no
  // repeat of the #175 class of bug where two INSERT sites diverged.
  upsertSession(input: UpsertSessionInput): Session {
    const db = getDb();
    const now = new Date().toISOString();
    const provided = SESSION_COL_MAP.filter(({ key }) => input[key] !== undefined);
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(input.id) as { id: string } | undefined;

    if (existing) {
      // Sparse UPDATE — only the fields the caller actually provided. Uses
      // the parameterized path rather than INSERT ... ON CONFLICT because
      // SQLite evaluates NOT NULL constraints on the INSERT attempt BEFORE
      // resolving the conflict, which would 500 any partial update
      // (e.g. rotation detector touching only claude_session_id).
      if (provided.length === 0) {
        // Nothing to change — just bump updated_at for signal.
        db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, input.id);
      } else {
        const sets = provided.map(({ col }) => `${col} = ?`).concat(['updated_at = ?']).join(', ');
        const vals = provided.map(({ col, key }) => serializeCol(col, input[key]));
        vals.push(now);
        vals.push(input.id);
        db.prepare(`UPDATE sessions SET ${sets} WHERE id = ?`).run(...vals);
      }
      return this.getSession(input.id)!;
    }

    // Fresh INSERT — defaults only applied here, never on update.
    // Commander-spawned sessions use the 4.7 matrix defaults (xhigh effort,
    // opus 4.7) instead of reading settings.json. The user's CLI default
    // (getClaudeEffortLevel()) may differ from what Commander sessions want.
    const defaults: Partial<Record<string, unknown>> = {
      status: 'idle',
      model: 'claude-opus-4-7',
      effort_level: 'xhigh',
      session_type: 'raw',
    };

    const insertCols = ['id', 'created_at', 'updated_at'];
    const insertVals: unknown[] = [input.id, now, now];
    const placeholders = ['?', '?', '?'];

    for (const { col, key } of SESSION_COL_MAP) {
      const value = input[key];
      if (value !== undefined) {
        insertCols.push(col);
        insertVals.push(serializeCol(col, value));
        placeholders.push('?');
      } else if (col in defaults) {
        insertCols.push(col);
        insertVals.push(defaults[col]);
        placeholders.push('?');
      }
    }

    db.prepare(
      `INSERT INTO sessions (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    ).run(...insertVals);

    return this.getSession(input.id)!;
  },

  createSession(opts: CreateSessionOpts): Session {
    const db = getDb();
    const id = uuidv4();
    const slug = opts.name || generateSlug();
    const tmuxName = generateTmuxName(id);
    const model = opts.model || 'claude-opus-4-7';

    // Create tmux session (in project directory if specified)
    tmuxService.createSession(tmuxName, opts.projectPath);

    // Auto-start Claude Code in the tmux session. The model string can
    // carry brackets (`[1m]` for 1M context) which zsh/bash glob-expand
    // if unquoted — single-quote the value so strict shells don't error.
    const modelFlag = model ? `--model '${model}'` : '';
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

    // Persist via the single write surface so defaults + column order stay
    // centralized in upsertSession. Standalone sessions boot 'working' —
    // tmux + claude launched above — so the poller's first cycle reflects
    // truth instead of bouncing idle→working.
    //
    // The row insert and the 'created' event log are wrapped in a
    // transaction so a process crash between them can never produce an
    // orphan row without its audit entry (audit #205 scenario 13).
    const sessionType: 'pm' | 'raw' = opts.sessionType ?? 'raw';
    try {
      db.transaction(() => {
        this.upsertSession({
          id,
          name: slug,
          tmuxSession: tmuxName,
          projectPath: opts.projectPath ?? null,
          status: 'working',
          model,
          effortLevel: 'xhigh',
          sessionType,
        });
        db.prepare(`
          INSERT INTO session_events (session_id, event, detail)
          VALUES (?, 'created', ?)
        `).run(id, JSON.stringify({ name: slug, tmuxSession: tmuxName, projectPath: opts.projectPath, claudeCmd }));
      })();
    } catch (err) {
      // DB transaction rolled back — kill the tmux session we spawned
      // above so the orphan pane doesn't linger without a Commander row
      // tracking it. Log both the root cause and the cleanup outcome so
      // we can tell a partial-write failure from a tmux-not-found one.
      console.error(`[sessions] createSession txn failed for ${id.slice(0, 8)}:`, (err as Error).message);
      try {
        if (tmuxService.hasSession(tmuxName)) tmuxService.killSession(tmuxName);
        console.log(`[sessions] orphan tmux ${tmuxName} killed after txn failure`);
      } catch (killErr) {
        console.warn(`[sessions] orphan tmux ${tmuxName} cleanup failed:`, (killErr as Error).message);
      }
      throw err;
    }

    // Post-boot injection — every new session gets `/effort xhigh` as the first
    // slash command so both PM and raw sessions run at max effort by default.
    // PM sessions additionally get their bootstrap prompt sent after the
    // effort ack renders so `/pm` loads at max.
    const shortId = id.slice(0, 8);
    const bootstrap = sessionType === 'pm' ? readPmBootstrap() : null;
    if (sessionType === 'pm' && !bootstrap) {
      console.warn(`[sessions] ${shortId} PM session requested but ${PM_BOOTSTRAP_PATH} missing`);
    }

    (async () => {
      const ready = await waitForClaudeReady(tmuxName);
      if (!ready) {
        console.warn(`[sessions] ${shortId} post-boot injection skipped — Claude did not become ready`);
        return;
      }
      try {
        tmuxService.sendKeys(tmuxName, '/effort xhigh');
        console.log(`[sessions] ${shortId} effort set to max`);
      } catch (err) {
        console.warn(`[sessions] ${shortId} /effort xhigh send failed:`, (err as Error).message);
      }
      if (bootstrap) {
        // Wait for Claude to acknowledge the /effort command before firing
        // the bootstrap so the two don't concatenate into one input line.
        await new Promise((r) => setTimeout(r, 800));
        try {
          tmuxService.sendKeys(tmuxName, bootstrap);
          console.log(`[sessions] ${shortId} PM bootstrap injected`);
        } catch (err) {
          console.warn(`[sessions] ${shortId} PM bootstrap send failed:`, (err as Error).message);
        }
      }
    })().catch(() => {});

    const session = this.getSession(id)!;
    eventBus.emitSessionCreated(session);
    return session;
  },

  // Add a JSONL transcript to a session's ordered path list. Idempotent —
  // calling twice with the same path is a no-op. Used by the hook-event
  // route every time Claude Code fires a Stop/PostToolUse hook carrying
  // a transcript_path. Replaces the old rotation-detector heuristics with
  // a deterministic append.
  appendTranscriptPath(sessionId: string, path: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT transcript_paths FROM sessions WHERE id = ?').get(sessionId) as
      | { transcript_paths: string }
      | undefined;
    if (!row) return false;
    const existing = parseTranscriptPaths(row.transcript_paths);
    if (existing.includes(path)) return false;
    const next = [...existing, path];
    db.prepare(
      "UPDATE sessions SET transcript_paths = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(next), sessionId);
    return true;
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
    // Optional on re-upserts (e.g. mid-lifecycle pane heal) so a prior
    // derivation (parent-PM-inherited name, adoption) isn't clobbered
    // back to the config's raw name. Fresh spawns should always pass it.
    name?: string;
    tmuxTarget: string;
    projectPath: string | null;
    role: string;
    teamName: string;
    parentSessionId: string | null;
    model?: string;
    live: boolean;
  }): Session {
    const db = getDb();
    // Compute live-aware status BEFORE calling the generic upserter so the
    // mechanical write surface doesn't need to know about teammate lifecycle.
    const existing = db.prepare('SELECT status, stopped_at, tmux_session FROM sessions WHERE id = ?').get(opts.sessionId) as
      | { status: string; stopped_at: string | null; tmux_session: string }
      | undefined;

    let statusOverride: SessionStatus | undefined;
    let stoppedAtOverride: string | null | undefined;
    if (existing) {
      // Only flip status from 'stopped' to 'idle' when we have evidence of
      // life. Otherwise preserve whatever the poller / hooks have set.
      if (opts.live && existing.status === 'stopped') {
        statusOverride = 'idle';
        stoppedAtOverride = null;
      }
    } else {
      // Fresh row — idle when alive, stopped otherwise.
      statusOverride = opts.live ? 'idle' : 'stopped';
      stoppedAtOverride = opts.live ? null : new Date().toISOString();
    }

    // Sentinel-protection: if the caller is passing in a `agent:<id>`
    // sentinel but the existing row already carries a real pane id
    // (`%NN`), keep the real pane. This prevents a stale team-config
    // write (empty tmuxPaneId) from silently demoting a working
    // teammate back to a non-sendable sentinel target.
    const incomingIsSentinel = opts.tmuxTarget.startsWith('agent:');
    const existingIsRealPane = !!existing && existing.tmux_session.startsWith('%');
    const tmuxTarget = incomingIsSentinel && existingIsRealPane
      ? existing.tmux_session
      : opts.tmuxTarget;

    this.upsertSession({
      id: opts.sessionId,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      tmuxSession: tmuxTarget,
      projectPath: opts.projectPath,
      model: opts.model,
      agentRole: opts.role,
      teamName: opts.teamName,
      parentSessionId: opts.parentSessionId,
      ...(statusOverride !== undefined ? { status: statusOverride } : {}),
      ...(stoppedAtOverride !== undefined ? { stoppedAt: stoppedAtOverride } : {}),
    });

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

  // Locate a still-alive, Commander-created PM session at a given cwd that
  // hasn't yet been linked to any team. Used by the team-config ingestion
  // path to adopt an existing "PM - <something>" session instead of
  // spawning a duplicate "team-lead" row when the orchestrator writes a
  // team config in a cwd the user already has a PM for.
  //
  // Matching is NOT strict equality — a team config at
  // `/OvaGas-ERP/apps/jstudio-base` should adopt a PM at `/OvaGas-ERP`.
  // Tightness preference: exact > config-descends-from-PM > PM-descends-
  // from-config. The `/` boundary guard in descendantOf prevents
  // `/Projects/A` from ever matching `/Projects/AB`.
  findAdoptablePmAtCwd(cwd: string): Session | null {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM sessions
       WHERE session_type = 'pm'
         AND project_path IS NOT NULL
         AND (team_name IS NULL OR team_name = '')
         AND status != 'stopped'
       ORDER BY updated_at DESC`,
    ).all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;

    const descendantOf = (child: string, parent: string): boolean => {
      if (child === parent) return true;
      const p = parent.endsWith('/') ? parent : parent + '/';
      return child.startsWith(p);
    };

    // Score: 0 = exact, 1 = config-path descends from PM, 2 = PM descends
    // from config. Lower is tighter. Within a tier, the longer
    // common-prefix wins (shallower PM beats a deeper unrelated PM).
    let best: { row: Record<string, unknown>; tier: number; depth: number } | null = null;
    for (const row of rows) {
      const pmPath = row.project_path as string;
      let tier = -1;
      if (pmPath === cwd) tier = 0;
      else if (descendantOf(cwd, pmPath)) tier = 1;
      else if (descendantOf(pmPath, cwd)) tier = 2;
      if (tier < 0) continue;
      const depth = Math.abs(pmPath.length - cwd.length);
      if (!best || tier < best.tier || (tier === best.tier && depth < best.depth)) {
        best = { row, tier, depth };
      }
    }
    return best ? rowToSession(best.row) : null;
  },

  // Link an existing PM session to a team without renaming it or touching
  // its tmux target. Optionally records the team's Claude UUID as
  // claude_session_id so downstream lookups by either id resolve. Emits
  // session:updated so connected clients reflect the new team affiliation
  // immediately.
  adoptPmIntoTeam(opts: {
    sessionId: string;
    teamName: string;
    claudeSessionId?: string;
  }): Session | null {
    const db = getDb();
    const existing = db.prepare('SELECT id, claude_session_id FROM sessions WHERE id = ?')
      .get(opts.sessionId) as { id: string; claude_session_id: string | null } | undefined;
    if (!existing) return null;

    const claudeId = opts.claudeSessionId && !existing.claude_session_id
      ? opts.claudeSessionId
      : null;
    const now = new Date().toISOString();
    if (claudeId) {
      db.prepare(
        "UPDATE sessions SET team_name = ?, agent_role = 'pm', claude_session_id = ?, updated_at = ? WHERE id = ?",
      ).run(opts.teamName, claudeId, now, opts.sessionId);
    } else {
      db.prepare(
        "UPDATE sessions SET team_name = ?, agent_role = 'pm', updated_at = ? WHERE id = ?",
      ).run(opts.teamName, now, opts.sessionId);
    }
    const session = this.getSession(opts.sessionId);
    if (session) eventBus.emitSessionUpdated(session);
    return session;
  },

  // Detect whether `paneId` lives inside another Commander-managed tmux
  // session (e.g. `jsc-<uuid>`) that's already claimed by a PM row. This
  // guards the "coder is really the PM's own pane" failure mode the
  // ovagas-ui team config hit: the orchestrator wrote `tmuxPaneId: '%51'`
  // for a coder, but %51 is a pane inside jsc-e16a1cb2 which the OvaGas
  // PM owns. Without this check the coder row would silently send-key
  // the PM's own pane. Returns the owning PM session, or null.
  detectCrossSessionPaneOwner(paneId: string, excludeSessionId?: string): Session | null {
    if (!paneId.startsWith('%')) return null;
    const pane = tmuxService.listAllPanes().find((p) => p.paneId === paneId);
    if (!pane) return null;
    // Only Commander-managed tmux sessions start with `jsc-`. A pane in
    // a user's own tmux session is fine for a teammate — the user chose
    // that pane explicitly; we don't second-guess it.
    if (!pane.sessionName.startsWith('jsc-')) return null;
    const db = getDb();
    const row = db.prepare(
      "SELECT * FROM sessions WHERE tmux_session = ? AND session_type = 'pm' AND id != ? LIMIT 1",
    ).get(pane.sessionName, excludeSessionId ?? '') as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  },

  // Boot-time cleanup: any teammate row whose pane actually belongs to
  // another Commander PM's tmux session is a stale cross-session
  // reference — dismiss it so the UI doesn't render a ghost coder that
  // send-keys into the PM's own pane. Idempotent: re-run is free.
  healCrossSessionTeammates(): number {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, name, tmux_session FROM sessions WHERE parent_session_id IS NOT NULL AND tmux_session LIKE '\\%%' ESCAPE '\\' AND status != 'stopped'",
    ).all() as Array<{ id: string; name: string; tmux_session: string }>;
    let healed = 0;
    for (const r of rows) {
      const owner = this.detectCrossSessionPaneOwner(r.tmux_session, r.id);
      if (owner) {
        console.log(`[startup-heal] dismissing ${r.name} (${r.id.slice(0, 20)}) — pane ${r.tmux_session} belongs to PM "${owner.name}"`);
        this.markTeammateDismissed(r.id);
        healed += 1;
      }
    }
    return healed;
  },

  // For every session whose tmux_session is an `agent:<agentId>` sentinel,
  // try to find a real tmux pane whose cwd matches project_path. If exactly
  // one candidate pane exists (and isn't already claimed by another session
  // row), adopt its pane id as the tmux target so send-keys starts working.
  // Runs on boot + after each team-config reconcile.
  resolveSentinelTargets(): number {
    const db = getDb();
    // Scan every sentinel row regardless of status — a 'stopped' sentinel is
    // the most common case (no live evidence at insert time), yet it's
    // exactly when we need to keep trying: if a pane with matching cwd
    // exists, that's fresh evidence. The poller's pane-target branch will
    // then un-stick status from 'stopped' on its next cycle.
    const sentinels = db.prepare(
      "SELECT id, project_path FROM sessions WHERE tmux_session LIKE 'agent:%' AND project_path IS NOT NULL"
    ).all() as Array<{ id: string; project_path: string }>;
    if (sentinels.length === 0) return 0;

    const claimed = new Set(
      (db.prepare("SELECT tmux_session FROM sessions WHERE tmux_session LIKE '\\%%' ESCAPE '\\'").all() as Array<{ tmux_session: string }>)
        .map((r) => r.tmux_session),
    );
    const panes = tmuxService.listAllPanes();
    let resolved = 0;
    for (const s of sentinels) {
      const candidates = panes.filter((p) => p.cwd === s.project_path && !claimed.has(p.paneId));
      if (candidates.length !== 1) continue;
      const paneId = candidates[0]!.paneId;
      db.prepare("UPDATE sessions SET tmux_session = ?, updated_at = datetime('now') WHERE id = ?")
        .run(paneId, s.id);
      claimed.add(paneId);
      resolved += 1;
      console.log(`[sessions] resolved sentinel → ${paneId} for ${s.id.slice(0, 30)} (cwd=${s.project_path.split('/').pop()})`);
      const fresh = this.getSession(s.id);
      if (fresh) eventBus.emitSessionUpdated(fresh);
    }
    return resolved;
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
    eventBus.emitTeammateDismissed(sessionId);
    const fresh = this.getSession(sessionId);
    if (fresh) eventBus.emitSessionUpdated(fresh);
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
    // Atomic status flip + audit entry — see createSession comment.
    db.transaction(() => {
      db.prepare(`
        UPDATE sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, id);
      db.prepare(`
        INSERT INTO session_events (session_id, event, detail)
        VALUES (?, 'killed', ?)
      `).run(id, JSON.stringify({ reason: 'user_requested' }));
    })();

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

  // Manual re-sync for the "refresh chat" button (#237). Re-detects status
  // against live tmux, re-counts JSONL messages across all tracked
  // transcript paths, and emits a session:updated so every subscribed
  // client patches at once. Returns null on missing session so the route
  // can 404 cleanly.
  rescan(id: string): { status: SessionStatus; messageCount: number; transcriptMtime: string | null } | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const session = rowToSession(row);
    const now = new Date().toISOString();

    // Status rescan: mirrors getSessionStatus so the poller's next tick
    // doesn't overwrite the fresh read.
    let status: SessionStatus = session.status;
    if (session.status !== 'stopped') {
      status = tmuxService.hasSession(session.tmuxSession)
        ? agentStatusService.detectStatus(session.tmuxSession)
        : 'stopped';
    }

    // Transcript stats: sum line counts across all tracked JSONL files and
    // pick the latest mtime as the "last activity" signal.
    let messageCount = 0;
    let latestMtimeMs = 0;
    for (const path of session.transcriptPaths) {
      if (!existsSync(path)) continue;
      try {
        const contents = readFileSync(path, 'utf-8');
        // JSONL: one event per line; ignore trailing newline.
        messageCount += contents.length > 0
          ? contents.split('\n').filter((l) => l.length > 0).length
          : 0;
        const mtime = statSync(path).mtimeMs;
        if (mtime > latestMtimeMs) latestMtimeMs = mtime;
      } catch {
        /* unreadable transcript — skip */
      }
    }
    const transcriptMtime = latestMtimeMs > 0 ? new Date(latestMtimeMs).toISOString() : null;

    // Persist the fresh status if it drifted; always bump updated_at so
    // the client sees a changed row and can invalidate caches.
    if (status !== session.status) {
      db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    } else {
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, id);
    }

    // Emit session:updated so every WS subscriber reconciles without polling.
    const fresh = this.getSession(id);
    if (fresh) eventBus.emitSessionUpdated(fresh);

    return { status, messageCount, transcriptMtime };
  },

  // Removes stopped teammate rows (parent_session_id != NULL) whose stopped_at
  // is older than 7 days. Top-level sessions are never deleted by this hook —
  // they're the user's history. Returns the number of rows deleted.
  cleanupStaleTeammates(): number {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM sessions
      WHERE status = 'stopped'
        AND parent_session_id IS NOT NULL
        AND stopped_at IS NOT NULL
        AND stopped_at < datetime('now', '-7 days')
    `).run();
    return result.changes;
  },
};
