# CTO_BRIEF — Phase T: Tmux Mirror Pane (scoping)

**From:** Commander CTO
**To:** PM (Commander)
**Via:** Jose Bonilla (manual bridge)
**Date:** 2026-04-20
**Type:** Phase scoping + dispatch authorization (1 rotation, MVP-only)
**Sequences:** AFTER OS propagation pass, M7 MVP, M8 | BEFORE Phase Y (Transcript-Authoritative State)

---

## TL;DR

Phase T ships a per-session live tmux pane mirror inside Command Center. Read-only, toggleable show/hide, positioned at the top of each session surface. Reuses existing `tmux capture-pane` infrastructure; streams captured pane text over WebSocket to the client. Renders in a scroll-pinned div with ANSI color support.

Strategic purpose: ground-truth ladder. When Commander's derivation chain lies about state (as 15.3 proved it does), the mirror shows the raw pane text — the one view in Commander that cannot lie because it IS the source. Also: diagnostic infrastructure that compounds with Phase Y's smoke matrix (raw pane + parallel-run diff log = cleanest possible evidence base for the migration).

One rotation, MVP scope only. If scope drifts past one rotation, pull the brake.

---

## Why before Phase Y, not after

Three reasons:

1. **Phase Y is an architectural migration where "does the UI match reality?" is the entire question being asked.** Having a raw-pane ground-truth view during Phase Y smoke dramatically improves Jose's ability to smoke-test confidently and catch disagreements the parallel-run diff log might miss.

2. **Phase T is genuinely small.** MVP reuses existing pane-capture infrastructure. Zero new backend work. One rotation, probably a day of Commander work end-to-end.

3. **Jose stated the need as daily-driver relief** ("command center still gets a bit buggy from time to time so this will always keep us in the loop"), not someday polish. Matches M8's sequencing rationale: small daily-driver win first.

---

## Scope

### In scope — MVP

1. **Per-session live mirror pane.** Positioned at the top of each session's surface, above the chat thread. Each session has its own mirror of its own tmux pane.

2. **Reuse existing pane-capture.** The `status-poller.service.ts` already runs `tmux capture-pane` at 1.5s cadence per session for status classification. Tee the captured pane text into a new WS event (`session:pane-capture` or similar), stream to client. Zero new server-side capture loop.

3. **ANSI color rendering.** Client-side ANSI parser (recommend `ansi_up` — small dep, stable, converts ANSI escape codes to HTML). No xterm.js, no node-pty.

4. **Scroll behavior.** Auto-follow-bottom by default. Sticky-scroll when user scrolls up (bottom-follow resumes if user scrolls back to bottom). Standard terminal pattern.

5. **Toggle show/hide.** Per-session toggle in the session UI. Hidden state persists across reloads via local state (same pattern as other per-session UI prefs — PM chooses exact persistence mechanism).

6. **Fixed height.** One reasonable default (suggest: 180-220px, PM/CODER picks during dispatch). Resizable behavior is post-MVP.

### Out of scope — explicit non-goals

- **Interactive terminal.** This is a read-only mirror. No input handling. No xterm.js. No node-pty. If CODER scope-creeps toward interactivity during dispatch, reject immediately. Reference: Phase P.3 commit `1f4235f` deleted xterm.js + node-pty for stated product reasons — Phase T is NOT a re-add.
- **Terminal tab / full terminal view.** That was a different feature, deleted in Phase P.3. Phase T is the mirror only.
- **Search within pane.** Post-MVP.
- **Copy selection.** Standard browser text-selection works on a div; that's sufficient for MVP. No custom selection behavior.
- **Resize / drag-to-adjust height.** Post-MVP.
- **History / scrollback beyond current pane capture.** What tmux capture-pane returns is what's shown. Full scrollback history is post-MVP if it surfaces as a need.

---

## Technical sketch (non-binding, PM and CODER refine)

**Server-side:**

