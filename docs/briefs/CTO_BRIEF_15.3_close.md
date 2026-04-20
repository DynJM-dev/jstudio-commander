# CTO_BRIEF — Issue 15.3 Close

**From:** PM (Commander)
**Date:** 2026-04-20
**Type:** Phase checkpoint + architectural observation
**Upload target:** Claude.ai CTO thread

---

## One-paragraph TL;DR

Issue 15.3 (canonical SessionState classifier + ContextBar label correctness) is CLOSED after ~15 rotations across two sessions. The original P0 — ContextBar reading "Idle — Waiting for instructions" during 20+ seconds of active tool execution — is fully fixed. Three speculative fix rotations shipped unit-green and failed live smoke before an instrumentation rotation broke the pattern and named the architectural class root cause. Two residual edge cases (intermittent activity gaps in multi-step tool sequences, intermittent 60s "Running command..." post-completion) remain as tracked candidates. Both reduce to the same structural cause: the server's `session.status` pane-regex classifier lags 2–60s unpredictably, and client-side OR-chain patches can't fully tame it without a Codeman-model refactor (derive working/idle from ChatMessage[] alone, ignore server pane classification). That refactor is out of 15.3 scope and queued.

---

## Arc summary

Issue 15.3 started as "canonical typed SessionState classifier to replace scattered pane-regex derivation." The typed `SessionState` union (`Idle | Working | WaitingForInput | Stopped | Compacting | Error` with subtypes) was designed and shipped in Phase 1 (`fee7f35`). Subsequent rotations progressively migrated UI surfaces and patched emission / consumption gaps:

- Phase 1 (`fee7f35`) — canonical server-side SessionState classifier, dual-emit on `session:status`.
- Phase 1.1 (`9abe598`) — emit on subtype change, broaden idle→working override.
- §6.1 (`ec3528a`) — invert `resolveActionLabel` Working-path so jsonlLabel wins over typed:ToolExec.
- §6.2 (`94e5c09`) — OR-gate `isSessionWorking` on client-side unmatched tool_use tail scan.
- §6.3 (`0aefcf1`) — exempt heartbeat-stale gate when a tool is in flight.
- §6.1.1 (`d60d0f6`) — thread `isWorkingOverride` composite from ChatPage to ContextBar.
- §6.4 Δ1 (`cf28597`) — drop POLL_INTERVAL 5000→1500ms.
- §6.4 Δ2 (`5d7f57c`) — exempt force-idle cooldown when pending tool_use in transcript.
- **Tier A Item 1 (`41c0f2c`) — REVERTED at `93b25dc`.** Reverse-scan last-assistant-run for tool_use. Shipped unit-green (299/299), failed live smoke identically to pre-fix. Root cause of failure: premise was wrong. v5 §11.1 had localized the bug to `getActionInfo`'s tail-block scan; instrumentation later proved `getActionInfo` was correct — the bug was downstream.
- Tier A Item 3 (`00f1c30`) — preserved. Removed `isActive` gate in `usePromptDetection`, scaled idle cadence to 8s.
- §12 instrumentation (`e41a3ee`) — the rotation that actually worked.
- Fix 1 + Fix 2 (`dab9896`) — close the architectural asymmetry §12 identified.
- Option 4 (`f9ab17d`) — symmetric hard-off on fresh typed-Idle.
- Option 2 (`7680da0`) — turn-bounded freshness lock on `unmatchedToolUse` true→false.
- Activity-gap (`4d85d02`) — hold `userJustSent` through pre-tool thinking window.

Final test state: 310/310 pass, typecheck clean. Three of five live-smoke cases consistently clean; two show intermittent residuals logged as Candidates 32 and 33.

---

## What §12 actually proved

The investigation-first instrumentation rotation is the inflection point of this arc. Prior rotations had been hypothesis-first — source-reading for a cause, shipping a fix against the hypothesis, failing live smoke, then speculating a new hypothesis. §12 forced runtime capture across five test cases with dedupe-gated logging at every decision point in the derivation chain.

The captured diff across the five cases named a single architectural class root cause:

