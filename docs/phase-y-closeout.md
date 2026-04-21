# Phase Y — Closeout Report + Architectural Ceiling Findings

**From:** CODER (live-smoke findings for Rotation 1.6.B + architectural implications)
**To:** PM + Jose
**Status:** **NOT a ship-green on 1.6.B.** 1.6.B commit `afb6964` stays in place — Fix D + Fix E + Fix B DO real work on paths that ARE observable in the transcript. **But the primary user-visible symptom (ContextBar shows "Idle" throughout real Claude work) is NOT closed by 1.6.B and will NOT be closed by any web-based Phase Y rotation.** Jose-authorized architectural pivot: stop chasing transcript-authoritative real-time status; scope a narrower conservative fallback; defer the full correctness problem to the native rebuild phase.

---

## §1 — Live-smoke evidence from Case 1 + Case 2

### Case 1 (long pure-text prompt)

Jose submitted the long status-poller explanation prompt — designed to trigger ~30-60s of pure-text streaming with no tool calls.

Observed:
- Live Terminal (Phase T mirror): showed everything real-time. Thinking, composing, response text appearing character-by-character over ~1m30s+.
- ChatThread in Commander UI: showed `LiveActivityRow` "Cogitating..." briefly for ~20s, then it disappeared, then it came back for a few more seconds near the end of the turn. Full assistant response appeared all at once when the turn finished.
- ContextBar status: **stayed Idle throughout the entire turn.** No transition.

### Case 2 (Read-then-explain prompt, forces tool_use)

Jose submitted the Read+explain prompt — designed to exercise `tool_exec` branch via two Read calls.

Observed:
- Live Terminal: showed reading activity + response composition in real time.
- ChatThread: only the two Read tool chips + the full response paragraph **appeared all at once at turn-end.**
- ContextBar status: **stayed Idle throughout.** Tool_exec label never rendered — windows were too brief to perceive AND/OR the tool chips arrived in a single batch at the end rather than incrementally.

### What this tells us about the upstream pipeline

`useChat`'s `messages` array was NOT updating incrementally during either turn. Phase T's tmux mirror works (reads raw tmux pane output directly), but the JSONL transcript-backed `chat:message` WS pipeline does not surface mid-turn growth to the React app. Three non-exclusive candidate mechanisms:

1. **Claude Code's JSONL write pattern.** The text block (and possibly tool_use blocks in Case 2) is written to JSONL at turn-end as a single record rather than growing in place. Evidence: tool chips + response appearing together at end rather than chip-then-pause-then-response.
2. **Server watcher-bridge emission timing.** Commander's server watches the JSONL and emits `chat:message` broadcasts, but may be debouncing / batching these such that only turn-end states surface.
3. **Client-side WS consumption.** `useChat`'s `chat:message` handler deduplicates by id; if the server re-emits same-id records on content growth, the client drops them. In-place growth is supposed to be caught by the adaptive poll's `mergeDelta` path, not WS.

Distinguishing these requires server-side instrumentation (a Rotation 1.6.C scope) — but Jose's pragmatic call is that even if we localize, the fix shape for pure-text real-time status is architectural and not worth chasing in the web-based design.

---

## §2 — What Rotation 1.6.B DOES close (keep in place, `afb6964`)

Don't revert 1.6.B. Three real improvements land:

**Fix D — role-stability tuple predicate (useChat reconciler).** Added a `(tail.id, tail.role, lastBlock.type)` tuple signature. Any axis change forces an immediate clear + re-arm, closing the 1.6 diagnostic's Failure Mode A (race between `setStreamingAssistantId` and the next messages-effect pass). Benefit surfaces whenever `useChat` does observe incremental content — when that happens, the composing branch behavior is correct and terminates cleanly on tail-role transitions.

**Fix E — active-poll window post user-send.** Poll stays on the 1.5s cadence for 30s after the most recent user message regardless of `sessionStatus`. If the transcript pipeline ever starts surfacing mid-stream records, Fix E is the correct default so we don't miss them. Zero harm today.

**Fix B (pre-existing, Rotation 1.5, reconfirmed in 1.6 diagnostic).** Legacy "Composing response..." label leak stays suppressed when codeman confidently says idle — matters for Class 2 divergences where the pane-classifier lags.

**Net effect of 1.6.B on user experience today:** tool_exec windows render correctly when tool_use blocks ARE observable (even if briefly). Anything upstream of `useChat.messages` updating is unaffected.

---

## §3 — Architectural ceiling (documented, not worked-around)

**The transcript-authoritative derivation has a structural ceiling for pure-text turns.** Restated plainly:

- Phase Y's design premise is "derive status purely from `ChatMessage[]`."
- `ChatMessage[]` is hydrated from the JSONL transcript.
- If the JSONL transcript doesn't surface the assistant's in-progress content until turn-end (for whatever reason in the Claude Code ↔ server ↔ client pipeline), then the derivation has nothing to observe.
- No amount of tuning in `useChat.ts` or `useToolExecutionState.ts` can fabricate the signal.

**The Live Terminal (Phase T mirror) already is the real-time ground-truth surface.** It reads tmux pane content directly, bypassing the JSONL pipeline, and is live for every kind of turn (thinking, tool, text). The chat window has always been — and will remain — the **semantic summary** surface: nicer formatting, scrollback, copyable text, tool chips, links. Not a race-condition-free mirror of the terminal.

**Per `project_native_rebuild_final_phase.md` and `feedback_defer_nonblocking_bugs_to_native_rebuild.md`:** a native (non-browser) Commander that hooks `node-pty` / tmux directly can drive status from terminal output the same way the Live Terminal mirror does, eliminating the JSONL-pipeline dependency entirely. That is the correct architecture for perfect real-time chat status — and it is the ratified final-phase plan.

