# Commander Finalizer Part 2 — Deferred Tracks from Finalizer Part 1

**From:** PM (Commander, 2026-04-21)
**To:** CODER (FRESH SPAWN REQUIRED — Finalizer Part 1 exhausted context at 85% and deferred these three tracks. A context-clean spawn is the only correct pipe.)
**Type:** Three narrow follow-up tracks. Multi-commit authorized. Autonomous execution per `feedback_authorize_autonomous_coder_rotations` + split discipline per `feedback_split_large_rotation_on_context_pressure`.
**Preceded by:** `db24eb0` (Commit A: Stop visibility + Stop routing pin) + `c33ee5a` (Commit B partial: C38 attachment error surfacing) shipped 2026-04-21 by Finalizer Part 1. Client suite 487 → 508. Deferred: A.2 (Candidate 36 display leak), B.2 (C39 scroll-anchor), original Commit C (C27 synthetic-id).
**Status:** Jose-authorized. Jose browser smoke on Gates 1/2/4 runs in parallel to this dispatch's execution.

---

## §1 — Scope + context

This dispatch is the focused follow-up for three tracks that Finalizer Part 1 scoped but didn't ship. All scope specs below are **verbatim pointers** into the original Finalizer dispatch — read that document for full context, this one for execution sequencing.

**Original dispatch:** `docs/dispatches/COMMANDER_FINALIZER_DISPATCH.md`
**Relevant sections:** §3 A.2 (Candidate 36) / §4 B.2 (Candidate 39) / §5 Commit C (Candidate 27)

Three commits, independent, ship each as soon as ready. Safety ordering:

| Commit | Track | Scope reference | Priority |
|---|---|---|---|
| **D** | A.2 — Candidate 36 effort cross-session display leak | Finalizer §3 A.2 (D5/D6 instrument-and-fix) | **P1** — user-visible, split-view impact |
| **E** | B.2 — Candidate 39 rapid-fire scroll-anchor | Finalizer §4 B.2 (≤25 LOC in ChatThread.tsx:434) | P2 — UX polish |
| **F** | C — Candidate 27 synthetic-id reconciliation | Finalizer §5 (rewrite-on-first-hook OR TTL-delete) | P2 — data-layer hygiene |

---

## §2 — Commit D: Candidate 36 D5/D6 inline investigation + fix

**Execute per Finalizer §3 A.2 exactly.** Key reminders:

1. **D5 instrumentation** at `TmuxMirror.tsx` subscribe site. Tag `[cand36-d5-instr]`, dedupe-gated, grep-strippable. Log `(propsSessionId, subscribedChannel, mountCount, lastCleanupReason)`.
2. **D6 instrumentation** at `status-poller.service.ts` `emitSessionPaneCapture` call site. Tag `[cand36-d6-instr]`. Log `(session.id, session.tmux_session, derivedChannel, paneTextHash)`.
3. **Jose capture REQUIRED before fix** — Finalizer Part 1 exhausted without reaching this step because static analysis can't disambiguate Shape 1 vs Shape 2. You (CODER) need either:
   - (a) Self-dogfood in your own Commander split view — PM + CODER panes, `/effort high` on PM, export DevTools console dump, OR
   - (b) Ship instrumentation commit first, hand to Jose for capture, receive his dump, then ship fix commit.

   **Jose-directed preference:** pick (a) if you can reliably repro in your own session. Pick (b) if your own session isn't producing the leak or you can't reproduce split-view reliably.

4. **Strip verification before committing the FIX** — `grep -rn '\[cand36-.*-instr\]' client/src server/src` returns empty. `git diff --stat` on the fix commit shows ZERO instrumentation lines.

5. **Fix Shape selection** per Finalizer §3 A.2. Shape 1 (subscribe drift) or Shape 3 (emit channel suffix) are CODER-dispatchable narrow fixes. Shape 2 (two sessions sharing tmux_session value) is a data-layer reconciliation — if capture points here, FLAG AS MAJOR and pause, PM will redispatch Shape 2 separately.

**Tests:** 3+ per Finalizer §3 A.2 spec.

**Commit message:** `fix(ui): Commander Finalizer Part 2 — Candidate 36 display leak localized + closed`. Body cites which Shape was chosen + D5/D6 capture summary (without leaving the instrumentation in the diff).

---

## §3 — Commit E: Candidate 39 rapid-fire scroll-anchor

**Execute per Finalizer §4 B.2 exactly.** Scope reminder: ≤25 LOC at `ChatThread.tsx:434` auto-scroll gate. Add user-sent override branch above the `isAtBottom` check — own submits ALWAYS scroll to bottom regardless of prior scroll position. Account for footer clearance (spacer OR measured footer height offset).

