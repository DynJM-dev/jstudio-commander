# CTO_BRIEF — Command-Center N2.1 CLOSE + N3 draft request

**From:** PM · 2026-04-23
**Status:** N2.1 CLOSED on 3/3 user-facing smoke PASS. Bearer contract now locked by a regression test that runs on every commit. Debt 15 RESOLVED. §5 Issue 1 root-cause ratified (rotation Jose observed in N2 was CODER's own N2 T11 smoke-script `rm -rf ~/.commander/config.json`, not production code bug). Two new LOW debts filed. One SMOKE_DISCIPLINE v1.2 amendment proposed.

## §1 — Commit chain (41e501c → 9f8c608 commander-repo; e1975fa meta-repo)

3 commits on commander-repo for N2.1:

- `41e501c` docs(spec+decisions): ARCHITECTURE_SPEC v1.3 + DECISIONS D-KB-09..12 + N2.1 dispatch [PM, calibration fold prep]
- `3d5c51c` fix(n2.1): bearer persistence — atomic writes + readOutcome trace + T3 regression [CODER]
- `29773ed` docs(n2.1): PHASE_N2.1_REPORT — bearer contract locked + §5 Issue 1 finding [CODER]
- `9f8c608` docs(n2.1): append §3.3 PASSED 3/3 — bearer contract locked + Debt 15 RESOLVED [PM]

Plus `e1975fa` in meta-repo: KB v1.3 → v1.4 calibration patch (paired with SPEC v1.3).

Scope: 41/41 tests pass (up 7 new bearer-persistence). Zero new deps (G12). Rust stays 149/150 LOC (G5). Bundle size unchanged. `bun install --frozen-lockfile` clean.

## §2 — Debt 15 post-mortem + §5 Issue 1 root-cause ratification

**§5 Issue 1 — the "rotation bug" wasn't a production bug.** CODER's investigation under T1 grep + T3 regression showed the preservation logic in `config.ts` was already correct. The rotation Jose observed at 15:59 UTC (the one that kicked off the Debt 15 hypothesis in N2 close) traced to CODER's own N2 T11 smoke-readiness inline shell:

```bash
rm -rf ~/.commander/commander.db ~/.commander/commander.db-wal \
       ~/.commander/commander.db-shm ~/.commander/config.json
```

The `rm -rf ~/.commander/config.json` wiped the config; next launch fired an Option-A-compliant fresh-mint via `ENOENT → randomUUID()`; that mint is the `69b70ef5-…` bearer Jose and PM observed at 15:59 UTC. Not a code bug — a smoke-script state-hygiene gap that clobbered Jose's real `~/.commander/` while CODER's script ran against what it assumed was CODER-only state.

**Ratified finding:** no production-code bug existed. Option A preservation was correct as CODER shipped in N2.

**Value delivered by shipping N2.1 anyway:**

1. **T3 regression test** (7/7 assertions) now ratchets the D-N1-07 §8.2 contract on every commit. Future CODER rotation that regresses preservation gets caught by CI before it reaches smoke.
2. **§4 D2 hardening** closes residual operational risks that would have made future bearer-rotation incidents invisible:
   - Atomic write (tmp-file + rename(2)) eliminates torn-JSON class.
   - `readOutcome:"preserved"|"first-run"|"corrupt"|"missing-field"|"unexpected-error"` trace makes future incidents log-legible in 30 seconds instead of 2 hours of investigation.
   - ENOENT-vs-other-error discrimination separates expected first-run from unexpected fs errors (sandbox/permissions/device).
   - Empty-bearer rejection tightens preservation predicate.
3. **§7 Debt 17** bans CODER smoke-scripts from wiping real user-state directories going forward (see §3 below).

PM lean: the investigation was still worth the ~45 min. Without it we'd have moved into N3 with a folk theory about bearer rotation + no test coverage + no in-depth defenses. Now we have the contract locked mechanically.

## §3 — SMOKE_DISCIPLINE v1.2 amendment proposal: §3.4.2 state-isolation discipline

Direct consequence of §5 Issue 1. CODER smoke-readiness scripts MUST NOT wipe real user-state directories. The pattern CODER used in this rotation's own §3.2 is the reference.

**Proposed §3.4.2 text:**

> **§3.4.2 — Smoke-readiness state-isolation discipline (added v1.2).**
>
> CODER smoke-readiness scripts MUST use isolated state paths. Two acceptable patterns:
>
> - **Temp HOME:** script stubs `process.env.HOME = /tmp/<smoke-id>-$$`; sidecar reads from `$HOME/.commander/` so all state is temp. `mkdtemp` + teardown `rm -rf` at exit.
> - **Backup-restore of touched directories:** script records pre-smoke state with `mv ~/.commander ~/.commander-pre-smoke-backup-$$` before smoke; restores after with `mv` back. If any errors during smoke, restore runs unconditionally via `trap`.
>
> `rm -rf ~/.commander/`, `rm -rf ~/.claude/`, or any destructive action against real user-state directories during smoke-readiness is PROHIBITED. Reference implementation: PHASE_N2.1_REPORT §3.2 backup-restore pattern CODER used 2026-04-23.
>
> Rationale: N2 smoke-readiness at CODER's hands wiped Jose's real `~/.commander/config.json`, later misread as a production bug costing one hotfix rotation (N2.1 — the value delivered by N2.1 was contract-lockdown + hardening, not the initially-suspected production fix). State isolation eliminates the class.

This is the third SMOKE_DISCIPLINE layer:
- v1.0 — smoke-scenarios specified at outermost user-facing layer (dispatch §9 pattern)
- v1.1 §3.4.1 — window-presence triad (shell+sidecar in ps, ≥1 AX window, within display bounds)
- v1.2 §3.4.2 (proposed) — smoke-readiness state-isolation

Mechanical fold — ~15 lines of doc to append.

## §4 — Dispatch wording refinement (minor)

Dispatch §6 Step 1 wording "Jose moves his current `~/.commander/config.json` to `~/.commander/config.json.backup`. Relaunches `Command Center.app`" implicitly assumed "⌘Q first." Jose ran `mv` while Command Center.app was still running — UI showed "Unreachable" because the Rust `read_config` IPC couldn't find config.json on disk (even though sidecar was still alive on cached config in memory). Resolved by quit + relaunch. Not a code issue, just wording.

Future hotfix dispatches that ask Jose to move files should spell out the order: **quit → move → relaunch**. Two extra words per step.

## §5 — Tech debt state (post-N2.1)

**Resolved:** Debt 15 (bearer rotation) — contract locked by T3 + hardening shipped.

**New from N2.1:**

- **Debt 16 (LOW)** — Pino `Logger` → `FastifyBaseLogger` bridge via type-assertion in `index.ts:19`. Fix: shared `Logger` type in `packages/shared/src/logger.ts`. ~20-30 min. **Scheduling:** fold into N3 prep since N3 will expand cross-module logging (PTY events + WS pub/sub + agent-run status transitions all logged).
- **Debt 17 (LOW)** — CODER smoke-readiness state-clobber discipline gap. Corrective pattern applied in this rotation; SMOKE_DISCIPLINE v1.2 amendment above codifies it forward. Zero effort (discipline, not code).

**Carried forward (unchanged):** Debts 8-14 from earlier reports. All LOW except none-remaining-MEDIUM after Debt 15 resolution. Zero HIGH across N1 + N1.1 + N2 + N2.1.

## §6 — Standing context

- D-KB-07 narrow-primitive tool surface: HELD through N2.1 (no MCP changes).
- D-KB-08 Tauri perf framing: still validated.
- D-KB-09..12 KB v1.4 / SPEC v1.3 calibration folds: landed in `41e501c` + `e1975fa`.
- `~/.commander/` state dir ratified + in use.
- `bun:test` at sidecar workspace: 23/23 green with 7 new bearer-persistence cases.
- SMOKE_DISCIPLINE v1.1 §3.4.1 window-presence triad: held across N2.1 smoke-readiness.

## §7 — Asks

1. **Ratify SMOKE_DISCIPLINE v1.2 amendment per §3 above.** Proposed text ready to land at `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`. PM can fold mechanically if CTO concurs with the text.

2. **Draft N3 dispatch (PTY spawn — the Run-Task mechanic).** Scope per ROADMAP v0.3 §N3. Fold-ins for N3 dispatch:
   - `spawn_agent_run` stub at `status='queued'` is the handoff point (PHASE_N2_REPORT §9 Obs 1). N3 UPDATE to `running`, attach PTY via `Bun.spawn({terminal})`, stream stdout on `pty:<session_id>` WS topic, UPDATE to `completed/failed/cancelled/timed-out` on exit.
   - `cancel_agent_run` N3 adds SIGTERM → 5s → SIGKILL on PTY handle before updating row status (N2 stubs at `"cancelled-by-caller (N2 stub)"`).
   - Hook pipeline's `ensureProjectByCwd` uses `cwd` as `identity_file_path`; N4's `.commander.json` per-KB-P1.5 is the eventual identity file but N3 scope just uses the current column shape (don't touch it in N3).
   - First real `pty:<session_id>` + `hook:<session_id>` WS subscriber on frontend — the `useSessionPaneActivity`-equivalent hook for Command-Center per PHASE_N2_REPORT §9 Obs 4.
   - Hard bounds per KB-P1.6: wall-clock (SIGTERM+5s+SIGKILL), token limit, iteration limit, explicit cancel. All enforced at sidecar layer (KB-P6.15 no arithmetic in prompts — deterministic code, not model validation).
   - New config.json writes in N3 (if any) MUST use the atomic-tmp-rename pattern from N2.1 `config.ts`. Don't regress.
   - Debt 16 Logger type — small prep, fold before N3's logging surface expands OR include as N3 task zero.

3. **Optional — ratify dispatch-wording refinement per §4.** Future hotfix dispatches asking Jose to move files: spell out ⌘Q → move → relaunch. No formal standard change; just a style note PM can self-apply when relaying prompts.

**End of brief. N3 fires on a locked bearer contract + banked smoke-discipline lesson + 41/41 ratcheting test suite.**
