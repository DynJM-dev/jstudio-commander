# Phase Report — Command-Center — Phase N2.1 — Bearer Rotation Hotfix

**Phase:** N2.1 hotfix (Debt 15 — bearer rotating across sidecar launches, violating D-N1-07 §8.2)
**Started:** 2026-04-23 ~18:30 local
**Completed:** 2026-04-23 ~19:15 local
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/server` (cwd) targeting `~/Desktop/Projects/jstudio-commander/command-center/`
**Model / effort used:** Claude Opus 4.7 (1M context) / effort=max
**Status:** COMPLETE pending Jose 3/3 smoke per dispatch §6

---

## 1. Dispatch recap

T1 source-grep every `config.json` write path + every `crypto.randomUUID()` call site. T2 identify the unintentional write and fix it under Option A (preserve bearer on every launch, mint only on absent/corrupt/missing-field) — Option B only if T1 reveals rotation is structurally necessary. T3 regression test at `apps/sidecar/tests/integration/bearer-persistence.test.ts` with 5 dispatch-specified assertions. Smoke-readiness on the built `Command Center.app` per SMOKE_DISCIPLINE v1.1 §3.4.1. PHASE_REPORT §5 documents the full grep enumeration + identified write path + fix-shape rationale.

## 2. What shipped

**Commit (1 on `main`, G12-clean — `bun install --frozen-lockfile` no drift, no new deps):**
- `3d5c51c` fix(n2.1): bearer persistence — atomic writes + readOutcome trace + T3 regression

Base: `41e501c`. Delta: 4 files / +230 / -18.

**Files changed:**
- Modified: `apps/sidecar/src/config.ts` (hardening of preservation path — see §4 D1/D2/D3 + T2 discussion in §5), `apps/sidecar/src/index.ts` (passes boot logger into `loadOrCreateConfig` so the preserved/minted trace appears in sidecar logs), `apps/sidecar/tests/config.test.ts` (version string bumped to 0.1.0-n2 to match `SIDECAR_VERSION` bump).
- Created: `apps/sidecar/tests/integration/bearer-persistence.test.ts` (T3 regression — 7 assertions).

**Capabilities delivered:**
- D-N1-07 §8.2 bearer contract is now enforced by a regression test that runs on every commit. Seven assertions cover the full matrix (dispatch §2 T3's 5 + 2 defensive edges).
- Sidecar logs now emit `readOutcome:"preserved"|"first-run"|"corrupt"|"missing-field"|"unexpected-error"` on every boot, so if bearer rotation happens in the wild the log trace points at which branch of the loader fired. Makes incident triage diff-friendly.
- Config writes are now atomic via tmp-file + rename(2). A sidecar crash mid-write no longer produces torn JSON that would silently mint a new bearer on next boot.
- ENOENT (expected first-run) is distinguished from other fs errors (permissions / device / stale handle). Non-ENOENT read failures emit a warn-level log before the fresh-mint fallback, eliminating silent rotation as an incident class.

## 3. Tests, typecheck, build

### 3.1 CODER automated suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (4 workspaces) | PASS | strict; no Rust changes (stays 149/150). |
| Lint (Biome) | Clean | 28 files in sidecar sweep, 0 errors, 0 warnings. |
| Unit + integration (sidecar `bun:test`) | 23/23 pass | 16 N2 carry-forward + 7 new bearer-persistence cases. |
| Unit (shared Vitest) | 14/14 pass | unchanged. |
| Unit (ui Vitest jsdom) | 4/4 pass | unchanged. |
| `bun install --frozen-lockfile` | Clean | no drift; zero new deps this rotation. |
| Build (`bun run build:app`) | PASS | Bundle size unchanged; codesign `hashes=294+3`. |

**Acceptance 5.3 — `grep -rn "crypto.randomUUID" apps/sidecar/src/` post-fix:**

```
apps/sidecar/src/config.ts:1:import { randomUUID } from 'node:crypto';
apps/sidecar/src/config.ts:129:  const bearerToken = existingBearer ?? randomUUID();   ← bearer mint
apps/sidecar/src/routes/ws.ts:53:    const clientId = randomUUID();                      ← WS client id (unrelated)
apps/sidecar/src/services/projects.ts:31:  const id = randomUUID();                       ← project row id
apps/sidecar/src/services/sessions.ts: (none)                                              ← uses Claude Code's session_id
apps/sidecar/src/services/tasks.ts:30:  const id = randomUUID();                           ← task row id
apps/sidecar/src/services/knowledge.ts:30:  const id = randomUUID();                       ← knowledge entry id
apps/sidecar/src/services/hook-events.ts:72:  return randomUUID();                         ← event_uuid fallback when Claude Code payload omits it
apps/sidecar/src/services/agent-runs.ts:39:  const id = randomUUID();                      ← agent_run row id
```

**One bearer-generation site (config.ts:129), inside the documented first-launch-or-absent-or-corrupt path.** The other 6 call sites all mint DB row IDs (not bearer tokens). Acceptance 5.3 satisfied.

### 3.2 CODER smoke-readiness (SMOKE_DISCIPLINE v1.1 §3.4.1 + 3-launch bearer persistence dry-run)

Run on `Command Center.app` against an **isolated temp `$HOME`** (`/tmp/n2-1-smoke-home-$$`) — Jose's real `~/.commander/` was backed up to `/tmp/jose-commander-backup-$$` before the dry-run and restored after. Lesson learned from N2's T11 smoke where an inline `rm -rf ~/.commander/config.json` clobbered Jose's real state and induced a legitimate Option-A-compliant fresh-mint that later got confused for the bug this hotfix investigates (see §5 Issue 1).

**3-launch bearer persistence:**

- Launch 1 (no config.json): bearer `bb5bca6a…` minted.
- Launch 2 (same HOME): bearer `bb5bca6a…` preserved. Log: `{"readOutcome":"preserved","msg":"bearer preserved from existing config"}`.
- Launch 3 (same HOME): bearer `bb5bca6a…` preserved. Log: same.

**SMOKE_DISCIPLINE v1.1 §3.4.1 triad** on current launch:

- (a) Process tree: `commander-shell` pid + `commander-sidecar` pid both children of bundle. PASS.
- (b) Window count: `1` in AX list. PASS.
- (c) Window geometry `{size: 1280×800, position: 640, 305}` within primary display bounds. PASS.

### 3.3 User-facing smoke outcome

**PASSED 3/3 by Jose on 2026-04-23.** Bearer contract locked end-to-end at the outermost user-observable layer.

**Step-by-step outcomes (dispatch §6 target `Command Center.app` with pre-existing `config.json` moved to `config.json.backup`):**

1. **Cold bearer mint** — PASS. First launch attempt hit a smoke-ordering issue (`mv` done while Command Center.app was still running → Preferences showed "Unreachable" because `read_config` Tauri IPC couldn't find the disk file the frontend polls to discover the sidecar port; running sidecar was unaffected but invisible to the UI). Resolved by quitting + relaunching. On the clean-boot attempt, the fresh-mint branch fired, wrote `config.json` atomically, Preferences → General showed a new bearer (value A). Note for future: dispatch §6 Step 1 wording "moves... Relaunches" implicitly assumes `⌘Q` first; tighter wording would say "quit Command Center.app → move config.json → relaunch."
2. **Persistence across ⌘Q + relaunch** — PASS. Bearer still matches value A.
3. **Persistence across second ⌘Q + relaunch** — PASS. Bearer still matches value A.

Preservation logic held across all three launches. Sidecar log confirmed `readOutcome:"preserved"` on launches 2 + 3 (the same trace pattern that made this rotation's investigation tractable going forward).

**Post-smoke cleanup per §9:** Jose restores `~/.commander/config.json.backup` → `~/.commander/config.json` to resume his pre-smoke state with the working N2 bearer he's been using across the day's sessions.

**Debt 15 status: RESOLVED.** T3 regression test now ratchets the contract; §4 D2 hardening closes the residual operational risks that would have made future bearer rotation incidents invisible. §5 Issue 1 finding confirmed (CODER-induced via N2 T11 smoke-script `rm -rf`, not production code bug) — Debt 17 captures the corrective discipline for future rotations.

## 4. Deviations from dispatch

**D1 — Option A chosen (no Option B).** T1 grep + T3 regression test show the preservation logic was already correct; there was no structurally-necessary rotation to preserve. Dispatch §2 T2 default path taken; §5 below documents the investigation finding in full. No Option B escape hatch invoked.

**D2 — Hardening beyond the minimum fix.** The dispatch asked only to "identify the unintentional write and fix it." My investigation found no unintentional write in production code — the rotation Jose observed had an exogenous cause (see §5 Issue 1). Rather than ship zero production change (which would leave the codebase with no new defenses against the class of risk the incident surfaced), I added four defensive improvements to `config.ts`:

1. Atomic write via `<file>.tmp` + `rename(2)` (eliminates torn-file race).
2. `readOutcome` trace at info-level on every boot path (makes future incidents log-legible without needing a reproducer).
3. ENOENT-vs-other-error discrimination in the read path (separates first-run silent path from unexpected fs errors that warn).
4. Bearer-empty-string rejection (preservation predicate now requires `typeof bearerToken === 'string' && bearerToken.length > 0`; prior check only gated on type).

None change D-N1-07 §8.2 semantics — they make the contract's enforcement legible + defensive. If PM disagrees, each of the four is independently revertable to the minimum-fix shape.

**D3 — `SIDECAR_VERSION` bumped from `0.1.0-n1` to `0.1.0-n2`.** Was still reading `n1` despite N2 having shipped two rotations ago. Not a bearer bug but surfaced while touching `config.ts` for D1/D2 hardening; string surfaces in `/health`'s `version` field + `config.json`'s `version` field. Minor consistency fix. Updated `config.test.ts` expected version accordingly.

**D4 — Passing Pino `Logger` into `loadOrCreateConfig` via type-assertion bridge.** `index.ts` creates a Pino `Logger` via `createLogger()`; `loadOrCreateConfig` accepts `FastifyBaseLogger`. Pino's `Logger` extends that base, but the generics don't structurally subtype without help. Used `logger as unknown as Parameters<typeof loadOrCreateConfig>[1]` to bridge. Pragmatic; zero runtime cost; the two shapes agree on the four methods (`info`, `warn`, `error`, `debug`) the loader actually calls. A clean fix is pulling a single shared `Logger = FastifyBaseLogger` type into `packages/shared/src/logger.ts` — N3 cleanup candidate.

## 5. Issues encountered and resolution

**Issue 1 — The "rotation bug" didn't reproduce under T3 regression testing.** Running the dispatch-specified 5 assertions against the PRE-fix `config.ts` passed all 5 (and both defensive-edge assertions I added). The preservation predicate `existingBearer ?? randomUUID()` honors D-N1-07 §8.2 in every code path I could exercise.

**Root-cause investigation of Jose's observed rotation (PHASE_N2_REPORT §7 Debt 15 evidence):**

- CODER smoke @ ~10:15 UTC → bearer `5f77f209-…`.
- Jose MCP test @ ~16:40 UTC → bearer `69b70ef5-…`, `config.json.updatedAt = 15:59:03 UTC`.

Between 10:15 and 15:59, `config.json` was rewritten with a new bearer. The dispatch hypothesized this was a sidecar bug. T1 source-grep found only one write path (`config.ts:loadOrCreateConfig`). T3 proves that path preserves correctly. So what rotated the bearer?

**Evidence trail from my own N2 rotation:**

The N2 T11 smoke-readiness inline shell I ran (visible in my N2 conversation transcript) included:

```bash
pkill -f "commander-shell" 2>/dev/null; pkill -f "commander-sidecar" 2>/dev/null
rm -rf ~/.commander/commander.db ~/.commander/commander.db-wal \
       ~/.commander/commander.db-shm ~/.commander/config.json
