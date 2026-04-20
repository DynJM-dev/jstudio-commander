# Phase P Track A — QA Audit

Auditor: coder (read-only) · Date: 2026-04-17 · HEAD observed: `a42cfb0` (per STATE.md)

## Executive Summary

JStudio Commander at Phase N.0 is in objectively good shape for a pre-deploy: `pnpm -C server typecheck` and `pnpm -C client typecheck` both exit cleanly, all 110 server + 128 client unit tests pass, blast walls between `@commander/client` / `@commander/server` / `@commander/shared` are respected, there are zero `any` types in runtime code, lazy loading + ErrorBoundary are in place, and every multi-step DB mutation that matters (session create, team adoption, soft-delete) is wrapped in `db.transaction`. The most material risks before deploy are narrow infrastructure concerns: `readJsonlOrigin` performs a full-file read on potentially large JSONLs (defeats its own 16 KB budget), the hook/poller/bridge/reconcile writers don't use transactions around their session UPDATEs (SQLite's `better-sqlite3` serializes so there's no corruption — but semantic races are possible around the hook-yield window), and the Python dependency in `commander-hook.sh` silently swallows malformed payloads. No blockers — ship the phase, queue the high-priority items for Phase P Track B.

## Critical (p0 — must fix before deploy)

None. No blockers surfaced in this pass.

## High (p1 — should fix in next phase)

### H1. `readJsonlOrigin` reads entire file into memory before slicing
**Evidence:** `readFileSync(filePath, 'utf-8')` is called synchronously, then `raw.length > READ_HEAD_BYTES ? raw.slice(0, …)` runs. The 16 KB budget is applied AFTER the whole file is in memory. A >100 MB JSONL (possible for long-running PMs) blocks the Node event loop on every hook event + watcher callback that reaches a coder/PM disambiguation path.
**Location:** `server/src/services/jsonl-origin.service.ts:63-72`
**Direction:** Switch to `fs.open` + `read(fd, buf, 0, 16384, 0)` and close, same as `file-watcher.service.ts:40-50` already does for incremental tail reads.

### H2. Serialized hook queue does not apply to the non-hook write paths
**Evidence:** `hook-event.routes.ts:175-197` serializes hook POSTs through a single `Promise` chain (good). But `session-tick.service.ts:ingest`, `watcher-bridge.ts:onJsonlChange`, `team-config.service.ts:reconcile`, and `status-poller.service.ts:poll` all write to `sessions` independently. `better-sqlite3` is synchronous + per-statement-locked, so no corruption — however, a tick at T0 that lands during the 10 s `HOOK_YIELD_MS` window (`status-poller.service.ts:119-130`) advances `updated_at`, which then invalidates the yield gate on the next poll cycle (the gate reads `ms_since_update` fresh per poll). The yield was designed to honor the Stop hook's idle assertion for 10 s, but a tick one second later resets the clock.
**Location:** `server/src/services/status-poller.service.ts:64-69, 119-130` and `server/src/services/session-tick.service.ts:ingest → bumpLastActivity` which runs `UPDATE sessions SET last_activity_at = ?` (separate column — OK) but then `appendTranscriptPath` in the JSONL bridge DOES touch `updated_at` (`session.service.ts:389`).
**Direction:** Either (a) split `updated_at` from the poller yield check by keeping a separate column like `last_status_write_at`, or (b) keep `appendTranscriptPath`/etc. from bumping `updated_at` on append-only mutations. Yield should only reset when status itself flips.

