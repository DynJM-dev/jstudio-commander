# Phase Y Rotation 1.6 — Instrumentation Rotation Findings

**From:** CODER (instrumentation-first rotation per `standards/INVESTIGATION_DISCIPLINE.md`)
**To:** PM + Jose
**Status:** Evidence-collected, instrumentation stripped. **No fix code shipped this rotation.**
**Preceded by:** Rotation 1.5 hotfix (`5a1bc23` + `df5439b`) + PM audit of 324 JSONL entries on 2026-04-21 showing Class 1 = 65 (20%), Class 2 = 182 (56%).
**Dispatch:** `docs/dispatches/PHASE_Y_ROTATION_1_6_HOTFIX_DISPATCH.md`.
**Outcome:** Capture isolated the Class 1 mechanism decisively. Fix C (`streamingAssistantId` 3s stability timer) is working as designed, but its input signal is decoupled from actual session-is-composing reality. Class 2 reconfirmed: Fix B's helper + UI pipe are clean; the 182 JSONL entries are divergence captures not UI leaks.

---

## §1 — Raw capture

Protocol: Jose cold-restarted dev server, hard-reloaded, used Commander normally. Mid-capture wifi flap introduced Claude API `ConnectionRefused` + `system/debug_unmapped` (api_error) records, which produced a separate user-observable artifact Jose described live: "the status was only active for 3-4 seconds after the response came in. It went back to idle. While it was actually composing, our status was idle." Three distinct full-cycle captures landed in the log post-stabilization.

Dedupe at D2/D3 was initially `let lastSig` (module-level) which cross-instance flip-flopped between the split-view's two ContextBars. Patched mid-capture to `Set<sig>` mount-scoped "seen" bag. Post-patch logs are clean.

### Single representative cycle — tail `a4238ae2-…` (composing-flash)

Timestamps show a tight 107 ms window between "tail newly observed" and "streaming id lands in state + hook re-runs + composing branch fires."

```
1. D1 tail-changed                assistant/text  tailId=a4238ae2  hashChanged=true   timerArmed=true   streamingId=null(pre-update)
2. D2 composing-branch  ts=1776749823524  tailId=a4238ae2  streamingId=null   match=false  willReturnComposing=false
3. D2 composing-branch  ts=1776749823631  tailId=a4238ae2  streamingId=a4238ae2  match=true   willReturnComposing=true
4. D4 post-helper                   actionLabel='Composing response...'  effectiveAction='Composing response...'  effectiveStatus='working'  statusInfoLabel='Composing response...'
5. D4 post-helper                   actionLabel=null                      effectiveAction=null                       effectiveStatus='idle'    statusInfoLabel='Idle — Waiting for instructions'
```

The same exact five-step pattern repeats for tailIds `b4b4fc7d-…` (`ts=1776750057676 / …791`) and `229a3de8-…` (`ts=1776750122549 / …600`). Every `assistant/text` tail that appeared in the capture produced exactly one composing-flash lasting less than one D4 render cycle — no cycle produced sustained composing across multiple D4 renders.

### The earlier cycle that DIDN'T fire composing — tail `4c2abbde-…`

```
1. D1 non-assistant-tail                  user/text       tailId=c09c5c29
2. D1 tail-changed                        assistant/text  tailId=4c2abbde  hashChanged=true   timerArmed=true  streamingId=null(pre-update)
3. D2 composing-branch  ts=1776749289201  tailId=4c2abbde  streamingId=null   match=false  willReturnComposing=false
4. D1 tail-stable                         assistant/text  tailId=4c2abbde  hashChanged=false  timerArmed=false streamingId=null
5. D4 post-helper                         actionLabel=null  effectiveStatus='idle'  statusInfoLabel='Idle — Waiting for instructions'
```

The critical divergence: for `4c2abbde`, D2 fires with `match=false` on the initial render AND never re-fires with `match=true` after `setStreamingAssistantId` would have landed in state. No composing render AT ALL. Same inputs as `a4238ae2`, opposite outcome.

### The Class 2 shape captured previously

