# Phase Y Rotation 1.7 — Closeout Follow-up (conservative fallback + tool chip audit + liveThinking narrowing)

**From:** PM (Commander, 2026-04-21)
**To:** CODER (1.6 / 1.6.B CODER preferred for continuity; fresh spawn acceptable)
**Type:** CLIENT-ONLY CLOSEOUT rotation per `docs/phase-y-closeout.md` (commit `93312e4`). Single commit. Three narrow conservative fixes, each bounded. ~45-60 min scope.
**Preceded by:** Phase Y closeout report ratified. 1.6.B `afb6964` stays in place. 1.6.C canceled. Web-based transcript-authoritative real-time status acknowledged as architecturally unachievable; deferred to native rebuild phase per `project_native_rebuild_final_phase` memory.
**Status:** Jose-authorized pivot. Scope locked by closeout §5.

---

## §1 — Architectural posture (binding context for scope discipline)

Chat window = **semantic summary**. Live Terminal (Phase T mirror) = **ground truth**. Native rebuild = correct arch for real-time. 1.7 does NOT attempt to close the real-time gap — it closes three specific observable bugs that land inside the "semantic summary" bucket.

**Do NOT propose or implement:**
- Server-side instrumentation of JSONL emission timing.
- Changes to `useChat`'s poll cadence, reconciler, or composing derivation (1.6.B is frozen).
- Changes to 15.3-arc legacy guards (stay until Rotation 2 if ever revisited).
- Any attempt to make `composing` subtype fire continuously across long streams.

---

## §2 — Fix 1.7.A — "Working..." fallback when userJustSent && no-recent-assistant

**Location:** `client/src/utils/contextBarAction.ts` + `client/src/components/chat/ContextBar.tsx`.

**Contract:**
- New constant `WORKING_FALLBACK_MS = 5_000` (configurable via module-level).
- New failsafe ceiling `WORKING_FALLBACK_CEILING_MS = 90_000`.
- New pure helper in `contextBarAction.ts`: `shouldEngageWorkingFallback({ userJustSent, lastUserSendTs, lastAssistantBlockTs, nowMs })` → boolean.
  - TRUE when: `userJustSent === true` AND `(nowMs - lastAssistantBlockTs) > WORKING_FALLBACK_MS` AND `(nowMs - lastUserSendTs) < WORKING_FALLBACK_CEILING_MS`.
  - FALSE otherwise.
- ContextBar wire: when the helper returns TRUE AND the existing `effectiveStatus` chain would have returned `'idle'`, upgrade to `'working'` with `actionLabel='Working...'`.
- **Precedence invariant (LOAD-BEARING):** `sessionStatus === 'waiting'` passthrough at the TOP of `resolveEffectiveStatus` is NOT shadowed by the fallback. The fallback only upgrades an `idle` verdict, never a `waiting` one. Item 3 `00f1c30` approval-modal path preserved.
- **Expiry (dual-path):** fallback disengages when either (a) an assistant tool_use / text / thinking block appears in `messages` (derivation takes over with a concrete label), OR (b) `WORKING_FALLBACK_CEILING_MS` (90s) elapses since last user send without any assistant signal (failsafe — do NOT let fallback stick forever).

**Implementation direction (CODER may adjust if justified):**
- `lastAssistantBlockTs` — scan `messages` for the most recent assistant message's timestamp. If no assistant message in the session, use session-start or 0.
- `lastUserSendTs` — same signal Fix E added in 1.6.B. Reuse via `mostRecentUserMessageAt(messages)` helper.
- Do NOT add new state; derive from `messages` each render. Cheap scan (tail window).
- Keep helper pure — no `Date.now()` inside; caller passes `nowMs` for testability.

### Fix 1.7.A tests (minimum 5)

1. **Fallback engages** when userJustSent=true + last assistant block 6s ago + user send 3s ago → returns TRUE.
2. **Fallback NOT engaged** when assistant block 2s ago (within 5s window) → returns FALSE.
3. **Fallback expires at 90s ceiling** when user send 91s ago and no assistant since → returns FALSE.
4. **Waiting passthrough NOT shadowed** — when `sessionStatus==='waiting'`, effectiveStatus stays 'waiting' regardless of fallback verdict (pin via integration-style test on resolveEffectiveStatus + fallback together).
5. **Concrete assistant signal preempts fallback** — when derivation returns a concrete codeman state (tool_exec or composing), fallback does NOT override; concrete label wins.

