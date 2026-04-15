# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-15 — Coder-9 pre-compaction sweep
> Coders: Coder-7 (42 polish commits) → Coder-8 (verified + plan-attach) → Coder-9 (17 feature commits this week)

## HEAD of main

```
587e508 feat(sessions): PM vs Raw session toggle + /pm bootstrap auto-injection
043dc5f feat(chat): brighter state-aware shimmer + live skill/agent/memory indicators
95aacef fix(sessions): resolve sentinel tmux targets to real pane IDs + poller idle-vs-stopped
38023cb feat(chat): brighten text tokens + show live thinking content during working indicator
53c32c5 fix(sessions): only heal sessions with live tmux or recent activity + add session delete
853e477 feat(sessions): display team name on PM cards to disambiguate multiple team-leads
a42a1b4 feat(chat): surface skills, agent spawns, memory reads, and teammate messages as activity chips
9a2531b fix(chat): handle deleted task status and add defensive lookup fallback
8d2d981 fix(chat): walk plan across assistant groups + add close button
```

See `CTO_BRIEF.md` (§5) for the full feature table `cec1bc9` → `587e508` (17 commits this session).

---

## Context Hygiene — Mandatory

Context is finite. Every token wasted on file content you don't need is a
token stolen from reasoning. Follow these rules strictly.

### Reading files
- NEVER `cat` a full file into context. Use `Read` with offset/limit to read
  only the section you need.
- If you need to find something in a file, `grep -n` first to get line
  numbers, then `Read` only those lines.
- For large files (>200 lines), always read the first 20 lines to understand
  structure, then target the specific section.
- If you need a function signature but not the body, grep for it — don't
  read the whole file.

### Bash output
- ALWAYS pipe through `head`, `tail`, or `grep` to limit output size.
- `ls -la | head -20` not `ls -la` on large directories.
- `find ... | head -30` not unbounded find.
- `git log --oneline -10` not `git log`.
- `git diff --stat` before `git diff` — only read full diff for files you need.

### Editing files
- Use targeted Edit (str_replace) with minimal context — don't re-read the
  whole file before a one-line change.
- If you already have the file in context from a recent Read, don't Read it
  again before editing.

### What NOT to do
- Don't read `package.json`, `tsconfig.json`, or config files "just to check"
  — you already know the stack from CLAUDE.md.
- Don't read files you're about to overwrite entirely — just Write them.
- Don't read `node_modules`, `.next`, `dist`, or build output.
- Don't cat migration files you just wrote — you already have the content.

### The test
Before any Read or Bash command, ask yourself: *"Do I need ALL of this
output, or just part of it?"* If just part, scope the command down.

---

## Coder-9 Session (2026-04-14 → 2026-04-15)

Major additions on top of coder-8's line. See `CTO_BRIEF.md` for the exhaustive feature table and architecture snapshot — this section captures the hard-won context that isn't obvious from `git log`.

### What shipped (feature summary)