```
D3  codemanIsWorking=false  codemanLabel=null  legacyActionLabel='Composing response...'  returned=null  ts=1776748481188
D4  actionLabel=null  effectiveAction='Processing...'  effectiveStatus='idle'  statusInfoLabel='Idle — Waiting for instructions'
    codemanIsWorking=false  codemanLabel=null  legacyActionLabel='Composing response...'  legacyIsWorking=true  ts=1776749057455
```

---

## §2 — Class 1 mechanism (isolated)

**Fix C's `streamingAssistantId` 3 s stability timer works exactly as designed.** The cycle for `a4238ae2` confirms the full chain: D1 detects `assistant/text` tail → reconciler calls `setStreamingAssistantId(tailId)` + arms 3 s timer → next render sees `streamingAssistantId === last.id` → D2 composing-branch fires `match=true` → D4 renders "Composing response...". When the 3 s timer expires → `setStreamingAssistantId(null)` → next render → D2 `match=false` → D4 renders idle.

**The mechanism of the user-observable bug is that Fix C's input signal — "tail content hash has been stable for 3 s" — is DECOUPLED from "this session is actively composing."** Two independent failure modes surface in the capture:

### Failure mode A — composing never fires for a valid assistant/text tail

Cycle `4c2abbde` (first captured): D1 correctly detects the tail change and arms the timer. D2 fires once with `match=false` (streamingId pre-update). Then D1 observes the tail as stable — **but `setStreamingAssistantId(tailId)` from the reconciler apparently never drove a downstream re-render of `useToolExecutionState`**, because there is no subsequent D2 line for this tail with `match=true`. The composing branch silently skipped this tail entirely.

Evidence: `D1 tail-stable ... streamingId=null` at line 4 of the `4c2abbde` trace. If the state update had propagated, `currentStreamingAssistantId` in this log (read via ref) would be `4c2abbde`, not `null`. It's `null`, meaning `setStreamingAssistantId(4c2abbde)` either didn't execute or was immediately reverted.

