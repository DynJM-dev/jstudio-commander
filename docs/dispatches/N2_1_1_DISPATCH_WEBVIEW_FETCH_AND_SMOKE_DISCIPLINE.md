# N2.1.1 Hotfix Dispatch — Webview Fetch Fix + Picker Autoclose + Smoke Discipline Application

**Dispatch ID:** N2.1.1 (second hotfix iteration between N2 and N3)
**From:** CTO (Claude.ai)
**To:** PM (Commander) → continuing CODER spawn
**Phase:** N2.1.1 — Pre-N3 hotfix addressing dogfood findings from N2.1 re-smoke
**Depends on:** N2.1 CLOSED with findings (`native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md`), `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0 (NEW, REQUIRED READING), `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2, all prior phase dispatches
**Triggered by:** Jose's 2026-04-22 N2.1 re-dogfood surfaced two pre-N3 blockers: (1) webview fetch to sidecar blocked despite sidecar running + curl-reachable; (2) ProjectPathPicker auto-closes on click.
**Template reference:** `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`
**Estimated duration:** 0.5 day at xhigh continuing spawn
**Model/effort:** Opus 4.7 / effort=xhigh continuing spawn
**Status:** Ready to fire

---

## §0 — Dispatch purpose in one sentence

Fix the actual webview → sidecar communication failure (smoke-exposed via Jose seeing "Sidecar unreachable" in Preferences despite CODER's curl confirming sidecar responds), fix the ProjectPathPicker auto-close regression, and retire the "smoke via intermediate-layer check" anti-pattern by establishing SMOKE_DISCIPLINE.md as the authority for all future phase smoke specifications.

N2.1.1 is a narrow hotfix. The SMOKE_DISCIPLINE.md standard landing as part of this dispatch is the structural change that prevents this class of failure in N3 and beyond.

---

## §1 — Background: what Jose's N2.1 re-dogfood surfaced

N2.1 closed as SHIP-GREEN with CODER's automated smoke passing. Jose re-dogfooded per N2.1 §2.5. Results:

**Step 1 FAILED:** Launch Commander.app from Finder → Preferences modal (Cmd+,) still displayed "Sidecar unreachable — tried 127.0.0.1:11002..11011."

**Step 3 FAILED:** Click + New session → modal opens → ProjectPathPicker auto-closes on the first click attempt, making it impossible to select a path.

**Key diagnostic evidence from PM:**
- Sidecar IS running. `ps aux` shows the process spawned.
- Sidecar IS reachable at the TCP/HTTP layer. `curl http://127.0.0.1:11002/api/health` returns HTTP 200 in 2ms.
- The failure is entirely inside the webview's `fetch()` call. CODER's automated smoke used `env -i PATH=... curl /api/health` which bypassed the webview stack.
- `tauri.conf.json` has `csp: null` with minimal capabilities. WKWebView mixed-content enforcement likely blocks `fetch('http://127.0.0.1:11002')` from `tauri://localhost` (secure) origin to insecure HTTP localhost target.

**The discipline failure that allowed this to ship:** N2.1 dispatch §2 acceptance 2.1 was specified at the TCP/HTTP layer ("GET /api/health succeeds"). CODER verified at that layer. The webview fetch layer was never exercised by automated smoke. Jose's dogfood caught it because Jose's interaction IS the webview fetch layer — there's no other way to experience the app.

This is the second hit of the same class in two rotations. N2 had the same shape (API-layer smoke bypassed UI-layer bug). Pattern is confirmed. Structural fix required, not just a third tactical hotfix.

---

## §2 — Required reading: SMOKE_DISCIPLINE.md v1.0

Before reading this dispatch further, CODER and PM read:

**`~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`** (v1.0, landed 2026-04-22)

This standard defines how smoke scenarios must be specified and executed for all phase dispatches from N2.1.1 forward. Key points:

- User-facing smoke verifies behavior at the OUTERMOST user-experience layer (Finder-launched `.app`, UI interactions, pixel observations). Not at intermediate layers (curl, ps aux, API endpoints, scripted headless smoke).
- CODER's automated smoke is diagnostic and development-time; it is NOT sufficient for phase-close. Jose-run user-facing smoke is the phase-close gate.
- Every phase dispatch §9 smoke scenario explicitly conforms to SMOKE_DISCIPLINE.md v1.0.
- PHASE_REPORT §3 format updated: CODER reports automated suite results + smoke-readiness check; Jose's user-facing smoke outcome appended by PM after Jose dogfoods.

This dispatch (N2.1.1) is the first dispatch authored under the new discipline. Its §7 smoke section is the reference template for all future dispatch smoke sections.

---

## §3 — Non-negotiable acceptance criteria

All criteria conform to SMOKE_DISCIPLINE.md §3.1 (acceptance criteria wording at outermost layer). Each is written in terms of what Jose observes on screen, not what a component returns internally.

### 3.1 — Webview fetch to sidecar succeeds from production build

Launch `Commander.app` from Finder (no terminal assist, no dev mode). Within 3 seconds of the window appearing:

- Open Preferences modal via Cmd+,. The modal displays NO "Sidecar unreachable" error banner. The Shell section's toggle is interactable.
- With webview DevTools temporarily enabled for smoke (permitted per SMOKE_DISCIPLINE.md §4.2 — DevTools IS the outermost diagnostic layer for webview behavior), confirm the Network tab shows the frontend's `/api/health` request completing with HTTP 200 status and a non-zero response body. Console tab shows no CSP violation errors, no mixed-content errors, no fetch failures.
- Close Preferences. Re-open it. Still no error banner on second open.

DevTools is enabled for smoke purposes only; the production release build does not ship with DevTools on by default. Dispatch Task 4 handles the DevTools toggle.

### 3.2 — Session spawn modal fully functional via UI

Click "+ New session" in the sidebar. Modal opens. Observe:
- ProjectPathPicker component renders in the modal.
- Click the path picker input field. Dropdown opens with three sections visible: **Recent** (may be empty initially), **Projects** (populated from filesystem scan of `~/Desktop/Projects/`), **Browse...** (bottom row).
- Dropdown STAYS OPEN when the user's mouse moves within it. Clicking a Projects entry selects that path, populates the input, and closes the dropdown. Clicking inside the dropdown (e.g., on a project name or filter text field) does NOT cause the dropdown to close prematurely.
- Type in the input field. Recent and Projects sections filter by substring match in real-time.
- Select a path from Projects. Select PM from Session Type dropdown. Select high from Effort dropdown. Click Submit.
- Modal closes. New session appears in the sidebar. Pane 1 updates to show the session's terminal pane. Terminal renders Claude Code boot output.

### 3.3 — Full end-to-end UI smoke (SMOKE_DISCIPLINE.md §3.2 compliant)

From a clean launch:

1. Run `pnpm build:app` from `~/Desktop/Projects/jstudio-commander/native-v1/`. Build succeeds.
2. Locate `Commander.app` at `native-v1/apps/shell/src-tauri/target/release/bundle/macos/Commander.app`.
3. Double-click `Commander.app` in Finder (or right-click → Open if Gatekeeper warning — that's expected per N1 acceptance memo §4).
4. Commander window appears within 2s.
5. Open Preferences via Cmd+,. No "Sidecar unreachable" error. Close Preferences.
6. Click "+ New session" in the sidebar. Modal opens.
7. Click path picker. Dropdown opens with three sections, stays open.
8. Click a Projects entry (e.g., `jstudio-meta`). Path populates. Dropdown closes.
9. Select PM type, high effort. Click Submit. Modal closes.
10. Pane 1 shows the session's terminal pane. Terminal renders. Claude Code boots. Bootstrap injects.
11. OSC 133 marker fires on first prompt (visible via terminal shell prompt appearing).
12. Session appears in sidebar with live status.
13. Click "+ Pane" to add Pane 2. Click "+ New session" in Pane 2. Modal opens, path picker works. Spawn a second session on a different project.
14. Split view shows two active sessions. Cmd+Opt+→/← cycles focus between panes.
15. Cmd+Q closes Commander.
16. Re-launch Commander.app from Finder. Two sessions restored in their panes. Scrollback restored. Recent section of path picker now shows the two paths at top on next + New session.

All 16 steps must pass in a single unbroken sequence. Step 4 start-to-step 16 completion typically <2 minutes of interaction. If any step fails: the dispatch does NOT close; issue surfaced to PM, diagnosed, fixed per N2.1.1 continuation OR new hotfix if scope exceeds this dispatch.

### 3.4 — SMOKE_DISCIPLINE.md standard integrated

**`~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`** v1.0 exists on disk. PM commits it to jstudio-meta as part of landing this dispatch (single small commit with §23 changelog entry citing N2 + N2.1 smoke gaps as motivation).

All future phase dispatches from this file's landing forward include SMOKE_DISCIPLINE.md in the required reading list. N3 dispatch (currently drafted, waiting for N2.1.1 close) will have its §9 smoke section validated against SMOKE_DISCIPLINE.md compliance by PM before CTO ratifies N3 firing.

### 3.5 — All prior phase criteria preserved

N2.1.1 regression on any N1 / N2 / N2.1 §1 criterion is a release blocker. Specifically verify after webview fetch fix + picker fix land:
- All N2.1 picker functionality works (Recent updates on spawn, keyboard nav, filter, Browse).
- All N2 surfaces (ContextBar shape, STATE.md drawer, split view, workspace persistence, scrollback restore, .zshrc opt-in, durationMs, WS heartbeat) still work.
- All N1 surfaces (bootstrap injection, OSC 133, pre-warm pool, single-instance, clean quit) still work.
- Bundle size ≤ 36 MB.

---

## §4 — Task breakdown (5 tasks, ordered)

### Task 1 — Re-diagnose with webview DevTools enabled (HIGH effort, root-cause-first)

Before any code changes, CODER reproduces the webview fetch failure and confirms root cause via webview-native diagnostic surface.

**Diagnostic steps:**

1. Run `pnpm build:app`. Locate Commander.app.
2. **Enable WKWebView DevTools temporarily in Tauri config.** In Tauri v2, this is done via `tauri.conf.json` → `app.security.devTools: true` OR via feature flag on the Tauri build. CODER adds this as a temporary dev-build setting for the N2.1.1 smoke cycle; §4 Task 4 handles the persistent toggle preference.
3. Rebuild. Launch from Finder.
4. Right-click in the app window → Inspect Element (if Tauri DevTools are exposed). Open Network tab. Open Console tab.
5. Open Preferences modal (Cmd+,). Observe:
   - Network tab: does the `/api/health` request appear? What status code? What error if any?
   - Console tab: any CSP violation messages? Mixed-content warnings? Fetch rejections?
6. Document exact error output. Possible root causes from PM's analysis:
   - **Root Cause A (CSP):** `tauri.conf.json` has `csp: null` which in Tauri v2 may enforce a default restrictive CSP that blocks `connect-src http://127.0.0.1:*`. Console would show CSP violation.
   - **Root Cause B (mixed-content):** WKWebView treats `tauri://localhost` as a secure origin; fetch to `http://127.0.0.1:11002` (insecure HTTP) is blocked by macOS App Transport Security policies. Console would show mixed-content warning.
   - **Root Cause C (capability missing):** Tauri v2 capabilities system requires explicit `http:` fetch permission in `capabilities/*.json` OR use of `@tauri-apps/plugin-http` for fetch instead of native `fetch()`. Network tab would show fetch never firing, or firing with capability-denied error.
   - **Root Cause D (port discovery race):** frontend tries to fetch before sidecar has written `runtime.json` with the chosen port. Unlikely given sidecar verified running in <3s; more plausible as a fallback.
7. Identify root cause with evidence. Document in PHASE_N2.1.1_REPORT §5 (Issues) BEFORE fix implementation.

**Crucial:** per SMOKE_DISCIPLINE.md §3.1 and §4.2, DevTools is the outermost diagnostic layer for webview fetch behavior. `curl` tests confirm sidecar responds; they do NOT confirm webview can reach sidecar. The webview fetch is the actual user-facing code path.

**Acceptance:**
- Root cause identified via webview DevTools with concrete evidence (screenshot or exact error text from Network/Console tabs).
- Root cause documented in PHASE_N2.1.1_REPORT §5.
- Empty evidence commit (D20 practice) lands with the diagnostic artifacts committed to `native-v1/docs/diagnostics/N2.1.1-webview-fetch-evidence.md`.

**Effort:** HIGH for diagnosis. Budget 0.25 day max.

### Task 2 — Fix webview fetch per Task 1 evidence

Fix shape depends on root cause:

**If Root Cause A (CSP):** Set explicit CSP in `tauri.conf.json` → `app.security.csp: "default-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"` — or similar scoped to connect-src for localhost ports 11002-11011 and ws equivalent. Document the CSP chosen and rationale.

**If Root Cause B (mixed-content):** Switch from native `fetch()` to `@tauri-apps/plugin-http` which runs through Rust's reqwest and bypasses WKWebView's mixed-content enforcement. Install the plugin, configure capabilities in `src-tauri/capabilities/*.json` to allow `http://127.0.0.1:*`, refactor frontend fetch calls to use the plugin's API. This is a deeper change; preferred only if CSP-only fix can't resolve.

**If Root Cause C (capability missing):** Add explicit fetch capability for localhost ports in `src-tauri/capabilities/default.json` — e.g., `"http:default"` with allowlist for `127.0.0.1:11002..11011`. Ensure this is scoped tightly to Commander's own sidecar only, not global HTTP fetch.

**If Root Cause D (port discovery race):** Add retry-with-backoff to frontend's sidecar discovery, keyed to the first successful `/api/health` response. Logging to webview console during retries.

**Preference ordering:** Root Cause A (CSP) fix is lowest-scope change and should be preferred if it resolves. Root Cause B (plugin-http) is largest-scope and preserved as fallback only.

**Acceptance:**
- Webview fetch to `/api/health` succeeds in Finder-launched production build.
- No CSP violations, no mixed-content warnings, no capability-denied errors in Console tab.
- Preferences modal displays no "Sidecar unreachable" error.
- `tauri.conf.json` / capabilities files updated with the minimum-scope change necessary. Changes documented in PHASE_N2.1.1_REPORT §2 with rationale.

**Effort:** 0.15 day if CSP fix; 0.3-0.5 day if plugin-http migration needed.

### Task 3 — Fix ProjectPathPicker auto-close

Picker closes on first click attempt, per Jose's dogfood observation. Diagnose and fix.

**Likely causes (mechanical React/dropdown patterns, CODER diagnoses):**
- Click-outside handler firing on first synthetic click event before the click registers as inside-dropdown. Fix: add a short delay on mount OR check event.target ancestor before closing.
- Event propagation issue where dropdown's own click fires a parent onClick that toggles open state.
- Dropdown trigger binding issue where the trigger element thinks it's being unfocused immediately.
- Missing `pointer-events` CSS causing underlying layer to receive the click.

**Acceptance:**
- Per §3.2: clicking path picker opens dropdown, stays open, user can select entries or type to filter. Clicking entries selects and closes dropdown intentionally. Typing in filter field does not close dropdown.
- Tested in both single-pane and split-view contexts (all 3 panes can spawn sessions with working picker).

**Effort:** 0.15 day. Mechanical React fix; common pattern.

### Task 4 — Persistent webview DevTools toggle + smoke-readiness wrapper

Add a persistent mechanism for enabling webview DevTools for smoke-validation purposes, without shipping DevTools on in every release build.

**Implementation options (CODER chooses, documents):**
- **Option A:** Environment variable at build time: `COMMANDER_DEVTOOLS=1 pnpm build:app` produces a DevTools-enabled build. `pnpm build:app` without the variable produces the default release (no DevTools). Build script reads env var and conditionally sets `app.security.devTools` in a generated `tauri.conf.json` overlay.
- **Option B:** Preference-driven: add `preferences.debug.enableDevTools` boolean (default false). When true, after app launch, frontend calls a new Tauri IPC command `devtools_open()` to open DevTools programmatically. Preference settable via a hidden key-combo (e.g., Cmd+Shift+Opt+D) or via direct DB edit. Preserves release-build safety while allowing Jose to toggle for smoke.
- **Option C:** Separate `pnpm build:app:debug` script that produces a debug-flavored `.app` bundle with DevTools enabled, in parallel to the release `pnpm build:app`. Jose uses `build:app:debug` for smoke runs; `build:app` for his actual use.

CODER picks the least-intrusive option and documents rationale. Option C is likely most common pattern in Tauri v2 projects.

**Acceptance:**
- Jose can reliably produce a DevTools-enabled build for smoke purposes by running a documented command.
- The release `pnpm build:app` does not include DevTools.
- Mechanism documented in `native-v1/README.md` or equivalent.

**Effort:** 0.1 day.

### Task 5 — PHASE_REPORT + re-smoke per SMOKE_DISCIPLINE.md §5

**CODER produces PHASE_N2.1.1_REPORT with the new §3 format per SMOKE_DISCIPLINE.md §5:**

- §3 (Tests, typecheck, build) reports: (a) CODER internal suite results, (b) smoke-readiness check (CODER launched the Finder-launched build and confirmed window appears), (c) space reserved for "User-facing smoke: [PENDING — Jose runs]" — to be filled in by PM after Jose's dogfood.

**Jose runs user-facing smoke per §3.3 (16 steps).**

**PM appends Jose's smoke result to PHASE_N2.1.1_REPORT §3** before the phase closes. Pass = phase closes; fail = diagnosis + N2.1.2 hotfix (if scope stays narrow) or scope escalation to CTO.

**Acceptance:**
- PHASE_N2.1.1_REPORT filed at `native-v1/docs/phase-reports/PHASE_N2.1.1_REPORT.md`.
- PM-appended user-facing smoke result shows PASSED.
- PHASE_N2.1.1_REPORT §3 demonstrates the new reporting format per SMOKE_DISCIPLINE.md §5.

**Effort:** 0.1 day for CODER's part + Jose's dogfood time (~15 min).

---

## §5 — Explicit non-scope for N2.1.1

Not in scope:
- Any N3 scope (JSONL parser, renderer registry, ChatThread, approval modal, ContextBar live data, frontend test suite).
- Signing, notarization, or Gatekeeper resolution (deferred per N1 acceptance memo §4).
- Migration to `@tauri-apps/plugin-http` unless Task 1 evidence shows it's the only viable fix (preference is minimum-scope CSP adjustment).
- Fully-persistent DevTools UI (Task 4 ships a mechanism, not a polished UI).
- Retroactive SMOKE_DISCIPLINE.md application to N1 / N2 / N2.1 PHASE_REPORTs — standard applies from N2.1.1 forward.
- OS §20.LL-L15 fold — queued for next retrospective landing, not done in this dispatch.

---

## §6 — Guardrails (inherited + N2.1.1-specific)

Standard 8 guardrails from prior dispatches. New additions for N2.1.1:

**Guardrail #9 — SMOKE_DISCIPLINE.md compliance mandatory.** CODER reads SMOKE_DISCIPLINE.md in required reading. Every diagnostic, fix, and smoke step conforms to its layer-identification principle. CODER does NOT verify webview behavior via curl, cannot self-certify user-facing smoke. CODER's smoke-readiness check (§5 Task 5) confirms the build is ready for Jose's smoke, nothing more.

**Guardrail #10 — Root-cause before fix (reiterated from N2.1 G3).** Task 1 completes with evidence before Task 2 starts. Empty evidence commit required before any CSP/capability/plugin change.

**Guardrail #11 — Smoke layer identification in diagnostic commits.** Every diagnostic commit message explicitly names the layer being tested: "diagnostic: webview Network tab shows /api/health blocked by CSP (WKWebView layer)" NOT "diagnostic: fetch fails". Layer naming discipline makes future smoke-gap patterns visible in git history.

---

## §7 — Smoke scenario (SMOKE_DISCIPLINE.md compliant)

Smoke scenario conforms to SMOKE_DISCIPLINE.md v1.0. CODER's automated smoke is a prerequisite, not a substitute.

Scenario is §3.3 above — 16 ordered steps, starting from zero (pnpm build:app from clean state), proceeding via UI only (no terminal assist, no curl, no API calls), observing via pixels, terminating with clean shutdown + re-launch verification.

CODER does NOT run this scenario. CODER runs smoke-readiness check only: confirms `pnpm build:app` succeeds, `.app` bundle exists at expected path, Finder-launch produces a visible window. That's it.

Jose runs the full scenario and reports pass/fail via PM. PM appends to PHASE_N2.1.1_REPORT §3.

---

## §8 — PHASE_REPORT template (updated per SMOKE_DISCIPLINE.md §5)

Same canonical 10-section format. Filed at `native-v1/docs/phase-reports/PHASE_N2.1.1_REPORT.md`.

§3 format updated:

```markdown
## 3. Tests, typecheck, build

### CODER internal suite
| Check | Result | Notes |
|---|---|---|
| Typecheck | [PASS/FAIL] | |
| Unit tests | [X/Y passing] | |
| Integration tests | [X/Y passing] | |
| CODER automated smoke | [PASS/FAIL] | |
| Build | [PASS/FAIL] | |
| Lint | [clean / N warnings] | |

### Smoke-readiness check (CODER)
| Check | Result | Notes |
|---|---|---|
| `pnpm build:app` succeeds | [PASS/FAIL] | |
| `.app` bundle at expected path | [PASS/FAIL] | |
| Finder-launch produces window | [PASS/FAIL] | |

### User-facing smoke (Jose)
| Step | Result | Notes |
|---|---|---|
| *[PENDING — Jose runs per dispatch §3.3]* | | |

(PM appends Jose's step-by-step outcome after dogfood.)
```

---

## §9 — What PM does

1. Read SMOKE_DISCIPLINE.md v1.0 end-to-end. Acknowledge internalization in the paste-to-CODER prompt.
2. Commit SMOKE_DISCIPLINE.md to jstudio-meta with §23 changelog entry. Single small commit.
3. Read this dispatch end-to-end. Verify §3 acceptance criteria are all written at the outermost user-facing layer per SMOKE_DISCIPLINE.md §3.1.
4. Verify Task 1 diagnostic steps prescribe webview DevTools as the diagnostic surface (not curl).
5. Verify Task 2 fix options preference-order CSP adjustment as lowest-scope first.
6. Produce paste-to-CODER prompt:
   - Full dispatch content.
   - Continuing spawn.
   - Required reading: SMOKE_DISCIPLINE.md v1.0 (NEW), PHASE_N2.1_REPORT, N2.1 dispatch, N1 acceptance memo, ARCHITECTURE_SPEC v1.2.
   - Explicit "Task 1 webview DevTools diagnostic before Task 2 fix — no curl-based verification for webview-layer issues" reminder.
   - Explicit "CODER smoke-readiness only, Jose runs user-facing smoke" reminder per SMOKE_DISCIPLINE.md §3.4.
7. Flag for CTO ratification if gaps.

---

## §10 — What Jose does

1. Save SMOKE_DISCIPLINE.md to `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`.
2. Save N2.1.1 dispatch to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_1_DISPATCH_WEBVIEW_FETCH_AND_SMOKE_DISCIPLINE.md`.
3. Paste in PM: "N2.1.1 dispatch saved at `docs/dispatches/N2_1_1_DISPATCH_WEBVIEW_FETCH_AND_SMOKE_DISCIPLINE.md`. SMOKE_DISCIPLINE.md v1.0 saved at `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` — PM commits to jstudio-meta as part of landing this dispatch."
4. Wait for PM review + paste-to-CODER prompt.
5. Spawn continuing CODER. Paste prompt.
6. CODER executes. Budget 0.5 day wall-clock.
7. CODER files PHASE_N2.1.1_REPORT with §3 in new format (pending Jose smoke).
8. Jose carries to PM.
9. **Jose runs user-facing smoke per §3.3 — 16 steps, via UI only, observing pixels.** Jose reports step-by-step pass/fail to PM.
10. PM appends Jose's smoke result to PHASE_N2.1.1_REPORT §3.
11. If all 16 steps pass: N2.1.1 closes. CTO ratifies. N3 fires (with SMOKE_DISCIPLINE.md compliance verified on its §9 smoke section beforehand).
12. If any step fails: diagnosis + next hotfix if scope stays narrow (N2.1.2) OR CTO scope escalation.

---

## §11 — Estimated duration + effort

**Per-task effort:**
- Task 1 (diagnose with webview DevTools): 0.25 day, HIGH.
- Task 2 (fix webview fetch): 0.15-0.5 day depending on root cause.
- Task 3 (picker auto-close): 0.15 day.
- Task 4 (DevTools toggle mechanism): 0.1 day.
- Task 5 (report + re-smoke): 0.1 day CODER + ~15min Jose dogfood.

Total nominal: 0.75-1 day fresh-spawn-medium baseline. Continuing xhigh compression factor → 0.3-0.5 day actual wall-clock likely.

**Token budget:** $200-400. Narrow scope.

---

## §12 — Closing instructions to CODER

N2.1.1 is the second hotfix in a row for the same class of gap. The first hotfix (N2.1) fixed tactical symptoms. This hotfix (N2.1.1) fixes the tactical symptoms AND establishes the structural discipline (SMOKE_DISCIPLINE.md) that prevents recurrence in N3 and beyond.

**Before writing any code:** read SMOKE_DISCIPLINE.md v1.0 end-to-end. Internalize §1 principle (outermost layer, not intermediate) and §3.4 (CODER cannot self-certify user-facing smoke). These are not nice-to-haves; they're the reason this dispatch exists.

**Task 1 first. No fixes until root cause identified via webview DevTools** (not curl, not ps aux, not log tailing). Webview behavior is verified at the webview layer.

**Your smoke is smoke-readiness only.** Jose runs user-facing smoke. Your job ends at "build succeeds, Finder-launch produces window." PHASE_REPORT §3 explicitly splits these.

Read in order:

1. This dispatch.
2. `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0 (NEW, REQUIRED).
3. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md` (prior hotfix outcome).
4. `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_DISPATCH_SIDECAR_HOTFIX_AND_PATH_PICKER.md` (prior dispatch; note where its smoke specification sat at the wrong layer).
5. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md` §4 (signing deferred context).
6. `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 §7 (IPC contracts) and §8 (sidecar process model).
7. Tauri v2 docs on CSP (`app.security.csp`), capabilities (`src-tauri/capabilities/`), and `@tauri-apps/plugin-http` API.
8. WKWebView mixed-content and App Transport Security policy references.

Execute 5 tasks. Commit at task boundaries. Empty-evidence commit before Task 2 (per G10).

When §3 acceptance criteria all pass and Jose's user-facing smoke (§3.3) returns 16/16: write PHASE_N2.1.1_REPORT.md with new §3 format, file at `native-v1/docs/phase-reports/PHASE_N2.1.1_REPORT.md`, notify Jose for carry to PM.

---

**End of N2.1.1 dispatch. Ready to fire.**
