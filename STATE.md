# JStudio Commander — State

## Current State
- Phase: **Phase A — Token-audit cleanup sweep complete (Coder-11)**
- Last updated: 2026-04-16
- HEAD: `72d2fae` (close #191) — Phase A commits: `b7886fb` `c21ab5b` `49f149a` `69a66f0` `72d2fae`
- Model: **Opus 4.7** (migrated from 4.6). Default effort: **xhigh** for Commander-spawned sessions.
- Server port: **3002** (config.json override) · Vite: **5173**
- Blockers: none
- Backlog: #216 (useChat tail-delta), #219 (SessionTerminalPreview pane-poll batch), #230 (project tech-stack pills). All low priority.

## Phases
- [x] Phase 0-10: v1 Complete (see PM_HANDOFF.md)
- [x] Post-v1 Polish Wave 1 — Coder-7 (42 commits)
- [x] Post-v1 Polish Wave 2 — Coder-8 (plan-attach + verification)
- [x] Feature Wave 1 — Coder-9 (17 commits, 2026-04-14 → 2026-04-15)
- [x] Feature Wave 2 + Stabilization — Coder-9 (25 commits, 2026-04-15 → 2026-04-16)
- [x] **Phase A — Token-audit cleanup sweep — Coder-11 (5 commits, 2026-04-16)**
- [ ] Phase B — Polling protocol changes (#216 tail-delta, #219 preview pause)
- [ ] Phase C — #230 project tech-stack pills

## Feature Wave 2 Highlights

### Architecture
- Rotation-detector DELETED → deterministic `transcript_paths: string[]` column (#204)
- Hook events serialized via promise chain (#209)
- Session create/delete wrapped in DB transactions (#208)
- Status detection: 25-line capture, idle-footer allowlist, numbered-choice block (#222, #236)

### Design System (CSS class spine — DO NOT inline-duplicate)
`.nav-btn` · `.session-tab` · `.cta-btn-primary` · `.filter-chip` · `.waiting-tab-alarm`

### Features shipped
- City view `/city` — pure CSS cyberpunk pixel art (#214)
- Tunnel URL + QR badge in TopCommandBar (#231)
- Manual refresh button in ContextBar (#237)
- Button-style session tabs with state-aware glow (#225)
- SessionCard: effort pill, model badge, time-since, quick-split (#226)
- ProjectCard: linked-sessions cluster, last-scanned, compact indicators (#227)
- Analytics: count-up animation, trend deltas (#212)
- Mobile: safe-area fix (#232), split collapse to strip (#233)
- Stopped fold on SessionsPage (#220)
- Session name disambiguator (#220)

### Fixes
- Analytics null crash (#210)
- useChat stale poll (#193)
- pendingLocal duplicate render (#224)
- Waiting false-positive on idle footer (#236)
- Working→waiting transition lag (#222)

### Audits
- Edge-case audit: 14 scenarios, 0 FAIL (`AUDIT_2026-04-15.md`)
- Token-efficiency audit: 12 surfaces (`AUDIT_TOKENS_2026-04-15.md`)
- UI rundown audit: 2 Major fixed, 8 Nit (`UI_AUDIT_2026-04-15.md`)
- Tunnel security audit: 9 fixes (coder-10, `TUNNEL_AUDIT_2026-04-15.md`)

## Known Issues

- **tsx watch does NOT hot-reload server changes reliably** — MUST manually restart
- **node-pty broken** (`posix_spawnp`) — terminal uses capture-pane polling
- **Hooks only fire for sessions started AFTER hook configuration**
- **Agent-status heuristic is regex-based** — evolves with each Claude Code UI change. Consider `.claude/status.json` if exposed upstream.

## Resolved decisions (Wave 2 additions)

- **Transcript ownership** — deterministic hook-bound `transcript_paths` list. No heuristics. Hooks append; chat concatenates in array order.
- **Waiting detection** — strong signals first (numbered-choice, [y/N], "Do you want to"), idle-footer short-circuit, no bare `?` pattern. Capture 25 lines.
- **Model default** — Opus 4.7, no `[1m]` suffix (4.7 gets 1M automatically). Commander-spawned sessions hardcode `xhigh` effort instead of reading settings.json.
- **Mobile split** — below 768px, SplitChatLayout forces minimized strip. Teammate tap navigates to full single-pane route.
- **Design system** — all interactive elements use one of 4 CSS class families. Drift is now confined to chat-internal components.

## Next up (pending backlog)

1. **Token-audit follow-ups (remaining)** — #216 (useChat tail-delta), #219 (SessionTerminalPreview pane-poll batch). Phase B candidates.
2. **#230** — Project tech-stack pills + git commits (needs coder-10 server endpoint). Phase C.
3. **jstudio-init-project helper** — scaffold STATE.md / PM_HANDOFF.md with one prompt
4. **Memory/skill inventory view** — browse `~/.claude/skills/` + memory files as panel
5. **Agent-status via `.claude/status.json`** — replace regex heuristics if upstream exposes it

## Critical rules for future coders

- **Skill ≠ Agent** — Skill loads into context. Agent spawns a subagent.
- **PM bootstrap = 3 pieces** — SKILL.md Cold Start + bootstrap prompt + session_type='pm' inject
- **Verify the served code** — curl the Vite endpoint and grep, not just git log
- **`git add <specific-files>`** when coder-10 is active — NEVER `git add -A`
- **`WHERE status != 'stopped'`** is a trap for pane-backed rows; use `OR tmux_session LIKE '%'`
- **Always restart server** after edits: `lsof -ti:3002 | xargs kill -9; pnpm dev`