| Area | Features |
|---|---|
| **Plan widget** | Fix attribution (plan renders in Claude's bubble, not user's) · real Claude-Code task IDs parsed from `"Task #N created"` tool_result so live updates land · walk across assistant groups so "Proceed"-split turns don't break · handle `deleted` status (remove from Map) + defensive `STATUS_CONFIG[x] ?? pending` fallback · `getActivePlan` + `buildPlanFromMessages` in `utils/plans.ts` are the single source of truth for both inline card and sticky widget |
| **Sticky plan widget** | Bottom-docked glass pill above input · IntersectionObserver (threshold 0.5) hides when inline card visible · 3s auto-fade on allDone · local X close button per-plan (dismissed state resets on planKey change) |
| **Split-screen teammates** | `~/.claude/teams/*/config.json` chokidar watcher emits `teammate:spawned` / `teammate:dismissed` WS · `agent_relationships` table used for edges · SplitChatLayout mounts ChatPage twice (prop `sessionIdOverride` suppresses URL read) · drag-resize 30–70% · localStorage `jsc-split-state-v1` restore · TeammateRow primes that localStorage on click so nested-card → split opens directly to that teammate |
| **Nested session tree** | SessionsPage groups flat sessions into top-level + buckets (resolves parent by Commander UUID OR claudeSessionId) · parent card glows yellow if any teammate is waiting |
| **Compaction** | `ContentBlock` gains `compact_boundary` variant · jsonl-parser emits `{trigger, preTokens}` · stats endpoint returns `contextTokens/contextCost` as the slice post-last-boundary · ContextBar shows context-scoped by default, hover shows full session total |
| **Waiting state** | `STATUS_COLORS.waiting` + `--color-waiting` → yellow · new `.waiting-glow` pulse keyframe · SessionCard / ContextBar dot / SplitChatLayout pane all glow idle-yellow when status=waiting; server already detects via numbered-choice + WAITING_INDICATORS |
| **Bulletproof interrupt** | Global `window.keydown` listener (no textarea-empty gate); ESC + Cmd+./Ctrl+.; `data-escape-owner` on menus/permission prompts yields ESC to them; `interruptSession` sends two ESCs 80ms apart; Stop button visible whenever isWorking∨hasPrompt∨interrupting; "Stopping…" optimistic state; inline red error banner on failure |
| **Per-session stats isolation** | Model `[1m]` suffix + short forms (`opus`, `sonnet`) normalized in ContextBar · `/stats` + `/chat` skip cwd-fallback when row has `parent_session_id` · `hook-event.routes` rewrite: 4-strategy matcher (by claudeSessionId → by id-as-UUID → by unclaimed-cwd → skip); backfills `claude_session_id` on match; boot-heal clears stomped transcript_paths |
| **Teammate lifecycle** | `upsertTeammateSession({ live: bool })` — only flips stopped→idle with real evidence (tmux pane alive OR JSONL mtime <10min) · `agent_relationships` upsert clears `ended_at` on respawn · `deleteSession` routes team rows to `purgeTeamSession` which archives team config to `.trash/<name>-<ts>/` (lead) or filters the `members[]` (teammate), hard-deletes row + relationships · boot + reconcile skip sentinel targets via `tmux_session LIKE 'agent:%'` |
| **PM tmux pane capture** | `tmuxService.listAllPanes()` + `sessionService.resolveSentinelTargets()` — matches cwd, adopts pane id when exactly one unclaimed candidate · status-poller WHERE clause extended to re-probe pane-backed rows regardless of stored status (un-sticks zombies) |
| **Activity visibility** | `ActivityChip` + `AgentSpawnCard` dispatch in AssistantMessage: Skill/Brain-blue, SendMessage/Send-cyan, TeamCreate/Users-purple, ToolSearch/Search-muted, TaskList/ListTree, Read path-classified (skills → Brain-blue, memory → BookOpen-amber, project-doc → muted) · in-flight `liveActivity` indicator shown between Claude header and shimmer while tool_result is still pending |
| **Shimmer + theming** | Bumped opacity 0.08 → 0.55, height 2→4px, 6px accent glow · `.thinking-shimmer.tooling` (fast accent-light) / `.waiting` (paused idle-yellow) · `.bar-working` + `.bar-waiting` on ContextBar · text tokens brightened (~5-10%, biggest lift on `--color-text-tertiary`) · live thinking preview under shimmer (4-line clamp, 280-char tail, crossfade on content-hash key) · `getActionInfo` in ContextBar returns `{label, icon}` with per-tool-family icons |
| **PM bootstrap** | `Session.sessionType: 'pm' \| 'raw'` · `session_type` DB column (default `raw`) · `CreateSessionModal` PM/Raw segmented toggle (default PM) · server polls `capture-pane` up to 12s for `❯` / `? for shortcuts`, then `sendKeys` contents of `~/.claude/prompts/pm-session-bootstrap.md` · teal PM pill on SessionCard |
| **UX polish** | `teamName` muted suffix on cards to disambiguate duplicate team-leads |

