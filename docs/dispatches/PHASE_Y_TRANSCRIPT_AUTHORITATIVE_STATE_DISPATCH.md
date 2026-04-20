# Phase Y — Transcript-Authoritative State (Migration Dispatch)

**From:** PM (Commander, 2026-04-20)
**To:** CODER (fresh spawn recommended — accumulated-context risk after M8 + `41a55e9` + M7)
**Status:** DRAFT v2 — CTO-ratified with 5 amendments (folded); Phase T prerequisite shipped + ratified (`e4c66c5` + `9bba6ab`). Awaiting one-round CTO fire-ready confirmation on this amended draft.
**Preceded by:** `CTO_BRIEF_codeman_model_phase.md`, `CTO_RESPONSE_2026-04-20_codeman_phase.md` (scoping Q1-Q6), `CTO_RESPONSE_2026-04-20_phase_Y_draft_review.md` (Amendments 1-5). Phase T shipped green, closing the "diagnostic ground-truth ladder" prerequisite — tmux mirror pane is live during Phase Y smoke.
**Type:** TWO-ROTATION ARCHITECTURAL PHASE. Rotation 1 = ship Codeman-pattern alongside legacy with parallel-run diff. Rotation 2 = delete legacy after disagreement log audits clean.
**Phase name:** Phase Y: Transcript-Authoritative State (locked by CTO).
**Closes:** Candidates 23 (runtime `contextLimit`), 32 (intermittent activity-missing), 33 (intermittent 60s stuck trailing edge).

---

## Framing

The 15.3 arc produced five fixes (Fix 1, Fix 2, Option 4, Option 2, Activity-gap) plus the out-of-sequence `41a55e9` heartbeat-stale guard to compose ContextBar state across disagreement windows between three server signals (`session.status`, `sessionState.kind`, `unmatchedToolUse`). Candidates 32 and 33 remain intermittent because `session.status` pane-classifier lag is not gate-able without a deeper architectural change.

Phase Y replaces the three-signal OR-chain with derivation from `ChatMessage[]` alone — the Codeman `transcript-watcher.ts` pattern. Single source of truth, no asymmetry, no guards to compose across.

CTO has scoped this phase across two rotations with parallel-run diff instrumentation in Rotation 1 and aggressive deletion in Rotation 2, contingent on the disagreement log auditing clean.

---

## Rotation 1 — Codeman-pattern hook with parallel-run diff

### 1.0 Pre-code investigation items (MUST execute before writing the hook)

**Three items** per CTO Q5 + Amendment 2. Document findings inline in the rotation 1 PHASE_REPORT under a `§ Pre-code investigation` heading.

**Investigation A — Parallel tool_use handling.** Claude Code can emit multiple `tool_use` blocks in a single assistant message. Codeman's `state.currentTool: string | null` is scalar. Commander needs a call.

- Read `~/.codeman/app/src/transcript-watcher.ts` (plus any files it imports) and document how it handles parallel tool_use: does it queue, skip, override, ignore? Report the exact behavior.
- Read recent Commander session JSONLs (`~/.claude/projects/-Users-josemiguelbonilla-Desktop-Projects-jstudio-commander/*.jsonl`) and find at least one real parallel-tool_use instance. Document the block structure.
- Propose Commander's approach from three candidates: (a) scalar with last-write-wins like Codeman, (b) list of active tools rendering "Running 2 tools..." synthetic label, (c) most-recent-unmatched with others hidden. Do not implement yet — propose in PHASE_REPORT, await PM + Jose call.

**Investigation B — /compact handling.** `/compact` currently renders via typed-state `Compacting` subtype. Under transcript-authoritative derivation, `/compact` must surface as a rich label during compaction, NOT collapse to "Composing response..." generic.

- Does Codeman's transcript-watcher handle `/compact`? Read the source and document.
- In Claude Code JSONL, what event shape represents a compact boundary? System event? Assistant message with specific content? Document.
- Propose Commander's detection path: read the JSONL event shape, emit `Compacting` equivalent label, transition off when compact completes. Do not implement yet — propose in PHASE_REPORT.

**Investigation C — `useChat` streaming text update cadence (CTO Amendment 2).** The hook relies on `ChatMessage[]` updating during assistant text composition to correctly transition to `subtype='composing'`. Must verify:

- During streaming assistant text, does `useChat` update `ChatMessage[]` per streaming chunk (derivation picks up composing state naturally), or only when the message completes (derivation stays stuck on previous state, composing subtype never fires)?
- Read `client/src/hooks/useChat.ts` source and trace the update path from WebSocket event → state dispatch → `ChatMessage[]`.
- If per-chunk: no additional work needed, document the path in findings.
- If per-message-complete: propose an additional signal to expose streaming state (e.g., `useChat` returns a `streamingAssistantId: string | null` that the new hook consumes, or observes a lower-level stream event directly). Do NOT implement the streaming extension speculatively — propose in PHASE_REPORT, await PM + Jose call.

All three investigations are READ-ONLY this sub-step. No code written until PM + Jose review the findings and ratify the approach for A, B, and C.

### 1.1 Hook — `useToolExecutionState(sessionId)` (or equivalent name)

Scope: derive working/idle + rich label directly from `ChatMessage[]` (already flowing via `useChat` in ChatPage).

Signature target:
```ts
export const useToolExecutionState = (sessionId: string | undefined): {
  isWorking: boolean;
  currentTool: string | null;   // or CurrentToolState per Investigation A outcome
  label: string | null;          // rich per-tool label, or "Composing response..." during text composing, or null when truly idle
  subtype: 'tool_exec' | 'composing' | 'compacting' | 'idle';
}
```

The hook:
- Takes `sessionId`; reads the same `ChatMessage[]` stream `useChat` delivers.
- Tail-scans for latest unmatched `tool_use` → extracts tool name + input → produces rich label.
- Detects assistant streaming (composing) when tail block is text-in-progress.
- Detects `/compact` per Investigation B outcome.
- Idle when no unmatched tool, no streaming text, no compact.

Crucial isolation: per-session. Two `useToolExecutionState` calls with different `sessionId` must not share state. Verify with the split-view acceptance test (criterion 5 below).

File location: `client/src/hooks/useToolExecutionState.ts` (or name per PM pre-review).

### 1.2 Parallel-run wiring at ContextBar

At `ChatPage.tsx:329-332`: keep the existing `isSessionWorking` OR-chain computing. Do NOT delete. But add alongside it the new Codeman-pattern hook output.

At the ContextBar prop-pass boundary (where `isWorkingOverride` currently threads), pass BOTH:
- Legacy `isSessionWorking` (existing).
- New Codeman-pattern `isWorking` + `label` + `subtype` from the hook.

Inside ContextBar: consume the new Codeman-pattern as PRIMARY. Legacy as FALLBACK ONLY WHEN PRIMARY RETURNS NULL/UNDEFINED. Concretely:
```
const isWorking = codemanState.isWorking ?? isSessionWorking;
const label = codemanState.label ?? /* legacy label resolution */;
```

This is the safety net. Any edge case the Codeman-pattern doesn't handle falls through to the 15.3-arc guards that DO handle it. We don't lose coverage during rotation 1.

### 1.3 Parallel-run diff instrumentation — `[codeman-diff]` tag

Add a dedupe-gated logger at the point where both derivations are known. Emit when Codeman-pattern disagrees with the legacy derivation for the same session at the same render moment. Payload:
```json
{
  "ts": <number>,
  "sessionId": "<uuid>",
  "codemanIsWorking": <bool>, "codemanLabel": "<str|null>", "codemanSubtype": "<str>",
  "legacyIsWorking": <bool>, "legacyLabel": "<str|null>",
  "messagesTail": [ /* last 3 ChatMessage blocks, truncated */ ],
  "sessionStatus": "<idle|working|waiting>",
  "sessionStateKind": "<Idle|Working|...>"
}
```

Prefix every log line with literal `[codeman-diff]` — grep-strippable per `standards/INVESTIGATION_DISCIPLINE.md`.

Dedupe: maintain a `Map<sessionId, lastPayloadHash>`. Only emit on payload change. Prevents log flooding during idle derivation re-runs.

**CTO Amendment 1 — server-side persistent log storage (LOAD-BEARING).** DevTools console alone is fragile: if Jose closes DevTools, hard-reloads, or the browser tab crashes during the ~1-day accumulation window, the log is gone and rotation 2's audit has no evidence. Required:

- New server endpoint: `POST /api/debug/codeman-diff` at `server/src/routes/debug.routes.ts` (or equivalent). Accepts the full payload shape. Appends each payload as one line to a JSON Lines file at `~/.jstudio-commander/codeman-diff.jsonl`. Creates the file if absent. Append-only (no rotation, no truncation — the window is short-lived).
- The client-side logger emits to **BOTH** DevTools console AND posts to the new endpoint. Console path for live debug observation; file path for durability.
- No client-side localStorage (size caps problematic over ~1 day of real work). No structured DB table (overkill for transient instrumentation). JSONL file append is simple, resumable across server restarts, and trivially grep/parse-able.
- Rotation 2's strip removes the endpoint + the logger call + the file (`rm ~/.jstudio-commander/codeman-diff.jsonl`). Strip verification at §2.6 confirms all three.

**This instrumentation SURVIVES the rotation 1 commit. It stays live in the working build for ~1 day of Jose + CODER real-use before rotation 2 opens.** During that window, the log accumulates disagreement evidence in BOTH console (for live observation) and `~/.jstudio-commander/codeman-diff.jsonl` (for durability). Rotation 2's first step is to read the JSONL file (not the console) + categorize.

Strip does NOT happen at rotation 1 close. Only at rotation 2 close, after legacy path + guards are deleted, the diff logger has no counterparty to compare against, and the JSONL file is removed.

### 1.4 Non-regression — Item 3 approval path MUST NOT REGRESS

`00f1c30` (Item 3) removed the `isActive` gate from `usePromptDetection` and scaled idle cadence. That fix is orthogonal and stays untouched.

Include a non-regression test in rotation 1:
- Case 2 (ls post-approval) modal mounts within ~3s of approval acceptance.
- Permission prompt polling remains at 1-2s active cadence, 5-10s idle.

If rotation 1's Codeman-pattern hook accidentally couples to `usePromptDetection` state, STOP. That's an architectural error, not a scope expansion.

### 1.5 Rotation 1 file boundaries

Touch:
- `client/src/hooks/useToolExecutionState.ts` (NEW).
- `client/src/pages/ChatPage.tsx` (add parallel hook call, pass new props to ContextBar, pass through legacy as fallback).
- `client/src/components/chat/ContextBar.tsx` (add Codeman-primary consumption with legacy fallback).
- `client/src/utils/contextBarAction.ts` — ONLY IF the fallback label resolution needs a minor adjustment to support the new primary path; default assumption: not touched.
- `client/src/utils/__tests__/` — new test file(s).
- New logger utility for `[codeman-diff]` emission (can live in the hook file or a sibling).
- **Server-side (CTO Amendment 1 — permitted for this phase):** `server/src/routes/debug.routes.ts` (NEW or extension of existing if one exists) for `POST /api/debug/codeman-diff`. JSONL append via `fs.appendFileSync` to `~/.jstudio-commander/codeman-diff.jsonl`. This endpoint is TEMPORARY — deleted in rotation 2.

Do NOT touch:
- `usePromptDetection.ts` — Item 3 preserved.
- Any server-side file (Phase Y Rotation 1 is client-only).
- `useSessionStateUpdatedAt.ts`, `ChatPage.tsx`'s `lastTurnEndTs` ref, heartbeat gate — all 15.3-arc guards stay in place during rotation 1 as the fallback path.
- ProjectStateDrawer (M7), SessionCard (M8).
- `SESSION_TYPE_EFFORT_DEFAULTS`, `session.status` pane classifier, `sessionState.kind` server emission — all KEEP per Q2.
- Any M5 migration work.

### 1.6 Rotation 1 tests

User-observable contract per OS §20.LL-L10. Node:test + tsx harness; shape-pinning, not DOM rendering.

1. Hook returns `{ isWorking, currentTool, label, subtype }` in expected shape on mount, on ChatMessage update, on unmount.
2. Unmatched tool_use in tail → `isWorking=true`, `currentTool="<toolName>"`, `label` matches Read/Edit/Write/Bash rich label.
3. Matched tool_use + tool_result pair → that tool no longer unmatched; if no other unmatched, `isWorking=false`.
4. Text-only streaming tail → `subtype='composing'`, `label="Composing response..."`, `isWorking=true`.
5. Compact event detected → `subtype='compacting'`, `label="Compacting context..."`.
6. Parallel run disagreement: given synthetic ChatMessage inputs where Codeman-pattern returns one state and legacy returns another, the `[codeman-diff]` logger fires with the correct payload shape.
7. Approval modal non-regression: Case 2 (ls post-approval) — permission prompt mounts within ~3s. Mock the WS event + approval-token detection.
8. Per-session isolation (function-level): two simultaneous `useToolExecutionState` calls with different `sessionId` do not share derivation state. Given session A has unmatched Bash and session B has no tool, `A.isWorking=true` AND `B.isWorking=false`.

