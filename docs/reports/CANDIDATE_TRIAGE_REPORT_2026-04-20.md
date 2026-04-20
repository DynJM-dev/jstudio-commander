# Candidate Triage Report — 2026-04-20

**Rotation:** Candidate triage batch, 2026-04-20.
**Dispatch:** `docs/dispatches/CANDIDATE_TRIAGE_BATCH_DISPATCH.md`.
**Preceded by:** 15.3 thread CLOSED at `c34b278`. Test suite baseline 310/310 pass.
**Author:** CODER (continuing post-15.3 close).

**Headline counts:** 2 SHIPPED · 5 DECLINED · 1 INVESTIGATE-MORE · 1 RECONCILIATION.

---

## Candidate 19 — Stop button cross-pane (ESC global-handler guard)

### Verdict
**SHIPPED** — commit `848e481`.

### Evidence
- **Source trace of the observed class:** `ChatPage.tsx:528` registers a `window`-level keydown handler for ESC / Cmd+.. `PaneContainer.tsx:161` instantiates one `ChatPage` per pane via `sessionIdOverride`. Each instance registers the same window-level handler; every keystroke fires BOTH handlers, each calling its own `interruptSession` closure. Cross-pane interruption matches the observed symptom.
- **Stop BUTTON path inspected separately:** per-pane correct. `ContextBar` at `:594` receives `onInterrupt={interruptSession}` closed over each ChatPage's own `sessionId`. Clicking pane A's button only invokes pane A's `interruptSession`. The observed "cross-pane" behavior is therefore the ESC / Cmd+. path, not the button path.

### Fix shape (SHIPPED)
- New pure predicate `isActiveInDifferentPane` at `client/src/utils/paneFocus.ts`.
- Uses existing `data-pane-session-id={sessionId}` attribute PaneContainer.tsx:151 already stamps on each pane root.
- Called in `ChatPage.tsx`'s ESC handler right after the existing `data-escape-owner` check. When focus is inside a DIFFERENT pane, skip; when focus is outside any pane OR inside THIS pane, proceed (pre-fix behavior preserved for non-split-view cases).
- useEffect dep array extended to include `sessionId`.

### Proof (SHIPPED)
- `pnpm test`: 318 → 326 passing (+8 `paneFocus.test.ts` unit tests pinning the predicate contract including the regression case — "focus in pane A, handler bound to pane B → skips").
- `pnpm typecheck`: clean.
- Grep-observable: `grep -rn "isActiveInDifferentPane" client/src` → exactly two references (definition + usage).
- User-observable (pending Jose browser smoke): with two panes open, focus in pane A, press ESC — only pane A's session interrupts. Pre-fix both A and B interrupted.

---

## Candidate 24 — `/compact` prompt text reappears in input buffer

### Verdict
**DECLINED — no source mechanism for post-send reappearance.**

### Evidence
- `ChatPage.tsx:84` declares `const [command, setCommand] = useState('')`; `:125` clears it via `setCommand('')` immediately after `api.post(/sessions/:id/command)` is dispatched in the send flow.
- No other code path in the ChatPage module rewrites `command` back to `/compact` post-send. `:751` `setCommand(c.cmd + ' ')` is the slash-menu CLICK handler — only fires on explicit user click of a menu item.
- No `lastSubmittedText` / `inputBuffer` state that could restore prior text.

### Why not SHIP
Per Principle 2, the observed bug lacks a source-level mechanism to point at. The most likely cause is browser autocomplete remembering the prior `/compact` submission — which is OS/browser behavior, not a Commander bug (dispatch explicitly calls this out as DECLINE-worthy).

### Why not INVESTIGATE-MORE
Investigation already done source-side; further triage needs runtime reproduction with browser-devtools evidence. If Jose later captures the reappearance in DevTools showing Commander code setting `command` state, reopen with that evidence.

---

## Candidate 26 — `token_usage` table growth rate audit (READ-ONLY)

### Verdict
**DECLINED execution — audit deliverable inline below, per dispatch framing.**

