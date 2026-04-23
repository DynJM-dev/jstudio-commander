# CTO_BRIEF — Command-Center N4a.1 CLOSE + N4a full close + N4b draft request

**From:** PM · 2026-04-23
**Status:** **N4a.1 CLOSED on 4/4 smoke PASS (steps 7-10 of the N4a matrix, rerun against the N4a.1-rebuilt bundle). Debt 24 CLOSED. Debt 23 live-validated for the first time. N4a full close now complete (10/10 smoke across both rotations).** Single CODER ship + single PM in-bracket fix; zero regressions, zero new deps, zero G-violations. N4b is next.

## §1 — Commit chain (b307af6 → 7f065b4 → 81e9089 on commander-repo main)

3 commits closing N4a fully:

- `b307af6` fix(n4a): RunViewer duplicate output on running→completed — PM small-scope fix [PM, run-viewer.tsx +23]
- `7f065b4` docs(n4a): append §3.3 PARTIAL 6/10 + §4 D3 Debt 24 — N4a.1 hotfix routed [PM]
- `81e9089` fix(n4a.1): identity-file consumers post-migration + UNIQUE-collision dedup + coverage [CODER, 14 files +962/-26]

Scope N4a.1: **60/60 tests** (51 N4a carry-forward + 9 new: `ensureProjectByCwd-post-migration` 5 + `lifecycle-worktree-post-migration` 1 + `migration-dedup` 3). **Zero new deps** (G12 clean on `bun install --frozen-lockfile`). **Rust 149/150** unchanged (G5). **No SQL DDL** (G8 held; `MigrationSummary.deduplicated` is a TypeScript type-level extension, not a schema change). D-KB-07 narrow-primitive grep clean (10 MCP tools unchanged — N4a.1 is HTTP-layer + internal-helper work, not MCP surface expansion).

Bundle rebuilt + ad-hoc signed + launchable. Signature pattern identical to N4a (`flags=0x2(adhoc) hashes=295+3`).

## §2 — §4 deviation ratifications (all three to you)

CODER logged three deviations — all PM-concurred, CTO concurrence requested:

**D1 — cwd-does-not-exist fallback in `ensureProjectByCwd`:** ACCEPT. Dispatch H2 said "mkdir fails → surface" but `mkdir({recursive: true})` auto-creates deep non-existent paths instead of failing — would have leaked state-isolation breaches by auto-creating synthetic test paths. CODER's first H2 attempt hit this; the fallback (skip file-write when `!existsSync(cwd)`, insert at raw-cwd form, defer canonical upgrade to next migration boot) preserves the pre-N4a behavior for deleted-on-disk projects + self-heals via migration when the dir reappears. Schema backward-compatible. Prevents the exact class of bug SMOKE_DISCIPLINE v1.2 §3.4.2 was written against.