8b. **Per-session isolation (React-tree level) — CTO Amendment 3.** Render two `useToolExecutionState` hooks in the SAME React component tree with different `sessionId` values (use a test harness that supports hook rendering — leverage whatever the existing test surface permits; if no React-tree-level harness available, document the gap and substitute with a structural test that verifies the hook uses no module-level state per-key). Trigger an update to session A's `ChatMessage[]` input via test props. Verify session B's returned state does NOT change. Inverse also: trigger session B update, verify session A unchanged. This catches shared-module-state bugs (e.g., accidental `let lastHash = null;` outside the hook scope) that pure function-level isolation tests miss.

Run `pnpm test` + `pnpm typecheck`. Target baseline 348 + N new, all pass, typecheck clean.

### 1.7 Rotation 1 live smoke (Jose browser)

Rotation 1 does NOT close on live smoke alone — the parallel-run diff log accumulation is what gates rotation 2.

Live smoke for rotation 1 verifies:
- Codeman-pattern + legacy coexist without crashes.
- ContextBar labels look correct during normal Jose + CODER work (regardless of which path produced them).
- `[codeman-diff]` logs appear in DevTools console during real work (instrumentation is actually running).
- Approval modal still mounts (Item 3 non-regression).

After smoke green, rotation 1 closes with commit + instrumentation LIVE. Jose uses Commander normally for ~1 day. Log accumulates.

### 1.8 Rotation 1 commit discipline

Two commits acceptable (CTO-ratified):
- Commit A: `feat(ui): Phase Y Rotation 1 — useToolExecutionState hook + parallel-run diff instrumentation`. Covers investigation findings appendix, hook implementation, parallel-run wiring, `[codeman-diff]` logger, non-regression tests.
- Commit B (optional, only if investigation findings require approach-locking doc): `docs: Phase Y Rotation 1 — Investigation A + B findings`. Updates to `docs/briefs/` or a PHASE_REPORT artifact.

Single commit also acceptable if investigation + hook + wiring fit coherently.

### 1.9 Rotation 1 PHASE_REPORT requirements

Sections:
1. Pre-code investigation findings (A + B).
2. Hook implementation summary with file:line.
3. Parallel-run wiring diff summary.
4. `[codeman-diff]` logger shape documented.
5. Tests passing + typecheck clean.
6. Non-regression confirmation (Item 3 approval path, M7 ProjectStateDrawer, M8 effort UI).
7. Explicit "awaiting ~1 day live-use for disagreement log accumulation" gate. NO ship-green on rotation 1. NO rotation 2 fire until log audits clean.

---

## Rotation 2 — Aggressive deletion contingent on clean log

Fires after ~1 day of real use post-rotation-1-ship. Do NOT start until PM confirms log accumulation window elapsed and PM + Jose have reviewed the disagreement log.

### 2.0 First step — disagreement log audit

CODER reads the `[codeman-diff]` log from `~/.jstudio-commander/codeman-diff.jsonl` (not the DevTools console — per Amendment 1, file is the durable source). Categorize every disagreement. For each category, write a one-sentence explanation:

Examples of acceptable explanations:
- "Legacy flipped to Working during stale pane text at T+45s, Codeman-pattern correctly held Idle — expected divergence, Codeman-pattern is correct."
- "Codeman-pattern transitioned to 'compacting' at T+0ms of `/compact`, legacy lagged typed-state emit by 1.5s — expected, Codeman-pattern is correct."

Unacceptable (blocks rotation 2):
- "Codeman-pattern and legacy disagreed at T+10s; unclear which is correct" — reopen diagnosis, do NOT proceed to deletion.
- "Codeman-pattern returned null where legacy returned 'Working' — unknown cause" — block.

The audit report appends to PHASE_REPORT. Every disagreement explained, no unexplained divergences.

If the audit reveals an undocumented class, STOP. Do not delete legacy. Open a mini-investigation per `standards/INVESTIGATION_DISCIPLINE.md`, capture runtime evidence on the ambiguous class, explain or revert.

**Audit volume thresholds — CTO Amendment 5:**