---

## §3 — Fix 1.7.B — Tool chip rendering audit

**Location:** `client/src/components/chat/ChatThread.tsx` + ancillary renderers.

**Contract:** audit-and-fix, not blind refactor. Jose observed during Case 2 smoke: two Read tool chips appeared together at turn-end instead of incrementally.

**Audit protocol:**
1. Read the `tool_use` / `tool_result` rendering path. Confirm rendering is stateless per-message (no batching / debouncing at the render layer).
2. Confirm the path does NOT silently skip rendering tool chips that arrive mid-message-update (e.g., if `messages` array identity changes but message content is appended, does every chip re-render or only the newest?).
3. If the audit confirms rendering is sound → the "all at once at end" symptom is upstream (JSONL emission / server watcher-bridge) and **no code change is warranted in 1.7** — document this in the commit body and proceed to 1.7.C.
4. If the audit surfaces a rendering regression (e.g., chip only renders on first encounter, or key-prop instability causes remounts) → fix it narrowly.

**Scope ceiling:** if the audit takes more than ~20 min OR surfaces a regression needing more than ~30 LOC to fix, STOP and flag as Candidate 43 for a separate dispatch. Do NOT expand 1.7.B into a rewrite.

### Fix 1.7.B tests (conditional — minimum 2 IF a rendering regression is fixed; 0 IF audit confirms rendering sound)

- If a regression is fixed: test the specific broken shape + a non-regression test for the happy path.
- If audit confirms sound: document the audit in the commit body, no tests.

---

## §4 — Fix 1.7.C — liveThinking scan narrowing

**Location:** wherever the `LiveActivityRow` extracts `thinking` block content (likely `client/src/components/chat/LiveActivityRow.tsx` or a helper in `client/src/utils/`).

**Contract:**
- Current: scan backward through last assistant message's content for any `thinking` block, render its text.
- Bug (Candidate 42): when Claude emits a `thinking` block AFTER a `text` block within the same message, the backward scan finds the post-text thinking first and bleeds response text into the activity row.
- Fix: narrow scan to thinking blocks that appear BEFORE the last `text` block in the same message. If the last content block is text, thinking text should NOT be rendered in LiveActivityRow — the text block itself is the current surface.

**Implementation direction:**
- Find the last `text` block index in the message's content array.
- Scan backward for `thinking` blocks only up to (exclusive of) that index.
- If no text block exists, scan the full array (current behavior, unchanged).

### Fix 1.7.C tests (minimum 3)

1. **Pre-text thinking surfaces** — message content: [thinking, text] → LiveActivityRow returns thinking content.
2. **Post-text thinking suppressed** — message content: [text, thinking] → LiveActivityRow returns null / empty for thinking.
3. **Thinking-only (no text yet)** — message content: [thinking] → LiveActivityRow returns thinking content (non-regression).

---

## §5 — Tests summary

Minimum total: **5 (1.7.A) + 0-2 (1.7.B conditional) + 3 (1.7.C) = 8-10 new tests**.

Suite current 430 → target 438+. Typecheck clean all three packages.

---

## §6 — File boundaries (strict)

Touch:
- `client/src/utils/contextBarAction.ts` — add Fix 1.7.A helper + constant.
- `client/src/components/chat/ContextBar.tsx` — wire Fix 1.7.A fallback into effectiveStatus + actionLabel chain.
- `client/src/components/chat/ChatThread.tsx` — Fix 1.7.B audit + conditional narrow fix.
- `client/src/components/chat/LiveActivityRow.tsx` (or wherever the thinking-extract helper lives — CODER locate) — Fix 1.7.C scan narrowing.
- Test file(s) under `client/src/utils/__tests__/` matching existing conventions (`phase-y-rotation-1-7-closeout.test.ts`).

Do NOT touch:
- `useChat.ts`, `useToolExecutionState.ts` (1.6.B frozen).
- `useCodemanDiffLogger.ts`, `debug.routes.ts`, JSONL file.
- 15.3-arc legacy guards (typedIdleFreshKillSwitch, lastTurnEndTs, Fix 1/2, Option 2/4, heartbeat-stale, Activity-gap).
- Item 3 `usePromptDetection.ts`.
- M7 / M8 / Phase T / Candidate 36 surfaces.
- Any server file.
- ChatPage.tsx unless strictly required for `userJustSent` / `lastUserSendTs` threading to ContextBar (prefer deriving inside ContextBar from `messages` if possible to avoid prop wiring).

