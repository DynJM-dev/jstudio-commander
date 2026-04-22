# CTO Brief — Commander Finalizer CLOSED, Migration Plan Re-Entry

**From:** PM (Commander, 2026-04-22)
**To:** CTO (Claude.ai thread)
**Previous brief:** `docs/briefs/CTO_FULL_REHYDRATION_2026-04-21.md` (full rehydration, 376 lines, 2026-04-21 morning)
**Scope:** ~24 hours of work since last brief. Covers Phase Y closeout, Commander Finalizer arc, ground-truth pivot, and migration plan re-entry.

---

## §1 — Snapshot

| Question | Answer |
|---|---|
| What phase are we in? | **Commander bug work PAUSED. Migration plan resumes next.** |
| What shipped since last brief? | Phase Y Rotations 1.5 hotfix + 1.6 + 1.6.B + 1.7 + Candidate 41 + Commander Finalizer Parts 1 + 2 FINAL (4 tracks). 15+ commits. |
| Current test suite | Client 524/524 + Server 385/385 + Shared 34/34. Typecheck clean. |
| Next PM action | This brief → CTO review → M3.6 recon (jstudio-meta / jstudio-site split) → migration plan forward motion. |
| What's the biggest change in posture? | **Native rebuild ratified as final migration phase** (Jose directly stated). Heavy Commander bugs defer there. Web Commander gets only safety-critical + small/low-input fixes going forward. |

---

## §2 — What shipped since last brief (chronological)

### 2026-04-21 Phase Y arc closeout

**Rotation 1.5 hotfix (`5a1bc23` + `df5439b`)** — Fix A (`resolveEffectiveStatus` with codeman override + waiting passthrough preserved), Fix B (`resolveActionLabelForParallelRun` suppresses legacy label leak when codeman says idle), Fix C (`streamingAssistantId` 3s stability timer in `useChat`). Three JSONL divergence classes addressed. Tests 381 → 397.

**Candidate 36 instrumentation rotation (`05bb3c7`)** — four-point instrumentation (P1 SessionCard, P2 ContextBar, P3 server POST /sessions/:id/command, P4 server tmux.sendKeys). Single Jose-executed split-view capture. **Effort send path proven CLEAN at every decision point.** PM's original hypothesis (cross-session routing bug analogous to Candidate 19 ESC leak) was REFUTED. Investigation-first discipline vindicated — fix would have been speculative-off-target. Leak localized downstream to Phase T mirror display layer (hypothesis only; D5/D6 rotation deferred).

**Rotation 1.6 instrumentation (`e05093a`)** — CODER-executed `[phase-y-1.6-instr]` capture at D1-D4 decision points on `useChat` reconciler + composing branch + `resolveActionLabelForParallelRun` entry + ContextBar callsite. Diagnostic reinterpretation: **Class 1 was composing firing TOO BRIEFLY, not stuck.** Server `session.status` stays idle during real streaming → useChat poll drops to 5s idle cadence → reconciler rarely sees sustained tail → composing flashes 1-3s at turn-end instead of throughout. PM's audit reading of 185s + 162s stuck-composing runs was WRONG — those were TRUE long-streaming turns. OS §20.LL-L12 case in action (diagnostic docs can be wrong about mechanism).

**Rotation 1.6.B (`afb6964`)** — Fix D (role-stability tuple predicate on useChat reconciler) + Fix E (active-poll 30s window post userSend). Two useChat-only fixes. Tests 411 → 430. Case 1 live smoke FAILED as framed (continuous "Composing..." throughout long streams unachievable in web).

**Phase Y Closeout (`93312e4`)** — `docs/phase-y-closeout.md`. **Architectural ceiling acknowledged**: `useChat.messages` doesn't update incrementally during Claude turns (tool chips + full response appear all at once at turn-end; ContextBar stays Idle throughout). Root cause upstream of client (Claude Code JSONL write pattern, server watcher-bridge emission timing, or client WS consumption). Requires server-side instrumentation to distinguish — Jose-directed NOT to pursue. **Chat window = semantic summary. Live Terminal = ground truth. Native rebuild = correct architecture for real-time chat status.**

