import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { watch as chokidarWatch } from 'chokidar';
import type { Session, SessionStatus, EffortLevel, SessionType } from '@commander/shared';
import { SESSION_TYPE_EFFORT_DEFAULTS, DEFAULT_MODEL } from '@commander/shared';
import { config } from '../config.js';
import { jsonlDiscoveryService } from './jsonl-discovery.service.js';

// Coerce any malformed effort_level value (NULL from a row that pre-
// dates the column default migration, junk from direct SQL) to a valid
// EffortLevel. The boot heal migration in connection.ts handles
// persisted rows; this handles the in-memory read path so a stale row
// never breaks the typed API. Issue 8 Part 2: 'low' is now first-class
// (the CLI always accepted it; Commander now exposes it) — preserve
// as-is rather than silently upgrading to xhigh.
const normalizeEffortLevel = (raw: string | null | undefined): EffortLevel => {
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' || raw === 'max') return raw;
  return 'xhigh';
};
import { getDb } from '../db/connection.js';
import { tmuxService } from './tmux.service.js';
import { agentStatusService } from './agent-status.service.js';
import { eventBus } from '../ws/event-bus.js';
import { isCrossSessionPaneOwner } from './cross-session.js';
import { removeSessionUploads } from '../routes/upload.routes.js';

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

// Phase N.2 — positive check that a team's config file still exists on
// disk. Used to gate sentinel resolution and boot-time orphan cleanup so
// sessions whose team directory was removed from `~/.claude/teams/` don't
// keep claiming tmux panes that live team members need. Exported (via
// module closure) so tests can inject a substitute.
const teamConfigExistsOnDisk = (teamName: string | null | undefined): boolean => {
  if (!teamName) return false;
  return existsSync(join(homedir(), '.claude', 'teams', teamName, 'config.json'));
};

interface CreateSessionOpts {
  name?: string;
  projectPath?: string;
  model?: string;
  sessionType?: SessionType;
  // Phase M1 — optional per-call override of the effort level Commander
  // injects post-boot. Normally `SESSION_TYPE_EFFORT_DEFAULTS` drives it;
  // supplying this value wins so callers can request a non-default (e.g.
  // an orchestrator spawning a coder session at xhigh for a hairy phase).
  effortLevel?: EffortLevel;
}

// Per-session-type bootstrap prompts under ~/.claude/prompts/. Absent
// files return null — the spawn path logs a warning and continues so
// missing bootstrap content never blocks session creation. 'raw'
// intentionally has no bootstrap.
const BOOTSTRAP_PATHS: Record<SessionType, string | null> = {
  pm: join(homedir(), '.claude', 'prompts', 'pm-session-bootstrap.md'),
  coder: join(homedir(), '.claude', 'prompts', 'coder-session-bootstrap.md'),
  raw: null,
};

const readSessionBootstrap = (sessionType: SessionType): string | null => {
  const path = BOOTSTRAP_PATHS[sessionType];
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8').trim();
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
  sessionType: ((row.session_type as string) ?? 'raw') as SessionType,
  transcriptPaths: parseTranscriptPaths(row.transcript_paths),
  lastActivityAt: Number(row.last_activity_at ?? 0),
  // SQLite has no boolean type — the column is INTEGER 0/1. Default
  // to true for legacy rows that pre-date the column (the migration
  // defaults new rows to 1, but reading a pre-migration row with the
  // column absent yields undefined here).
  autoCompactEnabled: row.auto_compact_enabled === undefined
    ? true
    : Number(row.auto_compact_enabled) !== 0,
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
  sessionType?: SessionType;
  transcriptPaths?: string[];
  stationId?: string | null;
  // SQLite stores this as INTEGER 0/1. Callers pass boolean; the
  // serializer below coerces. Undefined leaves the existing value
  // untouched (sparse-update semantics).
  autoCompactEnabled?: boolean;
}

// Columns whose values aren't primitive strings/numbers — SQLite doesn't
// have a native JSON type, so we serialize to text on write and parse on
// read (rowToSession handles the parse side).
const serializeCol = (col: string, value: unknown): unknown => {
  if (col === 'transcript_paths' && Array.isArray(value)) return JSON.stringify(value);
  if (col === 'auto_compact_enabled' && typeof value === 'boolean') return value ? 1 : 0;
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
  { col: 'transcript_paths',  key: 'transcriptPaths' },
  { col: 'effort_level',      key: 'effortLevel' },
  { col: 'parent_session_id', key: 'parentSessionId' },
  { col: 'team_name',         key: 'teamName' },
  { col: 'session_type',      key: 'sessionType' },
  { col: 'auto_compact_enabled', key: 'autoCompactEnabled' },
];

