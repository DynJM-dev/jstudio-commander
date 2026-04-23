# Phase Report — JStudio Commander native v1 — Phase N2.1.6 — Deterministic bootstrap + mojibake + kill-session

**Phase:** N2.1.6 — Hotfix: Bug D (cold-launch deterministic bootstrap signal) + Bug K (UTF-8 mojibake) + Task 3 (kill-session affordance)
**Started:** 2026-04-22 (continuing CODER spawn, no reset)
**Completed:** 2026-04-22 (same rotation; PENDING Jose's user-facing smoke per §3)
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=max (first use per CTO 2026-04-22 operating change)
**Status:** CODER-COMPLETE; awaiting Jose's user-facing smoke per SMOKE_DISCIPLINE.md §5

---

## 1. Dispatch recap

Fix three residual N2.1.5 issues: Bug D (first cold-launch bootstrap fails — 3 s hard deadline too short), Bug K (UTF-8 mojibake in scrollback with progressive degradation), and Task 3 (kill-session affordance — DELETE endpoint exists but incomplete, no UI). Per dispatch §0.1 PM reality-check: `\e[?2004h` from Claude's inner shell is NOT available as a signal (hook is outer-zsh-only). Bug J deferred to N3.

New guardrails G13 (sub-agent) + G14 (external tool) used for Bug K upstream audit.

## 2. What shipped

**Commits (3 diagnostic + 4 fix + 1 smoke + 1 report = 9 new):**

- `23aaf71` `diagnostic(n2.1.6)` — Bug D: OSC-title signal identification (sidecar pty-output parse layer)
- `78558ba` `diagnostic(n2.1.6)` — Bug K: UTF-8 mojibake at scrollback decode boundary (frontend scrollback decode layer)
- `68d3b7d` `sidecar(n2.1.6)` — Task 1 first attempt: OSC-count ≥ 2 signal (later superseded by hybrid)
- `76f45ae` `frontend(n2.1.6)` — Task 2 Bug K fix: Uint8Array path for scrollback
- `7f8e82c` `sidecar+frontend(n2.1.6)` — Task 3: kill-session DELETE lifecycle + 🗑 button + confirmation modal
- `057617e` `sidecar(n2.1.6)` — Task 1 correction: hybrid signal (OSC title gate + post-gate quiet period)
- (this commit bucket) smoke-readiness + PHASE_N2.1.6_REPORT

**Files changed (source):**
- `apps/sidecar/src/pty/bootstrap.ts` — +60 LOC (new state machine: OSC-title-count gate + quiet-period timer + readyTimeout fallback with onWarning callback)
- `apps/sidecar/src/pty/bootstrap.test.ts` — +85 LOC (test rewrites for hybrid signal + 3 new tests)
- `apps/sidecar/src/pty/orchestrator.ts` — +30 LOC (`deleteSession` method, `onWarning` routing to system:warning event)
- `apps/sidecar/src/routes/sessions.ts` — +15 LOC (DELETE route calls `deleteSession` when available)
- `apps/frontend/src/components/TerminalPane.tsx` — +10 LOC (Uint8Array path for scrollback restore)
- `apps/frontend/src/components/SessionPane.tsx` — +110 LOC (🗑 button + KillConfirmModal + optimistic UI)

**Diagnostic docs created:**
- `docs/diagnostics/N2.1.6-bug-d-deterministic-signal-evidence.md`
- `docs/diagnostics/N2.1.6-bug-k-mojibake-evidence.md`
- `docs/diagnostics/N2.1.6-smoke-readiness.md`

**Capabilities delivered against dispatch §1 acceptance:**

| # | Criterion | Status |
|---|---|---|
| 1.1 | Bootstrap autosends on first cold-launch, deterministic, 5+ cold spawns | **CODER-READY** — 6/6 cold spawns auto-submit cleanly across 2 full-kill + relaunch cycles. Hybrid signal holds. |
| 1.2 | No character mojibake in any session, ever | **CODER-READY** — scrollback round-trip probe verifies all mojibake-prone glyph classes (em-dash, bullet, box-drawing, Braille) recover correctly through the new Uint8Array path. Old path would produce `â` mojibake; new path matches the original string byte-for-byte. |
| 1.3 | Kill session from UI | **CODER-READY** — backend DELETE cascade verified (pty gone, DB row gone, GET 404); frontend 🗑 button + KillConfirmModal wired with optimistic UI + server reconcile + error recovery. Pixel-level modal copy/style is Jose's pass. |
| 1.4 | 16-step smoke passes | **PENDING Jose** — all layers CODER-READY per smoke-readiness record §6. |
| 1.5 | No N1-N2.1.5 regression | **HELD** — 100/100 suite (+2 new N2.1.6 tests); all prior-phase guards preserved. |

## 3. Tests, typecheck, build

Per SMOKE_DISCIPLINE.md §5 — three buckets.

### CODER internal suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (frontend + sidecar + shell) | PASS | |
| Vitest (sidecar) | **80/80** | +2 N2.1.6 net; 6 tests rewritten for hybrid signal |
| Vitest (shared) | 10/10 | |
| Vitest (db) | 10/10 | |
| Cargo check / build | PASS | Rust LOC 150/150 unchanged |
| Lint | clean | |
| `pnpm install --frozen-lockfile` (G12) | PASS | Zero dep additions |

Total: **100/100** (up from N2.1.5's 98).

### Smoke-readiness check (CODER)

Full record at `docs/diagnostics/N2.1.6-smoke-readiness.md`.

| Check | Result |
|---|---|
| `pnpm build:app:debug` succeeds | PASS |
| Finder-equivalent launch | PASS |
| **Bug D cold-launch (6 runs across 2 launches)** | **6/6 PASS** — 23-29 bootstrap-text tokens per run |
| **Bug K scrollback round-trip** | **PASS** — all special-char classes recover correctly via Uint8Array path; OLD path mojibake-signature confirmed present |
| **Task 3 DELETE lifecycle** | **PASS** — pty cleaned, DB row removed, cascades confirmed |
| Prior-phase regression guards | HELD |
| Bundle size ≤ 36 MB | PASS |

### User-facing smoke (Jose, `pnpm build:app:debug`)

PM-appended per SMOKE_DISCIPLINE.md §5 item 3.

**Focus this rotation:** Step 10 Bug D cold-launch (5 consecutive full-quit + relaunch cycles), Step 11 Bug H regression + Bug K mojibake (spawn + use special chars + switch sessions + restart app), NEW kill affordance (trash button + confirmation modal + cascade-delete).

| Step | Result | Notes |
|---|---|---|
| 1. `pnpm build:app:debug` succeeds | *[PENDING]* | |
| 2. `.app` at expected path | *[PENDING]* | |
| 3. Double-click launches | *[PENDING]* | |
| 4. Window within 2 s | *[PENDING]* | |
| 5. Cmd+, no "Sidecar unreachable" | *[PENDING]* | |
| 6. "+ New session" modal | *[PENDING]* | |
| 7. Path picker stays open | *[PENDING]* | |
| 8. Project path populates + closes | *[PENDING]* | |
| 9. Session type commits | *[PENDING]* | |
| 10. **Bootstrap autosends on 5 cold launches** | *[PENDING — PRIMARY N2.1.6 TARGET (Bug D)]* | |
| 11. **No mojibake + clean render** | *[PENDING — PRIMARY N2.1.6 TARGET (Bug K + Bug H regression)]* | |
| 12. Sidebar live status | *[PENDING]* | |
| 13. + Pane + input routing | *[PENDING]* | |
| 14. Cmd+Opt focus cycle | *[PENDING]* | |
| 15. Cmd+Q | *[PENDING]* | |
| 16. Re-launch restores sessions + scrollback clean | *[PENDING — Bug K final verification]* | |
| NEW: Kill session via 🗑 button | *[PENDING — PRIMARY N2.1.6 TARGET (Task 3)]* | |

## 4. Deviations from dispatch

1. **G11 layer-naming for Task 3**: dispatch did not require an evidence commit for Task 3 (the gap was PM-verified, not diagnosis-required). CODER shipped Task 3 directly without evidence commit. Per dispatch §2 Task 3 language ("Verify DELETE endpoint exists. If missing, add... If the endpoint exists but was incomplete, fix it to be complete") — PM had already confirmed incompleteness. Not a deviation.

2. **Task 1 first-attempt refinement**. Initial Task 2 commit (68d3b7d) used readyOscCount=2, which worked on the N2.1.5 dumps but failed on cold-probe verification because idle Claude emits only 1 OSC title (Spinner only animates during processing, not idle). Shipped corrective commit 057617e with hybrid signal (OSC title gate at count=1 + post-gate quietMs quiet-period). Verification then confirmed 6/6 cold success. Legitimate in-rotation correction per the "root-cause stacking" pattern observed across rotations — the corrective was within the same task scope, not a new dispatch. Flagged for PM ratification.

3. **`quietMs` semantics evolution within N2.1.6.** The field's meaning is now "post-OSC-gate quiet period" (different from N2.1.5's "no pty-output-since-last-chunk period"). Backward-compatible at the API (tests still pass the field). Internal semantic documented inline + in bug-d-evidence.md. Not a user-visible deviation.

4. **OSC 133 based approach explicitly refuted.** Dispatch §2 Task 1 patched section listed `\e[?2004h` from Claude as PRIMARY. Forensic scan refuted: zsh emits BP_ON at byte 19, Claude inherits mode without re-emitting. Fell back to the dispatched SECONDARY branch (boot-complete signal) but generalized to structural OSC-title variant. PM-patched option is consistent with §0.1 "NOT AVAILABLE — OSC 133 A from Claude's inner shell."

## 5. Issues encountered and resolution

- **Issue A — Initial OSC-count-≥2 signal failed on idle Claude.** My forensic N2.1.5 dumps showed 6 OSC title emissions total — but those dumps were from SUCCESSFUL previous rotations where Claude had received and rendered the bootstrap, triggering Spinner frames. On cold-probe with pure-broken baseline, Claude emits only 1 title (launch banner) then goes silent at the input line. Fix: hybrid signal (count=1 gate + quiet-period timer). Commit 057617e. **Time impact:** ~30 min (evidence → first fix → cold probe → correction → re-verify).

- **Issue B — Constants test fragility.** The `DEFAULT_QUIET_MS === 800` sanity test broke when I changed the default to 500. Updated. **Time impact:** 2 min.

- **Issue C — Process cleanup between cold-probe cycles.** Pre-existing Commander processes from prior verification cycles had to be SIGKILLed + runtime files cleared between each launch to ensure truly cold starts. Scripted into the probe workflow. **Time impact:** ~3 min per cycle.

## 6. Deferred items

- **Bug J — Cross-instance JSONL leak.** N3 Task 1.
- **Bug F — `away_summary` unmapped event.** N3 renderer registry.
- **Obs G — Plain-zsh UI.** N3 ChatThread.
- **N2.1.3 FINDING 1 — PUT /api/preferences type coercion.** Still parked. N3 hardening or mini-phase.
- **Frontend RTL test suite.** Sixth rotation asking. Bug K in particular would have been caught by a scrollback round-trip test. The cost of continuing to defer keeps compounding.
- **Pathological 10 s Claude boot stall.** If Claude is internally stuck during boot with no output at all, the OSC title gate never opens; readyTimeoutMs=30 s fires → warn-and-proceed. This is the intended escape hatch; Jose will see a `system:warning` event emission if it ever triggers.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| BootstrapLauncher state machine now 5 states + 3 timers | LOW | Necessary complexity for deterministic cold-launch handling. Adequately tested at 80/80. | Not worth simplifying. |
| `quietMs` / `submitDelayMs` semantics changed between N2.1.5 and N2.1.6 | LOW | Documented inline + in evidence files. Tests pass. | Not user-visible. |
| KillConfirmModal has no keyboard shortcuts (Enter confirms, Esc cancels) | LOW | Minimum-viable for this dispatch. Jose's dogfood will surface if needed. | 15 min if requested. |
| useStopSession hook name retained despite new "delete" semantics | LOW | Renaming would churn imports across components. | 20 min if PM wants the rename. |

## 8. Questions for PM

1. **Jose's user-facing smoke.** PM appends 16-step outcome to §3. Steps 10 + 11 + NEW kill-affordance are the N2.1.6 acceptance gates.

2. **In-rotation corrective commit (057617e).** Task 2's first attempt (68d3b7d) was OSC-count ≥ 2, which failed on cold-probe verification. CODER shipped corrective in same rotation. Is this acceptable under the "root cause stacking" pattern, or should such corrections be dispatched as N2.1.7? My view: same scope, same file, same dispatch § — corrective is within rotation. Flagged for PM ratification.

3. **Trash button iconography.** I used 🗑 Unicode emoji for the button content. Anthropic's Claude TUI uses Braille for its spinner, so emoji in UI doesn't feel out of place, but PM/Jose may prefer lucide-react `Trash2` icon per design-language guidelines. 5-min substitution if so.

4. **Frontend RTL suite — sixth rotation asking.** Bug K would have been caught by a scrollback-blob round-trip test. Bug E by a focus-routing test. Bug H by a fit.fit() timing test. Each rotation re-raises the cost. Fold into N3, N2.5 mini-phase, or ship dogfood without it?

5. **Signal choice rationale (§4 Deviation 4).** For PM/CTO to consider: the PM-patched dispatch named `\e[?2004h` as PRIMARY; forensics refuted it and I went to SECONDARY-derived OSC-title variant. Is this an acceptable reinterpretation of the patched ordering?

## 9. Recommended next phase adjustments

- **Codify "Claude TUI ready" via hybrid-signal pattern in `docs/native-v1/claude-tui-notes.md`.** The OSC-title + quiet-period hybrid is now load-bearing for any future Claude-interaction feature (approval modal response, slash-command injection, tool-call ack). One page saves the next CODER multiple evidence-and-probe cycles.

- **Document bytes-direct xterm.write idiom in project architecture.** The `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` + `term.write(uint8array)` path is the correct xterm v5+ UTF-8 pattern. Currently inline-commented in TerminalPane.tsx; codify in `docs/native-v1/xterm-notes.md` so N3's ChatThread work inherits it.

- **BootstrapLauncher state machine size.** Now 5 states + 3 timers + 3 callback kinds. If N3 adds approval-modal paste-response or slash-command injection, the same state logic will be reused. Worth extracting a generic "WaitForTUIReadyAndInject" composable in N3.

- **Root-cause stacking pattern (4th observation).** N2.1.3 (OSC path + PATH) → N2.1.4 (pty.stdin + DOM focus) → N2.1.5 (timing + render) → N2.1.6 (signal + encoding + lifecycle). Independent root causes in every rotation. Dispatch authors benefit from expecting 2-3 layer bugs per scope, not 1. My smoke-readiness probes should cover all claimed fix layers, not just the primary.

## 10. Metrics

- **Duration this rotation:** ~2 h 30 min wall-clock.
- **Commits authored:** 9 (3 diagnostic + 4 fix + 2 smoke/report).
- **Estimated output-token cost:** ~100-130 k Opus 4.7 output tokens (highest for the rotation sequence due to multi-bug scope + cold-probe retries).
- **Tool calls:** ~90.
- **G13 — sub-agent invocations:** 2 total across N2.1.5 + N2.1.6 rotations.
  - This rotation: 1 invocation (general-purpose, Bug K xterm.js UTF-8 audit; agent `a2329880b95cfd7ff`, ~44 s, ~31 k tokens). Returned ranked validation of fix hypothesis with 9 upstream reference URLs.
- **G14 — external tool invocations:** via sub-agent. Web searches: "xterm.js serialize UTF-8 encoding", "atob mojibake fix", "term.write Uint8Array UTF-8". Intent stated in evidence §4; outcome reported with URLs.
- **Sidecar test count:** **80/80** (+2 from N2.1.5's 78).
- **Total test count across packages:** **100** (80 + 10 + 10; frontend still 0 RTL — sixth rotation asking).
- **Commander.app bundle size:** 35 MB (unchanged).
- **Rust LOC:** 150/150 (unchanged — no Rust work).
- **Sidecar source lines changed:** +90 net (bootstrap.ts +60, orchestrator.ts +30) + 85 test lines.
- **Frontend source lines changed:** +120 (SessionPane.tsx +110 kill UI, TerminalPane.tsx +10 Uint8Array).
- **Dep additions:** 0 (G12 clean).

---

**End of report. PM: (1) route for Jose's §3 user-facing smoke, (2) append step-by-step outcome to §3 table when dogfood completes, (3) ratify N2.1.6 close + start dogfood window (per dispatch §6) when Jose returns 16/16 + Bug J caveat acknowledged.**
