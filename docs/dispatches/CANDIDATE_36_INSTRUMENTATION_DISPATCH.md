# Candidate 36 — Cross-Session Effort Leak Instrumentation (no fix)

**From:** PM (Commander)
**To:** CODER (continuing from Phase Y Rotation 1.5 — same session; surface is orthogonal)
**Type:** INSTRUMENTATION ROTATION per `standards/INVESTIGATION_DISCIPLINE.md`. NO FIX CODE. NO REVERT PROPOSAL. NO SPECULATION.
**Preceded by:** M8 Primary (`1d33160`) + M8 Secondary (`6b67cb5`) both shipped green. Jose smoke on M8 Secondary surfaced cross-session leak as Candidate 36 (P1 destructive UX).
**Status:** Jose-authorized. PM-side code read at `SessionCard.tsx:190-198`, `ContextBar.tsx:329-340`, `ChatPage.tsx:44-46`, `effortCard.ts` helpers all show per-session scoping at source level. No obvious bug in the click-handler layer. Bug must live elsewhere — server-side routing, fan-out at the api call, or DOM-click disambiguation. Instrumentation localizes before any fix.

---

## Observed bug

In split-view with two concurrent sessions (PM pane + CODER pane), Jose changed the CODER session's effort level via M8 Primary UI (SessionCard click-to-adjust or ContextBar dropdown — ambiguous which one he used). Effective result: CODER's effort changed correctly, AND PM session's tmux pane ALSO received the /effort command. PM's Live Terminal (Phase T mirror) displayed Low while PM's ContextBar effort dropdown correctly still showed Medium (DB state unchanged for PM).

Conclusion: the /effort command was delivered to the wrong (or both) tmux pane(s). DB state for PM is unchanged (ContextBar correctly reports Medium) but PM's Claude Code runtime received the Low effort command from somewhere.

## Instrumentation scope — 4 decision points

Tag prefix `[effort-route-instr]`. Dedupe-gated (module-level `Map<traceId, signature>`) so repeat-click noise doesn't flood logs.

