# CTO_BRIEF — Command-Center N2 CLOSE + N3 draft request

**From:** PM · 2026-04-23
**Status:** N2 CLOSED on 8/8 user-facing smoke PASS. Plugin → sidecar hook pipeline + MCP dual-protocol validated end-to-end with real Claude Code sessions. Four KB calibration findings stacked + one medium-severity tech debt (Debt 15 bearer rotation) proposed for N2.1 hotfix before N3 fires.

## §1 — Commit chain (f595475 → 67a6816)

Seven commits on commander-repo:

- `527afad` feat(n2): plugin + MCP dual-protocol — hooks pipeline, WS bus, 10 CRUD tools (the CODER rotation)
- `45720df` docs(n2): PHASE_N2_REPORT filed, §3 part 3 blank
- `74af4df` fix(n2): prune hooks.json to Claude Code v2.1.118 supported events (9 of 13) [PM, later found not-root-cause]
- `c429e5a` fix(n2): plugin hooks http→command + forward.sh shim (Claude Code URL validator) [PM, actual root-cause fix]
- `441e007` fix(n2): drop manifest.hooks from plugin.json (Claude Code auto-loads default) [PM]
- `67a6816` docs(n2): append §3.3 PASSED 8/8 + §4 D6 PM-shipped fixes + §7 Debt 15 [PM]

Plus one commit in meta-repo: `33cb513` chore(meta): SMOKE_DISCIPLINE.md v1.1 — §3.4.1 window-presence triad.

Scope: 34/34 tests pass. D-KB-07 narrow-primitive grep clean. SMOKE_DISCIPLINE v1.1 §3.4.1 triad PASS on smoke-readiness + step 1. MCP external-session `list_projects` returned 3 real project rows (coder-smoke + tmp + test-proj-mcp) proving full plugin→sidecar→MCP pipeline. Rust stayed 149/150 LOC (G5). `bun install --frozen-lockfile` clean at every commit (G12).

## §2 — Four KB calibration findings (NEED fold before N3)

All four traced to runtime-vs-spec drift. KB-P3.1 + KB-P3.2 + ARCHITECTURE_SPEC §7.3 + §8.1 appear to reference an older Claude Code plugin/MCP schema than v2.1.118 implements. Every single one broke Jose's smoke at a different step.

### 2.1 — `file://` install URI unsupported

KB-P3.2 + N2 dispatch §7 tell CODER to expose `/plugin install file://<absolute-path>` as the primary local-install pattern. Claude Code v2.1.118's "Add Marketplace" dialog rejects `file://`: *"Invalid marketplace source format. Try: owner/repo, https://..., or ./path"*. Raw absolute paths (no URI scheme) work.

**Proposed KB-P3.2 amendment:**

> Local plugin install uses raw absolute or `./` relative paths, NOT `file://` URIs. Marketplace sources accepted by Claude Code v2.1+: `owner/repo` (GitHub), `git@…`, `https://…/marketplace.json`, `./path/to/marketplace`, absolute filesystem paths. File-scheme URIs are rejected at the dialog layer before any filesystem call happens.

### 2.2 — HTTP-transport hooks don't exist (hooks only support `type: command`)

KB-P3.1 claims *"HTTP transport (`type:"http"`) is purpose-built for GUI host apps — plugin POSTs JSON to Commander's localhost listener."* This is WRONG for Claude Code v2.1.118. URL validator rejects any `${COMMANDER_PORT}` placeholder with `invalid_format: url` at plugin-load time BEFORE env-var expansion. Grep across 36 hook entries in the installed official marketplace: zero use `type: http` for hooks. HTTP transport exists only for **MCP servers** (`.mcp.json`, separate schema).

The working pattern is `type: command` with a shell command that may reference `${CLAUDE_PLUGIN_ROOT}` for path resolution. Commander's fix: `apps/plugin/hooks/forward.sh` (50 LOC bash) reads `~/.commander/config.json` on every invocation (port + bearer, dynamic), POSTs stdin payload to sidecar, echoes sidecar response, fails open.

**Proposed KB-P3.1 amendment:**

> Claude Code v2.1+ plugin hooks are command-type only. HTTP transport in Claude Code is for MCP servers (`.mcp.json`), not for hooks (`hooks.json`). GUI host apps that need hook events must ship a bash/script forwarder per hook; the script invokes the host's API layer. URL validation of hook `"url"` field happens at plugin-load time and rejects env-var placeholders.

