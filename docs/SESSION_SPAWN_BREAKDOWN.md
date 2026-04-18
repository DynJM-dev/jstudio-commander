# JStudio Commander Session-Spawn Flow

**Generated:** 2026-04-18 · **Scope:** read-only codebase investigation.

## Session Types Documented

### 1. PM Session

| Attribute | Value |
|-----------|-------|
| **UI Label** | "PM Session" |
| **sessionType Enum** | `'pm'` |
| **Bootstrap Content** | Read from `~/.claude/prompts/pm-session-bootstrap.md` if it exists; injected after `/effort xhigh` acknowledges. Reference: `session.service.ts:77`. Custom prompt template that primes PM behavior. |
| **Environment Variables** | None set by Commander. Claude Code reads global `~/.claude/settings.json` for its own defaults (effort is overridden to `xhigh` via `/effort` keystroke injection post-boot). |
| **Settings.json Used** | Global `~/.claude/settings.json` only. Commander does **not** modify it at spawn time. Hooks must be pre-installed separately (Phase M statusline installer, Phase N.0 P4 hook installer). |
| **Initial Files** | Whatever already exists in the target project directory. No seeding by Commander. |
| **MCP Servers** | None configured by Commander. Claude Code loads whatever is in the user's global `.mcp.json` / `settings.json` MCP config. |
| **CLAUDE.md Loading** | Project-level `<cwd>/CLAUDE.md` auto-loaded by Claude Code if present. Global `~/.claude/CLAUDE.md` also auto-loaded. Commander does **not** inject or modify either. |

**Spawn flow path:**
`POST /api/sessions` → `createSession({ sessionType: 'pm' })` → `tmuxService.createSession(...)` → `bindClaudeSessionFromJsonl(...)` (Phase T spawn-bind watcher) → `tmuxService.sendKeys('claude --model …')` → `waitForClaudeReady()` → `tmuxService.sendKeys('/effort xhigh')` → `readPmBootstrap()` → `tmuxService.sendKeys(bootstrap)` (`session.service.ts:353–492`).

---

### 2. Raw Session

| Attribute | Value |
|-----------|-------|
| **UI Label** | "Raw Session" |
| **sessionType Enum** | `'raw'` |
| **Bootstrap Content** | None. Plain Claude Code startup. Only `/effort xhigh` injected post-boot. |
| **Environment Variables** | Same as PM — none set by Commander. |
| **Settings.json Used** | Global `~/.claude/settings.json`. No modification by Commander. |
| **Initial Files** | Whatever exists in project directory. No seeding. |
| **MCP Servers** | None configured by Commander. User's global MCP config applies. |
| **CLAUDE.md Loading** | Project-level `<cwd>/CLAUDE.md` + global `~/.claude/CLAUDE.md` auto-loaded by Claude Code. |

**Spawn flow path:** Identical to PM except `bootstrap` is `null`, so only `/effort xhigh` is sent post-boot (`session.service.ts:415–487`).

---

### 3. Teammate Session (team-config spawned — implicit third type)

| Attribute | Value |
|-----------|-------|
| **UI Label** | N/A — not user-selectable; created by team-config reconciliation |
| **sessionType Enum** | N/A — teammates use `agentRole` (e.g. `'agent'`, `'qa'`, `'db'`). No explicit `sessionType`; schema default `'raw'` applies. |
| **Bootstrap Content** | N/A — teammates are spawned as `agent:<id>` sentinels or receive `tmuxPaneId=%NN` from a running orchestrator (e.g. Codeman). No bootstrap injection by Commander. |
| **Environment Variables** | N/A — Commander does not spawn tmux for teammates; their panes already exist. |
| **Settings.json Used** | Teammate inherits whatever settings.json the orchestrator (not Commander) configured. No global modification by Commander. |
| **Initial Files** | Teammate's `cwd` from team config (`member.cwd`). No file seeding by Commander. |
| **MCP Servers** | None configured by Commander. Inherited from teammate's working directory or global config. |
| **CLAUDE.md Loading** | Teammate's `<member.cwd>/CLAUDE.md` + global `~/.claude/CLAUDE.md` auto-loaded by Claude Code. |

**Spawn flow path:** `teamConfigService.start()` watches `~/.claude/teams/<name>/config.json` via chokidar → `reconcile(path)` fires on change → `sessionService.upsertTeammateSession({ sessionId: member.agentId, tmuxTarget: member.tmuxPaneId || 'agent:<id>', … })` → teammate row inserted with `team_name`, `parent_session_id`, `agent_role` (`team-config.service.ts:194–385`).

---

## Non-session-type-specific details

### tmux session creation

- **Session naming:** `jsc-<uuid-prefix>` where uuid is first 8 chars of session UUID. Example: `jsc-a1b2c3d4` (`session.service.ts:58`).
- **new-session flags:**
  ```
  tmux new-session -d -s jsc-<uuid> -c <projectPath>
  ```
  - `-d` = detached (no attach)
  - `-s` = session name
  - `-c` = start in project cwd
  - (`tmux.service.ts:48–54`)
- **Pane ID resolution (Phase S.1 Patch 1):** After `new-session`, `resolveFirstPaneId(sessionName)` captures the first pane's ID (`%NN`) and stores it in `sessions.tmux_session` instead of the session name. Ensures every `send-keys` targets the SAME pane regardless of user navigation (`session.service.ts:363–380`; `tmux.service.ts:73–83`).

### `claude` CLI flags

