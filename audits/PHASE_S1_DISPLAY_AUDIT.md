# Phase S.1 Patch 6 — Display Stale-Risk Audit

## Executive Summary
Every display component that renders session state is ultimately driven by two channels: WebSocket push and one-shot REST hydrate on mount. No component implements a rehydrate-on-reconnect flow, so if the WS link drops mid-turn and resumes, values like `ctx%`, teammate list, and pre-compact state are only refreshed by the next server-pushed event — not by a client-initiated catch-up fetch. Patch 4's ctx% SSoT fix holds cleanly across `ContextBar`, `LiveActivityRow`, `ContextLowToast`, and the band rail; no sibling surface was missed. The most load-bearing gap is `useSessionTick` — a dropped WS will freeze ctx% until the next tick naturally arrives, because the hook never re-fetches `GET /sessions/:id/tick` on reconnect.

## Per-component findings

### SessionCard (`client/src/components/sessions/SessionCard.tsx`)
- **Subscribes to:** `session:heartbeat` (via `useHeartbeat`), `pre-compact:state-changed` (via `usePreCompactState`).
- **Hydrates from:** `GET /pre-compact/status` (once via `usePreCompactState` cache); `PATCH /pre-compact/sessions/:id` on toggle.
- **Stale-risk signals:** `lastActivityAt`, `status` badge (heartbeat-gated), `autoCompactEnabled` (optimistic toggle, no rollback).

### SessionsPage (`client/src/pages/SessionsPage.tsx`)
- **Subscribes to:** `session:created`, `session:updated`, `session:deleted`, `session:status` (via `useSessions`).
- **Hydrates from:** `GET /sessions` on mount, one-shot (no polling).
- **Stale-risk signals:** Session list completeness — frozen during WS disconnect until next event replays.

### ChatPage (`client/src/pages/ChatPage.tsx`)
- **Subscribes to:** `session:tick` (via `useSessionTick`), `session:heartbeat` (via `useHeartbeat`), plus session events via `useSessions`.
- **Hydrates from:** `GET /sessions/:id/tick` (mount only); `GET /sessions/:id` polled at 1.5s.
- **Stale-risk signals:** `tick.contextWindow.usedPercentage` freezes if WS drops before next tick (no reconnect rehydrate). Session status stays fresh via 1.5s poll.

### ContextBar (`client/src/components/chat/ContextBar.tsx`) — **Patch 4 target**
- **Subscribes to:** None direct; reads `sessionTick` prop from ChatPage.
- **Hydrates from:** Effort-change writes via `POST /sessions/:id/command` + `PATCH /sessions/:id` (optimistic).
- **Stale-risk signals:** ctx% now routed through `resolveContextPercent(tick, tokens, limit)` — tick-first, token-ratio fallback. No drift vs LiveActivityRow. Effort-level optimistic write has no rollback on error.

### LiveActivityRow (`client/src/components/chat/LiveActivityRow.tsx`)
- **Subscribes to:** None direct. Consumes `tick` + `activity` props from ChatPage.
- **Hydrates from:** None.
- **Stale-risk signals:** ctx% + token count freeze if parent `useSessionTick` freezes. `activity.verb/spinner/elapsed` freeze if `session:updated` stops.

### HeartbeatDot (`client/src/components/shared/HeartbeatDot.tsx`)
- **Subscribes to:** `session:heartbeat` (via `useHeartbeat`).
- **Hydrates from:** Seeded from parent `session.lastActivityAt`; no REST.
- **Stale-risk signals:** 1s local ticker. `isStale` flips at >30s without heartbeat. Once stale, only a new heartbeat clears it — no REST probe or timeout reset.

### HeaderStatsWidget (`client/src/components/layout/HeaderStatsWidget.tsx`)
- **Subscribes to:** `system:stats`, `system:rate-limits`.
- **Hydrates from:** `GET /system/rate-limits` once on mount.
- **Stale-risk signals:** Explicit `isStale` gate at >6s (3× cadence) on system stats — widget mutes chips to "—" when stale. **Best-behaved surface in the app.**

### SplitChatLayout (`client/src/pages/SplitChatLayout.tsx`)
- **Subscribes to:** `teammate:spawned`, `teammate:dismissed`, `session:updated`, `session:status` (via `useWebSocket().lastEvent`).
- **Hydrates from:** `GET /sessions/:id/teammates` on mount + refresh on WS events; `PATCH /preferences` for split state; `POST /sessions/:id/dismiss` + `POST /sessions/:id/system-notice`.
- **Stale-risk signals:** Teammate list — spawns fired during a WS drop are lost unless server replays (it does not). Recovery requires manual refresh.

### ContextLowToast (`client/src/components/shared/ContextLowToast.tsx`)
- **Subscribes to:** None direct. Consumes `band` + `percentage` props.
- **Hydrates from:** None.
- **Stale-risk signals:** Band transitions only fire on upward crossings. If WS drops while already in orange, a fresh orange tick on reconnect does NOT re-fire the toast.

