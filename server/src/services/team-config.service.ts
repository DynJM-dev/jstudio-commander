import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Teammate } from '@commander/shared';
import { eventBus } from '../ws/event-bus.js';
import { sessionService } from './session.service.js';
import { tmuxService } from './tmux.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_JSONL_MS = 10 * 60_000;

// Team configs authored by the PM skill often use short forms like "opus" or
// omit the [1m] suffix. Normalize in-memory before persisting so teammate
// rows inherit the 1M context default. Does NOT mutate the on-disk config.
const SHORT_MODEL: Record<string, string> = {
  opus: 'claude-opus-4-7',
  'claude-opus-4-7': 'claude-opus-4-7',
  // Legacy backward-compat: existing team configs may still reference 4.6.
  'claude-opus-4-6': 'claude-opus-4-7',
  'claude-opus-4-6[1m]': 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

const normalizeModel = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const base = raw.trim();
  if (base in SHORT_MODEL) return SHORT_MODEL[base];
  return base;
};

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

// Atomic in-place rewrite of `leadSessionId` only — preserves all other
// fields (members, metadata, formatting where possible) byte-for-byte
// in their JSON-roundtripped form. Used after Phase G.2 adoption so the
// next chokidar fire reconciles against the adopted PM's id rather than
// the stale lead. tmp-then-rename keeps the file atomic vs partial reads.
//
// No-op (returns false) when the file is missing, unparseable, or
// already carries the target id — keeping repeated adoptions idempotent.
const updateTeamConfigLeadSessionId = (path: string, newLeadSessionId: string): boolean => {
  if (!existsSync(path)) return false;
  let raw: string;
  let parsed: TeamConfig;
  try {
    raw = readFileSync(path, 'utf-8');
    parsed = JSON.parse(raw) as TeamConfig;
  } catch (err) {
    console.warn(`[team-config] cannot rewrite ${path}: parse failed —`, (err as Error).message);
    return false;
  }
  if (parsed.leadSessionId === newLeadSessionId) return false;

  const next = { ...parsed, leadSessionId: newLeadSessionId };
  // Preserve trailing newline if the original had one.
  const trailing = raw.endsWith('\n') ? '\n' : '';
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2) + trailing);
    renameSync(tmp, path);
    return true;
  } catch (err) {
    console.warn(`[team-config] cannot rewrite ${path}: write failed —`, (err as Error).message);
    return false;
  }
};

const buildTeammate = (member: TeamMember, parentSessionId: string, teamName: string, displayName?: string): Teammate => ({
  sessionId: member.agentId,
  sessionName: displayName ?? member.name,
  role: member.agentType ?? 'agent',
  teamName,
  parentSessionId,
  color: member.color,
  tmuxPaneId: member.tmuxPaneId,
});

// Derive a display name for a team-lead when no existing Commander PM is
// available to adopt. Fallback order: titled basename of cwd → team name
// → generic "team-lead" (absolute last resort). Prevents a fresh ingest
// from littering the UI with rows labelled literally "team-lead".
const deriveTeamLeadName = (cwd: string | undefined, teamName: string, rawName: string): string => {
  if (cwd) {
    const basename = cwd.split('/').filter(Boolean).pop();
    if (basename) return basename;
  }
  if (teamName) return teamName;
  return rawName || 'team-lead';
};

// Best-effort role hint for coder naming. Known categories map to short
// labels; otherwise a generic "coder" is used. Keeps names scannable:
// "PM - OvaGas (qa)" vs "PM - OvaGas (coder 2)" vs "PM - OvaGas (coder)".
const ROLE_HINT_RE = /^(qa|security|ui|db|landing|scaffold|supabase|docs?|test)/i;
const roleHintFromAgentType = (agentType?: string): string => {
  if (!agentType) return 'coder';
  const match = agentType.match(ROLE_HINT_RE);
  return match ? match[1]!.toLowerCase() : 'coder';
};