- **Model flag:** `claude --model 'claude-opus-4-7'` — single-quoted to prevent glob expansion on the `[1m]` suffix variant (`session.service.ts:385–386`).
- **Session effort:** No `--effort` flag at spawn. `/effort xhigh` injected as a tmux keystroke post-boot (`session.service.ts:471`).
- **No explicit `--session-id`:** Claude Code writes UUID-named JSONL files to `~/.claude/projects/<encoded-cwd>/`; Commander binds the row's `claude_session_id` by watching that directory (`session.service.ts:220–285`).

### Hook install status at spawn time

- **Commander does NOT install hooks at spawn.** Hooks are a one-time user setup outside this system.
- Expected to be pre-installed in `~/.claude/settings.json` via a separate install phase (Phase M statusline installer, Phase N.0 P4 hook installer, or user setup).
- Hook events arrive at `/api/hook-event` — not generated by Commander spawn.

### Phase T spawn-bind flow

**Purpose:** Close the gap between tmux spawn (pane created) and first hook event. Before bind, `resolveOwner` has no `claude_session_id` so hook routing would fall through to heuristic strategies.

**Implementation:**
1. Call `bindClaudeSessionFromJsonl(sessionId, cwd)` BEFORE sending the `claude` command (`session.service.ts:388–393`).
2. Chokidar watcher on `~/.claude/projects/<encoded-cwd>/` (slashes encoded as dashes).
3. Watch for first UUID-named `.jsonl` file matching `CLAUDE_JSONL_UUID_RE` (`session.service.ts:205–206`).
4. On `add`, extract UUID, call `sessionService.upsertSession({ id, claudeSessionId: uuid })` (`session.service.ts:268`).
5. 30-second timeout with warn log (`session.service.ts:207, 245–253`).
6. Fire-and-forget; failure non-fatal (`session.service.ts:247–251`).

**Encoded path example:** `/Users/jmb/Desktop/Projects/jstudio-commander` → `-Users-jmb-Desktop-Projects-jstudio-commander` (`jsonl-discovery.service.ts:11–14`).

### Team-config vs direct-spawn paths

**Direct spawn (`POST /api/sessions`):**
- Handler: `session.routes.ts:47–58`
- Service: `sessionService.createSession(opts)` with `sessionType` in options
- Outcome: new tmux pane + row with `session_type='pm'|'raw'`, `parent_session_id=null`, `team_name=null`

**Team-config spawn (chokidar reconcile):**
- Trigger: file change in `~/.claude/teams/<name>/config.json`
- Service: `teamConfigService.start()` watches all team config paths (`team-config.service.ts:387–424`).
- `reconcile(path)` reads the config, identifies members, calls `sessionService.upsertTeammateSession(...)` for each.
- Outcome: row with `session_type` unset (schema default `'raw'`), `agent_role=<member.agentType>`, `parent_session_id=<lead id>`, `team_name=<config.name>`.
- **Commander does not spawn tmux for teammates** — they already have panes (`member.tmuxPaneId`) or use `agent:<id>` sentinels until panes are assigned (`team-config.service.ts:350–360`).

---

## Schema defaults & behavior

| Column | Direct Spawn Default | Team-Config Default |
|--------|---------------------|---------------------|
| `status` | `'working'` (tmux alive) | `'idle'` or `'stopped'` (depends on `live` evidence) |
| `session_type` | `'pm'` / `'raw'` (explicit) | `'raw'` (schema default, never overridden) |
| `effort_level` | `'xhigh'` (hard-coded) | From `member.model` if set, else schema default |
| `model` | `'claude-opus-4-7'` (hard-coded unless overridden in POST body) | From `member.model`, normalized via `SHORT_MODEL` map (`team-config.service.ts:16–31`) |
| `team_name` | `null` | `<config.name>` |
| `parent_session_id` | `null` | Parent PM's session id (or lead's agentId if PM not yet adopted) |
| `auto_compact_enabled` | `true` (schema default — off for lead-pm/pm after Phase Q heal) | `true` (schema default) |

---

## Open questions / unclear paths

1. **PM bootstrap path:** `~/.claude/prompts/pm-session-bootstrap.md` is read on `session.service.ts:79` but never written by Commander. Likely authored by the JStudio PM skill setup or manual user setup.
2. **Hook event route shape:** `/api/hook-event` ingestion handler lives in `hook-event.routes.ts`; not fully enumerated in this investigation.
3. **MCP configuration persistence:** No evidence that Commander modifies `.mcp.json` or `settings.json` MCP config at spawn. User's global config is assumed to apply.
4. **Settings.json modification timeline:** If a user has never run the Phase M / Phase N.0 P4 installers, hooks may be absent — spawn will still succeed but hook events never reach `/api/hook-event`.
5. **CLAUDE.md context injection:** No evidence Commander injects CLAUDE.md content into the prompt. Claude Code auto-loads both project + global CLAUDE.md. Commander observes but does not modify.
6. **Cross-session pane detection:** `detectCrossSessionPaneOwner` (referenced but not expanded) prevents teammate panes that belong to other PMs from being misrouted. Implementation details unclear.
7. **Effort matrix hardening:** `~/.claude/skills/jstudio-pm/SKILL.md` defines the effort matrix; not in scope of this doc. Phase U effort handling referenced but not detailed here.

---

## File sources

- `server/src/routes/session.routes.ts` — route handler, POST shape
- `server/src/services/session.service.ts` — `createSession`, `upsertTeammateSession`, `bindClaudeSessionFromJsonl`, spawn logic
- `server/src/services/tmux.service.ts` — tmux commands, pane resolution
- `server/src/services/team-config.service.ts` — reconciliation, teammate upsert
- `server/src/services/jsonl-discovery.service.ts` — path encoding for spawn-bind
- `client/src/components/sessions/CreateSessionModal.tsx` — UI labels: "PM Session", "Raw Session"
- `packages/shared/src/types/session.ts` — `sessionType` union (`'pm' | 'raw'`)
