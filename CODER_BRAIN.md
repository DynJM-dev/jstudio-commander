# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-16 — Coder-11 post-Phase-B refresh (proactive, pre-Phase-C handoff)
> Coders: Coder-7 (42 polish commits) → Coder-8 (verified + plan-attach) → Coder-9 (17+25 commits across two sessions) → Coder-11 (8 Phase A+B commits)
> Model: Opus 4.7 (migrated from 4.6 in commit 6d69fb0)

## HEAD of main (post-sprint)

```
6d69fb0 feat(sessions): migrate to Opus 4.7 + xhigh default effort
4a22eca feat(chat): manual refresh button in ContextBar (#237)
15232d1 fix(status-poller): tighten waiting detection (#236)
ba226e3 style(projects): ProjectDetailPage polish pass (#235)
6ea27d9 style(projects): filter pills + Rescan design system (#234)
519fb4c fix(split-chat): mobile collapses to PM full-width + strip (#233)
816c772 fix(mobile-nav): preserve 64px content area safe-area (#232)
89f1ae2 feat(tunnel): TopCommandBar tunnel URL + QR (#231)
2f99184 docs+style: UI rundown audit + fixes (#228)
89dea5f feat(projects): linked-sessions cluster + polish (#227)
d574177 feat(sessions): richer SessionCard + effort pill (#226)
851025e style(sessions): button-style top-bar tabs (#225)
15117b0 fix(chat): harden pendingLocal dedup (#224)
1234f40 fix(status): broaden waiting detection (#222)
4859e2a fix(sessions): disambiguate dup names + stopped fold (#220)
72f14fe docs: token-efficiency audit (#215)
415df99 feat(city): gamified cyberpunk city view (#214)
```

See `CTO_BRIEF.md` (§5) for earlier feature table. Commits above are the post-compaction sprint.

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

### Post-compaction sprint (2026-04-15 → 2026-04-16)

#### Architecture changes
- **Rotation detector DELETED.** `rotation-detector.service.ts` (~260 lines of heuristics) replaced by deterministic `transcript_paths: string[]` column. Hooks append paths; chat endpoint concatenates across all paths in array order. No cwd scans, no fingerprints. This killed the entire "Wild-puma battling" class of bugs.
- **Hook events serialized.** Module-level promise chain in `hook-event.routes.ts` guarantees each hook's resolveOwner → appendTranscriptPath completes before the next starts. Closes the `cwd-exclusive` race window.
- **Session create/delete transactional.** DB writes wrapped in `db.transaction()` with tmux cleanup on rollback.
- **Status detection deepened.** Capture window 15→25 lines. Idle-footer short-circuit (`hasIdleFooter()`) prevents false-waiting on chrome text. Removed bare `/\?\s*$/m` pattern. Added `hasNumberedChoiceBlock()` for choice lists without `❯` marker.

#### Design system spine (CSS class system — DO NOT duplicate inline)
- `.nav-btn` + `.nav-btn--active` + `.nav-btn--muted` + `.nav-btn--collapsed` — sidebar buttons
- `.session-tab` + `.session-tab--active` + `.session-tab--working` + `.session-tab--stopped` + `.session-tab--stack` — TopCommandBar tabs
- `.cta-btn-primary` — primary action buttons (modals, New Session, empty state CTAs)
- `.filter-chip` + `.filter-chip--active` — filter toggle bars (ProjectsPage)
- `.waiting-tab-alarm` — composes on any of the above for waiting-state yellow pulse

#### New features
| Feature | Commit | Notes |
|---|---|---|
| City view `/city` | 415df99 | Pure CSS pixel art, no canvas. Role-palette characters, building-per-session, WS-driven speech bubbles, visibilitychange pause. |
| Tunnel URL + QR | 89f1ae2 | `TunnelBadge` component in TopCommandBar. `qrcode.react@4` for phone-scan QR. |
| Manual refresh button | 4a22eca | RotateCw in ContextBar. Clears pendingLocal + `useChat.refetch()` + fire-and-forget `/sessions/:id/rescan`. |
| Button-style session tabs | 851025e | Replaced underline-bar look with rounded pills + state-aware glow. |
| SessionCard richer info | d574177 | Effort pill, model short-form, time-since-activity, SplitSquareHorizontal quick-action. |
| ProjectCard linked sessions | 89dea5f | Status-colored dots + count cluster, last-scanned timestamp, compact file indicators. |
| Stopped fold | 4859e2a | Stopped sessions collapse behind a ChevronRight header on SessionsPage. |
| Session name disambiguator | 4859e2a | `sessionDisplay.ts` — same-name sessions get ` · <first-6-of-id>` suffix. |
| Analytics revamp | 7a24976 | Count-up animation, trend deltas (today vs yesterday, week vs prior-week), staggered reveal. |
| Mobile split collapse | 519fb4c | `useIsNarrow()` forces minimized strip below 768px. Teammate icon tap navigates to full single-pane. |
| MobileNav safe-area | 816c772 | `height: calc(64px + env(safe-area-inset-bottom))` so tap targets aren't squeezed. |

