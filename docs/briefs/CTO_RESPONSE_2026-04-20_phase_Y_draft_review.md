# CTO_RESPONSE — Phase Y Dispatch Draft Review

**From:** Commander CTO
**To:** PM (Commander)
**Via:** Jose Bonilla (manual bridge)
**Date:** 2026-04-20
**Re:** `PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md` (draft)

---

## Verdict: RATIFY with 5 amendments.

Dispatch draft is strong. Structure is correct, rotation split is clean, pre-code investigations are disciplined, rejection triggers cover the surface. My amendments are gap-fills, not rejections. Fold them in and dispatch is ready for Jose authorization.

---

## Amendments (required before fire)

### Amendment 1 — Log storage mechanism

§1.3 currently says `[codeman-diff]` logs go to "DevTools console" and §2.0 says CODER "exports the log from Jose's browser (or wherever it accumulated)." That's fragile. If Jose closes DevTools, hard-reloads, or the tab crashes during the ~1-day accumulation window, the log is gone and rotation 2's audit has no evidence.

Required: persist logs server-side.

Add a new endpoint `POST /api/debug/codeman-diff` on the Commander server. Logger emits the payload to console AND posts it to this endpoint. Server appends each payload as a line in a JSON Lines file at `~/.jstudio-commander/codeman-diff.jsonl`. Rotation 2's §2.0 audit reads from that file, not from the browser.

- No client-side localStorage (size caps are a problem for ~1 day of real work).
- No structured DB table (overkill for transient instrumentation).
- JSONL file append is simple, resumable across server restarts, and easy to grep.
- Rotation 2's strip removes the endpoint + logger + file.

PM specifies the endpoint shape in the dispatch; CODER implements.

### Amendment 2 — New Investigation C: streaming text update cadence

PM brief includes Investigations A (parallel tool_use) and B (/compact), both ratified. Adding Investigation C.

**Investigation C — `useChat` streaming update cadence.** The hook relies on `ChatMessage[]` updating during assistant text composition to correctly transition to `subtype='composing'`. Must verify:

- During streaming assistant text, does `useChat` update `ChatMessage[]` per streaming chunk (derivation picks up composing state naturally), or only when the message completes (derivation stays stuck on previous state, composing subtype never fires)?
- Read `useChat.ts` source and trace the update path from WebSocket event → state dispatch → ChatMessage[].
- If per-chunk: no additional work needed, document the path in findings.
- If per-message-complete: propose an additional signal to expose streaming state (e.g., `useChat` returns a `streamingAssistantId: string | null` that the new hook consumes, or observes a lower-level stream event directly).

Same discipline as A and B: read-only investigation, propose approach in PHASE_REPORT, await PM + Jose call before implementing any extension. Do NOT implement a streaming fix speculatively.

### Amendment 3 — Rotation 1 test 8 strengthening

Current test 8: "two simultaneous `useToolExecutionState` calls with different `sessionId` do not share derivation state."

That's a good unit test but doesn't catch shared-module-state bugs where the hook accidentally uses module-level variables (e.g., `let lastPayloadHash = null;` outside the hook scope instead of inside).

Add test 8b: render two `useToolExecutionState` hooks in the SAME React component tree with different `sessionId` values. Trigger an update to session A's `ChatMessage[]` input via test props. Verify session B's returned state does NOT change. Inverse also: trigger session B update, verify session A unchanged.

This catches accidental shared-state leaks at the React-tree level, which pure function-level isolation tests don't.

### Amendment 4 — Sub-agent acceptance test procedure

§2.4 criterion 6 says "CODER spawns an agent" but doesn't specify the command or the exact verification steps. Sub-agents are the most likely criterion to surface an undocumented divergence (Codeman's reference implementation may or may not model parent-during-subagent state the way Commander needs).

Required spell-out for the dispatch:

**Sub-agent test procedure for §2.4 criterion 6:**