---

## §4 — Jose's scope call for the next rotation (1.7 / Phase Y closeout follow-up)

Jose-directed scope (from today's live-smoke session):

**Keep and fix:**
- Tool chips (Read, Edit, Write, Bash, Agent, etc.) in the chat window — when they DO land via WS/poll, they should render correctly. Any bugs in that rendering path are in-scope.
- Assistant text blocks, `thinking` blocks (via LiveActivityRow), pending-local messages, and all other chat-window content — same. These are the "semantic summary" surface and they matter.
- ContextBar status label — **"IDLE" is misleading during real work**, and that should be fixed with a conservative fallback. Specifically: when `userJustSent` is true AND the chat window hasn't shown an assistant block within N seconds, the status should read something generic like "Working..." until either a concrete signal (tool_use block, assistant text growth, turn-end) lets us pick a more accurate label. No real-time promise — just "don't lie to the user that nothing is happening."

**Stop chasing (defer to native rebuild):**
- Perfect real-time sync of ContextBar label to Claude's moment-by-moment state during pure-text streaming.
- Perfect liveThinking visibility throughout long cogitating windows (accept the ~20s flicker artifact for now).
- Transcript-derived `composing` subtype firing continuously across a 60s response (Case 1 acceptance criterion as written is unachievable in web-based Commander).

**Keep running:**
- `[codeman-diff]` logger + JSONL file — continues to gather parallel-run evidence for the eventual Phase Y Rotation 2 deletion of 15.3-arc legacy guards. The audit posture is still valid; just the "all divergence is a bug" read is retired.

---

## §5 — Proposed Rotation 1.7 shape (for PM to dispatch)

**Narrow, conservative, evidence-backed — NOT speculative:**

### Fix 1.7.A — "Working..." fallback when `userJustSent && no-recent-assistant`

Contract-level:
- New ContextBar state: `WORKING_FALLBACK_MS` (~5000, configurable).
- Condition: `userJustSent === true` AND no assistant block has appeared in `messages` within the last `WORKING_FALLBACK_MS`.
- Action: `effectiveStatus='working'`, `actionLabel='Working...'`.
- Expires: when an assistant tool_use / text / thinking block lands (derivation takes over with specific label) OR `WORKING_FALLBACK_MS * 18` (~90s) elapses without signal (failsafe against stuck fallback).
- Location: a new helper in `contextBarAction.ts`, gated identically to `resolveEffectiveStatus` with waiting-passthrough preserved at top (Item 3 sacred).

### Fix 1.7.B — verify tool chip rendering robustness

Audit path: `ChatThread.tsx` rendering of `tool_use` / `tool_result` blocks. Confirm no regression from Phase Y work. If tool chips are sometimes missed (Jose observed "2 reading tools appeared all at once at end" — could be rendering issue OR upstream issue), this is the surface to probe.

### Fix 1.7.C — tighten `liveThinking` scan

The `LiveActivityRow` bleed-through (Jose saw response text appearing inside the thinking-text display) is because `liveThinking` scans backward through the last assistant message's content for any `thinking` block — and finds one AFTER text blocks when Claude emits post-text thinking. Narrow: only scan thinking blocks up to (not past) the last `text` block in the same message. Small, local fix.

### NOT in 1.7 scope

- No server-side instrumentation of JSONL emission timing (defer to native rebuild or a future dedicated rotation if priorities shift).
- No changes to `useChat`'s poll cadence, reconciler, or composing branch (those stay as 1.6.B left them).
- No changes to the 15.3-arc legacy guards (those stay until Phase Y Rotation 2, if rotation 2 is ever revisited).

---

## §6 — Commit trail + file status

| Ship | Commit | Status |
|---|---|---|
| Phase Y Rotation 1 | `a3a58a2` | Shipped. useToolExecutionState hook + parallel-run diff logger. Keep. |
| Phase Y Rotation 1.5 | `5a1bc23` + `df5439b` | Shipped. Fix A + Fix B + Fix C. Keep. |
| Phase Y Rotation 1.6 diagnostic | `e05093a` | Ship-green. Instrumentation-only doc. Keep. |
| Phase Y Rotation 1.6.B | `afb6964` | Shipped. Fix D + Fix E. Keep — does real work on observable paths. |
| Phase Y Rotation 1.6.C | NOT dispatched | Canceled per this closeout. |
| Phase Y Rotation 1.7 | TBD | Scoped in §5 above. Awaiting PM dispatch. |

---

## §7 — Candidates re-surfaced

Previously flagged in Rotation 1.6 diagnostic, still open:
- **Candidate 37/40** — enumerate unmapped system subtypes (`api_error` surfaced via wifi-flap during 1.6 capture).
- **Candidate 38/41** — `pendingLocal` not cleaned up past turn-end; refresh clears.
- **Candidate 36** — cross-session effort leak (send path clean per `05bb3c7`; display-layer D5/D6 instrumentation rotation queued).

New during 1.6.B smoke:
- **Candidate 42** — `liveThinking` scan bleed-through (shows response text inside thinking display when Claude emits post-text thinking block). Addressed by Fix 1.7.C above.

---

## §8 — TL;DR for PM's next decision

Ship in place: 1.6.B (`afb6964`).
Cancel: 1.6.C dispatch (no value in chasing upstream transcript-pipeline gap via client-side).
Dispatch: Rotation 1.7 scoped per §5 — conservative "Working..." fallback + tool chip audit + `liveThinking` scan narrowing.
Defer: full real-time chat-status correctness to native rebuild phase per `project_native_rebuild_final_phase.md`.

No ship-green claim on 1.6.B for Case 1 acceptance. The acceptance criterion "continuous Composing response... throughout a long streaming turn" is not achievable in the web-based architecture and the pivot explicitly accepts this.