---

## §7 — Acceptance gate (Jose browser smoke)

1. **Case A — "Working..." fallback engages:** submit a pure-text prompt. Within 5-6s observe ContextBar shifts from Idle → "Working..." (generic label). Then later, when the full response arrives at turn-end, status returns to Idle. Fallback visible to the user as "something is happening."
2. **Case B — fallback expires cleanly:** submit a prompt. Wait. When assistant response arrives, the "Working..." fallback is replaced by the final idle verdict within one render. No flicker between "Working..." and the actual assistant block label.
3. **Case C — waiting passthrough preserved:** trigger an approval modal (e.g., Write to an unfamiliar path). ContextBar shows waiting/yellow state. Fallback does NOT override. Item 3 approval path still mounts.
4. **Case D — LiveActivityRow does NOT show response text:** submit a prompt that triggers post-text thinking. LiveActivityRow stays empty or shows pre-text thinking only, never response text bleed.
5. **Case E — tool chips render correctly for observable tool_use:** submit a prompt with tool calls. If chips render incrementally → 1.7.B found no regression. If chips still all appear at end → architectural ceiling (documented, not a 1.7 failure).
6. **Non-regression sweep** — Rotation 1.5 + 1.6.B cases still green (effort dropdown, permission flow, effort effectiveness, activeTeammateCount label).

Ship NOT claimed green until Jose Case A + Case C + Case D all confirmed. Cases B + E are observability-only — report outcome, do not gate on them.

---

## §8 — Rejection triggers

(a) Touching `useChat.ts` / `useToolExecutionState.ts` (1.6.B frozen).
(b) Any attempt to make `composing` fire continuously across long streams (architectural ceiling).
(c) Server-side changes.
(d) Fallback shadowing `sessionStatus === 'waiting'` — Item 3 sacred. Pin with Case C test.
(e) Fallback with no ceiling (infinite stuck "Working..."). `WORKING_FALLBACK_CEILING_MS` must fire.
(f) Fix 1.7.B expanding beyond a ~30 LOC audit fix — must flag Candidate 43 and exit.
(g) `[codeman-diff]` logger or JSONL touched.
(h) Fewer than 8 new tests or any test failing.
(i) Ship-green claim without Jose Case A + C + D smoke.

---

## §9 — Commit discipline

Single commit: `fix(ui): Phase Y Rotation 1.7 closeout — Working fallback + tool chip audit + liveThinking narrowing`.

Body:
- Cite `docs/phase-y-closeout.md` (commit `93312e4`) for architectural posture.
- Enumerate Fix 1.7.A + 1.7.B outcome (audit-only vs narrow fix) + 1.7.C.
- Test count + suite total.
- Declare: 1.6.B `afb6964` frozen, no changes; Phase Y real-time ceiling accepted; native rebuild owns correctness.

---

## §10 — Post-1.7 sequencing (PM plan, for CODER context only — not CODER's scope)

After 1.7 ships green:
1. STATE.md reframe: Phase Y closed. Rotation 2 deletion deferred pragmatically (legacy guards still provide fallback during ClassifierLag; harmless).
2. Small-bug batch rotation: Candidates 38/41 (attachment submit + pendingLocal cleanup) + Candidate 39 (scroll-anchor) + Candidate 27 (synthetic-id reconciliation). Single CODER rotation, ~1.5h.
3. Return to full architectural/migration plan. Native rebuild scoping begins.
4. Candidates 29/30/34/35/36/40 explicitly deferred to native rebuild.

---

## §11 — Standing reminders

Per `feedback_understand_before_patching`: closeout earned this scope. No speculation, no chasing the architectural ceiling.

Per `feedback_defer_nonblocking_bugs_to_native_rebuild`: 1.7 fits the "small + important + low-input" bucket exactly. Anything that doesn't must stop and flag.

Per `feedback_self_dogfood_applies_to_status_fixes`: Jose's own Commander sessions are the Case A/C/D repro surface.

Per `feedback_vite_stale_code`: cold-restart dev server before smoke.

Per OS §20.LL-L12: the Rotation 1.6 diagnostic (instrumentation capture) WAS correct. The closeout interpretation (can't fix in web) is the honest read. Document, pivot, move.

Go.
