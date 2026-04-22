# Phase Y Rotation 1.6.B — Composing Under-Fire + Poll-Cadence Hotfix

**From:** PM (Commander, 2026-04-21)
**To:** CODER (continuing 1.6 instrumentation CODER is ideal; fresh spawn acceptable)
**Type:** FIX ROTATION, evidence-driven per 1.6 diagnostic. Single commit, ~3 fix surfaces, tests required.
**Preceded by:** Rotation 1.6 instrumentation `[phase-y-1.6-instr]` capture at `docs/phase-y-rotation-1-6-diagnostic.md`. Diagnostic reinterpreted Class 1 as **under-fire composing** (not stuck) — mechanism: server `session.status` stays idle during real streaming, useChat poll drops to 5s idle cadence, most Claude streaming happens between polls, Fix C reconciler rarely sees sustained tail, composing flashes 1-3s at turn-end instead of throughout streaming.
**Status:** Jose-authorized + live-terminal-empty loose-end resolved (wifi, not mechanism).

---

## §1 — What 1.6 proved

Per diagnostic:
- **Fix B works.** D3+D4 evidence shows `resolveActionLabelForParallelRun` correctly suppresses legacy leak; Class 2 = 182 is parallel-run divergence AS DESIGNED, not a UI regression.
- **Fix C expiry works.** 3s stability timer fires correctly when it gets to run.
- **Fix C fire-rate is WRONG.** Server `session.status='idle'` during real streaming means useChat poll cadence drops to 5s → most `messages` reference changes happen between polls → reconciler never sees streaming content long enough to arm composing across the real-streaming window.
- **PM audit's 185s + 162s "Class 1 stuck" runs were TRUE long-streaming turns.** Codeman reporting composing throughout was correct; legacy pane-classifier lagged. These are NOT bugs.
- **Jose's 150s Live-Terminal empty = wifi, not mechanism.** Ruled out Candidate 36 display-layer for this class.

---

## §2 — Scope

### Fix D — Role-stability predicate on Fix C composing branch

**Location:** `client/src/hooks/useToolExecutionState.ts:215-226` (composing detection) + `client/src/hooks/useChat.ts:274-308` (stability timer reconciler).

**Current behavior:** composing fires when `tail.role === 'assistant'` AND `lastBlock.type === 'text'` AND `streamingAssistantId === last.id`. Stability timer flips streamingAssistantId null after 3s of no-content-change. Composing only terminates via (c) the 3s timer — (a) tail-role-change-away and (b) turn-end are not explicit predicates.

**Fix:** add role-stability predicate that terminates composing on ANY of:
- (a) tail `id` changes to a non-assistant message (user turn arrives)
- (b) tail blocks transition from text → tool_use / tool_result / compact (turn advanced)
- (c) 3s elapsed without content change (existing)

Implementation direction: in `useChat.ts` reconciler, the clearTimerAndReset branches at `:284` and `:289` already clear streamingAssistantId immediately when tail is non-assistant or non-text — so (a) and (b) should already work in theory. **Diagnostic must cite whether the reconciler actually fires on those transitions or whether a stale snapshot holds.** If the reconciler's dependency array `[messages]` doesn't trigger on role-transition (e.g., reference-equality false negative), add an explicit tail-signature predicate: `(tail.id, tail.role, lastBlock?.type)` tuple tracked per-reconciliation; any tuple change forces immediate clear + re-arm.

No scope bleed into the derivation itself — Fix D lives in the reconciler. Derivation (`useToolExecutionState.ts`) stays pure.

### Fix E — Poll-cadence gate widened for user-sent window

**Location:** `client/src/hooks/useChat.ts` poll useEffect (around `:256`, pollInterval selection logic).

**Current behavior:** active pollInterval (~1.5s) engages only when `sessionStatus === 'working'`. Idle status → 5s pollInterval. Server classifier lag → idle during real streaming → poll misses content changes.

**Fix:** include `userJustSent` as an active-poll trigger for 30s post-send. During that window, poll at the active cadence regardless of `sessionStatus`. After the window, revert to status-driven cadence.

Implementation direction:
- `userJustSent` is already threaded through ChatPage → ContextBar; surface it to useChat or compute a local equivalent via timestamp-of-last-user-send tracked in a ref.
- 30s window: `const ACTIVE_AFTER_SEND_MS = 30_000;` at module level. Predicate: `Date.now() - lastUserSendTs < ACTIVE_AFTER_SEND_MS`.
- Exact wire: easiest is adding `lastUserSendTs: number | null` param to `useChat(sessionId, lastUserSendTs)` — ChatPage bumps on every submit. Alternative: useChat exposes `bumpUserSend()` callback that ChatPage calls on submit. CODER choose; no second-order changes to other consumers.

**Do NOT** change the poll's STOPPED-session path or dedupe/ref-stability logic — Fix E is a narrow predicate widening on the active/idle cadence branch only.

### Scope — out

- **Do NOT modify** `resolveEffectiveStatus`, `resolveActionLabelForParallelRun`, `useCodemanDiffLogger`, `debug.routes.ts`, JSONL, 15.3-arc legacy guards, Item 3 `usePromptDetection`, M7/M8/Phase T surfaces, server files.
- **Do NOT renumber** Candidates logged by CODER — PM will handle as Candidate 40 (unmapped system subtypes) + Candidate 41 (pendingLocal not cleaned at turn-end). Log reference only; do not fix in this rotation.
- **Do NOT touch** Candidate 36 surfaces (TmuxMirror / status-poller / tmux.service). D5/D6 has its own future dispatch.
- **Do NOT touch** Candidate 39 surface (ChatThread scroll-anchor). Separate dispatch post-1.6.B.

