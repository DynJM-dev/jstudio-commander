# M8 — Effort Indicator + Click-to-Adjust UI

**From:** PM (Commander, 2026-04-20)
**To:** CODER (continuing post-triage-batch)
**Type:** CODE ROTATION — close M8 with narrow scope, per Commander CTO ratification and reconnaissance findings.
**Preceded by:** Triage batch closed at `c3c97d0`. OS propagation pass landed (§20.LL-L11/L12, §23 v3 changelog, new `standards/INVESTIGATION_DISCIPLINE.md`).
**Deliverable:** 1–2 commits, 1–2 hour rotation, same-day ship. Acceptance gate = Jose browser smoke + self-dogfood.

---

## Scope framing — why this is smaller than the migration estimate

The M7/M8 migration brief (`docs/briefs/M7_M8_MIGRATION_BRIEF.md`) estimated M8 at 3–4 hours. That estimate was made without knowledge of Commander's current state. Reconnaissance reveals most of the infrastructure is already in place.

**Already shipped:**
- `SessionCard.tsx:347-362` — effort badge (teal pill, Zap icon + level text). Display-only.
- `ContextBar.tsx:313-324` — `changeEffort()` async function that POSTs `/sessions/:id/command` with `/effort [level]`.
- `ContextBar.tsx:708-765` — click-to-adjust dropdown on the gauge icon inside the chat view.
- `server/src/routes/session.routes.ts:147-162` — `POST /api/sessions/:id/command` endpoint.
- `server/src/routes/session.routes.ts:243-252` — `PATCH /api/sessions/:id` writes `effort_level` and broadcasts `session:updated` WS event.
- `session.service.ts:567-576` — effort injection at session spawn via tmux `/effort [default-level]`.
- `SESSION_TYPE_EFFORT_DEFAULTS` — pm→high, coder→medium, raw→medium (in `packages/shared/src/types/session.ts:11-23`).

**Actual M8 gaps:**
1. SessionCard's effort badge is **display-only** — user must open the chat view to adjust. Need click-to-adjust directly on the sidebar session card.
2. `CreateSessionModal` describes defaults in info text (lines 65-66, 270-276) but has **no input to override at creation**. User cannot set effort at spawn; only adjust post-spawn via ContextBar or (post-M8) SessionCard.

Both gaps are real user-facing friction. Neither is load-bearing for migration COMPLETE status — the migration brief's minimum bar (§4 "visible effort level per session" + "adjustment affordance") is technically met by the existing ContextBar dropdown. But the SessionCard gap specifically is Jose-observable-pain-adjacent: adjusting effort mid-run requires two clicks (open session → open dropdown) instead of one (click badge on card).

---

## Ratified scope this rotation

**Primary (required):** SessionCard click-to-adjust. Convert the display-only effort badge at `SessionCard.tsx:347-362` into an interactive control. Click opens a dropdown with the 5 effort levels (`low | medium | high | xhigh | max`). Selection dispatches through the existing `changeEffort()` flow — either by lifting/extracting that helper or by duplicating the one-line API call.

**Secondary (optional, separate commit):** CreateSessionModal effort override. Add a selector in `CreateSessionModal.tsx` letting the user pick a non-default effort at session creation. Pipe the chosen value into the spawn payload so `session.service.ts`'s effort injection uses the override instead of the persona default.

If time/context only supports Primary, SHIP Primary and log Secondary as a follow-up candidate.

**Explicitly out of scope this rotation:**
- Bulk adjustment ("set all Coders to high for this batch") — nice-to-have per migration brief, not daily-driver friction.
- Effort-change history per session — cool but no observable-pain case.
- "Default vs explicitly adjusted" visibility badge — polish.
- Refactor of ContextBar's effort dropdown code — it works; don't touch unless Primary's dropdown shares code cleanly.
- Any server-side changes (defaults, API, WS event, DB schema) — fully wired already.

---

## Implementation guidance (contract-level, not prescriptive)

**Primary — SessionCard click-to-adjust:**

- Lift or duplicate `ContextBar.tsx:313-324`'s `changeEffort()` helper. Lifting is cleaner but touches ContextBar.tsx — if the lift stays within a shared utility file and leaves ContextBar's behavior untouched, ship the lift. If extracting introduces risk to ContextBar's working dropdown, duplicate instead and log the duplication as tech debt for a later consolidation rotation.
- Match the visual pattern of ContextBar's dropdown — same menu layout, same option ordering, same accent color palette — so users don't perceive two different adjust UIs. Reuse whatever dropdown primitive ContextBar uses (probably a `Menu` or `Popover` component).
- Click target on SessionCard's effort pill should be unambiguous. The pill is small; consider expanding the clickable hit area without changing visual size (CSS `padding` + `inset` pattern, or wrap the pill in a bigger clickable span).
- Post-click: dropdown opens, user selects level, dropdown closes, `changeEffort()` fires, optimistic visual update on the badge (show new level immediately), WS `session:updated` event confirms and settles final state.

**Secondary — CreateSessionModal override:**