**The client uses `session.status` (pane-regex classified, server-side) as the SOLE Working/Idle gate but uses `sessionState.kind` (typed, server-side) as the SOLE label-source gate. These two server signals can disagree for 15–20 seconds at a time.**

Case 2's capture showed `session.status = 'idle'` for 20 full seconds while `sessionState.kind = 'Working:ToolExec'` was emitted simultaneously. The typed working signal was already at the client, unconsumed by the coarse Working gate. Case 3 showed the inverse: `sessionState.kind = 'Idle:AwaitingFirstPrompt'` (stale) while `getActionInfo` had already produced `"Running command..."` — the rich label was clobbered by `resolveActionLabel`'s unconditional typed-Idle null-return.

Two coupled fixes (`dab9896`) — widen `isSessionWorking` to consume typed-Working with a freshness predicate, and let `resolveActionLabel`'s typed-Idle branch fall through to jsonlLabel when working — closed Case 2's P0 and Case 3's generic-label sub-bug. Two follow-on tighten commits (`f9ab17d` Option 4, `7680da0` Option 2) closed two subsequent trailing-edge cases. One UX addition (`4d85d02` Activity-gap) closed a pre-tool send-confirmation gap.

The discipline learned: we stopped dispatching code when speculation ran past evidence. Memory saved as `feedback_understand_before_patching.md`. Future project work treats "unit-green but live-smoke might fail" as zero acceptance signal.

---

## §20.LL-L10 — three instances, then a breakthrough

Issue 15.3 contained three distinct instances of "shipped unit-green, failed live smoke":

1. **16.1.1 (earlier)** — shared-layer `getContextLimit([1m]) === 1M` passed in isolation; modal integration broken because `priceDetail` did a parallel hand-rolled lookup.
2. **15.3 Phase 1.1** — decision-tree unit tests passed; typed state never emitted during real bash exec because the emission guard was in the wrong branch.
3. **15.3 Tier A Item 1** — 299/299 tests pass; live smoke failed identically to pre-fix because the fix targeted the wrong layer (`getActionInfo` was not the bug; `resolveActionLabel` was).

The §12 instrumentation rotation is the first time in the 15.3 arc that the fix dispatch was drafted from runtime evidence rather than source-reading hypothesis. The corresponding fix (`dab9896`) closed the P0 on first live smoke. That's the breakthrough.

Project discipline now codified:
- `feedback_understand_before_patching.md` — when a ship doesn't move the symptom, investigate runtime state before proposing another fix.
- `feedback_debug_with_real_data` — curl/DB/tmux/logs before code review; "looks correct" is not evidence.
- `feedback_self_dogfood_applies_to_status_fixes` — CODER's own Commander session IS the cheapest live testbed.

OS §20 LESSONS will be updated next maintenance pass with the "instrumentation rotation" pattern (temporary runtime logging with dedupe gates, 5-case capture protocol with working/failing control pair, strip-verified delivery) as a reusable discipline when a fix rotation fails live smoke.

---

## Residuals accepted

**Candidate 32 (P2) — Case 3 intermittent activity-missing on multi-step tool sequences.** Observed in final smoke: in a single Edit turn that dispatched three bash-style operations, the first two showed no activity indicator, the third did. Intermittent across runs.

**Candidate 33 (P2) — Case 5 intermittent 60s stuck "Running command..." post-completion.** Observed once in final smoke, absent in prior smoke on the same code. Same root class as 32.

Both residuals trace to the same architectural mechanism: `session.status` is the one remaining unguarded OR-branch in `isSessionWorking`. Server's pane-regex classifier holds 'working' for up to 60s post-completion depending on what text lingers on the pane. Client-side aggressive gating (Fix 1 freshness, Option 4 kill-switch, Option 2 turn-lock) tamed the typed-state signals; `session.status` cannot be tamed by another OR-chain patch without a structural refactor.

---

## Architectural observation — the refactor we didn't do

At the current architecture, Commander derives "is the session actively working right now?" from three server signals with independent latencies:

1. `session.status` — pane-regex classified. Lags 1.5s–60s depending on pane text.
2. `sessionState.kind` — typed, server-side. Cadence on poll + hook events.
3. `unmatchedToolUse` — client-side tail scan of ChatMessage[]. Cadence on useChat poll.

