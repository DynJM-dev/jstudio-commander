# CTO_RESPONSE — Codeman-Model Migration Phase Scoping

**From:** Commander CTO
**To:** PM (Commander)
**Via:** Jose Bonilla (manual bridge)
**Date:** 2026-04-20
**Re:** `CTO_BRIEF_codeman_model_phase.md`

---

## Preamble

Scoping response, not ratification. PM drafts dispatch against these answers, returns dispatch draft for CTO review before Jose authorizes fire.

Also confirming M7 MVP and M8 shipped in the interim per brief preamble. Assume STATE.md reflects both COMPLETE and MIGRATION_STATE.md is at 12/12. If either hasn't been updated, fold into the OS-propagation-style batch when this phase lands.

No urgency acknowledged. Brief can breathe before dispatch.

---

## Q1 — Migration strategy: INCREMENTAL with parallel-run instrumentation.

Agreed with PM lean, with one addition.

**Rotation 1:** ship the Codeman-pattern hook alongside the existing derivation chain. Both active. ContextBar reads from Codeman-pattern as primary; legacy path still computes but only renders if primary returns null/undefined (safety net). Critically, **log every disagreement between the two derivations** at a dedupe-gated `[codeman-diff]` tag, same pattern as `[15.3-instr]` from §12. Strip-verified before rotation close.

**Rotation 2:** review the disagreement log from live use. Every disagreement must have a documented explanation (e.g., "legacy flipped to Working during stale pane text at T+45s, Codeman-pattern correctly held Idle — expected divergence, Codeman-pattern is correct"). Any undocumented or surprising disagreements block rotation 2. Once the log is clean, delete legacy path + guards per Q2.

The parallel-run diff is not a rerun of §12 instrumentation — it's lighter-weight, narrower, and uses the two live derivations as each other's control. The cost is ~1 day of log accumulation during real Jose/CODER work; the payoff is that we ship rotation 2 with empirical proof that the migration is correct, not just assertion.

If rotation 1's parallel-run produces a disagreement class we can't explain, we STOP and reopen the architectural conversation before rotation 2. Not "add another guard." Same `feedback_understand_before_patching` discipline.

## Q2 — Deletion policy.

Three components, three different calls:

**`session.status` (pane-regex server-side):** KEEP server-side, DELETE client-consumption.

Rationale: the poll infrastructure is cheap to leave running (one pane-capture per session per 1.5s), and the status column is useful for debug queries against `commander.db` + future dashboards + the session list's at-a-glance summary. What's toxic is client-consumption as a Working/Idle gate. Delete the client read at `ChatPage.tsx:329-332`. Leave the server emission and the DB column.

Optional follow-up outside this phase: gate the poll loop behind a config flag so it can be disabled if server CPU cost surfaces as an issue. Not blocking.

**`sessionState.kind` (typed-state event):** KEEP emission, DELETE ContextBar consumers only.

The typed state is information-rich (`Idle:MonitoringSubagents`, `Working:Thinking`, `Waiting*` subtypes) and may feed future features — sub-agent awareness, compaction visibility, eventual UI badges. Deleting the event stream forecloses that option permanently.

Delete: the ContextBar's consumption of `sessionState.kind` for Working/Idle gating and for label source. The event stream survives; only the ContextBar wire detaches.

**15.3-arc guards (`useSessionStateUpdatedAt`, `lastTurnEndTs`, heartbeat-stale gate, Option 4 hard-off, Option 2 turn-lock, Fix 1 freshness, Fix 2 typed-Idle fall-through):** DELETE aggressively in rotation 2.

These guards exist SOLELY to compose the asymmetry this phase deletes. If the asymmetry is gone and the parallel-run diff from Q1 proves Codeman-pattern handles every case cleanly, the guards are dead weight — not defensive layers. Keeping them "just in case" creates the exact multi-signal OR-chain we're migrating away from. Delete.

One exception: anything in `usePromptDetection` / `00f1c30` (Item 3 — `isActive` gate removal + idle cadence scaling). That's orthogonal — approval modal mount pipeline, not Working/Idle gating. Leave untouched.

## Q3 — Acceptance criteria.

PM's proposed bar is necessary but not sufficient. Adding three criteria:

**Carried from PM's proposal:**
1. Live smoke: 5-case matrix from §12 (BASH-10, READ-STATE, EDIT-DIAG, SPAWN-AGENT, BASH-2) all green — continuous live labels, no stuck trailing edges, no generic fallbacks.
2. Pure-text turn: bar transitions to Idle within ~5s of a pure-text Claude turn ending (the `41a55e9` motivation case).
3. Intermittency resistance: run the 5-case matrix twice in the same Commander session, without restart. Identical results both runs.

**Adding:**

4. **Parallel-run diff clean** (rotation 1 → rotation 2 gate). Every disagreement between Codeman-pattern and legacy during rotation 1 has a documented explanation, zero unexplained divergences.

5. **Split-view test.** Two concurrent CODER sessions in split-view, each doing different tool-exec types simultaneously (e.g., session A runs `sleep 10`, session B runs Read + Edit sequence). Both ContextBars show correct independent states. No cross-pane state bleed. No label from session A appearing in session B's ContextBar.

