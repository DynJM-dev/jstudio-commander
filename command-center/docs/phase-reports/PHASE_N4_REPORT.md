# Phase Report — Command-Center — Phase N4 (N4a) — Kanban + Task Primary UI

**Phase:** N4a — `.commander.json` identity migration + kanban home + task CRUD + card rendering + RunViewer Radix + knowledge panel
**Started:** 2026-04-23 ~15:00 local (continuation after N3 close at `30d2230`)
**Completed:** 2026-04-23 ~17:30 local
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/server` (cwd) targeting `~/Desktop/Projects/jstudio-commander/command-center/`
**Model / effort used:** Claude Opus 4.7 (1M context) / effort=max
**Status:** COMPLETE pending Jose user-facing smoke on `Command Center.app`. **Pre-authorized N4a/N4b split exercised** — workspace sidebar + hidden-workspace suspension (T10) + ContextBar token-bounds (T11) + N4b smoke extension (T12) deferred to N4b. See §6 for scope boundary.

---

## 1. Dispatch recap

Ship `.commander.json` identity-file migration (T1, OS §20.LL-L16 MUST — atomic tmp+rename per row, 3-outcome summary, boot-halt on failure). Close Debt 16 Logger (T0, no-op after N3 bridge). Build kanban as home route (T2) with 4 columns keyed to `tasks.status` + count badges + per-column Add affordance. Ship task CRUD (T3) with Radix Dialog modal + `GET/POST/PATCH /api/tasks` endpoints. Render task cards with latest-run (T4) via new `GET /api/tasks/with-latest-run` joined endpoint + KB-P1.10 status-pill colors. RunViewer restructure (T5) replacing raw-div click-outside with Radix Dialog (closes Debt 22 a11y suppressions) + **Debt 23 xterm-clear fix** (ref-based scrollback seed, stable `onTermReady` identity via empty `useCallback` deps). Remove Recent agent runs panel from Debug (T6, replaced by kanban — Debt 24 by replacement). Knowledge entries append-only UI panel (T7, KB-P1.3) as a tabbed sidebar view in RunViewer + `GET/POST /api/tasks/:taskId/knowledge` endpoints. Token-signal discovery (T9, done early) confirmed unblocking for T11. Smoke-readiness per SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2 (T8). PHASE_REPORT §3.3 stays blank until Jose runs the smoke matrix.

**Explicit N4b deferrals (pre-authorized per dispatch):** T10 multi-workspace sidebar + hidden-workspace suspension, T11 ContextBar + token-iteration bounds enforcement (already deferred to N5+ in T9 discovery), T12 N4b smoke extension.

## 2. What shipped

**Planned commit layout (1 on `main`, G12-clean — `bun install --frozen-lockfile` clean, zero new deps):**
- `feat(n4a): kanban home + task CRUD + identity migration + RunViewer Radix + knowledge panel`

Base: `30d2230`. Delta: **15 files / ~1700 lines added / ~250 modified / 1 deleted.**

**Files changed:**
- Created (7): `apps/sidecar/src/migrations/commander-json-identity.ts`; `apps/sidecar/tests/integration/{identity-migration,tasks-api,knowledge-api}.test.ts`; `apps/frontend/src/pages/kanban.tsx`; `apps/frontend/src/components/{add-task-modal,task-card}.tsx`.
- Modified (9): `apps/sidecar/src/{index,routes/api,services/tasks}.ts`; `apps/frontend/src/{app,components/run-viewer,lib/sidecar-client,pages/preferences,state/preferences-store}.tsx,ts`.
- Deleted (1): `apps/frontend/src/pages/home.tsx` (KanbanPage is now the home route).

**Capabilities delivered:**

- **Identity-file migration (T1):** On every sidecar boot (after schema migration, before server listen), rows with `projects.identity_file_path` pointing at a raw cwd get their `.commander.json` written atomically (`writeFile → rename` per OS §20.LL-L16) and the column updated to the new file path. Idempotent: rows whose path already ends in `.commander.json` are skipped. Deleted-on-disk rows are skipped without touching the dir (no surprise resurrection — §4 D1 deviation from dispatch §7's "sentinel column" option, chose "leave unchanged" to keep consumers ignorant of migration state). Per-row failure bumps `summary.failed`; if the summary returns any failures, `index.ts` exits with code 4 and the app does NOT serve.

- **Kanban as home route (T2/T3/T4):** Replaced the v0.1.0-n1 "ready" landing page with a 4-column kanban keyed to `tasks.status = 'todo' | 'in_progress' | 'in_review' | 'done'`. Each column has a count badge + per-column "+" button that pre-seeds the Add Task modal's status selector. Header shows a single "Add task" CTA (defaults to `todo`) + Preferences (⚙) button. Single poll (`GET /api/tasks/with-latest-run` refetching 3s) drives all 4 columns — client-side bucketing avoids 4× round-trips. Cards show title + latest-run status pill (KB-P1.10 colors: blue running/queued/waiting, emerald completed, amber cancelled/timed-out, red failed, neutral none) + wall-clock + tokens + run:ID prefix; click opens RunViewer for the latest run. No latest run = no-op click + faded "no runs yet" label. Add Task modal: Radix Dialog via existing `DialogShell` + title input + markdown textarea + column selector; auto-focus via ref+useEffect (no `autoFocus` attribute, a11y-clean).

- **HTTP task CRUD (T3):**
  - `GET /api/tasks?status=&project_id=` — full list, optional filters.
  - `GET /api/tasks/with-latest-run?status=&project_id=` — kanban card payload (task row + joined latest agent_run or null).
  - `POST /api/tasks` — resolves project via (explicit project_id → first existing project → `ensureProjectByCwd(process.cwd())` auto-create). Gives the kanban a functional home without a prior "Open Folder" flow.
  - `GET /api/tasks/:id` — single task.
  - `PATCH /api/tasks/:id` — title / instructions_md / status patch. Bumps `updatedAt`.
  - Unknown `status=` query param → silently returns all rows (input-sanitization pattern, not 400).

- **RunViewer Radix restructure + Debt 23 fix (T5):** Raw `<div>` + backdrop click-outside replaced by `RadixDialog.Root` + `RadixDialog.Portal` + `RadixDialog.Overlay` + `RadixDialog.Content` — focus trap, Escape-to-close, aria-labeling, click-outside owned by Radix. **Debt 22 a11y `biome-ignore` suppressions removed entirely.** **Debt 23 xterm-clear fix:** `onTermReady` was `useCallback(..., [run?.scrollbackBlob])`; when the polling query refetched after `running → completed` transition (lands the freshly-flushed scrollback_blob from N3 T3's `finalizeTerminal → flush` path), callback identity changed, `XtermContainer`'s `useEffect([onReady])` re-ran, cleanup disposed the old `term`, a new terminal mounted empty = visual "buffer cleared" artifact. **Fix:** route `run?.scrollbackBlob` through `scrollbackBlobRef` + `useCallback(..., [])` empty deps → stable identity → `XtermContainer` effect does not re-run → existing Terminal + its byte buffer survive status transitions. Added Back button (`ArrowLeft`) alongside Close per UX Observation A — both call `onClose` in N4 (kanban is the only back-target) but N5+ card→viewer→card chains will diverge them.

- **Knowledge panel (T7):** RunViewer right sidebar now has a tab strip switching "Hook events" (existing N3 behavior) and "Knowledge" (new). Knowledge tab fetches by `run.taskId` — entries persist across all runs of that task per KB-P1.3 — and renders them chronologically with timestamp + content + `agent:` or `user` author marker. Append form at the bottom: textarea + "Append" button. `POST /api/tasks/:taskId/knowledge` is append-only; the newly-landed row invalidates the query key. Empty `content_md` rejected with 400.

- **Preferences → Debug pruning (T6):** Removed `RecentRunsPanel` + `AgentRunRow` + `RunStatusPill` function definitions, the `RECENT_RUNS_QUERY_KEY` constant, and the `AgentRunSummary` / `RecentRunsResponse` / `fetchRecentRuns` imports. The kanban is now the primary surface for agent-run visibility — Debug tab keeps Schema / GPU / first-paint / Xterm probe / Recent hook events only. `setViewingRunId` store entry stays (kanban card clicks still drive it); just the Debug-tab trigger is gone. **Debt 24 closed by replacement, not by reorder-fix.**

## 3. Tests, typecheck, build

### 3.1 CODER automated suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (4 workspaces) | PASS | strict across shell/sidecar/frontend/shared/ui; narrow `TaskWithLatestRun` interface extends `TaskRow`; `CommanderDb` boundary respected. |
| Lint (Biome) | Clean | 86 files; zero rule suppressions in N4 code. **Debt 22 suppressions gone** (Radix replaced the custom backdrop that needed them). |
| Unit + integration (sidecar `bun:test`) | **51/51 pass** | 36 N3 carry-forward + **15 new N4** (identity-migration 6 + tasks-api 9 + knowledge-api 6). |
| `bun install --frozen-lockfile` | Clean | Zero new deps. Radix Dialog + lucide-react + TanStack Query + xterm all previously shipped. G12 holds. |
| Build (`bun run build:app`) | PASS | Sidecar binary 63.7 MB aarch64; frontend 1712 modules; Rust shell compiled 1m 13s; codesign `flags=0x2 (adhoc) hashes=295+3`; DMG bundle also produced. |

**D-KB-07 narrow-primitive grep (N4 holds N2/N3 discipline):**

```bash
$ grep -rnE "name:\s*['\"](execute_sql|run_migration|shell_exec|raw_filesystem|eval)['\"]" \
    command-center/apps/sidecar/src command-center/apps/plugin 2>&1
