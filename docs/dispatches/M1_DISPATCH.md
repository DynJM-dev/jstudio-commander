# M1 Dispatch — Effort Defaults + Coder Session Type

> **For:** Command Center Coder session
> **From:** CTO via Jose
> **Project:** jstudio-commander
> **Phase:** M1 of Architecture v2 migration
> **References:** `~/Desktop/Projects/jstudio-commander/docs/MIGRATION_PLAN.md` §"Phase M1"

---

## Recommended model / effort

**Model:** Opus 4.7
**Effort:** high
**Estimated duration:** 3-4 hours
**Why:** Touches core session-spawn logic, schema enum, UI modal, and client routing. Not hard, but many files. Opus+high minimizes regression risk on a system Jose uses constantly.

**If mid-phase complexity surfaces beyond this scope:** stop and report. Do not expand.

---

## Scope (what to change)

Three things in the Command Center codebase:

### 1. Replace hardcoded `/effort xhigh` with per-session-type defaults

**Current:** `session.service.ts` injects `/effort xhigh` for every session regardless of type.

**Target:** effort level is set per session type:

| sessionType | Default effort injected |
|---|---|
| `pm` | `high` |
| `coder` (new) | `medium` |
| `raw` | `medium` |

**Implementation notes:**
- The effort value should be defined in one place (a constant map or enum) rather than scattered
- Still injected via tmux keystroke post-boot, same mechanism as today
- Preserve the ability to override via `POST /api/sessions` body parameter if one is provided (if this doesn't exist yet, don't add it — just make the defaults cleanly changeable)

### 2. Add `coder` as a session type

**Current:** `sessionType` enum in `packages/shared/src/types/session.ts` is `'pm' | 'raw'`.

**Target:** extend to `'pm' | 'coder' | 'raw'`.

**Implementation checklist:**
- [ ] Update the TypeScript union type in `packages/shared/src/types/session.ts`
- [ ] Update any `zod` or validation schemas that reference the enum
- [ ] Update the SQLite schema CHECK constraint on `session_type` column if one exists (verify in migrations)
- [ ] If CHECK constraint exists and needs updating: write a migration that accepts the new value. Non-destructive — existing rows stay valid.
- [ ] Update route handler validation in `server/src/routes/session.routes.ts` to accept `'coder'`
- [ ] Update any switch/case or conditional logic in `server/src/services/session.service.ts` that branches on session type — add the coder case, route to appropriate bootstrap

### 3. Wire the Coder bootstrap

**Current:** PM sessions load `~/.claude/prompts/pm-session-bootstrap.md` (if it exists) post-boot. Raw sessions load nothing.

**Target:** Coder sessions load `~/.claude/prompts/coder-session-bootstrap.md` (if it exists) post-boot, same mechanism as PM.

**Implementation:**
- In `session.service.ts`, where `readPmBootstrap()` is called for PM type, add a parallel path for Coder type that reads `~/.claude/prompts/coder-session-bootstrap.md`
- Extract the bootstrap-reading into a helper that takes the session type and returns the bootstrap path (or null for raw)
- Same injection timing as PM: after `/effort` acknowledges, before Jose's first message arrives

### 4. Add the UI option

**Current:** `client/src/components/sessions/CreateSessionModal.tsx` shows "PM Session" and "Raw Session" as options.

**Target:** Show three options: "PM Session", "Coder Session", "Raw Session".

**Implementation:**
- Add the third radio/card/button option with label "Coder Session" and a one-line description like "Tactical execution of phase prompts and direct coding work"
- Wire selection to send `sessionType: 'coder'` in the POST body
- Any session-type-dependent rendering (session cards, filters, icons) — add a coder variant. Use a reasonable icon (maybe `Code` or `Terminal` from lucide-react) and a distinct color if session cards are color-coded by type.

---

## Acceptance criteria

Verify each before reporting:

1. [ ] Spawning a PM session injects `/effort high` (not `xhigh`)
2. [ ] Spawning a Coder session (new option) injects `/effort medium` and loads the coder bootstrap
3. [ ] Spawning a Raw session injects `/effort medium` and loads no bootstrap
4. [ ] All three options appear in the CreateSessionModal with clear labels
5. [ ] The session card UI correctly identifies coder-type sessions
6. [ ] Existing PM and Raw sessions continue to work (don't break current sessions)
7. [ ] All existing tests pass (374 currently)
8. [ ] No new TypeScript errors
9. [ ] Database enum constraint accepts `'coder'` (if applicable)

**Manual verification:** spawn one of each session type in the running Command Center. For each, verify:
- The `/effort` keystroke that Commander injects matches the expected level
- For PM and Coder, verify the bootstrap content loads (you'll see it in the session output)
- For Raw, verify no bootstrap content is injected

---

## Out of scope (do NOT touch)

Explicitly leaving these for later phases:

- Effort-level UI adjustment (changing effort mid-session from the UI) — that's Phase M8
- Project view dashboard — Phase M7
- PM ↔ Coder auto-forwarding cleanup — Phase M6
- Any filesystem migration of project folders — Phases M3.6, M4, M5
- Skill file changes — Phase M9
- OS document changes — Phase M3.5

If you find bugs in the existing effort-injection logic that go beyond "change the default value," surface them in the report but don't fix in this phase. Keep scope tight.

---

## Files you will probably touch

Rough expectation — confirm against actual code:

**Server:**
- `server/src/services/session.service.ts` — effort defaults, bootstrap routing
- `server/src/routes/session.routes.ts` — enum validation
- `server/src/services/tmux.service.ts` — probably no changes, verify
- A new migration file if SQLite CHECK constraint needs updating

**Shared:**
- `packages/shared/src/types/session.ts` — enum extension
- Any zod schemas if present

**Client:**
- `client/src/components/sessions/CreateSessionModal.tsx` — third option
- `client/src/components/sessions/SessionCard.tsx` (or wherever cards render) — coder-type variant
- Type definitions re-exported from shared

**Tests:**
- Any test that hardcoded `xhigh` — update expectations
- Any test that asserted the `sessionType` enum values — update
- Add one or two tests for the new coder session spawn path

---

## Skills to reference

Invoke as needed:
- None required — this is straightforward TypeScript work in familiar code

---

## Expected PHASE_REPORT

Standard format per `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`. Specifically surface in the report:

- Effort matrix implemented (confirm all three defaults match spec)
- Enum extension approach (did you need a DB migration? was there a CHECK constraint?)
- Any deviation from the file list above (if you touched more files than expected, why)
- Before/after test count
- Any subtle behaviors you noticed in the existing code that we might want to address in a later phase

---

**End of dispatch. Execute this, then report back.**
