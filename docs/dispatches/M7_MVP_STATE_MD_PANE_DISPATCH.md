# M7 MVP — Live STATE.md Pane (split-view-aware)

**From:** PM (Commander, 2026-04-20)
**To:** CODER (continuing post-M8)
**Type:** CODE ROTATION — close M7 MVP per migration CTO's brief §3 (MVP-STATE) and Commander CTO's locked sequence.
**Preceded by:** M8 shipped green at `1d33160`. Jose's live-smoke confirmed click-to-adjust working + ContextBar non-regression.
**Deliverable:** 1–2 commits, ~2–3 hour rotation, acceptance gate = Jose browser smoke on the 5-case matrix below.

---

## Scope framing — what's already built vs what M7 MVP adds

Reconnaissance established these pieces exist. Do NOT rebuild.

**Already shipped:**
- `server/src/services/file-watcher.service.ts:140` — filters project-file changes to exactly `STATE.md` or `PM_HANDOFF.md`. Watcher already emits on STATE.md write.
- `server/src/services/watcher-bridge.ts:145-165` — routes watcher changes through the event bus.
- `packages/shared/src/types/session.ts:54` — `Session.projectPath` is always populated for Commander-spawned sessions (Issue 15.2 `fs.realpathSync` canonicalized).
- `client/src/components/projects/StateViewer.tsx:10` — pure presentation component, `react-markdown` + `remark-gfm`, takes `content` prop.
- `client/src/pages/ProjectDetailPage.tsx:187` — existing consumer of StateViewer (for navigation-based project view; DO NOT MODIFY).
- `server/src/ws/event-bus.ts:16-120` — event-bus emit methods (emitProjectUpdated etc.) and channel conventions.
- `client/src/hooks/useWebSocket.tsx:52-56` — subscription pattern.
- `client/src/pages/PaneContainer.tsx:210-479` — split-view architecture. Per-pane components mount inside `<Pane>` alongside `<TerminalDrawer>`.
- `client/src/components/chat/TerminalDrawer.tsx:1-144` — per-pane drawer pattern: Cmd+J toggle, resizable, height persisted per session via `useSessionUi()`.

**Actual M7 MVP gaps:**
1. **Live-update wiring.** No WS event currently emits STATE.md content on change. Watcher catches the change, but there's no channel that delivers the new content to a client-side hook.
2. **Per-pane drawer component.** No `ProjectStateDrawer` (or equivalent) component exists that mirrors TerminalDrawer's pattern for the STATE.md surface.
3. **Client hook.** No `useProjectStateMd(sessionId)` hook that subscribes to the new WS event and fetches initial content.
4. **Toggle affordance.** No keyboard shortcut or header button to open/close the pane.

Those four pieces are M7 MVP. Everything else is deferred to Full-M7 or Extended-M7 per migration brief §3.

**Explicitly out of scope this rotation:**
- All 4 canonical files (CLAUDE.md, PROJECT_DOCUMENTATION.md, DECISIONS.md) — MVP is STATE.md only per migration brief. Full-M7 adds tabs.
- Project type badge + applicable standards display — Extended-M7.
- Recent activity feed extraction from STATE.md — Extended-M7.
- Archive folder browsing — out of MVP per migration brief §6.2.
- Any write/edit affordance on the pane — explicit constraint per §6.1 (UI reads, does not replace).
- Per-project state in Commander DB — explicit constraint per §6.4 (file-watch + live read is the pattern).

---

## Implementation contract (not prescriptive, but bounded)

### 1. Server — WS event emission on STATE.md change

Extend `watcher-bridge.ts` (or equivalent) so that when a STATE.md change fires, the event bus emits a new event carrying the full updated contents. Suggested event shape:

```
channel: 'sessions' (reuse) OR new 'projects' channel
event: 'project:state-md-updated'
payload: { sessionId: string, projectPath: string, content: string }
```

Implementation discretion: CODER picks whether to reuse `sessions` channel or register a new `projects` channel. New channel is cleaner (subscription firewall) but requires touching `rooms.ts` fan-out. Reuse of `sessions` is minimal but subscribes every session-aware client to STATE.md events they might not want.

**Firewall constraint (load-bearing):** subscription pattern must NOT cause chat renderer to re-render on STATE.md updates. Whatever channel or event shape is chosen, the client-side hook must be structurally independent — no shared memo, no shared context, no state-lift through ChatPage's composite props. If the pane's content changes and chat re-renders, rejection trigger fires.

Emit cadence: debounce if STATE.md writes are very frequent. 500ms–1s debounce is reasonable. If writes are infrequent, skip debounce.

### 2. Server — initial-fetch endpoint

Decide the initial-content delivery path: either (a) include current STATE.md content in the first WS event after client subscribes, or (b) expose a small REST endpoint like `GET /api/sessions/:id/project-state-md` that returns the current file contents.