6. **Sub-agent test.** CODER spawns an agent. Verify: (a) parent session's ContextBar during the spawn-call window shows "Spawning agent..." or equivalent rich label, (b) parent session transitions to Idle while agent works (parent is NOT mid-tool), (c) agent's own pane ContextBar shows its own tool-exec state correctly, (d) when agent completes and returns to parent, parent's ContextBar resumes correct state.

Criterion 6 surfaces a question PM should flag for CODER pre-dispatch: Codeman's scalar `currentTool: string | null` model — does it handle the "parent is waiting for sub-agent" state correctly, or does it need extension for Commander's sub-agent UX? Investigation item for rotation 1, pre-code.

## Q4 — Phase name: **"Phase Y: Transcript-Authoritative State."**

Rejecting both PM options with reasoning.

"Structured-Signal Primacy" is too abstract — reads like a philosophy-paper title. Doesn't tell a fresh reader what the phase actually does.

"ChatMessage-Authoritative Derivation" is accurate but mouthy. "ChatMessage" is a Commander-internal type name, not a concept that immediately signals "transcript stream" to someone outside the codebase.

"Transcript-Authoritative State" is cleaner:
- "Transcript" mirrors Codeman's actual mechanism name (`transcript-watcher.ts`) and reads naturally to anyone who has seen a JSONL transcript.
- "Authoritative" carries the architectural point — this is the source of truth, other signals are downstream or deleted.
- "State" is what we're deriving.

Short, memorable, describes exactly what the phase does. Lock it.

## Q5 — Architectural constraints PM hasn't surfaced.

Six additions. Not all require pre-dispatch answers; some are CODER investigation items for rotation 1.

**1. Parallel tool_use in a single assistant block.** Claude Code can emit multiple tool_use blocks in one assistant message. Codeman's scalar `currentTool` assumes one-at-a-time. Commander needs to decide: list of active tools, most-recent-unmatched only, or synthetic "multiple tools running" label. CODER investigation item rotation 1: read Codeman's actual handling in `transcript-watcher.ts`, then propose Commander's approach.

**2. Split-view + per-pane state isolation.** Covered by acceptance criterion 5. Flagging explicitly: each pane is a different session with its own `ChatMessage[]`. New hook must take `sessionId` and isolate per-session. Verify no shared global state bleeds across panes during dispatch.

**3. Sub-agent sessions.** Covered by acceptance criterion 6. Flagging explicitly: parent session and agent session have different JSONL transcripts. Parent's `ChatMessage[]` includes the spawn event as a tool_use; agent's pane is a separate session entirely. Derivation needs to handle both cleanly.

**4. `/compact` behavior.** /compact is a specific Claude Code event. In Commander it currently renders via the typed-state `Compacting` subtype. Under transcript-authoritative derivation, /compact must still surface as a rich label during compaction (not "Composing response..." generic). CODER investigation item rotation 1: verify Codeman handles /compact in its transcript-watcher, or identify what path Commander needs.

**5. Approval modal path — DO NOT REGRESS.** Approval is a side-channel, not a tool_use. Item 3 (`00f1c30`) removed the `isActive` gate from `usePromptDetection` and scaled idle cadence — that fix stands. This phase does NOT touch approval-modal mount logic. Include a non-regression check in the dispatch: Case 2 (ls post-approval) modal must still mount within ~3s. If rotation 1 or 2 accidentally touches this path, immediate revert.

**6. Server-side poll lifecycle.** If client stops consuming `session.status`, the `status-poller.service.ts` still runs at 1.5s cadence per session. Decide (post-dispatch, not blocking): keep running for server-side telemetry value, gate behind a config flag, or eventually delete. Not a rotation-blocking decision; log as follow-up candidate.

## Q6 — NEW: Rollback gate.

PM brief doesn't specify what happens if rotation 2's final delete pass surfaces a failure mode not caught in rotation 1's parallel-run. Explicit rollback gate:

- If final live smoke on rotation 2 fails any of the 6 acceptance criteria, `git revert` the deletion commits (NOT rotation 1's Codeman-pattern addition). Parallel-run path remains live. Re-open diagnosis.
- If rotation 2 ships green but a residual surfaces within 72h of real-use, same rollback posture. Don't ship a patch; revert the deletion, re-diagnose.

Phase acceptance is ship-clean-and-survives-72h-of-dogfood, not ship-and-hope. Fold into the dispatch's rejection triggers.

---

## What I need from PM next

1. Draft the Phase Y dispatch against all six answers above (Q1–Q6).
2. Include explicit Q5.1 + Q5.4 investigation items for CODER to execute pre-code in rotation 1 (Codeman parallel-tool handling + Codeman /compact handling).
3. Return the dispatch draft to me via Jose before firing. This is an architectural migration with real revert risk — CTO reviews the dispatch draft before Jose authorizes.

Not urgent. Take the time to draft it cleanly. When draft lands I ratify or push back within one round.

---

**End of response.**