#### Fixes
| Fix | Commit | Root cause |
|---|---|---|
| Analytics null crash | 522fc7e | `row.sessionId.slice(0, 8)` when sessionId is null |
| useChat stale poll (#193) | earlier | Content streaming into existing messages wasn't detected by id-only dedup. Fixed with tail-block JSON.stringify comparison. |
| pendingLocal dup render | 15117b0 | Trim-only equality + no time fallback. Normalized + 10s+status safety valve. |
| Waiting false-positive | 15232d1 | `\?\s*$/m` matched idle-footer "new task?". Removed + added hasIdleFooter() gate. |
| Waiting over-match (#222) | 1234f40 | 15-line capture too shallow + missing patterns. Bumped to 25 + broadened. |

#### Opus 4.7 migration (6d69fb0)
- DEFAULT_MODEL → `claude-opus-4-7` (no `[1m]` suffix — 4.7 gets 1M automatically)
- Commander-spawned sessions: `model: 'claude-opus-4-7'`, `effort_level: 'xhigh'`
- Post-boot injection: `/effort xhigh` (was `/effort max`)
- Team config normalizer: opus/claude-opus-4-6/claude-opus-4-6[1m] → claude-opus-4-7
- On-disk `~/.claude/teams/*/config.json` migrated via sed
- 4.6 entries kept in MODEL_CONTEXT_LIMITS + MODEL_PRICING for backward compat

#### Audits completed
- `AUDIT_2026-04-15.md` — 14-scenario edge-case audit (12 PASS, 2 CONCERN → #206/#207 filed+shipped by coder-10)
- `AUDIT_TOKENS_2026-04-15.md` — 12-surface token audit (1 Wasteful #217, 5 Optimizable #216/#218/#219/#221/#223)
- `UI_AUDIT_2026-04-15.md` — full UI rundown (2 Major #234/#235 shipped, 2 Minor fixed inline, 8 Nit)
- `TUNNEL_AUDIT_2026-04-15.md` (coder-10) — 9 security fixes + hardened PIN auth

### SUGGESTIONS (deferred minor items)

- liveComposing preview vanishes abruptly (no fade) when tool_use appends | MINOR | defer
- ContextBar CostChart x-axis crowds at 320px viewport | NIT | defer

### Known-open

- ~~Multi-tab teammate pane~~ → SHIPPED (#197)
- ~~Direct Mode badge~~ → SHIPPED (#197)
- ~~Playwright E2E~~ → SHIPPED (#201, 5 core tests)
- ~~Stopped teammate cleanup~~ → SHIPPED (#202, 7-day cron)
- ~~Unit tests plans.ts~~ → SHIPPED (#199, 6 tests)
- **jstudio-init-project helper** — spec from PM: scaffold STATE.md / PM_HANDOFF.md with one prompt.
- **Memory/skill inventory view** — surface `~/.claude/skills/` and memory files as a browsable panel.
- ~~**Token-audit follow-ups #216 / #219 (preview offscreen pause)**~~ → SHIPPED in Phase B (coder-11, 2026-04-16). #217/#218/#221/#223 shipped in Phase A.
- **#230** — Project tech-stack pills + git commits. Needs coder-10 server endpoint. Phase C target.
- ~~**#191** — Stale-transcript warning pill~~ → CLOSED 2026-04-16 (obsolete post-#204 deterministic transcript_paths model; zero code references).
- **Batch /output endpoint** — deferred Phase B sub-item. Server side is ~30 min; client-side coordination (each `SessionTerminalPreview` owns its own poll, batching needs a shared coordinator hook or context) was the cost driver. Marginal value drops once #219's offscreen-pause is in. Revisit if multi-teammate views measurably hot.

---

## Coder-11 Session (Phase A + Phase B, 2026-04-16)

### Commits

```
ad3d7fe perf(chat): pause SessionTerminalPreview poll when offscreen (#219)
6177fe2 perf(chat): tail-delta polling via ?since=<msgId> (#216)
2787b2d docs: add Phase A completion to STATE.md
72d2fae docs: close #191 stale-transcript pill as obsolete post-#204
69a66f0 perf(sessions): extract useSessionTree shared hook (#221)
49f149a fix(analytics): wire useAnalytics WS sub to analytics:token (#223)
c21ab5b perf(sessions): module-level cache for CreateSessionModal projects (#218)
b7886fb perf(layouts): consolidate TopCommandBar + MobileOverflowDrawer polls (#217)
```

### Patterns established

- **Tail-delta polling protocol (#216)** — client cursor is the SECOND-to-last message id, not the actual last. The actual last is always re-fetched and merged so #193's in-place block growth (Claude streams new content blocks INTO an existing assistant message during composing) keeps working. Server `?since=<msgId>` is **strictly exclusive**; unknown id falls back to the tail-window default. Client merge fn (`mergeDelta`) replaces by id when content differs and appends new ids — returns `prev` ref unchanged when nothing differs so `useMemo([messages])` chains stay stable.
- **Module-level service cache (#218)** — `client/src/services/projectsCache.ts` is the pattern. Hook (`useProjects`) invalidates on mutations + on relevant WS events; consumer (`CreateSessionModal`) reads via `getProjectsCache()` / `setProjectsCache()`. Avoid the temptation to put the cache inline in the component — a hook importing from a component creates a bad dependency direction.
- **WS-driven hooks > setInterval polls in layouts (#217)** — `TopCommandBar` and `MobileOverflowDrawer` now subscribe to the WS-driven `useSessions()` + `useAnalytics()` instead of polling. Each `useSessions()` / `useAnalytics()` call adds its own initial mount fetch (multiplexed WS subscription via the WebSocketProvider context) but no recurring polls. Acceptable trade today; future `SessionsContext` would deduplicate the initial fetches if needed.
- **Shared tree-derivation hook (#221)** — `useSessionTree(sessions)` + `buildSessionTree(sessions)`. Hook accepts a pre-filtered list so each consumer keeps its own filter (active vs live). `buildSessionTree` is exported for unit-test addressability. SessionsPage + CityScene consume; SplitChatLayout uses the server endpoint `/sessions/:id/teammates` and is correctly out of scope.
- **IntersectionObserver via callback ref (#219)** — when a component has multiple return paths (loading / not-alive / normal), the wrapper element swaps under React. A `useRef` + `useEffect([],[])` would only observe the mount-time element. Use a `useCallback` ref that disconnects the prior observer + creates+observes the new one on every ref binding. `observerRef` holds the active observer for cleanup on unmount.
- **Analytics WS event is `analytics:token`** (NOT `usage:updated`). Confirmed via `server/src/ws/event-bus.ts:42` and `packages/shared/src/types/ws-events.ts:17`. `useAnalytics` debounces refetch by 2s — a working session emits one usage entry per assistant message and a per-event refetch would re-amplify.

### Critical lessons (read before touching nearby code)

1. **`?since=<id>` cursor must be SECOND-to-last, not actual last.** If you point it at the actual last id, you lose Claude Code's in-place block growth detection (#193 invariant). The 1-message overhead per poll is what buys you the growth-detection guarantee.
2. **Server `?since=` returns `total = full transcript length`, NOT delta length.** `hasMore = messages.length < total` only works because the client maintains the full append-only list locally; don't try to interpret `total` as a delta-response field.
3. **`pre-existing file-watcher.service.ts:90` typecheck error is GONE.** Both `pnpm -C client typecheck` and `pnpm -C server typecheck` are clean as of HEAD `ad3d7fe`. If you see that error reappear, something regressed.
4. **`projectsCache` invalidation flows through `useProjects`.** If you add another mutation path for projects (new endpoint, direct API call from a component), call `invalidateProjectsCache()` from `client/src/services/projectsCache.ts` after the mutation succeeds — otherwise `CreateSessionModal` will show stale autocomplete for up to 60s.
5. **The `analytics:token` debounce ref (`refetchTimer`) needs `clearTimeout` on cleanup** to avoid setting state on an unmounted hook. Already wired in `useAnalytics.ts`; preserve it if you refactor.

### Tech debt opened by Phase A+B

- `useSessions()` and `useAnalytics()` are now mounted in 3+ places each (TopCommandBar, MobileOverflowDrawer, plus their original consumers). Each adds an initial mount fetch. Future `SessionsContext` / `AnalyticsContext` would deduplicate.
- `SessionTerminalPreview`'s observer + ref attachment is fine but every preview now allocates an `IntersectionObserver`. If a future view ever mounts dozens of previews, consider sharing one observer at the parent level.
- The `mergeDelta` JSON.stringify-based equality check in `useChat.ts` is O(content blocks) per cursor message per poll. Fine at typical block sizes; revisit if profiles show it.
- Batch `/output` endpoint deferred (see backlog). Re-evaluate after #230 lands and the multi-teammate split-view is more heavily used.

### HEAD (post-Phase-B)

```
ad3d7fe perf(chat): pause SessionTerminalPreview poll when offscreen (#219)
6177fe2 perf(chat): tail-delta polling via ?since=<msgId> (#216)
```

Both typechecks PASS, server `/api/system/health` returns `{status:"ok",dbConnected:true,tmuxAvailable:true}`. Tail-delta verified end-to-end on a 370-msg session: cursor=2nd-to-last → 1 message returned; cursor=last → 0 returned; cursor=unknown → tail fallback.

---

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
