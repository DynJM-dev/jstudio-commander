import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Teammate } from '@commander/shared';
import { eventBus } from '../ws/event-bus.js';
import { sessionService } from './session.service.js';
import { tmuxService } from './tmux.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_JSONL_MS = 10 * 60_000;

const projectDirFromCwd = (cwd: string): string =>
  join(homedir(), '.claude', 'projects', cwd.replace(/\//g, '-'));

// True iff we have real evidence this team member is alive:
//   (a) the tmuxPaneId from the config still resolves to a live tmux pane, OR
//   (b) a JSONL whose basename matches the member's Claude UUID has been
//       modified within the last LIVE_JSONL_MS (default 10 min).
// Config membership alone is NOT evidence — teams get edited and never
// cleaned up, so killed processes must stay stopped until something
// independently signals they're back.
const hasLiveEvidence = (opts: { tmuxPaneId?: string; claudeSessionId?: string; cwd?: string }): boolean => {
  if (opts.tmuxPaneId && tmuxService.hasSession(opts.tmuxPaneId)) return true;
  if (opts.claudeSessionId && opts.cwd) {
    const jsonl = join(projectDirFromCwd(opts.cwd), `${opts.claudeSessionId}.jsonl`);
    try {
      const stat = statSync(jsonl);
      if (Date.now() - stat.mtime.getTime() < LIVE_JSONL_MS) return true;
    } catch { /* missing file → not live */ }
  }
  return false;
};

interface TeamMember {
  agentId: string;
  name: string;
  agentType?: string;
  model?: string;
  tmuxPaneId?: string;
  cwd?: string;
  color?: string;
  isActive?: boolean;
}

interface TeamConfig {
  name: string;
  leadAgentId?: string;
  leadSessionId?: string;
  members?: TeamMember[];
}

const TEAMS_DIR = join(homedir(), '.claude', 'teams');

const listConfigPaths = (): string[] => {
  if (!existsSync(TEAMS_DIR)) return [];
  const entries = readdirSync(TEAMS_DIR, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p = join(TEAMS_DIR, entry.name, 'config.json');
    if (existsSync(p)) paths.push(p);
  }
  return paths;
};

// Tracks which non-lead members we've already announced per team file. Used to
// diff on subsequent file mutations and emit only delta events.
type MemberKey = string;
const knownMembers = new Map<string, Set<MemberKey>>();
let watcher: FSWatcher | null = null;

const readConfig = (path: string): TeamConfig | null => {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as TeamConfig;
  } catch (err) {
    console.warn(`[team-config] failed to parse ${path}:`, (err as Error).message);
    return null;
  }
};

const buildTeammate = (member: TeamMember, parentSessionId: string, teamName: string): Teammate => ({
  sessionId: member.agentId,
  sessionName: member.name,
  role: member.agentType ?? 'agent',
  teamName,
  parentSessionId,
  color: member.color,
  tmuxPaneId: member.tmuxPaneId,
});

const reconcile = (path: string): void => {
  const config = readConfig(path);
  if (!config || !config.members) return;

  const teamName = config.name;
  // Parent session = lead's Commander session if known, else the lead agent id
  // (which we'll also upsert as a session row so the FK in agent_relationships
  // resolves either way).
  const parentSessionId = config.leadSessionId || config.leadAgentId;
  if (!parentSessionId) return;

  // Ensure the lead has a sessions row so agent_relationships FK is satisfied
  // when we relate teammates to it. The lead's tmux target is unknown from the
  // config (it's whatever launched the team) — store agentId as a placeholder.
  const lead = config.members.find((m) => m.agentId === config.leadAgentId);
  if (lead) {
    // For the lead, leadSessionId IS the Claude UUID when set.
    const leadClaudeId = UUID_RE.test(parentSessionId) ? parentSessionId : undefined;
    const leadLive = hasLiveEvidence({
      tmuxPaneId: lead.tmuxPaneId,
      claudeSessionId: leadClaudeId,
      cwd: lead.cwd,
    });
    sessionService.upsertTeammateSession({
      sessionId: parentSessionId,
      name: lead.name,
      tmuxTarget: lead.tmuxPaneId || `agent:${parentSessionId}`,
      projectPath: lead.cwd ?? null,
      role: lead.agentType ?? 'pm',
      teamName,
      parentSessionId: null,
      model: lead.model,
      live: leadLive,
    });
  }

  const seen = knownMembers.get(path) ?? new Set<MemberKey>();
  const next = new Set<MemberKey>();

  for (const member of config.members) {
    if (member.agentId === config.leadAgentId) continue;
    if (member.isActive === false) continue;
    next.add(member.agentId);

    if (!seen.has(member.agentId)) {
      // Teammate agentIds look like "name@team" — not Claude UUIDs. Without
      // a pane or prior claude_session_id link, we can't verify liveness,
      // so live defaults to false (honest: "we don't know yet"). The hook
      // event route will flip it to idle/working once Claude emits.
      const memberLive = hasLiveEvidence({
        tmuxPaneId: member.tmuxPaneId,
        claudeSessionId: UUID_RE.test(member.agentId) ? member.agentId : undefined,
        cwd: member.cwd,
      });
      sessionService.upsertTeammateSession({
        sessionId: member.agentId,
        name: member.name,
        tmuxTarget: member.tmuxPaneId || `agent:${member.agentId}`,
        projectPath: member.cwd ?? null,
        role: member.agentType ?? 'agent',
        teamName,
        parentSessionId,
        model: member.model,
        live: memberLive,
      });
      const teammate = buildTeammate(member, parentSessionId, teamName);
      console.log(`[team-config] reconciled ${teammate.sessionName} (${teammate.role}) in ${teamName}${memberLive ? ' [live]' : ' [no live evidence — not resurrecting]'}`);
      eventBus.emitTeammateSpawned(teammate);
    }
  }

  for (const oldId of seen) {
    if (!next.has(oldId)) {
      sessionService.markTeammateDismissed(oldId);
      console.log(`[team-config] dismissed ${oldId}`);
      eventBus.emitTeammateDismissed(oldId);
    }
  }

  knownMembers.set(path, next);

  // Opportunistically upgrade agent: sentinels to real pane ids. Cheap (one
  // tmux list-panes call) and the moment a member gains a pane, send-keys
  // starts working without waiting for a hook event.
  sessionService.resolveSentinelTargets();
};

export const teamConfigService = {
  start(): void {
    if (watcher) return;

    // Reconcile every existing config once at boot.
    for (const p of listConfigPaths()) reconcile(p);

    // Then watch for subsequent changes. Chokidar 4 dropped glob support, so
    // we watch the known config paths directly. Rescan on add to pick up new
    // team directories created after boot.
    watcher = chokidar.watch(listConfigPaths(), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const onChange = (path: string) => reconcile(path);
    watcher.on('add', onChange);
    watcher.on('change', onChange);

    // Poll every 10s for newly-created team directories and add them to the
    // watcher. Cheap because listConfigPaths is just two readdirs.
    setInterval(() => {
      const paths = listConfigPaths();
      const watched = watcher?.getWatched() ?? {};
      const watchedFlat = new Set<string>();
      for (const dir of Object.keys(watched)) {
        for (const f of watched[dir] ?? []) watchedFlat.add(join(dir, f));
      }
      for (const p of paths) {
        if (!watchedFlat.has(p)) {
          watcher?.add(p);
          reconcile(p);
        }
      }
    }, 10_000).unref();

    console.log(`[team-config] watching ${TEAMS_DIR}/*/config.json (${listConfigPaths().length} teams)`);
  },

  stop(): void {
    if (!watcher) return;
    watcher.close().catch(() => {});
    watcher = null;
    knownMembers.clear();
  },
};
