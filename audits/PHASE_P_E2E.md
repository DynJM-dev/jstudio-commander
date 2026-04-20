# PHASE P — Track D: E2E Test Coverage Audit

**Date:** 2026-04-17
**HEAD:** `6fc3534`
**Auditor:** e2e-testing (Opus 4.7 1M, read-only)
**Scope:** Test inventory, critical-flow gap analysis, tooling recommendation, CI story.

---

## Executive Summary

Commander's test posture is **unit-heavy, integration-thin, E2E-minimal**. At HEAD `6fc3534` the suites are:

- **Server:** 110 tests across 14 files (prompt said 121 — stale count), all `node --test` unit tests mirroring SQL/logic against in-memory SQLite. 0 real-HTTP integration tests. Zero tests boot Fastify.
- **Client:** 128 tests across 6 files, all `node --test` unit tests of pure helpers (parsers, band math, format fns). 0 tests render React.
- **E2E:** 1 Playwright spec (`client/e2e/core-flows.spec.ts`) with **5 tests total**, all soft-skip gated — 3 are REST-only health probes, 1 is a UI smoke (page renders heading + button), 1 is preferences PUT/GET round-trip. **None exercise a real user flow end-to-end.**

The 8 critical flows listed in the brief (session creation, chat ingestion, status poller flip, statusline tick, compact detection, team reconcile, hook lifecycle, heartbeat) are each covered **at the component level** but **no single test** wires UI → server → DB → WS → UI for any of them. The risk this creates is that every integration seam (WS event shape drift, route/service wiring, chokidar → bridge → WS → React hook chain) has zero automated guard.