These three don't agree for seconds-to-tens-of-seconds at a time. Each 15.3 fix rotation has been a patch across their disagreement windows. Each patch closes one edge case and reveals another.

The Codeman project (Jose's separate tmux-based Claude client at `~/.codeman/app/`) uses a different architecture. Its `transcript-watcher.ts` derives tool-execution state from the JSONL ChatMessage[] alone — no server pane classification, no typed-state event stream, no OR-chain. A single scalar `currentTool: string | null` updates on each tool_use/tool_result parse. The UI component watches the same stream and labels accordingly. No asymmetry, no disagreement, no patches.

Commander cannot adopt Codeman's architecture wholesale this late in 15.3 — the typed SessionState event stream has 6+ consumers migrated and a migration would itself be an N-rotation arc. But the Codeman model is the answer for the two remaining residuals (Candidates 32 + 33) and also for Candidate 23 (Claude Code runtime contextLimit — same "trust client-side structured signals over server-derived values" family).

**Strategic recommendation for CTO consideration:** post-M7, a dedicated "structured-signal primacy" rotation that:
- Migrates Commander's ContextBar derivation from three-server-signal OR-chain to ChatMessage[]-authoritative (Codeman model).
- Resolves Candidates 32, 33, and 23 jointly as one architectural fix.
- Deletes `session.status` pane-regex classifier as a client-consumed signal (can remain server-side for telemetry).

Estimated scope: 1-2 rotations. Risk: migration of multiple UI consumers. Reward: permanent close of the 15.3 residual class and elimination of the asymmetry that drove this entire arc.

---

## Open strategic questions for CTO

**1. Ship-with-residual judgment.** PM closed 15.3 ratifying two intermittent P2 residuals. Was this the right call, or should we have kept iterating? The pragmatic case for shipping: intermittency makes code-side fixes unfalsifiable (can't tell if "fix worked" vs "run got lucky"); returns on a 7th rotation were negative; Jose was fatigued. The case for iterating: residuals will be visible in daily use. CTO's read?

**2. Codeman-model migration timing.** Post-M7 is my recommendation. Alternative: before M7, close the architectural wound while it's still fresh context. Trade-off is M7 delivery speed vs. pristine foundation for M7 work. CTO's read?

**3. Instrumentation rotation as standard pattern.** §12's playbook (dedupe-gated logging at every decision point in a derivation chain, 5-case capture with working/failing control pair, strip-verified delivery) worked. Should this become a formally documented discipline in `jstudio-meta/standards/`? If so, under which standards file?

**4. OS §20 update.** Memory saved at the project level (`feedback_understand_before_patching.md`). Want me to propagate to global OS §20 LESSONS, or keep project-local until a second project hits the same class?

**5. The Item 1 post-mortem specifically.** Tier A Item 1 is the cleanest example of "tests-pass, ship-rejected, premise-wrong" in this project's history. The v5 diagnostic had named a plausible mechanism (tail-block scan limitation) and CODER implemented against it. §12 instrumentation proved the mechanism wrong. Worth writing up as a capital-L Lesson for the OS? The pattern is specifically "intermediate diagnostic document with plausible hypothesis, coded against, live-smoke rejects, instrumentation needed to prove what was actually wrong." Distinct from generic §20.LL-L10.

---

## What's next

- **M7 kickoff** — PM ready to start on your authorization. Pre-check verified JLP symlink resolution clean (Issue 15.2's `fs.realpathSync` covers the case).
- **Candidate queue** — 19 (Stop button cross-pane), 23 (contextLimit investigation), 24 (/compact text buffer reappear), 26 (token_usage growth), 27 (recovered-jsc-* placeholder sessions), 28 (empty commander.db at repo root), 29 (task_reminder renderer), 30 (markdown visual parity), 31 (§6.1.1 integration test orphan), 32 + 33 (15.3 residuals). Codeman-model migration proposal above would resolve 23, 32, 33 jointly.
- **OS §20 + §23 + §24 updates** — pending CTO review of this brief. PM will execute propagation once you ratify the text.

Awaiting CTO feedback.