Option (b) is cleaner — separation between subscribe-for-changes vs read-current. Option (a) is simpler if the pane mounts then waits. CODER picks based on which fits better with `useWebSocket` patterns already in use.

File read discipline: if `<project_path>/STATE.md` doesn't exist, return empty string or null — don't throw, don't 404. Some projects may not have a STATE.md (legacy or pre-migration).

### 3. Client — `useProjectStateMd(sessionId)` hook

New hook at `client/src/hooks/useProjectStateMd.ts`. Signature:

```ts
export const useProjectStateMd = (sessionId: string | undefined): {
  content: string | null;  // null = not loaded yet or no STATE.md
  isLoading: boolean;
  lastUpdated: number | null;  // wall-clock of most recent update
}
```

Subscribes to the WS event for the given sessionId. On mount, fetches initial content. Unsubscribes on unmount or sessionId change.

### 4. Client — `ProjectStateDrawer.tsx` component

New component at `client/src/components/chat/ProjectStateDrawer.tsx` (mirror the TerminalDrawer location convention). Mirrors TerminalDrawer's pattern:

- Per-pane scoped via `sessionId` prop.
- Collapsible, default collapsed.
- Resizable (drag bar to adjust height or width — CODER picks orientation; TerminalDrawer is bottom-anchored, so a side-anchored drawer may be more natural for a longer STATE.md; consider.)
- Height (or width) persisted per session via `useSessionUi()` or a sibling preference hook.
- Content = `<StateViewer content={content ?? ''} />` — reuse the existing component, do not rebuild markdown rendering.
- Empty state: if `content === null` after initial fetch, show a muted "No STATE.md found in this project" message.

Toggle affordance: keyboard shortcut. Cmd+J is taken by TerminalDrawer. Suggest Cmd+Shift+S (S for State) — but CODER confirms no conflict first. If Cmd+Shift+S conflicts with an existing binding, pick an alternative and log the choice in PHASE_REPORT.

Optional: small header button on the pane (icon + tooltip "Show STATE.md") as a discoverable trigger in addition to the keyboard shortcut. Not required for MVP but low-cost.

### 5. PaneContainer integration

Mount `<ProjectStateDrawer sessionId={pane.sessionId} />` inside each `<Pane>` alongside existing `<TerminalDrawer>`. Split-view-aware means: pane A's drawer reads pane A's session's project_path; pane B's drawer reads pane B's. Independent state per pane.

---

## File boundaries (strict)

Touch:
- `server/src/services/watcher-bridge.ts` — add STATE.md emit path.
- `server/src/ws/event-bus.ts` — new emit method OR extend existing.
- `server/src/ws/rooms.ts` — IF a new channel is introduced.
- `server/src/routes/session.routes.ts` — IF a new `GET /sessions/:id/project-state-md` endpoint is added.
- `client/src/hooks/useProjectStateMd.ts` — NEW.
- `client/src/components/chat/ProjectStateDrawer.tsx` — NEW.
- `client/src/pages/PaneContainer.tsx` — mount the drawer inside `<Pane>`.
- `client/src/hooks/useSessionUi.ts` — IF it needs to carry new per-session drawer state.
- Type files in `packages/shared/src/types/` — IF a new WS event type needs shared shape.
- Test files under `client/src/**/__tests__/` and `server/src/**/__tests__/` as appropriate.

Do NOT touch:
- `client/src/pages/ProjectDetailPage.tsx` — separate surface, works, untouched.
- `client/src/components/projects/StateViewer.tsx` — reuse as-is. If it needs any adjustment, STOP and ping PM.
- `client/src/components/chat/TerminalDrawer.tsx` — pattern reference; do not modify it unless extracting a shared drawer primitive is unavoidable (and even then, ping PM first).
- `ContextBar.tsx`, `ChatPage.tsx`, `ChatThread.tsx`, any 15.3-thread surface — the subscription firewall means chat state pipeline stays untouched.
- `SessionCard.tsx` — M8 work, untouched.
- `session.service.ts` spawn/effort paths.
- `session.status` pane-classifier logic.
- Any file watched by Candidate 23/32/33 Codeman-model family — post-M7 phase owns those.

If investigation reveals the fix needs to touch a file outside these boundaries, STOP and ping PM with MINOR/MAJOR classification. Do NOT silently expand.

---

## Tests

