# CODER_BRAIN.md — JStudio Commander

> Last updated: 2026-04-17 — Coder-16 post-Phase-K refresh
> Coders: Coder-7 (42 polish commits) → Coder-8 (verified + plan-attach) → Coder-9 (17+25 commits across two sessions) → Coder-11 (8 Phase A+B commits) → Coder-12 (Phase C/D/E, 17 commits) → Coder-14 (Phase F/G/G.1/G.2, 13 commits) → Coder-15 (Phase H + I + J + J.1, 11 commits + 1 Phase-I.0 team-lead emergency patch) → Coder-16 (Phase K, 3 commits)
>
> **Coder-16 rotation — read this first if you are the incoming coder:**
> The "Coder-15 Cold Start Guide" section near the end of this doc collects
> the base context. The "Phase K addendum to the Cold Start Guide" section
> right after it adds the invariants introduced by the multi-wrapper parser.
> Read both before touching chat-stream rendering.
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

## Coder-12 Session (Phase C, 2026-04-17)

### Commits

```
dae794f feat(projects): ProjectCard stack pills + recent commits UI (#230)
0970950 feat(projects): stack detection + recent-commits service (#230)
```

### What shipped

- **`server/src/services/project-stack.service.ts`** — new. `detectStack(path)` is sync: scans package.json (JSON.parse, deps+devDeps, TS/JS language pill), pyproject.toml (regex on PEP-621 + poetry blocks), Cargo.toml (regex on `[dependencies]`), go.mod (both `require ( ... )` block and single-line `require`), Gemfile (`gem '...'`), composer.json (JSON.parse), pubspec.yaml (regex; Flutter pill if present). `getRecentCommits(path, limit)` is async, `execFile('git', ['-C', path, 'log', '--no-merges', '--format=%h|%s|%cI', '-n', N])` with 3s timeout + 256KB maxBuffer. Both return `[]` on missing/unparseable/non-git.
- **Mapping table** — single ordered array, longest-prefix-first (so `@react-pdf/renderer` hits before bare `react` if it ever becomes a direct dep). ~35 entries across framework/backend/database/tool.
- **Monorepo support** — `resolveWorkspaceDirs()` reads `pnpm-workspace.yaml` (regex on `-  'glob'` lines) AND `package.json.workspaces` (array OR `{packages: []}`). Supports bare paths, `pkg/*`, `pkg/**`. Manifests in each workspace dir are merged into the root pill set. Without this, the Commander repo itself reported `[TypeScript]` only (root pkg.json is tooling-only).
- **`project-scanner.service.ts`** — `scanDirectories` now populates `stack` synchronously. New `enrichWithCommits(projects)` runs `Promise.all(getRecentCommits)` per project. `syncToDb` persists JSON.stringified columns; `rowToProject` parses them back via a `safeParseJson` helper. `runInitialScan` is now async; all 3 call sites awaited.
- **DB** — projects table `stack_json` + `recent_commits_json` (TEXT NOT NULL DEFAULT '[]'). Idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`-style pattern (checks `PRAGMA table_info` first since SQLite ALTER doesn't support `IF NOT EXISTS` on ADD COLUMN). Schema.sql also updated for fresh installs.
- **Routes** — `POST /api/projects/scan` now enriches + emits `project:scanned` via `eventBus.emitProjectsScanned(listed)`. New `POST /api/projects/:id/rescan` for per-project refresh (scans parent dir, filters to the target path, enriches, persists, emits `project:updated`). Returns the refreshed Project.
- **Watcher-bridge** — STATE.md/HANDOFF.md changes kick off `enrichWithCommits` fire-and-forget; syncToDb + emit happen inside the `.then()`. Non-blocking.
- **Shared** — `Project` gains `stack: StackPill[]` + `recentCommits: RecentCommit[]`. New exports: `StackPill`, `StackCategory`, `RecentCommit`. Because WS events `project:updated` / `project:scanned` pass the full Project shape (unchanged type structure), clients receive the fields automatically.
- **ProjectCard** — new pills row between phase progress and footer; new commits section with 3-visible collapsed state + Show N more toggle. Both sections omit entirely when their array is empty. Category color map: framework=color-accent-light (teal), language=violet (#8B5CF6), tool=slate (#94A3B8), backend=color-working (green), database=color-idle (amber). Overflow chip `+N` shows count with a `title` listing the overflow labels.

### Patterns established

- **Sync manifest detect + async commit enrich** — keep detection costs where they're cheapest (filesystem) and batch the shell-out cost. This separation lets `scanDirectories` stay sync for any future caller that doesn't care about commits.
- **`safeParseJson<T>(raw, fallback)`** — swallows malformed DB JSON + non-array values into an empty array. Pattern for any future JSON-blob column on a sync row mapper.
- **Monorepo manifest walking** — `resolveWorkspaceDirs` is the pattern: read both `pnpm-workspace.yaml` and `package.json.workspaces`, expand `*`/`**` shallowly, merge all manifests into a single pill set. Dedup via `seen: Set<${category}:${label}>`.
- **Fire-and-forget async enrichment in watcher callbacks** — `void fn().then(...)` keeps the file-watcher callback sync while letting git log run async. Don't await inside chokidar callbacks; they'll queue and throttle each other.

### Critical lessons (read before touching nearby code)

1. **SQLite ALTER TABLE doesn't support `ADD COLUMN IF NOT EXISTS`.** The `IF NOT EXISTS` works for `CREATE TABLE` but not column adds. Use the pre-existing pattern in `connection.ts`: `PRAGMA table_info(t)` → `.some((c) => c.name === '<col>')` gate. I mirrored the sessions-table migrations block.
2. **The root `package.json` in a pnpm monorepo is almost empty.** Any `detectStack` that doesn't recurse into workspace members returns only the language pill for the root. Test case: jstudio-commander itself. If you add another detection step and it silently returns `[]` for monorepo roots, check workspace recursion.
3. **`git log --no-merges` keeps the recent-commits list useful.** Without it, merge commits clutter the preview. The subject line for a merge is usually auto-generated ("Merge branch ...") and adds no signal.
4. **`execFile`, not `exec`.** Shell expansion on project paths with spaces/quotes would be a cmd-injection risk. `execFile(['git', '-C', path, 'log', ...])` passes args as separate tokens.
5. **POST /projects/scan was silent on WS before.** Only the watcher-bridge emitted `project:updated`; the manual scan endpoint just returned the list without a broadcast. I added `emitProjectsScanned(listed)` so any other connected client's `useProjects` gets the fresh data without a re-fetch.

### Tech debt opened by Phase C

- `resolveWorkspaceDirs` handles `pkg`, `pkg/*`, `pkg/**` shallowly (only one directory level deep). A Lerna-style `packages/scope-*/pkg-*` wouldn't be caught. Fine for current repos; add a real minimatch if someone brings a 3-level monorepo.
- Stack mapping table is ~35 entries. Every net-new framework we see in a live project is a one-line add. Grow organically; don't over-engineer.
- `pyproject.toml` uses regex-lite — a pyproject that puts deps in `[tool.uv]` or some other newer config section won't be parsed. Adding `smol-toml` is the upgrade path if this gets noisy.
- Per-project `/rescan` accepts a path-parent scan then filters — wasteful if the parent has 30+ siblings. If this hot-paths, refactor `scanDirectories` to accept a single project path.
- Pills use inline hex for violet/slate. If a dark/light-mode variant of the theme adds those, swap to CSS vars.
- `enrichWithCommits` is unbounded concurrency via `Promise.all`. With 32+ projects on initial scan each doing a git shell-out, this could spike. Fine today; add a small concurrency gate (e.g. `p-limit(8)`) if scans feel slow on larger setups.

### HEAD (post-Phase-C)

```
dae794f feat(projects): ProjectCard stack pills + recent commits UI (#230)
0970950 feat(projects): stack detection + recent-commits service (#230)
2d86bf7 docs: Phase B completion + coder-11 brain refresh
```

All three typechecks PASS (shared, client, server). Server restart clean; `/api/system/health` → `{status:"ok",dbConnected:true,tmuxAvailable:true}`. Initial scan detected 32 projects; 20 have a non-empty stack, 11 have commits, 0 crashes on missing-manifest/no-git. jstudio-commander itself reports `[TypeScript, SQLite, Fastify, React, Tailwind, Vite]` + 10 recent commits. `POST /api/projects/:id/rescan` round-trip verified.

---

## Coder-12 Session — Phase D (Launch UX hardening, 2026-04-17)

### Commits

```
9cf67af chore(port): migrate default server port 3002 → 11002
02ae1ef feat(launcher): macOS .app bundle with auto-detect + auto-boot
23ea243 feat(client): vite dev preflight detects running commander instance
6fda3c3 feat(server): signed /api/system/health + duplicate-instance preflight
```

### What shipped

- **Signed /api/system/health.** Adds `service: 'jstudio-commander'` + `version: '<server/package.json version>'` so any preflight (self-check, client, launcher) can unambiguously ID our instance. Version read via new `server/src/version.ts` (`SERVICE_ID`, `SERVICE_VERSION` constants — dual-layout aware so `tsx` dev and `tsc` build both resolve `server/package.json`).
- **Server preflight.** `server/src/preflight.ts` (`detectExistingCommander(port)` + `printDuplicateBanner`). Runs in `server/src/index.ts` BEFORE `acquireInstanceLock()` and `app.listen()`. 500ms timeout, ANSI yellow banner, `process.exit(0)` on signed match (clean exit — NOT `exit(1)`). Non-signed response or timeout falls through to the normal bind + instance-lock path.
- **Client Vite preflight.** `client/scripts/preflight.mjs` chained into `"dev": "node scripts/preflight.mjs && vite"`. Why chained in `dev` instead of `predev`: pnpm's pre/post script hooks are OFF by default (`enable-pre-post-scripts=false` in pnpm 7+), so `predev` wouldn't run without an `.npmrc` flip. Chaining is more portable.
- **macOS .app launcher.** `scripts/macos-launcher/{Info.plist,launcher.sh,build.sh}` produces `~/Desktop/Commander.app`. Icon pipeline: sips-rasterize `client/public/favicon.svg` → 1024 PNG → iconset (16/32/128/256/512 + @2x each) → iconutil .icns. Fallback chain if sips can't handle SVG: qlmanage → rsvg-convert (with a clear brew install hint). Info.plist version templated via `__VERSION__` substitution from `server/package.json`.
- **launcher.sh runtime.** Reads port from user config (fallback 11002), pings signed health. Hit → `open URL`. Miss → `osascript` into Terminal.app for visible `pnpm dev`, poll 30s, open URL. Timeout → open anyway (UI shows its own loading state).
- **Port migration.** Default 3002 → 11002 across: `server/src/config.ts` (both loadFileConfig default + export default), `pin-auth.ts` DEFAULT_CONFIG, `client/vite.config.ts` (proxy /api + /ws), `client/e2e/helpers.ts` COMMANDER_API default, `hooks/commander-hook.sh` POST target, `TUNNEL.md` (3 refs), `CTO_BRIEF.md` (live doc). User's `~/.jstudio-commander/config.json` port override still wins — by design. Historical CODER_BRAIN per-coder sections + archived audits left at 3002 as point-in-time refs.

### Patterns established

- **Signed service identifier on /health.** `service: '<kebab-case>'` + `version: '<pkg version>'` — any preflight caller matches on service ID. Cheap, collision-proof, and future-proofs launcher rewrites.
- **Chain over predev.** `"dev": "node preflight && vite"` is more portable than relying on pnpm pre/post hooks. Use this pattern anywhere you need a pre-step without config flips.
- **macOS .app from scratch.** You don't need electron/tauri for a thin desktop launcher — three files (Info.plist, launcher shell, build script) + macOS built-ins (sips, iconutil, osascript) are enough. Gitignore the output `.app` + `.icns` + `iconset/`.
- **Version substitution via sed template.** `__VERSION__` placeholder in Info.plist + `/usr/bin/sed "s/__VERSION__/$VER/g"` at build time keeps the plist in the repo as a stable source, no generated-plist-noise in git.

### Critical lessons (read before touching nearby code)

1. **Preflight must run BEFORE `acquireInstanceLock()`.** If the lock fires first on a duplicate Commander, the user sees the harsher lock-error exit(1) instead of the friendly banner. Order in `index.ts`: preflight → lock → getDb → listen.
2. **Use `process.exit(0)` in the preflight duplicate path.** `exit(1)` would bubble up to `pnpm`/shell as an error, confusing the user. The duplicate is a SUCCESS from the user's perspective ("Commander is already running — use it").
3. **`tsx watch` survives `process.exit(0)` in the child.** After the preflight exits cleanly, `tsx watch` stays alive watching for file changes, but never re-spawns because the source is fine. UX-wise: the banner is the last output the user sees until they Ctrl-C. Acceptable.
4. **500ms fetch timeout + AbortController is enough.** Longer waits make a cold `pnpm dev` feel sluggish on every start (`fetch` blocks boot). 500ms is long enough to let a running server respond on loopback, short enough to not notice on miss.
5. **macOS sips can rasterize SVG on recent macOS but not older versions.** The fallback chain (qlmanage → rsvg-convert) is load-bearing on Ventura/Monterey. qlmanage is built-in; rsvg-convert requires `brew install librsvg`. Build script exits with a clear install hint if ALL three fail.
6. **User config override is a feature, not a bug.** `~/.jstudio-commander/config.json` `port` field takes precedence over the new default. Document it in STATE.md + TUNNEL.md so users don't delete their file thinking it's stale.
7. **The user-managed hook script lives outside the repo.** `~/.claude/hooks/commander-hook.sh` is a COPY of `hooks/commander-hook.sh`. If you change the repo hook's port, the user must re-copy — Commander can't rewrite user ~/.claude files.

### Tech debt opened by Phase D

- **tsx watch keeps watching after preflight exit.** Not a bug — tsx watch sees clean exit + unchanged source, so it stays idle. But if the user edits `src/index.ts` while the preflight-exited tsx is still watching, it could try to re-run. Acceptable for now; if it hot-paths, switch `dev` to `tsx src/index.ts` (no watch) or trap the clean exit differently.
- **macOS launcher repo path is hardcoded.** `REPO="$HOME/Desktop/Projects/jstudio-commander"` in launcher.sh assumes the conventional install location. Move to a build-time template (`__REPO_PATH__`) or a companion config file if users start relocating the repo.
- **Version is read at boot.** `SERVICE_VERSION` is captured at module-load, so a `pnpm version bump` without a restart won't flow through. Fine for typical usage — restart is already mandatory after server edits.
- **Hook script user-copy drift.** No automated sync between repo `hooks/commander-hook.sh` and `~/.claude/hooks/commander-hook.sh`. Future: add a `pnpm run install-hooks` that diffs and rsyncs, or have Commander print a one-time warning on boot if the user-copy's target port doesn't match config.port.
- **Port 11002 choice.** Arbitrary — unreserved, no-conflict-today. If Codeman or another JStudio tool wants nearby ports, keep them spaced (Codeman on 3001 stays, Commander on 11002, tunnel pool TBD).

### HEAD (post-Phase-D)

```
9cf67af chore(port): migrate default server port 3002 → 11002
02ae1ef feat(launcher): macOS .app bundle with auto-detect + auto-boot
23ea243 feat(client): vite dev preflight detects running commander instance
6fda3c3 feat(server): signed /api/system/health + duplicate-instance preflight
dae794f feat(projects): ProjectCard stack pills + recent commits UI (#230)
```

---

## Coder-12 Session — Phase E (4.7 migration finish + NODE_ENV gate + Command Center rebrand, 2026-04-17)

### Commits (10, pre-docs)

```
Bundle 1 — Finish 4.7 migration:
  f956fcc fix(sessions): CreateSessionModal default to Opus 4.7
  15fe784 fix(chat): ContextBar effort dropdown to high|xhigh|max per skill
  ab72eec fix(analytics): ModelBreakdown color for Opus 4.7
  05ebbcd chore(schema): column defaults → Opus 4.7 + xhigh
  24f21f9 refactor(types): narrow EffortLevel to union literal
  26cfe2b chore(db): heal legacy effort_level rows to xhigh

Bundle 2 — Structural fixes:
  603b398 fix(server): gate fastify-static on NODE_ENV=production
  3d0de45 fix(server): swap tsx watch for tsx — clean preflight exit

Bundle 3 — Command Center rebrand (display-only):
  eb9f85f rebrand: UI strings — Commander → Command Center (display-only)
  4a040b8 rebrand: .app bundle CFBundleName — JStudio Command Center
  (+ docs commit)
```

### Triggering context — the 2026-04-17 UI regression

User reported three Wave 2 features (button-style top-bar tabs, modern sidebar / design-system-spine, city view `/city`) "regressed" at once. Single root cause: `client/dist` frozen at Apr 14 01:38, served by Fastify's static handler in dev mode, shadowing Vite's HMR. Phase D shipped the .app launcher + signed health but didn't gate static on NODE_ENV, so any stale dist would silently win over current source. Phase E Bundle 2.1 closes that class of bug permanently.

A second failure mode surfaced during the same diagnosis: 7 zombie `pnpm server dev` + `tsx watch` procs accumulated from Phase D's preflight smoke tests. `tsx watch` stays alive after a `process.exit(0)` in the child — parent keeps watching for file changes with nothing to spawn. Phase E Bundle 2.2 drops `watch` entirely (matches existing `feedback_tsx_watch_unreliable` memory).

### What shipped

**Bundle 1 — 4.7 migration finish** (from the audit findings)
- `CreateSessionModal.tsx`: Opus 4.7 at top, default state, pricing pulled from shared `MODEL_PRICING` so it stays in sync. 4.6 demoted to "(legacy)" at bottom.
- `ContextBar.tsx`: `EFFORT_LEVELS = ['high','xhigh','max']` (was `['low','medium','high','max']`). New `normalizeEffort()` coerces any legacy row to `xhigh` so the dropdown's initial state always matches the option list.
- `ModelBreakdown.tsx`: `'claude-opus-4-7': '#0E7C7B'` primary teal, 4.6 shifted to `'#0A5E5D'` secondary.
- `schema.sql` + `connection.ts`: column defaults `claude-opus-4-7` / `xhigh`. Boot heal sweeps ALL rows with legacy `low|medium|NULL` effort to `xhigh` (superseded the 24h-bounded heal).
- `packages/shared/src/types/session.ts`: `EFFORT_LEVELS` const tuple + `EffortLevel = 'high'|'xhigh'|'max'` union exported. `Session.effortLevel` narrows from `string` to `EffortLevel`. Typecheck caught one drift site (`session.service.ts:101`) which now routes through a `normalizeEffortLevel()` helper.

**Bundle 2 — Structural fixes**
- `server/src/index.ts`: fastify-static registration gated on `NODE_ENV === 'production'`. Dev mode with an existing `client/dist` warns + skips so Vite is the unambiguous UI source.
- `server/package.json`: `"dev": "tsx src/index.ts"` (dropped `watch`). Fixes preflight zombie accumulation.

**Bundle 3 — Command Center rebrand (scope A display-only)**
- User-visible "JStudio Commander" → "JStudio Command Center": `client/index.html` (`<title>`, apple-mobile-web-app-title), `Logo.tsx`, `PinGate.tsx`, `HealthBanner.tsx`.
- `.app` bundle: `Info.plist` CFBundleName + CFBundleDisplayName both → "JStudio Command Center". Dock/Cmd-Tab/menu render the new name after `bash scripts/macos-launcher/build.sh`.
- Docs: `TUNNEL.md` blanket replace (every mention is user-facing); `STATE.md` heading + rebrand callout + Phase E marker; `CTO_BRIEF.md` heading + callout (archival prose intentionally unchanged).
- **Preserved (internal slugs)**: repo dir `~/Desktop/Projects/jstudio-commander`, `@commander/*` package names, `SERVICE_ID = 'jstudio-commander'` (signed health from Phase D), `~/.jstudio-commander/config.json`, `~/.claude/hooks/commander-hook.sh`, `CommanderEventBus` class name, `byCommanderId` internal variables, team config slugs, historical commit messages, archival CODER_BRAIN sections.

### Patterns established

- **Sync manifest & ALTER migrations, async data backfill**: Bundle 1.6 heal runs at boot before any read path, so every in-memory `Session` carries a valid `EffortLevel`. Pattern for any future type-narrowing migration.
- **NODE_ENV gate on serve-static**: cheap insurance against dev-shadow regressions. Two lines.
- **Display-only rebrand scope (A)**: rename user-visible strings (titles, headings, body copy) + .app bundle CFBundle* fields + user-facing docs. Preserve every slug (repo, package, config, hook, SERVICE_ID, types) so running instances / team configs / memory don't break.

### Critical lessons (read before touching nearby code)

1. **`NODE_ENV=production` is load-bearing for dev-safety.** Without it, any built `client/dist` silently shadows Vite's HMR. Production behavior unchanged. If you rip this gate out, you reopen the exact regression reported on 2026-04-17.
2. **`tsx watch` child exits don't kill the parent.** `process.exit(0)` from Phase D preflight left the watcher alive. If you re-add `--watch`, document the preflight interaction + add a `pkill -9 -f 'jstudio-commander/server'` sweep in the preflight path.
3. **`EffortLevel` is a narrow union — old rows MUST be healed.** The boot heal in `connection.ts` is not optional; without it, pre-Phase-E rows would fail the type assertion on read (server) and corrupt the UI state (client). The `normalizeEffortLevel()` helper is the belt-and-suspenders fallback.
4. **Schema column default vs ALTER column default vs upsert default — all three must match.** Phase E moved `schema.sql` (fresh install), `connection.ts` ALTER (migration path), and `session.service.ts` upsert (write path) to the same pair. Drift between them was a latent bug the audit surfaced.
5. **CFBundleName ≠ .app filename.** Finder shows the filename; Dock/Cmd-Tab/menu use CFBundleDisplayName. Display-only rebrand updates the plist, leaves `Commander.app` filename alone. If users want to rename the file, they do it themselves; the dock label already reflects the new name.
6. **Rebrand scope A is "grep 'Commander' in user-facing contexts, leave slugs alone."** Don't touch imports (`@commander/shared`), class names (`CommanderEventBus`), internal var names (`byCommanderId`), archival commit messages, or CODER_BRAIN per-coder sections. The heading in STATE.md is the live source of truth for "what the product is called now."

### Phase E.2 — Commander Vite port → 11573 (2026-04-17 hotfix #2)

User was fully blocked by a Vite port collision: JLFamily's vite squatted `*:5173` (IPv4 all-interfaces) and Commander's vite fell back to `[::1]:5173` (IPv6 loopback only). Chrome hit JLFamily's vite at `192.168.88.243:5173` and got JLFamily's bundle + broken API proxy + failed WS.

Fix: Commander's Vite moves off the `5173/5174` default ecosystem entirely. `client/vite.config.ts` now pins `port: 11573` + `strictPort: true` + `host: 'localhost'`. 11573 chosen to echo 11002 (server) and keep the "573" tail for muscle memory. `strictPort` fails loud if taken instead of drifting — silent fallback is the exact failure mode we just fixed.

`vite.config.ts` also reads the server port from `~/.jstudio-commander/config.json` at startup so the `/api` + `/ws` proxy always targets the live server port (fallback 11002).

Server-side: Phase E.1's dev-redirect fallback flipped `5173` → `11573`. CORS origin allowlist now includes both `:11573` (primary) and `:5173` (transitional for cached bookmarks during the migration window — can drop later). Comments throughout `server/src/index.ts` updated.

`playwright.config.ts` base URL follows (`:5173` → `:11573`).

Verified end-to-end with JLFamily's vite still alive on `*:5173`:
- `lsof` shows Commander vite on `[::1]:11573`, server on `*:3002`, JLFamily untouched on `*:5173`.
- `curl http://localhost:3002/` → `302 Location: http://localhost:11573`.
- `curl http://localhost:11573/` → Commander's own `<title>JStudio Command Center</title>`.
- `curl http://localhost:11573/api/system/health` via Vite proxy → `{service: "jstudio-commander"}`.

Commit: `f7f0752 fix(dev): Commander Vite port → 11573 + strictPort` (see below; adjust if the actual sha differs).

### Tech debt opened by Phase E

- **Server edits require manual restart** (no more `tsx watch`). Matches documented workflow (STATE.md, `feedback_tsx_watch_unreliable`) but mild regression for rapid server iteration. If it bites, flip to nodemon or add a hand-rolled watcher that terminates cleanly on child exit(0).
- **`normalizeEffortLevel()` is duplicated server-side + client-side.** Small enough not to share via the `@commander/shared` package for now, but if more normalizers appear, consider a `shared/src/utils/normalize.ts`.
- **CTO_BRIEF.md prose still uses "Commander"** in most paragraphs (archival — heading + callout note the rebrand). A full prose rewrite is a future-you task if the doc gets cited heavily post-rebrand.
- **`Commander.app` filename unchanged.** If the user manually renames the file to `Command Center.app`, the launcher.sh + build.sh `DEST` path would need a template variable. Deferred until someone asks.
- **Rebrand callout in STATE.md is a free-form markdown blockquote.** If we add more rebrands (scope B full rename, etc.) the pattern will need a section instead of a callout.

### HEAD (post-Phase-E-content)

```
4a040b8 rebrand: .app bundle CFBundleName — JStudio Command Center
eb9f85f rebrand: UI strings — Commander → Command Center (display-only)
3d0de45 fix(server): swap tsx watch for tsx — clean preflight exit
603b398 fix(server): gate fastify-static on NODE_ENV=production
26cfe2b chore(db): heal legacy effort_level rows to xhigh
24f21f9 refactor(types): narrow EffortLevel to union literal
05ebbcd chore(schema): column defaults → Opus 4.7 + xhigh
ab72eec fix(analytics): ModelBreakdown color for Opus 4.7
15fe784 fix(chat): ContextBar effort dropdown to high|xhigh|max per skill
f956fcc fix(sessions): CreateSessionModal default to Opus 4.7
6ade894 docs: Phase D completion + coder-12 brain refresh
```

All three typechecks PASS post-Phase-E.

Phase E.1 + E.2 hotfixes shipped on top: `f5da3ba` (dev-mode server redirects `GET /` → Vite), `58434d9` (Vite port → 11573 strictPort, JLFamily collision fix), `8089542` (README + docs rebrand).

---

## Coder-14 Session — Phase F (Structured chat messages + split auto-activation + pane adoption hardening, 2026-04-17)

### Commits (6)

```
Bundle 1 — Structured chat messages:
  457d9e5 feat(chat): parse task-notification + teammate-message structured tags
  d357f03 feat(chat): TaskNotificationCard component
  b9e7bc4 feat(chat): TeammateMessageCard component
  654cb05 fix(chat): ChatThread routes structured tags to cards, suppresses JB header

Bundle 2 — Split-view auto-activation:
  2c0e063 feat(split): auto-split-on-spawn preference + toolbar toggle

Bundle 3 — Teammate-spawn pane adoption:
  467adce fix(sessions): harden teammate-spawn pane adoption (coder-13 autopsy)
```

### Triggering context

User reported two Wave-2-regression-class failures on the live OvaGas-ERP test session:
1. Claude Code was injecting `<task-notification>` and `<teammate-message>` XML payloads through the user role, which the chat renderer displayed as raw XML in a "JB" user bubble — visually broken.
2. `coder-13` had spawned with `tmux_session = 'agent:coder-13@jstudio-commander'` (sentinel) and stayed stuck as `stopped` even though the pane `%52` it was assigned was still alive. Previous coders (coder-11 `%47`, coder-12 `%48`) got real pane ids; coder-13 did not.

### What shipped

**Bundle 1 — structured chat messages**
- `client/src/utils/chatMessageParser.ts` — new. Regex-based (no DOM parser; no XSS surface). Exports `parseTaskNotification`, `parseTeammateMessage`, and a unified `parseStructuredUserContent` entry point. Strict mode: the entire message must be the tag (no surrounding prose) — mixed content falls back to normal UserMessage rendering. Decodes the 5 standard XML entities so body text doesn't leak escapes.
- `client/src/components/chat/TaskNotificationCard.tsx` — status icon map (CheckCircle2/XCircle/Clock by completed/failed/else), collapsible `result` rendered via existing `renderTextContent` so code fences + inline markdown work, footer with tokens/tools/duration + output-file basename.
- `client/src/components/chat/TeammateMessageCard.tsx` — 3px color-coded left border (named palette map: `blue purple teal green yellow red orange pink cyan`, hex passthrough, falls back to `var(--color-accent)`). Header `<Users>` icon + teammate id + italic summary. Body through `renderTextContent`. Optional `onOpen` callback for click-to-focus (unused for now; safe to add from a caller that can resolve the teammate to a session id).
- `client/src/components/chat/ChatThread.tsx` — `detectStructured(msg)` helper at module scope. Group render branch for `role === 'user'` runs the parser; renders the matching card instead of UserMessage on hit.
- `client/src/components/chat/UserMessage.tsx` — belt-and-suspenders guard at the top of the render body. Same detection, same card rendering. Ensures a caller that bypasses ChatThread can't leak raw XML to the JB bubble.
- 13 unit tests in `client/src/utils/__tests__/chatMessageParser.test.ts`: full payload + minimal + mixed-content strict + empty + entities + hyphenated attr + missing color + hyphen vs underscore attr variants. 19/19 pass (13 new + 6 existing plans).

**Bundle 2 — split-view auto-activation**
- `client/src/pages/SplitChatLayout.tsx`
  - New server-backed preference `auto-split-on-spawn` (default `true`) via `usePreference`.
  - `refreshTeammates({ promote })` — separated stale-tab-drop (always runs) from first-teammate-promote (gated on `promote`). Mount + mount-refresh pass `true`. WS `teammate:spawned` passes `autoSplitOnSpawn`. WS `teammate:dismissed` passes `false` (never re-promote on dismiss).
  - Toolbar toggle (`Columns2` icon) in the expanded split view's top-right control group. Color-indicates state.

**Bundle 3 — pane adoption**
- `server/src/services/team-config.service.ts` — `reconcile()` no longer gates the upsert on the seen-set. Now: upsert whenever the member is `isFresh` OR the config carries a real `%NN` pane id. Spawn event still fires only on fresh sightings. Added a distinct log line `[team-config] updated pane for <name> → %NN` for mid-lifecycle heals.
- `server/src/services/session.service.ts` — `upsertTeammateSession` gained sentinel-protection. If caller passes `agent:<id>` but the DB row already has a `%NN` pane, keep the real pane. Prevents a stale config write (empty tmuxPaneId) from demoting a working teammate back to a non-sendable sentinel.

### Patterns established

- **Strict-tag detection for structured user content.** The parser only matches when the entire `msg.content[0].text` is the tag (whitespace-trimmed). Mixed content preserves normal user-message rendering. The decision point was XSS + render safety: anyone who wants to inject XML into a "JB" bubble via prompt injection would need to produce a one-and-only-one-tag message with no surrounding copy — a narrow attack surface the renderer can address by not HTML-rendering the decoded body anyway (we pipe through `renderTextContent` which doesn't `dangerouslySetInnerHTML`).
- **Belt-and-suspenders guard in UserMessage.** One guard at the group-render level (ChatThread) + a second guard at the message-render level (UserMessage). Either can swap the bubble for the card; the other is a safety net if a future caller bypasses one.
- **promote flag on refresh.** Separating "drop stale tab" (always) from "promote first teammate" (conditional) kept the refactor tiny. Future `refreshTeammates` consumers can be explicit about intent without forking the implementation.
- **Idempotent reconcile with gated emit.** The fix pattern for mid-lifecycle config updates: always run the DB write, gate only the broadcast. Future reconcilers (agent_relationships, task_assignments) should follow this.
- **Sentinel-protection in upsert.** The semantic rule: a sentinel target can never demote a real pane. Encoded in `upsertTeammateSession` so callers don't need to remember it.

### Critical lessons (read before touching nearby code)

1. **Claude Code sometimes emits `<task-notification>` and `<teammate-message>` under the user role.** They're not user-typed. Treat them as first-class structured payloads. The parser lives in `client/src/utils/chatMessageParser.ts`; extend there if Claude Code starts emitting new tags.
2. **The coder-13 failure mode was the seen-gate on reconcile.** If the orchestrator writes the member config row twice — empty paneId first, real `%NN` after — the second write used to be silently dropped. Idempotent reconcile + sentinel-protection close this loop. Verify: watch `/tmp/jsc-dev.log` for `[team-config] updated pane for <name>` on any subsequent teammate spawn where the initial config write had no paneId.
3. **resolveSentinelTargets ambiguity is real but no longer critical.** When multiple unclaimed panes share a cwd, `candidates.length !== 1` short-circuits adoption. The reconcile idempotency fix sidesteps this by using the config's authoritative paneId. resolveSentinelTargets remains a safety net for the case where a member record has NO paneId and no config update ever comes (rare; usually the PM gives up and the member stays stopped, which is correct).
4. **Server restart heals coder-13 even without the fix.** Because boot-time reconcile starts with empty `knownMembers` → every member is `isFresh` → the upsert runs with the config's current paneId. This is why the user occasionally saw "it works after restart" but not mid-session. The Phase F fix makes it work mid-session without restart.
5. **Preferences are server-backed + cross-tab.** `auto-split-on-spawn` is not a per-PM key — it's account-wide. Don't scope account-wide prefs by session id; use a bare key that the server's `/preferences/:key` endpoint serves globally.
6. **Columns2 icon tracks preference state.** Accent color when ON, text-tertiary when OFF. If you add more preference toggles in the split toolbar, use the same color convention so state is scannable without hovering for the tooltip.

### Tech debt opened by Phase F

- **`TeammateMessageCard.onOpen` is unused.** No caller today resolves `teammate_id` → `sessionId`. Easy follow-up: add a prop drill from ChatPage that passes the current session's teammate list to ChatThread, then to the card. Safe to ship now because without `onOpen` the card still displays correctly.
- **`auto-split-on-spawn` toggle only lives in the expanded split view.** If a user wants to pre-emptively disable auto-split before any teammate has spawned, they can't — the toolbar is absent from the minimized strip and single-pane fall-through. Either add a second toggle in the minimized strip or hoist to TopCommandBar in a follow-up.
- **`detectStructured` runs on every group render.** For messages with many text blocks, the `filter + exec` chain is cheap but not zero-cost. Memoize if chat length ever balloons.
- **Tag parser is regex-based.** Predictable payload structure today; if Claude Code ever nests tags within tags, the greedy/non-greedy boundaries would need re-thinking. Add a fixture-based test at that point (follow the `plans.test.ts` / `fixtures/` pattern).
- **No drift detection between server-authored preference and local cache.** `usePreference` caches in-memory; if the server re-writes the value out-of-band, the cross-tab WS event patches the cache. But a direct DB edit wouldn't. Acceptable for now.

### Bundle 6 — bypass-permissions kill-switch (2026-04-17 follow-on)

Root cause: `server/src/routes/session.routes.ts` `/output` endpoint had a
generic "final fallback" prompt detector that matched `?` anywhere in the
last 10 lines. On a team-lead-idle pane with a teammate footer + a `?`
elsewhere in the chat, it emitted `{type:'confirm', message:'Waiting on
input — see terminal'}` which the client's `PermissionPrompt` rendered as
the "Confirmation needed" Yes/No popup.

Fix:
1. **Kill-switches.** If the last 15 lines contain `⏵⏵ bypass permissions
   on`, Claude Code cannot fire a permission prompt by design → return
   empty prompts. Same treatment for `N teammate` + `Waiting on input`
   which is the team-lead-waiting-on-teammate idle state.
2. **Tighten the generic fallback.** Match the question-mark / numbered-
   option pattern only on the actual last non-empty line, not anywhere
   in the last 10 lines. A real prompt always sits directly above the
   input cursor; anything further back is chat content.

Commit `a1aa074`.

### Bundle 5 — team-lead adoption + coder naming (2026-04-17 follow-on)

Triggered by the OvaGas-ERP test session where the user had a Commander
PM called `PM - OvaGas` at a cwd, then an external orchestrator wrote a
`~/.claude/teams/ovagas-ui/config.json` for the same cwd. Reconcile
created a DUPLICATE session named literally `team-lead` instead of
adopting the existing PM.

**Three changes:**

1. **Adoption.** New `sessionService.findAdoptablePmAtCwd(cwd)` + `sessionService.adoptPmIntoTeam({sessionId, teamName, claudeSessionId?})`.
   The reconcile looks up an alive `session_type='pm'` with matching `project_path` and no prior `team_name`; if found it updates `team_name + agent_role='pm'` on the existing row and uses that id as the parent for teammates. No duplicate row.
2. **Coder naming.** `deriveCoderName(parent.name, member.name, agentType, siblings)` — when the parent has a non-generic display name, fresh teammates inherit it: `PM - OvaGas (coder)`, `PM - OvaGas (coder 2)`, `PM - OvaGas (qa)`, etc. `ROLE_HINT_RE` maps `qa|security|ui|db|landing|scaffold|supabase|docs?|test` out of `agentType`; falls back to `coder`. Falls all the way back to the raw config name when the parent is generic or missing.
3. **deriveTeamLeadName fallback.** When no adoption is available, the new team-lead row gets a human-readable name via `basename(cwd) → teamName → rawName → "team-lead"`. Keeps the UI scannable instead of littering it with literal "team-lead" rows.

**Plumbing change:** `upsertTeammateSession.name` is now optional. On mid-lifecycle re-upserts (Bundle 3's pane heal), we SKIP passing `name` so a carefully-derived display doesn't get clobbered back to the raw config value. On fresh sightings, name is always passed.

Commit `ad163ba`.

### Patterns established (Bundle 5+6)

- **Kill-switch > elaborate disambiguation.** When a state flag conclusively invalidates a detection class (bypass permissions → no prompt), early-return is cheaper and more maintainable than stacking conditions inside every matcher. Applied: `bypass permissions on` + `N teammate + Waiting on input`.
- **Adopt rather than duplicate.** When ingesting external-orchestrator state, look for an adoptable existing row before creating. Cheap lookup (indexed `(session_type, project_path)`) and the UX win is large.
- **Optional name on upsert.** Any field whose value should be set-once-then-preserved through re-upserts should be optional on the upsert surface, with callers passing it only on fresh inserts. Prevents mid-lifecycle regressions.
- **Role hint out of agentType.** Orchestrators already encode role info in `agentType` (`qa-agent`, `security-auditor`, etc.) — we don't need a separate taxonomy column. Match a regex, fall back to `coder`.

### Critical lessons (Bundle 5+6)

1. **`bypass permissions on` in the pane footer means NO prompt can be active.** Period. If you extend prompt detection, respect this kill-switch or you'll reopen the "Confirmation needed on idle PM" regression.
2. **The final fallback in `/output` is load-bearing but easy to over-generalize.** Keep it scoped to the last non-empty line. Any broader surface turns chat content into false positives.
3. **Adoption only works when the existing session has no prior team link.** The query filters `team_name IS NULL OR team_name = ''`. If the user had a PM that was already in a DIFFERENT team, we'd never adopt it into a new team — that's correct; teams shouldn't silently steal sessions.
4. **Commander-spawned sessions have session_type='pm'** per Phase A. This is the adoption key. If a Commander session wasn't a PM (e.g. raw session the user later turned into a team lead by external means), the adoption query misses it. That's fine — adoption is best-effort; no adoption falls through to the fresh-create path.
5. **parentSessionId must be the adopted session's id, not the config's leadSessionId.** After adoption, agent_relationships needs to point to the adopted id. `listTeammates` already handles lookup by Commander UUID OR claude_session_id, so the relationship row's FK is deterministic.
6. **Name derivation only on fresh sightings.** If you derive on every upsert, a rename of the parent would cascade into teammate renames mid-lifecycle, which is jarring. Lock the name on first insert; preserve thereafter.

### Tech debt opened by Bundle 5+6

- **Adoption is one-way.** Once an existing PM is adopted into a team, it stays that way — even if the user later deletes the team config. The team-dismissal path clears `ended_at` on `agent_relationships` but doesn't reset `team_name` on the adopted PM. Low-priority; add a "release from team" flow if users ask.
- **Role hints are English-only.** `qa|security|ui|db|landing|scaffold|supabase|docs?|test` matches English agent types. If Spanish orchestrator names appear (`calidad`, `seguridad`), they fall through to `coder`. Acceptable today; extend the regex if we ship a Spanish-language orchestrator.
- **Disambiguator caps at 20.** More than 20 coders under the same parent is unrealistic but if it ever happens the function returns the base name, which would conflict. Cheap to raise the cap if needed.
- **Stale `"team-lead"` rows from before Bundle 5 are not auto-cleaned.** The DB still has `796eaede-...` (stopped, name="team-lead") and similar. Per team-lead's spec: "do NOT auto-delete existing stale rows as part of this phase — that's user data." Surface a cleanup tool if the backlog gets bigger.
- **Adoption check runs on every reconcile.** One indexed SELECT, cheap, but could add a short-circuit for teams whose lead row already has `team_name = teamName`. Marginal savings.

### HEAD (post-Phase-F — all bundles shipped)

```
ad163ba feat(sessions): team-lead adoption + coder naming inherits parent PM
a1aa074 fix(status): bypass-permissions kill-switch + tighten prompt fallback
467adce fix(sessions): harden teammate-spawn pane adoption (coder-13 autopsy)
2c0e063 feat(split): auto-split-on-spawn preference + toolbar toggle
654cb05 fix(chat): ChatThread routes structured tags to cards, suppresses JB header
b9e7bc4 feat(chat): TeammateMessageCard component
d357f03 feat(chat): TaskNotificationCard component
457d9e5 feat(chat): parse task-notification + teammate-message structured tags
```

All three typechecks PASS (shared, client, server). 19/19 unit tests pass (13 new parser + 6 existing plans).

---

## Coder-14 Session — Phase G (Dismiss hygiene + cross-session rejection + adoption widening + sidebar polish, 2026-04-17)

### Commits (3)

```
2f04086 style(sidebar): larger teammate icons in minimized strip
3ba49a9 fix(sessions): cross-session pane guard + widened adoption cwd
0b0d632 fix(split): dismiss button ends relationship + closes pane reliably
```

### Triggering context

Two linked user-facing bugs discovered on OvaGas-ERP:
1. A "coder" tile in the ovagas-ui split view couldn't be dismissed — clicking X cleared local UI but the teammate came right back on reload.
2. That same "coder" was actually pointing at the OvaGas PM's own tmux pane. Team config had `tmuxPaneId: '%51'`; %51 lives inside `jsc-e16a1cb2` which belongs to the OvaGas PM session. Any send-key would have corrupted the PM's input.

Plus a polish ask: make the minimized teammate icons on the right strip more visible.

### What shipped

**Bundle 3 — dismiss button fix (0b0d632)**
- `client/src/pages/SplitChatLayout.tsx` `closeCoderPane` rewritten. Used to just `setTeammates([])` + clear the split preference, which the next WS event or page refresh immediately undid. Now it:
  - Dismisses ONLY the active tab (previous code dropped all teammates on a single X click).
  - Optimistically promotes the next remaining teammate to `activeTabId`.
  - Calls the new `POST /api/sessions/:id/dismiss` endpoint.
  - Rollback-refreshes from the server on API failure so server truth wins.
- Server: new route `POST /api/sessions/:id/dismiss` → `sessionService.markTeammateDismissed`. Non-destructive (team config on disk untouched, history row preserved, only the agent_relationships edge closes + session flips to `stopped`).
- `markTeammateDismissed` now emits both `teammate:dismissed` and `session:updated` WS events so all connected clients drop the tab in real time.

**Bundles 1 + 2 + 4 — reconcile hardening (3ba49a9)**
- `sessionService.detectCrossSessionPaneOwner(paneId, excludeSessionId?)` — single helper used by both the reconcile guard and the boot heal. `listAllPanes()` finds the owning tmux session; if that session starts with `jsc-` and matches a Commander PM row, returns the owning PM.
- `reconcile()` in `team-config.service.ts` — for any member with a real `%NN` paneId, run the cross-session check. If owned by another PM, log the rejection, call `markTeammateDismissed`, and skip the upsert. Closes the exact ovagas-ui failure.
- `findAdoptablePmAtCwd(cwd)` — widened to match exact path, child-of-PM, or PM-is-child-of-config. Tightness preference: exact > one-level-descendant > reverse > deeper. `descendantOf(child, parent)` uses a trailing-slash boundary so `/Projects/A` can never adopt `/Projects/AB`. Fixes the OvaGas adoption miss (team config was at `/OvaGas-ERP/apps/jstudio-base`, PM at `/OvaGas-ERP`).
- `sessionService.healCrossSessionTeammates()` + call in `server/src/index.ts` boot sequence. One-shot idempotent cleanup: every teammate row whose pane belongs to another PM's jsc-* tmux session is dismissed + logged. Counts are printed when > 0.

**Bundle 5 — larger sidebar icons (2f04086)**
- `STRIP_WIDTH` 48 → 64. Teammate button width 32 → 52 (~1.5×). `StatusBadge size='sm'` → `'md'`. Label font 9px → 10px with medium weight. Role/name truncation 4 → 6 chars. Hover + waiting-glow + pulse animations preserved.

### Patterns established

- **Soft dismiss vs hard delete.** `/dismiss` is non-destructive (ends relationship, flips status to stopped). `/sessions/:id` DELETE hard-deletes and archives the team config. Keep these distinct — "close this pane in my split view" is a UX action, not a team-management one. Users should be able to reopen the teammate by re-listing, not by rebuilding the team.
- **Single helper, two callers.** Cross-session detection is used by the reconcile guard (prevention) and the boot heal (cleanup). Extracting `detectCrossSessionPaneOwner` keeps the logic in one place; `healCrossSessionTeammates` is a thin wrapper that iterates the DB and routes hits through `markTeammateDismissed`.
- **Tightness-preferring adoption.** A one-size-fits-all exact match is too strict for multi-directory monorepos (`apps/*`). The tier-based scoring — exact > descendant > reverse — tolerates reasonable directory structures without adopting across sibling trees. The `/` boundary in `descendantOf` is load-bearing; without it, `/Projects/A` matches `/Projects/Apple`.
- **Optimistic dismiss with server-truth rollback.** Immediate local state update for perceived latency, but on API failure refetch from server so truth wins. Pattern worth reusing for any UI-triggered dismissal.
- **Idempotent boot heals.** Run on every boot; no tracking of "already healed". Expectation: fix Bundle 1's root cause, heals converge to zero. Log when > 0 so operators notice any regression.

### Critical lessons (read before touching nearby code)

1. **A teammate's config paneId is NOT trustworthy.** Orchestrators occasionally write pane ids that belong to other Commander-managed sessions. Always run `detectCrossSessionPaneOwner` before trusting a pane for send-key. If you add a new code path that uses teammate pane ids, call the guard.
2. **Exact-match cwd adoption misses common layouts.** Any monorepo / subdirectory / apps-folder structure needs descendant-match adoption. The tier-scoring prevents ambiguity when multiple PMs live in related trees.
3. **Dismiss doesn't remove the member from the team config file.** If the user edits the on-disk team config (rare but possible), chokidar fires reconcile, the dismissed teammate's `seen` state is preserved → no re-emit, but if the file removes+re-adds the member, re-emission is correct behavior. Acceptable; a "sticky dismissed" flag is tech debt (below).
4. **`listAllPanes()` is a shell-out.** One per reconcile iteration is fine; a tight loop would hammer tmux. `detectCrossSessionPaneOwner` is already one shell-out per call — caller should batch if it starts getting hot.
5. **The minimized strip button dimensions interact with `useIsNarrow()`.** Below 768px the strip always renders. Bumping STRIP_WIDTH too aggressively would squeeze mobile; 64px is still acceptable on 320px viewports (20% width). Don't take this above ~72px without re-checking mobile.
6. **Dismiss endpoint does NOT kill tmux panes.** That's deliberate — if the teammate was a cross-session pane reference, killing would terminate the PM's pane. Dismiss only updates DB state.

### Tech debt opened by Phase G

- **Sticky-dismissed flag.** A teammate the user dismisses is only durable until the team config is rewritten. If the orchestrator re-writes the config with the same member record, chokidar fires reconcile and resurrects the teammate. Add a `user_dismissed_at` column + skip-on-reconcile if this becomes a real problem.
- **detectCrossSessionPaneOwner runs on every reconcile cycle for every member.** Batchable: fetch listAllPanes() once per reconcile, pass the map into each call. Trivial refactor when reconcile gets called on high-churn teams.
- **Startup heal logs per-row but doesn't batch.** Fine today (single-digit row counts). If a future team config bug produces hundreds of cross-session rows, consider suppressing per-row logs and emitting a summary.
- **Adoption doesn't handle renames.** If a PM is at `/A/apps/jstudio-base` and later moves to `/B/apps/jstudio-base`, the adoption query keys on project_path and won't find the old row. Acceptable because rename is rare; heal manually.
- **Descendant-match can adopt across projects only if user's workspace layout is unusual.** The trailing-slash boundary is the safeguard. Document the rule in STATE.md if users report cross-adoption.

### Bundle 6 — top-bar filter + teammate count badge (2026-04-17 follow-on)

User asked: "Only have main PMs or Raw sessions on the top, not coders or spawned teammates. Add a small robot icon next to the session button that represents how many teammates that session has."

- `client/src/layouts/TopCommandBar.tsx` — new `topBarSessions` derived list filters on `!parentSessionId && (sessionType === 'pm' || 'raw')`. Belt-and-suspenders against a misclassified row.
- `teammateCountByParent` Map keyed by parent session id, derived from the same WS-driven `useSessions` stream — count drops as soon as a teammate stops, increments without a refetch when one spawns. Lookup mirrors `listTeammates`' UNION-style parent matching: surfaces both Commander UUID AND `claudeSessionId` keys so configs that recorded either still resolve.
- `<Bot size={13}/>` + tight `font-semibold` count rendered on each tab when the count > 0. Color: tertiary on inactive tabs, secondary on active. Tooltip: "N active teammate(s)". Inactive tabs get the badge too (so users can see at a glance which idle PM has live coders).
- Same badge applied in OverflowMenu items + mobile dropdown items so the affordance is consistent across all three render paths.
- `MobileOverflowDrawer` "Active" stat now uses the same filter so both surfaces show the same count.

Commit `a3ea2fa`.

### HEAD (post-Phase-G)

```
a3ea2fa feat(top-bar): filter teammates from session tabs + teammate count badge
2f04086 style(sidebar): larger teammate icons in minimized strip
3ba49a9 fix(sessions): cross-session pane guard + widened adoption cwd
0b0d632 fix(split): dismiss button ends relationship + closes pane reliably
27cd0e8 docs: Phase F Bundle 5+6 addenda in CODER_BRAIN + STATE HEAD refresh
ad163ba feat(sessions): team-lead adoption + coder naming inherits parent PM
a1aa074 fix(status): bypass-permissions kill-switch + tighten prompt fallback
```

All three typechecks PASS. 19/19 unit tests pass. Server restart required for Bundles 1, 2, 3, 4 (all server-touching). Bundles 5 + 6 are client-only (Vite HMR picks up).

### Phase G.1 hotfix — status detector + ContextBar label (2026-04-17)

Triggered by user-reported false positive: a team-lead PM with `✢ Tomfoolering...` in the tail + 2 active teammates + bypass-permissions footer was rendering with the yellow-glow "Waiting for input" card despite zero actionable prompts. Root cause: `agent-status.service.ts` ran the generic `WAITING_INDICATORS` loop (`/waiting for input/i`) before any active-in-tail check; chat-content phrases like "waiting for input from coder-14" elsewhere in the 25-line capture flipped status to `'waiting'`.

**Fix:**
1. New `hasActiveInTail(text, n=8)` in `agent-status.service.ts` checks last 8 lines for spinner glyphs OR ACTIVE_INDICATORS matches. Hoisted in `detectStatus` between the strong-prompt checks (`hasNumberedChoiceInTail` / block) and the generic-waiting loop. Active turns now always win over scrollback false positives. Real prompts (numbered choice / Allow-Deny / hard `(y/N)`) still take precedence — those checks run first.
2. ContextBar derives `activeTeammateCount` from `useSessions` (mirrors TopCommandBar's bot-badge keying — Commander UUID + claudeSessionId both count). When `sessionStatus='waiting'` AND `!hasPrompt` AND children are running → label becomes `"Monitoring N teammates"` with a teal accent dot. Yellow-glow "Waiting for input" reserved for genuine no-prompt-no-teammates idle.

**Design choice:** went with option (b) — keep the binary working/waiting/idle status enum, no new `'monitoring'` state. The fix lives entirely in the label layer + the active-tail hoist. Smaller surface, no client-status-coercion gymnastics.

Commits `68ce81a` (server) + `976603d` (client).

### Phase G.1 addendum — startup-heal over-closes codeman relationships (2026-04-17)

User-reported follow-up to Phase G Bundle 4: codeman-managed coders (panes inside `codeman-*` tmux sessions, not `jsc-*`) had their `agent_relationships.ended_at` set on server boot. The original predicate had the `jsc-*` prefix filter, but it was missing the parent-exclusion case — a coder whose pane legitimately lives in its OWN parent PM's `jsc-*` tmux session was being misflagged as cross-session and dismissed every boot.

**Fix:**
1. `detectCrossSessionPaneOwner` signature changed: `excludeIds: string[]` instead of a single `excludeSessionId`. Callers pass `[teammate.id, parent.id]`.
2. `healCrossSessionTeammates` fetches `parent_session_id` per row and threads it into the exclusion list.
3. `team-config.service.ts` reconcile guard does the same.
4. Pure decision logic extracted to `server/src/services/cross-session.ts` as `isCrossSessionPaneOwner(paneFact, candidate, excludeIds)`. Service-level fn does the I/O (listAllPanes + DB lookup) and delegates the final yes/no to this predicate.
5. Seven regression tests in `server/src/services/__tests__/cross-session.test.ts` cover: codeman-* prefix passthrough, jsc-* legitimate cross flagging, jsc-* same-parent passthrough, pane-gone passthrough, no-owner-row passthrough, non-PM owner passthrough, null/undefined exclude tolerance.
6. New `pnpm -C server test` script (`node --import tsx --test`).

The bug surface now has belt-and-suspenders: codeman-* short-circuits at the prefix check, AND same-parent short-circuits at the exclude check. Either alone would prevent the over-heal; both ensure no future regression.

Commit `1b62f63`.

### Phase G.2 — Adoption re-parents teammates + rewrites team config (2026-04-17)

User-reported: OvaGas adoption ran successfully (boot log confirmed `[team-config] adopted existing PM "OvaGas" (e16a1cb2) into ovagas-ui`), but `coder@ovagas-ui` got dismissed as cross-session anyway. Trace:
- Adopted PM `e16a1cb2` at `/OvaGas-ERP` linked into `ovagas-ui` team
- `coder@ovagas-ui` kept `parent_session_id = '796eaede-...'` (the stale lead pre-adoption)
- Coder's pane `%51` lives in `jsc-e16a1cb2` (adopted PM's tmux)
- Phase G.1 predicate: `candidate(e16a1cb2).id NOT IN excludeIds([coder.id, '796eaede-...'])` → TRUE → cross-session flag → dismiss
- Team config still had `leadSessionId: '796eaede-...'` — adoption didn't rewrite the file, so chokidar's next reconcile would re-resurrect the stale state

**Two fixes:**

1. **`adoptPmIntoTeam` re-parents teammates.** New optional `previousLeadId` parameter. When set and distinct from the adopted PM's id, the adoption transaction also runs:
   - `UPDATE sessions SET parent_session_id = adoptedId WHERE parent_session_id = previousLeadId AND status != 'stopped' AND team_name = teamName` (RETURNING id) — scoped to the team to prevent cross-team pulls
   - `UPDATE agent_relationships SET ended_at = now WHERE parent_session_id = previousLeadId AND ended_at IS NULL` — close stale edges
   - `INSERT … ON CONFLICT DO UPDATE SET ended_at = NULL` per re-parented teammate — open fresh edges under the adopted PM
   - All inside a single `db.transaction()` — partial re-parent on crash would leave orphans worse than the original bug
2. **`updateTeamConfigLeadSessionId` rewrites the on-disk config atomically.** New helper in `team-config.service.ts`. Reads JSON, sets `leadSessionId`, preserves all other fields, writes via tmp + rename. Idempotent: returns false (no-op) when target id already matches. Safe against unparseable / missing files. Preserves trailing-newline convention so file diffs stay minimal.

**Reconcile idempotency:** added a new "byConfigId steady state" branch at the top of the lead-resolution block. When `getSession(configParentSessionId)?.teamName === teamName`, reuse it directly and skip both adoption and the fresh-upsert path. Without this, the second reconcile after the rewrite would try to derive a new name (`deriveTeamLeadName(cwd, teamName, lead.name)` → e.g. `jstudio-base`) and overwrite the adopted PM's user-given name (e.g. `"OvaGas"`). The new branch lets the adopted PM keep whatever name it had pre-adoption.

**Tests:** 5 new in `team-config-rewrite.test.ts` covering the helper (rewrite + members preserved, idempotent, missing file, corrupt JSON, trailing-newline convention). Server total: 12/12 pass.

Commit `425632b`.

---

All three typechecks PASS (shared, client, server). Verification:
- `pnpm -C server dev` (no config.json override) binds 11002 · `curl /api/system/health` → `{status:"ok",service:"jstudio-commander",version:"0.1.0",...}`
- Second `pnpm dev` while first is running → yellow banner, clean exit 0, only 1 process on port 11002
- `node client/scripts/preflight.mjs` while server running → banner, exit 0
- `bash scripts/macos-launcher/build.sh` → Commander.app/Contents/{Info.plist @ v0.1.0, MacOS/launcher +x, Resources/icon.icns 115KB}
- Restored user config.json with `port: 3002` → server binds 3002 (override still wins)

---

### Verify-before-compact checklist (if you need to reproduce any of the above)

- HEAD commits visible via `git log --oneline -20`
- Run `pnpm -C client run typecheck` and `pnpm -C server run typecheck` — the ONLY expected error is the pre-existing file-watcher line 90.
- `~/.claude/prompts/pm-session-bootstrap.md` exists (134 bytes).
- `~/.claude/skills/jstudio-pm/SKILL.md` has a Cold Start section at the top of the body.
- `curl http://localhost:3002/api/chat/<any-team-lead>/stats` returns non-zero `totalTokens` AND `contextTokens`.
- `sqlite3 ~/.jstudio-commander/commander.db 'SELECT id, status FROM sessions WHERE parent_session_id IS NOT NULL'` shows teammates' real status (coder-9 should be working if this conversation is alive).

---

## Coder-15 Session — Phase H (Chat-ergonomics triple: timer reset + plan dismissal persistence + plan recency, 2026-04-17)

### Commits (3)

```
e4a1645 fix(chat): ContextBar elapsed timer resets on new turn boundary
4fbe99d fix(chat): persist plan widget dismissal in localStorage
b05a67a fix(plans): getActivePlan returns latest plan, not stale earlier ones
```

### Triggering context

All three bugs were reproducible simultaneously in team-lead's own PM chat at HEAD `e5624e6`:

1. Elapsed timer reading "300s" while the Claude Code pane's own indicator was at `✻ Stewing… 14s` — order-of-magnitude drift.
2. X-closed StickyPlanWidget reappeared after reload / server restart.
3. Widget reporting "Phase E" long after team-lead had shipped Phase G.2 — stale TaskCreate bundles from earlier transcript were winning over newer ones.

### What shipped

- **ContextBar timer reset.** Replaced the "last user message" pin with a forward walk that snaps `responseStartRef` to the latest *turn boundary* — user message OR first assistant message after a user message. Handles tool_result-only user echoes naturally (each tool cycle is its own turn boundary, matching pane semantics). `userJustSent` path now anchors to wallclock so the counter starts at 0 on optimistic send, pre-server-confirm, before the new user message lands in `messages`. `LiveElapsed` untouched — it derives elapsed from the ref, so the fix flows through.
- **Plan dismissal persistence.** New `client/src/utils/dismissedPlans.ts` owns a localStorage-backed set under key `jsc-plan-dismissed` (JSON array, FIFO-capped at 50 entries). `isDismissed / dismiss / clearDismissed` as tiny helpers. StickyPlanWidget seeds from storage on mount + re-checks on `planKey` change (new plan = fresh surface by default) + writes through on X-close / Enter-on-close. The pre-existing "per-key dismissal scope" behavior is preserved — you dismiss plan A, plan B still shows.
- **getActivePlan recency.** Rewrote `buildPlanFromMessages` around `groupMessages`: find the latest assistant group containing at least one TaskCreate, then build the plan from THAT group's TaskCreates only, applying TaskUpdates from that group onward. Earlier TaskCreates are historical — they belong to prior plans that are no longer current. The old "reset-when-allDone" heuristic only reset when EVERY task had completed, which silently absorbed incomplete phases into the next plan. Recency is a stronger invariant. Existing "new plan after allDone resets" test was re-worked to use a real user-message separator (the only realistic way two plans live in distinct groups); added 3 new tests (multi-TaskCreate-same-group merge, latest-completed-still-returns so widget can fade, cross-group TaskUpdates still apply). 22 tests pass (was 19).

### Patterns established

- **Turn boundary = forward walk, not backward scan.** A single-pass `for (const msg of messages)` with two state vars (`ref`, `sawUserSinceLastAssistant`) encodes the "boundary" rule without needing to scan backward multiple times. Backward scans only see the tail; forward walks capture the full turn history and naturally land on the newest boundary.
- **Persisted set util pattern.** `utils/dismissedPlans.ts` is the template for any other "per-key dismissal" state that needs to survive reloads: key-prefixed localStorage, JSON array, FIFO cap, silent quota-fail fallback, `is / mutate / clear` trio. Keeps the consumer component free of storage ceremony.
- **Recency over completion-state.** For plans specifically, "latest group with the identifying marker" is a stabler invariant than "reset on terminal state". Worth remembering for any similar "which is the CURRENT instance of X" question in the future (e.g. current plan, current phase, current audit pass).

### Critical lessons (read before touching nearby code)

1. **`buildPlanFromMessages` now depends on `groupMessages`.** Both are declared in `plans.ts`, with `groupMessages` declared AFTER `buildPlanFromMessages`. Works because the reference is inside the function body (evaluated at call time, not eval time). Don't refactor the file to call `groupMessages` from a module-level initializer — that would TDZ-throw.
2. **`isDismissed(planKey)` is synchronous localStorage I/O.** Called from `useState` initializer + `useEffect` on every planKey change. Fine for the current widget frequency; if we ever batch-check dismissals for dozens of plans, switch to a memoized read that holds the parsed array for a tick.
3. **`groupMessages` folds `tool_result`-only user messages into the PRIOR assistant group.** This means an assistant msg → tool_result user msg → assistant msg sequence produces ONE group (not three). The latest-TaskCreate logic handles this correctly because it iterates group messages and filters by `msg.role === 'assistant'` inside the loop.
4. **ContextBar `lastBoundaryTs` memo recomputes on every `messages` identity change.** The `useChat` delta merge returns a NEW array reference only when content changes, so re-computation is bounded by actual content churn (not poll count). If future refactors loosen that, guard with a shallow signature or pass in a stable `messagesKey`.
5. **`Date.parse('')` returns `NaN`.** The `lastBoundaryTs` walk explicitly skips NaN timestamps — necessary for the synthetic test fixtures (and for any real message with a missing ts, which shouldn't exist in practice but we defend anyway).

### Tech debt opened by Phase H

- `dismissedPlans.ts` has no tests of its own. Behavior is trivial enough that indirect coverage (via StickyPlanWidget manual verification) is fine, but adding 4 quick tests on the helper would be easy.
- `useMemo(() => lastBoundaryTs, [messages])` inside ContextBar can be expensive on huge transcripts — linear in message count per re-render. If this ever shows up in profiles, cache the last-processed suffix + start from there.
- `buildPlanFromMessages` now pays `groupMessages` cost (O(n)) on top of its own walk. Fine at current sizes; worth consolidating if we see N>10k messages per session.
- `jsc-plan-dismissed` is unnamespaced-per-server-URL (matches existing `jsc-*` keys in the app). If a user opens two Commander instances on the same machine pointing at different ports, they'd share dismissals. Not a real issue today.

### Verification (Phase H)

- `pnpm -C client run typecheck` — 0 errors.
- `pnpm -C client test` — 22 tests pass (19 prior + 3 new plan recency).
- Manual: dismiss widget → reload → stays dismissed → new plan surfaces → widget returns for the new plan. Confirmed via Phase H acceptance criteria.
- Server untouched — no server tests run.

### HEAD (post-Phase-H)

```
e4a1645 fix(chat): ContextBar elapsed timer resets on new turn boundary
4fbe99d fix(chat): persist plan widget dismissal in localStorage
b05a67a fix(plans): getActivePlan returns latest plan, not stale earlier ones
e5624e6 docs: Phase G.2 — adoption re-parents + config rewrite
```

---

## Coder-15 Session — Phase I (Color semantics + split-pane glass top bar + force-close rework, 2026-04-17)

### Commits (2 new + 1 emergency patch landed mid-phase by team-lead)

```
d9ce052 feat(split): glass top bar + force-close behind overflow + PM notice
a67dc1f feat(sessions): teammate-active display state + muted teammate-idle
5a8ace2 fix(sessions): never dismiss teammate on isActive=false alone  ← Phase I.0 (team-lead)
```

### Phase I.0 — emergency PM patch (team-lead, `5a8ace2`)

Landed on main between Coder-15's Phase H docs and Phase I work. Unrelated to Phase I scope, but committed on the same branch during the same clock hour so history groups them together.

- **File**: `server/src/services/team-config.service.ts`, inside `reconcile()`.
- **Before**: `if (member.isActive === false) continue;` ran BEFORE `next.add(member.agentId)`. So idle teammates weren't added to `next`, which meant the downstream `seen \ next` diff dismissed them as if they'd been removed from the config — causing re-ingest on the next hook event and user-visible flicker / split-view auto-close on the OvaGas coder.
- **After**: `next.add()` runs FIRST, then the `isActive=false` continue. Upsert work is still skipped for idle members (preserving the original intent), but membership tracking is now based on the config listing — not the runtime liveness flag.
- **Why this is correct**: `feedback_isactive_flag_unreliable` memory documents that `isActive=false` from the Agent tool means the agent is currently idle, NOT that the teammate was dismissed. Dismissal is a config-write decision, not a liveness flag.

### Triggering context

Three intertwined user asks after hands-on use:

1. "Make the Coder Green when one of the teammates is active." — teammates already used green (#22C55E) for working via STATUS_COLORS, but idle was sharing the amber of `--color-idle`, which polluted the green-means-active signal when 3+ teammates stacked in the minimized strip.
2. "Session status should reflect teammate activity — light blue when PM is idle but teammate working, instead of yellow Idle." — the server's SessionStatus stays working/idle/waiting/stopped/error; the UI needed a new DERIVED state.
3. "Top bar where teammates are needs a background; get rid of the X — PM should kill teammates. Force-close with double confirmation + PM warning is OK."

### What shipped

**Bundle 1 — Teammate palette variant.** `StatusBadge` gains an optional `variant?: 'session' | 'teammate'` prop. Session variant = unchanged STATUS_COLORS (idle = amber). Teammate variant = same palette except `idle → #6B7280` (same as stopped — muted grey, not amber). Working stays vivid green, waiting stays amber for action-required. Applied at: sidebar minimized strip (SplitChatLayout line 335), TeammateRow, split-pane top-bar tab pills. SessionCard + TopCommandBar keep the session variant because those ARE sessions.

**Bundle 2 — `teammate-active` derived display state + light-blue token.**
- New CSS vars: `--color-teammate-active: #60A5FA`, `--color-teammate-active-subtle`, `--color-teammate-active-border`.
- New `utils/sessionDisplay.ts` export: `getDisplayStatus(session, teammates)` returns `working | waiting | teammate-active | idle | stopped | error`. Client-side projection only — the server's SessionStatus enum is untouched.
- `SessionCard` renders a light-blue box-shadow halo when `PM=idle + teammate=working`; waiting glow still wins if the card is already yellow-pulsing.
- `TopCommandBar` builds a `workingTeammateByParent` map alongside the existing `teammateCountByParent`. New `.session-tab--teammate-active` modifier applied on desktop tabs + overflow + mobile drawer when idle PM has working teammates.
- `ContextBar` status dot + new `.bar-teammate-active` keyframe animation paint calm blue breath instead of the amber `.bar-waiting`. Suppresses `.bar-waiting` when teammate-active is derived, so we don't double-paint.

**Bundle 3 — Glass top bar in split-pane expanded view.** The old layout had three floating/absolute pieces in the right pane: a tab bar (when teammates>1), a single-tab absolute-positioned header (when teammates===1), and absolute top-right controls. Unified into ONE 40px-tall glass bar that always renders, with `background: rgba(15, 20, 25, 0.72) + backdrop-filter: blur(18px) saturate(170%) + border-bottom: 1px rgba(255,255,255,0.06)`. Left side: tabs OR single-name pill (with teammate-variant dot). Right side: auto-split toggle + minimize + overflow menu — all inline, matching the rest of the app's nav chrome.

**Bundle 4 — Force-close rework.**
- The X button is **gone** from the default view.
- Replaced with `MoreHorizontal` overflow that opens a dropdown menu containing a single rose-colored "Force close teammate" action.
- Click → `ForceCloseTeammateModal` (new, `components/chat/`): glass modal, title + triangle icon in rose circle, explanatory copy ("bypasses PM's orchestration…"), mandatory acknowledgment checkbox, Cancel/Force-close buttons. Force-close stays disabled until the checkbox ticks.
- Confirm path: reuse the existing Phase G `/dismiss` endpoint → fire-and-forget POST `/api/sessions/:pmId/system-notice` with a one-line notice describing what happened + asking the PM to reconcile → bottom-center toast "Force-closed X. PM notified." (3s AnimatePresence).
- Server: new `POST /api/sessions/:id/system-notice` route. Reuses `sessionService.sendCommand` so the notice lands as a session_event for post-mortem. Newlines are flattened to spaces before send to sidestep tmux send-keys newline quirks.

### Patterns established

- **Variant-prop palette override.** When a component family needs a tuned palette for a specific surface, keep the shared default + add an optional `variant` prop that swaps the palette map. Beats cloning the component OR forking the tokens globally.
- **Client-side derived state vs server enum.** `SessionStatus` is the server's truth; `DisplayStatus` is the UI's projection for cases where multiple truths combine (PM status + teammate statuses). Putting the derivation in `sessionDisplay.ts` keeps consumers from each reimplementing it.
- **Friction-UX via overflow + modal + checkbox + PM notice.** For any destructive action that should work but shouldn't be easy, this four-step pattern (overflow, modal, acknowledgment, audit trail) is the template — matches how we handled Phase G's dismiss but with teeth.
- **`sendCommand` as a reusable notice channel.** New action types that need to "tell the PM something happened" can POST through the notice endpoint rather than inventing a parallel notification system — the session_event log is the natural audit trail.

### Critical lessons (read before touching nearby code)

1. **StatusBadge default stays `variant='session'`** — existing callers (TopCommandBar, TerminalTabs, SessionCard header) keep the amber-on-idle behavior. If you add a NEW surface that renders teammates, pass `variant='teammate'` explicitly. The default is the wrong choice 90% of the time for teammate strips but the right choice everywhere else.
2. **`teammate-active` is lower priority than `waiting`.** In every site that cares about both, the waiting glow/alarm wins. Don't flip the order — user attention > work-is-happening-elsewhere.
3. **ContextBar has TWO conditions that trigger teammate-active paint.** `effectiveStatus === 'idle' && workingTeammateCount > 0` AND `effectiveStatus === 'waiting' && activeTeammateCount > 0 && !hasPrompt` (the "ambiguous waiting" case from Phase G.1). Both suppress `.bar-waiting` so we don't paint amber underneath blue.
4. **System-notice endpoint is synchronous tmux send.** It reuses `sendCommand` which checks tmux liveness and returns a status. The client intentionally fires-and-forgets with `.catch(() => {})` — the force-close should proceed even if the PM pane is dead (which is often precisely why the user force-closed).
5. **Force-close modal has `data-escape-owner` set.** Phase F installed a global ESC interrupt listener that could eat ESC before the modal sees it. The attribute tells the global handler to bail when the modal is mounted. If you add a new modal family in the app, do the same.
6. **`MAX_TEAMMATES = 3` is a hard cap in SplitChatLayout.** The new top bar tabs + overflow menu assume this. If the cap ever grows, the tabs need an overflow strategy of their own (shrink + ellipsis? overflow dropdown?). Today: overflow flex + `overflow-x-auto` keeps the bar scrollable as a safety net.
7. **`variant` prop on StatusBadge opt-in, not breaking.** Existing tests don't use it — default stays `session`. No test updates needed; the test suite at 22 client + 12 server still passes.

### Tech debt opened by Phase I

- **Phase I.0 regression test deferred.** Team-lead asked for a "10-line test" verifying that a member with `isActive=false` stays in `next` and doesn't get dismissed. `reconcile()` is a private module-level function (not exported) and its test-via-staging pattern (see `team-config-rewrite.test.ts`) would require restaging ~50+ lines of reconcile body. Not cheap. Better path: extract a tiny pure helper like `listActiveMembers(config): Set<MemberKey>` (or `buildNextSet(config)` — same shape) that both `reconcile()` and a fresh test can import. ~15 lines of refactor, then the regression test drops to ~8 lines. File as cleanup pass, not Phase I scope.
- **getDisplayStatus isn't unit-tested.** Pure function, easy to add 4-5 tests (each branch). Worth doing in a future pass; not shipping-critical.
- **`workingTeammateByParent` is computed in two places** (TopCommandBar and ContextBar). Both derive from the same `sessions` array. Worth hoisting into a shared selector hook (e.g. `useTeammateActivity()`) if a third consumer lands.
- **Force-close toast is local state, not a global toast system.** If a third "operation-outcome toast" lands, consider adopting a tiny toast library or rolling a `useToast()` hook. Don't inline-replicate more than twice.
- **System-notice bypasses bypass-permissions mode.** The PM sees the notice as a literal user message in its input; if bypass-permissions is on, it may still act on it. That's actually the desired behavior (the PM SHOULD react to "user force-closed your teammate") — but document it so future-you doesn't break the invariant.
- **The overflow dropdown has one menu item today.** Structure supports adding more (copy id, restart teammate, etc.) without touching the button — just add more `<button role="menuitem">` siblings.
- **No server tests for the new endpoint.** The dismiss endpoint didn't have one either, so we're consistent. Add if/when the session.routes surface gets enough endpoints to justify a dedicated test file.

### Verification (Phase I)

- `pnpm -C client run typecheck` — exit 0.
- `pnpm -C server run typecheck` — exit 0.
- `pnpm -C client test` — 22/22 pass (no new tests in this phase).
- `pnpm -C server test` — 12/12 pass.
- **Server restart required** to activate `POST /api/sessions/:id/system-notice` — the user was warned in the PHASE_REPORT (no auto-restart because their session's PM was live).

### HEAD (post-Phase-I)

```
d9ce052 feat(split): glass top bar + force-close behind overflow + PM notice
a67dc1f feat(sessions): teammate-active display state + muted teammate-idle
5a8ace2 fix(sessions): never dismiss teammate on isActive=false alone  ← Phase I.0 (team-lead)
b13be92 docs: Phase H — timer reset + plan dismissal persistence + plan recency
e4a1645 fix(chat): ContextBar elapsed timer resets on new turn boundary
4fbe99d fix(chat): persist plan widget dismissal in localStorage
b05a67a fix(plans): getActivePlan returns latest plan, not stale earlier ones
```

---

## Coder-15 Session — Phase J (Live activity + flip evidence + protocol cards, 2026-04-17)

### Commits (3)

```
c852480 feat(chat): shutdown + plan-approval + sender-preamble message cards
0d295e9 feat(chat): surface live pane activity in card / context bar / split
96c344e feat(status): SessionActivity + flip evidence + WS payload extension
```

### Triggering context

Three drifts + flickers had eroded user trust in Commander's signals over the preceding phases:
1. Sessions labeled `working` or `idle` without any way to confirm what Claude was doing — opening a tmux pane was the only reliable diagnostic. The Claude Code footer (`✽ Ruminating (1m 49s · ↓ 430 tokens · thinking with xhigh effort)`) already had better signal; we just weren't surfacing it.
2. Status flips (working → waiting, idle → working, etc.) left no audit trail beyond the eventual DB write. When a session got stuck or flipped wrong, there was no way to reconstruct "why".
3. Inter-session coordination messages (shutdown_request, plan_approval_*) arrived as raw JSON strings in user-role transcript messages, rendering as garbage in the JB bubble. Phase F handled `<task-notification>` + `<teammate-message>` XML; the JSON protocol was unaddressed.

### What shipped

**Bundle 1 — Activity parser (server).** `agent-status.service.ts` gains `detectActivity(paneContent): SessionActivity | null`. Regex `ACTIVITY_RE` matches `<spinner> <Verb>(…|...)? (<metadata>)?`. Scans the tail bottom-up over the last 12 lines so the newest stacked frame wins. Separate tiny regexes pluck elapsed / tokens / effort out of the parenthetical so a release that re-orders the segments still lights up the fields it does match. Greedy `[A-Z][a-z]+` for the verb — the non-greedy original clamped to a 2-char match and shipped "Ru" / "Do" instead of "Ruminating" / "Doodling" in the first attempt. Test coverage includes that exact regression.

**Bundle 2 — Status-flip evidence + history endpoint.** `detectStatusDetailed` / `detectStatusDetailedBatch` return `{status, evidence, activity}` in one capture. The poller uses the detailed variant and:
- Logs each flip: `[status] <id-prefix> <prev>→<next> evidence="<rationale>"`.
- Pushes `{at, from, to, evidence}` into a per-session ring buffer (`statusFlipHistory: Map<id, StatusFlip[]>`, cap 20, FIFO drop).
- Caches the most recent `activity` per session (`lastKnownActivity: Map<id, SessionActivity | null>`) so the route layer attaches data without fresh tmux shell-outs.
- New `GET /api/sessions/:id/status-history` returns `{sessionId, flips: StatusFlip[]}`.

**Bundle 3 — Richer WS `session:status` payload.** `eventBus.emitSessionStatus(id, status, extras)` now takes a third arg for `from`/`to`/`evidence`/`activity`/`at`. Shared `WSEvent` discriminated union extended with those fields as optional — legacy consumers that read only `status` still work unchanged.

**Bundle 4 — Client activity rendering.**
- `SessionCard` — shows the activity chip beneath the pills row when `status==='working' && activity`. Hides the `lastMessagePreview` during the active window to let the live signal take the row.
- `ContextBar` — status label gets a dot + activity chip appended: `Working · ✽ Ruminating 1m 49s · 430 tokens`. Passes through `session.activity ?? null` from ChatPage.
- `SplitChatLayout` single-tab header — activity inline with the name pill.
- `TeammateRow` — swaps the muted project-path column for the live activity while the teammate is working.

**Bundle 5 — Inter-session protocol cards.**
- `chatMessageParser.ts` — extended with `parseShutdownRequest`, `parseShutdownResponse`, `parsePlanApprovalRequest`, `parsePlanApprovalResponse`, `parseSenderPreamble`. JSON detectors are strict (`{`/`}` boundaries + exact `type` discriminator). `parseStructuredUserContent` tries XML → JSON protocol → sender preamble in priority order.
- New `ProtocolMessageCards.tsx` — 4 cards (Shutdown{Request,Response}, PlanApproval{Request,Response}) share a `CardShell` matching the Phase F Task/Teammate cards' left-border-accent shape.
- `ChatThread.tsx` user-group routing extended with 4 new branches.
- 15 new parser tests (37 client tests total, was 22); 7 new activity-detector tests (19 server tests total, was 12).

### Patterns established

- **Server-parse, client-render.** Heavy lifting (regex, shell-outs) lives in the server; the client receives a typed struct. Generalizes to any future "parse the Claude Code footer" need (memory %, connection badges, etc.) — add to `detectActivity` or a sibling, surface on Session, render in the existing surfaces.
- **Non-persisted derived fields on API responses.** `activity` is attached in the route boundary, never written to the DB, never in `rowToSession`. Frees us from migrations every time we parse something new from the pane.
- **Evidence strings as structured logs.** A short (<=40 char) deterministic string per classification branch is greppable via `[status] ... evidence=`, test-friendly, AND the substrate for the `/status-history` endpoint. Keep new branches' evidence strings unique + stable.
- **Extras object on emitters.** Adding optional fields to event emitters without changing the positional signature: `emit(a, b, extras = {})`. Broadcast layer spreads `...extras`. Shared types marked optional. Zero blast radius on consumers.
- **Priority-ordered detector cascade.** The parser runs strong-signal detectors first (XML unambiguous) → JSON-with-type-discriminator (near-unambiguous) → heuristics (sender preamble allowlist). New detectors insert at the priority point that matches their signal strength.

### Critical lessons (read before touching nearby code)

1. **`detectActivity` verb regex is greedy `[A-Z][a-z]+`, NOT non-greedy.** A non-greedy `+?` followed by an optional terminator clamps to the minimum (2 chars). Tests cover this. If you see "Ruminating" renderring as "Ru" again, check the regex first.
2. **`workspace-build triggers client/dist build.** `pnpm -w run build` builds everything, including `client/dist`. Phase E.2's NODE_ENV gate prevents Fastify from serving that dist in dev, so it's safe — but if you ever disable the gate, stale dist WILL shadow Vite. See `feedback_dist_shadows_vite`.
3. **Poller now captures more per tick.** `detectStatusDetailed` calls `capturePane` once and extracts status + activity + evidence. Cost is ~equal to the old path — same pane content feeds both classifiers.
4. **Activity on list endpoints is cache-only.** `/api/sessions` and `/api/sessions/:id/teammates` read `statusPollerService.getCachedActivity(id)` — no tmux shell-outs per list. The cache is populated on every poll tick (5s), so list results are up-to-date within one poll cycle.
5. **Status-history is process-scoped.** The `statusFlipHistory` map lives in the poller module. A server restart clears it. That's intentional — persistent flip history would need a new DB table and we don't need it yet. If the user asks "why did this session flip at 3am yesterday", tell them grep the log file (if retained) or say we can't answer.
6. **WS `session:status` payload is backwards-compat.** Older `useWebSocket` consumers still read `status`. New code should prefer `to` for explicitness, and use `evidence` + `activity` for richer UX. Don't remove `status`.
7. **Sender-preamble regex is tight on purpose.** `^(team-lead|coder-\d+|pm(?:-[a-z0-9]+)?|[a-z][a-z0-9-]{1,40}-\d+)\s*\n+([\s\S]+)$` — the required trailing `-\d+` on the fallback slug keeps ordinary user prose that starts with a word on its own line from mis-routing. If you loosen this, add tests for the false-positives you're introducing.
8. **XML detectors run before JSON detectors.** `<task-notification>...<status>shutdown_request</status>` must never fall through into `parseShutdownRequest`. The regression test `XML tag wins over JSON detector when content is an XML tag` pins this invariant.
9. **Activity renders are gated on BOTH `status==='working'` AND `activity` truthy.** A session can have cached activity from the last working window but be idle now; suppress the chip in that case. The gate is duplicated in every consumer — if you refactor, keep the gate, don't optimize into a shared helper without testing every site.

### Tech debt opened by Phase J

- **Ring buffer is in-process.** `statusFlipHistory` clears on restart. A session whose last flip was 2 minutes ago loses that history the moment the user `pnpm dev`s the server. Acceptable today; if flip debugging becomes a hot question, persist to a small `status_flips` SQLite table.
- **Activity verb regex is monolingual.** Claude Code's current verbs are English. A localized release would break the detector. File in mind; not shipping-critical.
- **Sender-preamble heuristic has no unit-test fuzz corpus.** 4 tests today. Expand if we see false positives in the wild (e.g. a doc that starts with a `-\d+`-suffixed word).
- **`detectActivity` scans last 12 lines bottom-up.** Claude Code occasionally re-prints a frame more than 12 lines back; we miss that case. Bump the window if reports come in; current value is a balance between scan cost + newest-wins correctness.
- **No integration test for the poller → WS event → client round-trip.** The unit tests cover each piece in isolation. If flip events stop arriving client-side post-Phase-J, bisect: `[status]` log entries → `rooms.broadcast('sessions', ...)` → WS message in browser devtools.
- **`useWebSocket` consumers don't surface the new richer payload anywhere yet.** The team-lead's `useSessionTransitions(sessionId)` suggestion (toast on transition) is a natural next-phase item. Payload is ready; the hook is the missing piece.
- **`session:status` WS listener type still destructures `(sessionId, status, extras)` from the event args.** If future server code forgets to pass `extras`, the broadcast spreads `...undefined` which is fine but relies on the `... ?? {}` default. Keep the default.

### Verification (Phase J)

- `pnpm -C client run typecheck` — exit 0.
- `pnpm -C server run typecheck` — exit 0.
- `pnpm -C client test` — 37/37 pass (was 22; +15 parser tests).
- `pnpm -C server test` — 19/19 pass (was 12; +7 activity-detector tests).
- **Server restart required** to pick up the new `detectStatusDetailed` batch path, the new endpoint, and the extended WS payload. I did NOT restart the user's live server.
- **Live checks deferred to team-lead** per spec: SessionCard / ContextBar activity visible, `curl /api/sessions/<id>/status-history`, protocol cards on OvaGas/JLFamily transcripts.

### HEAD (post-Phase-J)

```
c852480 feat(chat): shutdown + plan-approval + sender-preamble message cards
0d295e9 feat(chat): surface live pane activity in card / context bar / split
96c344e feat(status): SessionActivity + flip evidence + WS payload extension
5854058 docs: Phase I.0 addendum — emergency team-config reconcile patch
7f31fe3 docs: Phase I — color semantics + split-pane top bar + force-close rework
d9ce052 feat(split): glass top bar + force-close behind overflow + PM notice
a67dc1f feat(sessions): teammate-active display state + muted teammate-idle
5a8ace2 fix(sessions): never dismiss teammate on isActive=false alone  ← Phase I.0 (team-lead)
b13be92 docs: Phase H — timer reset + plan dismissal persistence + plan recency
e4a1645 fix(chat): ContextBar elapsed timer resets on new turn boundary
4fbe99d fix(chat): persist plan widget dismissal in localStorage
b05a67a fix(plans): getActivePlan returns latest plan, not stale earlier ones
```

---

## Coder-16 Session — Phase K (Chat parser robustness: multi-wrapper + JSON-in-wrapper + noise filter, 2026-04-17)

### What shipped

Three commits on top of `18f42f3`:

| Commit | Subject | Scope |
|---|---|---|
| `9a37ec3` | `refactor(chat): parseChatMessage returns ordered fragment array` | Parser rewrite. `parseChatMessage(content)` returns `ParsedChatMessage[]`. Scanner walks content L-to-R emitting wrappers + prose fragments in order. JSON-in-wrapper routing recognizes `idle_notification` / `teammate_terminated` / `shutdown_approved` (plus existing shutdown / plan-approval). Unparseable JSON body in a wrapper degrades to a TeammateMessageCard with "(unparseable payload)" trailer. Unknown `type` JSON emits an `unrecognized-protocol` fragment. `parseStructuredUserContent` retained as deprecated shim for Phase F/J tests + belt-and-suspenders call sites. |
| `686392d` | `feat(chat): system-event chips + unrecognized-protocol card + fragment renderer` | `SystemEventChip.tsx` (chip/card variants), `UnrecognizedProtocolCard.tsx`, `utils/systemEvents.ts` (`useSystemEventsMode` + `collapseConsecutiveIdles` + `isSystemEventFragment`), `utils/teammateColors.ts` (extracted palette used by three components). ChatThread iterates fragments; UserMessage belt-and-suspenders walks the array for the first card-worthy fragment. Collapse window: 60s. Default visibility: `chips`. |
| `0c6210f` | `test(chat): Phase K parser + collapse coverage (+24 tests)` | Parser tests for each new detector, array-mode scenarios (multi-wrapper same-kind, mixed kinds, prose-between-wrappers, unparseable, unknown-type both inside and outside a wrapper), collapse tests (burst, non-adjacent, non-idle passthrough). 37 → 61 client tests. |

### Why this phase existed

In the shutdown sequence at the end of Phase J.1, Claude Code's messaging layer injected multiple back-to-back `<teammate-message>` wrappers whose BODIES were `idle_notification` JSON payloads. The Phase F/J parser handled one top-level wrapper with prose body and either ignored the rest or rendered raw JSON in a JB bubble. The team-lead saw repeated garbled chunks and the working session looked broken. Phase K makes the parser robust to:

1. Multiple wrappers in one user-role message.
2. JSON bodies inside a wrapper (route to the protocol parser, attach wrapper context).
3. Unknown JSON `type` values (render placeholder, never leak JSON).
4. Noise protocol kinds (idle / terminated / approved) — collapse bursts, show as muted chips by default.

### Invariants added in Phase K (read before touching the chat-stream pipeline)

1. **`parseChatMessage` is the new entry point** for structured detection. `parseStructuredUserContent` is the deprecated compat shim that returns only the first card-worthy fragment and is retained for tests + belt-and-suspenders call sites. Prefer `parseChatMessage` in new code.
2. **The scanner preserves injection order.** If a message is `prose + <teammate-message> + prose + <teammate-message>`, the returned array is `[prose, card, prose, card]` in exactly that order. Prose segments that are purely whitespace are dropped.
3. **JSON-in-wrapper forwards wrapper context.** When a `<teammate-message>` body parses as JSON with a recognized `type`, the parser forwards it through `routeJsonByType(obj, raw, context)` where `context` = `{ teammateId, color }` from the wrapper attrs. This is how SystemEventChip tints to the right teammate color for idle/terminated/approved kinds.
4. **`hide` / `chips` / `cards` visibility mode** is backed by `localStorage['jsc-show-system-events']`, default `chips`. `useSystemEventsMode` re-renders on cross-tab `storage` events. No UI toggle exists today; flip via DevTools. See SUGGESTION below.
5. **Consecutive same-teammate idles collapse within 60s.** The counter and the newest timestamp survive; the chip renders "coder-15 idled ×3" with the end-of-burst timestamp on hover.
6. **Never render raw JSON in a user bubble.** Unknown `type` → `UnrecognizedProtocolCard`. Unparseable JSON body in a wrapper → TeammateMessageCard with "(unparseable payload)" trailer. These two paths are the last line of defense.
7. **Teammate color palette lives in `utils/teammateColors.ts`.** TeammateMessageCard, SystemEventChip, UnrecognizedProtocolCard all import `resolveTeammateColor`. Don't inline the palette a third time.

### Known footguns for next-you

- **Strict-mode regressions.** `parseTaskNotification` / `parseTeammateMessage` (singular, top-level) keep strict-mode (whole content must be the tag); that's what the existing Phase F tests exercise. The scanner uses `extractTaskNotification` / `extractTeammateMessage` on a given match, which is non-strict. If you refactor these, preserve both paths.
- **Overlapping wrappers.** Today no wrapper nests another. If that ever changes, `scanWrappers` collapses overlaps in favor of the outer match (non-overlapping cursor). A nested card would be lost, not crashed.
- **Sender-preamble + wrapper collision.** If a user segment matches BOTH the sender-preamble regex AND is the body of a wrapper (shouldn't happen today), the wrapper wins because the scanner emits wrappers first and prose segments are only emitted for content NOT covered by a wrapper match.
- **Collapse thresholds.** The 60s idle collapse window is a rough heuristic. Missing timestamps collapse optimistically (no way to tell apart, and users will almost always prefer collapse). If you ever see bursts separated by >60s that should still collapse (e.g., a stalled teammate idling once a minute for five minutes), relax the window here.

### SUGGESTIONS (deferred / minor)

- **UI toggle for system-events visibility.** Currently only flippable via `localStorage.setItem('jsc-show-system-events', 'cards' | 'hide')` in DevTools. When a Settings page materializes, surface there. Interim option: a tiny overflow dropdown in ContextBar.
- **ProseFragment between multi-wrappers uses `whitespace-pre-wrap` + no JB chrome.** Looks correct but subtly different from the pre-Phase-K full UserMessage (no timestamp, no truncation). If a prose-between-wrappers segment is genuinely long, it won't truncate. Acceptable for now because the real-world scenario is short connective text between cards.
- **`collapseConsecutiveIdles` only collapses WITHIN a single user message's fragment list.** Cross-message collapsing (e.g., 3 user messages in a row each containing 1 idle) is NOT merged. The server-side adjacency is different and would require group-level merging in ChatThread. Defer until we see it.

---

## Coder-15 Cold Start Guide (rotation handoff to the next coder)

If you are the coder replacing Coder-15, read this section before touching anything substantive. It collects the invariants, the footguns, and the "here's how the system actually works" context that the per-phase notes above assume you already know.

### Phase K addendum (read right after the numbered invariants below)

- Phase K adds **`parseChatMessage` as the new primary parser entry point**. It returns an ORDERED `ParsedChatMessage[]`. Empty array = plain prose (caller falls back to `<UserMessage>`). See `Coder-16 Session — Phase K` above for full invariants.
- `parseStructuredUserContent` is retained as a **deprecated shim** returning the first card-worthy fragment. Existing Phase F/J tests + the UserMessage belt-and-suspenders path use it, but new code should call `parseChatMessage` and iterate.
- JSON protocol detectors now include **`parseIdleNotification`, `parseTeammateTerminated`, `parseShutdownApproved`**. Keep adding new detectors here (not in a parallel file) so the priority cascade remains single-source.
- `localStorage['jsc-show-system-events']` (`hide | chips | cards`, default `chips`) controls whether the three noise kinds render as chips, full cards, or are hidden entirely.
- `utils/teammateColors.ts` is the single source of truth for the named-color → hex palette. Don't inline it.

### What Coder-15 shipped across rotations

- **Phase H (3 commits).** ContextBar elapsed timer reset on turn boundary. StickyPlanWidget dismissal persisted to localStorage via `utils/dismissedPlans.ts`. `getActivePlan` recency fix — always returns the LATEST assistant group's plan, not a stale earlier one.
- **Phase I (2 commits).** Teammate palette variant on StatusBadge (muted idle so green-means-working pops). `sessionDisplay.ts` exports `getDisplayStatus` for the derived `teammate-active` light-blue state. Split-pane glass top bar. Force-close behind overflow + modal + server `system-notice` endpoint.
- **Phase I.0 (1 commit — team-lead emergency patch).** `5a8ace2` moved `next.add(member.agentId)` in `team-config.service.ts reconcile()` ABOVE the `isActive=false` gate. Previously idle teammates were dismissed and re-ingested every cycle.
- **Phase J (3 commits).** Activity parser + flip evidence + WS payload extension + protocol cards + sender-preamble detection + 22 new tests. This is the "trust the signals" phase.
- **Phase J.1 (1 commit).** `IDLE_VERBS` allowlist (`Idle | Waiting | Paused | Standing`) suppresses the active-indicator hoist when the spinner glyph is present but the verb says parked. Fixes JLFamily PM showing `working` while pane reads `✻ Idle · teammates running`. `classifyStatusFromPane` exported for unit-testing the branch tree directly. 23/23 server tests pass.

### What you need to know that isn't obvious from the code

1. **`~/.claude/skills/jstudio-pm/SKILL.md`** must have a Cold Start section. It's what the PM session reads on spawn via the bootstrap-prompt flow. If that file gets deleted or its preamble shortens, new PM sessions forget to invoke `/pm` on cold start and the whole orchestration model falls apart. Don't touch it unless you understand the three-piece bootstrap (see Coder-9 notes).
2. **`feedback_isactive_flag_unreliable` memory is load-bearing.** The Agent tool's `isActive` flag flips to `false` when an agent idles, NOT when it's dismissed. `team-config.service.ts reconcile()` depends on this semantic. If you change the flag handling, read Phase I.0 above first.
3. **`tsx watch` is NOT used.** Server dev script runs plain `tsx src/index.ts`. You MUST manually restart after server edits: `lsof -ti:<port> | xargs kill -9 2>/dev/null; pnpm -C server dev &>/tmp/jsc-dev.log &`. Port is 11002 by default OR whatever `~/.jstudio-commander/config.json` says — the user's override usually wins at 3002.
4. **Vite port is 11573 (strictPort) post-Phase-E.2.** Server `NODE_ENV` gate (Phase E Bundle 2.1) prevents Fastify from serving `client/dist` in dev — so stale dist can't shadow Vite anymore. If multiple features suddenly vanish, the first move is still `ls -la client/dist/index.html` per `feedback_dist_shadows_vite` — if the mtime is recent and gating regressed, that's the issue.
5. **Three layers of process cleanup.** `tsx` (no watch), `pnpm -C server dev` (the wrapper), and pane-polled tmux sessions. `pkill -9 -f 'jstudio-commander/server'` sweeps tsx zombies (feedback_tsx_watch_zombies). Always verify clean port with `lsof -ti:<port>` after kill.
6. **Shared types live in `packages/shared`.** Adding a new type means exporting it from BOTH the origin file (e.g. `types/session.ts`) AND `src/index.ts`. `pnpm -w run build` rebuilds the `dist/` the server + client import. Don't skip the build; otherwise typecheck sees stale types.
7. **Effort levels are `high | xhigh | max` only.** Legacy rows with `low`/`medium` got healed to `xhigh` in Phase E. If you see a fresh row with a legacy level, something regressed.
8. **Teams config path.** `~/.claude/teams/*/config.json`. Chokidar watches the directory. `leadAgentId` + `members[].agentId` + `members[].isActive` + `members[].tmuxPaneId`. Member agentIds that look like UUIDs double as Claude UUIDs; non-UUID agentIds are custom slugs and need a tmuxPaneId to be live.
9. **Commander's own DB is SQLite at `~/.jstudio-commander/commander.db`.** `db/connection.ts` owns schema migrations via `PRAGMA table_info` gates (SQLite doesn't support `ADD COLUMN IF NOT EXISTS`). Add columns by copying the pattern for `stack_json` / `recent_commits_json` from Phase C.
10. **`session.activity` is NEVER in the DB.** Always attached at route boundaries from the poller's cache. If you ever write it to a column, you've broken the "derived, never persisted" invariant.
11. **PhaseF parser + PhaseJ parsers live in `chatMessageParser.ts`.** One detector cascade, priority-ordered. Add new parsers at the priority point that matches their signal strength. Don't split into multiple files without thinking hard — a single cascade is the easier abstraction to reason about.
12. **Spinner glyph alone does NOT mean `working` (Phase J.1).** `✻ Idle`, `✻ Waiting`, `✻ Paused`, `✻ Standing` all carry a spinner for visual continuity but mean parked. The `IDLE_VERBS` set in `agent-status.service.ts` is the allowlist; `classifyStatusFromPane`'s active-indicator branch consults it before returning `working`. If you add a new "spinner-but-parked" verb you see in the wild, extend `IDLE_VERBS` (and add a regression test in `activity-detector.test.ts`).

### What's in the backlog (Coder-15 file)

- `getDisplayStatus` unit tests (Phase I tech debt).
- `listActiveMembers(config)` helper extraction so a Phase-I.0-style regression test drops to ~8 lines.
- Persistent `status_flips` table if in-process ring buffer proves insufficient.
- `useSessionTransitions(sessionId)` hook to toast the new WS payload's `from→to + evidence` on transitions. Server-side is ready; the hook is unwritten.
- Batch `/output` endpoint (Phase B deferral, still deferred).
- `jstudio-init-project` helper (pending since Feature Wave 2).
- Memory/skill inventory browser view.
- `.claude/status.json` upstream signal (if/when Anthropic exposes it, replace regex heuristics).

### Start-of-session checklist

1. `cd ~/Desktop/Projects/jstudio-commander && git log --oneline -8` — confirm HEAD. Post-Phase-K should be `0c6210f`.
2. `pnpm -C client run typecheck && pnpm -C server run typecheck` — both exit 0.
3. `pnpm -C client test && pnpm -C server test` — 61 client + 23 server pass.
4. `curl -s localhost:<port>/api/system/health` — returns `{service:'jstudio-commander', version: ..., status:'ok', dbConnected:true}`.
5. `ls -la ~/.claude/prompts/pm-session-bootstrap.md` — file exists, ~134 bytes.
6. `grep -c "Cold Start" ~/.claude/skills/jstudio-pm/SKILL.md` — non-zero.
7. Wait for team-lead handoff. Do not start code changes.

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
