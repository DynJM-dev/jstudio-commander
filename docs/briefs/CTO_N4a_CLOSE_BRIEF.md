# CTO_BRIEF — Command-Center N4a PARTIAL CLOSE + N4a.1 hotfix dispatch

**From:** PM · 2026-04-23
**Status:** **N4a PARTIAL CLOSE.** 10/10 N4a tasks shipped + 51/51 tests green + zero new deps. User-facing smoke PARTIAL: 6/10 steps PASS, step 7 BLOCKED by mid-smoke architectural discovery (Debt 24), steps 8-10 deferred. **N4a.1 hotfix dispatch attached** — 3 code files + 3 integration tests + smoke rerun of steps 7-10.

## §1 — What shipped in N4a (commit chain + scope)

CODER N4a single-ship, full detail in `PHASE_N4_REPORT.md` §1-2. Plus PM follow-on `b307af6` (Debt 23 duplicate-write fix: `liveStreamReceivedRef` suppresses scrollback-blob seed when live stream already covered content).

Pattern N4a closed well from a code-ship perspective:
- Kanban as home, Radix Dialog RunViewer, `.commander.json` T1 migration, append-only Knowledge, MCP spawn_agent_run wired end-to-end.
- 51/51 tests. Rust 149/150 unchanged. Zero new deps. D-KB-07 narrow-primitive discipline held. SMOKE_DISCIPLINE v1.2 §3.4.2 state-isolation held.
- Bundle built + ad-hoc signed + launchable per CODER's §3.2 evidence.

Smoke outcome (§3.3 of phase report): 6/10 PASS (steps 1-6 — app launches, kanban paints, task creation + spawn lifecycle + RunViewer all exercised), step 7 BLOCKED, 8-10 deferred.

## §2 — §4 deviations (PM concurrence on D1, D2; new D3 = Debt 24 discovery)

CODER's two declared deviations (D1 deleted-on-disk "leave unchanged", D2 no projectId filter on kanban query): both ACCEPT. D1's schema-preserving-equivalent reasoning is sound (any sentinel-in-column approach couples every consumer to the sentinel — worse than filter-at-query). D2 is defensible since N4a ships without workspace concept and the filter wiring is already plumbed at HTTP+service layer.

**§4 D3 — Debt 24 discovered mid-smoke. PM-filed, routing to CODER as N4a.1.**

### Root cause

T1 migration flipped `projects.identity_file_path` from "project root dir path" to "path to `.commander.json` identity file". Two sidecar consumers weren't updated to match:

1. **`apps/sidecar/src/agent-run/lifecycle.ts:116`** — `const projectRoot = project.identityFilePath;` passes the FILE path into `createWorktree`, which then does `mkdir('<cwd>/.commander.json/.worktrees')` → `ENOTDIR` on every spawn for migrated projects.
2. **`apps/sidecar/src/services/projects.ts:25-42`** — `ensureProjectByCwd` still looks up + inserts by raw cwd. Every new Claude Code SessionStart hook in a migrated project creates a duplicate row at raw-cwd form → next sidecar boot's T1 migration hits UNIQUE-constraint collision → boot halts (exit code 4 → frontend "loading → load failed").

### Blast radius observed in smoke

- Jose's step-5 spawns succeeded (2×) because the coder-smoke project row was still at raw-cwd form from its first SessionStart hook of the smoke session.
- PM unblock-DELETE of orphan `bcfca492` row required Jose to relaunch → relaunch triggered T1 migration → flipped coder-smoke row to `.commander.json` form.
- Step-7 spawn then hit ENOTDIR because `lifecycle.ts` is now treating the file as a dir.

### Why CODER's 51/51 tests didn't catch it

Migration tests use in-memory DB + fresh rows. Worktree tests pass `projectRoot` directly rather than resolving through `getProjectById`. No test covers the end-to-end path `SessionStart → ensureProjectByCwd → migration → spawn_agent_run → createWorktree` across the format flip. This gap is H4 of the attached hotfix.

## §3 — PM mid-rotation fixes (two)

**`b307af6` — Debt 23 follow-on fix (small scope, frontend only).** CODER's Debt 23 fix at T5 prevented buffer-clear on `running → completed` but introduced a duplicate-write (live stream + scrollback blob both wrote the same bytes). Added `liveStreamReceivedRef` to suppress the blob seed when the live stream has already delivered PTY bytes. Untested live — the N4a.1 smoke rerun is its first real lifecycle-transition validation.

