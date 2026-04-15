# Commander token-efficiency audit — 2026-04-15

Scope: API polling cadences, redundant calls, re-render pressure, WS
amplification. "Token" here means both bytes-over-the-wire to the
Commander server and Claude-token amplification (where a client pattern
would cascade into extra Claude API usage). Audited against HEAD
`415df99` (post-#214 city view).

Verdict scale:

- **Fine** — justified given the data-freshness need.
- **Optimizable** — works today but has a clear win; file a follow-up if
  non-trivial.
- **Wasteful** — measurable duplication or unnecessary work; **file a
  follow-up task**.

---

## 1. `useChat` — chat + stats polling (working: 1.5s, idle: 5s) — **Fine**

`client/src/hooks/useChat.ts:135-187`. Two parallel GETs every tick:
`/chat/:id?limit=500` + `/chat/:id/stats`. Adaptive cadence (1.5s when
working/waiting, 5s otherwise). Polls the last 500 messages in full
each time.

- Page-size is 500 regardless of current total; on a 200-msg session
  that's the full message set returned every poll. Server side this is a
  JSONL read, cheap. Bytes over the wire grow linearly with session
  length.
- Stats is its own endpoint — full-transcript walk on the server.

**Optimizable** — an `?since=<msgId>` tail-delta endpoint would let
polls return only new messages after the first page. Big session chats
today send O(messages) every 1.5s. Filing **#216**.

---

## 2. `useSessions` — list fetch, WS-driven updates — **Fine**

`client/src/hooks/useSessions.ts:24-30`. One GET on mount; all further
state comes via WS `session:*` events. This is the correct pattern.

---

## 3. `TopCommandBar` + `MobileOverflowDrawer` — 15s re-polls of
`/sessions` + `/analytics/today` — **Wasteful**

`client/src/layouts/TopCommandBar.tsx:30-40` and
`client/src/layouts/MobileOverflowDrawer.tsx:25-35`.

Both layouts independently poll the same two endpoints on 15s timers.
On a dashboard with the overflow drawer also mounted, that's 4 GETs
every 15s just for the status bar + drawer, duplicated by whatever
`useSessions` is doing elsewhere.

The data is already on the wire via WS events consumed by `useSessions`
and `useAnalytics`. These layout components should subscribe to the
same state (via context or a shared hook) instead of re-fetching.

Filing **#217**.

---

## 4. `CreateSessionModal` — projects fetch on every mount — **Optimizable**

`client/src/components/sessions/CreateSessionModal.tsx:33`. Fires
`/projects` GET every time the modal opens. Results rarely change and
are already populated by `useProjects` on the Projects page.

Filing **#218** (low priority — fires only on modal open, not
continuously).

---

## 5. `usePromptDetection` — pane output polling (1s/2s) — **Fine**

`client/src/hooks/usePromptDetection.ts:139-176`. 1s when just-sent /
waiting, 2s for steady working. This is the permission-prompt surfacer;
it MUST poll since tmux-pane content has no push channel. Cadence is
already justified in the source comments.

**However** — a session in `idle`/`stopped` status has the hook skipped
upstream. Good. Verified.

---

## 6. `SessionTerminalPreview` — 2s pane polling per preview — **Optimizable**

`client/src/components/chat/SessionTerminalPreview.tsx:33-44`. Each
mounted preview polls its own session's `/output?lines=25` on 2s
intervals. With #197's multi-tab pane (up to 3 simultaneous teammates),
that's 3 concurrent pane-output polls on a busy view.

Two improvements possible:

- Pause the interval when the preview is off-screen (IntersectionObserver).
- Coalesce into a single server-side `/output?sessions=a,b,c` endpoint
  to reduce HTTP overhead on low-RTT networks.

Filing **#219** — medium priority, visible win on multi-teammate views.

---

## 7. `ContextBar` — 1s elapsed-time ticker — **Fine**

`client/src/components/chat/ContextBar.tsx:291`. Pure `setInterval`
with no fetch — just flips a "long task" badge past 60s. 1s granularity
is necessary for the elapsed-timer display. No network cost.

---

## 8. `HealthBanner` — 1s staleness ticker — **Fine**

`client/src/components/shared/HealthBanner.tsx:33`. Same pattern as #7
— timer-only, no fetch.

---

## 9. `CityPage` — reads `useSessions` + `useWebSocket.lastEvent` — **Fine**

Zero new polling; CSS keyframes halt when the tab is hidden. Verified
against the #214 brief's constraint.

---

## 10. Render amplification — session list selectors — **Optimizable**

`SessionsPage` + `CityPage` + `SplitChatLayout` each re-derive the
parent/teammates tree from `useSessions` output. Each page does its
own `useMemo` over the full list, so a `session:status` WS event that
changes one session triggers three separate re-derivations.

Filing **#220** — low priority, move the tree derivation into a shared
hook so the memo is computed once per WS tick.

---

## 11. WS event amplification — broadcast scope — **Fine**

Server emits `session:status` via `rooms.broadcast('sessions', ...)`.
All sockets subscribed to the `sessions` room receive it — necessary
for any page showing the session list. `chat:message` is scoped to
`chat:<sessionId>` rooms (correct). `analytics` channel scoped too.
No amplification observed.

---

## 12. `useAnalytics` — WS subscription without handler — **Optimizable**

`client/src/hooks/useAnalytics.ts:72-76`. Subscribes to `analytics`
channel but never reads `lastEvent` to update state. On mount it
fetches once; thereafter the hook never re-fetches or reacts to WS.
AnalyticsPage relies on fresh-mount data and is effectively static
once loaded.

Result: WS subscription is dead weight (no handler wired). Either drop
the subscribe call OR wire it to refresh the data on a `usage:updated`
event.

Filing **#221** — low priority, single-line cleanup OR a small wiring
change depending on the chosen fix.

---

## Summary

| # | Area | Verdict | Follow-up |
|---|------|---------|-----------|
| 1 | useChat polling | Fine / Optimizable | #216 (tail-delta endpoint) |
| 2 | useSessions | Fine | — |
| 3 | TopCommandBar + MobileOverflowDrawer duplicate polls | **Wasteful** | **#217** |
| 4 | CreateSessionModal projects fetch | Optimizable | #218 |
| 5 | usePromptDetection | Fine | — |
| 6 | SessionTerminalPreview pane poll | Optimizable | #219 |
| 7 | ContextBar ticker | Fine | — |
| 8 | HealthBanner ticker | Fine | — |
| 9 | CityPage | Fine | — |
| 10 | Session-tree derivation amplification | Optimizable | #220 |
| 11 | WS broadcast scope | Fine | — |
| 12 | useAnalytics dead WS sub | Optimizable | #221 |

**Wasteful**: 1 (#217). **Optimizable**: 5 (#216, #218, #219, #220, #221).
**Fine**: 6. Zero correctness issues.

Recommended order of attack:
1. #217 first — double-polling is a live inefficiency hitting every
   dashboard load.
2. #216 next — largest single-endpoint byte savings at steady state.
3. #219 if multi-teammate views remain common.
4. #221 / #218 / #220 as cleanup.