**Point 1 — SessionCard.changeEffort entry.**
- File: `client/src/components/sessions/SessionCard.tsx:190-198`
- Log at the top of `changeEffort(level, e)`:
  - `session.id` (the card's scoped session id)
  - `level` (the effort being set)
  - Captured event target: `e.currentTarget.getAttribute('data-pane-session-id') ?? e.currentTarget.closest('[data-pane-session-id]')?.getAttribute('data-pane-session-id') ?? null` (for disambiguation — confirms the click event's DOM ancestry matches `session.id`)
  - Timestamp

**Point 2 — ContextBar.changeEffort entry.**
- File: `client/src/components/chat/ContextBar.tsx:329-340`
- Log at the top of the `changeEffort` useCallback:
  - `sessionId` prop (what ContextBar was instantiated with)
  - `level`
  - `document.activeElement?.closest('[data-pane-session-id]')?.getAttribute('data-pane-session-id')` (DOM focus pane at click moment)
  - Timestamp

**Point 3 — Server-side `POST /sessions/:id/command` handler entry.**
- File: `server/src/routes/session.routes.ts` — find the route handler for `POST /sessions/:id/command` (already exists; M8 uses this endpoint). Log at handler entry:
  - `request.params.id` (the session id the client sent)
  - `request.body.command` (the slash command text)
  - Resolved tmux target (how the server determines which tmux pane to `send-keys` into — record the exact value)
  - Timestamp

**Point 4 — Server-side tmux send-keys wrapper entry.**
- File: `server/src/services/tmux.service.ts` — find the `sendKeys` or `send-keys` wrapper. Log at entry:
  - Target tmux pane name the wrapper is about to send keys to
  - Key text being sent (truncate to first 50 chars for noise control; enough to identify `/effort` commands)
  - Caller source if easily available (e.g. `caller` heuristic or pass through a context marker)
  - Timestamp

All four points use `console.log('[effort-route-instr] <P1|P2|P3|P4> <payload>')` on the appropriate side (client for 1-2, server for 3-4). Client logs appear in DevTools console; server logs in Commander's server stdout (whichever log tail Jose can access).

## Capture protocol (Jose-executed after CODER ships instrumentation)

Single repro, ~1 minute of user time:

1. Cold-restart Commander dev server (`pnpm dev` fresh) + hard-reload browser (Vite staleness memory).
2. Open split view with two sessions — Pane A = PM, Pane B = CODER.
3. Open DevTools console. Open a server log tail (whatever surface exposes server stdout).
4. In Pane B's SessionCard (or ContextBar, whichever surface Jose used during the original bug observation — document which), click effort dropdown and select a non-default level (e.g. `low`).
5. Observe PM pane's Live Terminal mirror for the `/effort` command arrival. If it appears, the bug reproduced.
6. Export both console logs and server logs.

If the bug does NOT reproduce on the repro attempt (flaky / conditional), try the alternate surface (ContextBar if first was SessionCard, or vice versa). If still nothing, the bug is conditional on some state CODER needs to instrument further.

## Deliverable — `docs/candidate-36-diagnostic.md` (NEW, appended or created)

Sections:

**§1 — Capture.** Raw log output from both client + server side, labeled by point (P1/P2/P3/P4) and timestamp-aligned. Minimum content: the sessionId captured at each of the 4 points. If Point 1 captures `sessionB-id` (CODER) and Point 4 sends keys to `tmuxA-pane` (PM's tmux), the divergence is named.

**§2 — Divergence diff.** Table: one row per point, columns for sessionId captured + next-hop destination. Row where source/destination disagree names the failure layer.

**§3 — Class root cause.** One-paragraph statement with cited log line refs. "At Point X the value was Y; at Point X+1 it became Z; divergence localized to [mechanism]." No prose handwaving.

**§4 — Fix shape (contract level only).** If §3 is decisive, name the fix. Examples: "client-side sessionId is captured correctly but server's `resolveTmuxPane(sessionId)` returns the focused-pane's tmux instead of the requested session's tmux — fix at `tmux.service.ts:XX`." If §3 reveals multiple contributing factors, enumerate. NO CODE.

## Commit discipline — ZERO code commits

One commit only: `docs(candidate-36): instrumentation rotation findings`. Contents = `docs/candidate-36-diagnostic.md` only. Instrumentation added + stripped within the working tree, never committed.

Workflow:
1. Add instrumentation to the 4 points.
2. Verify typecheck clean + no test breakage (instrumentation should be additive).
3. Hand off to Jose for capture.
4. Receive capture output from Jose.
5. Write §1-§4 of the diagnostic.
6. Strip instrumentation via `git checkout -- <files>` (reverting to HEAD on the four instrumented files).
7. Verify strip: `grep -rn '\[effort-route-instr\]' client/src server/src` returns empty; `git diff --stat` shows only `docs/candidate-36-diagnostic.md` modified.
8. Commit the diagnostic.

## File boundaries

Instrumentation allowed in:
- `client/src/components/sessions/SessionCard.tsx`
- `client/src/components/chat/ContextBar.tsx`
- `server/src/routes/session.routes.ts` (find the POST `/sessions/:id/command` handler)
- `server/src/services/tmux.service.ts` (find the send-keys wrapper)

Deliverable written to:
- `docs/candidate-36-diagnostic.md` (NEW)

Every other file untouched. Especially NOT:
- Phase Y surfaces (`useToolExecutionState`, `useChat`, `contextBarAction`, `useCodemanDiffLogger`) — parallel-run observation window is ACTIVE; do not contaminate
- 15.3-arc legacy guards
- Phase T mirror tee, `usePreference`, `TmuxMirror`
- M7 drawer + hook
- Item 3 `usePromptDetection`
- `effortCard.ts` (helpers are correctly scoped per source-read; bug is upstream or downstream, not in the helpers)
- Any test file (instrumentation is not tested; the capture is the evidence)

## Rejection triggers

(a) Any fix code this rotation.
(b) Files outside the instrumentation list touched.
(c) Diagnostic draft without §1 raw capture (evidence required).
(d) §3 class root cause without cited log-line refs (no prose-only claims).
(e) Instrumentation strip not verified (`grep` must return empty, `git diff --stat` must show only the diagnostic file).
(f) Phase Y `[codeman-diff]` logger modified or JSONL touched.
(g) PHASE_REPORT claims ship-green without Jose capture declaration.

## Expected duration

- CODER instrumentation add: ~15 min.
- Jose capture + log export: ~5 min.
- CODER diagnostic writing + strip + verify + commit: ~15 min.

Total: ~30-35 min including Jose's hands-on capture step.

---

## Standing reminders

Per `feedback_understand_before_patching` + OS §20.LL-L11: this is EVIDENCE-COLLECTING, not fix-proposing. Do not speculate on mechanism during the instrumentation phase — the instrumentation tells us the answer.

Per `feedback_self_dogfood_applies_to_status_fixes`: Jose's own Commander session + CODER's own session (in split view) is the ideal repro environment.

Per `feedback_vite_stale_code`: cold-restart dev server before Jose's capture step.

Go.
