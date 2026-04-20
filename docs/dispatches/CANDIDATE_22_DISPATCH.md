# Candidate 22 Dispatch — Plan widget false-positive from markdown shape

**From:** PM (Commander, 2026-04-20)
**To:** CODER (continuing context from Tier A)
**Type:** CODE ROTATION — remove markdown-shape Plan detection, keep structured-signal Plan path intact.
**Priority:** P1 interrupt — Jose-authorized pivot. Tier A smoke results parked pending this fix.

---

## The bug (short)

Commander's chat renders a fake Plan widget whenever an assistant text block contains three or more numbered-list lines. Source: `client/src/utils/text-renderer.tsx`, function `splitSegments()` (roughly lines 18–107, plan-extraction branch at 42–104, regex `NUMBERED_LIST_RE = /^(\d+)\.\s+/` at line 9, threshold at line 81 `planItems.length >= 3`).

This is pure markdown-shape matching. It conflates display shape with authoritative source. Every numbered list in PM / CODER / CTO responses trips it. Q&A enumerations, comparison lists, step-by-step protocols, completion checklists all render as Plans.

The correct Plan source already exists and already works. It lives in `client/src/utils/plans.ts`, `buildPlanFromMessages()`, which reads `tool_use.name === 'TaskCreate'` events and feeds `StickyPlanWidget` via `ChatPage.tsx:590`. That path stays. This dispatch only removes the markdown-shape false-positive path.

---

## Fix shape (locked)

Remove the plan-extraction branch from `splitSegments()` in `client/src/utils/text-renderer.tsx`. Keep every other responsibility the function has (code-block segmentation, whatever other text split logic it performs). Delete the `NUMBERED_LIST_RE` constant if unused after. Remove the `AgentPlan` import from `text-renderer.tsx` if unused after. Remove the `itemsToTasks()` helper if it is exclusively called from the removed branch — otherwise leave it.

Inline `AgentPlan` render inside `renderTextContent()` (around line 180–201 per exploration report): remove the branch that mounts `AgentPlan` from markdown-detected plan items. `AgentPlan` as a component can stay in the codebase if it is still consumed by `StickyPlanWidget` or any other authoritative-path caller — verify before deleting it.

Before patching, verify in your own read that no other caller of `splitSegments()` depends on the plan-extraction branch's return shape. If `splitSegments()` returns a discriminated union where one variant is `{ type: 'plan', items }`, either delete that variant (and update every switch/match on it) or stop producing it (preferred — less downstream churn).

---

## Non-regression contract

Two things MUST still work after the fix.

First, the real Plan widget — `StickyPlanWidget` mounted by `ChatPage.tsx:590` via `getActivePlan()` reading `tool_use.name === 'TaskCreate'` events — must still render when a real TaskCreate fires. Confirm by reading `plans.ts::buildPlanFromMessages()` to verify its pipeline is untouched and by grep'ing for any coupling between `text-renderer.tsx` and `plans.ts`. There should be none.

Second, `text-renderer.tsx`'s other text-segmentation responsibilities must continue to work. If the function currently splits prose from fenced code blocks, that still works. If it handles any other inline render decision, that still works. Only the numbered-list-to-Plan branch is removed.

---

## Tests

Add a new test file under `client/src/utils/__tests__/text-renderer-candidate-22.test.ts`. Minimum three cases.

One, given an assistant text block containing five numbered list lines (for example "1. foo\n2. bar\n3. baz\n4. quux\n5. corge"), the rendered DOM must not contain any `AgentPlan` element. Assert on the DOM, not on the function's return value.

Two, given a short assistant text block with one to two numbered items, same assertion — still no AgentPlan (pre-fix also honored this via the 3-item threshold, but pin the behavior post-fix anyway).

Three, given an assistant message containing a real `tool_use.name === 'TaskCreate'` block (structured), the test verifies `StickyPlanWidget` DOES mount via the `plans.ts` path. This is a non-regression guard for the correct Plan path. If mocking the full render tree is too heavy, assert at the `getActivePlan()` return value level instead — acceptable hygiene deviation given the correct path is not the surface under change.

---

## File boundaries (strict)

Touch only:

`client/src/utils/text-renderer.tsx` — primary surface.

`client/src/utils/__tests__/text-renderer-candidate-22.test.ts` — new test file.

Do NOT touch:

`client/src/utils/plans.ts` — correct Plan path, works, no change needed.

`client/src/components/chat/StickyPlanWidget.tsx` — correct consumer, works.

`client/src/components/chat/AgentPlan.tsx` (or wherever AgentPlan is defined) — if it remains consumed by a valid caller post-fix, leave it alone.

`ChatPage.tsx`, `ChatThread.tsx`, `AssistantMessage.tsx`, `ContextBar.tsx`, `usePromptDetection.ts` — none of these are in scope for this rotation.

Any server file — none in scope.

If the fix requires touching a file outside this boundary to avoid a type error or a downstream break, STOP and ping PM with a one-sentence MINOR/MAJOR classification. Do not silently expand.

---

## Commit discipline

Single commit is acceptable for this rotation — surface is small and cohesive. Commit message: `fix(ui): Candidate 22 — remove markdown-shape Plan detection, preserve TaskCreate structured path`.

If the cleanup turns out to require an unrelated import/helper deletion that is scope-adjacent but not strictly part of the core fix, a second optional test-only commit is acceptable.

---

## Self-dogfood gate

This bug is trivially self-verifiable. After the fix lands and the dev server picks up the build, any text message from PM / CODER / CTO containing a numbered list must render as plain prose with numbers, NOT as a Plan widget chip. Jose will eyeball this immediately. If his next PM message still shows a fake Plan, ship is rejected.

---

## PHASE_REPORT requirements

Commit SHA. File diff summary (lines added/removed in `text-renderer.tsx` plus test file). Confirmation that `plans.ts` and `StickyPlanWidget.tsx` were not touched. Confirmation that the non-regression test for the `TaskCreate` path passes. Explicit "awaiting Jose visual verification" gate — no ship-green claim.

---

## Sequencing after this ships

Jose eyeballs the next PM message. If numbered lists render as prose with no fake Plan chip, visual-verified green. Then we return to Tier A smoke diagnosis — why did Items 1 and 3 not move the needle live despite clean commits, green tests, correct source changes. That is an INVESTIGATION rotation, not another fix rotation. See `feedback_understand_before_patching.md`.

If this ship introduces any new breakage (a real TaskCreate Plan fails to mount, a text message renders incorrectly), targeted revert of the single commit.

---

## Standing reminders

Structured signal over pane/shape signal (§24). Tests-to-user-observable-DOM, not internal returns (§20.LL-L10). Jose's visual verification is authoritative; unit-green is a checkpoint only.

Go.