**D2 — concurrent-race file-reconciliation (best-effort):** ACCEPT. Dispatch was silent on the race between two `ensureProjectByCwd(same cwd)` callers where the loser's disk-write lands before the winner's DB commit. CODER added post-race reconciliation (re-write file with winner's id when `existsSync(cwd) && winner.identityFilePath.endsWith('/.commander.json')`), plus per-call unique tmp names (`${identityFile}.<random>.tmp`) to prevent tmp-stomping. Race is near-impossible under normal sidecar operation (Fastify serializes SessionStart hooks), but `Promise.all([ensureProjectByCwd, ensureProjectByCwd])` tests + future parallel-hook scenarios benefit. Best-effort framing is honest: if reconciliation itself fails, next migration boot converges — no standing debt.

**D3 — N4a existing test updates (cancel-run, plugin-flow, worktree-isolation):** ACCEPT. Dispatch H4 added new tests but implicitly assumed the three pre-existing N4a tests' `SELECT ... WHERE identity_file_path = ?` lookups would stay green. They wouldn't have: post-H2 the column value depends on `existsSync(cwd)` at `ensureProjectByCwd` time. Updated to dual-form `OR` lookups matching the H2 contract. No code-path behavior change — pure test-vocabulary alignment. The dispatch's phrasing ("N4a's 51 tests still green") was the gap; CODER flagged it rather than silently patching. Good discipline.

**No G* violations.** G5 (149/150 LOC Rust), G8 (no DDL), G10 (root cause was unambiguous from N4 §4 D3; no instrumentation rotation needed), G12 (zero new deps) all clean.

## §3 — Debt 24 CLOSES + PM post-close mid-smoke fix (b307af6)

**Debt 24 CLOSED.** H1 + H2 + H3 + H4 all landed + validated via §3.3 smoke:
- H1: `resolveProjectRoot` helper in `services/projects.ts` + routed through `lifecycle.ts:125`. Step 7 smoke confirms no ENOTDIR.
- H2: dual-form lookup + atomic canonical insert + concurrent-race guard. Step 10 log shows 5 rows stable, zero new duplicates across the N4a.1 smoke window.
- H3: UNIQUE-collision dedup + `system:migration-dedup` forensic row via `system-boot` sentinel session. `deduplicated: 0` field visibly present in sidecar boot summary (live-ship evidence); non-zero path exercised in `migration-dedup.test.ts` (3 unit cases covering zero-dep drop + dep-halt + sentinel idempotence).
- H4: 9 new integration tests closing the end-to-end coverage gap that let Debt 24 reach Jose's smoke in the first place.

**PM `b307af6` (Debt 23 ref-based live-stream guard) re-validated.** Shipped mid-N4a rotation but could not exercise in the N4a smoke because H1 blocked the spawn before Debt 23's running→completed transition case could fire. Step 7 of the N4a.1 smoke is its first real-world test — **confirmed working:** single `done` line, no buffer clear, no duplicate output on lifecycle transition with viewer open. Debt 23 now closed across both the fix + live-validation dimensions.

## §4 — §3.3 smoke outcomes (4/4 PASS) + log forensics

Full §3.3 at `PHASE_N4a.1_REPORT.md` + `PHASE_N4_REPORT.md` §3.3 (partial) — key forensic bits:

**Step 7 PASS** (Debt 23 regression + H1 spawn path simultaneously): viewer opened during `running`, `sleep 5 && echo done` transitioned to `completed` with `done` printed and persistent. Single `done` line. No clear. No duplicate. This is the first live exercise of `liveStreamReceivedRef` and it held.

**Step 8 PASS via workaround** (direct PATCH curl; backend wire confirmed; 3s kanban polling picked up the flip and card appeared in Done on next re-render). **No UI affordance shipped to reach the PATCH endpoint from within the app** — banked as **Debt 26** (see §5). Jose also noted the card move was instant (no animation) — code-confirmed: no `framer-motion` layout animation wired. Fold into Debt 26 polish.

**Step 9 PASS:** Knowledge "first note" append → DB persist → re-hydrate on reopen. Append-only behavior intact.

**Step 10 PASS:** ⌘Q + relaunch → kanban re-hydrates all tasks + latest-run pills + knowledge entries. Sidecar boot log:
```
{total:5, migrated:0, already:5, skipped_deleted:0, deduplicated:0, failed:0, msg:"identity migration: complete"}
```
Cleanest possible idempotent re-run. `deduplicated` field visibly present in the summary — live-ship signal for H3 confirmed.

**Earlier N4a.1 boot (first post-rebuild, pid:79564):**
```
{total:5, migrated:1, already:4, deduplicated:0, failed:0}
```
— the `1e66b858 /Users/josemiguelbonilla` row was a stale raw-cwd insert created by the OLD N4a sidecar (pre-N4a.1) during the smoke window; the NEW sidecar's first-boot migration cleaned it up to `.commander.json` form atomically on startup. Evidence that the migration still self-heals stale raw-cwd rows from pre-N4a.1 sidecars — Debt 24 reach covers both H1/H2 consumer fix AND migration robustness to pre-existing artifacts.

## §5 — New debt + PM mid-smoke ship

**Debt 26 OPENED — kanban task-status edit UI missing.** Smoke step 8 surfaced that N4a shipped kanban as status-read-only: no drag-and-drop, no column selector, no edit affordance on the card. Backend PATCH works (validated via curl). This is a **shipped acceptance gap, not a regression** — N4a's §1 4.1-4.6 criteria specified display + creation + card→viewer + knowledge, not post-create editing. Dispatch §9 step 8 assumed "modal's column selector" existed; assumption didn't materialize. CODER didn't violate acceptance.

Jose's explicit ask post-smoke: "grab and drop, move around, status selector to pick another column." Scope:
- **Status selector on card** (small): ~35-40 LOC, zero new deps, reuses the `<select>` pattern from `add-task-modal.tsx`. PM small-scope-eligible.
- **Drag-and-drop between columns** (larger): 80-150 LOC + new dep (`@dnd-kit/core` or `@atlaskit/pragmatic-drag-and-drop`); touches every column + card + kanban state. CODER-scope.
- **Move animation** (polish): ~10 LOC if `framer-motion` present (check dep tree); `<motion.div layout>` + `AnimatePresence`. Pair with the selector ship.

**Recommended home: fold all three into N4b T10** ("multi-workspace + hidden-workspace suspension + sidebar affordances"). Edit-UI naturally belongs with the workspace-concept work. Saved as project memory so it surfaces on future-N4b dispatch drafting.

**PM mid-smoke ship (reverted):** I started the status-selector fix directly during smoke when Jose authorized "if not too complicated, try it." Completed the import block, then aborted + reverted when Jose ran the curl and confirmed step 8 PASS via workaround — no need to disrupt the live smoke with a mid-session rebuild. The revert is commit-less (uncommitted Edit was undone in-place). Banking the started-work as evidence the selector slice is genuinely ~35 LOC and PM-shippable when CTO wants it.

**No other new debt.** CODER's §7 "no new debt introduced" is accurate for the hotfix itself — Debt 26 is a pre-existing acceptance gap that the smoke surfaced, not something the hotfix created.

## §6 — Questions for CTO

**Q1 — Debt 26 routing.** Do you want (a) PM to ship the selector now as a standalone small-scope commit (~35 LOC, 1 rebuild, 2-3 min) before N4b draft so Jose has the affordance during dogfood, or (b) fold everything (selector + DnD + animation) into N4b T10 as a single shaped rotation? My read is (b) because the DnD work naturally co-locates and there's no current blocker — Jose has the curl workaround for edge-case moves. Your call.

**Q2 — D3 test-vocabulary framing.** CODER logged the N4a existing-test updates as a "deviation" because the dispatch framed those tests as "still green" without describing the vocabulary update they needed. Should future hotfix dispatches explicitly enumerate "tests that will need re-assertion alignment" as part of the dispatch §2 scope, so CODER doesn't have to flag it as a deviation? My suggestion: yes, add this to the hotfix dispatch template (PM drafts with a `tests likely needing vocabulary update` bullet).

**Q3 — N4b gating.** Dispatch N4b T10-T12? Or pause for a dogfood window first? N4a+N4a.1 shipped 4 major surfaces (kanban home, task CRUD, identity migration, RunViewer Radix + knowledge) over ~18 hours of rotation. Jose may want to dogfood on real Commander work before adding workspace complexity. My suggestion: 24-48h dogfood, then draft N4b with observations accumulated.

## §7 — Routing

PM appends this close brief to the queue. Jose forwards to CTO. CTO ratifies §2 D1/D2/D3, answers §6 Q1/Q2/Q3, and either (a) authorizes N4b draft or (b) authorizes PM selector-only ship + N4b after dogfood.

**Post-ratification sequence:**
- Q1 (a) — PM ships selector commit + Jose rebuilds + smokes, then N4b draft request
- Q1 (b) — N4b draft attached to CTO ratification; dispatched to CODER; D1/D2/D3 close folds into N4b acceptance context; Debt 26 is N4b T10 scope
- Q3 dogfood — PM goes pure-receive-mode per `feedback_dogfood_silent_unless_flagged` memory; Jose reports observations as they come; synthesis after dogfood ends or on explicit ask
