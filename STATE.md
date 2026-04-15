# JStudio Commander — State

## Current State
- Phase: **Post-v1 Polish wave complete** — coder-9 session shipped 17 commits + closed the PM initialization architecture gap
- Last updated: 2026-04-15
- HEAD: `587e508` (PM bootstrap auto-injection)
- Server port: **3002** (config.json override) · Vite: **5173**
- Blockers: pre-existing `file-watcher.service.ts(90)` TS err (unchanged, unrelated)
- Backlog: drained. Next-up list below is optional polish / new features.

## Phases
- [x] Phase 0-10: v1 Complete (see PM_HANDOFF.md)
- [x] Post-v1 Polish Wave 1 — Coder-7 (42 commits)
- [x] Post-v1 Polish Wave 2 — Coder-8 (plan-attach + verification)
- [x] **Feature Wave 1 — Coder-9 (17 commits, 2026-04-14 → 2026-04-15)**
- [ ] Feature Wave 2 — TBD (see "Next up" below)

## Coder-9 Commits (17, chronological)

| SHA | Feature / Fix |
|---|---|
| `cec1bc9` | fix(chat): dock sticky plan widget at bottom above input |
| `bfe82bb` | fix(chat): key plan tasks by real Claude task ID |
| `5263bd7` | feat(chat): sticky plan widget v1 |
| `7922156` | fix(chat): bump IntersectionObserver threshold 0.1→0.5 |
| `6627d57` | feat(chat): always-visible sticky (later reverted) |
| `c1c886f` | fix(chat): dock sticky at bottom, intersect-aware |
| `8d2d981` | fix(chat): walk plan across groups + close button |
| `9a2531b` | fix(chat): handle deleted task status |
| `e9f651b` | feat(shared): Session gains parent/team fields + Teammate type |
| `cf9b94f` | feat(chat): split-pane layout |
| `5598bb8` | feat(chat): dual-ID teammate resolution |
| `fdb2485` | feat(chat): compact_boundary parsing + context-scoped tokens |
| `9929f8a` | feat(sessions): waiting yellow highlight |
| `4f3b9c7` | fix(chat): bulletproof interrupt |
| `a42a1b4` | feat(chat): activity chips + AgentSpawnCard |
| `2150129` | feat(sessions): nested teammate tree |
| `853e477` | feat(sessions): team name suffix |
| `5f90cf8` | fix(sessions): teammates default to idle |
| `35ef990` | fix(context): model normalization + stats isolation + hook matcher |
| `53c32c5` | fix(sessions): liveness-gated boot heal + purge-with-archive delete |
| `38023cb` | feat(chat): brighter tokens + live thinking preview |
| `95aacef` | fix(sessions): sentinel → pane resolution + poller un-stick |
| `043dc5f` | feat(chat): state-aware shimmer + live in-flight indicators |
| `587e508` | feat(sessions): PM vs Raw toggle + bootstrap injection |

## Known Issues

- **Pre-existing TS err** — `server/src/services/file-watcher.service.ts(90)` chokidar callback err typing. Untouched.
- **tsx watch does NOT hot-reload server changes reliably** — MUST manually restart: `lsof -ti:3002 | xargs kill -9; pnpm dev`
- **node-pty broken** (`posix_spawnp`) — terminal uses capture-pane polling; don't try to fix
- **Hooks only fire for sessions started AFTER hook configuration** — existing sessions need restart
- **Claude Code reads settings.json hooks only on startup**
- **Two `pnpm dev` processes can coexist on 5173/5174** and serve stale code — always verify `lsof -ti:5173 -ti:5174` before debugging "why didn't my fix apply"

## Resolved decisions this wave

- **Plan pipeline** — single `getActivePlan(messages)` + `buildPlanFromMessages` in `client/src/utils/plans.ts` is the source of truth for both inline AgentPlan and StickyPlanWidget; walks the whole session with running Map keyed by real Task ID; resets on new TaskCreate after allDone
- **Compaction tokens** — `/stats` returns both `totalTokens` (all-time) and `contextTokens` (post-last-boundary); ContextBar leads with context, tooltips with total
- **Teammate model** — `agent_relationships` table stores parent/child edges; sessions row per teammate keyed by `agentId` (not UUID); `tmux_session` stores pane ID if known OR `agent:<id>` sentinel otherwise
- **Session liveness** — "member in team config" is NOT evidence of life; `upsertTeammateSession({ live })` gated on real tmux pane OR JSONL mtime <10min
- **Hook-event linking** — 4-strategy matcher (`claude_session_id` → `id-as-UUID` → unclaimed cwd candidate → skip); backfills `claude_session_id` on match so the fast path takes over
- **PM bootstrap** — `session_type='pm'` rows get `~/.claude/prompts/pm-session-bootstrap.md` sendKeys'd in once Claude's idle prompt appears; never blocks/fails session create
- **ESC global** — `window.keydown` listener, `data-escape-owner` subtrees claim ESC first, double-tap 80ms for reliability

## Next up (PM-confirmed backlog — none currently active)

1. **Multi-tab teammate pane (170.1)** — SplitChatLayout to tabs of ≤3 concurrent teammates
2. **Direct Mode badge** — informational overlay on PM pane when the user is focused in coder pane
3. **Playwright E2E harness** — no automated browser tests exist; needed for visual regression safety
4. **DB-persist split state per-user** — currently localStorage-only
5. **Memory/skill inventory view** inside Commander (browse `~/.claude/skills` + `~/.claude/projects/<slug>/memory`)
6. **Audit stopped teammates >N days** — auto-archive sweep so Sessions page stays clean
7. **Unit tests on `client/src/utils/plans.ts`** — logic has broken twice this session; fixtures from GG3 session exercise the multi-group bug
8. **Agent-status via `.claude/status.json`** — replace regex heuristics with positive ID if Claude Code exposes it
9. **jstudio-init-project helper** — one-prompt scaffold of STATE.md / PM_HANDOFF.md / initial dirs
10. **pane-ID hook event** — upstream request; would remove the `list-panes -a` + cwd match dance

## Critical rules for future coders

- **Skill ≠ Agent** — Skill tool loads a skill into context. Agent tool spawns a subagent (`subagent_type` ∈ general-purpose, statusline-setup, Explore, Plan, claude-code-guide). Never call `Agent({ subagent_type: "ui-ux-pro-max" })`.
- **PM bootstrap is three pieces** (SKILL.md Cold Start + `~/.claude/prompts/pm-session-bootstrap.md` + `session_type='pm'` inject) — breaking any one re-opens the OvaGas failure
- **Verify the served code** — curl the Vite endpoint and grep for symbols, not just `git log`
- **Match `'agent:'` prefix** when branching on "real tmux target" — everywhere
- **`WHERE status != 'stopped'`** is a trap for pane-backed rows; use `OR tmux_session LIKE '%'` in polling queries
- **Always restart server** after server-side edits: `lsof -ti:3002 | xargs kill -9; pnpm dev`
