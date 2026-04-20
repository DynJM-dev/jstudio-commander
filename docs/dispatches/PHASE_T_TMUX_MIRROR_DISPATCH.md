# Phase T — Tmux Mirror Pane (MVP dispatch draft)

**From:** PM (Commander, 2026-04-20)
**To:** CODER (fresh spawn strongly recommended — accumulated-context risk after M8 + `41a55e9` + M7)
**Status:** DRAFT — pending CTO ratification via Jose relay. DO NOT FIRE.
**Preceded by:** `CTO_BRIEF_2026-04-20_phase_T_tmux_mirror.md` (scoping).
**Type:** ONE-ROTATION MVP. Hard ceiling. If scope drifts past one rotation, pull the brake per rejection trigger.
**Phase name:** Phase T: Tmux Mirror Pane.
**Sequences:** AFTER M7/M8 (shipped), BEFORE Phase Y (Transcript-Authoritative State — held pending Phase T ship).

---

## Framing

Phase T ships a per-session read-only tmux pane mirror at the top of each session surface in Commander. Reuses the existing `status-poller.service.ts` tmux capture-pane loop — zero new backend capture infrastructure — and tees the captured pane text through a new WS event to a client-side component that renders ANSI color through `ansi_up`.

Strategic purpose: diagnostic ground-truth ladder. When Commander's derivation chain lies about state (as the 15.3 arc proved it can), the mirror shows the raw pane text — the one view that cannot lie because it IS the source. Phase Y's rotation-1 parallel-run diff smoke compounds dramatically with this view live.

One rotation. MVP scope only. No interactivity. No xterm.js. No node-pty. No re-adding the Terminal tab that Phase P.3 (`1f4235f`) deleted.

---

## Pre-dispatch recon findings (PM-executed, CODER inherits)

Recon already established these facts. CODER does not need to re-verify but should read them into context before writing code.

**1. Current `tmux capture-pane` invocation.** At `server/src/services/tmux.service.ts:128-130`:
```
capturePane(name: string, lines = 50): string {
  return exec(['capture-pane', '-t', name, '-p', '-S', `-${lines}`]);
}
```
Flags present: `-t`, `-p`, `-S`. **Flag `-e` (preserve ANSI) is NOT present.** Current capture is ANSI-stripped. The `classifyStatusFromPane()` regex classifier operates on ANSI-free text and will break if suddenly fed ANSI escape sequences. **Non-regression-critical.**

**2. Clean tee point.** At `server/src/services/agent-status.service.ts:575-583`:
```
const paneContent = tmuxService.capturePane(tmuxSessionName, 25);
const core = classifyStatusFromPane(paneContent);
const activity = detectActivity(paneContent);
return { ...core, activity };
```
`paneContent` is a single intermediate variable held before both classifier consumers. Clean tee point for the mirror emit.

**3. Event bus convention.** `server/src/ws/event-bus.ts` uses `emit<Entity><Action>(sessionId, ...)` naming. Precedent: `emitProjectStateMd(sessionId, content)` from M7. Phase T follows: `emitSessionPaneCapture(sessionId, capturedText, capturedAt)`.

**4. WS channel convention.** M7 uses `project-state:<sessionId>`. Phase T uses `pane-capture:<sessionId>` for session-scoped isolation.

**5. Mount point.** `client/src/pages/PaneContainer.tsx`. In the `<Pane>` component (lines 110-254), the mirror mounts immediately after `{header}` at line 211, above the chat content wrapper at line 212-222. Drawer-style bottom-anchoring is NOT used (mirror is a top-anchored fixed-height band).

**6. Dependency add.** `ansi_up` NOT in `client/package.json`. Phase T adds it — recommend `"ansi_up": "^6.0.0"` (current stable).

---

## Scope — MVP (locked)

### In scope

**1. Server-side — preserve ANSI for mirror path without breaking classifier.**

Two acceptable implementations; CODER picks the one that better matches the existing code:

- **Option A (preferred): extend `capturePane` signature.** `capturePane(name, lines, opts?: { preserveAnsi?: boolean })`. Default `preserveAnsi: false` — existing callers unchanged. Call from the tee path with `preserveAnsi: true`. Two separate tmux invocations per status-poller tick (one for classifier, one for mirror). Tmux exec cost is modest at 1.5s cadence; doubling is not a measurable concern given M4's performance targets.