### PM Initialization System (Parts 1–3) — DO NOT BREAK

Three pieces work together; breaking any one re-opens the OvaGas failure mode:

1. **`~/.claude/skills/jstudio-pm/SKILL.md`** (outside repo) has a mandatory Cold Start section: read `~/.claude/CLAUDE.md`, inventory `~/.claude/skills/`, read local `STATE.md`/`PM_HANDOFF.md`, scan memory, report readiness. Plus "Skill invocation is mandatory" + Skill-vs-Agent-vs-TeamCreate matrix.
2. **`~/.claude/prompts/pm-session-bootstrap.md`** (outside repo) — one line: *"You are the Lead PM for JStudio. Invoke /pm and run its cold-start protocol. Wait for my pitch. Do not begin work until I provide it."*
3. **Commander auto-injection** — see `session.service.ts` `createSession` flow: reads the bootstrap file, polls for Claude ready, `sendKeys`. Missing file → warn + skip; never fails session create. Raw sessions skip entirely.

If a future refactor touches `createSession`, the bootstrap block and `waitForClaudeReady` helper must survive intact. The `sessionType` flag is the switch.

### Critical lessons from this session

1. **Vite can serve stale code from stale duplicate processes.** Mid-session, the user saw "plan never updates" despite the fix being committed. Two `pnpm dev` processes were running (5173 + 5174); Chrome was connected to the stale one. Diagnosis: `lsof -ti:5173 -ti:5174 -ti:3002`. Recovery: kill all jsc-related processes, `rm -rf client/node_modules/.vite node_modules/.vite`, restart. **Verify the served code matches git HEAD with `curl -s localhost:<port>/src/<file>.ts | grep -c <deleted-symbol>`** — zero matches means the new bundle is actually serving.
2. **Skill tool ≠ Agent tool.** The Skill tool loads a skill into the current context (equivalent to reading its SKILL.md). The Agent tool spawns a sandboxed subagent (one of 4 built-in `subagent_type`s: general-purpose, statusline-setup, Explore, Plan, claude-code-guide). Never call `Agent({ subagent_type: "ui-ux-pro-max" })` — that's a skill, not a subagent type. The PM skill's SKILL.md now documents this explicitly.
3. **Boot-heal must check liveness, not just membership.** The first pass at `upsertTeammateSession` unconditionally flipped stopped → idle on any reconcile. User killed vetcare team-lead, restarted Commander, zombie came back. Fix: `hasLiveEvidence()` — real tmux pane OR JSONL mtime within 10min. Member in config alone is NOT evidence.
4. **Pane-target vs sentinel-target tmux sessions.** `tmux send-keys -t %35` works; `tmux send-keys -t agent:foo` does not. `tmux has-session -t %35` ALSO does not (panes aren't sessions); had to special-case via `display-message -p -t %35 '#{pane_id}'`. Anywhere the code branches on "is this a real tmux target" the test is `!row.tmux_session.startsWith('agent:')`.
5. **Polling + `WHERE status != 'stopped'` is a trap.** Once a row lands in `stopped`, the poller never re-probes it. A transient glitch that stamps a live pane as stopped becomes permanent. Extended the poller to include `OR tmux_session LIKE '%'` so pane-backed rows are always probed; `jsc-*` named rows still respect the filter (stopping those is authoritative).
6. **Task_assignment echoes.** The PM's teammate-messaging system sometimes re-fires old `task_assignment` messages after I've already shipped the task. Always check `git log` before redoing work.
7. **`--escape-owner` pattern for global ESC.** When you add a global keydown listener, any modal/dropdown/prompt in the app must be able to claim ESC first. Add `data-escape-owner="..."` to their root `motion.div` and have the global handler check `document.activeElement.closest('[data-escape-owner]')` — if set, bail.

### Tech debt / follow-ups for future-you

1. **server/src/services/file-watcher.service.ts(90)** — pre-existing `err: Error vs unknown` type mismatch. Ignored throughout this session. Fix by typing the chokidar error callback param as `unknown` then narrowing.
2. **Agent-status heuristic is brittle.** The regex list in `agent-status.service.ts` (ACTIVE_INDICATORS, WAITING_INDICATORS, IDLE_INDICATORS) evolves every time Claude Code adds a new spinner verb. Consider a positive ID via Claude Code's `.claude/status.json` if they ever expose one.
3. **Boot heal writes to DB unconditionally.** `index.ts` startup-recovery iterates every non-stopped row on boot and may fire many status-update events. Harmless but noisy.
4. **teamConfig poll interval is 10s.** New team dirs created after boot take up to 10s to be picked up by `setInterval` in `team-config.service.ts`. Chokidar would be more responsive but globs were dropped in v4.
5. **No DB migration framework.** Schema changes happen via idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `db/connection.ts`. Works for tiny changes; consider drizzle-kit or something when adding tables.
6. **Status poller detectStatus isn't cached.** Each poll cycle shells out to `tmux capture-pane` per row. Fine for ~10 rows; not for 100.
7. **localStorage keys are unnamespaced.** `jsc-split-state-v1`, `jsc-sidebar-collapsed` etc — fine for now. If we ever allow multiple Commander instances on one machine, namespace by server URL.
8. **`.waiting-glow` CSS pulses border and box-shadow.** On low-power devices this is a 60fps repaint on the whole card border. Add `will-change: box-shadow` if profile shows hitches.
9. **SplitChatLayout renders two full ChatPages.** Both run their own `useChat` poll at 1.5s while working. Doubles polling traffic vs a single-pane view.
10. **TeamCreate / TeamDelete chips rely on the caller using those tool names.** Real TeamCreate isn't a tool name I've observed in JSONL from PM sessions (the PM invokes it but Claude Code logs it differently). Verify once a real TeamCreate fires post-#184.
11. **`hook-event.routes` backfills `claude_session_id` opportunistically.** The "claim unclaimed cwd match" strategy is best-effort. If the PM and a teammate both spin up in the exact same cwd within a race window, we might mis-claim. Acceptable for current use; revisit if it misfires.

### SUGGESTIONS (deferred minor items — inventory for the next CTO brief)

- liveComposing preview vanishes abruptly (no fade) when tool_use appends immediately after text ends | impact: MINOR | recommend: defer — only visible on sub-1s turns where fade perception doesn't matter much

### Known-open (PM confirmed)

- **Multi-tab teammate pane** (Task 170.1) — SplitChatLayout currently shows ONE teammate at a time. Multi-teammate flows want ≤3 tabs in the right pane.
- **Direct Mode badge** on the PM pane when the user is focused in the coder pane — informational, no routing change.
- **jstudio-init-project helper** — spec from PM: a slash command or skill that scaffolds `STATE.md` / `PM_HANDOFF.md` / initial directory with one prompt.
- **Playwright E2E** — no browser-control tests have been written. CI-ready harness needed before the user can catch visual regressions automatically.
- **Memory/skill inventory view** inside Commander — surface `~/.claude/skills/` and `~/.claude/projects/<slug>/memory/` as a browsable sidebar panel.
- **Audit stopped teammates older than N days** — auto-archive to `.trash/` so the Sessions page doesn't accumulate zombies.
- **Unit tests on `client/src/utils/plans.ts`** — the plan-building logic is the most logic-heavy util in the codebase and has been broken twice this session. Test `buildPlanFromMessages` against fixture JSONLs (GG3 session exercised the multi-group bug).
- **`tmux_session` for rows without panes.** `agent:<id>` sentinel works for now; a Claude-Code-provided pane-ID hook event would make resolution immediate instead of via `list-panes -a` + cwd match.

### Verify-before-compact checklist (if you need to reproduce any of the above)

- HEAD commits visible via `git log --oneline -20`
- Run `pnpm -C client run typecheck` and `pnpm -C server run typecheck` — the ONLY expected error is the pre-existing file-watcher line 90.
- `~/.claude/prompts/pm-session-bootstrap.md` exists (134 bytes).
- `~/.claude/skills/jstudio-pm/SKILL.md` has a Cold Start section at the top of the body.
- `curl http://localhost:3002/api/chat/<any-team-lead>/stats` returns non-zero `totalTokens` AND `contextTokens`.
- `sqlite3 ~/.jstudio-commander/commander.db 'SELECT id, status FROM sessions WHERE parent_session_id IS NOT NULL'` shows teammates' real status (coder-9 should be working if this conversation is alive).

---


## Coder-8 Output (2026-04-14)

### `b3f6d73` — Verification sweep: 50/50 PASS
All 50 items verified against running server (port 3002) and code. No fixes required.

Evidence highlights:
- Health: `/api/system/health` → `{status:ok, dbConnected:true, tmuxAvailable:true}`
- Session CRUD lifecycle green (create → PATCH → /command → /key Escape → DELETE)
- Effort inherits from `~/.claude/settings.json` on create (returned `effortLevel:"max"`)
- Chat pagination: `?limit=3&offset=0` on 241-msg session returns last 3 (chat.routes.ts:57-59)
- Stats real from JSONL (164K tokens / $41.61 / byModel on GG1 session)
- Hook endpoint `/api/hook-event` → `{ok:true}`, populates transcript_path
- Server log streams `[watcher] JSONL change:` during active sessions
- UI items verified by code inspection (Shiki+Copy, AgentPlan, teal Agent card, etc.)

### `fb32b50` — Plan card moved to user message
VS-Code-Claude style: the plan belongs to the user's request, not Claude's response.
- `UserMessage.tsx` — new `plan?: PlanTask[]` prop renders `<AgentPlan title="Plan" />` below text with `mt-2`
- `ChatThread.tsx` — new helper `buildPlanFromAssistantGroup(groups[gi+1])` pulls the plan from the next assistant group and feeds it to the preceding user message
- `AssistantMessage.tsx` — dropped inline AgentPlan + `buildPlanTasks` + `useMemo`/`AgentPlan`/`PlanTask` imports; TaskCreate/TaskUpdate blocks stay filtered out of the render loop so nothing double-renders
- Real-time: TaskUpdate events stream through polling → ChatThread re-groups → plan rebuilds → progress bar animates
- `tsc --noEmit` → exit 0; client-only (no server restart needed)

### `§` character investigation — NOT a code bug (closed)
The user's reported "`§5` where it should just be `5`" is genuine AI-authored content or user keyboard input, not a rendering artifact.
- `grep -rn '§' client/src server/src packages` → zero hits (only `client/dist/*.js` xterm minified bytes coincidentally match)
- No CSS `::before`/`::after` pseudo-elements inject characters
- No regex in `text-renderer.tsx`, `usePromptDetection.ts`, or tmux pipeline prepends anything
- Live `/output` endpoint capture contains no `§`
- Hits in `~/.claude/projects/**/*.jsonl` are legitimate: the assistant has used `§1`…`§7` as section markers in other projects (elementti-ERP); commander JSONL hits are all the team-lead's report + my investigation
- macOS Option+6 = `§` — user input is the likely source

If a reproducible case ever surfaces, paste the raw JSONL line and re-trace.

### CTO_BRIEF.md exists at project root
332 lines, authored earlier in this session. Canonical reference for the CTO's view of the project. Keep in sync with major arch/ship events.

### Latest active session (reference)
- ID: `5482eb18-096c-4fdd-a6f9-7c2a4c6cf4bf` (GG1)
- Project: `~/Desktop/Projects/GrandGaming`
- tmux: `jsc-5482eb18`
- Hooks firing (PostToolUse events in logs)

### Outstanding notes / no-op zones
- Uncommitted working-tree edits exist in `client/src/components/sessions/SessionActions.tsx`, `SessionCard.tsx`, `client/src/services/api.ts`, `server/src/routes/analytics.routes.ts`, `server/src/routes/session.routes.ts` — these pre-date Coder-8 (survived from Coder-7's workspace). Intentionally NOT committed; verify intent before merging.
- No open bugs. No FAIL items. No regressions.

## CRITICAL LESSONS

### tsx watch DOES NOT hot-reload server changes reliably
The server ran from 6:08 AM without reloading ANY code changes for 4+ hours. All server-side fixes (sendKeys, status detection, hook endpoint, terminal service) were NOT running despite tsx watch being active. **ALWAYS manually restart the server after ANY server-side code change:**
```bash
lsof -ti:3002 | xargs kill -9; cd server && npx tsx src/index.ts &>/tmp/jsc-server.log &
```

### Many "bugs" were actually "server not restarted"
- "sendKeys not delivering Enter" → fix was committed but not running
- "status stuck on working" → detection rewrite not loaded
- "messages not appearing" → polling dedup fix not active
- "hooks not firing" → hook endpoint not registered

## Current Status

**v1 COMPLETE + 42 Coder-7 commits**
- Server port: **3002** (config.json)
- node-pty: **BROKEN** (`posix_spawnp failed`) — terminal uses capture-pane -e 500ms polling
- Claude Code hooks: **CONFIGURED** in `~/.claude/settings.json` (PostToolUse, Stop)
- Hooks only work for sessions started AFTER hook configuration — existing sessions need restart

## Coder-7 Commits (42 total)

| Commit | Description |
|--------|-------------|
| `e768815` | State files audit, CSS @import fix |
| `6af9ae5` | 6 chat fixes: spacing, Crown icon, timeline dots, varied status text |
| `bde70fd` | Consolidate StatusStrip+ResponseSummary into ContextBar, fix Enter key |
| `6da7618` | Move ContextBar above input, remove session info bar, fix text-renderer keys |
| `452059b` | Permission prompt detection: PermissionPrompt + usePromptDetection hook |
| `1117320` | Redesign PermissionPrompt: full tool context display |
| `347d0fe` | Merge consecutive assistant messages (one header per turn) |
| `bb8989c` | Reliability audit: stats polling, field mismatch fix, favicon |
| `a3e8dda` | Adaptive polling (1.5s working / 5s idle), terminal hints |
| `2122f45` | Rewrite agent-status heuristics: skip decorators, detect ❯ in tail |
| `d09534e` | Terminal fallback (capture-pane -e 500ms), startup orphan recovery |
| `9c82b87` | Message grouping: consecutive assistant msgs → one visual block |
| `5490453` | First message appears immediately (before API call) + tool_result grouping |
| `cefdcde` | Plan card rendering + EMFILE file watcher crash fix (usePolling) |
| `19a9b0d` | Plan card auto-check with progress bar |
| `e6ba748` | Smoke test: stats always from JSONL, EMFILE fix (polling watcher) |
| `d6a5081` | ContextBar redesign: always-visible status, glow animation |
| `47895c4` | Accept-edits prompt detection + raw key endpoint (/api/sessions/:id/key) |
| `d204b11` | False positive prompts: only check last 3 lines, 5s dismiss debounce |
| `d24ed0d` | Bulletproof permission prompt: no duplicates, clean edge cases |
| `34527f6` | Remove accept_edits from prompt detection (it's a mode indicator, not prompt) |
| `e1998b5` | Claude Code hook endpoint (/api/hook-event) + specific file watching |
| `ebb6fd1` | Configure hooks in ~/.claude/settings.json (PostToolUse, Stop) |
| `86e2c64` | Filter chat messages by session creation time |
| `af052e9` | Session isolation via transcript_path from hooks |
| `5e45b4d` | Hide stopped sessions from Sessions page |
| `15c7205` | AgentPlan component with animated task tracking |
| `e980b30` | Message queued indicator when Claude is busy |
| `c637c85` | Effort level selector in ContextBar (CircleGauge icon + dropdown) |
| `7bda485` | Optimistic working status — instant "Processing..." on send |
| `99730bb` | Persist effort to ~/.claude/settings.json (later reverted to per-session) |
| `b269d9f` | Per-session effort level: DB column, PATCH handler, Session type |
| `4bc0ddf` | Effort command collision fix (await) + filter internal XML from chat |
| `2224e72` | Render interrupt messages as subtle inline dividers |
| `5463ee6` | New sessions inherit effort level from Claude settings |
| `0b4a7b3` | Numbered choice prompt (❯ 1.) detected as waiting, not idle |
| `453beb1` | sendKeys uses -l flag for literal text + separate Enter call |
| `c56e40d` | Polling dedup: ID set comparison (replaced next commit) |
| `1459423` | Simplified polling: count + last ID compare, server is source of truth |
| `d350e39` | Pre-compaction state dump |
| `a1a0a9d` | Live activity indicator at bottom of ChatThread |
| `e2b7f77` | userJustSent no longer clears prematurely when session is working |
| `fb25ec4` | Long message truncation (300 chars) + 8s idle cooldown + more active indicators |
| `fa6380d` | **CRITICAL: Chat API pagination fix** (last N not first N) + richer terminal hints + Agent/Skill rendering |

## File Inventory

### server/src/ — Key Files
- `index.ts` — Fastify entry + startup recovery (stale status, orphan tmux, gone sessions)
- `config.ts` — reads ~/.jstudio-commander/config.json
- `db/connection.ts` — SQLite + migrations (transcript_path, effort_level columns)
- `db/schema.sql` — 11 tables + transcript_path + effort_level columns
- `services/tmux.service.ts` — sendKeys with `-l` literal + separate Enter, sendRawKey for Escape/Tab
- `services/session.service.ts` — CRUD, auto-slug, effortLevel from Claude settings on create
- `services/agent-status.service.ts` — hasIdlePromptInTail vs hasNumberedChoiceInTail, skip decorators
- `services/terminal.service.ts` — capture-pane -e 500ms polling fallback (node-pty broken)
- `services/file-watcher.service.ts` — chokidar (usePolling) + watchSpecificFile (fs.watch from hooks)
- `services/watcher-bridge.ts` — JSONL → chat events + token tracking
- `routes/session.routes.ts` — CRUD + /command + /key + /output (prompt detection: last 3 lines)
- `routes/chat.routes.ts` — messages + stats from transcript_path or findLatestSessionFile
- `routes/hook-event.routes.ts` — receives PostToolUse/Stop from Claude Code, stores transcript_path
- `routes/terminal.routes.ts` — WebSocket /ws/terminal/:sessionId
- `routes/system.routes.ts` — health, config (reads effortLevel from Claude settings)

### client/src/ — Key Files
- `components/chat/AssistantMessage.tsx` — accepts messages[] array, renders AgentPlan for TaskCreate/TaskUpdate
- `components/chat/ChatThread.tsx` — MessageGroup[] grouping, filters tool_result/XML/interrupt messages, SystemNote component
- `components/chat/ContextBar.tsx` — always-visible status, effort selector dropdown, optimistic userJustSent, bar-glow animation
- `components/chat/PermissionPrompt.tsx` — amber card for prompts, sendAction (command vs raw key)
- `components/chat/AgentPlan.tsx` — animated task list with status icons, expandable subtasks, progress bar
- `components/chat/UserMessage.tsx` — Crown icon + "JB"
- `hooks/useChat.ts` — adaptive polling (1.5s/5s), simplified dedup (count + last ID), accepts sessionStatus
- `hooks/usePromptDetection.ts` — prompt detection + terminal hints + messagesQueued + fast poll when userJustSent
- `pages/ChatPage.tsx` — optimistic userJustSent, queued indicator, interrupt via Escape
- `pages/SessionsPage.tsx` — active sessions only (stopped hidden)
- `utils/text-renderer.tsx` — AgentPlan for numbered lists, code blocks, inline formatting
- `public/favicon.svg` — teal diamond

### Deleted Files
- StatusStrip.tsx, ResponseSummary.tsx, UserBubble.tsx, AssistantBubble.tsx

### New Files (Coder-7)
- `components/chat/AgentPlan.tsx`, `components/chat/PermissionPrompt.tsx`
- `hooks/usePromptDetection.ts`
- `routes/hook-event.routes.ts`
- `hooks/commander-hook.sh` (in project root + ~/.claude/hooks/)
- `public/favicon.svg`

## Key Architecture

- **Polling chain:** useChat polls every 1.5s (working) or 5s (idle). Server reads JSONL file, returns messages. Frontend replaces if count or last ID differs.
- **Hook chain:** Claude Code → PostToolUse hook → curl POST /api/hook-event → watchSpecificFile(transcript_path) → fs.watch detects change → bridge reads new lines → WS broadcast
- **Status detection:** tmux capture-pane → skip decorators → check numbered choices (❯ N. = waiting) → check idle prompt (❯ alone = idle) → check active indicators (✻, Nesting, esc to interrupt = working) → default idle
- **Session isolation:** transcript_path column stores exact JSONL file path from hooks. Chat API uses it instead of scanning directory.
- **Effort level:** per-session in DB (effort_level column), selector in ContextBar sends /effort command + PATCH to session

## Bugs Found & Fixed (Major)

1. **Stats always 0** — watcher-bridge never called tokenTrackerService; stats endpoint now calculates from JSONL directly
2. **Stats field mismatch** — backend {totalTokens} vs frontend {totalInputTokens} → fixed interface
3. **Polling dedup blocked updates** — `length <= prev.length` skipped new messages → simplified to count + last ID
4. **Numbered choice = idle** — `❯ 1. Yes` matched as idle prompt → split into hasIdlePrompt vs hasNumberedChoice
5. **sendKeys missing Enter** — rapid commands caused tmux buffering → -l flag + separate Enter call
6. **EMFILE crash** — chokidar watched 826K files → usePolling + depth:1 + ignored patterns
7. **Old conversation in new session** — findLatestSessionFile loaded old JSONL → transcript_path isolation
8. **tsx watch unreliable** — server-side changes not hot-reloaded for hours → ALWAYS manually restart
9. **accept_edits false prompt** — ⏵⏵ is a mode indicator, not actionable → removed from detection
10. **Effort command collision** — /effort concatenated with next message → await before allowing next send
11. **Raw XML in chat** — <command-name> tags from /effort → filtered in ChatThread grouping
12. **First message not appearing** — local message created after API await → moved before API call
13. **Newest messages missing from chat** — `slice(offset, offset+limit)` with offset=0 returned FIRST 200 not LAST 200. With >200 messages, newest ones never rendered. Fixed in chat.routes.ts: `offset === 0 && total > limit ? slice(total - limit) : slice(offset, offset+limit)`
14. **userJustSent clearing too early** — was clearing when session was already working, making "Queued" flash and disappear. Now only clears when new assistant messages arrive.
15. **Status flashing idle during edits** — Claude pauses briefly between tool calls, status poller detected idle. Increased cooldown to 8s (2 poll cycles). Added more active indicators (Hullaballoo, Cogitat, Brewed, Crunching, ⏺, ✶).

## Notes for Next Coder

- **RESTART SERVER after every server-side change** — `lsof -ti:3002 | xargs kill -9; cd server && npx tsx src/index.ts`
- **node-pty is BROKEN** — posix_spawnp failed. Don't try to fix it. Terminal uses capture-pane.
- **AssistantMessage takes messages[] array** — NOT single message
- **StatusStrip and ResponseSummary are DELETED** — all in ContextBar
- **Stats API returns {totalTokens, totalCost, byModel}** — NOT totalInputTokens
- **Hooks only fire for NEW Claude sessions** — existing sessions need restart to pick up settings.json changes
- **Sonnet context limit is 1M** (user corrected)
- **Session has effort_level column** — read via session.effortLevel, change via PATCH + /effort command
- **transcript_path column** — set by hooks, used by chat API for JSONL isolation
- **sendKeys uses -l flag** — literal text, then separate Enter call
