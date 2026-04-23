# Phase Report — JStudio Commander native v1 — Phase N2.1.4 — Bootstrap autosend + pane input routing

**Phase:** N2.1.4 — Hotfix: Bug D (bootstrap autosend) + Bug E (pane input routing)
**Started:** 2026-04-22 (continuing CODER spawn, no reset)
**Completed:** 2026-04-22 (same rotation; Jose's user-facing smoke PARTIAL — see §3)
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=xhigh continuing
**Status:** NOT CLOSED — Bug E fix HELD (confirmed pane isolation); Bug D fix PARTIALLY HELD (reliable on 2nd+ launch, intermittent fail on first cold-launch); NEW Bug H (xterm.js visual rendering artifacts) surfaced as primary blocker for clean step 11 verification. Routed to PM/CTO for N2.1.5 scope. ESC interruption regression-guard CLEAN per Jose.

---

## 1. Dispatch recap

Fix the two bugs Jose's N2.1.3 smoke surfaced above the N2.1.3 fix layer.
Bug D: bootstrap content lands in Claude's paste buffer but doesn't
auto-submit. Bug E: pane 2 keystrokes route to pane 1's xterm. Different
layers (sidecar pty.stdin vs frontend DOM focus); diagnosed separately.
Non-scope: Bug F (away_summary event) + Obs G (plain-zsh UI) → N3.

## 2. What shipped

**Commits (4 task + 1 smoke + 1 report = 6 new):**

- `3e7c1c6` `diagnostic(n2.1.4)` — Bug D evidence at pty.stdin timing/shape layer (G10)
- `281a484` `diagnostic(n2.1.4)` — Bug E evidence at frontend focus-propagation layer (G10)
- `01787cc` `sidecar(n2.1.4)` — Task 2 Bug D fix: \r commits bootstrap paste
- `9c5bd77` `frontend(n2.1.4)` — Task 4 Bug E fix: bridge focusedIndex into xterm DOM focus
- `d91b139` `smoke-readiness(n2.1.4)` — Tasks 2+4 verified, 97/97 suite green
- (this commit) `docs(n2.1.4)` — PHASE_N2.1.4_REPORT

**Files changed (source):**
- `apps/sidecar/src/pty/bootstrap.ts` — +17 LOC (submit delay field, `\r` write, cancel-safe timer)
- `apps/sidecar/src/pty/bootstrap.test.ts` — +51 LOC (2 new tests + updates to 2 existing)
- `apps/frontend/src/components/SessionPane.tsx` — +1 LOC (threads `focused` prop)
- `apps/frontend/src/components/TerminalPane.tsx` — +21 LOC (focused prop + useEffect focus bridge)

**Diagnostic docs created:**
- `docs/diagnostics/N2.1.4-bootstrap-autosend-evidence.md` — Bug D G10 evidence
- `docs/diagnostics/N2.1.4-pane-input-routing-evidence.md` — Bug E G10 evidence
- `docs/diagnostics/N2.1.4-smoke-readiness.md` — post-fix verification record

**Capabilities delivered against dispatch §1 acceptance:**

| # | Criterion | Status |
|---|---|---|
| 1.1 | Bootstrap autosends on all PM + Coder spawns | **CODER-READY** — probe proves sidecar's own `\r` byte (no manual input) commits the paste; PM/Coder pty output +23kB vs baseline; Raw unchanged (plan.kind=skip). Jose's pixel-level UI click-through is the user-facing gate per SMOKE_DISCIPLINE §3.4. |
| 1.2 | Per-pane input routing correct | **CODER-READY** — code-read confirms the missing `term.focus()` call is now wired; xterm.js idempotency and prop threading are idiomatic. CODER cannot click panes; Jose-smoke is the verification. |
| 1.3 | N2.1.3 §3.3 16-step smoke passes (incl. 11, 12) | **PENDING Jose** — all 16 steps CODER-READY per §3 smoke-readiness record. |
| 1.4 | No N1/N2/N2.1.1/N2.1.2/N2.1.3 regression | **HELD** — 97/97 test suite (up from 95 — added 2 bootstrap tests), prior fix guards preserved, no touch to touched-by-prior-fix files. |

## 3. Tests, typecheck, build

Per SMOKE_DISCIPLINE.md §5 — three buckets.

### CODER internal suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (frontend + sidecar + shell) | PASS | `tsc --noEmit` + `cargo check` clean |
| Vitest (sidecar) | **77/77** | +2 new tests for Bug D (submit timer + cancel abort); existing 2 tests updated to assert new `\r` write |
| Vitest (shared) | 10/10 | unchanged |
| Vitest (db) | 10/10 | unchanged |
| Rust cargo check / build | PASS | Unchanged — Rust LOC 150/150 from N2.1.3 |
| Lint | clean | |
| `pnpm install --frozen-lockfile` (G12) | PASS | Zero dep additions — both fixes use existing stdlib/platform API |

Total: **97 / 97** tests green (up from N2.1.3's 95).

### Smoke-readiness check (CODER)

Full record at `docs/diagnostics/N2.1.4-smoke-readiness.md`.

| Check | Result | Notes |
|---|---|---|
| `pnpm build:app:debug` succeeds | PASS | |
| Finder-equivalent launch + sidecar up | PASS | `runtime.json` written in 3 s |
| Tauri PathResolver + wrapper PATH env (N2.1.3 chain) | HELD | env vars + PATH still reach sidecar |
| **Bug D production verification (PM session)** | PASS | 26 405 bytes pty output, 15 bootstrap text tokens, 0 stuck paste placeholders, Claude response fully visible — NO manual `\r` sent, sidecar commits the paste itself |
| **Bug D production verification (Coder session)** | PASS | 33 286 bytes, 24 bootstrap tokens, autosubmit holds |
| **Bug D production verification (Raw session)** | PASS (N/A) | 2 051 bytes, no bootstrap/no submit (plan.kind=skip) — correct behavior |
| Bug E code-read | PASS | `grep term.focus` → exactly 1 hit (TerminalPane new useEffect); previously 0 hits |
| Bundle size ≤ 36 MB | PASS | Unchanged |

### User-facing smoke (Jose, `pnpm build:app:debug`)

PM-appended per SMOKE_DISCIPLINE.md §5 item 3.

**Particular focus this rotation:**
- Step 10: Bootstrap MUST autosend. First typed keystroke is a fresh message, not concatenated with bootstrap.
- Step 13: Click pane 2; type. Keystrokes route to pane 2's terminal only.
- Step 14: Cmd+Opt+←/→ routes keystrokes (not just moves focus border).

| Step (N2.1.1 §3.3 scenario) | Result | Notes |
|---|---|---|
| 1. `pnpm build:app:debug` succeeds | PASS | |
| 2. `.app` at expected path | PASS | |
| 3. Double-click launches Commander | PASS | |
| 4. Window within 2 s | PASS | |
| 5. Cmd+, → no "Sidecar unreachable" | PASS | Preferences modal opens cleanly. N2.1.1 regression guard CLEAN. |
| 6. "+ New session" opens modal | PASS | macOS TCC folder-permission prompt appeared (expected, standard macOS unsigned-app behavior for `~/Desktop/Projects/`). |
| 7. Path picker opens + stays open + 3 sections | PASS | All 3 fields functional. **Side note (N3 or UI polish):** add "Max" effort option to the effort selector dropdown — currently only Low/Medium/High/xhigh surface. |
| 8. Picking a project populates path, closes dropdown | PASS | N2.1.2 modal-selection-commit fix HELD. |
| 9. Session type dropdown selection commits | PASS | N2.1.2 regression guard CLEAN. |
| 10. Submit spawns session + bootstrap AUTOSENDS | **PARTIAL — INTERMITTENT** | First attempt: Submit spawned the session but bootstrap did NOT auto-send. Jose typed "HI" and Claude received `<bootstrap text>HI` concatenated — same symptom class as N2.1.3 Bug D. Jose restarted Commander.app; on subsequent cold launches bootstrap DOES auto-send correctly ("bootstrap is actually working for now"). **Diagnosis hypothesis:** timing race on first OSC 133 A detection after cold boot OR state carry-over from pre-restart runtime. Bug D fix (\r commit write) is mechanically in place (6 CODER commits verify), but the ~200ms `onQuiet` scheduling may be racing with first-ever Claude-TUI paste-buffer-ready signal. Reproduction is intermittent: second launch onward is clean. |
| 11. OSC 133 marker on first prompt | **PARTIAL — NEW BUG H (terminal visual rendering artifacts)** | Terminal renders with visual glitches: text overlaps, line breaks in wrong positions, garbled content. "The entire terminal looks bugged, I know it's a text content thing, it kinda gets fixed when I write on it." Jose attached screenshots showing clear xterm.js rendering artifacts. OSC 133 marker fire status CANNOT be cleanly observed under these rendering conditions — the visual layer is confounded. Typical root causes: xterm.js WebGL addon Retina/DPR mismatch, initial-mount dimensions race, fit-addon resize-observer timing, CSS `line-height` vs WebGL cell metric mismatch. Bug H is the blocker for step 11's clean verification. |
| 12. Session in sidebar with live status | PASS | Sidebar shows "active" state correctly. **Side note (defer):** no UI affordance to kill / delete sessions from the sidebar. Needs "X" / "kill" / "delete" button per session row. Route to N3 or UI polish. |
| 13. + Pane → 2nd session + input routes correctly | PASS — **BUG E FIX HELD** | Jose opened PM session in Pane 2: bootstrap auto-sent (better than Pane 1's cold-launch behavior — supports timing-race hypothesis for Bug D). Opened 3rd pane with Coder: bootstrap also auto-sent. Cross-pane input isolation CONFIRMED: "What I write in one pane is not leaking outside the program or other panes." N2.1.4 Task 4 focus-bridge fix (new `useEffect` calling `term.focus()` on `focused` prop change) HELD. N2 §1.4 per-pane isolation acceptance restored. Terminals remain visually bugged per Bug H. |
| 14. Split view + Cmd+Opt+←/→ focus cycle | PASS | "CMD Option lets me cycle between panes." Keystrokes route to newly-focused pane per Bug E fix. |
| 15. Cmd+Q closes | PASS (implicit — "Everything else is fine") | |
| 16. Re-launch restores sessions | PASS (implicit — Jose restarted Commander during smoke, sessions restored correctly) | |

**Jose also explicitly verified (off-script but valuable):**
- **ESC interruption works.** Regression guard CLEAN for interrupt semantics — this was a web-Commander bug class historically.

**Additional smoke-time observations:**

- **Bug H (NEW — primary blocker):** xterm.js visual rendering artifacts on initial terminal mount. Self-repairs on user input (buffer redraw triggered by keystroke). Likely xterm.js WebGL-addon + fit-addon initialization race in the WKWebView. See §6 routing.
- **Bug D (STILL PARTIAL):** bootstrap autosend fix LANDED (mechanical verification: 6 commits, `\r` write scheduled at `onQuiet`, 97/97 tests green), but reproducible INTERMITTENT failure on first post-cold-launch spawn. Subsequent launches clean. Fix is ~90% there; first-launch race needs a second look.
- **UI polish gaps (Jose-noted, not blockers):** add Max effort option (step 7), add kill/delete session affordance (step 12), overall UI layout "looks awful visually" — EXPECTED N3 / dedicated UI polish phase; Jose explicitly acknowledged "I know we'll work on it but we need to keep moving."
- **N2.1.3 FINDINGS status (from Task 4 exhaustive sweep):** none surfaced as blockers during this smoke. PUT /api/preferences type coercion bug, Raw-session auto-launches-claude design Q, persona-ack visibility TBD — all remain parked per prior routing.

**Tally: 11 PASS (1-9, 14-15, 16) + 1 PASS-with-sidenote (12) + 1 PASS (13 = Bug E fix HELD) + 1 PARTIAL-intermittent (10 = Bug D partially held) + 1 PARTIAL-blocked-by-H (11). 16/16 NOT achieved.**

**N2.1.4 does NOT close cleanly** per SMOKE_DISCIPLINE.md §5 — but this is much closer than N2.1.3. Bug E confirmed fixed. Bug D partially fixed (reliably works on 2nd+ launch, fails first). New Bug H (xterm.js rendering) is the primary blocker.

**Jose's escalation input (important):** explicitly authorized broader tooling use going forward — "If we need to spawn more agents to debug, try things out or do anything else we can do it. As well as external tools if needed." Standing-authorization expansion. Should inform N2.1.5 scope + CODER authorization.

## 4. Deviations from dispatch

**None.** Shipped exactly 2 diagnostic commits + 2 fix commits + 1
smoke-readiness commit + 1 report commit per dispatch §4 ("two separate
diagnostic commits, two separate fix commits"). Dispatch §0's "D and E
are different layers" assumption held — independent root causes,
independent fixes, independent files, independent test surfaces.

One minor deviation note: hypothesis mapping in both evidence files went
beyond the dispatched H1-H4 / H1-H3 options — the Bug D mechanism turned
out to be Claude Code TUI's paste-vs-typed distinction (closest to H4 but
not exactly `\r\n` vs `\n`). Evidence file calls this out in §4. Fix
shape still falls within dispatch §2 Task 2 guidance ("if H4: normalize
line endings"). Not a scope deviation; mechanism-identification refinement.

## 5. Issues encountered and resolution

- **Issue A — Multiple pre-existing Commander processes alive from Jose's
  prior smoke run.** First launch hit single-instance guard + stale
  runtime.json. **Resolution:** `pkill -9 -f "jstudio-commander-shell|…"`
  + clear runtime files. Same as N2.1.3. **Time impact:** ~3 min.

- **Issue B — Two Claude TUI paste-placeholder counts in the "fix-held"
  probe.** Raw count of 0 for PM but 4 for Coder was initially confusing.
  Turned out the 4 placeholders in Coder's stream are Claude's own OUTPUT
  referencing the earlier paste ("[Pasted text #1 +15 lines]" appearing
  inside Claude's persona-acknowledgment response), not new stuck pastes.
  Baseline pre-fix had placeholders in the input line (unsubmitted);
  post-fix placeholders appear in Claude's rendered response (submitted
  and acknowledged). Semantics different; verification stands. **Time
  impact:** ~5 min of raw-stream re-reading.

## 6. Deferred items

Per dispatch §3 non-scope, explicitly NOT fixed this rotation:

- **Bug F — `away_summary` unmapped system event.** → N3 renderer registry.
- **Obs G — Plain-zsh vs rich chat UI.** → N3 ChatThread + renderer registry.
  By design for N2.1.x per ARCHITECTURE_SPEC §11.
- **N2.1.3 FINDINGS 1, 2, 3 still open.** PUT /api/preferences type
  coercion, session:state shape doc gap, Raw-session auto-launches-claude
  design question. Routed to N3 or hardening mini-phase per N2.1.3 §8.
- **Frontend RTL test suite.** Fourth rotation asking. Bug E specifically
  would have been caught in CI by an RTL test asserting that pane-click →
  term.focus() is called. Each rotation compounds the case. **Suggested:**
  N2.5 mini-phase OR N3 scope expansion.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| Submit delay hardcoded to 200 ms default | LOW | Probe proved "any gap works"; 200 ms is conservative. Could be derived from quiet-period or adaptive, but not worth extra complexity. | Not worth fixing; override via `submitDelayMs` option exists for tests/future tuning. |
| `term.focus()` side effect on `focused` flip to true ONLY | LOW | We don't track DOM focus going the other way (focus being stolen by some other element). If a future feature (modal, input, overlay) causes DOM focus elsewhere and the pane is still logically focused, clicking again will re-focus — acceptable. | Not worth fixing; edge case. |

No new runtime/framework deps; no architectural changes.

## 8. Questions for PM

1. **Jose's user-facing smoke result.** When Jose completes 16-step smoke,
   PM appends pass/fail to §3 table. Steps 10, 13, 14 are the N2.1.4
   verification gates. If 16/16 pass: N2.1.4 closes, dogfood window
   starts. If any step fails: narrow N2.1.5 OR escalate.

2. **Dispatch §6 conditional close.** Dispatch says "if 16/16 AND no new
   critical bugs from N2.1.3 Task 4 sweep: dogfood starts." N2.1.3 Task 4
   surfaced 5 FINDINGS (none CRITICAL). Is PM ready to start dogfood
   window at N2.1.4 close contingent on a clean smoke, or are any of
   those 5 FINDINGS blocking now?

3. **Frontend RTL test suite.** Fourth rotation asking. Bug E would have
   been caught by a single RTL test. Each rotation re-raises the cost.
   Suggest N2.5 before N3 or fold into N3?

## 9. Recommended next phase adjustments

- **Document the Claude Code TUI paste-vs-typed mechanism in
  ARCHITECTURE_SPEC or a `docs/native-v1/claude-tui-notes.md`.** Future
  pty-input features (e.g., N3 approval-modal "Allow" sending a response
  back to claude, slash-command injection, tool-call ack) will need the
  same `\r`-commits-paste knowledge. One paragraph saves the next CODER
  an evidence cycle.

- **Bug E is the first frontend focus-management issue this codebase has
  hit.** Expect more as N3 adds ChatThread + approval modal + renderer
  components — those will fight over DOM focus vs xterm's textarea. A
  centralized focus coordinator (e.g., `useFocusedSession()` hook calling
  `term.focus()` + also restoring focus after modal close) would prevent
  regressions. Mentioning here so N3 dispatch can include it explicitly.

- **Root-cause stacking pattern continues.** N2.1.3 had 2 layers (OSC
  path + claude PATH). N2.1.4 has 2 separate layers (sidecar pty.stdin
  + frontend DOM focus). Dispatch §0 correctly recognized both as
  independent. The "run exhaustive smoke early, fix all in one rotation"
  discipline from N2.1.3 §0 was honored by dispatch-authoring this time
  (2 bugs specified + scoped together) — worth codifying as the "group
  independent bugs at same-layer / same-file boundary" rule.

## 10. Metrics

- **Duration this rotation:** ~1 h 20 min wall-clock (Task 1 probe + evidence ~25 min; Task 2 fix + tests ~15 min; Task 3 evidence ~10 min; Task 4 fix + typecheck ~10 min; Task 3-verify rebuild + probe ~10 min; Task 5 report ~10 min).
- **Commits authored:** 4 task + 1 smoke + 1 report = 6 (above dispatch §4 minimum of 4).
- **Estimated output-token cost:** ~45-60 k Opus 4.7 output tokens.
- **Tool calls:** ~50.
- **Sidecar test count:** **77/77** (+2 from N2.1.3's 75).
- **Total test count across packages:** **97** (77 + 10 + 10; frontend still 0 RTL).
- **Commander.app bundle size:** 35 MB (unchanged).
- **Rust LOC:** 150/150 (unchanged — no Rust work this rotation).
- **Sidecar source lines changed:** +17 (bootstrap.ts) + 51 (bootstrap.test.ts) = 68.
- **Frontend source lines changed:** +22 (TerminalPane.tsx + SessionPane.tsx combined).
- **Dep additions:** 0 (G12 clean).

---

**End of report. PM: (1) route this report for Jose's §3 user-facing smoke, (2) append Jose's step-by-step outcome to the §3 User-facing smoke table when dogfood completes, (3) ratify N2.1.4 close + start dogfood window (per dispatch §6) when Jose returns 16/16 + N2.1.3 FINDINGS not raised as blockers.**