- **Option B: single `-e` capture + inline ANSI strip for classifier.** One tmux call with `-e`. Server-side ANSI stripper utility (a tiny regex replace, `/\x1b\[[0-9;]*[a-zA-Z]/g` or similar) applied before passing to `classifyStatusFromPane`. Mirror path gets the raw ANSI bytes.

Option A is simpler and lower-risk. Option B saves one tmux exec per tick but introduces a new utility surface. **PM lean: Option A.** CODER may pick B if they have a concrete reason; document the choice in PHASE_REPORT.

**2. Server-side — tee emit at status-poller tick, with change-only dedupe.**

At `agent-status.service.ts:575-583` (or wherever capture is called in the status-poller loop), after `paneContent` is obtained (ANSI-preserved variant per decision above), emit ONLY when the captured content differs from the last emitted content for this session:

```
// Module-level (outside the tick function):
const lastEmittedByCapture = new Map<string, string>();

// Inside the tick, after paneContent obtained:
if (lastEmittedByCapture.get(sessionId) !== paneContent) {
  eventBus.emitSessionPaneCapture(sessionId, paneContent, Date.now());
  lastEmittedByCapture.set(sessionId, paneContent);
}
```

Emit runs in parallel to the existing classifier path. Classifier continues to receive ANSI-free text (either via Option A's second call or Option B's inline strip). **Classifier non-regression is load-bearing.**

**Why dedupe (CTO Amendment 1):** without this gate, every status-poller tick (1.5s cadence) emits regardless of whether the pane actually changed. With 3-5 sessions idle (Claude thinking, waiting, or post-turn), that's 120-200 identical WS events per minute, each triggering a client-side mirror re-render with identical content. Dedupe costs one `Map<sessionId, string>` and one string comparison per tick — trivial. Benefit: WS traffic drops to near-zero during idle windows.

**Cleanup on session close:** on session stop / removal / teammate dismiss, delete the `lastEmittedByCapture.delete(sessionId)` entry. Map leak otherwise accumulates across long uptimes. Hook into whatever existing session-stop cleanup path covers other per-session server-side state (likely in `session.service.ts` stop/remove path).

**3. Server-side — new event bus method + WS broadcast.**

`server/src/ws/event-bus.ts`: add `emitSessionPaneCapture(sessionId: string, paneText: string, capturedAt: number)`.

`server/src/ws/index.ts`: register handler that broadcasts on channel `pane-capture:<sessionId>` with payload `{ type: 'session:pane-capture', sessionId, paneText, capturedAt }`. Mirror M7's broadcast pattern at lines 89-98.

**4. Shared type.** `packages/shared/src/types/ws-events.ts`: add `session:pane-capture` WSEvent variant with the payload shape above.

**5. Client-side — `TmuxMirror.tsx` component.**

Location: `client/src/components/chat/TmuxMirror.tsx`.