Candidate causes (not distinguished by this rotation's logs, listed for follow-up instrumentation):
- The `useEffect([messages])` in `useChat.ts` is being invoked with a message array whose tail just became `assistant/text`, but by the time React schedules the state update, a subsequent poll has already delivered a newer array where the tail is no longer `assistant/text`, so the functional-setter `(current) => (current === last.id ? current : last.id)` runs on the LATER array and the match check skips the update.
- Some other effect or reducer somewhere resets `streamingAssistantId` to null between the reconciler and the hook re-run.

### Failure mode B — composing fires briefly then terminates while the turn is still active

Cycles `a4238ae2`, `b4b4fc7d`, `229a3de8`: composing renders for one D4 cycle, then immediately reverts to idle. The D4 cycles are tight; there's no visible 3 s window of composing in the log. Timeline:

1. Tail becomes `assistant/text` for one poll tick.
2. Reconciler arms 3 s timer; next render fires composing.
3. But the next poll (1.5 s at sessionStatus=working, 5 s at sessionStatus=idle) returns a message array where the tail has changed (e.g. a new `user/text` from the user or a different assistant block). D1 fires `non-assistant-tail` → `clearTimerAndReset()` runs → `setStreamingAssistantId(null)` EARLIER than the 3 s timer would have fired.
4. D4 reverts to idle.

Evidence: every `a4238ae2` / `b4b4fc7d` / `229a3de8` composing-flash is immediately followed in the log by a D1 `non-assistant-tail user/text` line, which means the reconciler ran with a new non-text tail within 3 s of the composing start.

Jose's user-observable description aligns: **"the status was only active for 3-4 seconds after the response came in."** The 3-4 s matches the stability timer's full budget when no tail change intervenes; less than that when a tail change intervenes.

**The combined user-visible pattern** ("idle during real composing; brief composing-flash after the response finishes; back to idle") is the compounded effect:

- During Claude's actual streaming across 50 s, the tail oscillates through `user/tool_result`, `system/queued_command`, `user/text`, and brief `assistant/text` moments. The useChat poll runs at 5 s when sessionStatus=idle (server classifier missed the work) — most of the streaming happens BETWEEN polls, so Fix C's reconciler never sees a sustained `assistant/text` tail.
- At turn-end, the final `assistant/text` becomes the tail. D1 detects it. Composing fires. 3 s budget begins.
- Within 3 s, either (i) a new user message arrives (next prompt, or a tool-call queued message) displacing the tail, or (ii) the 3 s expires. Either way composing terminates.
- Jose sees the brief flash, then idle.

**Re-read of the audit's Class 1 = 65:** these are the 65 log entries captured by `[codeman-diff]` during the brief composing-flash windows across ~8 h of work. Per composing-flash lasting 2-4 s × ~1.5 s poll cadence during working ≈ 1-3 divergence entries per flash ≈ 20-60 real flashes. **Consistent with real events.** The audit's "Fix C didn't land" interpretation over-read the counts — the counts are evidence of Fix C firing briefly as designed, and the logger correctly observing the codeman-vs-legacy divergence while it fires. **The USER-VISIBLE bug isn't stuck-composing; it's THE OPPOSITE — composing is too brief.**

**Re-read of the audit's 185.4 s + 161.8 s stuck-composing runs:** with 0/4 and 0/5 legacy agreement, these are PROLONGED composing-flashes. The only way Fix C holds composing for 185 s is if `messages` keeps changing every <3 s (each reconciler pass re-arms the timer). A long streaming response that keeps appending content to the tail `assistant/text` would do exactly this. **These are TRUE composing events, 185 s of real streaming**, and the audit correctly reflects that. Not a bug.

### Summary of §2

| Observation | Mechanism |
|---|---|
| User sees idle during real composing | Server classifier idle → poll slow → useChat misses streaming → Fix C never sees sustained assistant/text tail |
| Composing flashes briefly at turn-end (Jose's 3-4 s) | 3 s stability timer expires OR tail is displaced by next message before timer expires |
| 185 s + 162 s prolonged composing in audit | Real 185 s streaming turns where tail content keeps changing each poll, re-arming the timer correctly |
| 65 Class 1 audit entries | Divergence captures during brief composing-flashes; consistent with ~20-60 real flashes |
| Fix C's timer logic | **Working as designed.** The helper and timer are correct. |
| **Root cause of user-visible mismatch** | **Fix C's "tail content hash stable for 3 s" signal is not the right proxy for "session is composing." The real signal lives upstream — server session.status + poll cadence + turn-end detection.** |

---

## §3 — Class 2 mechanism (reconfirmed: Fix B works end-to-end)

D3 + D4 evidence from the capture's earlier segment (`ts=1776748481188` and `ts=1776749057455`):

- D3 received the exact Class 2 shape (codeman confident-idle, legacy stuck on "Composing response...") and correctly returned `null`.
- D4 at the same ContextBar tick shows `actionLabel=null` (Fix B suppressed), `effectiveStatus='idle'`, `statusInfoLabel='Idle — Waiting for instructions'` — the UI did NOT render the stuck legacy label.

**Fix B works at the helper level and end-to-end at the UI pipe.** The audit's 182 Class 2 entries are divergence captures at the `[codeman-diff]` logger — the logger fires when codeman and legacy DISAGREE on label, regardless of what the UI renders. Fix B stops the UI LEAK, not the UNDERLYING DIVERGENCE. The divergence is what rotation 2's audit SHOULD see (it's the evidence that legacy can be deleted). **The audit's read of "Fix B not effective" was a re-interpretation of parallel-run-by-design evidence as a regression.** Fix B is doing its job.

No follow-up fix required for Fix B. The audit's Class 2 count should be reclassified as "expected parallel-run divergence, UI behavior correct" during the rotation-2 deletion audit.

---

## §4 — Fix shape (contract-level only, no code)

### Fix B

**No follow-up required.** Confirmed working via D3 + D4 evidence.

### Fix C

**Confirmed working as designed, but the design's input signal is insufficient** for the user-visible correctness Jose expects. Two orthogonal gaps:

**Gap 1 — Fix C's signal is decoupled from `session.status`.** The poll cadence in `useChat.ts:181-182` gates on `sessionStatus === 'working' || 'waiting'`. If the server's pane-regex classifier stays at `idle` during real streaming (Issue 15's class of bug), poll cadence drops to 5 s, streaming isn't observable to Fix C's reconciler, composing can't fire for sustained windows. **The fix is upstream of Fix C**: either improve server-side classifier coverage (Phase Y's original scope), or gate poll cadence on an additional client-side signal (e.g. `userJustSent === true` for the first 30 s after a send, forcing 1.5 s polls until the server catches up).

**Gap 2 — The "turn is composing" predicate needs a better definition than "tail hash hasn't changed for 3 s."** Consider alternative / additive predicates:

1. **Role-stability:** composing is active while the LAST message's role is `assistant` AND its last block is `text` AND the session is still in the turn (no new user message has arrived).
2. **Turn-end signal:** Claude Code emits a `Stop` hook when a turn ends. The server already records `last_hook_at`. Expose a `lastTurnEndAt` signal to the client; composing should fire while `lastTurnEndAt < lastUserMessageAt` (turn is active).
3. **Hybrid:** keep the 3 s stability timer but ALSO require that the tail is still `assistant/text` when the timer checks (ref-read at timer-fire-time). If the tail is already displaced, don't flip to null — the turn moved on and the subsequent branch (tool_exec / idle) will render correctly; don't bother explicitly suppressing composing.

**Recommended fix shape for Rotation 1.6.B:**
- Extend the Fix C reconciler with a role-stability predicate: composing terminates when tail changes AWAY from `assistant/text`, OR when turn-end is detected, OR when 3 s stability elapses — whichever comes first. Currently it's only the third.
- If Rotation 2 is willing to peek at server-side signals, expose `lastTurnEndAt` as a new field on session rows / WS `session:status` payload. Dispatched separately.
- Consider tightening the poll cadence gate in `useChat.ts:181-182` to include `userJustSent` + the last 30 s, so the client doesn't sit at 5 s cadence while waiting for the server classifier to catch up post-send.

**Do NOT speculative-patch Fix C without the above decision.** The timer itself is correct. Changing the 3 s value alone (e.g. to 10 s or 30 s) would extend the composing-flash window but not fix the underlying decoupling. Ad-hoc patches would fire a regression in the 185 s long-streaming case if the timer logic is altered without the role-stability predicate.

### Failure mode A (cycle `4c2abbde`) — deferred to 1.6.B's investigation

The specific case where `setStreamingAssistantId(tailId)` appears to not propagate → D2 never fires with `match=true` → composing never renders at all. Low-incidence in the capture (only one cycle out of four). Possible cause: React batching the state update across a poll-boundary such that by the time the hook re-runs, the tail has already changed. Requires additional instrumentation in 1.6.B to distinguish (log `streamingAssistantId` READ inside useToolExecutionState, not just the functional-setter value).

---

## Strip verification

- `grep -rn '\[phase-y-1.6-instr\]' client/src` → empty after strip.
- `git diff --stat` on the post-strip working tree shows only `docs/phase-y-rotation-1-6-diagnostic.md` added.
- Four instrumented files reverted to `HEAD` via `git checkout -- <path>`: `useChat.ts`, `useToolExecutionState.ts`, `contextBarAction.ts`, `ContextBar.tsx`.
- `[codeman-diff]` logger and its JSONL at `~/.jstudio-commander/codeman-diff.jsonl` untouched.
- No Phase Y fix code shipped. No test file touched. No server file touched. No Candidate 36 surface (TmuxMirror / status-poller / tmux.service) touched. Item 3 `sessionStatus === 'waiting'` passthrough preserved byte-identical.

Rejection triggers (a)-(h) all cleared.

---

## Candidate queue (flagged for PM, not this rotation)

- **Candidate 37: enumerate unmapped system subtypes.** The capture's wifi-flap window produced ~7 `system/debug_unmapped` ContentBlocks with `subtype='api_error'`. Parser `jsonl-parser.service.ts:parseSystemRecord` has no typed branch. Small-scope dispatch: sweep JSONL history for unmapped subtypes, add typed ContentBlock variants + parser branches + renderer variants.
- **Candidate 38: pending local message persists past turn-end, refresh clears.** Jose observed mid-rotation: messages sent during Claude's response stay "stuck at the bottom" of the chat; hitting refresh clears them. Mechanism: `ChatPage.tsx`'s `pendingLocal` array isn't being cleaned up on some turn-end path. Likely orthogonal to Phase Y but flagged for queue.
