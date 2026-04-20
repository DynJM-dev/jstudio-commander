# CTO_RESPONSE — Phase T Dispatch Draft Review

**From:** Commander CTO
**To:** PM (Commander)
**Via:** Jose Bonilla (manual bridge)
**Date:** 2026-04-20
**Re:** `PHASE_T_TMUX_MIRROR_DISPATCH.md` (draft)

---

## Verdict: RATIFY with 1 amendment + 1 bookkeeping check.

Dispatch is strong. Pre-dispatch recon (the six bullets at the top establishing existing `capturePane` signature, clean tee point, naming conventions, mount point) saves the CODER a round trip of discovery. Option A is the right call. Boundaries are tight. Rejection triggers cover the surface. 8-criterion smoke carried faithfully from the CTO brief.

Fold the amendment, confirm the bookkeeping, and this is fire-ready.

---

## Amendment 1 — Server-side emit dedupe

Current design emits `session:pane-capture` on every status-poller tick (1.5s) regardless of whether the captured text changed. With 3-5 sessions sitting idle (Claude thinking, waiting, or post-turn), that's 120-200 identical WS events per minute. Each triggers a client re-render of the mirror with identical content.

Add to server-side tee path (at `agent-status.service.ts:575-583` or equivalent):

```
const lastEmittedByCapture = new Map<string, string>();
// ...after paneContent obtained (ANSI-preserved):
if (lastEmittedByCapture.get(sessionId) !== paneContent) {
  eventBus.emitSessionPaneCapture(sessionId, paneContent, Date.now());
  lastEmittedByCapture.set(sessionId, paneContent);
}
```

Trivial cost: one `Map<sessionId, string>` on the server, one string comparison per tick per session. Meaningful benefit: WS traffic drops to near-zero during idle windows.

Add to §Tests:

- New test: given identical `paneContent` on consecutive poller ticks for the same session, `emitSessionPaneCapture` is called exactly once.
- Existing test 3 ("emits correct payload shape") remains — covers the change-detected emit path.

Add to §Rejection triggers:

- (j) Emit path fires on every tick regardless of content change. Reject.

Also flag: on session close / cleanup, the `lastEmittedByCapture` entry should be deleted (Map leak otherwise over long uptimes). Minor hygiene, CODER handles at implementation time.

---

## Bookkeeping check — OS propagation pass status

Phase T dispatch references `standards/INVESTIGATION_DISCIPLINE.md` (§Standing reminders) and OS §20.LL-L11 (in the speculative-fix rejection trigger reasoning). These files were specified in `CTO_RESPONSE_2026-04-20_15.3_close.md` but I don't have confirmation the OS propagation pass actually shipped.

Confirm with Jose before firing Phase T:

- Did the OS propagation pass execute (OS §20 updates with L11 + L12, §23/§24 changelog, new `standards/INVESTIGATION_DISCIPLINE.md` file, STATE.md 15.3-CLOSED flip, and related batch items)?
- If YES: Phase T dispatch is fully grounded. Fire.
- If NO: execute the OS propagation pass first (it was the queue's #1 priority per ratification). Phase T fires after. Dispatch text doesn't need changes — it's referencing the right documents; those documents just need to exist when CODER reads them.

If you're uncertain, a `ls ~/Desktop/Projects/jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md` + a `grep "LL-L11" ~/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` should confirm in under a minute.

---

## Other observations (non-blocking)

- **Option B inline ANSI strip regex** (`/\x1b\[[0-9;]*[a-zA-Z]/g`): generally correct for CSI sequences but doesn't cover OSC (Operating System Command) sequences like `\x1b]0;...\x07` (terminal title). If CODER ends up choosing Option B, flag this for completeness. For Option A (preferred), irrelevant — classifier gets a separate ANSI-free capture.
- **localStorage keyed by sessionId for toggle persistence**: acceptable MVP per PM framing. Note that Commander's session IDs survive across tab reloads but NOT across session respawn/recreation (e.g., if a session is stopped and a new one spawned with same name). Toggle state resets in that case. Expected MVP behavior; file a candidate (P3) for "persist mirror visibility across session respawn via DB" if Jose requests it post-ship.
- **Performance target `<5% CPU`**: fuzzy acceptance criterion, which is fine for MVP but remediation path if smoke fails should be "reduce render cadence to 3s poll" before any code change, not "rearchitect the mirror." Include that implicitly in the dispatch by keeping the criterion framed as "no visible jank" rather than a hard CPU number.

---

## What PM does next

1. Fold Amendment 1 (dedupe emit) into §Scope item 2 + §Tests + §Rejection triggers.
2. Confirm OS propagation pass status with Jose (should be quick).
3. Return the amended dispatch to CTO for one-round fire-ready confirmation. No need to re-litigate — just confirm the amendment folded cleanly.
4. Jose authorizes Phase T fire.

---

**End of response.**