**Rotation 1.7 closeout fixes (`94536b5`)** — Fix 1.7.A (conservative "Working..." fallback helpers scaffolded but dormant), Fix 1.7.B (tool chip render audit — sound, no regression), Fix 1.7.C (liveThinking scan narrowing — closes Candidate 42 post-text thinking bleed). Tests 430 → 459 (+29). Case A FAIL, Cases C + D PASS. Fix 1.7.A helpers dormant because render-trigger gap — fallback predicate never re-evaluated.

### 2026-04-21 Candidate 41 autonomous ship (`9ce2a60`)

CODER shipped pre-Finalizer without explicit dispatch. New `client/src/utils/pendingLocalFilter.ts` pure helper with three-gate retention rule (canonical text match / 60s hard ceiling / 10s+sessionAck). Four failure modes closed: slash commands never echoed, classifier-lagged pure-text turns, api.post silent failures, refresh-driven disappearance (mitigated via ceiling, full fix defers to native rebuild). Tests 459 → 487 (+28). Autonomous behavior was on-policy for this rotation class.

### 2026-04-21 Commander Finalizer Part 1 (`db24eb0` + `c33ee5a`)

**Partial ship** — 2 of 3 tracks. Commit A: Fix 1.7.A activation (Path 1) via setInterval render-trigger + simplified predicate + Stop button gate extension + Stop routing per-pane regression pin (5 tests). Commit B partial: Candidate 38 attachment submit error surfacing. Deferred: A.2 (C36 D5/D6), B.2 (C39), Commit C (C27). Context exhaustion at 85% triggered CODER's new `feedback_split_large_rotation_on_context_pressure` memory. Tests 487 → 508 (+21).

**Jose live smoke: Gate 1 FAIL.** Stop button still invisible during work because `ChatPage.tsx:242` clears `userJustSent` immediately when `session.status === 'idle'` — Phase Y ceiling means sessionStatus stays idle during real work → userJustSent flips false within one render cycle → Fix 1.7.A's predicate short-circuits on line 211 `if (!args.userJustSent) return false` → fallback never engages. The fix was layered on top of a broken foundation. Jose verdict: "The issue with Stop is our status bar which is mostly Idle when it's working. It should still say something simple like Working while the terminal is still active." **Reframe earned.**

### 2026-04-22 Commander Finalizer Part 2 FINAL (`0c87230` + `2da88c1` + `1ec2d47` + `a6ca156`)

**Full 4-track ship** — first clean finalizer in the Phase Y arc.

- **Track 1 load-bearing (`0c87230`, NET −38 LOC)**: status-bar reframe via Phase T pane activity. New `useSessionPaneActivity(sessionId)` hook subscribes to existing `pane-capture:<sessionId>` WS channel (zero server edits), hashes pane content, returns `paneActivelyChanging` boolean. Wired into `resolveEffectiveStatus` at precedence-2 (below waiting passthrough Item 3 sacred, above codeman). Stop button gate becomes `paneActive || isWorking || hasPrompt || interrupting` — ground truth during silent pure-text turns. **Fix 1.7.A deadweight fully deleted** — replaced the broken predicate with ground-truth signal, didn't stack on top. Tests +38 new.
- **Track 2 (`2da88c1`, +15 prod LOC)**: Candidate 39 rapid-fire scroll-anchor — user-sent override branch above `isAtBottom` gate + footer clearance.
- **Track 3 (`a6ca156`, +22 prod LOC server)**: Candidate 27 synthetic-id reconciliation on first hook fire (rewrite-on-first-hook chosen over TTL-delete). +7 server tests.
- **Track 4 (`1ec2d47`, +18 prod LOC)**: Candidate 44 attachment drop — client-side stage-and-submit path fixed.

