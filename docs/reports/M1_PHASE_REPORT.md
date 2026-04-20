# M1 Phase Report — Effort Defaults + Coder Session Type

**Phase:** M1 of Architecture v2 migration
**Dispatch:** `docs/dispatches/M1_DISPATCH.md`
**Plan:** `docs/MIGRATION_PLAN.md` §"Phase M1"
**Completed:** 2026-04-18
**Executor:** Claude Code (Opus 4.7, high effort)

---

## Summary

Replaced hardcoded `/effort xhigh` injection with per-session-type defaults and added `coder` as a first-class session type alongside `pm` and `raw`. Single source of truth for the effort matrix lives in `@commander/shared`.

## Effort matrix implemented

Verified via new shared tests (`packages/shared/src/__tests__/session.test.ts`):

| sessionType | `/effort` injected | Bootstrap loaded |
|---|---|---|
| `pm` | `high` | `~/.claude/prompts/pm-session-bootstrap.md` |
| `coder` | `medium` | `~/.claude/prompts/coder-session-bootstrap.md` |
| `raw` | `medium` | *(none)* |

Constant: `SESSION_TYPE_EFFORT_DEFAULTS` in `packages/shared/src/types/session.ts`.
Override: `createSession({ …, effortLevel })` on the service — per-call override, takes precedence over the map. No POST-body wiring for the override yet (dispatch said "if it doesn't exist, don't add it").

## Enum extension approach

No DB migration required. `session_type` is `TEXT NOT NULL DEFAULT 'raw'` with **no CHECK constraint** (verified via `server/src/db/schema.sql` + `server/src/db/connection.ts:44-47`). Extending the TypeScript union is sufficient; SQLite accepts the new `'coder'` value on insert.

Shape change:
- `SessionType = 'pm' | 'raw'` → `SessionType = 'pm' | 'coder' | 'raw'`
- `EFFORT_LEVELS = ['high', 'xhigh', 'max']` → `['medium', 'high', 'xhigh', 'max']`

## Files changed (14)

**Server:**
- `packages/shared/src/types/session.ts` — EFFORT_LEVELS + medium, new `SessionType` type, `SESSION_TYPES` array, `SESSION_TYPE_EFFORT_DEFAULTS` map, widened `Session.sessionType`.
- `packages/shared/src/index.ts` — re-export `SessionType`, `SESSION_TYPES`, `SESSION_TYPE_EFFORT_DEFAULTS`.
- `packages/shared/src/__tests__/session.test.ts` — **NEW** — 4 tests locking the effort matrix.
- `server/src/services/session.service.ts` — `normalizeEffortLevel` accepts `'medium'`; `BOOTSTRAP_PATHS` map + `readSessionBootstrap(sessionType)` helper replaces the ad-hoc PM-only reader; `createSession` computes `effortLevel` via `SESSION_TYPE_EFFORT_DEFAULTS[sessionType]`; post-boot injection sends `/effort ${effortLevel}` and the matching bootstrap.
- `server/src/routes/session.routes.ts` — POST body type uses `SessionType`.
- `server/src/services/agent-status.service.ts` — `EFFORT_RE` extended to match `medium` so coder pane-footer activity parses the effort label.
- `server/src/db/connection.ts` — **critical fix.** The boot heal at line 163 was `UPDATE effort_level = 'xhigh' WHERE effort_level IN ('medium','low')`. Left unfixed, every coder session would be healed back to `xhigh` on the next restart, silently wiping the M1 win. Narrowed predicate to `'low' OR NULL`.

**Client:**
- `client/src/components/sessions/CreateSessionModal.tsx` — 3-option picker (PM / Coder / Raw) with `Users` / `Code` / `Terminal` icons; caption text becomes context-aware by selected type.
- `client/src/components/sessions/SessionCard.tsx` — amber `CODER` pill mirrors the teal `PM` pill.
- `client/src/components/city/Building.tsx` — maps `sessionType === 'coder'` to `CharacterRole = 'coder'` and shows `CODER` as the role label on the city-view sign. (`CharacterRole` already had `'coder'` — no change needed in `PixelCharacter.tsx`.)
- `client/src/layouts/TopCommandBar.tsx` — top-bar filter allowlist now accepts `'coder'`. Without this, coder sessions would render as invisible teammates.
- `client/src/layouts/MobileOverflowDrawer.tsx` — same filter fix.
- `client/src/hooks/useSessions.ts` — cascaded `SessionType` typing.
- `client/src/pages/SessionsPage.tsx` — cascaded `SessionType` typing.

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | PM session injects `/effort high` (not `xhigh`) | ✅ |
| 2 | Coder session injects `/effort medium` + loads coder bootstrap | ✅ |
| 3 | Raw session injects `/effort medium` + no bootstrap | ✅ |
| 4 | CreateSessionModal shows PM / Coder / Raw | ✅ |
| 5 | SessionCard shows `CODER` pill for coder sessions | ✅ |
| 6 | Existing PM + Raw sessions continue to work | ✅ (defaults preserved via single source of truth) |
| 7 | All existing tests still pass | ✅ (see below) |
| 8 | No new TypeScript errors | ✅ |
| 9 | DB enum constraint accepts `'coder'` | ✅ (N/A — no CHECK constraint exists) |