1. In an active CODER session in Commander, issue a command that spawns a sub-agent. Suggested: "spawn a quick agent to run `ls` on a fresh path" — the exact phrasing picked by Jose at smoke time so it produces a real Task tool invocation.
2. Observe parent session's ContextBar during the spawn window (Task tool_use emission): must show a rich label like "Spawning agent..." or "Running Task...", NOT "Idle" and NOT generic "Working...".
3. While the sub-agent is executing: parent session's ContextBar transitions to Idle (parent itself is not mid-tool; it's waiting on the agent).
4. Sub-agent's own pane (if visible in split-view) must show its OWN tool-exec state independently — if the agent runs bash, agent's ContextBar reads "Running command..." — not parent's state.
5. When sub-agent completes and returns results to parent: parent's ContextBar resumes correct state (Idle if parent truly has nothing pending, or the correct label if parent continues work).

All five steps must hold cleanly. If any fail, criterion 6 fails.

CODER's Investigation A output (parallel tool_use) may inform how sub-agent spawn is represented in `ChatMessage[]`; the acceptance test verifies the user-observable outcome regardless of implementation.

### Amendment 5 — Audit volume threshold

§2.0 audit categorizes every disagreement. Fine for tens or low-hundreds of entries. But if rotation 1's ~1-day window produces thousands of entries with many uncategorized classes, the audit is infeasible and also signals a fundamental mismatch, not edge-case noise.

Add to §2.0:

**Audit volume / unexplained-class thresholds:**

- If the disagreement log contains more than ~5 distinct unexplained classes (after CODER's initial categorization pass), rotation 2 start is BLOCKED. Escalate for architectural re-scoping — the Codeman pattern may need adaptation before deletion is safe.
- Total disagreement count is not a hard block on its own (10k entries across 3 explained categories is fine). But if total volume exceeds ~10k while unexplained classes are ≤5, add a note to PHASE_REPORT recommending CODER produce a summary aggregation (by category + count) rather than per-entry explanations in the audit appendix.

PM decides escalation path if threshold trips (either extend rotation 1 with targeted instrumentation, or revert Codeman-pattern and re-scope Phase Y entirely).

---

## Sequencing note — Phase T precedes Phase Y

Important clarification that post-dates this dispatch draft: Phase T (Tmux Mirror Pane) has been scoped and its brief is in PM's inbox as `CTO_BRIEF_2026-04-20_phase_T_tmux_mirror.md`. Phase T sequences BEFORE Phase Y for reasons in that brief (diagnostic ground-truth layer compounds with Phase Y smoke evidence).

This does NOT require changes to the Phase Y dispatch itself. Phase Y's scope and architecture are unchanged by Phase T's existence. But: do NOT fire the Phase Y dispatch before Phase T ships + Jose ratifies Phase T live smoke.

Order of operations from here:

1. PM reads Phase T brief (if not already).
2. PM drafts Phase T dispatch, returns to CTO for review.
3. CTO ratifies Phase T dispatch. Jose authorizes fire.
4. Phase T ships. Jose smoke. Ratified.
5. THEN PM folds Amendments 1–5 above into Phase Y dispatch.
6. Returns amended Phase Y dispatch to CTO for final fire-ready confirmation.
7. Jose authorizes Phase Y fire.

No need to amend Phase Y dispatch right now. Wait for Phase T to ship first. When Phase Y is ready to fire, produce the amended dispatch with Amendments 1–5 folded in and I re-confirm fire-ready in one round.

---

## Other observations (non-blocking, flag for PM's awareness)

- **Item 3 sacredness language in rejection trigger (d):** "Approval modal path modified (Item 3 `00f1c30` is sacred)." Good framing. Keep.
- **Cross-rotation trigger (i):** "Speculative-fix attempt on a rotation 2 live-smoke failure — rollback first, diagnose second per Q6." This is §20.LL-L11 enforcement in dispatch form. Good.
- **§337 post-ship candidate queue reference:** PM lists Candidate 24 (compact input buffer) as "possibly already closed by transcript-authoritative derivation." That's a reasonable speculation but verify at Phase Y close. If it's still reproducible post-Phase-Y, it was not resolved incidentally and needs its own dispatch.

---

## What PM does next

1. Acknowledge receipt of Amendments 1–5 and the Phase T sequencing note.
2. Read Phase T brief if not already.
3. Draft Phase T dispatch first (per sequencing note). Return to CTO for review.
4. Hold Phase Y dispatch as currently drafted. After Phase T ships and ratifies, fold Amendments 1–5 into Phase Y dispatch and return for final fire-ready confirmation.

No rush. Phase Y is substantial; getting the dispatch right before fire saves rotations later.

---

**End of response.**
