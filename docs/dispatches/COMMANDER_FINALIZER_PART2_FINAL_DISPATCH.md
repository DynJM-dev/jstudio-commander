# Commander Finalizer Part 2 FINAL — Status-bar reframe + remaining tracks

**From:** PM (Commander, 2026-04-21)
**To:** CODER (FRESH SPAWN — prior Part 2 pipe deferred due to rescope)
**Type:** FINAL Commander rotation before migration-plan pivot. Multi-commit, autonomous execution authorized per `feedback_authorize_autonomous_coder_rotations` + split discipline per `feedback_split_large_rotation_on_context_pressure`. Supersedes `COMMANDER_FINALIZER_PART2_DISPATCH.md` (that one is archived, do not execute).
**Preceded by:** Commander Finalizer Part 1 `db24eb0` + `c33ee5a` shipped. Jose smoke on Gates 1/2/4: Gate 1 FAIL (Stop button invisible — root cause localized), Gate 2 N/A (same mechanism), Gate 4 acknowledged (attachment bug C44 surfaced separately).
**Status:** Jose-authorized. "Move on after that" — this is the last Commander rotation before migration work resumes. Ship what's shippable; defer the rest per `feedback_defer_nonblocking_bugs_to_native_rebuild`.

---

## §1 — Autonomy + finality posture

Per `feedback_authorize_autonomous_coder_rotations`, you have the usual autonomous authorities (self-instrument, spawn sub-agents for audits, self-dogfood, multi-commit, MINOR deviations inline).

**Finality addendum for this rotation:** Jose's directive is "fix as much as possible, defer anything that doesn't fit, move on." That means:

- If a track's scope creeps past ≤90 min of work, STOP on that track and log it as "defer to native rebuild" in PHASE_REPORT. Do NOT stretch.
- If live-capture is required (e.g. C36 D5/D6) and you can't reliably reproduce in your own split-view Commander, STOP on that track and log deferral. Do NOT ship speculative fixes.
- Ship each commit independently per `feedback_split_large_rotation_on_context_pressure`. Don't hold the rotation hostage to the last track.
- Partial ship on this rotation is ACCEPTABLE and EXPECTED. Track 1 (status-bar) is the load-bearing one — if it's the only one that ships, that's still a win.

---

## §2 — Track 1 (LOAD-BEARING): Status-bar reframe via Phase T pane activity

### The real bug (Jose's reframe)

> "The issue with Stop is our status bar which is mostly Idle when it's working. It should still say something simple like Working while the terminal is still active and then Idle when response comes in and it's not active."

Phase Y derivation from transcript/JSONL hit an architectural ceiling — `useChat.messages` doesn't update incrementally during Claude turns (Closeout `93312e4`). The Phase T tmux mirror pane DOES update in real time — it reads pane content directly. **Phase T is the ground truth we're failing to wire into the status bar.**

### Current broken chain (do NOT try to patch this further — replace it)

- `isWorking` is derived through `isSessionWorking` OR-chain (session.status pane-classifier + typedIdleFreshKillSwitch + userJustSent + multiple 15.3-arc guards).
- session.status pane-classifier lags 2-60s.
- `userJustSent` is cleared at `ChatPage.tsx:242` the moment `session.status === 'idle'`, which during pure-text turns is IMMEDIATELY (because session.status never flipped working).
- Fix 1.7.A fallback at `contextBarAction.ts:206` short-circuits on line 211 if `userJustSent === false` — so the fallback is dead-on-arrival for real prompts.
- Stop button gate at `ContextBar.tsx:696` reads `isWorking || hasPrompt || interrupting || workingFallbackEngaged` — all four signals are false → Stop invisible.

### Fix direction

**Add a new ground-truth signal: `paneActivelyChanging: boolean`**, derived from Phase T's pane-capture stream.

- Server side (`status-poller.service.ts`) already emits `pane-capture:<sessionId>` events every 1.5s with pane content. No server changes needed for v1.
- Client side: new hook `useSessionPaneActivity(sessionId)` subscribes to the same channel as `TmuxMirror`, tracks a hash of recent pane captures + timestamp of last content change. Returns `paneActivelyChanging` (true if content changed within last N seconds, e.g. 3s — tune empirically).
- Wire into ContextBar: new derivation `const isActivelyWorking = paneActivelyChanging || isWorking`. Replace `isWorking` usage in the Stop button visibility gate and the effective-status derivation with `isActivelyWorking`.

