import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Teammate } from '@commander/shared';
import { eventBus } from '../ws/event-bus.js';
import { sessionService } from './session.service.js';

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

const TEAMS_GLOB = join(homedir(), '.claude', 'teams', '*', 'config.json');

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
    sessionService.upsertTeammateSession({
      sessionId: parentSessionId,
      name: lead.name,
      tmuxTarget: lead.tmuxPaneId || `agent:${parentSessionId}`,
      projectPath: lead.cwd ?? null,
      role: lead.agentType ?? 'pm',
      teamName,
      parentSessionId: null,
      model: lead.model,
    });
  }

  const seen = knownMembers.get(path) ?? new Set<MemberKey>();
  const next = new Set<MemberKey>();

  for (const member of config.members) {
    if (member.agentId === config.leadAgentId) continue;
    if (member.isActive === false) continue;
    next.add(member.agentId);

    if (!seen.has(member.agentId)) {
      sessionService.upsertTeammateSession({
        sessionId: member.agentId,
        name: member.name,
        tmuxTarget: member.tmuxPaneId || `agent:${member.agentId}`,
        projectPath: member.cwd ?? null,
        role: member.agentType ?? 'agent',
        teamName,
        parentSessionId,
        model: member.model,
      });
      const teammate = buildTeammate(member, parentSessionId, teamName);
      console.log(`[team-config] spawned ${teammate.sessionName} (${teammate.role}) in ${teamName}`);
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
};

export const teamConfigService = {
  start(): void {
    if (watcher) return;
    watcher = chokidar.watch(TEAMS_GLOB, {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const onChange = (path: string) => reconcile(path);
    watcher.on('add', onChange);
    watcher.on('change', onChange);

    console.log(`[team-config] watching ${TEAMS_GLOB}`);
  },

  stop(): void {
    if (!watcher) return;
    watcher.close().catch(() => {});
    watcher = null;
    knownMembers.clear();
  },
};