Minimum set — shape contracts at the API/subscription level, given the test harness has no JSDOM for React rendering assertions (per M8's pattern):

1. **Hook shape test.** `useProjectStateMd(sessionId)` returns `{ content, isLoading, lastUpdated }` in the expected shape on mount, on WS event receipt, and on unmount.
2. **Event payload test.** Server emits `project:state-md-updated` with the correct `{ sessionId, projectPath, content }` shape when a watched STATE.md change is routed through the bridge. Mock the watcher event, assert emit call.
3. **Initial-fetch endpoint test (if Option b chosen).** `GET /api/sessions/:id/project-state-md` returns current file contents (or empty for missing file).
4. **Subscription firewall test.** Confirm that a STATE.md event does NOT trigger re-render of any chat-related component. Implementation: render a test harness that tracks chat component render count, fire a STATE.md event, assert render count unchanged. If this test is too heavy for the current harness, substitute with a structural grep (no shared memo/context between `useProjectStateMd` and any chat-state hook).
5. **Non-regression — ProjectDetailPage.** StateViewer on ProjectDetailPage still renders as before (grep-level check that the import and usage site are untouched + manual smoke).

Run `pnpm test` + `pnpm typecheck`. Target: current 337 baseline + new tests, all pass, typecheck clean.

---

## Commit discipline

One commit if the work fits cleanly (server wiring + client hook + component + mount in one atomic change). Two commits max: (a) server-side WS emit + endpoint, (b) client-side hook + component + pane mount. Never bundle with anything outside M7.

Commit message for single-commit case: `feat(ui): M7 MVP — live STATE.md pane (split-view-aware, per-pane scoped)`.

---

## Self-dogfood + acceptance gate

Jose's 5-case browser smoke:

1. **Initial render.** Open a session in Commander. Trigger the drawer (keyboard shortcut or button). Drawer appears. STATE.md content renders (markdown, not raw). If the project has no STATE.md, muted "No STATE.md found" message shown instead.

2. **Live update.** With the drawer open, modify the project's STATE.md from outside Commander (for example, `echo "test-line-$(date)" >> ~/Desktop/Projects/<project>/STATE.md` in a terminal). Within a few seconds, the drawer content updates to include the new line — no manual refresh.

3. **Split-view independence.** Open split view with pane A and pane B on two different projects. Open the drawer on each pane. Each pane's drawer shows its own project's STATE.md. Modify pane A's project STATE.md — only pane A's drawer updates. Pane B unchanged.

4. **Subscription firewall.** With the drawer open on pane A, observe the chat view in pane A during a STATE.md update. Chat state (scroll position, typing, incoming messages) must not reset, flash, or otherwise react to the STATE.md change. If chat visibly re-renders or loses state on STATE.md update, rejection.

5. **Non-regression.** Navigate to the existing ProjectDetailPage (however it's accessed — a button, a URL route). StateViewer still renders STATE.md there as before. TerminalDrawer (Cmd+J) still toggles and shows terminal output. ContextBar still works.

Self-dogfood (free regression guard): in CODER's own Commander session during this rotation, CODER's `STATE.md` (`~/Desktop/Projects/jstudio-commander/STATE.md`) is being updated by PM's STATE.md edits this very session. If the drawer is open on CODER's session, Jose should see PM's updates to STATE.md appear in real-time. That's the cleanest proof available.

Ship NOT claimed green without explicit "awaiting Jose 5-case browser smoke" declaration.

---

## Rejection triggers

(a) Files outside boundary touched.
(b) StateViewer modified (reuse-only).
(c) TerminalDrawer modified (pattern reference, not a refactor target).
(d) ProjectDetailPage broken (non-regression).
(e) Chat renderer re-renders on STATE.md event (subscription firewall broken).
(f) Per-project state added to Commander DB (violates migration brief §6.4).
(g) Ship claimed green without live-smoke gate declaration.
(h) Investigation discipline skipped — if live-smoke reveals unexpected behavior, do NOT speculative-fix. Instrument per `standards/INVESTIGATION_DISCIPLINE.md`.

---

## Post-M7 sequencing

Per Commander CTO's locked sequence: M7 MVP ships green → **Codeman-model architectural phase** fires (resolves Candidates 23 + 32 + 33 jointly, migrates ContextBar derivation from three-server-signal OR-chain to ChatMessage[]-authoritative). That phase gets its own brief and its own name (not "15.3 residuals" per CTO framing note).

M7 full-scope (all 4 canonical files, tabs, project-type badge) deferred indefinitely; migration CTO accepts MVP-STATE as sufficient to close M7.

---

## Standing reminders

This rotation may exercise the new investigation discipline for real if live-updates don't flow. Per `standards/INVESTIGATION_DISCIPLINE.md` and OS §20.LL-L11/L12: if live-smoke reveals unexpected behavior, capture runtime evidence BEFORE proposing a new fix. No fix-forward under uncertainty.

Per `feedback_self_dogfood_applies_to_status_fixes`: CODER's own session running in Commander IS the self-dogfood testbed. Jose can observe your drawer against your own project's STATE.md directly.

Per `feedback_vite_stale_code` + `feedback_dist_shadows_vite`: if HMR misses the new hook/component registration, restart `pnpm dev` fresh.

Per OS §20.LL-L10: unit-green is zero acceptance signal. Jose's 5-case live-smoke is the acceptance.

Go.
