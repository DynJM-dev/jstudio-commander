# JStudio Command Center — State

## Current State
- Phase: **Phase K complete (Coder-16). Chat parser now returns an ordered fragment array; multi-wrapper user messages surface every card in order; JSON-in-wrapper routing detects idle_notification / teammate_terminated / shutdown_approved and renders them as muted SystemEventChips (with ×N collapse for bursts). Unknown JSON `type` renders an UnrecognizedProtocolCard placeholder — raw JSON never leaks to JB bubbles.**
- Last updated: 2026-04-17

> **🪪 Rebrand 2026-04-17 — display-only (scope A).** User-facing product
> name is now **JStudio Command Center**. Internal slugs intentionally
> preserved: repo dir `jstudio-commander`, package names `@commander/*`,
> signed health `service: "jstudio-commander"` (Phase D), team config
> names, user's `~/.jstudio-commander/config.json`, `commander-hook.sh`.
> Rebuild the .app bundle after pulling: `bash scripts/macos-launcher/build.sh`.

> **⚠️  Port migration — user action optional.** The default server port
> moved from 3002 → 11002. If your `~/.jstudio-commander/config.json`
> has `"port": 3002`, the override still wins — remove the field or set
> it to 11002 to pick up the new default. Also update
> `~/.claude/hooks/commander-hook.sh` (the user-managed hook copy
> outside the repo) to match, otherwise Claude Code hook events will
> be POSTed at the wrong port.

