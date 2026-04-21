# Candidate 36 — Instrumentation Rotation Findings

**From:** CODER (instrumentation rotation per `standards/INVESTIGATION_DISCIPLINE.md`)
**To:** PM + Jose
**Status:** Evidence-collected, instrumentation stripped. **No fix code shipped this rotation.**
**Preceded by:** M8 Secondary (`6b67cb5`) + Jose-observed cross-session effort leak in split view.
**Outcome:** Send path verified clean at four instrumented points. **The visually-observed "other-side mirrors" phenomenon is NOT an effort-routing bug.** It lives downstream of `tmuxService.sendKeys`, in the Phase T mirror display layer. Next rotation is another narrow instrumentation pass covering the display layer (proposed in §4).

---

## §1 — Capture

Protocol: Jose cold-restarted `pnpm dev`, hard-reloaded browser, opened split view with two sessions (PM + CODER), clicked `high` on PM's ContextBar effort dropdown, observed the OTHER pane's Live Terminal mirror.

Session ↔ tmux pane mapping established from the captures:

| Session | UUID | sessionName | tmux pane |
|---|---|---|---|
| PM | `822f2882-078e-4848-ad0d-8b07a140eac2` | PM - CommandC Fix | `%477` |
| CODER | `4c3bec9d-ad15-4287-9e34-a6e37571751b` | Coder - CC FIX | `%498` |

PM and CODER map to **distinct** tmux panes.

### Single-click capture — effort click on PM ContextBar

**Client (DevTools console, `ContextBar.tsx:333`):**

```
[effort-route-instr] P2 ContextBar.changeEffort {
  sessionId: '822f2882-078e-4848-ad0d-8b07a140eac2',
  level: 'high',
  focusPaneAncestor: '822f2882-078e-4848-ad0d-8b07a140eac2',
  ts: 1776745651138
}
```

**Server (`pnpm dev` stdout, `session.routes.ts:189`):**

```
[effort-route-instr] P3 POST /sessions/:id/command {
  paramsId: '822f2882-078e-4848-ad0d-8b07a140eac2',
  command: '/effort high',
  resolvedTmux: '%477',
  sessionName: 'PM - CommandC Fix',
  ts: 1776745651210
}
```

**Server (`tmux.service.ts:118`):**

```
[effort-route-instr] P4 tmuxService.sendKeys {
  target: '%477',
  keys: '/effort high',
  ts: 1776745651270
}
```

**Request/response envelope for the same POST:**

```
incoming request POST /api/sessions/822f2882-078e-4848-ad0d-8b07a140eac2/command
→ responseTime 206ms, statusCode 200
```

**Ancillary signal in the same capture window (NOT the effort click):**

```
can't find pane: %523
can't find pane: %524
```

These recur on every poll tick. Tmux is rejecting captures against two pane IDs that no longer exist — evidence of at least two session rows holding stale `tmux_session` values. Flagged for §4.

User-observable outcome Jose reported: after this single click on PM's effort dropdown, CODER's Live Terminal mirror displayed the `/effort high` command text.

---

## §2 — Divergence diff

