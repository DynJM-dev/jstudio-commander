# Commander Finalizer — Session Isolation Hardening + Small-Bug Batch + Phase Y Ceiling Workarounds

**From:** PM (Commander, 2026-04-21)
**To:** CODER (fresh spawn strongly recommended — this rotation is large and mixes surfaces; a fresh context avoids architectural-ceiling fatigue)
**Type:** CONSOLIDATED FINALIZER rotation. Multi-commit, autonomous execution authorized per `feedback_authorize_autonomous_coder_rotations`. Closes the Commander bug queue before returning to JStudio migration plan per `project_commander_finalizer_then_migration`.
**Preceded by:** Phase Y Rotation 1.7 `94536b5` shipped — Cases C + D pass, Case A fail (fallback dormant). Closeout at `docs/phase-y-closeout.md`. Commander architectural ceiling acknowledged; native rebuild owns real-time correctness. **Also preceded:** Candidate 41 (pendingLocal cleanup) SHIPPED autonomously at `9ce2a60` — pure `pendingLocalFilter.ts` helper + three-gate retention rule (canonical match / 60s hard ceiling / 10s+sessionAck) + explicit `.catch` cleanup on api.post failure + 28 new tests. Client suite 459 → 487. Dropped from this dispatch's Commit B.
**Status:** Jose-authorized. Autonomous execution. No mid-rotation check-ins required unless a MAJOR scope decision surfaces.

---

## §1 — Autonomy clause (binding)

Per `feedback_authorize_autonomous_coder_rotations`, CODER has authority this rotation to:

- **Self-instrument** when evidence is needed before a fix (follow `standards/INVESTIGATION_DISCIPLINE.md` — grep-strippable tags, dedupe-gated, capture-verified, strip before commit).
- **Spawn sub-agents** for test-coverage audits, structural non-regression verification, architecture sanity checks. Do not spawn agents to WRITE fix code — they may READ and REPORT only.
- **Self-dogfood in split view** — open PM + CODER panes in your own Commander, exercise the bug classes directly. This is the canonical repro environment for Candidate 36 specifically.
- **Multi-commit rotation** — split fixes into logical commits per §3 below. Do NOT stuff unrelated fixes into one commit.
- **MINOR scope deviations inline** — document in PHASE_REPORT, do not pause to ask.

**Still PM-gated:** MAJOR scope additions, revert proposals, touching hard-exclusion files (see §8), architectural pivots.

**Still blocked:** ship-green without Jose browser smoke.

**1.7.A Path decision superseded:** prior Case A smoke left 1.7.A helpers dormant with three paths proposed (Path 1 activate / Path 2 defer / Path 3 revert). This dispatch's Commit A.1 locks **Path 1** (activate via setInterval render-trigger + simplified predicate + Stop gate wire). Do not re-raise the Path question.

---

## §2 — Scope overview

Four tracks, grouped into three commits:

| Commit | Track | Fixes |
|---|---|---|
| **A** | Session isolation hardening | Stop button visibility (Case A latent fallback activation) + Candidate 36 effort cross-session display leak (D5/D6 instrument-and-fix inline) |
| **B** | Small-bug batch | Candidate 38 (attachment-only submit) + Candidate 39 (rapid-fire scroll-anchor) |
| **C** | Candidate 27 synthetic-id reconciliation | First-hook-fired reconcile of `recovered-jsc-*` synthetic session rows |

Commits may ship in any order. Recommended: A → B → C (A resolves the safety-critical Stop; B resolves observable UX; C resolves a long-queued data-layer issue with its own blast radius).

---

## §3 — Commit A: Session isolation hardening

### A.1 — Stop button visibility (safety-critical, P1)

**Symptom:** Stop button invisible at `ContextBar.tsx:696` during real Claude work. Gate: `(isWorking || hasPrompt || interrupting)`. Phase Y architectural ceiling means `codemanIsWorking` rarely flips true during pure-text turns, and `isWorking` depends on it. User cannot interrupt a running turn from the UI.