## Tests

| Workspace | Before | After | Delta |
|---|---|---|---|
| `@commander/server` | 232 | 232 | 0 |
| `@commander/shared` | 25 | 29 | +4 (new `session.test.ts`) |
| `@commander/client` | 187 | 187 | 0 |
| **Total unit tests** | **444** | **448** | **+4** |

All pass. `pnpm typecheck` across all workspaces: clean.

*(The dispatch's "374 existing tests" figure is stale — actual unit-test count was 444 before M1. Integration tests not run; they spawn real tmux/Claude processes and the dispatch didn't require them.)*

## Manual verification

**Not performed by this agent** — would require spinning up Commander + a live Claude Code session interactively. Recommend Jose:
1. Spawn one PM session → verify `/effort high` keystroke + PM bootstrap text appears in the pane.
2. Spawn one Coder session → verify `/effort medium` keystroke + Coder bootstrap text appears.
3. Spawn one Raw session → verify `/effort medium` keystroke + no bootstrap text.

## Deviations from the dispatched file list

The dispatch anticipated changes to ~5–7 files. 14 files were touched. The extras were **not scope creep** — each was load-bearing for the acceptance criteria or would have caused silent regressions:

| File | Reason not in dispatch list |
|---|---|
| `packages/shared/src/index.ts` | Required so `client` and `server` can `import { SessionType } from '@commander/shared'`. |
| `server/src/db/connection.ts` | The legacy effort-level boot heal would have reset every coder row from `medium` back to `xhigh` on restart. |
| `server/src/services/agent-status.service.ts` | `EFFORT_RE` didn't match `medium` — coder pane-footer activity would lose its effort label in the UI. |
| `client/src/layouts/TopCommandBar.tsx` + `MobileOverflowDrawer.tsx` | Nav filters were an explicit `'pm' \| 'raw'` allowlist; coder sessions would be filtered out of the top bar and mobile drawer. |
| `client/src/components/city/Building.tsx` | City-view rendering branched on `sessionType === 'pm'`; coder sessions would've rendered with the generic "SESSION" label. |
| `client/src/hooks/useSessions.ts` + `client/src/pages/SessionsPage.tsx` | TypeScript cascade from widening the shared `SessionType` union. |

## Subtle behaviors surfaced (defer to future phases)

1. **`server/src/db/schema.sql:19`** still declares `effort_level TEXT DEFAULT 'xhigh'`. Moot today — Commander's `upsertSession` always provides a value — but aesthetically stale. Candidate for a sweep when M3 touches the schema.
2. **Legacy effort-level heal block** in `connection.ts:163-170` is effectively dead code now (the cohort of `'low'` / NULL rows is vanishingly small post-Phase E). Candidate for deletion.
3. **`CODER_BRAIN.md:100`** still describes `Session.sessionType: 'pm' | 'raw'`. Doc drift — update alongside the Phase M2 persona doc pass.
4. **UI symmetry:** PM gets a teal pill, Coder gets an amber pill, Raw gets no pill. Fine as-is; a RAW pill is trivial if symmetry matters later.
5. **Integration test coverage:** `post-sessions.test.ts` only exercises `sessionType: 'raw'`. A coder variant would require a live tmux host. The shared unit test now locks the effort-default contract, which is the load-bearing part.
6. **`CreateSessionOpts.effortLevel` override** is wired on the service but not on the `POST /api/sessions` body — the dispatch called this out as optional. Add it in M8 (effort-level mid-session adjustment) if the API surface needs it.

## Questions for PM

None blocking. The one open design choice worth flagging: the CreateSessionModal caption text now switches based on selected type instead of always showing a static "PM/Raw" explanation. If you'd rather always show the full matrix, that's a 5-minute change.

---

**Ready for M2** once you verify the spawn behaviors manually.