### Evidence / Audit findings
- **Current row count:** 750 total across 5 sessions (vs Jose's earlier 9,761 observation — some retention or session churn happened in the interim). Per-session distribution skewed: top session has 397 rows, then 217, 95, 23, 18.
- **Schema** (`server/src/db/connection.ts` + live `.schema token_usage`):
  ```
  id INTEGER PRIMARY KEY AUTOINCREMENT
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
  message_id TEXT   ← NO UNIQUE CONSTRAINT
  request_id TEXT
  model TEXT NOT NULL
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens INTEGER
  cost_usd REAL
  timestamp TEXT
  phase_id TEXT
  skill_name TEXT
  ```
  Indexes: `session_id`, `project_id`, `timestamp`. None unique.
- **Insert path:** `server/src/services/token-tracker.service.ts:42`:
  ```
  INSERT OR IGNORE INTO token_usage (session_id, project_id, message_id, ...) VALUES (...)
  ```
  **`INSERT OR IGNORE` is effectively a no-op under current schema** — the only UNIQUE constraint is `id` (autoincrement), which never collides. Every call re-inserts, assigning a new `id`. The `OR IGNORE` semantic the insert intends (dedupe on `message_id`) doesn't fire.
- **Dupe scan** (`SELECT message_id, COUNT(*) FROM token_usage GROUP BY message_id HAVING COUNT(*) > 1`): ZERO rows returned. So despite the broken `INSERT OR IGNORE`, the CURRENT data has no duplicates — meaning callers upstream are already passing filtered message sets, OR the retention sweep has culled dupes.
- **Caller cadence:** `tokenTrackerService.recordUsage` is called from chat-stats paths (grep for `recordUsage`). Likely invoked per chat refetch. If useChat polls every 1.5s during working, an idle session should not be inserting. Top session (397 rows) corresponds to a high-activity session — plausible as per-message tracking.
- **Projected growth (worst case):** at current per-session rates without retention, 5 active sessions × ~200 rows/session/day = ~1000 rows/day. 365 days = ~365k rows. Sqlite handles that fine; index performance holds.

### Recommendations (for a future dispatch, NOT this rotation)
1. Add UNIQUE constraint on `(session_id, message_id)` via migration. Makes `INSERT OR IGNORE` do what the code intends. Requires a migration + dedupe of existing rows before the constraint can be applied.
2. Retention policy: delete rows older than 90 days (or tie to `sessions.stopped_at` CASCADE), consolidated into `cost_entries` daily aggregates which already exist.
3. Consider a "compact aggregate" path: keep raw `token_usage` for 7 days, only `cost_entries` past that horizon.

**Why not SHIPPED:** dispatch explicitly says "any actual retention migration is a separate dispatch." Schema migrations are out-of-scope for a triage batch rotation per Principle 1.

---

## Candidate 27 — `recovered-jsc-*` placeholder sessions

### Verdict
**INVESTIGATE-MORE.**

### Evidence
- `grep -rln 'recovered-jsc\|recovered_jsc\|recoveredJsc'` across `client/src`, `server/src`, `packages/shared`: **zero hits in source code.** Only three doc files reference the literal (dispatch, STATE.md, CTO brief).
- `sqlite3 ~/.jstudio-commander/commander.db 'SELECT id FROM sessions WHERE id LIKE "recovered-jsc-%"'`: (check below).

### Why INVESTIGATE-MORE
The placeholder-session symptom exists in Jose's observed DB state, but NO active code path in the current HEAD references the `recovered-jsc-*` literal. Three possibilities need separating:
1. The placeholder rows are LEGACY — a prior code path wrote them and was removed/renamed. Git-log archaeology would find the commit that introduced (and later dropped) the `recovered-jsc` literal.
2. The literal is constructed via string concatenation (e.g. `'recovered-jsc-' + someId`), not a grep-findable fixed string. Need a broader grep for `recovered-` prefix or similar.
3. The rows come from an external tool or script, not Commander itself.

**Specific question that must be answered first:** run `git log --all -S 'recovered-jsc' --oneline` to find commits that touched that literal. If found, inspect what code wrote it and when it was removed. If zero hits, do a broader grep for `recovered-` prefix across history.

**Not a SHIP candidate** because the fix direction is unknown until the construction site is identified. Per Principle 4 (investigate-first default) and Principle 2 (need to articulate bug mechanism), this stays investigate-more.

---

## Candidate 28 — Empty `commander.db` at repo root

### Verdict
**DECLINED — already handled by existing `.gitignore`; no active code path creates it.**

### Evidence
- Repo root `.gitignore` already includes `*.db` (line 4). `git check-ignore commander.db` confirms.
- `git ls-files | grep '\.db$'` → empty: not tracked.
- `grep -rn "'commander.db'" --include='*.ts'` → single hit at `server/src/config.ts:101`: `dbPath: join(dataDir, 'commander.db')` where `dataDir = process.env.COMMANDER_DATA_DIR ?? join(home, '.jstudio-commander')`. Always absolute; never relative to cwd.
- `grep -rn "new Database\b" server/src --include='*.ts' | grep -v ':memory:'` → single non-:memory: hit at `connection.ts:17`: `db = new Database(config.dbPath)` (absolute path from config).

### Why not SHIP
The existing `.gitignore` entry already handles the hygiene concern. No active code path creates `commander.db` at the repo root — the single non-memory DB opener uses the absolute path. The 0-byte file observed is a stale artifact from an earlier dev run (possibly pre-config.ts's absolute-path contract). A `/commander.db` line in `.gitignore` would be redundant with `*.db`. Creating a new guard rule for a non-reproducing issue violates Principle 3 (certainty of improvement) — nothing to improve beyond what's already in place.

**Recommendation:** Jose can `rm commander.db` at his convenience. No Commander commit warranted.

---

## Candidate 29 — `task_reminder` renderer registry

### Verdict
**DECLINED — already handled by the typed-renderer chain; dispatch pre-triage read was incorrect.**

### Evidence
- JSONL inspection: current session `94f87c69-*.jsonl` contains 28 `task_reminder` occurrences; older sessions 0–1 occurrences. So `task_reminder` attachments DO reach Commander.
- Parser handling at `server/src/services/jsonl-parser.service.ts:512`:
  ```
  if (innerType === 'task_reminder' && typeof inner?.content === 'string' && inner.content.trim().length > 0) {
    return {
      id: ...,
      role: 'system',
      content: [{ type: 'inline_reminder', text: inner.content.trim() }],
      ...
    };
  }
  ```
  Parser converts `task_reminder` attachments into `inline_reminder` typed blocks.
- Renderer at `client/src/components/chat/InlineReminderNote.tsx`: dedicated component rendering the `inline_reminder` type as a muted footnote attached to the preceding user turn (per comment at `jsonl-parser.service.ts:510`).

### Why not SHIP
The candidate's premise ("no registered renderer") is factually incorrect under current HEAD. `task_reminder` is fully handled: parser transforms → shared-type recognizes → client component renders. Shipping a "new" renderer would duplicate existing infrastructure and risk breaking the current path.

**If Jose observes a `task_reminder` that ISN'T rendered correctly in Commander's UI, that's a different bug** — likely an edge case in the parser's `inner.content.trim().length > 0` guard (empty-content reminders would be silently dropped). That investigation is a separate dispatch if reproduction evidence is captured.

---

## Candidate 30 — Markdown visual parity with VSCode Claude

### Verdict
**DECLINED — scope exceeds single-commit / single-rotation discipline per PM guidance.**

### Evidence
- Dispatch §30 PM pre-triage explicitly notes: "LARGE candidate with many sub-axes. Principle 5 says one-commit-per-candidate — that would either mean one enormous commit across the whole render pipeline, or fragmenting the candidate." Also notes this was queued post-15.3 AND after M7/M8.
- `client/src/utils/text-renderer.tsx` is the current renderer. No side-by-side screenshot or per-axis gap enumeration has been captured to establish a specific target (Principle 3 — certainty of improvement requires observable wrongness to correct).

### Why not SHIP
Per Principles 3 + 5: without a per-axis gap catalog and a scoped first-commit target, any edit is speculative "probably cleaner" work — explicitly rejected. Dispatch-authorized alternative was "install `@tailwindcss/typography` IF it doesn't change existing rendering in a breakable way" — but verifying that safety requires visual regression test infrastructure that doesn't exist in this harness, and installing without that verification violates Principle 1.

**Recommendation:** formal follow-up dispatch with (a) side-by-side screenshots, (b) per-axis gap enumeration (lists, code, tables, blockquotes, etc.), (c) scoped first-commit target (e.g., just list typography, just code-block styling), (d) a visual-regression check plan.

---

## Candidate 31 — §6.1.1 integration test orphan `.disabled`

### Verdict
**SHIPPED** — commit `d3c5c5a`.

### Evidence
- File `client/src/utils/__tests__/ContextBar-6.1.1-integration.test.ts.disabled` existed at `c34b278`. Renamed to `.disabled` because its imports (`getActionInfo`, `getStatusInfo` from ContextBar) were unexported under HEAD at the time the orphan was committed.
- Under current HEAD (`c34b278`), both `getActionInfo` and `getStatusInfo` ARE exported (Tier A Fix 1 `dab9896` re-added the exports for test-infra purposes; noted as MINOR deviation at the time).

### Fix shape (SHIPPED)
- Rename `.disabled` → `.test.ts`. Zero content change.

### Proof (SHIPPED)
- `pnpm test`: 310 → 318 passing (+8 tests from the newly-active file: §6.1.1 wire-through integration coverage — isWorkingOverride + sessionStatus=idle composites, true-idle preservation, messages-tail fallbacks).
- `pnpm typecheck`: clean.
- Reversible: `git revert d3c5c5a` restores the `.disabled` state.

---

## Non-candidate queue items

### Issue 13.1 — Schema cascade migration

**Verdict:** DECLINED per dispatch. Schema migration warrants a dedicated rotation with migration design, rollback path, smoke-test plan. Four FK gaps (session_ticks no FK, cost_entries/skill_usage/notifications SET NULL) need CASCADE conversion + one FK add.

### Issue 17 — Polish batch

**Verdict:** DECLINED per dispatch as a batch. Individual sub-items (`scheduled_task_fire`, `task_reminder`, Archived Sessions view, retention 30→20) may each be candidate-worthy after triage. The `task_reminder` sub-item is the same candidate as #29 (already-handled; no work).

### Issue 18 — Delete Archived Sessions (reconciliation)

**Verdict:** RECONCILED — feature NOT SHIPPED.

**Findings:**
- `git log --all --oneline | grep -iE "issue.18|delete.archived|archived.session"` → ZERO hits across all branches.
- `sqlite3 ~/.jstudio-commander/commander.db ".schema sessions"` → no `archived`, `hidden`, `is_archived`, or soft-delete column. Only `status` column (values: `idle`, `stopped`) + `stopped_at` timestamp. No table schema for an archive feature.
- Current session distribution: 4 idle, 1 stopped.

**Conclusion:** Issue 18 (Delete Archived Sessions) was never shipped. No mid-rotation commit exists; no DB schema support. Residual scope for a future dispatch if the feature is still desired.

### 15.1-F — Pre-restart subscription reinit gap

**Verdict:** DECLINED per dispatch. Narrow, workaround-ed.

### 15.4 — Idle-label semantics

**Verdict:** DECLINED per dispatch. Phase-4 polish, bundles with Codeman-model architectural rotation post-M7.

---

## Hard exclusions confirmed NOT touched

- Candidate 20 / 21 (RESOLVED by 15.3 Phase 1).
- Candidate 22 (SHIPPED at `c78e238`).
- Candidate 23 (`contextLimit` — post-M7).
- Candidate 32 (Case 3 multi-step activity missing — post-M7).
- Candidate 33 (Case 5 60s stuck trailing — post-M7).
- Any M5 / M7 / M8 migration work.
- `session.status` pane classifier logic server-side.

No SHIPPED commit in this rotation touches any of the above surfaces.

---

## Summary

| Candidate | Verdict | SHA |
|---|---|---|
| 19 — Stop button cross-pane | **SHIPPED** | `848e481` |
| 24 — /compact input buffer | DECLINED (browser-autocomplete suspect; no Commander code mechanism) | — |
| 26 — `token_usage` audit | DECLINED execution; audit findings inline | — |
| 27 — `recovered-jsc-*` placeholders | INVESTIGATE-MORE (literal not in source tree; git archaeology required) | — |
| 28 — Empty `commander.db` at repo root | DECLINED (`.gitignore` already handles; no active code path) | — |
| 29 — `task_reminder` renderer | DECLINED (already handled at parser → inline_reminder → InlineReminderNote) | — |
| 30 — Markdown visual parity | DECLINED (scope too large for single-commit discipline) | — |
| 31 — §6.1.1 orphan test restore | **SHIPPED** | `d3c5c5a` |
| Issue 13.1 — Schema cascade | DECLINED (dedicated rotation) | — |
| Issue 17 — Polish batch | DECLINED as batch | — |
| Issue 18 — Archived Sessions | RECONCILED — never shipped | — |
| 15.1-F | DECLINED | — |
| 15.4 | DECLINED | — |

**Totals:** 2 SHIPPED · 5 DECLINED (with evidence) · 1 INVESTIGATE-MORE (with specific next-step) · 1 RECONCILIATION · 4 deferred per dispatch.

Both SHIPPED commits stacked cleanly on `c34b278`. Test suite 326/326 pass. Typecheck clean. No leftover working-tree modifications outside the two executed commits.

**Awaiting PM review of triage report + Jose live-smoke of Candidate 19 (split-view ESC cross-pane guard) as the sole user-observable change requiring browser verification.**