Bonus correction: KB-P3.1 catalogs 21+ events; v2.1.118 supports 9 (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`). Wiring any unsupported event (`SubagentStart`, `TaskCreated`, `TaskCompleted`, `PostCompact`, etc.) aborts the whole hook registration with `Hook load failed`. v1.3 KB event catalog is aspirational for current runtime.

### 2.3 — `plugin.json manifest.hooks` field collides with convention

ARCHITECTURE_SPEC §8.1 + KB-P3.2 both show `plugin.json` with a `"hooks": "./hooks/hooks.json"` field. Claude Code v2.1+ auto-loads `.claude-plugin/../hooks/hooks.json` by convention; `manifest.hooks` is reserved for ADDITIONAL hook files at NON-standard paths. Pointing at the standard path causes: *"Duplicate hooks file detected: already-loaded file …"* → aborts hook registration.

**Proposed ARCHITECTURE_SPEC §8.1 + KB-P3.2 amendment:**

> `plugin.json` omits `hooks` field when the plugin uses the standard `hooks/hooks.json` location (auto-loaded by Claude Code convention). `manifest.hooks` is reserved for referencing additional hook files at non-standard paths — not the default.

### 2.4 — `.mcp.json` schema shape differs by location

ARCHITECTURE_SPEC §7.3 doesn't explicitly document where user-registered MCP servers get configured. PM initially guided Jose to `~/.claude/settings.json` + `mcpServers` field — settings.json schema rejects that field with validator rollback. Correct: project-root `.mcp.json`.

**But** project-root `.mcp.json` schema differs from plugin-bundled `.mcp.json` schema. Evidence from installed official marketplace:
- `claude-plugins-official/external_plugins/terraform/.mcp.json` — flat shape (`{"terraform": {...}}`)
- `claude-plugins-official/external_plugins/context7/.mcp.json` — flat shape
- `claude-plugins-official/external_plugins/gitlab/.mcp.json` — flat shape
- `claude-plugins-official/external_plugins/linear/.mcp.json` — flat shape
- `claude-plugins-official/external_plugins/discord/.mcp.json` — **wrapped shape** (`{"mcpServers": {"discord": {...}}}`)

**Project-root `.mcp.json` rejects flat shape** ("`mcpServers`: Does not adhere to MCP server configuration schema"), requires the `mcpServers` wrapper. **Plugin-bundled `.mcp.json`** accepts flat. 4 of 5 plugin-bundled examples use flat; the `mcpServers`-wrapped discord is the outlier. No documentation in KB or spec distinguishes these.

**Proposed ARCHITECTURE_SPEC §7.3 amendment:**

> External Claude Code sessions configure access to the Commander MCP via a project-root `.mcp.json` file. Shape:
> ```json
> {
>   "mcpServers": {
>     "commander": {
>       "type": "http",
>       "url": "http://127.0.0.1:<port>/mcp",
>       "headers": { "Authorization": "Bearer <token>" }
>     }
>   }
> }
> ```
> The `mcpServers` wrapper is REQUIRED for project-root `.mcp.json`. (Plugin-bundled `.mcp.json` files within a Claude Code plugin accept a flat shape, but that is a separate file and the distinction matters.) Claude Code does NOT live-reload `.mcp.json`; the session must be restarted to pick up config changes.

## §3 — Debt 15: Bearer rotation bug (proposed N2.1 hotfix before N3)

**Severity:** MEDIUM. First v1 contract violation observed post-ship.

D-N1-07 §8.2 specifies "single local bearer token in `~/.commander/config.json`. v1: no expiry. Token shown in Settings with copy button." Implied: mint-once-on-first-launch, persist across launches.

Evidence violates this. `config.json` content between CODER smoke and Jose MCP test:

| When | Bearer | config.json `updatedAt` |
|---|---|---|
| CODER smoke-readiness 2026-04-23 ~10:15 UTC | `5f77f209-7d38-47a2-be5d-d986bfb759ca` | (implied — used by §3.2 verification) |
| Jose MCP setup 2026-04-23 ~16:40 UTC | `69b70ef5-f2a0-4d75-83e9-725802f786f3` | `2026-04-23T15:59:03.816Z` |

Sidecar regenerated the bearer at approximately 15:59 UTC. Between those times:
- CODER's smoke-readiness ran at 10:15 UTC with `5f77f209…`
- My reality check cold-launch at ~09:46 UTC also used `5f77f209…`
- Jose launched instances during the day
- At some point the sidecar wrote a fresh token

**Impact:**
- Forward.sh absorbed this silently (reads config dynamically per invocation) — hooks kept working.
- Jose's `export COMMANDER_TOKEN=5f77f209…` env var went stale.
- The original `.mcp.json` I wrote with `5f77f209…` → 401 `UNAUTHORIZED: Invalid bearer token`.
- Any PHASE_REPORT / external-docs reference to the "bearer token" becomes an archive artifact, not a live reference.
- N3+ long-running agent runs with external Claude Code sessions holding a hardcoded bearer will silently 401 mid-run after rotation.

**Root cause candidates (not investigated):**
1. Sidecar config-persistence writer regenerates bearer on some error condition (bad parse / missing field / etc.) instead of preserving.
2. Boot-time validation mistakes a valid config for corrupt, overwrites.
3. Specific code path (client-disconnect re-init? port-scan retry?) rewrites config.json.

**PM proposal:** N2.1 hotfix before N3 dispatches. Estimated ~2-4 hr:
1. Grep sidecar source for `config.json` writes; enumerate every path.
2. Audit each write-path condition; identify which one fires on relaunch.
3. Fix to preserve existing bearer if config.json is parseable + has a valid UUID bearer field.
4. Add `bun:test` integration test: spin up sidecar twice from same config, assert bearer unchanged.
5. If token rotation is INTENTIONAL at some trigger (security hygiene?), document it in D-N1-07 §8.2 + add a `lastRotatedAt` field to config.json + emit a WS `system:warning` on rotation so external sessions can re-fetch.

## §4 — PM-shipped fixes in the N2 rotation (for record)

Per Jose's 2026-04-23 standing small-scope authorization. All in D6 of PHASE_N2_REPORT §4.

- D6a — `file://` install fix via symlink + raw-path marketplace registration (filesystem only, no commander-repo change)
- D6b — forward.sh + hooks.json command-type rewrite (commit `c429e5a`) — the biggest fix of the day
- D6c — plugin.json manifest.hooks removal (commit `441e007`)
- D6d — project-root `.mcp.json` wrapped-shape fix (filesystem only, test config)

All four under ~60 lines total across commander-repo. No Rust, no dep changes, no test regressions.

## §5 — Standing ratifications from prior briefs (still holding)

- D-KB-07 narrow-primitive tool surface: HELD through N2 — grep clean, 10 CRUD tools only. Verified automated in §3 part 1.
- D-KB-08 Tauri perf framing: validated — N2 ran on the same Tauri v2 + Bun sidecar architecture; no regression.
- `~/.commander/` state dir (PHASE_N1_REPORT §8 Q1): in use.
- `bun:test` at sidecar (PHASE_N1_REPORT §8 Q2): 16/16 pass including 10 new integration tests.

## §6 — Tech debt (from N2)

Debts 8-15 now stacked; full list in PHASE_N2_REPORT §7. All LOW severity except Debt 15 (MEDIUM, proposed N2.1 hotfix).

- Debt 8: Tauri v2 signingIdentity:null doesn't auto-codesign (N1.1 scope; neutralized by post-tauri-sign.sh).
- Debt 9: MCP server hand-rolled minimum-viable (no resources/sampling/SSE); swap to SDK if N5+ needs them.
- Debt 10: `hook_events.id = "<session_id>:<event_uuid>"` composite PK (functional; optional schema swap).
- Debt 11: Published marketplace deferred to N7.
- Debt 12: JSONL secondary indexer deferred.
- Debt 13: MCP protocol-version negotiation stubbed.
- Debt 14: Recent-events panel not virtualized (belongs with N4 kanban).
- **Debt 15: Bearer rotation bug (MEDIUM, proposed N2.1).**

Debts 1-7 from N1 unchanged.

## §7 — Asks

1. **Ratify four KB calibration folds per §2.** KB-P3.1 (HTTP hooks + 21-event catalog) + KB-P3.2 (file:// install + manifest.hooks) + ARCHITECTURE_SPEC §7.3 (project-root `.mcp.json` shape) + §8.1 (plugin.json manifest.hooks). Four amendments; can batch-fold before N3 draft lands.

2. **Debt 15 routing:** N2.1 hotfix (PM-proposed) OR N3 preflight OR defer? PM recommendation: N2.1 hotfix. Reason: N3 PTY flow introduces long-lived agent runs; external Claude Code sessions subscribing over MCP/WS need stable bearer across hours/days. Bearer churn mid-agent-run is a reliability hazard worth 2-4hr investigation before compounding.

3. **Draft N3 dispatch (PTY spawn — the Run-Task mechanic).** Scope per ROADMAP v0.3 §N3 + observations from PHASE_N2_REPORT §9 (1-6). Key hand-off points: `spawn_agent_run` stub at `status=queued` → PTY + worktree materialization + SIGTERM on `cancel_agent_run`. Plus N3 needs the first real `pty:<session_id>` WS subscriber on the frontend. Pre-dispatch reality check notes: `~/.commander/` state dir ratified + D-KB-07 narrow-primitive held + bearer-rotation fix (Debt 15) probably resolved first.

Once you return the N3 draft (or fold Debt 15 as N2.1 first), PM runs pre-dispatch reality check + relays to Jose for CODER rotation. Expected N3 shape: Git worktree per run + `Bun.spawn({terminal})` PTY + stream stdout on `pty:<session_id>` WS topic + hard bounds (wall-clock + token + iteration + explicit cancel per KB-P1.6) + minimal run viewer in frontend.

**End of brief.**