**Tooling recommendation one-liner:** Keep `node --test` for unit (it works, it's fast, no dep bloat); **add 5-7 Playwright E2E specs** (Commander already has `playwright.config.ts` wired) and **add 3-5 server-side real-HTTP integration tests** that boot Fastify + hit `/api/*` with a temp SQLite. Adding full Vitest would be churn for negative value — the current `node --test` suites are idiomatic.

**Issue counts:** Critical 3 · High 5 · Medium 4 · Low 3

---

## Current Test Inventory

### Server (`server/src/services/__tests__/`) — 110 tests / 14 files

| File:line | Unit/Integration | Coverage |
|---|---|---|
| `activity-detector.test.ts:1-234` | Unit | Phase J/L pane-regex classifier: `detectActivity`, `classifyStatusFromPane`, `parseElapsedSeconds`. Pure functions. |
| `aggregate-rate-limits.test.ts:1-160` | Unit (SQL-mirror) | Phase O `getAggregateRateLimits` SQL mirrored against in-memory SQLite. 10-min staleness gate. |
| `cross-session.test.ts:1-91` | Unit | Phase G.1 `isCrossSessionPaneOwner` predicate (cross-session pane heal). |
| `heartbeat.test.ts:1-162` | Unit (SQL-mirror) | Phase N.0 P3: `last_activity_at` column + bumpLastActivity mirror + poller yield no-bump invariant. |
| `hook-event-resolver.test.ts:1-128` | Unit (SQL-mirror) | Phase L B2: `UUID_RE` + `pm-cwd-rotation` SQL mirrored in SQLite. |
| `install-hooks-merge.test.ts:1-105` | Unit | Phase N.0 P4: `mergeHookEvents` idempotent merge into `~/.claude/settings.json`. Imports real `.mjs`. |
| `jsonl-origin.test.ts:1-199` | Unit (+ SQL-mirror) | Phase L B2 refinement: `parseOriginFromLines`, `isCoderJsonl`, + `coder-team-rotation` SQL. |
| `poller-yield.test.ts:1-121` | Unit (SQL-mirror) | Phase N.0 P2: 10s yield gate on fresh idle rows. julianday diff SQL contract. |
| `sentinel-collision-heal.test.ts:1-250` | Unit (SQL-mirror) | Phase N.2: `resolveSentinelTargets` team-exists gate + `healOrphanedTeamSessions` boot cleanup. |
| `session-lifecycle-hooks.test.ts:1-148` | Unit (SQL-mirror) | Phase N.0 P4: SessionStart/SessionEnd branch SQL mirrored. |
| `session-tick.test.ts:1-126` | Unit | Phase M B1: `normalizeTick` camelCase mapping + null-safe fallbacks. |
| `stop-hook-idle.test.ts:1-111` | Unit (SQL-mirror) | Phase N.0: Stop hook → `status='idle'` SQL mirrored. |
| `system-stats.test.ts:1-85` | Unit | Phase O: `buildSystemStatsSnapshot` formula with injected `os` stub. |
| `team-config-rewrite.test.ts:1-117` | Unit | Phase G.2: `updateTeamConfigLeadSessionId` atomic file write. |

**Pattern:** ~80% of server tests mirror SQL strings against a fresh `:memory:` DB. The test duplicates the production SQL literally and guards behavior, but **never exercises the Fastify route handler itself, the eventBus emit, or the chokidar watcher callback chain.**

### Client (`client/src/utils/__tests__/`) — 128 tests / 6 files

| File:line | Coverage |
|---|---|
| `chatMessageParser.test.ts:1-568` | Structured-content XML/tag parsers for teammate / task-notification / plan-approval / sender-preamble etc. Pure functions. |
| `contextBands.test.ts:1-93` | Phase M B2: `bandForPercentage`, `isWarningCrossing`, rank. Pure helpers for context % coloring. |
| `heartbeat.test.ts:1-101` | Phase N.0 P3: `formatSecondsAgo`, `applyStaleOverride` (mirror of SessionCard logic), LiveActivityRow visibility gate truth table. |
| `LiveActivityRow.test.ts:1-99` | Phase M B3: `buildLiveActivityParts` — tick-vs-activity token precedence. |
| `plans.test.ts:1-351` | `buildPlanFromMessages`, `buildToolResultMap`, `getActivePlan`. Fixture-driven plan parsing. |
| `systemStatsBands.test.ts:1-122` | Phase O: `bandForBudget`, `bandForMemory`, `formatBytes`, `formatResetsCountdown`. |

**Pattern:** 100% of client tests are pure-function guards. **No React component renders, no DOM, no hook tests.** The `applyStaleOverride` in `heartbeat.test.ts:9-13` is a deliberate **re-implementation** of the SessionCard helper — the real helper inside JSX is untested.

### E2E (`client/e2e/`) — 5 tests / 1 file + 1 helper

| File:line | Coverage |
|---|---|
| `core-flows.spec.ts:10-14` | UI smoke: `/sessions` renders "Sessions" heading + "New Session" button. No click. |
| `core-flows.spec.ts:16-31` | REST smoke: `GET /api/system/health` shape (status/dbConnected/tmuxAvailable + hookMatchStats keys). |
| `core-flows.spec.ts:33-38` | REST smoke: `GET /api/sessions/:id/teammates` returns an array even for nonexistent id. |
| `core-flows.spec.ts:40-52` | REST + soft-skip: `GET /api/chat/:id` for first non-stopped session. Skips if none. |
| `core-flows.spec.ts:54-65` | REST round-trip: preferences PUT then GET, value matches. |
| `helpers.ts:1-30` | `serverUp()` health check + `dismissPinIfPresent()` PIN gate bypass. |

**Critical observation:** the E2E suite has exactly **one UI interaction** in the whole file — a `page.goto('/sessions')` + two `toBeVisible()` assertions. There is **no click, no form fill, no assert-after-action**. Tests 2/3/4/5 never leave the REST layer and could be written equivalently with `node --test` + `fetch`.

**Playwright config** (`client/playwright.config.ts:1-24`): single chromium project, serial, `reuseExistingServer: true`, baseURL `http://localhost:11573`, no mobile/tablet, no webServer block (assumes `pnpm dev` is already running externally).

---

## Critical Flow Coverage — Gap Analysis

Eight flows, each scored for whether any test exercises it end-to-end (UI click/file event → server → DB → WS → UI observable):

| Flow | E2E coverage | Partial coverage |
|---|---|---|
| **1. Session creation** (UI button → POST /api/sessions → tmux + DB + events → WS `session:created` → list refresh) | **NONE.** `core-flows.spec.ts:10-14` renders the page but never clicks "New Session". | Server: `session.service.ts:240+` unit-tested only for effort coerce (`CODER_BRAIN.md`). Route handler untested at any layer. |
| **2. Chat ingestion** (chokidar JSONL append → watcher-bridge → WS `chat:message` → `useChat` → `<ChatThread>`) | **NONE.** | Client: `chatMessageParser.test.ts` covers parsing of structured content. Server: `jsonl-parser.service.ts` untested. `file-watcher.service.ts` + `watcher-bridge.ts` **entirely untested.** |
| **3. Status poller flip** (tmux pane change → `status-poller.service` → DB UPDATE → WS `session:status` → SessionCard status badge) | **NONE.** | Server: pane classifier covered (`activity-detector.test.ts`), yield gate covered (`poller-yield.test.ts`) — but **no test runs the poller's actual `poll()` loop** or proves the WS emit fires. |
| **4. Statusline tick** (claude Stop → statusline.mjs → POST /api/session-tick → DB + WS → SessionCard + HeaderStatsWidget chip flip) | **NONE.** | Server: `session-tick.test.ts` covers `normalizeTick` only. `session-tick.routes.ts` + `session-tick.service.ts` **DB write + WS emit path is untested.** Client: `LiveActivityRow.test.ts` covers `buildLiveActivityParts`; `useSessionTick` hook untested. |
| **5. Compact detection** (JSONL rotation → `post_compact` flag → UI renders "fresh" context) | **NONE.** | No tests found matching `post_compact` or `compact` detection in either workspace. This is a known Phase-M pain point (see `docs/CTO_SNAPSHOT.md:268-271`) and has no regression guard. |
| **6. Team reconcile** (team-config file change → chokidar → `team-config.service` → sessions upsert → WS `teammate:spawned` → UI adds tab) | **NONE.** | Server: `team-config-rewrite.test.ts` covers only the helper (`updateTeamConfigLeadSessionId`). The reconcile loop + upsertTeammateSession chain is untested. `sentinel-collision-heal.test.ts` covers the boot-time heal but not live file-change reconcile. |
| **7. Hook lifecycle** (SessionStart → working ; Stop → idle ; SessionEnd → stopped) | **NONE.** | Server: `session-lifecycle-hooks.test.ts` + `stop-hook-idle.test.ts` mirror the SQL for each branch, but no test POSTs a real hook payload to `/api/hook-event` and observes the DB + WS result. `hook-event.routes.ts` (`resolveOwner` 5-strategy cascade) is **tested only at the SQL predicate level** — the route handler itself is untested. |
| **8. Heartbeat** (any activity signal → `bumpLastActivity` → WS `session:heartbeat` → live "Xs ago" on SessionCard) | **NONE.** | Server: `heartbeat.test.ts` covers the UPDATE + mirror emit. Client: `heartbeat.test.ts` covers `formatSecondsAgo` + `applyStaleOverride` (mirror). **No test proves the WS event triggers a `useHeartbeat` re-render that flips the dot color or the stale-override in SessionCard.** |

**Net:** **0 / 8 critical flows have true end-to-end coverage.** Every flow has unit guards on its individual stages, but the wire seams between stages have zero automated checks. This is precisely where regressions from Phase-N-era refactors landed (see `docs/CTO_SNAPSHOT.md:238-255` "pain points").

---

## Critical findings

### C-1 — Zero E2E coverage for session creation

**Where:** `client/e2e/core-flows.spec.ts:10-14`
**What:** The one UI test renders `/sessions` and asserts a heading + button are visible. No click. `CreateSessionModal.tsx` → `POST /api/sessions` → tmux spawn → DB row → WS `session:created` → list refresh is **not exercised by any automated test.**
**Why it matters:** Session creation is 3 chained `setTimeout`s + a DB transaction + a tmux spawn (`docs/CTO_SNAPSHOT.md:254`). Each step can fail silently. A broken create flow reproduces as "click does nothing" in production and there's no guard.

### C-2 — Hook event pipeline has no integration test

**Where:** `server/src/routes/hook-event.routes.ts` (13.7 KB), `server/src/services/__tests__/*.test.ts`
**What:** The `resolveOwner` cascade is the root of the cross-session leak Jose fought through Phase L (`docs/CTO_SNAPSHOT.md:244-245`). It has 5 strategies and every recent phase added one more. Tests mirror the individual SQL predicates but **no test POSTs a realistic hook payload to the route and asserts the resolved id + DB writes + WS emit match.** A drop-path regression lands silently.
**Why it matters:** This is the highest-volatility surface in the codebase. Hook payload parsing + `resolveOwner` + DB write + eventBus is 300+ lines with zero wire-level coverage.

### C-3 — No CI pipeline exists

**Where:** No `.github/workflows/` directory; no workspace-level `test` script in root `package.json:8-13`.
**What:** Running tests requires cd'ing into each workspace and `pnpm test`. Nothing runs on push/PR. The "121 + 128" claim in the Phase P brief was verified by running manually (actual: 110 + 128).
**Why it matters:** Every commit either runs tests by hand or doesn't. In a solo-dev repo this is common; with the Ralph loop + multi-coder agents writing code, the likelihood of a silent regression landing is high.

---

## High findings

### H-1 — No Fastify route handler is integration-tested

**Where:** All 14 route modules in `server/src/routes/`.
**What:** Every server test either (a) tests a pure service function or (b) mirrors a SQL string into a `:memory:` SQLite and validates the predicate. **Zero tests boot `buildFastify()` and hit a real route.** Route-specific concerns (param validation, error mapping, CORS, security headers from `middleware/security-headers.ts`, PIN auth from `middleware/pin-auth.ts`) have no regression guard.
**Recommendation:** Add `server/src/__tests__/http.integration.test.ts` that boots Fastify with `process.env.COMMANDER_DB_PATH=':memory:'` + hits `/api/sessions`, `/api/hook-event`, `/api/session-tick`, `/api/preferences`.

### H-2 — No WebSocket emit contract tests

**Where:** `server/src/ws/event-bus.ts`, `packages/shared/src/types/ws-events.ts`
**What:** The `WSEvent` union (`docs/CTO_SNAPSHOT.md:119-120`) has ~15 event types. No test asserts that a given server action emits the correct event shape. A typo in the event name (e.g. `session:status` vs `session:statusChanged`) would not break typecheck (string literal) and would silently drop the UI update.
**Recommendation:** Add a test harness that subscribes a WS client, triggers an action (e.g. `POST /api/hook-event` Stop), and asserts the exact event + payload shape received within 500ms.

### H-3 — React components have zero render tests

**Where:** All files under `client/src/components/` and `client/src/pages/`.
**What:** `SessionCard.tsx`, `HeaderStatsWidget.tsx`, `ChatThread.tsx`, `LiveActivityRow.tsx`, `TopCommandBar.tsx` — nothing renders in a test. The stale-override logic in `SessionCard.tsx` is duplicated in `client/src/utils/__tests__/heartbeat.test.ts:9-13` with the comment "Mirror of the SessionCard applyStaleOverride helper" — **the real component is untested; the mirror is the only coverage.**
**Recommendation:** Add Playwright component-rendering tests (Playwright 1.59+ supports CT mode) OR narrow-scope JSDOM tests with `happy-dom` + a small helper.

### H-4 — File watcher chain is untested

**Where:** `server/src/services/file-watcher.service.ts`, `server/src/services/watcher-bridge.ts`
**What:** The chokidar → JSONL parse → WS emit chain (flow #2 above) is the substrate of chat display. It's 7 + 6.8 KB of code with **no tests.** A regression here breaks chat rendering entirely and surfaces only in manual testing.
**Recommendation:** Spec: write a real JSONL to a tmpdir, mount the watcher, wait for the emit, assert the message shape. Effort ~3-4 h.

### H-5 — Client E2E isn't wired to dev server

**Where:** `client/playwright.config.ts:1-24`
**What:** `reuseExistingServer: true` assumes an external `pnpm dev` is running. No `webServer` block means CI can't bootstrap. Tests fail closed with `Commander API unavailable` skip rather than exercising the real stack.
**Recommendation:** Add a `webServer` block that starts server + client with a temp DB and PIN disabled. Removes the "open a terminal first" friction and lets CI run them.

---

## Medium findings

### M-1 — PIN gate dismissal relies on env var set at test time

**Where:** `client/e2e/helpers.ts:22-29`
**What:** `dismissPinIfPresent()` reads `process.env.COMMANDER_PIN`; no `.env.test` exists in the repo. Every test will silently skip PIN dismissal unless Jose sets the env var, meaning the PIN-gated UI is never actually traversed in tests.
**Recommendation:** Document the PIN env var in README or add a test-mode toggle that disables PIN auth entirely (e.g. `COMMANDER_NO_PIN=1`).

### M-2 — No fixture data strategy for E2E

**Where:** `client/e2e/` has no `fixtures/` folder.
**What:** The existing E2E tests soft-skip when there's no active session (`core-flows.spec.ts:43-44`). This is defensive but means tests that "pass" on a fresh DB are meaningless. There's no mechanism to seed a known DB state before E2E runs.
**Recommendation:** Add a `tests/seed.ts` that inserts a known session + teammate + ticks before the suite runs, and reset after.

### M-3 — No tests for the compact detection flow

**Where:** Searched for `post_compact`, `compact`, `rotation` — no test hits.
**What:** Compact detection is a known Phase M B2 design (`docs/CTO_SNAPSHOT.md:268-271`) with real user impact (toast fires after the turn the user was worried about). Zero regression coverage.
**Recommendation:** When the compact detection ships, write a test that rotates a JSONL file + asserts the "fresh" flag flips.

### M-4 — Heartbeat WS round-trip untested from client POV

**Where:** `client/src/hooks/useHeartbeat.ts`, `client/src/components/sessions/SessionCard.tsx`
**What:** Client's `heartbeat.test.ts` covers `formatSecondsAgo` + a *mirror* of `applyStaleOverride`. The actual WS event → React re-render → DOM flip loop is untested. If the WS event name drifts, SessionCards freeze silently.
**Recommendation:** Add a Playwright test that opens the sessions page, forces a heartbeat via REST (or WS fixture), and asserts the "Xs ago" text updates within 2s.

---

## Low findings

### L-1 — Soft-skip pattern hides missing preconditions

**Where:** `client/e2e/core-flows.spec.ts:44`, `helpers.ts:9-15`
**What:** `test.skip(true, 'no active sessions to probe')` is kind to the runner but means the test passes when the thing being tested doesn't exist. Better to fail with a clear "seed data required" message.

### L-2 — No visual regression / screenshot baselines

**Where:** `client/e2e/` has no `screenshots/` folder; `playwright.config.ts` has `screenshot: 'only-on-failure'`.
**What:** The glassmorphism-heavy UI has no visual baselines. A CSS regression from a Tailwind v4 `@theme` change is not caught.
**Recommendation:** Low priority — visual baselines rot fast. Only worth adding after the layout stabilizes (post-Phase-N rewrite, see `docs/CTO_SNAPSHOT.md:252`).

### L-3 — Test files use dual naming conventions

**Where:** `server/src/services/__tests__/` uses `kebab-case.test.ts`; `client/src/utils/__tests__/` uses `camelCase.test.ts`.
**What:** Cosmetic. Both are valid node-test globs.

---

## Top 5 E2E flows to add first

Ranked by regression risk × payoff. Effort estimates assume an experienced dev + Commander already booting cleanly in dev.

### 1. `spec/session-creation.spec.ts` — Create and observe a new session (3-4 h)

**What it does:**
- `page.goto('/sessions')` → click "New Session" → fill modal with `{ name: 'e2e-session', projectPath: '/tmp/e2e-test-proj' }` → submit.
- Wait for modal to close.
- Poll `GET /api/sessions` until the new session appears with `status: 'working'` (max 5s).
- Assert the new session tab shows in `TopCommandBar`.
- Cleanup: `DELETE /api/sessions/:id`.

**Why first:** Single highest-leverage test. Exercises UI → POST route → tmux service → DB → WS → UI in one flow. Any regression in create path is caught.

**Extra value:** Soft-verifies the 3-setTimeout chain in `session.service.ts:240+` — if any step fails, the status never flips to `working` and the test times out.

### 2. `spec/hook-event-stop-flip.spec.ts` — Stop hook flips session to idle (2-3 h)

**What it does:**
- Seed: create a session via REST, assert it's `working`.
- `POST /api/hook-event` with a realistic Stop payload (`hook_event_name: 'Stop', session_id, transcript_path, cwd`).
- Poll `GET /api/sessions/:id` until `status === 'idle'` (max 2s).
- Assert a `session:status` WS event fired with `{ sessionId, status: 'idle' }`.

**Why:** Exercises the whole `resolveOwner` cascade + DB write + eventBus chain that currently has zero integration coverage (C-2). The most volatile code path in the repo.

### 3. `spec/statusline-tick.spec.ts` — Tick POST updates SessionCard context chip (3 h)

**What it does:**
- Seed: session exists.
- `POST /api/session-tick` with a realistic `StatuslineRawPayload` (80% context used).
- Assert WS emit for `session:tick`.
- Navigate to `/sessions`, assert the context chip on the SessionCard shows orange (80% = orange band per `contextBands.test.ts:33-37`).
- Push a second tick at 92% → assert chip flips red + a warning toast renders.

**Why:** Exercises the Phase M B2 context-band crossing warning (load-bearing for cost control per `docs/CTO_SNAPSHOT.md:268-270`). Covers both the server ingest path AND the client re-render.

### 4. `spec/chat-ingestion.spec.ts` — JSONL append renders in chat thread (4 h)

**What it does:**
- Seed: session exists with a transcript_path.
- Write a single valid JSONL line to the session's transcript file (fixture: one user message + one assistant_turn_start + one content block).
- `page.goto('/chat/:sessionId')`.
- Assert the message text renders in the chat thread within 2s.

**Why:** This is the flow that breaks hardest when chokidar config drifts or `watcher-bridge` emit shape changes. Zero coverage today (H-4).

**Effort note:** Slightly higher because it requires a tmpdir transcript fixture + careful watcher cleanup.

### 5. `spec/heartbeat-live-ago.spec.ts` — SessionCard "Xs ago" updates on heartbeat (2 h)

**What it does:**
- Seed: session exists with `last_activity_at = Date.now()`.
- `page.goto('/sessions')`, assert SessionCard shows "just now" or "1s ago".
- `POST /api/hook-event` with a PostToolUse (any event that triggers `bumpLastActivity`).
- Assert the SessionCard text resets to "just now" within 2s (proves the WS event re-triggered the `useHeartbeat` timer).

**Why:** Closes the M-4 gap. Cheap, isolates the client WS → hook → DOM path, and would catch a WS event-name typo.

**Total est. effort:** **14-16 hours** for all 5, or ~3 hours each on average. Realistic for a focused day + a half.

---

## Tooling recommendation

**Adopt a hybrid approach — don't go all-in on Playwright, don't stay all-unit.**

### Keep `node --test` for unit tests

Pros:
- Zero dep bloat (already in Node 22+).
- Runs in ~500ms per workspace.
- Existing 238 tests are idiomatic, readable, and catch real regressions at the SQL + pure-function layer.
- Matches Commander's "minimal deps" ethos (no vitest/jest/mocha).

Cons:
- No mocking helpers (each test rolls its own).
- No snapshot testing (fine — snapshot tests rot).

### Add Playwright for E2E (already configured, underused)

Pros:
- `client/playwright.config.ts` already exists. Zero setup cost.
- Real browser, real WS, real DOM — the only way to catch the seam bugs listed in C-1/C-2/H-3/H-4.
- Integrates with the running dev server (`reuseExistingServer: true`).

Cons:
- Tests are slower (~2-10s each). Acceptable if kept to the top 5 flows.
- Requires PIN dismissal or a test-mode toggle (M-1).

### Add `node --test` HTTP integration tests (new, 0 existing)

Pros:
- Boot Fastify with `:memory:` SQLite, hit real routes with `fetch`, assert body + DB state + emitted WS events.
- No browser overhead — runs in the same 500ms unit window.
- Fills the H-1, H-2, H-4 gap without a new test framework.

Cons:
- Some test-isolation complexity (shared eventBus, file watchers). Solvable with per-test Fastify instances.

### Skip Vitest

- The `node --test` suite works. Migrating would be churn for no gain.
- Vitest's DOM-rendering story is not a good fit for Commander's utilities-heavy test set.

### Skip Cypress

- Playwright is already installed and objectively better for this use case (real browser, parallel-capable, better TypeScript support).

---

## CI story

### Current state

- **No CI.** No `.github/workflows/` directory, no `.circleci/`, no other pipeline config.
- Root `package.json:8-13` has no `test` script. Tests require manual `cd server && pnpm test && cd ../client && pnpm test`.
- Pre-commit hooks: none observed.

### Cost of adding GitHub Actions

**Minimal setup (~1 h):**

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: corepack enable && pnpm i --frozen-lockfile
      - run: pnpm -r run typecheck
      - run: pnpm -r run test
```

This covers typecheck + 238 unit tests. Runs in ~2 min on GitHub's free tier.

### Adding E2E to CI (~2 h)

Requires:
1. `pnpm build` (shared + client + server).
2. Start server in background with `:memory:` DB + PIN disabled.
3. `pnpm exec playwright install --with-deps chromium`.
4. `pnpm --filter @commander/client test:e2e`.

Cost: ~4 additional CI minutes. Still within the free tier.

### Recommendation

1. **Add the minimal workflow now** (1 h). Catches the "someone pushed a typecheck error" class of regressions that the current manual workflow misses.
2. **Add E2E to CI after** the top 5 E2E specs land (otherwise it runs nothing). Wire a `webServer` block to the Playwright config + remove the external `pnpm dev` assumption.
3. **Don't add pre-commit hooks yet.** Commander is a solo-dev repo with lots of iteration; pre-commit friction slows the Ralph loops.

---

## Summary: Recommended action plan

| Priority | Action | Effort | Payoff |
|---|---|---|---|
| **P0** | Add GitHub Actions typecheck + unit test workflow | 1 h | Catches regressions on every push |
| **P0** | Write top 5 E2E specs (§ Top 5 flows) | 14-16 h | Closes 5/8 critical flow gaps |
| **P1** | Add `webServer` block to `playwright.config.ts` + remove external dev assumption | 1 h | E2E runs in CI |
| **P1** | Add `server/src/__tests__/http.integration.test.ts` (boot Fastify + hit /api/sessions + /api/hook-event) | 4-6 h | Closes H-1 + partial H-2 |
| **P1** | Add file-watcher chain test (chokidar → WS emit) | 3-4 h | Closes H-4 |
| **P2** | Document PIN env var + add `COMMANDER_NO_PIN=1` test-mode toggle | 2 h | Unblocks M-1 |
| **P2** | Add seed/teardown fixtures for E2E | 2-3 h | Closes M-2 |
| **P3** | Visual regression baselines after Phase N rewrite | — | Defer |

**Total P0 + P1:** 23-27 h. Buys Commander a real regression safety net covering the 5 most volatile flows.

— end —