- **Unexplained-class hard block.** If the JSONL contains more than ~5 distinct unexplained classes after CODER's initial categorization pass, rotation 2 start is BLOCKED. Escalate for architectural re-scoping — the Codeman pattern may need adaptation before deletion is safe. PM triages with Jose: either extend rotation 1 with targeted instrumentation on the ambiguous classes, or revert Codeman-pattern and re-scope Phase Y entirely.

- **Total-volume soft signal.** Total disagreement count is NOT a hard block on its own (10k entries across 3 explained categories is fine — Codeman-pattern is simply more accurate in many scenarios and the log reflects that). But if total volume exceeds ~10k entries while unexplained classes are ≤5, PHASE_REPORT appends a summary-aggregation note (category × count) instead of per-entry explanations in the audit appendix — per-entry listing at that volume is infeasible and not diagnostically useful. CODER produces: `{ category, count, first_seen_ts, last_seen_ts, sample_payload }` per row.

### 2.1 Legacy path + guards deletion

Once audit clean, delete aggressively per CTO Q2:

**Delete from client:**
- `ChatPage.tsx` legacy `isSessionWorking` OR-chain (all 4 OR-branches plus `typedIdleFreshKillSwitch` and `effectiveSessionStatus` downgrade).
- `lastTurnEndTs` ref + all its update logic.
- `useSessionStateUpdatedAt.ts` hook (entire file).
- `ContextBar.tsx` consumption of `sessionState.kind` for Working/Idle gating and for label source.
- `contextBarAction.ts` branches that exist solely for typed-state gating:
  - typed-Working:ToolExec branch (redundant with Codeman-pattern).
  - typed-Idle fall-through to jsonlLabel (Fix 2 — redundant, Codeman-pattern handles).
  - typed-Idle hard-off (Option 4 — redundant).
  - Heartbeat-stale gate on typed-Working OR-branch (`41a55e9` — redundant).
- The `[codeman-diff]` logger itself (client-side).
- **The server-side `POST /api/debug/codeman-diff` endpoint + route file + the JSONL file at `~/.jstudio-commander/codeman-diff.jsonl` (per CTO Amendment 1).** Strip verification at §2.6 confirms all three are removed.

**Keep in client:**
- `usePromptDetection.ts` — Item 3 (`00f1c30`). ORTHOGONAL, do not touch.
- Everything in ProjectStateDrawer / M7 — ORTHOGONAL.
- Everything in SessionCard effort UI / M8 — ORTHOGONAL.

**Keep on server (per CTO Q2):**
- `session.status` pane poll continues running server-side for telemetry value.
- `sessionState.kind` emission continues for future-feature preservation.

### 2.2 Rotation 2 file boundaries

Touch:
- `client/src/pages/ChatPage.tsx` (delete legacy composite + refs).
- `client/src/components/chat/ContextBar.tsx` (delete legacy consumption; primary is now sole path).
- `client/src/utils/contextBarAction.ts` (simplify substantially — delete typed-state branches).
- `client/src/hooks/useSessionStateUpdatedAt.ts` (DELETE FILE).
- `client/src/hooks/useToolExecutionState.ts` (remove parallel-run logger paths, keep hook core).
- Tests under `client/src/**/__tests__/` — `ChatPage-15.3-fix-rotation.test.ts`, `ContextBar-6.1.1-integration.test.ts`, relevant `contextBarAction.test.ts` entries. Delete or rewrite tests that guard for the deleted path.

Do NOT touch:
- Anything under "Keep" above.
- Any server-side file in either rotation.

### 2.3 Rotation 2 tests

All rotation 1 tests must still pass (Codeman-pattern path unchanged by the deletion).

Deletion is verified by what's NO LONGER present:
- No imports of `useSessionStateUpdatedAt` in ChatPage.
- No references to `lastTurnEndTs` in ChatPage.
- No consumption of `sessionState` in ContextBar for Working/Idle gating.
- Grep for legacy branch comments or deprecated function names — all should be gone.

Structural non-regression tests:
- Item 3 approval path still works (Case 2 live smoke as integration anchor).
- ProjectStateDrawer renders and updates (M7 non-regression).
- SessionCard effort click-to-adjust still works (M8 non-regression).
- `/compact` still shows "Compacting context..." label during compact.

### 2.4 Rotation 2 live smoke — THE ACCEPTANCE GATE

All 6 criteria from CTO Q3 must pass cleanly:

1. **5-case matrix** — BASH-10, READ-STATE, EDIT-DIAG, SPAWN-AGENT, BASH-2 all green. Continuous live labels, no stuck trailing edges, no generic fallbacks.
2. **Pure-text turn** — bar transitions to Idle within ~5s of a pure-text Claude turn ending.
3. **Intermittency resistance** — run the 5-case matrix twice in the same Commander session without restart. Identical results both runs.
4. **Parallel-run diff clean** — audit from 2.0 has zero unexplained divergences (this is retrospective at 2.4 time; 2.0 gated rotation 2 start).
5. **Split-view test** — two concurrent CODER sessions in split view, each doing different tool-exec types simultaneously. Both ContextBars show correct independent states. No cross-pane bleed.
6. **Sub-agent test — full 5-step procedure per CTO Amendment 4.**

   All five steps must hold cleanly. Any failure = criterion 6 fails.

   **Step 1.** In an active CODER session in Commander, issue a command that spawns a sub-agent. Exact phrasing picked by Jose at smoke time so it produces a real Task tool invocation. Suggested: "spawn a quick agent to run `ls` on a fresh path."

   **Step 2.** Observe parent session's ContextBar during the spawn window (Task `tool_use` emission). Must show a rich label like `"Spawning agent..."` or `"Running Task..."` — NOT `"Idle"` and NOT generic `"Working..."`.

   **Step 3.** While the sub-agent is executing: parent session's ContextBar transitions to Idle (parent itself is not mid-tool; it's waiting on the agent). Exception: if Investigation A (parallel tool_use) revealed Commander needs a "parent-during-subagent" state that's neither Idle nor Working, substitute that state's rich label per A's output.

   **Step 4.** Sub-agent's own pane (if visible in split-view) must show its OWN tool-exec state independently. If the agent runs bash, agent's ContextBar reads `"Running command..."` — NOT parent's state. Confirms per-session isolation at the hook level.

   **Step 5.** When sub-agent completes and returns results to parent: parent's ContextBar resumes correct state — Idle if parent truly has nothing pending, or the correct label if parent continues work immediately.

   CODER's Investigation A output (parallel tool_use handling) informs how sub-agent spawn is represented in `ChatMessage[]`; the acceptance test verifies the user-observable outcome regardless of implementation.

### 2.5 Rollback gate per CTO Q6

If 2.4 live smoke fails any of the 6 criteria:
- `git revert` the DELETION commits (rotation 2's work).
- Do NOT revert rotation 1's Codeman-pattern hook + parallel-run path.
- Re-open diagnosis per `standards/INVESTIGATION_DISCIPLINE.md`.

If rotation 2 ships green but any residual surfaces within 72h of real-use:
- Same rollback posture — revert deletion commits, parallel-run path remains live.
- Do NOT patch over the residual. Revert first, diagnose second.

Phase Y acceptance is ship-clean-and-survives-72h-of-dogfood. Fold this into PHASE_REPORT language at rotation 2 close: "awaiting 72-hour dogfood period before phase COMPLETE."

### 2.6 Rotation 2 strip verification (per CTO Amendment 1)

Pre-commit checklist for rotation 2's deletion commits:

- `grep -rn '\[codeman-diff\]' client/src server/src` returns empty (logger strip).
- `ls ~/.jstudio-commander/codeman-diff.jsonl` returns "No such file or directory" (JSONL file removed).
- `grep -rn 'codeman-diff' server/src/routes` returns empty (endpoint + route file removed).
- `git diff` on the deletion commit range shows net-negative LOC across the instrumentation surface (client logger + server endpoint + route registration).

CODER cites each check's output in the PHASE_REPORT strip-verification section. All four must be clean before rotation 2 PHASE_REPORT declares deletion complete.

### 2.7 Rotation 2 commit discipline

Single deletion commit preferred: `refactor(ui): Phase Y Rotation 2 — delete legacy Working/Idle derivation chain after clean parallel-run audit`.

If deletion fans out across too many files for a coherent single commit, split by surface:
- Commit A: delete `ChatPage.tsx` + `useSessionStateUpdatedAt.ts` legacy composite.
- Commit B: delete `ContextBar.tsx` + `contextBarAction.ts` legacy branches.
- Commit C: delete parallel-run diff logger (instrumentation strip).

Maximum 3 commits in rotation 2. All reversible independently per rollback gate.

---

## Phase T interaction — status-poller lifecycle dependency

Phase T shipped `e4c66c5` + hotfix `9bba6ab`: the tmux mirror pane reuses `status-poller.service.ts`'s existing 1.5s capture-pane tick to tee pane text through `session:pane-capture` WS events. Phase T dispatch flagged this as a known downstream dependency: if Phase Y eventually gates or deletes the status-poller entirely (Q2's "Server-side poll lifecycle" — left as post-phase follow-up candidate, NOT a rotation-blocker for Phase Y), Phase T's capture source must migrate to an independent `tmux capture-pane` tick dedicated to the mirror.