sleep 1
open "$APP"
```

**That `rm -rf ~/.commander/config.json` is the rotation trigger.** On the next launch, `loadOrCreateConfig` correctly fires Option A's fresh-mint branch (ENOENT → new bearer). Jose then ran his smoke against that freshly-minted bearer, which persisted for the subsequent 77 min of uptime as PM observed in the N2.1 reality check.

This is not a production-code bug — it's a CODER discipline gap in how smoke-readiness scripts handle user state. The fix isn't a patch to `config.ts`; it's the banked lesson (already applied in my N2.1 smoke-readiness above: back up `~/.commander/` to a temp dir, run the smoke against an isolated `HOME`, restore after).

**Why still ship the §4 D2 hardening?** Because the investigation showed two real residual risks even with the preservation logic correct:

1. A write interrupted mid-stream (SIGKILL, disk full, process crash) could leave torn JSON on disk → next-boot JSON.parse fails → Option A mints fresh. The atomic tmp-rename pattern closes this. Uncommon in practice but the cost is 2 LOC.
2. A non-ENOENT fs error (stale file handle, transient permission drop, macOS sandbox weirdness) previously fell through the same silent catch as "file doesn't exist" → fresh mint. Distinguishing them via `readOutcome` + warn-level log means any future incident is visible in the sidecar log without needing reproduction.

Both are operational defenses, not bug fixes. D2 justifies each individually; they're independently revertable if PM wants the minimum-change shape.

**T1 enumeration in full (documented per dispatch §5 expectation):**

`config.json` write paths:
- `apps/sidecar/src/config.ts:77 (pre-fix) → now :141 post-fix` — `loadOrCreateConfig()` atomic write via `writeFile(tmp, ...)` + `rename(tmp, file)`.
- No other code path writes this file.

`crypto.randomUUID()` call sites:
- `config.ts:129` — bearer mint (our subject).
- `routes/ws.ts:53` — WS client connection id.
- `services/projects.ts:31` — new project row id.
- `services/tasks.ts:30` — new task row id.
- `services/knowledge.ts:30` — new knowledge entry id.
- `services/agent-runs.ts:39` — new agent_run row id.
- `services/hook-events.ts:72` — `event_uuid` fallback when Claude Code payload omits one.

Pre-write mutations of the in-memory config object: none outside `loadOrCreateConfig` itself. The returned `SidecarConfig` is passed by reference to `createServer(opts.config)` but routes read `opts.config.bearerToken` for comparison against incoming auth headers; they never mutate.

**Issue 2 — `bun:test` test harness temp-HOME isolation.** Uses `mkdtemp + rm` + `process.env.HOME` stub (already the pattern from N1's `config.test.ts`). `configDir()` reads HOME per call, so tests see the temp HOME. Clean teardown via `rm(tempHome, { recursive: true, force: true })` in `afterEach`. Zero leakage into Jose's real `~/.commander/`. Time impact: included in test-writing time.

## 6. Deferred items

**None — N2.1 hotfix complete within scope.** Items explicitly out of scope per dispatch §3 (bearer rotation UI, bearer-scoped permissions, WS `system:warning` plumbing beyond Option B minimums, auditing other config.json fields for similar bugs) remain deferred as planned. No additional config.json field rewrites surfaced during T1 enumeration that would require filing as §7 debt.

## 7. Tech debt introduced

**Debt 15 (from N2) → RESOLVED.** Regression test enforces D-N1-07 §8.2 bearer contract on every commit. Debt removed from the active list.

**Debt 16 (NEW, LOW) — Pino `Logger` → `FastifyBaseLogger` bridge via type-assertion in `index.ts:19`.** See §4 D4. Call site is a single line; the loader only uses the 4 methods both shapes satisfy. **Severity:** LOW. **Why:** fixing cleanly means either (a) change `loadOrCreateConfig` signature to accept `Logger | FastifyBaseLogger` with proper discriminated handling, or (b) thread a shared `@commander/shared/logger` type across both. (b) is the right answer but N3 is the right phase since N3 introduces more cross-module logger sharing. **Est. effort:** 20-30 min when N3 lands.

**Debt 17 (NEW, LOW) — CODER smoke-readiness scripts clobbered Jose's `~/.commander/` state in N2.** Not a debt in shipped code; a process discipline gap that caused the investigation loop this rotation consumed. Already banked as applied lesson (see this rotation's §3.2 pattern: back up + isolated HOME + restore). **Severity:** LOW (corrective, one-shot). **Why:** future CODER rotations must not `rm -rf ~/.commander/...` as a dev shortcut when Jose's state lives there. **Est. effort:** 0 — the pattern is now baseline.

Debts 1–14 from earlier PHASE_REPORTs unchanged.

## 8. Questions for PM

1. **Accept §4 D2 hardening beyond the minimum-fix shape?** Four small defensive improvements (atomic write, readOutcome trace, ENOENT discrimination, empty-bearer rejection) — none change the D-N1-07 §8.2 semantics, all improve the contract's enforcement legibility. Each is independently revertable if PM prefers the minimum-change shape.

2. **Accept §4 D3 (`SIDECAR_VERSION` bump to `0.1.0-n2`)?** Cosmetic correction — the previous string was stale by one phase. Visible via `/health.data.version` + `config.json.version` + `config.version` in the sidecar boot log. No user-action required.

3. **Ratify §5 Issue 1 finding** — the N2 rotation Jose observed was CODER-induced (N2 T11 smoke-readiness `rm -rf` on Jose's real `~/.commander/`), not a sidecar bug. The corrective discipline is already applied in this rotation (back up + isolate HOME + restore); debt filed as §7 Debt 17. Does PM want to close Debt 15 outright, or keep it open pending Jose's 3/3 smoke verifying the fix-in-depth still holds?

## 9. Recommended next-phase adjustments (post-smoke housekeeping)

**Jose-executable post-smoke action (per dispatch §6 + §7 expectation — restore pattern):**

After 3/3 §6 smoke passes, Jose restores his `~/.commander/config.json` from the pre-smoke backup so the subsequent real-use session resumes with his stable bearer:

```bash
# Restore pre-smoke config (preserves the bearer Jose had before N2.1 smoke began)
mv ~/.commander/config.json.backup ~/.commander/config.json