**Jose live smoke**: Gate 1 PASS (status accurately reflects real work, Stop visible throughout streaming), Gate 2 PASS for C39 scope, Gate 3 SKIP (pinned by unit tests), Gate 4 PARTIAL (client-side closed, tmux-relay residual — Commander UI rendered send but tmux never received; defer to native rebuild).

### Test/production ratio across the 4 finalizer commits

4-9x test/production across all commits. Track 1 net-NEGATIVE (biggest fix of the rotation, shrank the codebase). All 4 commits stayed under dispatch LOC caps. Zero hard-exclusion files touched.

---

## §3 — Architectural lessons from the Phase Y arc (worth canonicalizing)

### Lesson 1 — Web Commander's transcript pipeline cannot drive real-time status

The Phase Y design premise was "derive status purely from `ChatMessage[]`." The `ChatMessage[]` array is hydrated from the JSONL transcript. **If the JSONL transcript doesn't surface the assistant's in-progress content until turn-end (for whatever reason in the Claude Code ↔ server ↔ client pipeline), the derivation has nothing to observe.** Three non-exclusive candidate mechanisms left un-investigated per Jose's cost-bounded call: (a) Claude Code's JSONL write pattern, (b) server watcher-bridge emission batching, (c) client WS consumption / mergeDelta deduplication. We stopped investigating because the fix would still be architectural — the right answer is ground-truth from the terminal surface.

### Lesson 2 — Phase T (tmux mirror) was the correct abstraction all along

The Live Terminal pane renders tmux content directly, bypassing the JSONL pipeline, and is live for every kind of turn (thinking, tool, text). Phase Y Rotation 1.6.B shipped three fixes trying to patch the transcript-derivation. The Finalizer Track 1 reframe replaced them all with ~100 LOC subscribing to the same WS channel Phase T already emits on. **The ground-truth signal was one hook away the whole time.** We layered five rotations of fixes on a broken foundation before Jose's plain-language reframe cut through.

### Lesson 3 — Investigation-first discipline produced two direct wins

- **Candidate 36 diagnostic (`05bb3c7`)** refuted PM's own hypothesis. Send path proven clean at 4 instrumented points. Speculative-fix would have been off-target.
- **Rotation 1.6 instrumentation (`e05093a`)** reinterpreted Class 1 from "stuck composing" (PM's audit reading) to "under-fire composing" (CODER's capture evidence). The speculative Rotation 2 deletion would have fired on wrong-cause evidence.

Both codified into OS §20.LL-L11 + L12 + `standards/INVESTIGATION_DISCIPLINE.md` last week. The arc validated the canon.

### Lesson 4 — Autonomous CODER + strict dispatch caps + per-commit discipline = clean batches

The 4-commit Finalizer Part 2 FINAL shipped in a single autonomous rotation with per-commit discipline (Jose's `feedback_authorize_autonomous_coder_rotations` + `feedback_split_large_rotation_on_context_pressure` memories). 4-9x test/prod ratios. Zero hard-exclusion files touched. Partial-ship contingency honored (context exhaustion in Part 1 didn't sink safety-critical work).

Counter-case: earlier in the arc, multiple rotations shipped unit-green and failed live smoke because the dispatch premise was architecturally broken (Phase Y can't do what it's trying to do). Unit tests pin CONTRACT, not REALITY. Jose-smoke-gated ships is load-bearing.

### Lesson 5 — Jose's plain-language reframes are often correct

Direct quote 2026-04-21: "The issue with Stop is our status bar which is mostly Idle when it's working. It should still say something simple like Working while the terminal is still active and then just idle when response comes in." This sentence unblocked the arc. PM had been chasing predicate-and-timestamp derivations for 5 rotations. Jose restated it as the actual user-observable requirement. Ground truth was obvious once stated.

Worth canonicalizing: when Jose reframes a bug in plain language, that reframe is usually the correct target. PM's job is to match the architecture to that reframe, not convince Jose of the technical current.

---

## §4 — Commander Finalizer closure + native-rebuild backlog

### Closed in web Commander (final state)