Behavior:
- Props: `{ sessionId: string }`.
- Internal state: most recent `paneText: string | null`, `capturedAt: number | null`, show/hide `visible: boolean`, scroll-follow-bottom `followBottom: boolean`.
- On mount: subscribes to `pane-capture:<sessionId>` via `useWebSocket()`; filters events by type + sessionId (same pattern as M7's `useProjectStateMd`).
- On event receive: updates `paneText` + `capturedAt`. No initial-fetch endpoint needed for MVP — first render shows nothing (or "Waiting for pane capture..." placeholder) until the first emit arrives (within ~1.5s of mount).
- Rendering: pass `paneText` through `ansi_up` → HTML → dangerouslySetInnerHTML on a `<pre>` or scroll-pinned `<div>`. Monospace font, dark background, reasonable padding.
- Scroll-pin: track whether user is at bottom via scroll position; if so, scroll-to-bottom on each update; if user has scrolled up, hold position. Resume follow if user scrolls back to bottom. Standard terminal pattern.
- Fixed height: **200px** as the default (midpoint of CTO's 180-220 suggestion). Not user-resizable in MVP.
- When `visible === false`: collapse completely (render nothing, zero DOM footprint). Not just visually hidden.

**6. Client-side — toggle + per-session persistence.**

Toggle control: small button in the pane header (or a small inline button above the mirror when visible — CODER chooses UX) that flips `visible`. Button label/icon: "Mirror" or similar text + a small terminal/monitor icon from lucide-react.

Persistence: per-session. When the user hides the mirror on session A, reloads the page, the mirror stays hidden on A. Shown on B if previously shown.

Implementation discretion: either extend `useSessionUi` (per M7 pattern) to carry a `mirrorVisible` field, OR use a sibling preference hook. CODER picks the lower-friction path. localStorage scoped by sessionId is acceptable if DB persistence is out of scope for this rotation.

**7. Client-side — mount in `<Pane>`.**

At `client/src/pages/PaneContainer.tsx`, in the `<Pane>` component, add `<TmuxMirror sessionId={sessionId} />` immediately after `{header}` (line 211), before the chat content wrapper. Conditional render based on the `visible` state from the persistence hook.

**8. Client-side — `ansi_up` dep.**

Add to `client/package.json` dependencies: `"ansi_up": "^6.0.0"`. Install via `pnpm install` in the client package.

### Out of scope — explicit non-goals

Per CTO brief §Scope:

- **Interactive terminal.** Read-only mirror only. No input handling. No keyboard capture. No `node-pty`. No `xterm.js`. If CODER scope-creeps toward interactivity, REJECT and REVERT. Phase P.3 (`1f4235f`) deleted `xterm.js` + `node-pty` for stated product reasons; Phase T is NOT a re-add.
- **Terminal tab / full terminal view.** That feature was deleted in Phase P.3. Phase T is the mirror only.
- **Search within pane.** Post-MVP.
- **Custom copy selection.** Browser-native text selection on a `<div>`/`<pre>` is sufficient for MVP.
- **Resize / drag-to-adjust height.** Post-MVP.
- **Scrollback history beyond what `tmux capture-pane` returns.** MVP shows what the capture returns; full scrollback is post-MVP if it surfaces as a need.
- **Per-pane mirror visibility in DB.** localStorage is fine for MVP. DB persistence is post-MVP.
- **Server-side classifier changes.** Any touch to `classifyStatusFromPane` or the state derivation chain belongs in Phase Y. Phase T is tee-only.

---

## File boundaries (strict)

Touch:
- `server/src/services/tmux.service.ts` — Option A extension of `capturePane` signature OR unchanged if Option B chosen.
- `server/src/services/agent-status.service.ts` OR `server/src/services/status-poller.service.ts` — add the tee emit post-capture, pre-classify. Option B also adds ANSI strip here.
- `server/src/ws/event-bus.ts` — new `emitSessionPaneCapture` method.
- `server/src/ws/index.ts` — broadcast handler registration on `pane-capture:<sessionId>` channel.
- `packages/shared/src/types/ws-events.ts` — new `session:pane-capture` WSEvent variant.
- `client/package.json` — add `ansi_up` dependency.
- `client/src/components/chat/TmuxMirror.tsx` — NEW component.
- `client/src/hooks/useSessionUi.ts` OR new sibling hook — persistence for `mirrorVisible` per session.
- `client/src/pages/PaneContainer.tsx` — mount the mirror inside `<Pane>` at the specified location.
- Test files as appropriate under `server/src/**/__tests__/` and `client/src/**/__tests__/`.

Do NOT touch:
- `client/src/components/chat/ContextBar.tsx`, `client/src/pages/ChatPage.tsx`, `client/src/components/chat/ChatThread.tsx` — all Phase Y territory.
- `client/src/utils/contextBarAction.ts` — Phase Y territory.
- `client/src/hooks/useSessionStateUpdatedAt.ts`, `useToolExecutionState.ts` (doesn't exist yet), `useSessionState.ts` — Phase Y.
- `client/src/hooks/usePromptDetection.ts` — Item 3 (`00f1c30`) sacred.
- `client/src/components/chat/TerminalDrawer.tsx`, `client/src/components/chat/ProjectStateDrawer.tsx` — M7 surfaces, orthogonal.
- `client/src/components/sessions/SessionCard.tsx`, `client/src/components/sessions/effortCard.ts` — M8 surfaces, orthogonal.
- `server/src/services/session.service.ts` beyond what the tee emit requires — no spawn/lifecycle changes.
- `classifyStatusFromPane` itself — Phase T is tee-only.
- Any 15.3-arc test file unless a specific test there needs updating for the classifier non-regression (unlikely; flag to PM if needed).

If the fix requires touching a file outside these boundaries, STOP and ping PM with MINOR/MAJOR classification.

---

## Tests

Per OS §20.LL-L10 — user-observable or shape-contract tests, not internal function returns.

**Server-side:**

1. `tmuxService.capturePane` with `preserveAnsi: true` (Option A) OR the `-e` flag path (Option B) returns text that includes at least one ANSI escape sequence when the tmux pane has colored output. Mock tmux exec.
2. `tmuxService.capturePane` with `preserveAnsi: false` (or the stripped classifier path in Option B) returns text with zero ANSI escape sequences. Regression anchor for classifier.
3. `classifyStatusFromPane` behavior unchanged — run the existing classifier test suite and verify all tests pass on the classifier's input path (whether that's the second tmux call or the stripped output).
4. `emitSessionPaneCapture` emits the correct payload shape `{ sessionId, paneText, capturedAt }` and broadcasts on channel `pane-capture:<sessionId>`. Mock the event bus.

4b. **Dedupe behavior (CTO Amendment 1).** Given identical `paneContent` returned from `tmuxService.capturePane` on two consecutive status-poller ticks for the same `sessionId`, `emitSessionPaneCapture` is called exactly ONCE (not twice). Given changed `paneContent` on the second tick, it IS called the second time. Mock the poller tick + capture function; assert emit call count.

4c. **Cleanup hook (CTO Amendment 1).** Given a session is stopped/removed, the corresponding `lastEmittedByCapture.get(sessionId)` returns `undefined` after the stop path completes. Prevents Map leak over long uptimes.

**Client-side:**

5. `TmuxMirror` component subscribes to the correct channel on mount (`pane-capture:<sessionId>`). Unit/shape test.
6. On WS event receipt with matching sessionId + type, component updates internal state; with mismatched sessionId, component ignores the event (split-view isolation guard).
7. `ansi_up` renders colored text; test fixture containing a known ANSI escape produces HTML containing the expected `<span style="color:...">` or equivalent markup.
8. Toggle persistence: setting `visible: false` on session A, unmounting and remounting, preserves the hidden state.

**Integration anchor:**

9. Non-regression: existing `status-poller.service.ts` tests still pass. Status classification output unchanged.

Run `pnpm test` + `pnpm typecheck` across all three packages (shared + server + client). Target: current baselines + N new, all pass, typecheck clean.

---

## Acceptance criteria (8 per CTO brief §Acceptance)

Jose browser smoke:

1. **Live update.** Mirror pane shows the current tmux pane content, updating at the existing 1.5s cadence. Observable: type something in a CODER session, see it appear in the mirror within ~1.5s.

2. **Split-view isolation.** Open Commander in split view with two concurrent sessions. Each session's mirror shows its own pane text. Type in session A — only A's mirror updates. No cross-pane bleed.

3. **ANSI color fidelity.** Trigger colored output in a session (e.g., `ls --color=always` on a directory with different file types, or any tool that emits color). Mirror renders bolded text, colored labels, progress spinners with readable color — NOT as raw `\x1b[...` escape codes.

4. **Toggle works + persists.** Click the toggle — mirror hides immediately. Reload the browser. Mirror stays hidden on the session where you hid it. Click toggle again — mirror shows and continues updating.

5. **Scroll behavior.** Let the mirror fill with output. Observe: at-bottom follows new output. Scroll up — position holds; new output does NOT force-scroll. Scroll back to bottom — auto-follow resumes.

6. **No regression.** Existing status classification continues to work. ContextBar labels behave as they did pre-Phase-T (including the M7 / M8 / 15.3-arc surfaces). HeaderStats, session cards, all other UI unchanged.

7. **Performance.** Mirror updating does not cause visible ContextBar / chat jank. No WS backpressure. Target: mirror updates consume <5% of client CPU during steady-state (observable via browser task manager or DevTools performance tab).

8. **Non-interactive confirmed.** Clicking in the mirror does not focus any input. Typing on the keyboard while the mirror is the visually-focused element does NOT send keys to the tmux pane. The mirror is purely read-only. Text selection (browser-native) works; that's expected.

---

## Rejection triggers

(a) **Scope drift toward interactivity.** Any xterm.js, node-pty, keyboard input handling, or re-adding the deleted Terminal tab. REJECT + REVERT.

(b) **New server-side pane-capture loop.** Any separate `tmux capture-pane` tick outside the existing status-poller. REJECT — reuse the existing tick.

(c) **Classifier regression.** `classifyStatusFromPane` receives ANSI-contaminated input and breaks. Any existing classifier test failing. REJECT.

(d) **Phase Y surface touched.** ContextBar, ChatPage, ChatThread, contextBarAction, useSessionState, sessionState, isWorking derivation — any of it. REJECT.

(e) **Item 3 path touched.** `usePromptDetection.ts` or its modal mount logic. REJECT.

(f) **M7/M8 surfaces touched.** ProjectStateDrawer, SessionCard effort, CreateSessionModal effort. REJECT.

(g) **Scope drift past one rotation.** If implementation reveals Phase T needs more than one rotation, STOP and escalate. Do NOT split into sub-rotations silently. CTO brief explicit: "If scope drifts past one rotation, pull the brake."

(h) **Ship-green claim without Jose 8-criterion smoke.** PHASE_REPORT must declare "awaiting Jose browser smoke" explicitly. No unilateral ship-green.

(i) **Speculative-fix-forward on acceptance failure.** If smoke fails any criterion, do NOT speculative-fix. Instrument per `standards/INVESTIGATION_DISCIPLINE.md`, diagnose, then fix. OS §20.LL-L11.

(j) **Emit path fires on every tick regardless of content change (CTO Amendment 1).** The dedupe `Map<sessionId, string>` gate at the tee point is load-bearing. If the implementation emits unconditionally on every status-poller tick, WS traffic saturates during idle windows. Reject.

---

## Commit discipline

One rotation hard ceiling. One commit preferred. Maximum two commits:

- Commit A: `feat(ui): Phase T MVP — tmux mirror pane (read-only, per-session, ANSI-color)`.
- Commit B (only if server and client changes are large enough to warrant review separation): split between server tee infrastructure and client component. Document the split in PHASE_REPORT.

Never bundle Phase T work with anything else (not Phase Y, not M7/M8 follow-ups, not candidate queue items).

---

## PHASE_REPORT requirements

Sections:
1. Implementation choice: Option A (signature extension) vs Option B (inline ANSI strip). One-sentence rationale.
2. Files touched with diff summary.
3. Tests added + non-regression suite pass count.
4. Typecheck clean declaration.
5. Scope adherence: file boundaries held.
6. Explicit "awaiting Jose 8-criterion browser smoke" gate.
7. Non-regression declaration: classifier + ContextBar + ProjectStateDrawer + SessionCard effort all verified untouched.
8. Rejection-gate self-audit (a) through (i).

---

## Sequencing after Phase T ships

1. Jose smokes 8 criteria. Green → Phase T CLOSED.
2. PM updates STATE.md, logs the Phase T commit stack.
3. PM folds CTO's Phase Y Amendments 1–5 into the held `PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md` draft.
4. PM returns amended Phase Y dispatch to CTO for one-round fire-ready confirmation.
5. Jose authorizes Phase Y fire.

Phase Y benefits meaningfully from Phase T being live during rotation-1 smoke — the mirror is ground-truth evidence alongside the `[codeman-diff]` log when Jose is verifying the Codeman-pattern handles each case correctly.

---

## Interaction with Phase Y (flag for awareness)

Phase T reuses the status-poller's tmux capture tick. Phase Y's Q5.6 (server-side poll lifecycle) left as post-phase follow-up candidate — meaning Phase Y may gate or delete the status-poller eventually. If that happens, Phase T's capture source must migrate to an independent tmux capture tick dedicated to the mirror (simple, small loop). Do NOT pre-solve this dependency during Phase T; flag it in Phase Y's dispatch (Amendment consideration) when folding.

---

## Standing reminders

Per `feedback_understand_before_patching` + OS §20.LL-L11: if live smoke reveals unexpected behavior, instrument via `[phase-t-instr]` tagged dedupe-gated logs per `standards/INVESTIGATION_DISCIPLINE.md`. Do NOT speculative-fix.

Per `feedback_self_dogfood_applies_to_status_fixes`: CODER's own Commander session is the cheapest testbed. Jose can watch YOUR mirror while you work during the rotation.

Per `feedback_vite_stale_code`: if HMR misses the new hook/component registration, restart `pnpm dev` fresh.

Per `feedback_coder_prompts_in_code_blocks`: PM will hand Jose the paste-prompt in a fenced block on ratification.

Fresh CODER spawn strongly recommended — context accumulation risk is real after M8 + `41a55e9` + M7.

---

**End of dispatch draft. Awaiting CTO ratification via Jose relay before fire.**