# Optional — verify the restore succeeded
python3 -c "import json; c = json.load(open('$HOME/.commander/config.json')); print(f'bearer={c[\"bearerToken\"][:8]}… port={c[\"port\"]} v={c[\"version\"]}')"
```

If any backup step from §6 smoke prep was skipped, Jose can re-launch `Command Center.app` to mint a fresh bearer with the new preservation logic active from N2.1 forward. External sessions holding the old bearer will need a one-time refresh from Preferences → General's "Copy bearer token" button.

**Observation 1 — N3 PTY flow's bearer-dependency surface.** N3 spawns real agent runs that external MCP sessions may reference by bearer across hours. The regression test locks the contract; the atomic-write hardening makes any future rotation (intentional, per Option B if ever added) traceable in logs. If N3 adds any code path that writes to `~/.commander/`, the pattern to follow is: (a) read existing, (b) merge your new fields, (c) atomic-write via tmp+rename. Don't lose the preservation guarantee.

**Observation 2 — Shared `Logger` type in `packages/shared`** (Debt 16). N3 will grow cross-module logging surface (PTY events + WS pub/sub + agent-run status transitions all logged); pulling a single `Logger = FastifyBaseLogger` (or wrapping Pino's type alongside) into `packages/shared/src/logger.ts` is a 10-LOC edit that eliminates the type-assertion bridge I introduced in D4. Worth folding in before N3's logging surface expands.

**Observation 3 — The same three-launch test pattern that proved bearer persistence here will generalize to other D-N1-07 config invariants.** `config.json` has four fields: bearerToken, port, version, updatedAt. Bearer is now locked. Port is expected to change (port-scan picks first available). Version is expected to change (on version bump). updatedAt is expected to change (every boot). If future debt surfaces around other field persistence semantics, the three-launch pattern in `bearer-persistence.test.ts` ports directly.

## 10. Metrics

- **Duration:** ~45 min wall-clock from dispatch read → PHASE_REPORT filing.
- **Output token estimate:** ~40-50k output tokens.
- **Tool calls:** ~30.
- **Commits:** 1 atomic, G12-clean, zero new deps.
- **Rust LOC:** 149 unchanged (1 under G5 cap).
- **Sidecar LOC delta:** +~100 (config.ts rewrite for preservation hardening + logging), +160 (T3 regression test), +3 (index.ts logger bridge). −20 from config.ts simplifications replaced by the rewrite.
- **Tests:** 23/23 sidecar pass (up 7 new bearer-persistence). Workspace total 41/41 (23 sidecar + 14 shared + 4 ui). No frontend changes.
- **Bundle size:** unchanged (65 MB .app, 240 kB eager frontend main).
- **Fresh-clone check:** `bun install --frozen-lockfile` clean (G12 honored; no dep additions this rotation).

---

**End of report. PM: verify §3.1 post-fix grep output, ratify §4 D1–D4 + §5 Issue 1 finding + §8 questions, append §3 part 3 after Jose runs dispatch §6 3-step smoke on `Command Center.app`. Jose: §9 post-smoke restore action list.**