- At the existing status-poller tick (1.5s), the pane capture is already performed. Today it's consumed by `classifyStatusFromPane` for status derivation. Additionally emit the raw captured string over WS on a new event — `session:pane-capture` with payload `{ sessionId, capturedAt, paneText }`.
- Rate consideration: 1.5s cadence is fine for a visible mirror. Lag is acceptable; this is a diagnostic layer, not a real-time interactive surface.
- No new capture loop, no new tmux call. Reuse what's there.

**Client-side:**

- New component: `TmuxMirror.tsx` (or similar). Subscribes to `session:pane-capture` for its sessionId. Maintains a local string state of the most recent capture.
- Renders captured text through `ansi_up` (or equivalent) into a `<pre>` or scroll-pinned `<div>`. Monospace font. Dark background. No custom styling beyond that.
- Scroll behavior: track whether user is at bottom; if so, scroll to bottom on each update; if user has scrolled up, hold position.
- Toggle component: small button in session header. State persists per-session.

**Positioning:**

- Top of the session surface, between the session header and the chat thread. Full width of the pane (or split-view column).
- When hidden, collapse completely — zero footprint, not just visually hidden behind a curtain.

---

## Acceptance criteria

1. **Live update:** Mirror pane shows the current tmux pane content, updating at the existing 1.5s cadence.
2. **Split-view isolation:** In split-view with two concurrent sessions, each session's mirror shows its own pane text. No cross-pane bleed.
3. **ANSI color fidelity:** Bolded text, colored tool labels, progress spinners in the pane render with readable color in the mirror (not as raw `\x1b[` escape codes).
4. **Toggle works:** Per-session show/hide toggle responds immediately, state persists on reload.
5. **Scroll behavior:** At-bottom follows new output; scrolled-up holds position; returning to bottom resumes follow.
6. **No regression:** existing status classification continues to work (we're teeing the capture, not replacing the classifier yet — that's Phase Y's job).
7. **Performance:** Mirror updating does not cause visible ContextBar / chat jank or WS backpressure. Rough target: mirror updates consume <5% of client CPU during steady-state.
8. **Non-interactive confirmed:** No keyboard input goes to the pane from the mirror. Clicking the mirror doesn't focus or send input. Read-only verified.

---

## Rejection triggers

- Any scope drift toward interactive terminal (xterm.js, node-pty, input handling) — reject, revert.
- Any attempt to rebuild the Terminal tab deleted in Phase P.3 — reject, revert.
- Any new server-side pane-capture loop separate from the existing `status-poller.service.ts` capture — reject, reuse existing.
- Any change to the classifier or state derivation chain — OUT of Phase T scope, belongs in Phase Y. Reject.

---

## Sequencing relative to Phase Y

Phase T ships first. Jose smoke-tests. Ratified. Then Phase Y dispatches.

During Phase Y's rotation-1 parallel-run diff smoke, Jose can watch the raw pane mirror alongside the Codeman-pattern vs legacy disagreement logs. Compounding evidence.

Phase T does NOT need to block anything else. If M7 or M8 or OS propagation items surface post-Phase-T, they can run in parallel as long as no one touches the status-poller or WS event surface.

---

## What PM does next

1. Read this brief. Surface any scoping gaps or architectural constraints I haven't covered — flag to CTO before drafting dispatch.
2. If clean, draft the Phase T dispatch against this scope (rejection triggers explicit, file boundaries tight, one rotation hard ceiling).
3. Return dispatch draft to CTO via Jose before firing. CTO reviews — one round — and ratifies or pushes back.
4. On ratification, spawn fresh CODER (context hygiene), fire dispatch.
5. On PHASE_REPORT return: PM verify → Jose live smoke against the 8 acceptance criteria → ship or iterate.

---

## One note on the Phase T / Phase Y interaction

Phase T reuses the status-poller's pane capture. Phase Y potentially deletes or gates the status-poller (Q5.6 of the Codeman-phase response — "Server-side poll lifecycle" left as post-phase follow-up candidate).

If Phase Y later moves to delete the status-poller entirely, Phase T's capture source would need to migrate to an independent `tmux capture-pane` tick (still simple, just a separate small loop dedicated to the mirror). Flag this in Phase Y's dispatch as a known downstream dependency. Do not pre-solve it during Phase T.

---

**End of brief.**