**Fix:**
1. Activate Fix 1.7.A's dormant fallback. In `ContextBar.tsx`, add a setInterval-driven re-render trigger when `userJustSent === true` — a useState tick that increments every ~1500ms, cleared when fallback ceiling passes OR when a concrete signal arrives. This forces React to re-evaluate `shouldEngageWorkingFallback` periodically without which the predicate sits frozen.
2. Simplify the predicate per CODER's option (b) from Case A postmortem: `shouldEngageWorkingFallback({ userJustSent, lastUserSendTs, nowMs })` — drop `lastAssistantBlockTs` dependency. Engages at `nowMs - lastUserSendTs > WORKING_FALLBACK_MS && nowMs - lastUserSendTs < WORKING_FALLBACK_CEILING_MS`. Update all existing Fix 1.7.A tests to match new signature.
3. Extend Stop button visibility gate at `ContextBar.tsx:696`:
   ```
   (isWorking || hasPrompt || interrupting || workingFallbackEngaged)
   ```
   where `workingFallbackEngaged` is the boolean from the (now-activated) fallback helper. The helper already wires into `effectiveStatus`; expose the boolean to the Stop gate.
4. Waiting passthrough still LOAD-BEARING — if `sessionStatus === 'waiting'`, Stop button visibility follows existing rules (prompt-present), does NOT use fallback.

**Tests (minimum 4):**
1. Stop visible when `isWorking === true` (non-regression, pre-existing pass).
2. Stop visible when fallback engages (userJustSent + 6s elapsed + no assistant block) — NEW.
3. Stop HIDDEN when idle with no recent userJustSent (non-regression).
4. Fallback render-trigger cleans up on unmount (memory leak guard).

### A.2 — Candidate 36 effort cross-session display leak

**Symptom:** in split view, PM + CODER sessions both visible. Jose changes PM's effort to `high` via ContextBar. PM's Live Terminal (Phase T mirror pane) shows `/effort high`. CODER's Live Terminal ALSO shows `/effort high` despite no send to CODER. Diagnostic `docs/candidate-36-diagnostic.md` (commit `05bb3c7`) proved send path at P1-P4 is clean — bug lives downstream in Phase T mirror DISPLAY layer.

**Autonomous investigation protocol (D5/D6 inline):**

1. **D5 — `TmuxMirror.tsx` subscribe site.** Add temporary grep-strippable log `[cand36-d5-instr]` on every subscribe/unsubscribe effect pass: `(propsSessionId, subscribedChannel, mountCount, lastCleanupReason)`. Goal: answer "does CODER's TmuxMirror subscribe to `pane-capture:4c3bec9d` (correct) or `pane-capture:822f2882` (PM's channel)?"
2. **D6 — `status-poller.service.ts` mirror tee emit.** Add `[cand36-d6-instr]` at `emitSessionPaneCapture(sessionId, paneText, ts)` call site: `(session.id, session.tmux_session, derivedChannel, paneTextHash)`. Goal: answer "does the poller emit PM's pane content on a channel keyed to CODER's session.id because two session rows share the same `tmux_session` value?"
3. **Repro in own split view.** Open PM + CODER in your Commander. Execute `/effort high` on PM's ContextBar. Capture console dump of `[cand36-*]` lines. Include in commit body under §D5/D6 capture.

**Fix based on capture (three candidate shapes, commit to one):**