const deriveCoderName = (
  parentName: string | undefined,
  memberRawName: string,
  memberAgentType: string | undefined,
  existingSiblingNames: string[],
): string => {
  // No parent display to inherit from — fall back to the raw config name
  // (e.g. coder-14), which the orchestrator already disambiguates.
  if (!parentName) return memberRawName;
  // Generic parent names aren't worth inheriting; they don't read well as
  // "(coder)" suffixes and the raw name already has more info.
  if (/^team[-_ ]?lead$/i.test(parentName)) return memberRawName;
  const hint = roleHintFromAgentType(memberAgentType);
  const taken = new Set(existingSiblingNames);
  const base = `${parentName} (${hint})`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 20; n++) {
    const candidate = `${parentName} (${hint} ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
};

const reconcile = (path: string): void => {
  const config = readConfig(path);
  if (!config || !config.members) return;

  const teamName = config.name;
  // Parent session = lead's Commander session if known, else the lead agent id
  // (which we'll also upsert as a session row so the FK in agent_relationships
  // resolves either way).
  const configParentSessionId = config.leadSessionId || config.leadAgentId;
  if (!configParentSessionId) return;

  // Resolve the parent. Three paths in priority order:
  //   (0) Idempotent — config.parentSessionId already points to a row
  //       with team_name === teamName. Reuse its id, no work. This is
  //       the steady state after a previous adoption rewrote the file.
  //   (a) Adoption — user has a Commander PM at the lead's cwd that
  //       isn't yet linked to any team. Link it (re-parenting any
  //       teammates currently under the stale lead id) and rewrite
  //       the on-disk team config so future reconciles use the
  //       adopted id directly.
  //   (b) Fresh — no existing PM. Upsert under the config's
  //       parentSessionId with a derived human-readable name.
  const lead = config.members.find((m) => m.agentId === config.leadAgentId);
  let parentSessionId = configParentSessionId;
  if (lead) {
    const leadClaudeId = UUID_RE.test(configParentSessionId) ? configParentSessionId : undefined;

    const byConfigId = sessionService.getSession(configParentSessionId);
    if (byConfigId && byConfigId.teamName === teamName) {
      // Steady state — config already points at the team's lead row.
      parentSessionId = byConfigId.id;
    } else {
      const adoptable = lead.cwd ? sessionService.findAdoptablePmAtCwd(lead.cwd) : null;
      if (adoptable && adoptable.teamName !== teamName) {
        sessionService.adoptPmIntoTeam({
          sessionId: adoptable.id,
          teamName,
          claudeSessionId: leadClaudeId,
          previousLeadId: configParentSessionId,
        });
        const wrote = updateTeamConfigLeadSessionId(path, adoptable.id);
        console.log(`[team-config] adopted existing PM "${adoptable.name}" (${adoptable.id.slice(0, 8)}) into ${teamName}${wrote ? ' [config rewritten]' : ''}`);
        parentSessionId = adoptable.id;
      } else if (adoptable) {
        // Already owned by this team — just reuse its id for teammate links.
        parentSessionId = adoptable.id;
      } else {
        const leadLive = hasLiveEvidence({
          tmuxPaneId: lead.tmuxPaneId,
          claudeSessionId: leadClaudeId,
          cwd: lead.cwd,
        });
        const leadName = deriveTeamLeadName(lead.cwd, teamName, lead.name);
        sessionService.upsertTeammateSession({
          sessionId: configParentSessionId,
          name: leadName,
          tmuxTarget: lead.tmuxPaneId || `agent:${configParentSessionId}`,
          projectPath: lead.cwd ?? null,
          role: lead.agentType ?? 'pm',
          teamName,
          parentSessionId: null,
          model: normalizeModel(lead.model),
          live: leadLive,
        });
      }
    }
  }

  // Existing sibling teammate display names — used by the coder-naming
  // disambiguator so "(coder)" / "(coder 2)" stays stable as more coders
  // join under the same parent PM.
  const existingSiblings = sessionService
    .listTeammates(parentSessionId)
    .map((s) => s.name)
    .filter(Boolean);
  const parentSession = sessionService.getSession(parentSessionId);
  const parentDisplayName = parentSession?.name;

  const seen = knownMembers.get(path) ?? new Set<MemberKey>();
  const next = new Set<MemberKey>();

  for (const member of config.members) {
    if (member.agentId === config.leadAgentId) continue;
    if (member.isActive === false) continue;
    next.add(member.agentId);

    const isFresh = !seen.has(member.agentId);
    // Orchestrators sometimes write the member row before the tmux pane
    // exists (empty tmuxPaneId), then update the config once the pane is
    // alive. Without idempotent reconciles, the second write gets
    // short-circuited by the seen-gate and the row stays stuck on the
    // `agent:<id>` sentinel. We therefore re-upsert whenever the config
    // carries a real pane id, even for already-seen members.
    const hasRealPane = !!member.tmuxPaneId && member.tmuxPaneId.startsWith('%');

    if (!isFresh && !hasRealPane) continue;

    // Cross-session pane guard: if the config-provided paneId actually
    // lives inside ANOTHER Commander PM's tmux session, this "teammate"
    // is a mislabelled reference to the PM's own pane. Reject the spawn
    // rather than let send-key target a real PM and corrupt its input.
    // ovagas-ui hit this: coder@ovagas-ui was written with tmuxPaneId=%51,
    // but %51 is a pane inside jsc-e16a1cb2 owned by the OvaGas PM.
    //
    // Excludes the teammate's own id AND its parent — a coder whose
    // pane legitimately lives in its parent PM's tmux session must
    // NOT be flagged. Codeman-managed teams (`codeman-*` tmux sessions)
    // are already short-circuited inside detectCrossSessionPaneOwner.
    if (hasRealPane) {
      const owner = sessionService.detectCrossSessionPaneOwner(
        member.tmuxPaneId!,
        [member.agentId, parentSessionId],
      );
      if (owner) {
        console.log(`[team-config] rejecting cross-session pane for ${member.name}: ${member.tmuxPaneId} belongs to PM "${owner.name}"`);
        sessionService.markTeammateDismissed(member.agentId);
        continue;
      }
    }

    // Teammate agentIds look like "name@team" — not Claude UUIDs. Without
    // a pane or prior claude_session_id link, we can't verify liveness,
    // so live defaults to false (honest: "we don't know yet"). The hook
    // event route will flip it to idle/working once Claude emits.
    const memberLive = hasLiveEvidence({
      tmuxPaneId: member.tmuxPaneId,
      claudeSessionId: UUID_RE.test(member.agentId) ? member.agentId : undefined,
      cwd: member.cwd,
    });

    // Fresh spawns inherit the parent PM's display name when the parent
    // has a human-readable one ("PM - OvaGas (coder)"); already-seen
    // members go through a name-less upsert so a rename doesn't get
    // clobbered mid-lifecycle. Siblings are collected once before the
    // loop; we update the local set as we derive so two fresh spawns in
    // one reconcile don't collide on "(coder)".
    let nameForUpsert: string | undefined;
    if (isFresh) {
      const derived = deriveCoderName(parentDisplayName, member.name, member.agentType, existingSiblings);
      existingSiblings.push(derived);
      nameForUpsert = derived;
    }

    sessionService.upsertTeammateSession({
      sessionId: member.agentId,
      ...(nameForUpsert !== undefined ? { name: nameForUpsert } : {}),
      tmuxTarget: member.tmuxPaneId || `agent:${member.agentId}`,
      projectPath: member.cwd ?? null,
      role: member.agentType ?? 'agent',
      teamName,
      parentSessionId,
      model: normalizeModel(member.model),
      live: memberLive,
    });

    if (isFresh) {
      const teammate = buildTeammate(member, parentSessionId, teamName, nameForUpsert);
      console.log(`[team-config] reconciled ${teammate.sessionName} (${teammate.role}) in ${teamName}${memberLive ? ' [live]' : ' [no live evidence — not resurrecting]'}`);
      eventBus.emitTeammateSpawned(teammate);
    } else {
      console.log(`[team-config] updated pane for ${member.name} → ${member.tmuxPaneId} in ${teamName}`);
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