**Tests:** 3+ per Finalizer §4 B.2 spec.

**Commit message:** `fix(ui): Commander Finalizer Part 2 — Candidate 39 rapid-fire scroll-anchor`.

---

## §4 — Commit F: Candidate 27 synthetic-id reconciliation

**Execute per Finalizer §5 exactly.** Server-side. Find hooks route handler, add reconciliation-on-first-hook for synthetic-id rows (`<8hex>-0000-0000-0000-000000000000` id + `recovered-jsc-*` name). CODER judgment call: rewrite vs TTL-delete. Flag choice in commit body.

**Tests:** 3+ per Finalizer §5 spec.

**Commit message:** `fix(server): Commander Finalizer Part 2 — Candidate 27 synthetic-id reconciliation`.

---

## §5 — Combined acceptance gate (post all three commits)

The three remaining Finalizer browser-smoke cases:

3. **Effort change per-pane in split view** — change PM's effort. PM's Live Terminal shows change. CODER's Live Terminal shows nothing. **(Closes Candidate 36.)**
5. **Rapid-fire scroll** — send 3 messages back-to-back. All three visible with breathing room above footer. **(Closes Candidate 39.)**
6. **Synthetic-id reconciliation** — cold-restart Commander with existing tmux session. After first hook fires, session row has real `claude_session_id`, not the zeros-suffixed synthetic. **(Closes Candidate 27.)**

Gates 1 + 2 + 4 from Finalizer Part 1 are running Jose smoke in parallel to this rotation — report back but don't block on them.

**Ship per-commit:** each commit (D/E/F) is independently shippable the moment its tests green. Don't wait for all three before pushing to main.

---

## §6 — File boundaries (inherits Finalizer §8 + Part 1 new frozen surfaces)

Do NOT touch (ALL frozen):
- `useChat.ts`, `useToolExecutionState.ts` (Phase Y 1.6.B frozen).
- `pendingLocalFilter.ts` (Candidate 41 `9ce2a60` frozen).
- `ContextBar.tsx` Stop button gate + render-trigger (Finalizer Part 1 `db24eb0` just shipped — A.1 is frozen; A.2 below does not need to touch this file).
- `useCodemanDiffLogger.ts`, `debug.routes.ts`, `~/.jstudio-commander/codeman-diff.jsonl`.
- 15.3-arc legacy guards (all of them, listed in Finalizer §8).
- `usePromptDetection.ts` (Item 3 sacred).
- M7/M8/Phase T primary surfaces (poller mirror tee call site IS in-scope for A.2 Shape 3).
- `resolveEffectiveStatus`, `resolveActionLabelForParallelRun` body (signatures frozen).

Touch (per commit):
- **Commit D:** `TmuxMirror.tsx`, `status-poller.service.ts` (emit call site only for Shape 3), potentially one shared helper if channel-derivation is refactored. Plus test file.
- **Commit E:** `ChatThread.tsx`. Plus test file.
- **Commit F:** one server-side hooks route file (CODER locate). Plus test file.

---

## §7 — Rejection triggers

(a) Ship-green claim without Jose browser smoke on Gate 3 / 5 / 6.
(b) Hard-exclusion file touched.
(c) Speculative patch on Candidate 36 without D5/D6 capture first.
(d) Instrumentation left in fix commit (strip verification required, see §2 step 4).
(e) Shape 2 selected without MAJOR flag + PM redispatch.
(f) Commit D or E exceeds 50 LOC excluding tests. Commit F exceeds 60 LOC excluding tests. If scope-creeping, flag MAJOR.
(g) Context exhaustion without partial-commit ship — per `feedback_split_large_rotation_on_context_pressure`, stop and commit what's ready rather than leaving tracks incomplete.
(h) `[codeman-diff]` logger or JSONL touched.

---

## §8 — Standing reminders

Per `feedback_understand_before_patching` + OS §20.LL-L11/L12: Candidate 36 has already been misdiagnosed once (PM's M8 Primary cross-session-routing hypothesis REFUTED by Candidate 36 diagnostic at `05bb3c7`). Let D5/D6 capture drive; do not anchor on a Shape prematurely.

Per `feedback_split_large_rotation_on_context_pressure`: each commit stands alone. Ship D, E, F independently.

Per `feedback_self_dogfood_applies_to_status_fixes`: your own split-view Commander is the Candidate 36 repro environment.

Per `feedback_vite_stale_code`: cold-restart before own smoke.

Per `feedback_phase_report_paste_signal`: explicit "ready to forward to PM" at end of PHASE_REPORT.

Per `feedback_authorize_autonomous_coder_rotations`: you own MINOR scope decisions; MAJOR flags come to PM.

Go.