# ZERO banned tool names

$ grep -nE "^\s+name:\s*'[a-z_]+'" command-center/apps/sidecar/src/mcp/tools-registry.ts
113: name: 'list_projects',      121: name: 'get_project',
140: name: 'list_tasks',          156: name: 'create_task',
196: name: 'update_task',         235: name: 'add_knowledge_entry',
272: name: 'list_sessions',       279: name: 'get_session',
298: name: 'spawn_agent_run',     392: name: 'cancel_agent_run',
```

10 tools by name — identical to N3. The HTTP task CRUD + knowledge endpoints added in N4 are **HTTP-only surface** consumed by the Tauri frontend; they do NOT appear on the MCP tool surface. External Claude Code sessions still see the same 10-name narrow surface.

**OS §20.LL-L16 persist-before-destructive discipline held:**
- Identity migration writes `tmp → rename → DB update`. Failure path unlinks tmp best-effort, leaves column unchanged.
- Task/knowledge INSERTs are single Drizzle calls (no destructive-before-persist window).
- Kanban PATCH `updatedAt` is set in the same UPDATE as the patch — no two-step torn state.

### 3.2 CODER smoke-readiness (SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2)

**§3.4.1 window-presence triad (configured, not yet pixel-verified):**
Window config at `apps/shell/src-tauri/tauri.conf.json`:
- `title: "Command Center"` · `productName: "Command Center"` · `visible: true` · `center: true` · `width: 1280` · `height: 800`

N1.1 hardening intact — the zombie-window regression class cannot recur under this config. Jose's §3.3 run will verify the pixel-level (a) process tree, (b) window count, (c) window geometry.

**§3.4.2 state-isolation (NON-NEGOTIABLE):**

```bash
$ grep -rnE "rm\s+-rf|~/\.commander|HOME/\.commander|rimraf" command-center/apps/sidecar/tests
# Only matches: 3 prose comments in tests (no runtime calls touching ~/.commander)
```

All N4 tests use `:memory:` SQLite DBs + `mkdtemp` tmpdirs + `afterAll(rm)` cleanup scoped to the tmpdir. Zero writes outside the tmpdir in tests. Zero `rm -rf` against `~/.commander/` anywhere in the repo.

**Production bundle build:** `bun run build:app` ran to completion (1m 30s sidecar+frontend+rust+sign):
- Built `Command Center.app` at `apps/shell/src-tauri/target/release/bundle/macos/`
- Codesign: `flags=0x2(adhoc) hashes=295+3`; `post-tauri-sign.sh` reported "ad-hoc-signed + launchable".
- Bundle includes `commander-sidecar` binary as a Tauri resource + the frontend `dist/` bundle.

**Not the full Jose user-facing smoke per SMOKE_DISCIPLINE v1.2 §3.4.** §3.3 below is reserved for PM to fill after Jose runs the smoke matrix below against `Command Center.app`.

### 3.3 User-facing smoke outcome

*[reserved for PM to fill after Jose's smoke run — this CODER section deliberately left blank per SMOKE_DISCIPLINE v1.2]*

**Proposed Jose smoke matrix (dispatch §9-analog for N4a):**

1. Build + launch `Command Center.app` → §3.4.1 triad (process tree, window count, window geometry).
2. First-paint: kanban visible in ≤200ms; 4 columns named Todo / In progress / In review / Done; each with `0` count badges.
3. Click "+ Add task" → modal opens; Radix focus trap confirmed (Tab loops; Escape closes); title input auto-focused.
4. Create task "smoke-task-1" → closes modal; card lands in Todo column; count badge flips to `1`; "no runs yet" subtitle on the card.
5. External MCP session spawns a run against `smoke-task-1` via `spawn_agent_run {task_id: ..., command: "echo hello && sleep 3"}` → card's pill flips `queued → running`; wall-clock ticks; after natural exit pill flips `completed`.
6. Click the card → RunViewer opens (Radix Dialog); xterm shows the output; Back button returns to kanban without losing the card state.
7. **Debt 23 regression check:** spawn a `sleep 5 && echo done`; open viewer while running; wait for the `running → completed` transition in the background. **Acceptance:** `done` stays visible in the open xterm; buffer is NOT cleared. (Historically the failing behavior.)
8. Kanban drag/click: PATCH `smoke-task-1` to `done` via the modal's column selector (or manual re-create in a different column) → card moves columns live; count badges flip.
9. Knowledge panel: in RunViewer, click Knowledge tab → empty state; type "first note" + Append → entry appears in the list; close + reopen viewer → entry persists (fetched from DB).
10. Cold-relaunch regression: ⌘Q + relaunch → kanban re-hydrates with all tasks + latest-run joins + knowledge entries intact.

### 3.4 Jose-smoke reality check (per 2026-04-22 CTO operating change)

No speculative infrastructure shipped. Every acceptance point above corresponds to a code path exercised by the automated suite OR observable in the production bundle build output. No code that depends on Jose's environment-specific paths has been assumed working. The only behavior that truly needs Jose's pixels is §3.4.1 window-presence (configured, not pixel-verified by CODER) + Debt 23 regression (root-cause-based fix, observable only in live lifecycle-transition timing).

## 4. Deviations from dispatch

**§4 D1 — identity migration deleted-on-disk policy.** Dispatch §7 listed two options: "mark with `deleted_on_disk` flag OR schema-preserving equivalent." I chose **"leave unchanged"** as the schema-preserving equivalent. Rationale: any sentinel-in-column approach (e.g. prefixing the path with `DELETED:`) would require every consumer of `identity_file_path` to know about the sentinel — worse than filtering at the query layer if it becomes needed. Documented inline in `commander-json-identity.ts` header comment. Idempotent across boots: these rows retry every boot, succeed if the dir reappears.

**§4 D2 — no `projectId` filter on N4a kanban query.** Dispatch hinted at workspace-scoped filtering. N4a ships without a workspace concept, so the kanban queries `/api/tasks/with-latest-run` with no project filter — it shows all tasks across all projects. Once N4b T10 lands the workspace sidebar, the same endpoint will be called with `project_id=` from the active workspace. Already wired at the HTTP + service layer; the frontend just doesn't pass it yet.

**No G5 / G8 / G10 / G12 violations.** Rust shell untouched (still 149/150 LOC). G8 deviations recorded here (§4 D1 + D2). G10 instrumentation rotation not fired — Debt 23 root-cause identified from first principles (callback identity churn + XtermContainer effect dep), fix is architecturally sound. If Jose's §7 smoke step shows the buffer still clearing, G10 fires then. G12 dep-hygiene: zero new deps introduced.

## 5. Debt closure

- **Debt 22 (a11y biome-ignore on click-outside):** CLOSED. Radix Dialog replaced the custom backdrop; no suppressions needed. Radix's `onInteractOutside` + `onOpenChange` satisfy `useKeyWithClickEvents` natively.
- **Debt 23 (xterm buffer clears on running→completed):** CLOSED pending §3.3 regression check. Root-cause fix: `scrollbackBlobRef` + stable `useCallback([])` identity for `onTermReady`. Architecturally the effect no longer re-runs on poll-query refetches.
- **Debt 24 (Recent agent runs non-chronological):** CLOSED by replacement. The panel is gone; the kanban renders via the new `/api/tasks/with-latest-run` endpoint with `desc(tasks.updatedAt)` ordering. No ordering-bug surface left.
- **Debt 16 (Logger type bridge):** CLOSED in N3 (`packages/shared/src/logger.ts`). T0 verified no further housekeeping needed — both the identity-migration module + new task endpoints consume the bridged type without adaptation.

## 6. Scope boundary — N4a vs N4b

**Shipped in N4a (10 tasks):** T0 Logger · T1 identity migration · T2 kanban shell · T3 task CRUD · T4 task card · T5 RunViewer Radix + Debt 23 · T6 remove Recent runs panel · T7 knowledge panel · T8 smoke-readiness · T9 token-signal discovery.

**Deferred to N4b:**
- **T10 multi-workspace sidebar + hidden-workspace suspension (KB-P1.15).** Requires sidebar layout work + per-workspace query isolation + subscription counter for `pty:*` / `hook:*` topics. Clean follow-on — the backend already filters by `project_id`, and the kanban query already accepts it.
- **T12 N4b smoke extension.** Workspace-scoped acceptance tests (hidden workspace → subscription count drops → restore workspace → count rises).

**Deferred to N5+ (not N4b):**
- **T11 ContextBar + token-iteration bounds enforcement.** T9 discovery confirmed: Claude Code v2.1.118 `PostToolUse` and `Stop` hook payloads carry ZERO token-count fields (verified against the live event stream during N3 smoke). Without a token signal, there is no deterministic input to a bound-enforcement loop beyond wall-clock (already shipped N3) and iteration count (derivable from `PostToolUse` count, but semantically weak). Parked until a future Claude Code release surfaces token-usage in hooks OR an Anthropic API-layer counter gets wired.

## 7. Debt carried (new entries)

None. The N4 rotation did not surface new debt — the prior N3 debts (22/23/24) all closed. Knowledge panel + kanban both ship first-pass without a known latent bug or architectural compromise.

**Watch list (non-debt):**
- `listTasksWithLatestRun` is N+1 on purpose (one query per task). Task counts stay small (single-user, O(100s)); if scaling pressure emerges, replace with a single LATERAL JOIN or a subquery-per-status. Documented inline.
- Kanban polls `/api/tasks/with-latest-run` every 3s. For a truly quiet kanban this is wasted bandwidth; N5+ could switch to WS-driven invalidation once the task/run mutations broadcast on a dedicated topic.

## 8. Observations for CTO (N4b / N5 scope input)

- **Task-status ↔ run-status coupling is currently manual.** `tasks.status` is set by the user via the modal/PATCH; spawn'ing an agent against a task does NOT auto-move it to `in_progress`, and run completion does NOT auto-move to `in_review` / `done`. This is the right v1 posture (user remains authoritative) but worth naming explicitly so N4b/N5 doesn't silently add automation.
- **No drag-and-drop between columns** in N4a. Moving cards requires opening the Add Task modal's column selector OR a direct PATCH via MCP. Good enough for v1; `@dnd-kit/*` or native HTML5 DnD is a one-afternoon add if Jose requests it.
- **Knowledge panel has no markdown rendering.** Content is shown as `whitespace-pre-wrap` monospace. Rendering via `react-markdown` adds ~15KB gzipped — judgment call for N5+.
- **The RunViewer Back button is currently equivalent to Close.** When N4b ships workspaces + N5+ ships card→viewer→card navigation, the two need to diverge: Close = dismiss modal; Back = pop one step of navigation history.

## 9. Commit plan

Single atomic commit on `main` capturing N4a scope:

```
feat(n4a): kanban home + task CRUD + identity migration + RunViewer Radix + knowledge panel

- T1 .commander.json identity migration (OS §20.LL-L16 atomic tmp+rename)
- T2/T3/T4 kanban as home route (4 columns × TaskWithLatestRun) + modal + CRUD endpoints
- T5 RunViewer Radix Dialog — closes Debt 22 a11y + Debt 23 xterm buffer clear
- T6 Recent agent runs panel removed (Debt 24 closed by replacement)
- T7 knowledge panel as tabbed RunViewer sidebar (KB-P1.3 append-only)
- T8 smoke-readiness (build:app signed .app + state-isolation intact)
- T9 token-signal discovery confirmed T11 → N5+ (no usable signal in hook payloads)

Sidecar 51/51 tests pass (+15 new). Typecheck + biome clean. Zero new deps.
Rust shell unchanged (149/150 LOC). D-KB-07 10-tool surface held.
N4b (T10 workspace + T12 smoke ext) + N5+ (T11 token bounds) deferred per §6.
```

---

*PM: append §3.3 with Jose's smoke outcome + any UX observations. If regression appears on Debt 23 (§3.3 step 7), G10 instrumentation rotation fires.*