- Add an effort selector alongside the existing session-type selector. Default = persona default for the chosen session type (pm→high, coder→medium, raw→medium). Label: "Effort level (override default)".
- Pipe the chosen value through the create-session payload. Server-side, if the payload carries an effort override, `session.service.ts`'s effort injection uses the override. If not, current behavior holds (persona default).
- Do NOT modify `SESSION_TYPE_EFFORT_DEFAULTS` or any constant. Override is payload-level only.

---

## File boundaries

Touch:
- `client/src/components/sessions/SessionCard.tsx` — Primary affordance.
- New shared dropdown helper OR duplicate `changeEffort()` — per Implementation Guidance.
- `client/src/components/session/CreateSessionModal.tsx` (verify exact path) — Secondary, optional.
- `server/src/services/session.service.ts` — ONLY IF Secondary ships and needs payload override plumbing. Single-field addition, not a refactor.
- Test files under `client/src/components/sessions/__tests__/` or equivalent.

Do NOT touch:
- `ContextBar.tsx` dropdown logic (it works; do not risk the working effort UI in the chat view).
- `session.routes.ts` API endpoints.
- WS event flow.
- `SESSION_TYPE_EFFORT_DEFAULTS` constants.
- Any 15.3-thread surface (`isSessionWorking`, `resolveActionLabel`, `useSessionStateUpdatedAt`, `usePromptDetection`).
- Any M5/M7 migration work.
- `session.status` pane-classifier logic.
- Any file touched by the 3 commits on top of `c34b278` (`d3c5c5a`, `848e481`, `c3c97d0`).

---

## Tests

Minimum test set — user-observable DOM contract per OS §20.LL-L10:

**Primary tests:**
1. SessionCard renders effort badge with current `session.effortLevel` value (non-regression of existing display).
2. Click on badge opens a dropdown with the 5 effort levels visible in the DOM.
3. Selecting a level triggers a POST to `/sessions/:id/command` with body `{ command: "/effort <level>" }`. Mock API; assert call shape.
4. After successful response, badge visually reflects the new level (optimistic update + settle on WS event).
5. Non-regression: ContextBar's existing effort dropdown still works unchanged (if the Primary lift touched shared code, this guards against cross-surface breakage).

**Secondary tests (if shipped):**
6. CreateSessionModal renders effort selector with correct default per session type.
7. Changing session type resets effort selector to the new type's default (pm→high, etc.).
8. Submitting with an override passes the override through the create payload.

Run `pnpm test` + `pnpm typecheck`. Target: current 326 baseline + N new tests, all pass, typecheck clean.

---

## Commit discipline

**One commit for Primary. Optional second commit for Secondary.** Do NOT bundle. Reversibility per sub-feature.

Primary commit message: `feat(ui): M8 — click-to-adjust effort on SessionCard`. Body explains the narrow scope, what Primary covers, what's deferred.

Secondary commit message (if shipped): `feat(ui): M8 — effort override selector in CreateSessionModal`.

---

## Self-dogfood gate

**In your own Commander session, during this rotation:**
- You'll see your own session card in Jose's sidebar.
- After the Primary fix lands and the dev server picks up the change (Vite HMR — if unreliable per `feedback_vite_stale_code`, restart), Jose should be able to click YOUR session card's effort pill and change your effort level from the sidebar.
- If Jose screenshots the interaction and it works — click on pill → dropdown opens → select level → badge updates → your own `/effort` applied — ship accepted. If the click does nothing, the dropdown doesn't open, or the badge doesn't update, ship rejected.

This is the cheapest acceptance gate available. M8 is low-stakes per CTO framing; use the self-dogfood surface.

---

## Acceptance + rejection gate

Jose's browser smoke against the 3 observable behaviors:
1. SessionCard effort badge is clickable; click opens dropdown.
2. Selecting a level updates the badge visually AND sends the `/effort` command AND persists (refresh the page → new effort still shown).
3. ContextBar's existing effort dropdown (inside chat view) still works — non-regression.

If any of those fail, targeted revert of the Primary commit, investigate per `standards/INVESTIGATION_DISCIPLINE.md`. Do NOT speculative-fix.

Rejection triggers (any one rejects):
(a) Files outside boundary touched.
(b) ContextBar effort dropdown or `changeEffort()` behavior changed (non-regression broken).
(c) Server-side changes not scoped to the optional Secondary payload plumbing.
(d) Tests frame to internal function returns instead of user-observable DOM/network contract.
(e) Ship claimed green without explicit "awaiting Jose browser smoke" declaration.

---

## Post-M8 sequencing

Per Commander CTO's locked sequence (ratified 2026-04-20): M8 ships green → M7 MVP dispatch fires (split-view-aware live STATE.md pane) → post-M7 Codeman-model migration (resolves Candidates 23 + 32 + 33 jointly).

---

## Standing reminders

M8 is also the **shakedown of the new investigation discipline** on a low-stakes target. If anything goes unexpected, do NOT fix-forward. Instrument per `standards/INVESTIGATION_DISCIPLINE.md`, capture evidence, diagnose, then fix. This is the first rotation where the new OS §20.LL-L11/L12 + standards file apply — use them.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own SessionCard is the smoke target.
Per `feedback_vite_stale_code`: if HMR is unreliable, restart the dev server.
Per OS §20.LL-L10: unit-green is zero acceptance signal. Jose's click is the acceptance.

Go.