- HEAD: `f40ad04` (Phase K addendum sender-preamble+JSON). Phase K commits: `9a37ec3` (Bundle 1 parser refactor + JSON-in-wrapper routing + new types), `686392d` (Bundles 2-4 SystemEventChip + UnrecognizedProtocolCard + ChatThread fragment renderer + noise filter + localStorage toggle + TeammateMessageCard color-map extraction), `0c6210f` (Bundle 5 +24 tests), `86f16db` (docs), `f40ad04` (addendum: SENDER_JSON_PREAMBLE_RE tolerates zero-ws, preamble sender wins attribution on disagreement, +5 tests, 61 → 66 client). Phase J.1 commit: `18f42f3`. Phase J previous HEAD: `c852480` (Bundle 5 protocol cards). Phase J commits: `96c344e` (Bundles 1+2+3 shared types + activity detector + poller evidence + WS payload + status-history endpoint + 7 activity-detector tests), `0d295e9` (Bundle 4 client activity rendering in SessionCard / ContextBar / SplitChatLayout / TeammateRow), `c852480` (Bundle 5 chatMessageParser extended + ProtocolMessageCards + ChatThread routing + 15 parser tests). Phase I.0 emergency patch: `5a8ace2`. Phase I commits: `a67dc1f` `d9ce052`. Phase H commits: `b13be92` `e4a1645` `4fbe99d` `b05a67a`. Phase G.2 commit: `425632b`. Phase G.2 commit: `425632b`. Phase G.1 commits: `68ce81a` (detector hoist), `976603d` (ContextBar monitoring label), `1b62f63` (predicate parent-exclusion + regression suite). Phase G commits: `0b0d632` (Bundle 3 dismiss button), `3ba49a9` (Bundles 1+2+4 cross-session guard + widened adoption + startup heal), `2f04086` (Bundle 5 icons), `a3ea2fa` (Bundle 6 top-bar filter + bot count badge). Phase F commits: `457d9e5` `d357f03` `b9e7bc4` `654cb05` (Bundle 1 structured chat), `2c0e063` (Bundle 2 auto-split), `467adce` (Bundle 3 pane adoption), `a1aa074` (Bundle 6 bypass-perm kill-switch), `ad163ba` (Bundle 5 team-lead adoption + coder naming). Phase E.2: `58434d9` (Vite → 11573 strictPort). Phase E.1: `f5da3ba` (dev-mode redirect). Phase E: `9cf67af` `02ae1ef` `23ea243` `6fda3c3` + `f956fcc` `15fe784` `ab72eec` `05ebbcd` `24f21f9` `26cfe2b` `603b398` `3d0de45` `eb9f85f` `4a040b8` `8089542`. Phase C: `0970950` `dae794f`. Phase B: `6177fe2` `ad3d7fe`. Phase A: `b7886fb` `c21ab5b` `49f149a` `69a66f0` `72d2fae` `2787b2d`.
- Model: **Opus 4.7** (migrated from 4.6). Default effort: **xhigh** for Commander-spawned sessions.
- Server port: **11002** (new default as of Phase D, migrated from 3002). Override via `~/.jstudio-commander/config.json` still honored. · Vite: **5173**
- Blockers: none
- Backlog: Batch `/output` endpoint deferred (low marginal value post-#219). Remaining suggestions are housekeeping (see Next up).

## Phases
- [x] Phase 0-10: v1 Complete (see PM_HANDOFF.md)
- [x] Post-v1 Polish Wave 1 — Coder-7 (42 commits)
- [x] Post-v1 Polish Wave 2 — Coder-8 (plan-attach + verification)
- [x] Feature Wave 1 — Coder-9 (17 commits, 2026-04-14 → 2026-04-15)
- [x] Feature Wave 2 + Stabilization — Coder-9 (25 commits, 2026-04-15 → 2026-04-16)
- [x] Phase A — Token-audit cleanup sweep — Coder-11 (6 commits, 2026-04-16)
- [x] **Phase B — Polling protocol changes (#216 tail-delta, #219 preview pause) — Coder-11 (2 commits, 2026-04-16)**
- [x] **Phase C — Project tech-stack pills + recent commits (#230) — Coder-12 (2 commits, 2026-04-17)**
- [x] **Phase D — Launch UX hardening (signed health + preflight + macOS .app + port 11002) — Coder-12 (4 commits, 2026-04-17)**
- [x] **Phase E — Finish 4.7 migration + NODE_ENV gate + Command Center rebrand — Coder-12 (11 commits, 2026-04-17)**
- [x] **Phase F — Structured chat messages + auto-split + pane adoption + prompt-detection kill-switch + team-lead adoption + coder naming — Coder-14 (9 commits, 2026-04-17)**
- [x] **Phase G — Dismiss button + cross-session pane rejection + widened adoption cwd + startup heal + larger teammate icons + top-bar filter + bot count badge — Coder-14 (5 commits, 2026-04-17)**
- [x] **Phase G.1 hotfix — status detector active-tail hoist + ContextBar monitoring label + startup-heal predicate parent-exclusion + 7 regression tests — Coder-14 (3 commits, 2026-04-17)**
- [x] **Phase G.2 — Adoption re-parents teammates + rewrites team config leadSessionId + 5 atomic-rewrite tests — Coder-14 (1 commit, 2026-04-17)**
- [x] **Phase H — ContextBar timer reset on turn boundary + StickyPlanWidget dismissal persistence (localStorage) + getActivePlan recency (latest plan only) + 3 new plan tests — Coder-15 (3 commits, 2026-04-17)**
- [x] **Phase I.0 — Emergency PM patch: team-config reconcile never dismisses on isActive=false — Team-lead (1 commit `5a8ace2`, 2026-04-17)**
- [x] **Phase I — Teammate palette (muted idle) + teammate-active display state (light blue) + split-pane glass top bar + force-close overflow/modal + PM system-notice endpoint — Coder-15 (2 commits, 2026-04-17)**
- [x] **Phase J — Live pane-activity parser + status-flip evidence log + `/status-history` endpoint + WS session:status payload extension + inter-session protocol cards (shutdown/plan-approval) + sender-preamble detection — Coder-15 (3 commits, 2026-04-17).**
- [x] **Phase J.1 — `✻ Idle` verb override (IDLE_VERBS allowlist) so spinner-glyph hoist no longer flips parked PMs to `working` + classifyStatusFromPane exported for unit tests + 4 new tests — Coder-15 (1 commit, 2026-04-17). Final Coder-15 rotation.**
- [x] **Phase K — Chat parser robustness: multi-wrapper scan (array return), JSON-in-wrapper routing for idle_notification / teammate_terminated / shutdown_approved, SystemEventChip (chips|cards|hide via localStorage `jsc-show-system-events`, default chips), consecutive-same-teammate idle collapse ×N, UnrecognizedProtocolCard fallback for unknown JSON `type`, parser+collapse test coverage (+24 tests, 37 → 61 client) — Coder-16 (3 commits, 2026-04-17).**
- [x] **Phase K addendum — `sender{json}` zero-whitespace preamble routing: SENDER_JSON_PREAMBLE_RE detects bare `team-lead{"type":"shutdown_request",...}` form the messaging layer uses outside wrappers, preamble sender wins attribution on disagreement with JSON.from, +5 tests (61 → 66 client) — Coder-16 (1 commit `f40ad04`, 2026-04-17).**

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

1. **Batch `/output` endpoint** — deferred Phase B sub-item. Skip until multi-teammate views are measurably hot post-#219.
2. **jstudio-init-project helper** — scaffold STATE.md / PM_HANDOFF.md with one prompt
3. **Memory/skill inventory view** — browse `~/.claude/skills/` + memory files as panel
4. **Agent-status via `.claude/status.json`** — replace regex heuristics if upstream exposes it
5. **Stack detection follow-ups (#230)** — only scans 1-level workspace children today; deeper monorepos would need glob recursion. Mapping table starts at ~30 entries — grow as new stacks appear in live projects.

## Critical rules for future coders

- **Skill ≠ Agent** — Skill loads into context. Agent spawns a subagent.
- **PM bootstrap = 3 pieces** — SKILL.md Cold Start + bootstrap prompt + session_type='pm' inject
- **Verify the served code** — curl the Vite endpoint and grep, not just git log
- **`git add <specific-files>`** when coder-10 is active — NEVER `git add -A`
- **`WHERE status != 'stopped'`** is a trap for pane-backed rows; use `OR tmux_session LIKE '%'`
- **Always restart server** after edits: `lsof -ti:11002 | xargs kill -9; pnpm dev` (substitute the active port from `~/.jstudio-commander/config.json` if overridden)