**Phase Y does NOT pre-solve this.** Rotation 1 and Rotation 2 leave the status-poller server-side infrastructure intact (per CTO Q2: `session.status` pane-regex server poll KEEPS running; only client consumption deletes). Phase T's mirror continues to work throughout Phase Y's lifecycle.

If a future "Server-side poll lifecycle" rotation decides to delete the poller entirely, THAT rotation's dispatch owns the Phase T migration. Tracked as a known cross-phase dependency; not actionable in Phase Y.

## Cross-rotation rejection triggers

Any one rejects and requires PM escalation before proceeding:

(a) Files outside the per-rotation boundary touched.
(b) Rotation 1 hook implementation without completing pre-code Investigation A + B.
(c) Rotation 2 deletion without clean disagreement log audit (§2.0).
(d) Approval modal path modified (Item 3 `00f1c30` is sacred).
(e) ProjectStateDrawer or SessionCard effort UI regressed — both orthogonal, both must survive.
(f) Server-side deletion of `session.status` pane poller or `sessionState.kind` emission (CTO Q2 said KEEP both server-side).
(g) Parallel-run diff logger stripped before rotation 2 deletion work lands.
(h) Rotation 2 ship-green claim without 6-criterion live smoke + 72h dogfood declaration.
(i) Speculative-fix attempt on a rotation 2 live-smoke failure — rollback first, diagnose second per Q6.

---

## Investigation-discipline posture

This phase IS the first substantive test of the new investigation discipline (`standards/INVESTIGATION_DISCIPLINE.md`, OS §20.LL-L11/L12).

The parallel-run diff instrumentation in rotation 1 IS an instrumentation rotation embedded in the ship rotation. If rotation 1's hook implementation fails unit tests or live smoke, do NOT fix-forward. Use the `[codeman-diff]` logger as the primary evidence stream — the disagreement log tells you exactly what the hook misses.

If rotation 2's final live smoke reveals a failure mode not caught in the disagreement log, that's a Q6 rollback situation. Revert deletion, instrument the specific case, diagnose, then attempt deletion again.

Zero speculative-fix stacking allowed. Per OS §20.LL-L11.

---

## Standing reminders

Per CTO Q5.5 and criterion 5 acceptance: split-view per-pane isolation is load-bearing. The hook takes `sessionId`. No module-level state, no React context shared across panes.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own CODER Commander session is the cheapest testbed. Jose sees your ContextBar while you work; if your label misbehaves during your own tool-exec, that's live evidence.

Per `feedback_understand_before_patching`: Phase Y is the highest-leverage application of this discipline in the project to date. Honor it.

Per `feedback_coder_prompts_in_code_blocks`: PM will hand Jose the paste-prompt in a fenced code block.

Fresh CODER spawn strongly recommended. The existing CODER context carries M8 + `41a55e9` + M7 accumulation plus this entire 15.3 arc. Phase Y's subscription-free per-session-isolated derivation needs clean reasoning space.

---

## What happens after Phase Y ships green + 72h dogfood

- Candidates 23, 32, 33 declared RESOLVED via this phase.
- STATE.md flipped to "Phase Y COMPLETE, Candidates 23/32/33 closed."
- CTO_BRIEF lands summarizing the architectural migration for Claude.ai checkpoint.
- Codeman project reference + this phase's approach becomes a reusable pattern for other JStudio projects (potentially reflected in OS §23 or a new standards doc).
- Queue returns to: M8 Secondary (CreateSessionModal effort override), Candidate 24 (compact input buffer — possibly already closed by transcript-authoritative derivation), Candidate 26 (token_usage retention), Candidate 27 (recovered-jsc archaeology), Candidate 30 (markdown parity), Issue 13.1 (schema cascade), Issue 18 (feature scope decision).

---

**End of dispatch draft. Awaiting CTO ratification via Jose relay before fire.**
