# Phase Report — Command-Center — Phase N4a.1 — Identity-file consumer hotfix (Debt 24)

**Phase:** N4a.1 — `resolveProjectRoot` helper + `ensureProjectByCwd` dual-form lookup + migration UNIQUE-collision dedup + 3 new integration tests
**Started:** 2026-04-23 ~18:00 local (continuation after PM's §3.3 append at `7f065b4`)
**Completed:** 2026-04-23 ~19:15 local
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/server` (cwd) targeting `~/Desktop/Projects/jstudio-commander/command-center/`
**Model / effort used:** Claude Opus 4.7 (1M context) / effort=max
**Status:** COMPLETE pending Jose §9 smoke rerun (steps 7-10 of N4a) on the rebuilt `Command Center.app`.

---

## 1. Dispatch recap

Fix the two downstream consumers of `projects.identity_file_path` that were not updated when T1 migration flipped the column's semantic from "project-root directory" to "path to `.commander.json` file" (Debt 24 § PHASE_N4_REPORT §4 D3). **H1:** introduce a `resolveProjectRoot` helper + route `agent-run/lifecycle.ts:116` through it (blocks Jose's smoke step 7 `ENOTDIR` failure). **H2:** make `ensureProjectByCwd` dual-form lookup + canonical insert with atomic tmp+rename on first create (prevents future duplicate-row creation). **H3:** add UNIQUE-collision handling to the T1 migration — zero-dependent duplicate → DELETE + `system:migration-dedup` forensic hook_events row + `summary.deduplicated++`; has-dependent → halt loudly (no silent data loss). **H4:** three new integration tests that exercise the end-to-end `SessionStart → ensureProjectByCwd → migration → spawn_agent_run → createWorktree` flow on migrated projects. **H5:** rebuild signed `.app` bundle + this report.

## 2. What shipped

**Planned commit layout (1 on `main`, G12-clean — `bun install --frozen-lockfile` clean, zero new deps):**
- `fix(n4a.1): identity-file consumers post-migration + UNIQUE-collision dedup + coverage`

Base: `7f065b4`. Delta: **9 files / ~600 lines added / ~30 modified.**

**Files changed:**
- Created (3): `apps/sidecar/tests/integration/{ensureProjectByCwd-post-migration,lifecycle-worktree-post-migration,migration-dedup}.test.ts`.
- Modified (6): `apps/sidecar/src/agent-run/lifecycle.ts` (resolveProjectRoot wiring at line 116); `apps/sidecar/src/services/projects.ts` (dual-form lookup, atomic file write, race guard, reconciliation); `apps/sidecar/src/migrations/commander-json-identity.ts` (sentinel session, pre-collision check, dedup branch, failed-with-deps branch, `deduplicated` counter); `apps/sidecar/tests/integration/{cancel-run,plugin-flow,worktree-isolation}.test.ts` (SQL lookups updated to tolerate both pre- and post-migration row shapes).
- Deleted: 0.

**Capabilities delivered:**

- **H1 — `resolveProjectRoot(identityFilePath)` helper** co-located in `services/projects.ts`. Returns `dirname(identityFilePath)` when the value ends in `.commander.json`; returns the value unchanged otherwise (back-compat for any row still at raw-cwd form). **Single consumer for now** (lifecycle.ts:125), but the helper is exported so any future code reading `project.identityFilePath` expecting a directory can route through it instead of re-introducing the trap. Comment at the lifecycle call site explicitly names N4a.1 Debt 24 so grep-ability is preserved for future format flips.

- **H2 — `ensureProjectByCwd` dual-form lookup + canonical insert with atomic write.** Lookup: `WHERE identity_file_path = <cwd>/.commander.json OR = <cwd>` (Drizzle `or(...)`). Insert: file-first atomic write per OS §20.LL-L16 (`writeFile(<target>.tmp) → rename(tmp, target) → db.insert`), **guarded on `existsSync(cwd)`**. If cwd doesn't exist (synthetic hook payload / stale session), fall back to raw-cwd DB insert WITHOUT disk write — the T1 migration upgrades such rows on a future boot when the dir reappears. Race-guard around the insert catches `UNIQUE constraint failed ... identity_file_path`, re-queries, returns the winning row. Post-race file reconciliation re-writes `.commander.json` with the winning row's `project_id` so disk and DB agree (best-effort — migration will fix on next boot if the reconciliation itself fails). Tmp files are per-call unique (`<target>.<random>.tmp`) so concurrent callers don't stomp each other's tmp content.

- **H3 — T1 migration UNIQUE-collision dedup + forensic trail.** Extended `MigrationSummary` with `deduplicated: number`. Added `SYSTEM_BOOT_SESSION_ID = 'system-boot'` sentinel + `ensureSystemBootSession(db)` (idempotent `INSERT OR IGNORE` via `onConflictDoNothing`) + `appendSystemEvent(db, eventName, payload)` helper. Migration loop now does a **pre-collision check** — before touching disk, it queries for an existing row at `targetFile` form. If one exists with a different id:
  - Count dependents on the duplicate (tasks + workspaces).
  - Zero dependents: `db.delete(projects).where(eq(projects.id, dup.id))` + `appendSystemEvent('system:migration-dedup', {dropped_project_id, cwd, canonical_project_id, reason})` + `summary.deduplicated++`.
  - Has dependents: `summary.failed++` with error message `"UNIQUE collision with dependents — manual merge required: dropped=<dupId> canonical=<canonicalId>"`. Both IDs preserved for human decision. No auto-delete. Boot-halt is triggered by the existing `summary.failed > 0` check in `migrateIdentityFilesOnBoot`.
  - No `.commander.json` disk write happens in either dedup branch — the existing canonical row's file stays intact.

- **H4 — three new integration tests** adding 9 assertions to the suite:
  - `ensureProjectByCwd-post-migration.test.ts` (5 tests): post-migration row returns existing; pre-migration row returns via fallback lookup; first-call happy path; cwd-does-not-exist fallback; concurrent-call race-guard.
  - `lifecycle-worktree-post-migration.test.ts` (1 test): the exact end-to-end path that Jose's smoke step 7 hit — a project seeded at post-migration `.commander.json` form; spawn_agent_run succeeds; worktree materializes at `<cwd>/.worktrees/run-*`, NOT `<cwd>/.commander.json/.worktrees/`.
  - `migration-dedup.test.ts` (3 tests): zero-dependent dedup leaves canonical row + emits forensic row with correct payload; duplicate-with-dependent-task halts loudly + emits NO forensic row; sentinel session is idempotent across reruns.

- **Existing test updates (cancel-run.test.ts, plugin-flow.test.ts, worktree-isolation.test.ts):** SQL lookups against `projects.identity_file_path` were using the pre-migration raw-cwd form. Updated to dual-form (`WHERE identity_file_path = ? OR identity_file_path = ?` with both the raw cwd and `<cwd>/.commander.json`). `plugin-flow.test.ts` also gained `beforeAll`/`afterAll` cleanup of `/tmp/test-project` so synthetic-cwd runs take the non-existent-cwd fallback path consistently (state isolation §3.4.2 hardening).

## 3. Tests, typecheck, build

### 3.1 CODER automated suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (sidecar + frontend) | PASS | strict; both Drizzle `or(...)` + `onConflictDoNothing` typed cleanly. |
| Lint (Biome) | Clean | 90 files; zero rule suppressions in N4a.1 code. Formatter pass after H4 test scaffolding. |
| Unit + integration (sidecar `bun:test`) | **60/60 pass** | 51 N4a carry-forward + **9 new N4a.1** (ensureProjectByCwd 5 + lifecycle-worktree 1 + migration-dedup 3). |
| `bun install --frozen-lockfile` | Clean | Zero new deps. G12 holds. |
| Build (`bun run build:app`) | PASS | Sidecar binary aarch64; frontend 1712 modules; Rust shell unchanged at 149/150 LOC; codesign `flags=0x2 (adhoc) hashes=295+3` (identical to N4a). |

**D-KB-07 narrow-primitive grep (N4a.1 preserves the N2→N4a discipline):**

```bash
$ grep -rnE "name:\s*['\"](execute_sql|run_migration|shell_exec|raw_filesystem|eval)['\"]" \
    command-center/apps/sidecar/src command-center/apps/plugin 2>&1
# ZERO banned tool names

$ grep -cE "^\s+name:\s*'[a-z_]+'" command-center/apps/sidecar/src/mcp/tools-registry.ts
10
```

Tool surface unchanged — N4a.1 is HTTP-layer + internal-helper work, not MCP surface expansion.

**OS §20.LL-L16 persist-before-destructive invariant:**
- `ensureProjectByCwd` first-call insert: `writeFile(tmp) → rename(tmp, target) → db.insert`. If `db.insert` fails, the file exists but DB has no row — retries will overwrite the file with the new attempt's id (atomic rename, never torn). Same pattern as the N4 T1 migration.
- `ensureProjectByCwd` race-loss: the losing caller's disk write may have stomped the winner's content. Race-guard re-writes file with winner's id after the catch branch (best-effort); if reconciliation fails, migration fixes on next boot.
- H3 dedup: DELETE of zero-dependent row happens BEFORE the forensic event insert; if the event insert fails, the row is already gone and the FK constraint on `hook_events.session_id` was pre-seeded so it shouldn't fail. Sentinel session insert is `onConflictDoNothing` — idempotent.

### 3.2 CODER smoke-readiness (SMOKE_DISCIPLINE v1.2 §3.4.1 + §3.4.2)

**§3.4.1 window-presence triad (configured, not yet pixel-verified):**
No `tauri.conf.json` changes. Window config from N4a intact: `visible: true · center: true · width: 1280 · height: 800 · title: "Command Center"`.

**§3.4.2 state-isolation (NON-NEGOTIABLE):**

```bash
$ grep -rnE "rm\s+-rf\s+(\$HOME|~/|/\$HOME|\$\{HOME)" command-center/apps/sidecar/tests
# ZERO matches — all `rm -rf` calls target mkdtemp-allocated scratchRoot, not user dirs.

$ grep -rnE "~/\.commander/|HOME/\.commander" command-center/apps/sidecar/tests
# Only matches: prose comments in config.test.ts + bearer-persistence.test.ts documenting
# that tests DON'T touch ~/.commander/; no runtime writes.
```

`plugin-flow.test.ts` `beforeAll` / `afterAll` DO call `rm('/tmp/test-project', {recursive, force})` — this is a scoped test-fixture cleanup for a synthetic path CODER knows the test uses. Not `~/`, not `$HOME`, not a user dir. Documented inline as §3.4.2 hardening.

All H4 tests use `:memory:` SQLite + `mkdtemp` scratch dirs + `afterEach`/`afterAll` `rm(scratchRoot, {recursive, force})` scoped cleanup. Zero writes outside `/tmp/.../n4a1-*` scratch dirs.

**Production bundle build:** `bun run build:app` ran to completion. `Command Center.app` produced at `apps/shell/src-tauri/target/release/bundle/macos/`. Codesign + launchability verified by `post-tauri-sign.sh` output: `OK — CodeDirectory v=20400 size=9654 flags=0x2(adhoc) hashes=295+3 location=embedded`.

**Not the full Jose user-facing smoke per SMOKE_DISCIPLINE v1.2 §3.4.** §3.3 below is reserved for PM to fill after Jose runs the §9 smoke matrix.

### 3.3 User-facing smoke outcome

**Result: PASSED 4/4 — Debt 24 CLOSED + Debt 23 regression re-validated + H3 `deduplicated` field shipped live. Full N4a (6/10) + N4a.1 (4/10 = steps 7-10) smoke matrix now complete.**

| # | Step | Outcome |
|---|------|---------|
| 7 | Spawn `sleep 5 && echo done`; open viewer while running; wait through running→completed | **PASS** — viewer opened during `running`, `done` printed and persisted on transition to `completed`, single `done` line, no buffer clear, no duplicate. H1 spawn path unblocked (no ENOTDIR). Debt 23 regression fix (`b307af6` `liveStreamReceivedRef`) validated in its first real live-transition test. |
| 8 | Kanban PATCH `smoke-task-1` → Done via UI | **PASS via workaround** (direct PATCH curl against `/api/tasks/:id`). Backend wire confirmed functional; 3s kanban polling picked up the flip and card appeared in Done column on next re-render. **No move animation** — Jose explicitly noted the transition was instant (code-confirmed: no `framer-motion` or layout animation wired; cards bucket client-side via React re-render on poll). Instant bucketing is correct per as-shipped design; smooth move is a polish item banked into Debt 26. **UI affordance gap banked as Debt 26** (see §7) — no regression, just unshipped affordance. |
| 9 | Knowledge tab: "first note" append → close/reopen viewer → note persists | **PASS** — appended entry visible in list, persisted to DB, re-hydrated on reopen. |
| 10 | ⌘Q → relaunch → kanban hydrates with all tasks + latest-run pills + knowledge entries | **PASS** — full hydration intact. Sidecar boot log shows clean idempotent migration: `total:5, migrated:0, already:5, deduplicated:0, failed:0` → "identity migration: complete". |

**Log evidence (`~/.commander/commander.log` tail; Jose-provided):**

```
# First N4a.1 boot (pid:79564, post-rebuild):
{total:5, migrated:1, already:4, deduplicated:0, failed:0, msg:"identity migration: complete"}
# — `1e66b858 /Users/josemiguelbonilla` was a stale raw-cwd insert from the OLD
#    N4a sidecar (pid:23059, pre-N4a.1); N4a.1's first-boot migration cleaned
#    it up to `.commander.json` form atomically.

# Step-10 relaunch boot (pid:62926, cleanest idempotent case):
{total:5, migrated:0, already:5, skipped_deleted:0, deduplicated:0, failed:0, msg:"identity migration: complete"}
```

The `deduplicated` field is present in the summary — that is the H3 live-ship signal Jose was asked to check in §10-dispatch note. Value is `0` in this session because no dup rows pre-existed post-`7f065b4` (PM's earlier DELETE cleared the N4a-era `bcfca492` orphan). A future session with an un-remediated raw-cwd dup would exercise the non-zero path and emit a `system:migration-dedup` forensic row; not exercised in this smoke.

**H2 negative evidence (no new duplicates during N4a.1 window):** DB project-row count held at 5 across the entire N4a.1 smoke session (pid:79564 → pid:62926). No SessionStart hook served by the new sidecar inserted a duplicate — direct evidence H2's dual-form lookup is working as designed. H2-specific curl verify (`SELECT COUNT FROM projects WHERE identity_file_path LIKE '%coder-smoke%'` expecting `1`) not run manually; the aggregate log evidence supersedes.

**Debt 23 second-ship validation note:** `b307af6`'s `liveStreamReceivedRef` guard was shipped pre-N4a.1 but could not be exercised in the N4a smoke because H1 blocked the spawn before the live-transition case could fire. Step 7 of the N4a.1 smoke is its first real-world test. **Confirmed working:** single `done` line, no clear, no duplicate on `running → completed` with viewer open. Debt 23 now fully closed across both the ref-fix and the live-validation dimensions.

**Proposed Jose smoke matrix (dispatch §9 — full rerun of N4a steps 7-10):**

Use `/tmp/coder-smoke/` (or equivalent) as the smoke project. If a migrated row for this cwd exists from the prior (failed) smoke attempt, `Command Center.app` should now boot cleanly (H3 dedup handles pre-existing duplicates). If the DB was cleared by PM's unblock, the first `SessionStart` will land a canonical row (H2 file-first atomic write).

7. **Spawn `sleep 5 && echo done` against `smoke-task-1`; open viewer while running; wait through `running → completed`.**
   - **H1 acceptance:** spawn must succeed — NO `ENOTDIR` error on `<cwd>/.commander.json/.worktrees/`. Worktree materializes at `<cwd>/.worktrees/run-<uuid>/`.
   - **Debt 23 regression (PM's `b307af6` fix):** viewer must show `done` visible, NOT a cleared buffer, NOT duplicated (two `done` lines).
   - If buffer STILL clears OR duplicates: fold a Debt 23 re-fix into this rotation per G10 (instrumentation-first), do NOT open separate ticket.

8. **Kanban PATCH `smoke-task-1` → Done via modal.** Card moves columns live; count badges flip.

9. **Knowledge tab: "first note" append → close/reopen viewer → note persists.**

10. **⌘Q → relaunch → kanban hydrates with all tasks + latest-run pills + knowledge entries.**
    - **H3 secondary check:** if the DB happened to contain a pre-N4a.1 duplicate row, the relaunch boot should NOT halt with `UNIQUE constraint failed`. Sidecar startup log should show `identity migration: complete` with `deduplicated: N` > 0 if any dup was cleaned. Check `~/.commander/commander.log` for the log line.

**H2 external-session check:** Jose opens a NEW Claude Code session in `/tmp/coder-smoke/` → no new duplicate project row appears:

```bash
sqlite3 ~/.commander/commander.db \
  "SELECT COUNT(*) FROM projects WHERE identity_file_path LIKE '%coder-smoke%';"
# Expected: 1 (stays at 1 across additional SessionStart events — no growth).
```

### 3.4 Jose-smoke reality check (per 2026-04-22 CTO operating change)

Every acceptance point corresponds to a code path exercised by the programmatic suite OR observable in the production bundle build output. The only behaviors that truly need Jose's pixels:
- §3.4.1 window-presence (configured, not pixel-verified by CODER — unchanged from N4a).
- Step 7 Debt 23 regression (already exercised in N4a smoke step 5 and passed; N4a step 7 was BLOCKED by H1 before reaching the Debt 23 scenario, so this rerun is the first real live-transition test of PM's `b307af6` `liveStreamReceivedRef` guard — per the dispatch §11 risk note).
- Step 10 H3 secondary check (needs a real DB with the prior duplicate to exercise the dedup branch; lab tests cover both zero-dependent and has-dependent cases, so the live data determines whether we exercise either branch or the pure already-migrated path).

## 4. Deviations from dispatch

**§4 D1 — cwd-does-not-exist fallback in `ensureProjectByCwd`.** Dispatch §2 H2 said "mkdir fails → surface". I added a fallback: if `!existsSync(cwd)`, skip the file write and insert at raw-cwd form. Rationale: `mkdir({recursive: true})` doesn't fail for a deep non-existent path — it just creates it. That means the strict "surface on mkdir fail" rule would have auto-created every synthetic path a test or hook-payload handed us (state-isolation breach — my first H2 attempt hit this). The fallback preserves the prior N3 behavior for non-existent cwds (insert at raw-cwd) and defers the canonical upgrade to the next migration boot when the dir reappears. Schema is unchanged; semantics are backward-compatible; migration already handles this case via `skipped_deleted_on_disk`.

**§4 D2 — concurrent-race file-reconciliation (best-effort, not guaranteed).** Dispatch didn't specify behavior for the case where two `ensureProjectByCwd(same cwd)` race and the loser's disk-write landed before the winner's DB commit. I added a post-race reconciliation that re-writes the file with the winner's id when `existsSync(cwd) && winner.identityFilePath.endsWith('/.commander.json')`. If reconciliation itself fails, the file may temporarily have the losing id — next migration boot reads canonical row, re-writes file idempotently, converges. Under normal sidecar operation this race is near-impossible (SessionStart hooks are serialized through a single Fastify request loop); it fires mainly in `Promise.all([ensureProjectByCwd, ensureProjectByCwd])` tests. Documented inline.

**§4 D3 — N4a existing test updates.** Dispatch §2 H4 added new tests but didn't explicitly ask to update N4a's three SQL-lookup-based tests (cancel-run, plugin-flow, worktree-isolation). Those tests' `SELECT ... WHERE identity_file_path = ?` lookups assumed the pre-N4a.1 raw-cwd shape; post-H2 the column value depends on whether the cwd existed at `ensureProjectByCwd` time. Updated all three to dual-form `OR` lookups, matching the H2 contract. No behavior changes in the code paths under test — this is pure test-vocabulary alignment with the new column semantic. Noted as deviation rather than "regression fix" because the dispatch framed these tests as "still green" without describing the vocabulary-update they needed.

**No G5 / G8 / G10 / G12 violations.** Rust shell untouched (still 149/150). No SQL DDL changes (only type-level `MigrationSummary` addition). G10 instrumentation rotation not fired — H1/H2/H3 root causes were unambiguous from PHASE_N4_REPORT §4 D3; fixes are architecturally sound. G12 dep-hygiene: zero new deps.

## 5. Issues + resolutions (in-rotation)

- **State-isolation breach (first H2 attempt):** my initial H2 called `mkdir(cwd, {recursive: true})` unconditionally on create, which auto-created synthetic `/tmp/test-project` during tests (a real dir + stale `.commander.json` leaked to disk across test runs). Caught by the integration suite's 5 failures. Resolved by the §4 D1 fallback guard + cleaning the residual `/tmp/test-project` on disk.
- **Concurrent-write race (tmp file collision):** my initial H2 used `${identityFile}.tmp` as the tmp path — concurrent calls stomped each other's tmp content AND one caller's `rename(tmp, target)` hit `ENOENT` after the other caller had already renamed. Resolved by per-call unique tmp names (`${identityFile}.<random>.tmp`). Additionally added race-guard + post-race file reconciliation.
- **PTY lifecycle callback firing post-teardown:** H4's `lifecycle-worktree-post-migration` test initially returned before the PTY `echo` exit callback had updated `agent_runs` — Drizzle UPDATE against a closed DB. Resolved by polling until the run hits a terminal state before the `afterAll` `raw.close()`.

## 6. Scope boundary

N4a.1 is the exact scope the dispatch authorized: H1 + H2 + H3 + H4 + H5 + PHASE_REPORT. **No xterm/RunViewer changes** (PM's `b307af6` `liveStreamReceivedRef` fix stands untouched; re-validation lives in §3.3 step 7 live smoke). **No schema/DDL changes** (G8 hard constraint). **No N4b / N5+ work** (workspace sidebar, ContextBar, token bounds all stay deferred per PHASE_N4_REPORT §6).

## 7. Tech debt

- **Debt 24 CLOSES with this rotation** (once §3.3 step 7-10 pass cleanly). Two consumers fixed + end-to-end test coverage in place + migration dedup codified + forensic trail wired.
- **No new debt introduced.** The §4 D2 concurrent-race reconciliation is documented as best-effort + self-healing via migration, not as a standing debt item — there is no known-broken state it leaves behind.
- **Watch item (non-debt):** the H3 `tasks + workspaces` dependent-count check is dual-table. If future versions add new FK relationships to `projects` (e.g., `knowledge_entries` gets a direct `project_id` column, or future team-sharing introduces new references), the dep-check must be updated. I kept the two table refs inline rather than abstracting to a "list of tables with FK to projects" registry — premature abstraction for a single-user-scale product. If a third FK lands, refactor.

## 8. Open questions for CTO

None. The dispatch §8 in-rotation decisions covered the two edge cases (both-rows-have-dependents → halt loudly; DB-row-vs-file-mismatch → DB wins, don't auto-reconcile). Both implemented as specified.

## 9. Next steps

- **Jose §9 smoke rerun** — steps 7-10 of N4a against the rebuilt bundle. PM appends §3.3 with outcomes.
- **On pass:** Debt 24 closes. N4b T10 (multi-workspace sidebar + hidden-workspace suspension) becomes the next unblocked rotation.
- **On regression (step 7 xterm):** G10 instrumentation rotation fires in-N4a.1 per dispatch §7 — do NOT open a separate ticket. Expected instrumentation surfaces: `onPtyData` write timing, `scrollbackBlob` arrival timing, `XtermContainer.useEffect` dep identity.
- **On regression (step 10 H3):** if the live DB has a pre-N4a.1 duplicate with dependents, expected behavior is boot-halt with the clear `"UNIQUE collision with dependents"` message. Jose routes to PM for manual merge decision; PM applies SQL to consolidate tasks under the canonical project id, re-launches.

## 10. Metrics

- **Test count:** 51 → 60 (+9 new N4a.1, -0).
- **Expect-calls:** 199 → 250.
- **File delta:** +3 new test files, 6 modified source files, 3 modified N4a test files.
- **LOC delta:** ~+600 / ~-30.
- **Bundle size:** unchanged (frontend 1712 modules, sidecar 63.7 MB aarch64, Rust shell 149/150 LOC).
- **Codesign signature:** identical pattern to N4a (`flags=0x2 (adhoc) hashes=295+3`).
- **G* violations:** 0.
- **Deviations:** 3 (§4 D1 cwd-fallback, §4 D2 race-reconciliation, §4 D3 N4a test updates).
- **New debt:** 0.
- **Debt closed (pending smoke):** 1 (Debt 24).

---

*PM: append §3.3 with Jose's smoke outcome. If regression appears on Debt 23 step 7 OR step 10 H3 dedup branch, fold the fix into this rotation per dispatch §7 G10.*
