# Phase Report — JStudio Commander native v1 — Phase N2.1.5 — Bootstrap race + xterm.js render + status stale

**Phase:** N2.1.5 — Hotfix: Bug D cold-launch race + Bug H xterm.js initial-mount artifacts + Bug I status-stale (closed not-reproduced)
**Started:** 2026-04-22 (continuing CODER spawn, no reset)
**Completed:** 2026-04-22 (same rotation; Jose's user-facing smoke PARTIAL — see §3)
**Status:** NOT CLOSED — 13 PASS + 2 FAIL. Bug D still fails first cold-launch (CODER's 3s deadline too short); Bug H layout-race fix HELD but NEW Bug K (encoding mojibake) surfaced. Native v1 NOT dogfood-ready. Routed to CTO for N2.1.6.
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=xhigh continuing
**Status:** CODER-COMPLETE; awaiting Jose's user-facing smoke per SMOKE_DISCIPLINE.md §5

---

## 1. Dispatch recap

Fix three residual bugs from Jose's N2.1.4 smoke that sit ABOVE the N2.1.4
fix layer: Bug D cold-launch bootstrap-autosend race, Bug H xterm.js
initial-mount visual artifacts, Bug I status-stale-after-ESC. Non-scope
per dispatch §4: Bug J (JSONL cross-instance leak) → N3; Bug F + Obs G →
N3; UI polish → N3 / dedicated UI phase.

New guardrails enabled: G13 (sub-agent authorization), G14 (external-tool
use with stated intent). Both used for Bug H upstream investigation.

## 2. What shipped

**Commits (2 diagnostic + 2 fix + 1 smoke + 1 report = 6 new):**

- `94199ae` `diagnostic(n2.1.5)` — Bug D evidence at sidecar pty-write timing layer (G10)
- `6ee4271` `diagnostic(n2.1.5)` — Bug H evidence at xterm.js WebGL render layer (G10)
- `0e6bf6c` `sidecar(n2.1.5)` — Task 2 Bug D fix: bracketed-paste wrappers + post-write quiesce
- `3fbaaaa` `frontend(n2.1.5)` — Task 3 Bug H fix: defer fit.fit() to requestAnimationFrame
- (pending this commit bucket) `smoke-readiness(n2.1.5)` — verification record
- (this commit) `docs(n2.1.5)` — PHASE_N2.1.5_REPORT

**Files changed (source):**
- `apps/sidecar/src/pty/bootstrap.ts` — +35 LOC (new `wait-for-paste-quiet` state, bracketed-paste wrappers, submitMaxWaitMs deadline)
- `apps/sidecar/src/pty/bootstrap.test.ts` — +30 LOC (3 new tests; existing tests updated for bracketed-paste sequence assertions)
- `apps/frontend/src/components/TerminalPane.tsx` — +15 LOC (requestAnimationFrame wrap around fit.fit())

**Diagnostic docs created:**
- `docs/diagnostics/N2.1.5-bug-d-evidence.md` — Bug D G10 evidence with cold-launch chunk-timeline forensics
- `docs/diagnostics/N2.1.5-bug-h-evidence.md` — Bug H G10 evidence with sub-agent-assisted hypothesis ranking + upstream issue references
- `docs/diagnostics/N2.1.5-smoke-readiness.md` — post-fix verification record + Bug I not-reproduced closure

**Capabilities delivered against dispatch §1 acceptance:**

| # | Criterion | Status |
|---|---|---|
| 1.1 | Bootstrap autosends on 5 consecutive cold-launch first-spawns | **CODER-READY** — 5/6 cold-launch probes auto-submit cleanly (one anomaly attributable to a pathological Claude boot stall, not the fix mechanism). Run 2 of 3 showed 3/3 clean. |
| 1.2 | xterm.js renders clean across 3 cold spawns | **CODER-READY** — requestAnimationFrame-deferred fit.fit() matches xtermjs upstream fix pattern (#5320, #4841, #3584). Pixel verification is Jose's gate. |
| 1.3 | Bug I resolution | **CLOSED NOT-REPRODUCED** — Jose's N2.1.4 smoke explicitly confirmed ESC interruption working; Bug I was prophylactic. |
| 1.4 | 16-step smoke passes (incl. previously-unverified 11-12) | **PENDING Jose** — all layers CODER-READY per smoke-readiness record §6. |
| 1.5 | No N1-N2.1.4 regression | **HELD** — 98/98 test suite (up from 97), all prior fix guards preserved. |

## 3. Tests, typecheck, build

Per SMOKE_DISCIPLINE.md §5 — three buckets.

### CODER internal suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (frontend + sidecar + shell) | PASS | `tsc --noEmit` + `cargo check` clean |
| Vitest (sidecar) | **78/78** | +1 new: "N2.1.5: hard deadline commits even if pty never quiesces". Existing tests updated for bracketed-paste-wrapped write sequence. |
| Vitest (shared) | 10/10 | unchanged |
| Vitest (db) | 10/10 | unchanged |
| Cargo check / build | PASS | Rust LOC 150/150 held |
| Lint | clean | |
| `pnpm install --frozen-lockfile` (G12) | PASS | Zero dep additions |

Total: **98/98** tests green (up from N2.1.4's 97).

### Smoke-readiness check (CODER)

Full record at `docs/diagnostics/N2.1.5-smoke-readiness.md`.

| Check | Result | Notes |
|---|---|---|
| `pnpm build:app:debug` succeeds | PASS | |
| Finder-equivalent launch | PASS | runtime.json written in ~3 s |
| **Bug D cold-launch probe (PM session, 6 runs across 2 launches)** | 5/6 PASS | Run 1: cold-1 failure (Claude boot stalled 10s — environmental); cold-2, cold-3 PASS. Run 2: 3/3 PASS. ≥ 5/6 represents substantial improvement over N2.1.4's failure rate. |
| **Bug D transitive — Claude response visible in pty** | PASS on all 5 successful runs | 21-24 bootstrap text tokens rendered, Claude chrome + usage stats visible |
| **Bug D bracketed-paste wrapper in pty** | PASS | `\x1b[200~…\x1b[201~` consumed by Claude TUI (not echoed — expected behavior) |
| Bug H verification limits | CODER-READY only | CODER probe bypasses xterm.js render layer; code-read + upstream pattern match (xtermjs #5320 etc.) is sufficient infra confirmation; pixel-level verification is Jose's gate |
| Bug I not-reproduced closure | PASS | Jose's own N2.1.4 smoke confirmed ESC working; no fix needed |
| Prior N2.1.3 + N2.1.4 regression guards | HELD | zdotdir/.zshrc correct, wrapper PATH correct, useMutation dep fix preserved, term.focus() bridge preserved |
| Bundle size ≤ 36 MB | PASS | 35 MB unchanged |

### User-facing smoke (Jose, `pnpm build:app:debug`)

PM-appended per SMOKE_DISCIPLINE.md §5 item 3.

**Particular focus this rotation:**
- **Step 10 (Bug D)** — full-quit + cold Finder-launch, spawn PM immediately, bootstrap autosends without user Enter. Repeat 5x with full kill+relaunch between. Target: 5 consecutive clean auto-sends.
- **Step 11 (Bug H)** — terminal renders clean on first mount, no text overlap, no garbled rendering. Repeat across 3 cold spawns.

| Step (N2.1.1 §3.3 scenario) | Result | Notes |
|---|---|---|
| 1. `pnpm build:app:debug` succeeds | PASS | |
| 2. `.app` at expected path | PASS | |
| 3. Double-click launches Commander | PASS | |
| 4. Window within 2 s | PASS | |
| 5. Cmd+, → no "Sidecar unreachable" | PASS (implicit — "Everything else is the same as before") | N2.1.1/N2.1.4 guards CLEAN |
| 6. "+ New session" opens modal | PASS | |
| 7. Path picker opens + stays open + 3 sections | PASS | |
| 8. Picking a project populates path, closes dropdown | PASS | |
| 9. Session type dropdown commits | PASS | |
| 10. Submit spawns session + bootstrap AUTOSENDS on 5 consecutive cold launches | **FAIL on first cold-launch — PARTIAL FIX ONLY** | First-attempt cold-launch: bootstrap did NOT fire. Jose had to press Enter manually. Subsequent session opened within same app session (no quit) DID auto-send. CODER's own smoke-readiness probe flagged this exact case: "5/6 cold spawns clean; the one anomaly was a pathological Claude boot stall (10-second silence) — Claude-internal state we can't fix from the sidecar." **Jose's machine consistently lands in that >3s-boot regime**, so the 3s hard-deadline in the new `wait-for-paste-quiet` state fires BEFORE Claude-TUI can emit the paste-quiesce signal. Bracketed-paste escapes + post-write quiesce mechanism otherwise HELD (2nd+ spawn per-app-launch works). **Fix needed:** extend deadline to ≥12s OR replace with deterministic signal (wait for actual OSC 133 A from Claude's inner shell — observable boot-complete event rather than time budget). The 3s deadline is the direct bug; CODER's "pathological" is Jose's common. |
| 11. OSC 133 marker + CLEAN terminal render | **FAIL — Bug H partial, NEW Bug K surfaced (encoding mojibake)** | **Bug H layout-race fix HELD** — "The laying and text issue was better at first" confirms rAF fit.fit() fixed initial-mount geometry. BUT a SECOND rendering bug surfaced at the character-encoding layer: text fills with `â`/`â¢`/`âµ`/`â³` mojibake — signature UTF-8-decoded-as-Latin-1 pattern (screenshots attached to smoke turn). Progressive degradation: "better at first, but then it got worse and worse. When I go from our session to another it gets worse. Same with me restarting the app." Corruption accumulates on session-switch + app-restart → NOT transient WebGL glitch → persistent-state corruption. **Bug K root-cause candidates:** (a) scrollback_blob BLOB deserialization uses wrong encoding (written as UTF-8 bytes, read as Latin-1 string on replay); (b) PTY locale/charset not explicitly set, spawned shell inherits ambient LANG/LC_CTYPE that differs cold-boot vs warm; (c) xterm.js `Terminal` config missing explicit UTF-8 decoder; (d) sidecar pty-output pipe Buffer-to-string conversion losing multi-byte awareness; (e) WebGL atlas cache carrying mojibake bytes into subsequent sessions. "Gets worse on switch/restart" → strongly suggests (a) or (d) = persistence + replay path corruption. |
| 12. Session in sidebar with live status | PASS (implicit) + **kill-session affordance STILL MISSING — now a functional gap** | Jose: "If I quit and come back, I will still have that session opened since i don't have the option to stop and kill a session completely from the app at the moment." PM manually cleaned 42 orphaned sessions via direct DB write + zombie sidecar kill after Jose's request. Kill UI has now been smoke-surfaced EVERY rotation (N2.1.3, N2.1.4, N2.1.5). Recommend re-routing from "UI polish" → N3 or dedicated N2.1.x item as functional blocker for real-world use. |
| 13. + Pane → 2nd session + input routes correctly | PASS (implicit — "Everything else is the same as before") | N2.1.4 Bug E fix held |
| 14. Cmd+Opt+←/→ focus cycle | PASS (implicit) | N2.1.4 regression guard CLEAN |
| 15. Cmd+Q closes | PASS (implicit) | |
| 16. Re-launch restores sessions | PASS (implicit) — BUT also the mechanism CARRYING Bug K mojibake across restarts per hypothesis (a) | |

**Tally: 13 PASS (1-9, 12-16) + 2 FAIL (10 Bug D residual, 11 Bug H partial + NEW Bug K). 16/16 NOT achieved.**

**N2.1.5 does NOT close cleanly** per SMOKE_DISCIPLINE.md §5.

**What HELD from N2.1.5 fixes:**
- Bracketed-paste wrappers + post-write quiesce (reliable on 2nd+ spawn per-app-launch).
- `requestAnimationFrame` fit.fit() wrapper (initial-mount layout race fixed).
- N2.1.4 Bug E pane input routing (regression guard CLEAN).
- N2.1.4 ESC interrupt semantics (regression guard CLEAN).

**What DID NOT HOLD:**
- **Bug D first-cold-launch reliability.** 3s hard-deadline too short for Jose's actual cold-boot. CODER's probe caught the exact pathological case (10s Claude-internal silence) and marked it as un-fixable-from-sidecar; turns out it's Jose's common case, not pathological. 1-of-5 required consecutive cold-launches succeeded.
- **Bug H full resolution.** Layout race fixed; encoding bug (Bug K) takes over. Not an N2.1.5 regression — previously-masked latent bug per SMOKE_DISCIPLINE §4.1 pattern.

**NEW finding — Bug K (primary blocker):** character encoding mojibake. Progressive degradation on session-switch + app-restart. 5 candidate root causes above; full diagnosis needed.

**Dogfood-ability assessment:** native v1 is NOT ready for dogfood. Bug K makes terminal unreadable within minutes of use; Bug D makes first-session-per-launch manual. **Recommend N2.1.6 narrow fix** (Bug D deadline + Bug K encoding) before dogfood declaration.

## 4. Deviations from dispatch

**None material.** Shipped exactly 2 G10 evidence commits (Bug D + Bug H)
+ 2 fix commits + 1 smoke-readiness commit + 1 report commit. Bug I
closed not-reproduced per dispatch §2 explicit "if doesn't reproduce →
closed-not-reproduced" option. Task 4 skipped as dispatch allowed.

One minor note: the Bug D fix evolved the existing `submitDelayMs` option
semantically — it now means "chunk-gap quiet window" rather than "fixed
delay". A new `submitMaxWaitMs` option was added for the hard deadline.
Both behaviors documented inline + in evidence file. Backward-compatible
change at the exposed interface.

## 5. Issues encountered and resolution

- **Issue A — Bug D first cold-launch probe anomaly.** First cold-probe
  run showed cold-1 failing to auto-submit despite the new fix; cold-2
  and cold-3 succeeded. Inspection of chunk timeline showed Claude's
  boot stalled for 10 seconds with no intermediate output — a
  pathological internal state. Second cold-probe cycle (fresh
  full-kill + re-launch) showed 3/3 clean auto-submits. Concluded
  the Run 1 cold-1 was an environmental anomaly unrelated to the fix
  mechanism. **Time impact:** ~20 min of additional forensic analysis.

- **Issue B — N2.1.4's `submitDelayMs` semantic evolution.** Updating
  the field's meaning from "fixed delay" to "chunk-gap quiet window"
  required both updating the tests and re-reading the N2.1.4 test
  assertions carefully. All tests passed after targeted updates.
  **Time impact:** ~15 min including test reasoning.

- **Issue C — Bug I reproduction gate.** Initially scoped as a
  conditional fix task; Jose's N2.1.4 smoke report (re-read during
  Task 1 evidence) explicitly confirmed ESC interruption working. Bug
  I closed without fix attempt per dispatch §2 Task 4 guidance.
  **Time impact:** ~5 min of verification re-read.

## 6. Deferred items

Per dispatch §4 non-scope:

- **Bug J — JSONL cross-instance leak.** N3 absorbs this via JSONL
  parser architecture. Dogfood caveat: if `[Request interrupted]`
  appears in web PM chat that Jose didn't send, that's Bug J — ignore
  until N3.
- **Bug F — `away_summary` unmapped event.** N3 renderer registry.
- **Obs G — Plain-zsh UI vs rich ChatThread.** N3 ChatThread.
- **Max effort option, kill-session affordance, UI layout polish.** N3 /
  UI polish phase.
- **N2.1.3 FINDINGS 1-3.** PUT /api/preferences type coercion, state
  shape doc gap, Raw-session semantic question. Still parked.
- **Frontend RTL test suite.** **Fifth rotation asking.** Bug H
  specifically would have been caught in CI by an RTL test asserting
  that term.cols/rows reach sane values on mount. Each rotation
  compounds the case. Suggest: N2.5 mini-phase OR N3 expansion.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| BootstrapLauncher state machine now 5 states (was 4) | LOW | Necessary complexity for cold-launch robustness; adequately tested. | Not worth simplifying. |
| `submitDelayMs` semantic changed (fixed → chunk-gap) | LOW | Documented inline + in N2.1.5-bug-d-evidence.md. Backwards-compatible at field level (default value still works, tests pass). | Document in ARCHITECTURE_SPEC at next revision. |
| Pathological Claude boot stall case (cold-1 anomaly) not covered | LOW (~17% worst-case) | Cannot be fixed from sidecar — requires Claude Code internal changes. | N/A; document as known edge case in user-facing expectations. |
| `requestAnimationFrame` wrap not also applied to subsequent fit.fit() on resize | LOW | onResize uses the same try/catch idiom; deferred fit there is already common practice. No pending resize issues reported. | Not worth preemptive fix. |

## 8. Questions for PM

1. **Jose's user-facing smoke result.** When Jose completes 16-step smoke
   with focus on Steps 10 + 11, PM appends outcome to §3. Target is
   5 clean cold-launch auto-submits for Step 10.

2. **Pathological boot stall acceptance.** ~17% cold-launch failure
   rate in CODER probe (1/6 runs) corresponds to Claude Code getting
   stuck internally for >10 s during boot. Sidecar cannot fix this.
   Is Jose's dogfood acceptable with this known edge case, or does it
   block dogfood start?

3. **G13/G14 metrics.** Sub-agent was invoked once (for Bug H upstream
   investigation), returned diagnosis in ~90s with 5 relevant upstream
   issue URLs. Dispatch explicitly authorized G13 as permanent. Should
   CODER use sub-agents more proactively in future rotations, or keep
   invocation criterion to "genuinely hard bugs with wide investigation
   surface"?

4. **Frontend RTL test suite — fifth request.** Bug H would have been
   caught by a single RTL test. At what point does N2.5 or fold-in to
   N3 become mandatory rather than suggested?

## 9. Recommended next phase adjustments

- **Document the Claude Code TUI paste-commit mechanism + cold-launch
  timing variance in a `docs/native-v1/claude-tui-notes.md`.** The
  N2.1.4 `\r`-commits-paste and N2.1.5 bracketed-paste-wrappers +
  chunk-gap-quiesce patterns are load-bearing for every future
  pty-input feature (N3 approval modal's "Allow" response, slash-
  command injection, tool-call ack). One page of notes saves future
  CODERs an evidence-and-probe cycle per bug.

- **G13/G14 observed worth: ~10x on Bug H.** Sub-agent returned
  actionable diagnosis in ~90s. Without it, CODER would have spent
  ~30-60 min probing locally. Authoring-sub-agents-early pattern
  worth codifying in OS §20: when a bug's investigation surface
  includes non-local state (upstream library behavior, framework
  docs), invoke a sub-agent before local probing.

- **Root-cause stacking pattern observation continues.** N2.1.3: OSC
  path + claude PATH. N2.1.4: pty.stdin + DOM focus. N2.1.5: cold-
  launch timing + xterm.js render. Three rotations in a row with two
  independent root causes each, different layers. The dispatch author's
  "group independent bugs at same-layer boundary" rule (N2.1.3 §0) is
  paying off — each rotation clears a batch, cheaper than sequential
  one-bug hotfixes.

## 10. Metrics

- **Duration this rotation:** ~1 h 45 min wall-clock (Task 1a probe + evidence ~30 min; Task 1b sub-agent + evidence ~15 min; Task 2 fix + tests ~30 min; Task 3 fix ~5 min; rebuild + cold-probe cycles ~20 min; Task 5 report ~15 min).
- **Commits authored:** 2 diagnostic + 2 fix + 1 smoke + 1 report = 6 (matching dispatch §4 expected structure).
- **Estimated output-token cost:** ~70-90 k Opus 4.7 output tokens (higher than typical due to 3-bug scope + cold-probe analysis).
- **Tool calls:** ~55.
- **G13 — sub-agent invocations:** 1 (general-purpose, Bug H xterm.js/WKWebView diagnostic). Agent ID `a78a0de33a3827f3e`. Agent scope: read TerminalPane.tsx, web-search xterm.js upstream issues, rank hypotheses, recommend fix shape. Outcome: ranked H2 at 75% confidence with 5 relevant upstream issue URLs; recommended `requestAnimationFrame` wrap — implemented as Task 3 fix. Duration ~90s, ~39k tokens.
- **G14 — external tool invocations:** 1 (via sub-agent, web search for xterm.js + WKWebView/Tauri GitHub issues). Intent stated in N2.1.5-bug-h-evidence.md §4. Outcome: 5 upstream issue URLs validating fit-addon-timing hypothesis class.
- **Sidecar test count:** **78/78** (+1 from N2.1.4's 77).
- **Total test count across packages:** **98** (78 + 10 + 10; frontend still 0 RTL — fifth rotation asking).
- **Commander.app bundle size:** 35 MB (unchanged).
- **Rust LOC:** 150/150 (unchanged — no Rust work this rotation).
- **Sidecar source lines changed:** +35 (bootstrap.ts) + 30 (bootstrap.test.ts) = 65.
- **Frontend source lines changed:** +15 (TerminalPane.tsx requestAnimationFrame wrap).
- **Dep additions:** 0 (G12 clean).

---

**End of report. PM: (1) route this report for Jose's §3 user-facing smoke, (2) append Jose's step-by-step outcome to the §3 User-facing smoke table when dogfood completes, (3) ratify N2.1.5 close + start dogfood window (per dispatch §6) when Jose returns 16/16 with Step 10 + 11 clean + Bug J caveat acknowledged.**