**Manual DB unblock (no commit).** Deleted orphan `bcfca492` project row via `sqlite3 DELETE` after verifying 0 dependent tasks / agent_runs / sessions / hook_events / knowledge_entries. Required to get Jose past step 1 of the smoke rerun. Destructive action against a local dev DB only; canonical row (c5fe6a6e) preserved with all of test-proj-mcp's dependent data. Codified into migration logic as H3 of the hotfix so this class of boot-halt self-resolves next time.

## §4 — N4a.1 hotfix dispatch (attached at `~/Desktop/N4A.1_CODER_PROMPT.md`)

Four work items + smoke rerun:
- **H1** — `lifecycle.ts:116` resolve project root via `dirname(identityFilePath)` when `.commander.json` suffix present. Extract helper `resolveProjectRoot()` for reuse.
- **H2** — `ensureProjectByCwd` normalizes to `.commander.json` form: dual-form lookup (new + legacy), canonical insert, atomic identity-file write on create per OS §20.LL-L16.
- **H3** — T1 migration UNIQUE-collision dedup: on collision, zero-dependent rows are dropped + counted; rows with dependents halt migration loudly for manual merge. Codifies what PM did manually.
- **H4** — Missing integration test covering the full SessionStart → migration → spawn flow.
- **H5** — Rebuild + Jose reruns smoke steps 7-10 (step 7 also re-validates Debt 23 regression fix that step 7 was supposed to cover before it got blocked).

No schema changes. No new deps. G5 / G8 / G10 / G12 all clean. No effort estimate per 2026-04-22 rule.

## §5 — New tech debt from N4a rotation

**Debt 24** — `identity_file_path` column semantic flipped by T1 but two consumers not updated. **CLOSES via N4a.1.**

All prior LOW debts (18-21) unchanged. Debt 22 + 23 were CODER-targeted for close in N4a; 22 closes cleanly (Radix Dialog replaced custom backdrop, a11y suppressions gone); 23 remains live-untested until N4a.1 smoke step 7 runs.

## §6 — Smoke matrix status

| # | Result |
|---|--------|
| 1-6 | PASS (1 explicit, 2-6 implicit — full detail in `PHASE_N4_REPORT.md` §3.3) |
| 7 | BLOCKED (Debt 24) |
| 8-10 | NOT RUN |

Step 7 Debt 23 regression fix is unverified live; the N4a.1 rerun is its first real test. If it regresses there, fold a Debt 23 re-fix into N4a.1 per G10.

## §7 — Questions for CTO

**Q1.** Ratify `b307af6` PM follow-on fix approach (ref-based live-stream tracking). Clean, but the "prevent double-write" class of bugs in this area is getting sensitive — is a broader xterm-lifecycle restructure worth queuing for N5+ or is the current ref-pattern acceptable maintenance cost?

**Q2.** Ratify the manual DB unblock. Auto-mode allowed me to take the destructive action against Jose's local DB after I verified 0 dependents — was that the right line, or do you want PM to always pause for CTO ack on any DB DELETE even when clearly reversible (via re-SessionStart creating the row fresh)?

**Q3.** Ratify H3's dedup semantics — zero-dep auto-drop with log, has-dep halt-loud. Alternative: always halt, never auto-drop (forces every dup through manual review). My read is auto-drop is the right default because the duplicate IS definitionally a bug-created artifact with no user data; halt-always penalizes users for a past bug they didn't cause. Want your call.

## §8 — Routing

Jose forwards this brief + `~/Desktop/N4A.1_CODER_PROMPT.md` to CTO in one hand-off. CTO ratifies §2 D1/D2/D3, answers §7, returns dispatch authorization (or modifications). PM then pastes to CODER.

**Post-hotfix sequence:** CODER ships H1-H4 + smoke-readiness → PM paste → Jose smokes steps 7-10 → PM appends §3.3 to PHASE_N4a.1_REPORT + drafts CTO_N4a.1_CLOSE_BRIEF → full N4a close → N4b draft request (T10 multi-workspace + T12 smoke extension).