### PreCompactIndicator (`client/src/components/sessions/PreCompactIndicator.tsx`)
- **Subscribes to:** `pre-compact:state-changed` (via `usePreCompactState`).
- **Hydrates from:** `GET /pre-compact/status` (module-level cache, survives remount).
- **Stale-risk signals:** Frozen if WS drops; cache-hit avoids flicker on remount. Server re-emits on reconnect for in-flight compactions.

### TopCommandBar (`client/src/layouts/TopCommandBar.tsx`)
- **Subscribes to:** `useWebSocket().connected`; `session:created/updated/deleted/status` via `useSessions`; daily stats via `useAnalytics`.
- **Hydrates from:** Delegated to hooks.
- **Stale-risk signals:** Session tabs + totals freeze on WS drop. Connection dot flips red immediately — the one honest staleness signal the UI actually exposes.

### ChatThread (`client/src/components/chat/ChatThread.tsx`)
- **Subscribes to:** None direct — consumes `messages`, `sessionTick`, `heartbeatStale`, `sessionActivity` from parent.
- **Hydrates from:** Parent `useChat` (mount + implicit fetch on message events).
- **Stale-risk signals:** Cascades all parent staleness. Pure consumer.

## Global reconnect hydrator

- `client/src/services/ws.ts` — exponential backoff (1s → 30s), auto-resubscribes to `['sessions']` after reconnect.
- **No hydrate-on-reconnect flow exists.** No component listens for a reconnect event and re-fetches its REST seed.
- Consequence: any state that mutated server-side during the disconnect window (teammate spawn, session status flip, tick advance) is only reflected when the next server-pushed event arrives — which may be immediate (`session:tick` cadence is 300ms–1s) or arbitrarily delayed.

## Stale-risk matrix

| Component | Value | Risk on WS drop | Fallback? |
|-----------|-------|-----------------|-----------|
| SessionCard | `status`, `lastActivityAt` | Frozen until next heartbeat | Heartbeat 30s stale flag |
| SessionsPage | Session list | Frozen until next `session:*` event | None — one-shot mount fetch |
| ChatPage | `session.status`, `activity` | Polled @1.5s — fresh | 1.5s REST poll |
| ChatPage | `tick.contextWindow.*` | Frozen — **no reconnect rehydrate** | None |
| ContextBar | ctx% | Tick-first, token-ratio fallback | Token ratio when tick null |
| ContextBar | Effort level | Optimistic — no rollback on error | Next `session:updated` |
| LiveActivityRow | ctx% + tokens | Cascades ChatPage tick | None |
| HeartbeatDot | `secondsAgo`, `isStale` | 1s ticker keeps incrementing | Flips to stale at 30s |
| HeaderStatsWidget | CPU/Mem/Budget | Mutes to "—" at >6s | **Explicit stale gate** |
| SplitChatLayout | Teammate list | Spawns during drop are lost | WS re-subscribe only |
| ContextLowToast | Band crossing | Upward-only gate — re-entry suppressed | None |
| PreCompactIndicator | `state` | Frozen — server replays on reconnect | Cache + server replay |
| TopCommandBar | Tabs, totals | Frozen until WS events | Connection dot flips red |
| ChatThread | All props | Cascades parent | None |

## Bugs surfaced (FLAG, don't fix)

1. **`useSessionTick` has no reconnect rehydrate** — `client/src/hooks/useSessionTick.ts` — ctx% freezes indefinitely if WS drops between ticks; no `GET /sessions/:id/tick` retry on reconnect.
2. **`HeartbeatDot` never recovers from stale visually** — `client/src/hooks/useHeartbeat.ts` — once `isStale` flips true at 30s, only a fresh `session:heartbeat` clears it; no timeout reset or probe.
3. **SplitChatLayout teammate spawn race** — `client/src/pages/SplitChatLayout.tsx` — `teammate:spawned` emitted during a WS gap is never replayed; requires manual refresh.
4. **SessionsPage has no reconnect rehydrate** — `client/src/hooks/useSessions.ts` / `SessionsPage.tsx` — session list frozen until next WS event; `GET /sessions` on reconnect would close the gap.
5. **ContextBar effort-change has no rollback** — `client/src/components/chat/ContextBar.tsx:~277` — failed `PATCH /sessions/:id` leaves UI showing the attempted effort until WS `session:updated` arrives.
6. **ContextLowToast suppresses re-entry** — `client/src/components/shared/ContextLowToast.tsx` — if ctx% was already orange when WS dropped, a fresh orange tick on reconnect does NOT re-fire the toast (upward-crossing gate).
7. **No global reconnect hydrate** — `client/src/services/ws.ts` — no `'connect'`/`'reconnect'` callback triggers a refresh of WS-driven REST seeds (`/sessions`, `/pre-compact/status`, `/system/rate-limits`, `/sessions/:id/tick`). A single "hydrate-on-reconnect" bus would close most gaps in #1, #3, #4 at once.