- **Shape 1 — if D5 shows subscription drift:** `TmuxMirror.tsx`'s subscribe effect's dependency array / channel-string derivation has a stale-closure bug over `props.sessionId` (mirror of Rotation 1.5 Fix Z's mechanism applied to `usePreference`). Fix: align channel derivation with M7 pattern in `useProjectStateMd.ts` — recompute channel on every effect pass, include `props.sessionId` in deps, cleanup prior subscription before re-subscribing.
- **Shape 2 — if D6 shows two sessions sharing a tmux_session value:** reconcile at data layer. Add uniqueness check in session spawn / heal pass — if a non-stopped row's `tmux_session` matches another non-stopped row's, flag one as force-heal candidate. Hard fix; may require a small server-side migration. If this path is chosen, flag as MAJOR and pause — PM will dispatch as a separate rotation.
- **Shape 3 — if D6 shows the poller emits on wrong channel suffix:** e.g., channel suffix computed from `session.tmux_session` instead of `session.id` — trivial fix at emit call site. Two session rows sharing one tmux pane must still produce two independent channel broadcasts keyed by distinct `session.id` values.

**Instrumentation strip:** after fix + verification, `git checkout -- <files>` on instrumented sites. Verify `grep -rn '\[cand36-.*-instr\]' client/src server/src` returns empty before commit. Commit contains only the fix, not the instrumentation.

**Tests (minimum 3):**
- One unit test pinning the fix mechanism (e.g., if Shape 1: test that TmuxMirror's subscribe effect re-derives channel on sessionId prop change).
- One integration-style test: mock two session rows in split view, verify emitting to one's channel doesn't propagate to the other.
- One non-regression: single-session mirror path still works (Phase T primary case).

### A.3 — Also verify: Stop button session-scoped routing

**Already verified by PM recon 2026-04-21:** `onInterrupt` is a prop bound in each ChatPage instance to that instance's `interruptSession(sessionId)`. React construction guarantees per-pane scoping — `paneFocus.ts` was only needed for the global ESC keydown handler. Stop CLICK routing does not have a cross-pane bug.

**CODER required action:** write one NEW non-regression test pinning this: in a split-view mock, two ChatPage instances; click Stop on ChatPage-A; assert `interruptSession` was called ONCE with ChatPage-A's sessionId, never with ChatPage-B's. This is belt-and-suspenders — Jose explicitly asked for guardrails, pin the contract.

### Commit A summary

- **Files touched:** `ContextBar.tsx`, `contextBarAction.ts` (Fix 1.7.A helper signature change), `TmuxMirror.tsx` (or `status-poller.service.ts` per Shape outcome), new test file for A.1/A.2/A.3.
- **Tests:** 8+ new across all three sub-fixes.
- **Commit message:** `fix(ui+server): Commander Finalizer — session isolation hardening (Stop visibility + Candidate 36 display leak + Stop routing pin)`.

---

## §4 — Commit B: Small-bug batch

Three candidates, each narrow, unrelated to each other. Group into one commit to avoid rotation churn per `feedback_defer_nonblocking_bugs_to_native_rebuild` — none warrant a solo rotation.

### B.1 — Candidate 38: attachment-only submit

**Symptom:** user drops a file in chat input, leaves text empty, submit button enabled but submit does nothing.

**Location:** `ChatPage.tsx:102-140` `sendCommand` callback. Guard at line ~104: `if (!cmdText && !hasFiles) return;` — this is actually correct per code re-read. The bug may be earlier: verify whether attachment state bypasses the guard. Run:

```
grep -n "!command.trim()" client/src/pages/ChatPage.tsx
grep -n "attachments.stagedFiles" client/src/pages/ChatPage.tsx
```

If guard is structurally correct, the bug is elsewhere (submit button enabled condition at `:949`, disabled state race with `attachments.isUploading`). Narrow fix at the actual failure site. ≤10 LOC.

**Tests (minimum 2):** attachment-only submit succeeds; empty-text-empty-attachment submit still blocked.

### B.2 — Candidate 39: rapid-fire scroll-anchor + footer clearance

**Symptom:** sending multiple messages rapidly leaves them stacked flush against ContextBar footer with no breathing room / no auto-scroll.

**Location:** `ChatThread.tsx:434` auto-scroll gate `if (isAtBottom) { scrollTo }`.

**Fix:** user's own submits should ALWAYS auto-scroll regardless of prior scroll position (user intent = "look at what I just typed"). Add a `userJustSent` override branch above the `isAtBottom` check — on detecting a new user-role message at the tail (since last render), unconditionally scroll to bottom. Keep the existing `isAtBottom` logic for non-user-initiated appends (assistant streaming, tool results, etc.). Also ensure scrollTo target accounts for footer height — either add a spacer `<div>` above footer OR adjust `scrollTop` target by footer's measured height. ≤25 LOC.

**Tests (minimum 3):** user-sent message scrolls to bottom even when prior scroll was mid-transcript; assistant message respects isAtBottom gate (non-regression); rapid 3-message sequence all scroll correctly.

### Commit B summary

- **Files touched:** `ChatPage.tsx` (C38), `ChatThread.tsx` (C39), new test file or extensions to existing `ChatThread.test.ts` / `ChatPage.test.ts`.
- **Tests:** 5+ new (C38 ≥2, C39 ≥3).
- **Commit message:** `fix(ui): Commander Finalizer — attachment submit + scroll-anchor (C38 + C39)`.

---

## §5 — Commit C: Candidate 27 synthetic-id reconciliation

**Symptom:** Commander restart + orphan tmux session → adoption at `server/src/index.ts:275-303` creates a synthetic session row with id `<8hex>-0000-0000-0000-000000000000` and display name `recovered-jsc-*`. Real `claude_session_id` stays null forever. Subsequent hook events never reconcile the synthetic row because `resolveOwner` strategies key off `claude_session_id`.

**Fix direction locked in STATE.md §Candidate 27 INVESTIGATE-COMPLETE:** on first hook fired from a synthetic-id row's tmux pane, update that row's `claude_session_id` from hook payload. Drop synthetic-id lineage.

**Location:** `server/src/routes/` hooks handler (find the entry point that receives Claude Code hook emissions). After `resolveOwner` fails AND the target tmux pane matches a synthetic-id row, rewrite `claude_session_id` + optionally the display name (`recovered-jsc-*` → real session label if discoverable from payload).

**Alternative if rewriting the synthetic id is complex:** TTL-delete synthetic rows after 5 minutes of no hook activity. Simpler, drops orphan state instead of reconciling.

**CODER judgment call:** pick the mechanism that is LESS invasive. If the rewrite-on-first-hook path is under ~30 LOC server-side, do it. Otherwise TTL-delete. Flag choice in PHASE_REPORT.

**Tests (minimum 3):** synthetic row gets reconciled OR deleted on first matching hook; non-synthetic rows untouched; hooks with no matching row fail gracefully (non-regression).

### Commit C summary

- **Files touched:** one server file (hooks route or reconciler service), new test file.
- **Tests:** 3+ new.
- **Commit message:** `fix(server): Commander Finalizer — Candidate 27 synthetic-id reconciliation`.

---

## §6 — Test totals + acceptance

Target: **16+ new tests** across all three commits. Suite 487 → 503+ (baseline already includes Candidate 41's +28). Typecheck clean all three packages.

**Jose browser smoke (acceptance gate):**

1. **Stop button visible during work** — submit a long streaming prompt. Within 5-6s, Stop button appears. Click Stop — Claude interrupts cleanly. (Case A + safety-critical.)
2. **Stop button per-pane in split view** — open PM + CODER panes. Submit prompts in both. Click Stop on PM. ONLY PM interrupts; CODER continues. Repeat for CODER. (Guardrail.)
3. **Effort change per-pane in split view** — change PM's effort. PM's Live Terminal shows the change. CODER's Live Terminal does NOT show anything. (Candidate 36 closure.)
4. **Attachment-only submit works** — drop file, no text, submit. Message sends. (C38.)
5. **Rapid-fire scroll** — send 3 messages back-to-back. All three visible with breathing room above footer. (C39.)
6. **Synthetic-id reconciliation** — cold-restart Commander with an existing tmux session. After first hook fires, session row has real `claude_session_id`, not the zeros-suffixed synthetic. (C27.)
7. **Non-regression sweep** — Phase Y 1.5/1.6.B/1.7 + Candidate 41 pendingLocal cleanup all still green (effort dropdown, waiting passthrough, LiveActivityRow no-bleed, Case C approval, optimistic bubbles clear within 1-3s on healthy sends, slash-command bubbles clear within 60s ceiling, api.post failures drop orphans immediately).

Ship NOT claimed green until Jose confirms #1 + #2 + #3 + #4 + #5 + #6 (ALL six). #7 is a sanity check; report but don't gate.

**If any gate case fails:** report in PHASE_REPORT with observed symptom + hypothesis. Do NOT speculative-patch. PM will draft narrow remediation dispatch.

---

## §7 — Sub-agent spawning guidance (for autonomy)

Explicitly authorized sub-agent uses this rotation:

- **Test coverage audit** — spawn Explore agent to enumerate existing tests touching each modified file; identify coverage gaps before adding new tests. Purpose: avoid duplicate test paths, find existing fixtures to reuse.
- **Structural non-regression verification** — spawn general-purpose agent to run `git diff --stat` + structural grep across hard-exclusion surfaces (Phase Y frozen, 15.3-arc guards, Item 3, M7/M8/Phase T). Purpose: confirm zero-diff on protected files.
- **Candidate 36 architecture sanity** — if D5/D6 capture surfaces Shape 2 (two-session-rows-sharing-tmux), spawn Explore agent to trace how session rows enter that state (heal path? manual spawn race? legacy migration?). Report before committing to a fix shape.

**Forbidden sub-agent uses this rotation:**
- Writing production fix code (CODER retains ownership of all fix commits).
- Modifying tests (CODER retains ownership of test edits).
- Spawning more than 3 sub-agents (keep parent-agent context clean).

---

## §8 — File boundaries (hard exclusions)

Do NOT touch:
- `useChat.ts` (1.6.B frozen).
- `useToolExecutionState.ts` (1.6.B frozen).
- `pendingLocalFilter.ts` (Candidate 41 `9ce2a60` just shipped — frozen; C38 work in ChatPage may consume the helper but must not modify it).
- `useCodemanDiffLogger.ts`, `debug.routes.ts`, `~/.jstudio-commander/codeman-diff.jsonl` (Phase Y parallel-run logger stays live; eventual Rotation 2 may delete).
- 15.3-arc legacy guards: `typedIdleFreshKillSwitch`, `lastTurnEndTs`, `isSessionWorking` OR-chain, Fix 1/Fix 2, Option 2/Option 4/Activity-gap, heartbeat-stale gate.
- `usePromptDetection.ts` (Item 3 sacred).
- M7 (`ProjectStateDrawer`, `useProjectStateMd`, `watcher-bridge.ts` project-state path).
- M8 (`effortCard.ts`, `SessionCard.tsx` effort dropdown, `CreateSessionModal.tsx` effort selector).
- Phase T primary path (`usePreference.ts`, `emitSessionPaneCapture` signature — but the poller call site is in-scope for A.2 if Shape 3).
- `resolveEffectiveStatus`, `resolveActionLabelForParallelRun` body logic (Fix 1.7.A helper SIGNATURE may change per A.1, but these two helpers stay untouched).
- Any file Jose has explicitly asked not to modify in prior dispatches.

---

## §9 — Rejection triggers

(a) Any fix code landed without Jose browser smoke declaration.
(b) Hard-exclusion file touched (§8).
(c) Speculative patch on a rejection-trigger failure — investigation-first still applies.
(d) Candidate 36 D5/D6 instrumentation left in final commit (strip verification required).
(e) More than three commits in this rotation without MINOR deviation flagged.
(f) Sub-agent used to write production code or tests.
(g) Ship-green claim on a subset of the 7 gate cases.
(h) Touching Item 3 `usePromptDetection.ts` or waiting-passthrough semantics.
(i) More than 90 min spent on any single fix without pausing to flag as MAJOR.

---

## §10 — Post-finalizer sequencing (for CODER awareness)

After this ships green:
1. Commander bug work PAUSES per `project_commander_finalizer_then_migration`.
2. PM fetches latest CTO migration brief.
3. Migration plan resumes. Next architectural phase dispatched.
4. Remaining Commander candidates (29/30/34/35/40) defer to native rebuild.
5. Native Commander rebuild is the final migration phase.

CODER may be the same pipe for migration work or a fresh spawn — PM will decide based on rotation content.

---

## §11 — Standing reminders

Per `feedback_understand_before_patching`: Candidate 36 D5/D6 IS the evidence-first step. Do not skip it even though CODER is autonomous this rotation.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own split-view Commander is the Candidate 36 repro.

Per `feedback_vite_stale_code`: cold-restart dev server before your own smoke runs.

Per `feedback_defer_nonblocking_bugs_to_native_rebuild`: if a fix surfaces scope creep, flag and EXIT, do not expand.

Per OS §20.LL-L12: Candidate 36 has already been misdiagnosed once. Let D5/D6 capture drive the fix shape; do not anchor on Shape 1 / 2 / 3 prematurely.

Per `feedback_phase_report_paste_signal`: explicit "ready to forward to PM" signal at end of PHASE_REPORT.

Per `feedback_coder_prompts_in_code_blocks`: this dispatch is PM-authored; CODER delivers PHASE_REPORT at end.

Go.