// Phase T Patch 0 — UUID shape of Claude Code's JSONL filenames. A
// directory-scoped add-event must match this before we bind — Claude
// Code only writes UUID-named JSONLs, but filtering here guards against
// spurious unrelated files that happen to show up in the encoded-cwd
// directory.
const CLAUDE_JSONL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const SPAWN_BIND_TIMEOUT_MS = 30_000;

// Issue 6 — produce the canonical absolute cwd for a Commander-spawned
// session. Two sources: the caller's `opts.projectPath` (may be undefined,
// empty, or contain a leading `~`) and the tmux pane's actual
// `pane_current_path` (resolved at spawn). Returns the normalized string
// to store in `sessions.project_path` AND pass to
// bindClaudeSessionFromJsonl.
//
// Normalization matters because Claude Code's hook events carry `cwd`
// without a trailing slash, and resolveOwner.cwd-exclusive compares
// with `project_path = ?` — a stored `/tmp/abc/` would never match a
// hook's `/tmp/abc`. The helper collapses trailing slashes and expands
// leading `~` so stored paths are byte-for-byte identical to what
// Claude sends.
export const resolveSessionCwd = (
  userInput: string | undefined | null,
  paneCwd: string | null,
): string | null => {
  const normalize = (s: string): string | null => {
    const stripped = s.replace(/\/+$/, '');
    return stripped.length > 0 ? stripped : null;
  };
  // Issue 15.2 — extend the §23.3 SSOT invariant to include realpath
  // resolution. `fs.realpathSync` follows symlinks so macOS `/tmp` →
  // `/private/tmp` (and any other symlinked cwd) canonicalizes to the
  // same absolute form Claude Code uses when it encodes its JSONL
  // directory (`~/.claude/projects/<encoded-realpath>/`). Without this,
  // `bindClaudeSessionFromJsonl` watches the symlink-encoded dir, the
  // real JSONL file lands under a different encoding, the watcher
  // times out, and `claude_session_id` never binds.
  //
  // Non-existent paths throw from realpathSync — fall back to the
  // canonical (slash-normalized + tilde-expanded) form so a typo in
  // `opts.projectPath` still produces a writable stored value rather
  // than crashing the spawn path.
  const canonicalize = (s: string | null): string | null => {
    if (!s) return null;
    try {
      return realpathSync(s);
    } catch {
      return s;
    }
  };
  if (userInput && userInput.trim().length > 0) {
    const t = userInput.trim();
    const expanded = t === '~' ? homedir()
                   : t.startsWith('~/') ? join(homedir(), t.slice(2))
                   : t;
    const out = canonicalize(normalize(expanded));
    if (out) return out;
  }
  return canonicalize(paneCwd ? normalize(paneCwd) : null);
};