**Why this works:**
- Pane text literally is Claude's output. If Claude is thinking, typing, running a tool, compiling a response — the pane changes. Ground truth.
- If pane is stable, nothing is happening. Idle.
- Zero dependency on Phase Y transcript pipeline (which is architecturally broken) or session.status classifier (which lags).
- Phase T mirror already has the capture stream — we're reading it twice but emission cost is zero.
- N-second debounce (3s or so) avoids single-keystroke flicker.

### Wire-in specifics

1. **New hook `client/src/hooks/useSessionPaneActivity.ts`** (~80-100 LOC):
   - Subscribes to `pane-capture:<sessionId>` WS channel (same as `TmuxMirror`).
   - Hashes incoming pane content (cheap hash — string length + last 200 chars is fine, don't need crypto).
   - Tracks `lastChangeTs` on every hash change.
   - Returns `paneActivelyChanging: boolean` based on `(Date.now() - lastChangeTs) < PANE_ACTIVITY_WINDOW_MS` (start with 3000ms, make constant configurable).
   - Per-session isolation: hook instance keyed to sessionId, no module-level state.
   - Unmount cleanup: unsubscribe from WS.

2. **ContextBar.tsx integration:**
   - Consume `useSessionPaneActivity(sessionId)` at top of component.
   - New derivation: `const paneActive = paneActivelyChanging;`
   - Replace Stop button gate at line 696 from `(isWorking || hasPrompt || interrupting || workingFallbackEngaged)` to `(isActivelyWorking || hasPrompt || interrupting)` where `isActivelyWorking = paneActive || isWorking`.
   - Replace `effectiveStatus` derivation: add `paneActive` as a high-priority input to `resolveEffectiveStatus`. When `paneActive === true`, effective status is `'working'` regardless of other signals (EXCEPT `sessionStatus === 'waiting'` — that passthrough at top of precedence MUST survive per Item 3).
   - Replace `actionLabel` derivation: when `paneActive && !codemanLabel && !legacyActionLabel`, fall back to a generic `"Working..."` label. (This is what Fix 1.7.A was trying to do; now it's driven by ground truth instead of timestamp guesswork.)

3. **Cleanup Fix 1.7.A deadweight:**
   - `shouldEngageWorkingFallback` and its setInterval render-trigger in ContextBar become obsolete when `paneActive` is the primary signal. DELETE them — reduces surface area + stops masking the real derivation.
   - `mostRecentAssistantMessageAt` helper (unused exported) — delete.
   - `WORKING_FALLBACK_MS`, `WORKING_FALLBACK_CEILING_MS` constants — delete.
   - Tests for Fix 1.7.A — delete (they were testing the deadweight).
   - This is a net LOC reduction, not expansion.

4. **Do NOT touch:**
   - `resolveEffectiveStatus` body precedence chain (you may ADD an input, not change existing waiting-passthrough or codeman-precedence logic).
   - `useChat.ts`, `useToolExecutionState.ts`, `pendingLocalFilter.ts`, 15.3-arc guards, Item 3 `usePromptDetection.ts`, M7/M8 surfaces.
   - `TmuxMirror.tsx` (new hook subscribes to same channel; no changes to existing TmuxMirror).
   - Server-side: `status-poller.service.ts`, `tmux.service.ts`, WS event types. Zero server edits.

### Tests (minimum 6)

1. `paneActivelyChanging` flips true when pane hash changes within window.
2. `paneActivelyChanging` flips false after window elapses with no change.
3. Per-session isolation — two hook instances with different sessionIds track independent state.
4. Unmount cleanup — WS subscription released, no leak.
5. ContextBar Stop button visible when `paneActive === true` AND other signals false (the primary closure for Jose's observed bug).
6. Waiting-passthrough preserved — `sessionStatus === 'waiting'` still dominates regardless of `paneActive` (Item 3 sacred).

### Acceptance (Gate 1 from Finalizer smoke, re-run)

Jose submits long pure-text prompt. Within ~3s of response starting to fill Live Terminal (first pane content change), ContextBar flips to "Working..." and Stop button appears. Both stay visible throughout streaming. When response finishes and pane is stable 3+ seconds, ContextBar flips to "Idle" and Stop button hides.

### Candidate 36 incidental audit

While implementing `useSessionPaneActivity`, exercise it in your own split-view Commander (PM + CODER panes). Two observations:

- If `paneActivelyChanging` fires for PM's pane when only CODER is actually working (or vice versa), THAT is Candidate 36 — the subscription layer IS leaking between sessions. Document the leak shape in your commit body AND fix it in the same commit if it's a narrow channel-keying bug.
- If both panes' activity states stay correctly scoped, Candidate 36 is a display bug in `TmuxMirror`'s rendering (not the underlying subscription) — defer to native rebuild.

Do NOT spend more than 30 min on C36 audit. If inconclusive, DEFER.

### Commit 1 summary

- **Files touched:** `client/src/hooks/useSessionPaneActivity.ts` (NEW), `client/src/components/chat/ContextBar.tsx`, `client/src/utils/contextBarAction.ts` (delete obsolete helpers), test file.
- **LOC:** ~80-100 new hook, ~50 ContextBar integration, -100 Fix 1.7.A deadweight = net ~30-50 LOC added.
- **Commit message:** `fix(ui): Commander Finalizer FINAL — status bar driven by Phase T pane activity (ground truth isWorking)`.

---

## §3 — Track 2: Candidate 39 rapid-fire scroll-anchor

**Per Finalizer §4 B.2 (original dispatch).** ≤25 LOC at `ChatThread.tsx:434` auto-scroll gate. User-sent override branch above `isAtBottom` check — own submits ALWAYS scroll to bottom regardless of prior scroll position. Account for footer clearance.

Tests: 3+. Independent commit.

Commit message: `fix(ui): Commander Finalizer FINAL — Candidate 39 rapid-fire scroll-anchor`.

---

## §4 — Track 3: Candidate 27 synthetic-id reconciliation

**Per Finalizer §5 (original dispatch).** Server-side hooks route. Rewrite-on-first-hook if ≤30 LOC, else TTL-delete. CODER judgment call.

Tests: 3+. Independent commit.

Commit message: `fix(server): Commander Finalizer FINAL — Candidate 27 synthetic-id reconciliation`.

---

## §5 — Track 4: Candidate 44 attachment drop

**Investigate + narrow-fix if feasible, else defer.**

**Symptom:** User drag-drops MD file into chat input, no text, presses Enter. File path appears as `@/absolute/path/filename.md` text in chat input (as if user typed it). Submit doesn't fire.

**Investigation steps (≤30 min cap):**
1. Find the drag-drop handler in `ChatPage.tsx` or attachment-handling code.
2. Trace what happens when a file is dropped — is it staged as an attachment object, or transformed to a `@<path>` text reference?
3. Check submit path — does Enter-key handler recognize the `@<path>` pattern? Does it convert to attachment on submit? Or does it block submit because text field is "dirty" with uncommitted paste?

**Fix decision tree:**
- If drop handler writes `@<path>` to text field AND submit handler doesn't recognize the pattern: narrow fix — either drop handler should stage the file as a real attachment (not text), OR submit handler should parse `@<path>` patterns and resolve to attachments on submit. Pick whichever is smaller.
- If `@<path>` is Claude Code's canonical attachment syntax and the real bug is elsewhere (e.g., submit blocked by Enter-key race): narrow fix at the real bug.
- If investigation exceeds 30 min without a clear narrow fix shape: DEFER, log mechanism in PHASE_REPORT for native rebuild backlog.

Tests: 2+ if fix shipped, else 0.

Commit message (if shipped): `fix(ui): Commander Finalizer FINAL — Candidate 44 attachment drop submit`.

---

## §6 — Acceptance gate (Jose browser smoke, per-commit)

For each shipped commit, Jose smokes ONE dedicated case:

| Track | Gate case |
|---|---|
| 1 | Long pure-text prompt → Stop button visible throughout streaming, hides when response settles |
| 2 | Send 3 messages rapidly → all three visible with breathing room above footer |
| 3 | Cold-restart Commander with existing tmux session → synthetic row reconciled on first hook |
| 4 | Drag-drop file, no text, Enter → submit fires with file attached |

Non-regression sweep (1 min):
- Effort dropdown works.
- Normal text message optimistic bubble clears within 1-3s (C41).
- Approval modal mounts (1.7 Case C).
- LiveActivityRow no bleed on post-text thinking (1.7 Case D).

Ship per-commit. Don't wait for all four tracks.

---

## §7 — File boundaries (hard exclusions)

Do NOT touch:
- `useChat.ts`, `useToolExecutionState.ts` (Phase Y 1.6.B frozen).
- `pendingLocalFilter.ts` (C41 `9ce2a60` frozen).
- `usePromptDetection.ts` (Item 3 sacred).
- `useCodemanDiffLogger.ts`, `debug.routes.ts`, JSONL file.
- 15.3-arc guards (typedIdleFreshKillSwitch, lastTurnEndTs, isSessionWorking OR-chain body, Fix 1/2/Option 2/4/Activity-gap, heartbeat-stale).
- M7 (`ProjectStateDrawer`, `useProjectStateMd`).
- M8 (`effortCard`, SessionCard effort dropdown, CreateSessionModal effort selector).
- Phase T primary path (`usePreference`, status-poller emit path, `emitSessionPaneCapture` signature — new hook just consumes the existing event).
- `resolveEffectiveStatus` / `resolveActionLabelForParallelRun` BODY logic (you may pass `paneActive` as an additional input; do not modify waiting-passthrough or codeman-precedence).
- `TmuxMirror.tsx` (existing mirror renderer — new hook subscribes to same channel, don't touch the mirror).

OK to touch:
- `ContextBar.tsx`, `contextBarAction.ts` (delete 1.7.A deadweight).
- `ChatThread.tsx` (Track 2).
- Server hooks route (Track 3).
- ChatPage.tsx drop handler (Track 4, if narrow fix).
- Test files under `client/src/**/__tests__/`, `server/src/**/__tests__/`.
- New file: `client/src/hooks/useSessionPaneActivity.ts`.

---

## §8 — Rejection triggers

(a) Any track exceeds 90 min — STOP + defer, do not stretch.
(b) Hard-exclusion file touched.
(c) Ship-green claim without Jose smoke on that track's gate case.
(d) Speculative patch on C36 without live-capture evidence in your own split view.
(e) Fix 1.7.A deadweight NOT cleaned up when Track 1 ships (the whole point is to replace the broken predicate, not stack another layer).
(f) `TmuxMirror.tsx` modified (new hook subscribes to same channel, mirror renderer untouched).
(g) `resolveEffectiveStatus` waiting-passthrough broken (Item 3 sacred — pin with test).
(h) More than 30 min on C36 audit.
(i) More than 30 min on C44 investigation without narrow fix shape — defer.

---

## §9 — Post-rotation sequencing

After this ships (partial or full):
1. PM updates STATE.md with final Commander status.
2. Commander bug work PAUSES per `project_commander_finalizer_then_migration`.
3. PM fetches CTO migration plan (Jose has already shared it; plan is at the user-provided MIGRATION_PLAN.md reference).
4. Next architectural phase dispatched — M3.6 recon first, then M4 pilot, etc.
5. Remaining deferred Commander candidates (C36 if not closed here, C44 if deferred, C29/C30/C34/C35/C40/C42-resolved/C43) stay in backlog for native rebuild.

---

## §10 — Standing reminders

Per `feedback_understand_before_patching`: Jose's reframe is earned — Phase Y derivation IS architecturally broken in web. Don't try to patch it further. Drive from Phase T ground truth.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own split-view Commander is the Track 1 + C36 audit repro.

Per `feedback_vite_stale_code`: cold-restart dev server before own smoke.

Per `feedback_phase_report_paste_signal`: explicit "ready to forward to PM" at end of PHASE_REPORT.

Per OS §20.LL-L11/L12: if Track 1 lands unit-green but live smoke shows Stop still invisible, DO NOT stack another fix — instrument `useSessionPaneActivity` output to see what's actually being received, and report.

Per `feedback_defer_nonblocking_bugs_to_native_rebuild`: if in doubt, defer.

Go.
