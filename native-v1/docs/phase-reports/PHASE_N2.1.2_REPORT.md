# Phase Report — JStudio Commander native v1 — Phase N2.1.2 — Modal selection commits

**Phase:** N2.1.2 — Pre-N3 hotfix: modal selection commits (N2.1.1 smoke Steps 8 + 9)
**Started:** 2026-04-22 (continuing CODER spawn, no reset)
**Completed:** 2026-04-22 (same rotation; PENDING Jose's user-facing smoke per §3)
**Coder session:** Claude Code coder session at `~/Desktop/Projects/jstudio-commander/`
**Model / effort used:** Opus 4.7 (1M context) / effort=xhigh continuing
**Status:** CODER-COMPLETE; awaiting Jose's user-facing smoke per SMOKE_DISCIPLINE.md §5

---

## 1. Dispatch recap

Fix the two N2.1.1 user-facing smoke failures (Steps 8 + 9): clicking a project entry in the path picker doesn't populate the input, and the Session Type dropdown stays on PM regardless of click. Per `docs/dispatches/N2_1_2_DISPATCH_MODAL_SELECTION_COMMITS.md`. Investigation discipline applied per G10/G11; new guardrail G12 (dependency hygiene) observed from this rotation forward.

Root cause is a single shared one — both symptoms resurface through the same rogue useEffect. PM's arrival hypothesis (monotonic setOpen scoped too broadly) was refuted by code-read; actual cause sits one layer deeper in React component-state.

## 2. What shipped

**Commits (4 new):**

- `54a7d5a` `diagnostic(n2.1.2)` — component-state layer root-cause evidence (empty commit per G10)
- `f4e6cea` `frontend` — Task 2: drop unstable `createMutation` from reset-effect deps
- `cfdb090` `smoke-readiness(n2.1.2)` — Task 3 build:app:debug exercise, no new failures
- (this commit) `docs(n2.1.2)` — PHASE_N2.1.2_REPORT

**Files changed:** 3 created + 1 modified, entirely under `native-v1/docs/diagnostics/`, `native-v1/docs/phase-reports/`, and `apps/frontend/src/components/NewSessionModal.tsx`. Zero Rust, zero sidecar, zero dependency changes.

**Capabilities delivered against dispatch §1 acceptance:**

| # | Criterion | Status |
|---|---|---|
| 1.1 | Path picker selection commits | **CODER-READY** — fix targets the rogue reset effect, not the picker itself. Jose's DevTools + pixel-level observation is the empirical confirmation. |
| 1.2 | Session type dropdown commits | **CODER-READY** — same fix, same mechanism; this was the first production-build exercise of the dropdown. |
| 1.3 | Full 16-step smoke passes | **PENDING Jose** (per SMOKE_DISCIPLINE.md §3.4). Steps 10-16 infrastructure-readiness audited in §3 smoke-readiness bucket; internal layers green. |
| 1.4 | No N1 / N2 / N2.1 / N2.1.1 regression | Sidecar 75/75 + shared 10/10 + db 10/10; CORS/CSP holds; picker auto-close fix from N2.1.1 held. |

## 3. Tests, typecheck, build

Per SMOKE_DISCIPLINE.md §5 — three buckets. CODER fills first two; PM appends Jose's user-facing smoke after dogfood.

### CODER internal suite

| Check | Result | Notes |
|---|---|---|
| Typecheck (frontend + sidecar + shell) | PASS | `tsc --noEmit` + `cargo check` clean |
| Vitest (sidecar) | 75/75 PASS | Unchanged vs N2.1.1 — no new sidecar surface in N2.1.2 |
| Vitest (shared) | 10/10 PASS | unchanged |
| Vitest (db) | 10/10 PASS | unchanged |
| `cargo check` / `cargo build --release` | PASS | Rust LOC 138 / 150 (unchanged) |
| Lint | clean | typecheck-as-lint per package.json |
| `pnpm install --frozen-lockfile` (G12) | PASS | No dep drift introduced in this rotation |

### Smoke-readiness check (CODER)

Per SMOKE_DISCIPLINE.md §5 item 2 + dispatch §4 Task 3. CODER verifies the build is *ready* for Jose's smoke — not a self-certifying substitute. Full record at `native-v1/docs/diagnostics/N2.1.2-smoke-readiness.md`.

| Check | Result | Notes |
|---|---|---|
| `pnpm build:app:debug` succeeds | PASS | Commander.app 35 MB + Commander_0.1.0_aarch64.dmg |
| `.app` bundle at expected path | PASS | `native-v1/apps/shell/src-tauri/target/release/bundle/macos/Commander.app` |
| Finder-equivalent launch (`env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`) produces full process tree | PASS | `jstudio-commander-shell` + `/usr/local/bin/node .../sidecar/dist/index.js`; `runtime.json` written with `{port:11002, pid:…}` |
| Webview-fetch layer (N2.1.1 CORS+CSP regression guard) | HELD | 9 webview requests observed in first 2 s — OPTIONS preflights + GETs to /api/health, /api/sessions, /api/session-types, /api/preferences/rawSession.defaultCwd, /api/preferences/zsh.source_user_rc. All 200/204/404-for-unset-pref. No CORS or CSP errors. |
| Picker auto-close (N2.1.1 Task 3 regression guard) | UNCHANGED | `onClick={() => setOpen(true)}` monotonic pattern preserved verbatim; no touch to ProjectPathPicker in this hotfix. |
| Steps 10-16 infrastructure-readiness audit (dispatch §4 Task 3 explicit ask) | GREEN | Every backing layer (POST /api/sessions → PtyOrchestrator, OSC 133 parser → session:state events, workspaceSync hydrate, TerminalPane scrollback blob restore, appendRecentPath) is covered by the internal test suite. No new failures surfaced during CODER's pass; any that surface during Jose's dogfood land in §5/§8 without being fixed in this dispatch per dispatch §4 Task 3. |
| Bundle size ≤ 36 MB per §1.4 regression guard | PASS | 35 MB |

### User-facing smoke (Jose)

Per SMOKE_DISCIPLINE.md §5 item 3: blank at PHASE_REPORT filing time. PM appends Jose's step-by-step outcome after dogfood.

| Step (per N2.1.1 dispatch §3.3 scenario) | Result | Notes |
|---|---|---|
| 1. `pnpm build:app` succeeds | *[PENDING — Jose runs]* | |
| 2. `.app` at expected path | *[PENDING]* | |
| 3. Double-click launches Commander | *[PENDING]* | |
| 4. Window within 2 s | *[PENDING]* | |
| 5. Cmd+, → no "Sidecar unreachable" | *[PENDING]* | N2.1.1 regression guard |
| 6. "+ New session" opens modal | *[PENDING]* | |
| 7. Path picker opens + stays open + 3 sections visible | *[PENDING]* | N2.1.1 regression guard |
| 8. Picking a project populates path, closes dropdown | *[PENDING — PRIMARY N2.1.2 TARGET]* | |
| 9. Session Type dropdown selection commits | *[PENDING — PRIMARY N2.1.2 TARGET]* | |
| 10. Submit spawns session | *[PENDING — first production exercise]* | |
| 11. OSC 133 marker on first prompt | *[PENDING]* | |
| 12. Session in sidebar with live status | *[PENDING]* | |
| 13. + Pane → 2nd session | *[PENDING]* | |
| 14. Split view + Cmd+Opt+←/→ focus cycle | *[PENDING]* | |
| 15. Cmd+Q closes | *[PENDING]* | |
| 16. Re-launch restores sessions + scrollback + Recent | *[PENDING]* | |

*(PM appends Jose's step-by-step pass/fail here after dogfood.)*

## 4. Deviations from dispatch

1. **Task 1 diagnostic via static code-read, not interactive webview DevTools** — same boundary as N2.1.1. SMOKE_DISCIPLINE.md §3.4 explicitly says CODER cannot self-certify user-facing smoke; interactive DevTools click-through is Jose's surface. Evidence (code-read of `NewSessionModal.tsx` + TanStack Query v5 source) was strong enough to pinpoint a single root cause explaining both symptoms — no speculative fix applied, no scope creep. Formally a deviation from dispatch §4 Task 1 wording ("screenshot or exact error text") but consistent with the standard's layer-identification principle.

2. **PM's arrival hypothesis was refuted by evidence and a different root cause pinpointed.** Dispatch §2 Task 1 + PM's §1 appendix suggested N2.1.1 Task 3's monotonic `setOpen(true)` was "scoped too broadly and absorbs the dropdown-item click". Code-read (§3.5 of the evidence file) showed the monotonic onClick is only on the trigger input, NOT on dropdown-item buttons — the hypothesis was mechanically wrong. Actual cause sits one layer deeper in React component state (unstable `createMutation` reference in a useEffect dep array). Reported per guardrail §4 (surface better approaches with deviation report, never silently second-guess). PM's underlying instinct — "something scoped too broadly is absorbing the selection" — was right in spirit; the scope issue was in the *useEffect dependency* scope, not the *click-handler* scope.

## 5. Issues encountered and resolution

- **Issue A — TanStack Query v5 `useMutation` wrapper-object identity is not React-stable.** Not a library bug — a library contract that interacts poorly with `useEffect` dep arrays. This is the first time a useEffect in this codebase has closed over a mutation-result object. The fix (drop the wrapper from deps, read `.reset()` inside the body) is the idiomatic React answer. Verified by re-reading TanStack Query v5 source; documented inline with the eslint-disable rationale. **Time impact:** ~20 min from code-read through fix.

- **Issue B — TCC folder-permission prompt during Jose's N2.1.1 Step 6 (standard macOS behavior, noted in PHASE_N2.1.1_REPORT).** Not an N2.1.2 issue; not revisited. Parked for signing/distribution phase.

## 6. Deferred items

- **Jose's user-facing smoke outcome** — explicit phase-close gate per SMOKE_DISCIPLINE.md §5. PM appends §3 User-facing smoke table after dogfood.
- **Frontend React Testing Library suite** — N2 §6 deferred; still deferred. An RTL test that exercises the reset effect against a forced re-render would have caught this bug in CI. Every rotation compounds the case for this suite landing. **Suggested phase:** N2.5 Frontend Hardening mini-phase OR N3 scope (dispatch author's call).
- **TanStack Query mutation-handle stability audit across the codebase** — CODER grepped the frontend for other `useMutation`/`useQuery` return objects used in `useEffect` deps. Zero additional instances found. If N3 introduces new mutation hooks, each `useEffect` that reads them MUST audit for the same class. Worth codifying as a comment at each new mutation usage site.

## 7. Tech debt introduced

| Debt | Severity | Why taken | Est. fix |
|---|---|---|---|
| `eslint-disable-next-line react-hooks/exhaustive-deps` inline comment in NewSessionModal.tsx reset effect | LOW | The disable pattern IS the idiomatic React answer when a hook return value's identity isn't stable. The inline comment captures the rationale. A `useRef(createMutation); ref.current = createMutation` alternative would avoid the disable but is less readable. | 0 — not actually debt; code-review signal |
| No automated test coverage for the reset-effect behavior | MEDIUM | Frontend RTL suite deferred. | 30 min once the RTL suite lands — test would render the modal, `setProjectPath('/foo')`, force a re-render, assert `projectPath === '/foo'` |
| Dispatch-noted wiki/wisdom about Tanstack Query handle stability isn't propagated into project docs | LOW | Any new `useMutation` / `useQuery` site is a potential re-occurrence if the author doesn't know about the identity instability | 15 min — add a `docs/native-v1/react-patterns.md` note or expand the comment in queries/*.ts |

## 8. Questions for PM

1. **Jose's user-facing smoke result.** When Jose completes §3 smoke, PM appends pass/fail to this report's §3 User-facing smoke table. If any step fails: narrow N2.1.3 hotfix if scope stays small (picker-specific bug / dropdown-specific bug / modal-specific bug) OR escalation to CTO if scope widens.

2. **Frontend RTL suite decision.** Second rotation in a row where a test would have caught the bug in CI. Is N2.5 Frontend Hardening worth inserting before N3? (N2.1.1 asked the same question; still open.)

3. **N3 readiness.** Assuming Jose's smoke passes 16/16, N3 is unblocked. Are there dispatch revisions since the last N3 draft (surfaced during N2.1.1 + N2.1.2 investigations) that need a CTO round before N3 fires?

## 9. Recommended next phase adjustments

- **Codify TanStack Query handle-stability pattern.** Add a short section to `docs/native-v1/react-patterns.md` (create if missing) documenting: "Wrapper objects returned by `useMutation` / `useQuery` are NOT React-stable. Do not include them in `useEffect` dep arrays. If an effect needs to call a mutation's `.reset()` or `.mutate()`, read it inside the body — those callbacks are stable." Saves the next CODER the same diagnostic cycle.

- **Evidence-file-first diagnosis discipline is paying off.** Three N2.x.y phases in a row have started with an empty evidence commit before any fix; each one has pinned the root cause cleanly. PM and CTO can read the diagnostic before the fix is committed — a clean audit trail that makes "did CODER actually diagnose vs. guess?" trivially answerable. Worth codifying in OS §20 next retrospective landing.

## 10. Metrics

- **Duration this rotation:** ~30 min wall-clock (Task 1 code-read + evidence file ~15 min, Task 2 fix + typecheck ~5 min, Task 3 smoke-readiness build + launch ~5 min, Task 4 report ~10 min; wall-clock collapsed by parallel tool calls).
- **Commits authored:** 3 task commits + 1 report commit = 4, matching the ≥ 4 commits minimum per dispatch §3.
- **Estimated output-token cost:** ~30-45 k Opus 4.7 output tokens; continuing-spawn compression strong on a narrow hotfix with a single-root-cause, single-line fix.
- **Tool calls:** ~35 (Read-heavy during diagnosis, one Write for the fix, Bash for build + smoke-readiness).
- **Sidecar test count:** 75/75 (unchanged vs N2.1.1).
- **Total test count across packages:** 95 (75 + 10 + 10; frontend still 0 RTL).
- **Commander.app bundle size:** 35 MB (unchanged vs N2.1.1).
- **Rust LOC:** 138 / 150 (unchanged — no Rust in this hotfix).
- **Lines of frontend source changed:** 10 (addition) + 2 (removal) in NewSessionModal.tsx. Minimum-viable fix matched to minimum-viable bug.

---

**End of report. PM: (1) route this report for Jose's §3 user-facing smoke, (2) append Jose's step-by-step outcome to the §3 User-facing smoke table when dogfood completes, (3) ratify N2.1.2 close + unblock N3 firing when Jose returns 16/16.**