// Watch the encoded-cwd directory under ~/.claude/projects/ and bind
// the first new JSONL file Claude Code creates to this Commander
// session row. Closes the gap between spawn (tmux pane created) and
// first hook event, during which `resolveOwner` would otherwise drop
// events for Commander-spawned sessions because `claude_session_id`
// is still NULL (CTO snapshot §7).
//
// Fire-and-forget — failure falls through to the existing 5-strategy
// resolveOwner cascade and logs a warn. Idempotent on re-entry: if a
// subsequent event fires after we've already bound (first JSONL seen),
// we close and clear.
const bindClaudeSessionFromJsonl = (sessionId: string, cwd: string | null): void => {
  if (!cwd) return; // No cwd → Claude writes to its own default dir; we can't predict it.
  const encoded = jsonlDiscoveryService.encodeProjectPath(cwd);
  const dir = join(config.claudeProjectsDir, encoded);
  try { mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }

  const startedAt = Date.now();
  const shortId = sessionId.slice(0, 8);
  let bound = false;

  const watcher = chokidarWatch(dir, {
    depth: 0,
    ignoreInitial: true,
    persistent: false, // don't keep the event loop alive if the process tries to exit
    // Don't filter via `ignored` — chokidar v4 runs the predicate against
    // the watched directory itself (which doesn't end in .jsonl), and a
    // naïve filter would ignore the whole dir. The add handler below
    // filters by filename pattern instead.
  });

  const cleanup = (): void => {
    clearTimeout(timer);
    watcher.close().catch(() => { /* noop */ });
  };

  const timer = setTimeout(() => {
    if (bound) return;
    console.warn(
      `[spawn-bind] session=${shortId} cwd=${cwd} — no JSONL file appeared in ` +
      `${Math.round(SPAWN_BIND_TIMEOUT_MS / 1000)}s; Claude Code may not have started. ` +
      `Falling back to existing resolveOwner cascade.`,
    );
    cleanup();
  }, SPAWN_BIND_TIMEOUT_MS);

  watcher.on('add', (filePath: string) => {
    if (bound) return;
    const fname = basename(filePath);
    if (!CLAUDE_JSONL_UUID_RE.test(fname)) return;
    const uuid = fname.replace(/\.jsonl$/i, '');
    bound = true;
    cleanup();

    // eventBus + sessionService are legal at runtime — this function is
    // called from inside createSession, long after the module exports
    // have resolved. Using sessionService.* keeps all DB writes funneled
    // through the single upsert surface so column defaults stay honest.
    try {
      sessionService.upsertSession({ id: sessionId, claudeSessionId: uuid });
      sessionService.appendTranscriptPath(sessionId, filePath);
      const row = sessionService.getSession(sessionId);
      if (row) eventBus.emitSessionUpdated(row);
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[spawn-bind] session=${shortId} → claude_session_id=${uuid} (bound in ${elapsedSec}s)`,
      );
    } catch (err) {
      console.warn(`[spawn-bind] session=${shortId} write failed: ${(err as Error).message}`);
    }
  });

  watcher.on('error', (err) => {
    if (bound) return;
    console.warn(`[spawn-bind] session=${shortId} watcher error: ${(err as Error).message}`);
  });
};

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
      model: DEFAULT_MODEL,
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
    const model = opts.model || DEFAULT_MODEL;

    // Issue 10 — canonicalize user input BEFORE spawning tmux. `tmux
    // new-session -c <cwd>` runs via `execFile` (no shell) so a literal
    // `~/...` path is NEVER expanded by tmux; it silently falls back to
    // $HOME. Pre-Issue-10 we passed `opts.projectPath` raw, so a modal-
    // submitted `~/Desktop/Projects/JSTUDIO/` put Claude in `$HOME`, and
    // every downstream step (JSONL bind watcher, project-scoped bootstrap
    // instructions like "read PROJECT_DOCUMENTATION.md") broke despite
    // /effort + bootstrap themselves injecting successfully.
    //
    // resolveSessionCwd (lifted from Issue 6) already does tilde expansion
    // + trailing-slash normalization. Call it with paneCwd=null so the
    // user input alone drives the pre-spawn cwd; after pane id resolves
    // below we re-call with the real paneCwd to fill in the absent-input
    // case.
    const inputCwd = resolveSessionCwd(opts.projectPath, null);
    tmuxService.createSession(tmuxName, inputCwd ?? undefined);

    // Phase S.1 Patch 1 — resolve the first pane id of the just-created
    // tmux session and persist THAT in `tmux_session`. Without this step
    // the column stored the session name (`jsc-<uuid>`), and every later
    // `send-keys -t <session-name>` routed to whichever pane was active
    // when the command ran — PM messages leaked into a sibling coder
    // pane as soon as the user focused the coder (OvaGas bug).
    //
    // Falls back to the session name with a warn when resolution fails
    // (tmux race, pane not yet reported). The boot-time heal re-tries
    // on the next restart so a transient miss self-corrects.
    const resolvedPaneId = tmuxService.resolveFirstPaneId(tmuxName);
    if (!resolvedPaneId) {
      console.warn(
        `[sessions] createSession(${tmuxName}) — resolveFirstPaneId returned null; ` +
        `storing session name as fallback. Boot-time heal will retry.`,
      );
    }
    const sendTarget = resolvedPaneId ?? tmuxName;

    // Issue 6 — query the pane's real cwd, then let resolveSessionCwd decide:
    // user input wins when provided (tilde-expanded, slash-normalized), else
    // pane cwd is the source of truth. Either way, `canonicalCwd` is what we
    // use for BOTH the watcher and the row's project_path column.
    // (Issue 10 note: `inputCwd` already reflects the tilde-expanded user
    // value, so this call is idempotent when opts.projectPath is set — it
    // only earns its keep when opts.projectPath is empty and we need
    // paneCwd as the fallback.)
    const paneCwd = resolvedPaneId ? tmuxService.resolvePaneCwd(resolvedPaneId) : null;
    const canonicalCwd = resolveSessionCwd(opts.projectPath, paneCwd);
    if (!canonicalCwd) {
      console.warn(
        `[sessions] createSession(${tmuxName}) — could not resolve cwd ` +
        `(input=${opts.projectPath ?? 'null'} pane=${paneCwd ?? 'null'}); ` +
        `hook events for this session will not bind via cwd-exclusive strategy.`,
      );
    }

    // Auto-start Claude Code in the tmux session. The model string can
    // carry brackets (`[1m]` for 1M context) which zsh/bash glob-expand
    // if unquoted — single-quote the value so strict shells don't error.
    const modelFlag = model ? `--model '${model}'` : '';
    const claudeCmd = `claude ${modelFlag}`.trim();

    // Phase T Patch 0 — start the JSONL-dir watcher BEFORE sending the
    // `claude` keystroke so the first add-event cannot race past us.
    // Claude Code creates `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`
    // on first turn; binding on the add-event gives resolveOwner's primary
    // strategy an O(1) claude_session_id hit from the very first hook.
    bindClaudeSessionFromJsonl(id, canonicalCwd);

    // Small delay to let the shell initialize, then send the claude command
    setTimeout(() => {
      try {
        tmuxService.sendKeys(sendTarget, claudeCmd);

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
    const sessionType: SessionType = opts.sessionType ?? 'raw';
    // Phase M1 — effort level is per-session-type (pm=high, coder/raw=medium)
    // unless the caller explicitly overrides. Single source of truth:
    // SESSION_TYPE_EFFORT_DEFAULTS in @commander/shared.
    const effortLevel: EffortLevel = opts.effortLevel ?? SESSION_TYPE_EFFORT_DEFAULTS[sessionType];
    try {
      db.transaction(() => {
        this.upsertSession({
          id,
          name: slug,
          tmuxSession: sendTarget,
          projectPath: canonicalCwd,
          status: 'working',
          model,
          effortLevel,
          sessionType,
        });
        db.prepare(`
          INSERT INTO session_events (session_id, event, detail)
          VALUES (?, 'created', ?)
        `).run(id, JSON.stringify({
          name: slug,
          tmuxSession: sendTarget,
          tmuxSessionName: tmuxName,
          projectPath: canonicalCwd,
          claudeCmd,
        }));
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

    // Post-boot injection — every new session gets `/effort <level>` as its
    // first slash command, where <level> is sourced from the per-session-type
    // matrix (Phase M1). PM + Coder sessions additionally get their bootstrap
    // prompt sent after the effort ack renders.
    const shortId = id.slice(0, 8);
    const bootstrap = readSessionBootstrap(sessionType);
    const bootstrapPath = BOOTSTRAP_PATHS[sessionType];
    if (bootstrapPath && !bootstrap) {
      console.warn(`[sessions] ${shortId} ${sessionType} session requested but ${bootstrapPath} missing`);
    }

    (async () => {
      const ready = await waitForClaudeReady(sendTarget);
      if (!ready) {
        console.warn(`[sessions] ${shortId} post-boot injection skipped — Claude did not become ready`);
        return;
      }
      try {
        tmuxService.sendKeys(sendTarget, `/effort ${effortLevel}`);
        console.log(`[sessions] ${shortId} effort set to ${effortLevel} (${sessionType})`);
      } catch (err) {
        console.warn(`[sessions] ${shortId} /effort ${effortLevel} send failed:`, (err as Error).message);
      }
      if (bootstrap) {
        // Wait for Claude to acknowledge the /effort command before firing
        // the bootstrap so the two don't concatenate into one input line.
        await new Promise((r) => setTimeout(r, 800));
        try {
          tmuxService.sendKeys(sendTarget, bootstrap);
          console.log(`[sessions] ${shortId} ${sessionType} bootstrap injected`);
        } catch (err) {
          console.warn(`[sessions] ${shortId} ${sessionType} bootstrap send failed:`, (err as Error).message);
        }
      }
    })().catch(() => {});

    const session = this.getSession(id)!;
    eventBus.emitSessionCreated(session);
    return session;
  },

  // Phase N.0 Patch 3 — single write surface for heartbeat. Every
  // inbound signal (hook, tick, JSONL append, poller flip) funnels
  // through here so the column stays consistent + the WS broadcast
  // fires in lock-step with the DB write. Fire-and-forget — callers
  // should treat it as a proof-of-life pulse, not load-bearing.
  // Returns the epoch-ms timestamp written.
  bumpLastActivity(sessionId: string): number {
    const db = getDb();
    const ts = Date.now();
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(ts, sessionId);
    eventBus.emitSessionHeartbeat(sessionId, ts);
    return ts;
  },

  // Phase T Patch 2 revision — write the hook-match timestamp the
  // status poller reads to gate pane-regex reclassification. Every
  // hook-event handler branch that resolves an owner (Stop,
  // SessionStart, SessionEnd, transcript-append) funnels through
  // here. Keeps the poller yield on ONE authoritative column
  // instead of piggybacking on updated_at (which the append-only
  // transcript path deliberately does NOT touch).
  bumpLastHookAt(sessionId: string): number {
    const db = getDb();
    const ts = Date.now();
    db.prepare('UPDATE sessions SET last_hook_at = ? WHERE id = ?').run(ts, sessionId);
    return ts;
  },

  // Add a JSONL transcript to a session's ordered path list. Idempotent —
  // calling twice with the same path is a no-op. Used by the hook-event
  // route every time Claude Code fires a Stop/PostToolUse hook carrying
  // a transcript_path. Replaces the old rotation-detector heuristics with
  // a deterministic append.
  // Phase P.3 H2 — append-only mutation; does NOT bump `updated_at`.
  // `updated_at` is the poller's yield gate (Phase N.0 Patch 2) — a
  // hook-fired Stop flips status to `idle` + writes updated_at, and the
  // poller yields for 10s before re-classifying from pane. If a
  // subsequent tick landing inside that window bumped updated_at for
  // appending to transcript_paths, the yield window reset and the
  // poller could flip the row back to `working` off a stale pane
  // footer. Keep updated_at reserved for status-flip semantics; append-
  // only paths like this one leave it alone.
  appendTranscriptPath(sessionId: string, path: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT transcript_paths FROM sessions WHERE id = ?').get(sessionId) as
      | { transcript_paths: string }
      | undefined;
    if (!row) return false;
    const existing = parseTranscriptPaths(row.transcript_paths);
    // Issue 11 — dedup by basename UUID, not exact path. Claude Code's
    // JSONL filename is `<claude-session-uuid>.jsonl` and the UUID is
    // globally unique to one session. On macOS case-insensitive FS a
    // project dir typed as `~/.../JSTUDIO/` vs. real-case `~/.../JStudio/`
    // encodes to two different claude-projects dirs (`-JSTUDIO-` vs.
    // `-JStudio-`) both of which resolve to the SAME physical file.
    // Commander's watcher + hook-event resolver can independently add
    // both encodings; the chat endpoint then reads the same JSONL
    // twice and every message renders twice (the bootstrap-ack dupe
    // Jose reported).
    //
    // Basename dedup is safe against legitimate multi-file transcripts
    // (session rotation produces different UUIDs per file — see the
    // rotation test below).
    const newBasename = basename(path);
    if (existing.some((p) => basename(p) === newBasename)) return false;
    const next = [...existing, path];
    db.prepare(
      'UPDATE sessions SET transcript_paths = ? WHERE id = ?',
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
  //
  // `previousLeadId` (Phase G.2): the stale lead id the team config was
  // pointing at before adoption. When provided AND distinct from the
  // adopted PM's id, all active teammates whose parent_session_id ===
  // previousLeadId get re-parented to the adopted PM, and their
  // agent_relationships are carried over (close old edge under
  // previousLeadId, open a fresh one under adopted id). Without this
  // re-parent the cross-session predicate (Phase G.1) would correctly
  // flag those teammates as cross-session because their declared parent
  // no longer matches the PM that owns their pane.
  //
  // The re-parent SQL is scoped to teamName so a stale-lead id that's
  // also (somehow) referenced by a different team's teammates can't
  // accidentally pull them in.
  adoptPmIntoTeam(opts: {
    sessionId: string;
    teamName: string;
    claudeSessionId?: string;
    previousLeadId?: string;
  }): Session | null {
    const db = getDb();
    const existing = db.prepare('SELECT id, claude_session_id FROM sessions WHERE id = ?')
      .get(opts.sessionId) as { id: string; claude_session_id: string | null } | undefined;
    if (!existing) return null;

    const claudeId = opts.claudeSessionId && !existing.claude_session_id
      ? opts.claudeSessionId
      : null;
    const now = new Date().toISOString();

    db.transaction(() => {
      if (claudeId) {
        db.prepare(
          "UPDATE sessions SET team_name = ?, agent_role = 'pm', claude_session_id = ?, updated_at = ? WHERE id = ?",
        ).run(opts.teamName, claudeId, now, opts.sessionId);
      } else {
        db.prepare(
          "UPDATE sessions SET team_name = ?, agent_role = 'pm', updated_at = ? WHERE id = ?",
        ).run(opts.teamName, now, opts.sessionId);
      }

      // Re-parent active teammates from the stale lead → adopted PM.
      // No-op when previousLeadId is missing, equal to the adopted id,
      // or no rows match. Scoped to teamName for safety so a coincidental
      // id collision across teams can't pull in foreign rows.
      const previousLeadId = opts.previousLeadId;
      if (previousLeadId && previousLeadId !== opts.sessionId) {
        const reparentedRows = db.prepare(
          `UPDATE sessions SET parent_session_id = ?, updated_at = ?
           WHERE parent_session_id = ? AND status != 'stopped' AND team_name = ?
           RETURNING id`,
        ).all(opts.sessionId, now, previousLeadId, opts.teamName) as Array<{ id: string }>;

        if (reparentedRows.length > 0) {
          // Close any active relationship rows still pointing at the stale
          // lead so listTeammates' `ended_at IS NULL` filter doesn't
          // double-count this teammate.
          db.prepare(
            "UPDATE agent_relationships SET ended_at = ? WHERE parent_session_id = ? AND ended_at IS NULL",
          ).run(now, previousLeadId);

          // Open a fresh relationship under the adopted PM for every
          // re-parented teammate. INSERT OR IGNORE handles a pre-existing
          // edge (rare but possible if a prior adoption attempt half-ran).
          const insertRel = db.prepare(
            `INSERT INTO agent_relationships (parent_session_id, child_session_id, relationship)
             VALUES (?, ?, 'spawned_by')
             ON CONFLICT(parent_session_id, child_session_id) DO UPDATE SET ended_at = NULL`,
          );
          for (const row of reparentedRows) {
            insertRel.run(opts.sessionId, row.id);
          }
          console.log(`[sessions] re-parented ${reparentedRows.length} teammate(s) from ${previousLeadId.slice(0, 20)} → ${opts.sessionId.slice(0, 20)} (team ${opts.teamName})`);
        }
      }
    })();

    const session = this.getSession(opts.sessionId);
    if (session) eventBus.emitSessionUpdated(session);
    return session;
  },

  // Detect whether `paneId` lives inside ANOTHER Commander-managed PM's
  // tmux session (`jsc-<uuid>`). Used by team-config reconcile + the
  // boot heal to guard against the "coder is really some other PM's
  // own pane" failure mode the ovagas-ui team config hit (orchestrator
  // wrote `tmuxPaneId: '%51'` for a coder, but %51 was a pane inside
  // jsc-e16a1cb2 which the OvaGas PM owned).
  //
  // Critical predicate (Phase G.1 addendum): all of these must hold or
  // we return null and leave the teammate alone:
  //   1. paneId is a real `%NN` (not a sentinel)
  //   2. tmux pane lookup succeeds (pane is alive)
  //   3. owning tmux session starts with `jsc-`  ← Commander prefix
  //      (codeman-* / user tmux sessions are NOT cross — those are
  //      legitimate parent panes for codeman-spawned teammates)
  //   4. some session row owns that tmux session AND it's session_type='pm'
  //   5. that PM's id is NOT in excludeIds — pass [teammate.id, parent.id]
  //      so a coder whose pane lives in its OWN parent's session is NOT
  //      flagged (same-session, not cross-session)
  //
  // Returns the offending owner PM session if all five hold; null otherwise.
  detectCrossSessionPaneOwner(paneId: string, excludeIds: string[] = []): Session | null {
    if (!paneId.startsWith('%')) return null;
    const pane = tmuxService.listAllPanes().find((p) => p.paneId === paneId);
    const paneFact = { sessionName: pane?.sessionName ?? null };

    let candidate: Session | null = null;
    if (paneFact.sessionName) {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM sessions WHERE tmux_session = ? LIMIT 1',
      ).get(paneFact.sessionName) as Record<string, unknown> | undefined;
      if (row) candidate = rowToSession(row);
    }

    const isCrossSession = isCrossSessionPaneOwner(
      paneFact,
      candidate ? { id: candidate.id, sessionType: candidate.sessionType } : null,
      excludeIds,
    );
    return isCrossSession ? candidate : null;
  },

  // Boot-time cleanup: any teammate row whose pane actually belongs to
  // another Commander PM's tmux session is a stale cross-session
  // reference — dismiss it so the UI doesn't render a ghost coder that
  // send-keys into the PM's own pane. Idempotent: re-run is free.
  //
  // Excludes BOTH the teammate's own id AND its parent's id from the
  // owning-PM check. Without the parent exclusion, a coder whose pane
  // legitimately lives in its parent PM's tmux session would be flagged
  // as cross-session and dismissed on every boot. The Phase G.1
  // addendum was triggered by exactly this misfire on codeman-managed
  // teams (which already short-circuit at the `jsc-*` prefix check —
  // belt-and-suspenders to also exclude same-parent for safety).
  healCrossSessionTeammates(): number {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, name, tmux_session, parent_session_id FROM sessions WHERE parent_session_id IS NOT NULL AND tmux_session LIKE '\\%%' ESCAPE '\\' AND status != 'stopped'",
    ).all() as Array<{ id: string; name: string; tmux_session: string; parent_session_id: string | null }>;
    let healed = 0;
    for (const r of rows) {
      const excludeIds = [r.id, r.parent_session_id].filter((x): x is string => !!x);
      const owner = this.detectCrossSessionPaneOwner(r.tmux_session, excludeIds);
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
  //
  // Phase N.2 collision guard: if the sentinel row carries a `team_name` and
  // that team's config.json no longer exists in `~/.claude/teams/`, the row
  // is an orphan from a deleted team — skip it. Resolving it would claim a
  // pane that the LIVE team-config member needs, then the reconcile's
  // upsertTeammateSession would hit UNIQUE(tmux_session) on insert and
  // crash startup. The `exists` predicate is injectable for tests.
  resolveSentinelTargets(opts?: { teamExists?: (teamName: string | null) => boolean }): number {
    const db = getDb();
    const teamExists = opts?.teamExists ?? teamConfigExistsOnDisk;
    // Scan every sentinel row regardless of status — a 'stopped' sentinel is
    // the most common case (no live evidence at insert time), yet it's
    // exactly when we need to keep trying: if a pane with matching cwd
    // exists, that's fresh evidence. The poller's pane-target branch will
    // then un-stick status from 'stopped' on its next cycle.
    const sentinels = db.prepare(
      "SELECT id, project_path, team_name FROM sessions WHERE tmux_session LIKE 'agent:%' AND project_path IS NOT NULL"
    ).all() as Array<{ id: string; project_path: string; team_name: string | null }>;
    if (sentinels.length === 0) return 0;

    const claimed = new Set(
      (db.prepare("SELECT tmux_session FROM sessions WHERE tmux_session LIKE '\\%%' ESCAPE '\\'").all() as Array<{ tmux_session: string }>)
        .map((r) => r.tmux_session),
    );
    const panes = tmuxService.listAllPanes();
    let resolved = 0;
    for (const s of sentinels) {
      // Skip orphan rows whose team config was removed from disk — their
      // pane belongs to a live team member now, not to them.
      if (s.team_name && !teamExists(s.team_name)) continue;
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

  // Phase N.2 boot-time self-heal: retire any session row whose `team_name`
  // references a team directory that no longer exists on disk. Flips the
  // row to a stopped, team-less historical record and frees its real-pane
  // `tmux_session` (rewritten to `retired:<id>`) so the UNIQUE constraint
  // doesn't block a live team member from claiming that pane on the next
  // reconcile. Idempotent — re-runs skip already-stopped orphans whose
  // pane has already been freed.
  healOrphanedTeamSessions(opts?: { teamExists?: (teamName: string | null) => boolean }): number {
    const db = getDb();
    const teamExists = opts?.teamExists ?? teamConfigExistsOnDisk;
    const rows = db.prepare(
      "SELECT id, name, team_name, tmux_session, status FROM sessions WHERE team_name IS NOT NULL AND team_name != ''"
    ).all() as Array<{ id: string; name: string; team_name: string; tmux_session: string; status: string }>;
    if (rows.length === 0) return 0;

    let healed = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      if (teamExists(r.team_name)) continue;
      // Already retired (team_name NULL, stopped, pane freed) — nothing to do.
      // (Re-checked here for belt-and-suspenders after predicate misses.)
      if (r.status === 'stopped' && r.tmux_session.startsWith('retired:')) continue;
      const freedPane = r.tmux_session.startsWith('%') ? `retired:${r.id}` : r.tmux_session;
      db.prepare(
        `UPDATE sessions
         SET team_name = NULL,
             status = 'stopped',
             stopped_at = COALESCE(stopped_at, ?),
             updated_at = ?,
             tmux_session = ?
         WHERE id = ?`
      ).run(now, now, freedPane, r.id);
      console.log(
        `[startup-heal] retired orphan session ${r.name || r.id.slice(0, 20)} ` +
        `(team=${r.team_name}, was ${r.tmux_session} → ${freedPane}, status ${r.status} → stopped)`
      );
      healed += 1;
    }
    return healed;
  },

  // Phase S.1 Patch 2 — boot-time heal for legacy tmux_session values
  // that are raw session names (e.g. `jsc-04bb12d7`) instead of pane
  // ids (`%NN`). Those rows were written by the pre-S.1 createSession
  // path and cause `tmux send-keys -t <session-name>` to route to
  // whichever pane is currently active — the OvaGas PM→coder message
  // leak. Run once at startup AFTER healOrphanedTeamSessions + BEFORE
  // healCrossSessionTeammates so cross-session checks can compare
  // real pane-to-PM ownership on already-corrected rows.
  //
  // For each candidate row:
  //   - `tmuxService.resolveFirstPaneId(tmux_session)` → pane id OR null.
  //   - Resolved → UPDATE tmux_session to the pane id, bump updated_at.
  //   - Unresolved (tmux session gone) → status='stopped' + stopped_at.
  //
  // Sentinel values (`agent:*`, `retired:*`, `%NN`) and already-stopped
  // rows are skipped. Idempotent: after healing, subsequent runs find
  // nothing to do.
  //
  // Returns a summary so the caller can log + telemeter.
  healLegacySessionNameTmuxTargets(): { healed: number; stopped: number } {
    const db = getDb();
    // Select non-stopped rows whose tmux_session is NOT a pane id,
    // NOT a retired sentinel, NOT an agent sentinel. `jsc-*` session
    // names are the primary target; arbitrary user tmux session names
    // would also match (e.g. a user attached a custom session via the
    // orphan-discovery path). Both classes get the same treatment.
    const rows = db.prepare(
      `SELECT id, name, tmux_session FROM sessions
       WHERE status != 'stopped'
         AND tmux_session NOT LIKE '\\%%' ESCAPE '\\'
         AND tmux_session NOT LIKE 'retired:%'
         AND tmux_session NOT LIKE 'agent:%'`,
    ).all() as Array<{ id: string; name: string; tmux_session: string }>;
    if (rows.length === 0) return { healed: 0, stopped: 0 };

    let healed = 0;
    let stopped = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
      const paneId = tmuxService.resolveFirstPaneId(r.tmux_session);
      if (paneId) {
        db.prepare(
          "UPDATE sessions SET tmux_session = ?, updated_at = ? WHERE id = ?",
        ).run(paneId, now, r.id);
        console.log(
          `[startup-heal] tmux_session healed ${r.name || r.id.slice(0, 20)} — ${r.tmux_session} → ${paneId}`,
        );
        healed += 1;
        const fresh = this.getSession(r.id);
        if (fresh) eventBus.emitSessionUpdated(fresh);
      } else {
        db.prepare(
          "UPDATE sessions SET status = 'stopped', stopped_at = COALESCE(stopped_at, ?), updated_at = ? WHERE id = ?",
        ).run(now, now, r.id);
        console.log(
          `[startup-heal] tmux_session stale — ${r.name || r.id.slice(0, 20)} (${r.tmux_session}) → stopped (tmux session gone)`,
        );
        stopped += 1;
      }
    }
    return { healed, stopped };
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

    // Phase S — hard-delete wipes staged uploads. Soft-stopped rows
    // (the plain deleteSession path for non-team sessions) keep their
    // uploads — the user may still reference them by path in a
    // follow-up session even after the pane is gone.
    removeSessionUploads(session.id);

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
    // Phase S — collect ids first so we can wipe each session's
    // uploads dir alongside the row deletion. A bulk DELETE returns
    // only a count, which isn't enough to target the per-session
    // upload directories.
    const stale = db.prepare(`
      SELECT id FROM sessions
      WHERE status = 'stopped'
        AND parent_session_id IS NOT NULL
        AND stopped_at IS NOT NULL
        AND stopped_at < datetime('now', '-7 days')
    `).all() as Array<{ id: string }>;
    if (stale.length === 0) return 0;
    const result = db.prepare(`
      DELETE FROM sessions
      WHERE status = 'stopped'
        AND parent_session_id IS NOT NULL
        AND stopped_at IS NOT NULL
        AND stopped_at < datetime('now', '-7 days')
    `).run();
    for (const row of stale) removeSessionUploads(row.id);
    return result.changes;
  },
};