- Phase Y Rotation 1.5 fixes (A + B + C)
- Phase Y Rotation 1.6.B (Fix D role-stability + Fix E poll-cadence)
- Phase Y Rotation 1.7 closeout (Fix 1.7.C liveThinking narrowing + tool chip audit)
- Candidate 41 pendingLocal retention + api.post cleanup
- Commander Finalizer Part 1 (Stop visibility attempt — superseded by Track 1)
- Commander Finalizer Part 2 FINAL (status-bar reframe + C39 + C27 + C44 client-side)

### Deferred to native rebuild

- **C44 residual** — tmux send-keys relay for attachment-only messages. Client-side fixed; server-relay path not audited.
- **C36 display layer** — effort cross-session display leak. Subscription layer confirmed clean; render-layer hypothesis remaining. Four investigation sub-hypotheses enumerated in finalizer dispatch; Jose-ratified defer.
- **C26** — session-tick retention migration + UNIQUE constraint. Data-layer scope, not bug-class.
- **C29** — `task_reminder` renderer gap (CODER's original triage missed it; Jose confirmed live). Queued with C30/C35/C40 as renderer-registry family.
- **C30** — markdown renderer visual parity with VSCode Claude.
- **C34** — permission-mode selector (new UX surface, cheaper to build native-first).
- **C35** — renderer-registry extension for unmapped Claude Code subtypes.
- **C40** — same family; enumerate unmapped system subtypes.
- **C42** — CLOSED by Fix 1.7.C.
- **C43** — never opened (was a "if Fix 1.7.B audit found a regression" placeholder; audit confirmed sound).

### Active freeze list (hands-off surfaces)

- `useChat.ts`, `useToolExecutionState.ts` (Phase Y 1.6.B frozen).
- `pendingLocalFilter.ts` (C41 frozen).
- `usePromptDetection.ts` (Item 3 sacred — approval modal path).
- `useCodemanDiffLogger.ts`, `debug.routes.ts`, `~/.jstudio-commander/codeman-diff.jsonl` (Phase Y parallel-run logger stays live indefinitely; Rotation 2 deletion deferred — legacy guards provide harmless fallback).
- 15.3-arc legacy guards (typedIdleFreshKillSwitch, lastTurnEndTs, isSessionWorking OR-chain, Fix 1/2/Option 2/4/Activity-gap, heartbeat-stale).
- `resolveEffectiveStatus` / `resolveActionLabelForParallelRun` bodies (signatures OK to extend, body logic byte-identical).
- `TmuxMirror.tsx` (new `useSessionPaneActivity` subscribes same channel, mirror renderer untouched).

---

## §5 — Migration plan re-entry (next PM action)

Last brief ended at "M3.5 shipped, about to start M3.6". Jose ratified M3.6 as next phase during the Commander finalizer arc but we didn't execute.

### M3.6 scope recall

**Split `~/Desktop/Projects/jstudio-meta/` into two directories:**
- `~/Desktop/Projects/jstudio-meta/` — pure company ops (OS, playbook, templates, standards, migration state, cross-project knowledge).
- `~/Desktop/Projects/jstudio-site/` — the agency Firebase website as a standalone JStudio project.

### Recommended first step

**PM-executed recon** (no CODER dispatch yet):
1. List current contents of `~/Desktop/Projects/jstudio-meta/`.
2. Classify each file/folder as "ops" (stays) or "agency site" (moves).
3. Identify any file referenced by hardcoded path from elsewhere (skills, bootstraps, CLAUDE.md).
4. Produce a split manifest — what moves, what stays, what references need updating.

This is 30-60 min of PM work. Deliverable: `docs/briefs/M3.6_SPLIT_MANIFEST.md` for CTO to ratify before any filesystem operations.

### After M3.6 ratified + executed

Sequence per migration plan:
- **M4** — pilot project migration (recommended: JL Family Office per plan §M4). 1 session.
- **M5** — batch migration of remaining projects (Elementti, PP Seguros, Commander, RIFA2RD, OvaGas, Rodeco). 2-3 sessions.
- **M6** — disconnect PM ↔ Coder auto-forwarding in Commander. Narrow. (Note: teammate-spawn flow may already reflect this; needs audit.)
- **M9** — skill audit. Can parallelize with M5/M6.
- **Native Commander rebuild** — final phase, separate brief + scope.

---

## §6 — Open questions for CTO

1. **Ratify the Finalizer closure posture.** C44 residual defer-to-native-rebuild — agree or push back? C36 display layer defer — agree or require one more D5/D6 rotation?
2. **M3.6 sequencing.** PM-executed recon first → split manifest → CTO ratification → CODER execution. Or single-shot PM+CODER in one session? I lean recon-first for risk reduction; filesystem ops on live folders are unforgiving.
3. **Native rebuild scoping timing.** Start scoping after M3.6 (parallel to migration batch work), or after full migration (M5+M6+M9 done)? I lean parallel — native rebuild brief can be written while migration work runs.
4. **Phase Y parallel-run logger (`~/.jstudio-commander/codeman-diff.jsonl`) — keep or retire?** Rotation 2 deletion was deferred pragmatically (legacy guards + logger provide harmless fallback). 324 entries accumulated. No audit value remaining — the arc is closed. Retire (delete logger + debug route + JSONL) as part of M9 skill audit, or leave in perpetuity?
5. **OS addition candidate.** Lesson 5 ("Jose's plain-language reframes are often correct") — worth adding to OS §20.LL as L13, or over-general?

---

## §7 — Token burn + velocity

(Per TOKEN_ANALYTICS_2026-04-17.md Jose shared:)
- Last 14 days: **$8,719 total spend** across 15 sessions. Heavy peaks on 2026-04-17 ($4,598) + 2026-04-15 ($3,213). Cache hit rate 100% across all days.
- Top spenders: JL Family PM session ($2,206), Commander coder-9 ($1,796), Commander lead-pm ($1,624), Commander coder-16 ($1,077), JLP coder ($1,072). **Commander project alone: $4,497 last 14 days.**
- Post-Phase-Y arc reflection: spend pattern shows the cost of speculative-fix rotations. The Finalizer Part 2 FINAL (clean ship, 4 commits, ground-truth pivot) cost a fraction of earlier rotations because it replaced a broken layer instead of patching on top.

---

## §8 — Meta observations

- **Manual-bridge model works but has friction.** Jose is the CTO ↔ PM ↔ CODER bridge. Every round-trip costs him attention. This brief + CTO response + M3.6 dispatch + CODER PHASE_REPORT = 4 bridge crossings for one architectural phase. Native rebuild should preserve the human-in-the-loop invariant but reduce bridge latency (unified UI for brief review + dispatch compose + report consumption).
- **Live-smoke is load-bearing.** Three speculative-fix rotations in the Phase Y arc shipped unit-green and failed live-smoke before instrumentation-first discipline landed. The canon now enforces it.
- **Autonomous CODER with strict dispatch caps produces cleaner batches than PM-in-the-loop multi-round dispatches.** Finalizer Part 2 FINAL proved this. Worth defaulting to when scope is clear.
- **Defer-to-native-rebuild rule has saved significant cycles.** Jose-ratified posture: only safety-critical + small/low-input Commander bugs get fixed; heavier ones bank for native rebuild. Kept the Finalizer arc from spiraling further.

---

## §9 — What I recommend for the next CTO response

1. Confirm/adjust §6 open questions 1-5.
2. Approve M3.6 recon-first approach (or correct).
3. Approve native-rebuild parallel scoping (or defer).
4. Any OS updates or standards additions from the Phase Y arc lessons (§3).
5. Any skill-level tweaks observed from the Commander experience.

PM stands by for direction.

---

**End of brief.** Ready to forward to CTO. Full context at `STATE.md` top entries + `docs/phase-y-closeout.md` + 4 Finalizer commit bodies (`0c87230` / `2da88c1` / `1ec2d47` / `a6ca156`) + Rotation 1.6 diagnostic at `e05093a`.