| Point | File:line | sessionId captured | Next-hop destination | Correct? |
|---|---|---|---|---|
| P1 SessionCard | `SessionCard.tsx:194` | — (not invoked — click was on ContextBar) | — | n/a |
| P2 ContextBar | `ContextBar.tsx:333` | `822f2882` (PM) | `POST /sessions/822f2882/command` | ✅ |
| P3 route handler | `session.routes.ts:189` | paramsId=`822f2882` | resolvedTmux=`%477` (PM's pane) | ✅ |
| P4 tmuxService.sendKeys | `tmux.service.ts:118` | target=`%477` | `send-keys -t %477 -l '/effort high'` | ✅ |

**No row has source ≠ destination at any instrumented layer.** Exactly one effort command was sent, to exactly one tmux pane, the one that belongs to the session the user clicked. CODER's tmux pane (`%498`) did **not** receive `send-keys` for this event.

---

## §3 — Class root cause

**The effort-command send path is definitively clean at all four instrumented decision points.** Cited:

- Client scoping is correct. `ContextBar.tsx:333` emitted `sessionId='822f2882'` matching `focusPaneAncestor='822f2882'` at `ts=1776745651138`. The hook closure carried the right session id; no cross-session DOM ancestry leakage.
- Server route scoping is correct. `session.routes.ts:189` emitted `paramsId='822f2882'` which the request URL encoded verbatim, and the fresh `sessionService.getSession(id)` lookup resolved `tmuxSession='%477'` at `ts=1776745651210`.
- tmux wrapper scoping is correct. `tmux.service.ts:118` emitted `target='%477'` at `ts=1776745651270`, 60 ms after the route handler's resolution. The send-keys was dispatched to `%477` (PM) — not `%498` (CODER).

**Conclusion:** the `/effort high` command was delivered exactly once, to PM's pane, as the click intent required. Jose's observation that "the other side mirrors it" is therefore **not an effort-command routing bug**. The leak lives downstream of P4, in the display path that renders pane content back into the browser (Phase T mirror → `TmuxMirror.tsx` WS subscription → `status-poller.service.ts` tee emitter).

The four instrumented layers are not the failure site. **Any fix applied to SessionCard.changeEffort, ContextBar.changeEffort, POST /sessions/:id/command, or tmuxService.sendKeys would be speculative and off-target per OS §20.LL-L11.**

Contributing ambient signal: the repeated `can't find pane: %523` / `%524` stderr indicates at least two session rows hold stale `tmux_session` values. If the heal path ever re-assigns a stale row's `tmux_session` to a live pane that another session already owns, two session rows would share one tmux pane and the status-poller's mirror tee would broadcast identical pane capture content on two distinct `pane-capture:<sessionId>` channels — producing exactly the symptom Jose observed. This is a hypothesis to verify in the next rotation, not a conclusion from this capture (the poller's emit channel scoping was not instrumented this rotation).

---

## §4 — Fix shape (contract level only)

**No fix to the four instrumented layers.** They are correct.

**Recommended next rotation: narrow instrumentation of the Phase T mirror display path.** One commit of instrumentation + Jose capture + diagnostic; mirror this rotation's template. Two new decision points:

- **D5 — `TmuxMirror.tsx` subscribe site.** Log on every subscribe/unsubscribe effect pass: `(propsSessionId, subscribedChannel)`. Answers the question "does CODER's TmuxMirror subscribe to `pane-capture:4c3bec9d` or to `pane-capture:822f2882`?" If the effect ever subscribes to the wrong channel for its `props.sessionId`, the leak is localized there — analogous to the `useSessionUi` same-tab cross-instance bug the Rotation 1.5 hotfix (`9bba6ab`) closed for the preferences layer.
- **D6 — `status-poller.service.ts` mirror tee emit.** Log at each `emitSessionPaneCapture(sessionId, paneText, ts)` call: `(session.id, session.tmux_session, derivedChannel)`. Answers the question "does the poller emit `pane-capture:822f2882` with the content captured from `%477`, and also emit `pane-capture:4c3bec9d` with content captured from `%477` because two session rows share `tmux_session='%477'`?"

**Candidate fix shapes, contingent on the next capture:**

1. **If D5 reveals subscription drift in `TmuxMirror`:** align the subscribe effect's dependency array and channel-string derivation with the M7 pattern in `useProjectStateMd.ts` which already survived audit. `TmuxMirror.tsx`'s channel string is computed from `props.sessionId` — a stale-closure bug over sessionId prop changes is the most plausible mechanism (mirror of Rotation 1.5 Fix Z's mechanism, different surface).
2. **If D6 reveals two sessions sharing a tmux pane:** fix at data-layer, not display-layer. Run a reconciliation pass at session spawn / heal that asserts `tmux_session` uniqueness across non-stopped rows; flag collisions as force-heal candidates. Related: audit the stale `%523` / `%524` rows surfaced in this capture — they are evidence that the heal path is not currently running tightly enough.
3. **If D6 reveals the poller emits on the wrong `pane-capture:<id>` channel** (e.g. emit uses `session.tmux_session` instead of `session.id` as the channel suffix): trivial fix at the emit call site. Acceptance test: two session rows sharing a tmux pane must still produce two independent channel broadcasts keyed by distinct `session.id` values.

**No contract-level fix until the D5 + D6 capture localizes the mechanism.** Speculative-fix is rejected per `standards/INVESTIGATION_DISCIPLINE.md`.

---

## Strip verification

- `grep -rn '\[effort-route-instr\]' client/src server/src` → empty after strip.
- `git diff --stat` on the post-strip working tree shows only `docs/candidate-36-diagnostic.md` modified.
- Four files reverted to HEAD via `git checkout -- <path>`: `SessionCard.tsx`, `ContextBar.tsx`, `session.routes.ts`, `tmux.service.ts`.

No test changes. No Phase Y surface touched. No `[codeman-diff]` logger or JSONL touched.