### H3. `commander-hook.sh` depends on system Python 3 hard-coded to `/usr/bin/python3`
**Evidence:** Three `/usr/bin/python3` invocations with `|| echo '{...}'` fallbacks. On macOS 15.4 (Darwin 25.3.0 per env), `/usr/bin/python3` is a shim that can prompt the user to install CLT or fail silently with exit 1, producing `{"event":"unknown","data":{}}` payloads. The server then increments `hookMatchStats.skipped` but the real hook event — the one the user expects to drive `idle` at turn boundary — is lost.
**Location:** `hooks/commander-hook.sh:8, 12, 15`
**Direction:** Rewrite in Node (the rest of the stack is Node) or in pure bash + `jq` (add `jq` as a documented prereq); failure mode should be loud (stderr to Claude Code's hook log) rather than silent.

### H4. Terminal page ships, but the runtime is ANSI-dump-in-`<pre>`, not a PTY
**Evidence:** `package.json` declares `@xterm/*` + `node-pty` as dependencies; `server/src/services/terminal.service.ts:16-27` only attempts `spawn('tmux', ['attach-session', … '-r'])` (read-only) with a `capture-pane` polling fallback. `node-pty` is imported nowhere in source. Users see a terminal-shaped thing that doesn't accept keyboard input and lacks alternate-screen / mouse / PTY signals.
**Location:** `server/src/services/terminal.service.ts:15-72` and `STATE.md:98` ("node-pty broken (`posix_spawnp`)").
**Direction:** Product decision per `docs/CTO_SNAPSHOT.md` §8 — commit (~2-3 days to wire real xterm+PTY) or remove (~1 hour to drop the route, tab, and four unused deps). Current half-state disappoints anyone who uses it.

## Medium (p2 — nice to fix)

### M1. No E2E coverage for the Phase N.0 heartbeat/stale-override flow
**Evidence:** `client/e2e/core-flows.spec.ts` has 5 tests covering sessions page render, system health, teammates, chat, and preferences. The Phase N.0 critical path (Stop hook → idle flip → heartbeat bump → stale override → LiveActivityRow gated) has unit tests (`server/__tests__/heartbeat.test.ts`, `client/__tests__/heartbeat.test.ts`) but no end-to-end test that triggers a real hook and asserts the UI observable.
**Location:** `client/e2e/core-flows.spec.ts` (only 5 tests), `server/src/services/__tests__/heartbeat.test.ts` (unit only).
**Direction:** Add an E2E that POSTs to `/api/hook-event` with `{event:'Stop', sessionId:<known id>}` and asserts the session card's `HeartbeatDot` flips green then goes stale after 30 s. Follow the `core-flows.spec.ts` pattern.

### M2. Race between `resolveSentinelTargets` + `healOrphanedTeamSessions` on UNIQUE(tmux_session)
**Evidence:** STATE.md line 57 explicitly flags "Pre-existing sentinel-collision bug surfaced (`resolveSentinelTargets` + ovagas-ui orphan rows colliding on pane %59)" — mitigated by manual `DELETE FROM sessions WHERE team_name='ovagas-ui'`. The Phase N.2 self-heal in `healOrphanedTeamSessions` runs before `teamConfigService.start()` (`index.ts:155-162`), but `resolveSentinelTargets` is invoked inside `team-config.service.ts` during the reconcile pass. A live team config + a freshly orphaned row for the same pane can still collide on `sessions.tmux_session UNIQUE` if the orphan wasn't fully swept.
**Location:** `server/src/services/session.service.ts:698-733` and `server/src/index.ts:155-162`
**Direction:** Run `healOrphanedTeamSessions` INSIDE the reconcile flow (not only at boot) so it sees mid-session team-dir deletions. Alternately, add a `DELETE FROM sessions WHERE tmux_session = ?` precondition before the sentinel-resolve UPDATE.

### M3. `file_watch_state.last_line_count` incremental math is wrong
**Evidence:** `file-watcher.service.ts:56-63` does `last_line_count = last_line_count + excluded.last_line_count`. `excluded.last_line_count` is the COUNT of the NEW lines just parsed (`lines.length` from the `VALUES (?, ?, ?, ...)` above). That math is correct on append. BUT `last_byte_offset = excluded.last_byte_offset` is set to the CURRENT file size, so on a truncate+rewrite, offset rewinds while line_count keeps climbing — the two diverge permanently.
**Location:** `server/src/services/file-watcher.service.ts:56-63`
**Direction:** Either detect the truncate (`fileSize < lastOffset` already returns early; but a rewrite to the SAME size is undetectable without a mtime/inode check) and reset both, or drop `last_line_count` — it's not load-bearing for any UI consumer found in this pass.

### M4. `session_ticks` has no ON DELETE FK to sessions
**Evidence:** `connection.ts:108-136` creates `session_ticks` inline without a foreign key. When a session is deleted (hard-delete in `purgeTeamSession` or cascade-mass-cleanup), its `session_ticks` row survives. Low practical harm (the row just lingers), but `getAggregateRateLimits` reads `ORDER BY updated_at DESC LIMIT 1` so a stopped session's tick could still drive the rate-limit widget.
**Location:** `server/src/db/connection.ts:108-136`
**Direction:** Add `FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE`, or filter by `sessions.status != 'stopped'` in the aggregate query.

### M5. Hook queue depth is observable but not backpressured
**Evidence:** `hook-event.routes.ts:187-189` logs a warning at `queueDepth > 5` but never rejects or 503s. A wedged downstream (e.g. slow DB fsync, blocked chokidar callback) lets the queue grow unbounded. At Claude Code's ~5 hooks/second during a heavy turn, a 30 s downstream stall = 150 queued events.
**Location:** `server/src/routes/hook-event.routes.ts:186-196`
**Direction:** Add a hard cap (e.g. `if (hookQueueDepth > 20) return 503` with `Retry-After`) or drop events past the cap. Hooks are fire-and-forget by design (per `commander-hook.sh` `--max-time 2`) so shedding under load is safer than letting memory grow.

### M6. `ms_since_update` SQL cast assumes `updated_at` is in UTC
**Evidence:** `status-poller.service.ts:65-67` — `julianday('now') - julianday(updated_at)`. `updated_at` is written via `datetime('now')` which SQLite documents as UTC. The SELECT is correct — but only because every write-surface uses `datetime('now')` OR `new Date().toISOString()` (UTC). Any future code path that writes a naïve local-time string (e.g. `new Date().toLocaleString()`) silently corrupts the julianday diff without raising.
**Location:** `server/src/services/status-poller.service.ts:64-69`
**Direction:** Add a migration/assert at boot that logs a warning if `updated_at` contains a character not in `[0-9 \-:.]` (catches `AM`/`PM`/timezone suffixes), OR change the SQL to `strftime('%s','now')*1000 - strftime('%s',updated_at)*1000`.

## Low (p3 — cleanup)

### L1. Single `console.log` in client production code
**Evidence:** `client/src/services/ws.ts:47` — `console.log('[ws] Connected')`. Not gated by dev check.
**Location:** `client/src/services/ws.ts:47`
**Direction:** Wrap in `if (import.meta.env.DEV)` or remove.

### L2. Dead `node-pty` dependency
**Evidence:** `server/package.json:22` declares `node-pty ^1.1.0`; grep confirms zero imports. Adds build friction (`pnpm.onlyBuiltDependencies` carries it) and potential native-build failure surface.
**Location:** `server/package.json:22` and `package.json:24` (pnpm built deps).
**Direction:** Remove if terminal rewrite isn't imminent (see H4). Saves install time and macOS CLT build hazard.

### L3. `xterm` packages unused
**Evidence:** `client/package.json:17-19` — `@xterm/addon-fit`, `@xterm/addon-webgl`, `@xterm/xterm`. No imports in `client/src`. Ships ~500 KB to users who never open the terminal tab.
**Location:** `client/package.json:17-19`
**Direction:** Remove alongside L2, or gate on code-split like `@react-pdf/renderer` would be in an ERP.

### L4. Legacy `transcript_path` column still present + written to
**Evidence:** `schema.sql:19` + `connection.ts:29-32` keep the single-transcript column; `session.service.ts:177` maps `transcriptPath` in the upsert. Replaced by `transcript_paths` JSON array (#204). Only `index.ts:215-236` boot-heal still reads it — the migration runs once on the first boot after upgrade.
**Location:** `server/src/db/schema.sql:19`, `server/src/db/connection.ts:29-32`, `server/src/services/session.service.ts:177`
**Direction:** After verifying no prod DB still has legacy rows (run `SELECT COUNT(*) FROM sessions WHERE transcript_path IS NOT NULL AND transcript_paths = '[]'`), drop the column in a new migration. Low priority — SQLite ALTER DROP COLUMN is cheap.

### L5. `console.warn` on parse failures isn't structured
**Evidence:** `team-config.service.ts:98`, `session.service.ts:315`, `watcher-bridge.ts:108, 117`, `chat.routes.ts:34` — all print free-form strings that a log aggregator can't filter. Not a bug, but the Phase P deployment target likely wants structured logs.
**Location:** multiple
**Direction:** Adopt Fastify's `request.log.warn({…})` pattern for route-attached logs and `app.log.warn` for bootstraps.

---

## Audits Passed

- **Monorepo blast walls:** No cross-package imports other than `apps/* → @commander/shared` (verified grep; only match for `apps/` was a code comment). `client` never imports from `server` or vice-versa; both import from `@commander/shared`.
- **TypeScript strict:** `pnpm -C server typecheck` + `pnpm -C client typecheck` both exit 0. No warnings.
- **No `any` types:** Zero matches for `: any` or `as any` in `client/src` or `server/src` runtime code. One `@ts-expect-error` in `server/src/services/__tests__/install-hooks-merge.test.ts:7` imports an `.mjs` without a `.d.ts` shim — documented + scoped.
- **No `StrictMode` in main.tsx:** confirmed; `client/src/main.tsx` is 5 lines, no StrictMode wrapper.
- **Test coverage:** Server 110/110 passing (14 suite files), client 128/128 passing (6 suite files) + 5 Playwright E2E tests in `client/e2e/core-flows.spec.ts`. Count is close to the prompt's 121/128 — reconciles with Phase N.0's test additions (`heartbeat`, `stop-hook-idle`, `poller-yield`, `session-lifecycle-hooks`, `install-hooks-merge`, `sentinel-collision-heal`).
- **ErrorBoundary + lazy loading:** `client/src/App.tsx:1-56` wraps all routes in `<ErrorBoundary>`, all 8 pages are `React.lazy()`.
- **Transactions on multi-step mutations:** `db.transaction(() => …)` used correctly in `session.service.ts:289` (create), `:562` (adoptPmIntoTeam with re-parent), `:850` (deleteSession), `token-tracker.service.ts:58`, `project-scanner.service.ts:217`.
- **Hook event serialization:** `hook-event.routes.ts:175-197` promise-chains every hook. Failures don't poison the chain (`.catch(() => {})` inside `.finally`).
- **Loopback-only endpoints:** `/api/session-tick` enforces `request.ip` in `['127.0.0.1', '::1', '::ffff:127.0.0.1']` (session-tick.routes.ts:19-22, 29).
- **PIN auth + rate-limit:** Constant-time comparison via `timingSafeEqual` (`pin-auth.ts:65-74`), 5-attempt lockout (`:85-102`). Local requests bypass.
- **Security headers:** CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on every response (`security-headers.ts`).
- **SQLite configured correctly:** WAL mode + `foreign_keys = ON` (`connection.ts:20-21`). All migrations are idempotent (`PRAGMA table_info` guards, `IF NOT EXISTS`).
- **Startup self-heal:** Boot-time orphan cleanup for team sessions (`session.service.ts:healOrphanedTeamSessions`), cross-session teammates (`:healCrossSessionTeammates`), tmux-gone rows (`index.ts:182-206`), orphan jsc-tmux discovery (`index.ts:240-261`).
- **Atomic file writes:** `team-config.service.ts:updateTeamConfigLeadSessionId` uses tmp-then-rename (`:126-131`). Same pattern in `install-hooks.mjs:writeSettingsAtomic`.
- **Instance lock:** `acquireInstanceLock()` called before `getDb()` (`index.ts:113-116`) — prevents dual writer on same SQLite file.

---

## Recommended Next Actions

1. **Track A exit:** Queue H1–H4 as Phase P Track B tasks; none block deploy.
2. **Before next deploy:** Make a go/no-go call on H4 (Terminal page). Shipping the current half-built runtime for one more phase is fine; shipping it for three more is user-hostile.
3. **Observability:** Wire `hookQueueDepth` into `/api/system/health` so the M5 backpressure concern is monitorable, not just log-visible.
4. **Hygiene:** Remove dead deps (L2, L3) in a single chore commit — reduces the Phase P install friction.

— end —
