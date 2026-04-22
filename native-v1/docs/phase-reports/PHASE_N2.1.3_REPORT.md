# Phase Report — JStudio Commander native v1 — Phase N2.1.3 — OSC path + exhaustive smoke

**Phase:** N2.1.3 — Pre-N3 hotfix: OSC 133 hook path resolution + accumulated-debt exhaustive production smoke
**Started:** 2026-04-22 (continuing CODER spawn, no reset)
**Completed:** 2026-04-22 (same rotation; Jose's user-facing smoke PARTIAL — see §3)
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=xhigh continuing
**Status:** NOT CLOSED — Jose's user-facing smoke returned 11 PASS + 1 PASS-with-BUG + 1 PARTIAL + 2 UNVERIFIED (see §3). Primary N2.1.3 fixes (OSC path + claude PATH) HELD; new bugs above that layer (bootstrap autosend + 2nd-pane input routing) require N2.1.4 scope decision. Routed to PM/CTO.

---

## 1. Dispatch recap

Fix OSC 133 hook path resolution in production `.app` (PM-localized via
direct `ls` of bundle: hook at top-level `Contents/Resources/resources/`
but sidecar sources `Contents/Resources/sidecar/resources/` — one segment
too deep). Per dispatch §3 Tasks 1-5 + §1 acceptance criteria + §4 Task 4
belated N1-close exhaustive cold-path survey.

Two root causes surfaced, both fixed this rotation. Full production-bundle
cold-path survey executed with 5 findings banked for future scoping (no
fixes applied per Task 4 soft guardrail).

## 2. What shipped

**Commits (6 task + 1 report = 7 new):**

- `1738bbd` `diagnostic(n2.1.3)` — OSC hook path mismatch at bundle-resource-path layer (G10 evidence)
- `9094408` `shell(n2.1.3)` — Task 2 Option A: export Tauri-resolved resource paths to sidecar env
- `06ccc60` `diagnostic(n2.1.3)` — second root cause: claude binary unresolved on zsh PATH (G10 evidence)
- `d3cdfd8` `shell+build(n2.1.3)` — Task 2 second fix: wrapper PATH augmentation (shell-exec env layer)
- `80ab6d0` `smoke-readiness(n2.1.3)` — Task 3: all 3 session types boot Claude from Finder-launched .app
- `40d5d3a` `survey(n2.1.3)` — Task 4: exhaustive production cold-path sweep (SURVEY ONLY)
- (this commit) `docs(n2.1.3)` — PHASE_N2.1.3_REPORT

**Files changed:** 5 diagnostic docs created + 2 source files modified.

**Source files modified:**
- `apps/shell/src-tauri/src/lib.rs` — +12 LOC (Rust resource-path env export). File now 150/150 LOC (at budget).
- `scripts/prepare-sidecar.sh` — +34 LOC (wrapper PATH augmentation for claude/node/brew).

**Diagnostic docs created:**
- `docs/diagnostics/N2.1.3-osc-path-evidence.md` — Task 1 evidence (G10)
- `docs/diagnostics/N2.1.3-claude-path-evidence.md` — Task 3 second-root-cause evidence (G10)
- `docs/diagnostics/N2.1.3-smoke-readiness.md` — Task 3 record
- `docs/diagnostics/N2.1.3-exhaustive-survey.md` — Task 4 37-item cold-path survey

**Capabilities delivered against dispatch §1 acceptance:**

| # | Criterion | Status |
|---|---|---|
| 1.1 | OSC 133 hook loads correctly in prod build | **CODER-READY** — generated zdotdir/.zshrc now sources correct `Contents/Resources/resources/osc133-hook.sh` (was `.../sidecar/resources/...` one segment too deep). Verified via cat of live-generated file after Finder-equivalent launch. |
| 1.2 | Claude Code boots in all 3 session types | **CODER-READY** — deep probe of PM session shows Claude Code TUI rendering (`Opus 4.7 \| ctx — \| $0.00`, `/effort`, `⏵⏵ auto mode on`) and bootstrap content injection (`[Pasted text #1..#12]`); all 3 types probed, zero `command not found` observed. Jose's pixel-level click-through is the user-facing gate per SMOKE_DISCIPLINE §3.4. |
| 1.3 | Full N2.1.1 §3.3 16-step smoke passes | **PENDING Jose** — infrastructure-readiness audited in §3 smoke-readiness bucket; all 16 steps' backing layers green. |
| 1.4 | Exhaustive Task 4 sweep surfaces remaining latent bugs | **COMPLETE** — 5 findings captured, routed to §4/§5/§7/§8 below. |
| 1.5 | No N1 / N2 / N2.1 / N2.1.1 / N2.1.2 regression | **HELD** — suite 95/95 unchanged; sidecar CORS/CSP + picker monotonic onClick + modal-selection-commit all preserved. |

## 3. Tests, typecheck, build

Per SMOKE_DISCIPLINE.md §5 — three buckets. CODER fills first two; PM appends Jose's user-facing smoke after dogfood.

### CODER internal suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (frontend + sidecar + shell) | PASS | `tsc --noEmit` + `cargo check` clean |
| Vitest (sidecar) | 75/75 PASS | Unchanged vs N2.1.2 — no new sidecar surface in N2.1.3 |
| Vitest (shared) | 10/10 PASS | unchanged |
| Vitest (db) | 10/10 PASS | unchanged |
| `cargo check` / `cargo build --release` | PASS | Rust LOC 150 / 150 **(at budget exactly)** — +12 LOC from Task 2 |
| Lint | clean | typecheck-as-lint per package.json |
| `pnpm install --frozen-lockfile` (G12) | PASS | No dep drift — Task 2 Rust fix uses stock tauri::Manager (already imported); wrapper PATH fix is bash-only |

### Smoke-readiness check (CODER)

Per SMOKE_DISCIPLINE.md §5 item 2 + dispatch §3 Task 3. Full record at
`docs/diagnostics/N2.1.3-smoke-readiness.md`.

| Check | Result | Notes |
|---|---|---|
| `pnpm build:app:debug` succeeds | PASS | Commander.app + Commander_0.1.0_aarch64.dmg produced |
| `.app` bundle at expected path | PASS | 150 LOC Rust shell held; `Contents/Resources/resources/osc133-hook.sh` present |
| Finder-equivalent launch produces full process tree | PASS | `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$HOME ...` → jstudio-commander-shell + `/usr/local/bin/node .../sidecar/dist/index.js`; `runtime.json` written with `{port:11002, pid:…}` within 2-3 s |
| Tauri PathResolver env reaches sidecar | PASS | `ps -Eww` shows `JSTUDIO_OSC133_HOOK_PATH=.../Contents/Resources/resources/osc133-hook.sh` + `JSTUDIO_RESOURCE_DIR=.../Contents/Resources` on sidecar env |
| Wrapper PATH augmentation reaches sidecar | PASS | `PATH=/usr/local/bin:$HOME/.nvm/versions/node/v22.17.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` — NVM bin (where `claude` lives) now on PATH |
| Generated zdotdir/.zshrc sources correct hook | PASS | `source '.../Contents/Resources/resources/osc133-hook.sh'` (no `sidecar/` segment) |
| All 3 session types boot Claude + inject bootstrap | PASS | PM + Coder deep-probe show TUI + bootstrap tokens; Raw auto-launches claude too (see FINDING 3) — zero `command not found` in any type |
| WS resilience: kill sidecar → Rust respawn | PASS | SIGKILL to sidecar pid → respawn within ~2 s, new /api/health 200 |
| N2.1.1 CSP/CORS regression guard | HELD | 9 webview requests observed 200/204/404-for-unset-pref — no CSP/CORS errors |
| N2.1.1 picker auto-close guard | UNCHANGED | `onClick={() => setOpen(true)}` monotonic pattern preserved verbatim — no touch |
| N2.1.2 modal-selection-commit guard | UNCHANGED | NewSessionModal.tsx useEffect dep fix preserved verbatim — no touch |
| Bundle size ≤ 36 MB | PASS | 35 MB (unchanged) |

### User-facing smoke (Jose, 2026-04-22, `pnpm build:app:debug`)

PM-appended per SMOKE_DISCIPLINE.md §5 item 3.

**Instructions:** Jose runs the N2.1.1 §3.3 16-step user-facing smoke
(same as N2.1.2). Particular focus on:
- Step 10: Submit spawns session, Pane 1 terminal renders, **Claude Code actually boots and responds**.
- Step 11: OSC 133 marker fires (visible via terminal prompt evolution).
- Step 12: Session in sidebar with live status tracking command duration.
- Steps 10-16 overall: end-to-end flow through prod build.

| Step (N2.1.1 §3.3 scenario) | Result | Notes |
|---|---|---|
| 1. `pnpm build:app:debug` succeeds | PASS | "Lauch steps, all pass all good" |
| 2. `.app` at expected path | PASS | |
| 3. Double-click launches Commander | PASS | |
| 4. Window within 2 s | PASS | |
| 5. Cmd+, → no "Sidecar unreachable" | PASS (implicit) | Covered by Jose's "pick everything correctly" — no banner reported; webview-fetch layer holds. N2.1.1 regression guard CLEAN. |
| 6. "+ New session" opens modal | PASS | |
| 7. Path picker opens + stays open + 3 sections visible | PASS | N2.1.1 monotonic setOpen fix HELD. |
| 8. Picking a project populates path, closes dropdown | PASS | N2.1.2 useEffect dep fix HELD. |
| 9. Session type dropdown selection commits | PASS | N2.1.2 modal-selection-commit fix HELD. |
| 10. Submit spawns session, Claude boots + renders | **PARTIAL — NEW BUG: bootstrap does not auto-send** | Session spawns; Pane 1 terminal renders; bootstrap content appears in the terminal input line. BUT the first prompt is NOT auto-submitted. Jose had to press Enter manually, and the bootstrap content was bundled WITH his own first-typed input ("hello"). So Claude received `<bootstrap text>hello` as one composite prompt rather than `<bootstrap text>` auto-sent first and `hello` following as a user turn. OSC 133 hook-path fix + claude-PATH fix both HELD (Claude did reach stdin), but the auto-submit mechanism regressed / never landed. See Issue D. |
| 11. OSC 133 marker on first prompt | UNVERIFIED | Not directly observable due to the step 10 bootstrap-autosend confound. CODER smoke-readiness probe saw OSC sequences on the probe harness's own zsh; under user-facing smoke the first prompt was mis-composited. Re-verify after N2.1.4 autosend fix. |
| 12. Session in sidebar with live status | UNVERIFIED | Not explicitly reported in Jose's smoke relay. Neither flagged as broken nor flagged as working; treat as unverified pending next smoke. |
| 13. + Pane → 2nd session | **PASS-with-BUG** | Second pane opens successfully. BUG E: in the second pane, the typed prompt appears in the on-window chat textbox (awaiting manual Enter) instead of routing to the terminal. Same class of bug as step 10's autosend regression — bootstrap / first-prompt routing inconsistent. |
| 14. Split view + Cmd+Opt+←/→ focus cycle | PASS | "Cmd option arrwos works" |
| 15. Cmd+Q closes | PASS | "Quit and relaunch work" |
| 16. Re-launch restores sessions + scrollback + Recent | PASS | "Quit and relaunch work" |

**Additional smoke-time observations (not in 16-step ledger):**

- **Observation F — `unmapped system subtype: away_summary` warning.** Surfaced during the smoke in the devtools console (or terminal/chat stream — Jose's report does not specify surface). `away_summary` is not in the current `SYSTEM_EVENT_REGISTRY` keys. Likely an upstream Claude Code transcript event type that the renderer doesn't yet recognize. HARMLESS for this phase (warning, not a crash), but surfaces a gap in N3's renderer-registry coverage. Route to N3 scope as a known-unmapped-event item.

- **Observation G — Terminal UX is plain zsh, not the rich chat UI.** Jose: "I just see the terminal as normal terminal, not the UI interface that we are managing in our current Command Center via browser". **EXPECTED — N3 SCOPE.** The JSONL-parsed renderer registry (ChatThread, approval modal, tool-call cards) is N3's primary deliverable. Native v1 by design up through N2.1.x ships xterm.js direct-attach only; the rich UI layer arrives in N3 per ARCHITECTURE_SPEC.md §11. Not a bug. Jose's note captured here for CTO's context as a reminder of what N3 ships.

**Tally: 11 PASS (1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16) + 1 PASS-with-BUG (13) + 1 PARTIAL (10) + 2 UNVERIFIED (11, 12). 16/16 NOT achieved.**

**N2.1.3 does NOT close** per SMOKE_DISCIPLINE.md §5 (user-facing smoke is phase-close gate; PARTIAL + BUG + UNVERIFIED is not close).

**Primary load-bearing fixes (N2.1.3 scope) HELD:**

- OSC 133 hook path resolution — FIXED. Hook file now resolves at the correct `Contents/Resources/resources/osc133-hook.sh` location; no more `no such file or directory` in the sidecar log.
- `claude` binary on Finder-inherited PATH — FIXED. Wrapper prepare-sidecar.sh augments PATH with common Node-manager bin dirs; `command not found: claude` class eliminated.

The surviving gap is **above** those two fixes, at the bootstrap-autosubmit / first-prompt-routing layer. Pattern-identical to SMOKE_DISCIPLINE.md §4.1: each upstream load-bearing fix surfaces the next latent layer.

**New findings requiring N2.1.4 (or PM/CTO scope call):**

- **Bug D (PRIMARY):** Bootstrap content is injected into the terminal input line but not auto-submitted. User's first typed input concatenates with the pending bootstrap text under a single Enter keystroke. Expected behavior: bootstrap sends on OSC 133 A (first-prompt ready) WITHOUT user interaction; user's subsequent input is a separate turn.
- **Bug E:** Second-pane input routes to the on-window chat textbox instead of terminal. Same class as D (input-routing regression).
- **Bug F:** `away_summary` system event unmapped — ROUTE TO N3 registry coverage, not N2.1.4.

## 4. Deviations from dispatch

1. **Two diagnostic evidence commits instead of one.** Dispatch §3 Task 1
   anticipated a single G10 evidence commit before Task 2. Task 3's
   smoke-readiness probe surfaced a SECOND root cause (`claude` binary
   not on Finder-inherited PATH) layered behind the OSC path fix — same
   user-observable symptom as Jose's PHASE_N2.1.2 step 10 failure. Rather
   than punt to N2.1.4 and extend the hotfix chain dispatch §0 calls out
   as costly, CODER filed a second G10 evidence + second Task 2 fix
   in-rotation. Full justification in
   `docs/diagnostics/N2.1.3-claude-path-evidence.md §4`. Both fixes
   together clear §1.2 acceptance; either alone fails. PM/CTO: if the
   in-scope expansion is rejected, revert to d3cdfd8 (wrapper PATH) and
   ship N2.1.4 instead — flagged per G4 deviation discipline.

2. **Task 4 deliberately under-exercised a few items that required UI
   clicks.** 30 items ended up in the "CODER-READY" bucket rather than
   PASS because their full verification path routes through webview
   rendering or keyboard input that CODER can't drive headlessly. All
   items' backing API endpoints were probed directly when possible; the
   remaining are pure frontend behaviors covered by code-read. No
   frontend RTL test suite exists (N2 deferred, still deferred), which is
   the structural gap making Task 4 depend on Jose's smoke more than
   dispatch §0 ideally wanted.

3. **Bundled resource layout choice: Option A over Option B.** Dispatch
   §3 Task 2 named both as acceptable; Option A preferred. CODER went
   with Option A as recommended — Rust-owned PathResolver exports resource
   paths to sidecar via env. Rationale and implementation in commit
   9094408. No material deviation; flagged for clarity.

## 5. Issues encountered and resolution

- **Issue A — Single instance guard + stale processes.** First launch
  attempt hit Tauri `tauri_plugin_single_instance` focus-and-exit because
  a pre-existing Commander from an earlier session was still alive. Had
  to `kill -9` the prior PIDs + clear `~/.jstudio-commander-v1/` runtime
  state before relaunch could proceed. **Resolution:** scripted kill +
  state-clear before each smoke cycle. Not a bug, not new — standard
  dev-hygiene. **Time impact:** ~5 min.

- **Issue B — TanStack Query-style probe-filter mismatch.** Initial smoke
  probe filtered `ev.transition` / `ev.status` on session:state events
  that actually use nested `ev.state.kind` per packages/shared schema.
  Produced `undefined` spam in probe logs before I restructured. Real
  infra was fine — probe harness design. **Resolution:** restructured
  probe to unwrap `ev.state.kind`. **Time impact:** ~10 min. Also
  captured as FINDING 2.

- **Issue C — `zsh: command not found: claude` after OSC path fix.** The
  critical forensic finding. After Task 2 (Rust PathResolver) landed,
  smoke probe revealed Claude was still not spawning — this time because
  Finder-inherited PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) doesn't include
  `~/.nvm/versions/node/v22.17.0/bin` where `claude` is installed as an
  npm global. Full diagnostic in
  `docs/diagnostics/N2.1.3-claude-path-evidence.md`. **Resolution:**
  wrapper PATH augmentation per Task 2 second fix (see §4 Deviation 1).
  **Time impact:** ~40 min including evidence file + fix + rebuild +
  re-probe.

## 6. Deferred items

Task 4 surfaced 5 FINDINGS; none fixed in-rotation per dispatch §4 soft
guardrail. Each routed for future scoping:

- **FINDING 1 — PUT /api/preferences non-string value binding error.**
  `preferences.value` column is TEXT; handler doesn't coerce
  `req.body.value` → SQLite binding error on boolean/number bodies →
  500. **Severity:** MEDIUM (latent — frontend currently sends strings).
  **Suggested phase:** N3 scope-review (low-cost fold-in) OR dedicated
  hardening mini-phase.

- **FINDING 2 — session:state event nesting is a readability gap.** State
  union `{kind, …}` is structurally correct per shared schema but probe
  harnesses (and possibly future debug tooling) expect flat fields.
  **Severity:** LOW (documentation polish). **Suggested phase:** N3 or
  docs hardening.

- **FINDING 3 — Raw sessions auto-launch claude.** `session_types.raw`
  seed has `clientBinary='claude'`, `bootstrapPath=null`;
  BootstrapLauncher writes `claude\n` on first OSC A regardless of plan
  kind. Design observation: "Raw" meaning "zsh without Claude" is
  ambiguous given current behavior. **Routing:** §8 Question — CTO
  confirms Raw semantics intent.

- **FINDING 4 — Multi-pane UI polish.** Jose-reported N2.1.2 step 14.
  Already dispatch-deferred to post-N3 UI polish phase per N2.1.3 §2
  non-scope. Nothing new to defer — just confirmed still extant under
  Task 4 survey.

- **FINDING 5 — Persona-acknowledgment visibility inconclusive in probe.**
  Deep-probe captured Claude's TUI chrome + bootstrap tokens but ran out
  of its 15 s window before potentially capturing Claude's first reply.
  **Routing:** §8 Question for Jose's smoke to confirm persona reply
  renders visibly.

Plus continuing items from prior rotations:

- **Frontend React Testing Library suite.** Third rotation in a row where
  a test would have caught a bug in CI. N2, N2.1.1, N2.1.2 also asked.
  **Suggested phase:** N2.5 Frontend Hardening mini-phase OR N3 scope
  expansion (dispatch author's call). Dispatch §6 noted this is
  structurally what's making Task 4 CODER-READY-heavy.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| Rust LOC budget at 150/150 exactly | MEDIUM | Task 2 Option A added 12 lines for resource env export; was intentional per dispatch preference + fit within budget. Next dispatch to add Rust must refactor existing LOC to fit new additions — no headroom. | 30 min — tighten shutdown/on_sidecar_exit functions |
| Wrapper PATH augmentation hard-codes install locations | LOW | Walking $PATH via env-from-~/.zshrc would be more dynamic but brings back the "fatal user rc" problem N1 deliberately avoided. Hard-coded list covers 99% of macOS install practices. | Not worth fixing — documented in wrapper comment |
| No explicit Raw-session intent documentation | LOW | Shipped N1; question now surfaced via FINDING 3. | 15 min — clarify session-type semantics in one of the architecture docs or session-types seed comments |
| Task 4 30+ items deferred to Jose smoke via CODER-READY | MEDIUM | Frontend RTL suite absence. Same structural debt as prior rotations. | 2-3 day mini-phase N2.5 |

## 8. Questions for PM

1. **Jose's user-facing smoke result.** When Jose completes 16-step smoke,
   PM appends pass/fail to §3 table. If Step 10 + 11 both PASS: N2.1.3
   closes, dogfood window starts. If any step fails: narrow N2.1.4 OR
   escalation to CTO.

2. **Deviation 1 ratification.** CODER fixed a second root cause
   (wrapper PATH) in-rotation because it was the same user-observable
   symptom behind a second layer and fitting the dispatch §0 intent
   ("break the hotfix chain"). Is this the right judgment, or should
   second-root-cause finds ALWAYS defer to the next dispatch regardless
   of hotfix-chain cost? OS §20 retrospective signal for CTO.

3. **FINDING 3 — Raw session semantics.** Is the "Raw session auto-launches
   claude" behavior intentional? If yes, document in session-types seed
   comment + user docs. If no, set `clientBinary=null` on Raw row; CODER
   can ship as 2-line fix in N2.1.4 or N3.

4. **FINDING 1 — pref PUT 500.** Fold into N3 as a 10-LOC hardening
   shim, or defer to dedicated hardening pass? Current frontend usage
   is safe; fix cost is trivial; routing is PM's call.

5. **Frontend RTL suite.** Third rotation asking. The structural debt is
   making Task 4 CODER-READY-heavy rather than PASS-heavy. Is N2.5
   Frontend Hardening worth inserting before N3 proper, or will N3 scope
   absorb it?

## 9. Recommended next phase adjustments

- **Task 4 exhaustive-sweep discipline is the right intervention, but
  needs frontend test coverage to maximize yield.** Without RTL / Playwright
  integration tests, 30 of 37 Task 4 items had to route via "code-read +
  CODER-READY" rather than directly exercisable. Next round of Task 4
  after N2.5 (if scheduled) could verify 35+ items directly instead of
  ~7.

- **Dispatch §0's "hotfix chain" concern is real but the root-cause-
  stacking pattern is worth naming.** N2.1.3 is the second rotation in a
  row where a first-level fix revealed a second-level root cause at a
  different layer (N2.1.2: setOpen hypothesis → component-state useEffect;
  N2.1.3: OSC hook path → wrapper PATH). Worth codifying in OS §20: after
  a first-level fix, explicitly smoke BEFORE declaring done, because
  root causes stack.

- **Tauri PathResolver env-export pattern generalizes.** Task 2's
  `JSTUDIO_RESOURCE_DIR` + `JSTUDIO_OSC133_HOOK_PATH` is a reusable
  channel for any future bundled resource (renderer templates, icon
  assets, Claude Code JSONL schema samples, etc.). Worth noting in
  ARCHITECTURE_SPEC §2.1 as an idiom for Rust ↔ sidecar boundary.

## 10. Metrics

- **Duration this rotation:** ~2 h 15 min wall-clock (Task 1 evidence ~15 min; Task 2 Rust fix + cargo + sidecar suite ~10 min; Task 3 build + smoke-readiness + deep probe ~25 min; Task 3 second root cause evidence ~15 min; Task 2 wrapper fix + rebuild + re-probe ~20 min; Task 4 survey + re-probe + writeup ~40 min; Task 5 report ~10 min).
- **Commits authored:** 6 task commits + 1 report commit = 7, above dispatch §7 "5+" minimum.
- **Estimated output-token cost:** ~60-80 k Opus 4.7 output tokens.
- **Tool calls:** ~60 (Read-heavy during diagnosis, one Write per evidence/report, Bash for build/launch/probe).
- **Sidecar test count:** 75/75 (unchanged vs N2.1.2).
- **Total test count across packages:** 95 (75 + 10 + 10; frontend still 0 RTL).
- **Commander.app bundle size:** 35 MB (unchanged vs N2.1.2).
- **Rust LOC:** 150 / 150 **(at budget exactly)** — +12 LOC from N2.1.2's 138. Any future Rust work requires refactoring.
- **Bash wrapper LOC delta:** +34 lines in prepare-sidecar.sh (PATH augmentation block).
- **Task 4 items surveyed:** 37.
- **FINDINGS deferred:** 5.

---

**End of report. PM: (1) route this report for Jose's §3 user-facing smoke, (2) append Jose's step-by-step outcome to the §3 User-facing smoke table when dogfood completes, (3) ratify N2.1.3 close + decide on Deviation 2 / FINDINGS 1 + 3 routing when Jose returns 16/16.**