---

## §3 — Tests (minimum 6 new, must all pass)

Fix D tests (useChat reconciler + composing derivation):
1. **Role-transition assistant-text → user** terminates streamingAssistantId immediately (not via 3s timer). Assert `streamingAssistantId === null` after one reconciliation pass with tail.role flipping.
2. **Block-transition assistant-text → assistant-tool_use** terminates streamingAssistantId immediately. Same shape as (1) but within same assistant message (tail.id unchanged, lastBlock type flipped).
3. **Sustained assistant-text growth** keeps streamingAssistantId === tail.id through N reconciliations within 3s window. Sanity / non-regression.

Fix E tests (poll cadence):
4. **userJustSent window opens active poll** regardless of sessionStatus. Mock session.status='idle', bump lastUserSendTs, assert pollInterval === active cadence for 30s.
5. **userJustSent window expires** — at 30.001s post-send, pollInterval reverts to status-driven value.
6. **sessionStatus='working' overrides idle+no-send** — non-regression path still active-polls on working.

Test file: extend `client/src/hooks/useChat.test.ts` (or create `phase-y-rotation-1-6b-hotfix.test.ts` matching 1.5 naming). Suite 411 → 417+, typecheck clean across all three packages.

---

## §4 — Acceptance

**Jose browser smoke (after ship):**

1. Start a session, submit a prompt that triggers a long streaming response (~30-60s of pure text). Observe ContextBar label: should show "Composing response..." CONTINUOUSLY throughout the stream, not just a 1-3s flash at turn-end. (Closes original "53s delayed composing flash" observation.)
2. Submit a prompt that triggers a tool_use turn (e.g. Read or Bash). Observe: composing briefly (if any), then tool label ("Running command...") through tool_exec, then idle. Non-regression.
3. Submit a prompt, wait 45s, submit another. First prompt's active-poll window (30s) has expired by the time the second submit fires; second submit's window opens cleanly. Verify via DevTools Network tab the poll cadence shift.
4. Non-regression sweep — all five Rotation 1.5 hotfix cases (Fix A / Fix B / Item 3 / waiting-passthrough / legacy-fallback) still green.
5. JSONL audit (~1h post-ship): Class 1 count should drop substantially — composing entries should correlate with TRUE streaming windows only, not represent under-fire "flashes" at turn-end.

**Ship NOT claimed green until Jose completes smoke + confirms Case 1 especially.**

---

## §5 — Rejection triggers

(a) Fix outside Fix D + Fix E scope (specifically: do not touch `resolveEffectiveStatus`, `resolveActionLabelForParallelRun`, or the derivation's pure logic — all 1.5 surfaces stay byte-identical where not cited).
(b) Server-side changes — this is client-only.
(c) `sessionStatus === 'waiting'` passthrough broken — Item 3 `00f1c30` approval-modal path must survive. Pin with non-regression test if not already present.
(d) Any fix to Candidates 39/40/41 surfaces in this rotation.
(e) Phase Y `[codeman-diff]` logger modified or JSONL touched.
(f) Fewer than 6 new tests; any test failing.
(g) Ship-green claim without Jose Case 1 smoke declaration.
(h) `ACTIVE_AFTER_SEND_MS` constant value bikeshedded — 30s per dispatch; if CODER finds evidence warranting different window, flag as MINOR deviation in PHASE_REPORT, don't bikeshed silently.

---

## §6 — Commit discipline

Single commit: `fix(ui): Phase Y Rotation 1.6.B — composing role-stability + poll-cadence gate`. Body cites diagnostic `docs/phase-y-rotation-1-6-diagnostic.md` for mechanism, enumerates Fix D + Fix E + 6 new tests. Reversible via `git revert`.

---

## §7 — Post-1.6.B sequencing

After 1.6.B ships green:
- ~1-day Jose live-use window + fresh JSONL accumulation (keep `[codeman-diff]` logger alive for one more audit cycle — this is still Phase Y parallel-run).
- PM JSONL audit — target: Class 1 near-zero, Class 2 still ~reported but UI-suppressed (as designed).
- If audit clean → **Rotation 2 deletion dispatch** (remove `[codeman-diff]` logger, debug.routes.ts, JSONL file, ALL 15.3-arc legacy guards, Fix B's parallel-run fallback — codeman becomes sole source of truth).
- If audit shows new/residual class → follow-on 1.7 instrumentation rotation (investigation-first stays canon).

Candidate 36 D5/D6 mirror-display rotation can fire IN PARALLEL with 1.6.B if CODER team has bandwidth for a second CODER session. Otherwise queue serially after 1.6.B close.

---

## §8 — Standing reminders

Per `feedback_understand_before_patching`: 1.6 diagnostic earned this fix. 1.6.B is evidence-backed, not speculative.

Per OS §20.LL-L12: my own audit was WRONG about the Class 1 mechanism. CODER's D1-D4 capture corrected it. Diagnostic documents are hypotheses until live-captured. Log this as a reinforcement case, not a failure.

Per `feedback_self_dogfood_applies_to_status_fixes`: Jose's long-streaming smoke (Case 1) is the acceptance — unit-green is zero signal.

Per `feedback_vite_stale_code`: cold-restart dev server before smoke.

Go.
