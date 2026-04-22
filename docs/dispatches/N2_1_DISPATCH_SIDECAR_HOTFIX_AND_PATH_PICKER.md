# N2.1 Hotfix Dispatch — Production Sidecar Spawn + ProjectPathPicker

**Dispatch ID:** N2.1 (hotfix between N2 and N3)
**From:** CTO (Claude.ai)
**To:** PM (Commander) → continuing CODER spawn
**Phase:** N2.1 — Pre-N3 hotfix addressing dogfood findings
**Depends on:** N2 CLOSED (`native-v1/docs/phase-reports/PHASE_N2_REPORT.md`), `docs/native-v1/ARCHITECTURE_SPEC.md` v1.2, all prior phase dispatches
**Triggered by:** Jose's 2026-04-22 dogfood session surfaced two pre-N3 blockers (sidecar unreachable on production build; session spawn modal missing path picker UX)
**Template reference:** `~/Desktop/Projects/jstudio-meta/templates/phase-report-template.md`
**Estimated duration:** 0.5-1.5 days at xhigh continuing spawn; calibrated on N2's delivery regime
**Model/effort:** Opus 4.7 / effort=xhigh continuing spawn
**Status:** Ready to fire

---

## §0 — Dispatch purpose in one sentence

Diagnose and fix the production-build sidecar-spawn failure surfaced by Jose's dogfood (`Sidecar unreachable — tried 127.0.0.1:11002..11011`), build the ProjectPathPicker component to replace the simple text-input path field with a Recent / Projects / Browse picker, and ensure the modal form completes a session spawn end-to-end via the UI path (not just the API path).

N2.1 is a narrow hotfix. It ships when both fixes land and end-to-end UI-driven session spawn is demonstrable from a `pnpm build:app` artifact launched from Finder.

---

## §1 — Background: what Jose's dogfood surfaced

On 2026-04-22 Jose ran:

```bash
cd ~/Desktop/Projects/jstudio-commander/native-v1
pnpm build:app
```

Opened the resulting `Commander.app` from Finder. Observed:

1. **UI renders correctly.** Sidebar, Commander heading, "+ New session" button, empty main pane with "Empty pane. Spawn a new session or attach an existing one." message, add-pane controls, 3-pane split view working, Preferences modal (Cmd+,) opening correctly with Shell section toggle visible.

2. **Preferences modal displays error banner:**
   > Sidecar unreachable — tried 127.0.0.1:11002..11011. Ensure the sidecar process is running (Rust shell auto-spawns it in prod; in dev run 'pnpm sidecar:dev').

3. **Session spawn modal (clicked "+ New session" or "New session" in empty pane) is incomplete:** only effort selector visible, no path input, no session type dropdown, no submit button. Jose cannot spawn a session from the UI.

Analysis: Finding 3 is most likely a cascade from Finding 2 — the modal fetches `GET /api/session-types` on mount to populate the type dropdown, and when the sidecar is unreachable, the form gets disabled or renders partially. Fix Finding 2 and Finding 3 likely resolves itself; but CODER verifies end-to-end at close.

Finding 2 is a production-build regression or latent gap. N1 PHASE_REPORT §2 row 2 marked sidecar auto-spawn `✓`. Either:
- N1 smoke was actually tested via dev-mode + manual sidecar, not via `pnpm build:app` → Finder-launch.
- N2 modified bundle-prep scripts or Tauri config in ways that broke production spawn.
- Something about the production `.app` bundle layout (wrapper + dist + node_modules under `Contents/Resources/sidecar/`) is failing at Rust spawn time.

CODER diagnoses root cause in Task 1 below. Root cause determines fix shape.

---

## §2 — Non-negotiable acceptance criteria

The phase is complete when all of the following are demonstrable by Jose running `pnpm build:app` and launching from Finder:

### 2.1 — Production sidecar spawns successfully

Launch `Commander.app` from Finder (no terminal involvement, no `pnpm sidecar:dev` or any dev-mode assist). Within 3 seconds of window opening:

- Sidecar process is running (`ps aux | grep -E "node|sidecar-bin"` shows the sidecar process spawned by Commander).
- Frontend successfully reaches sidecar on port 11002 (or next available in 11002..11011 range).
- Preferences modal (Cmd+,) does NOT show the "Sidecar unreachable" error banner.

### 2.2 — Session spawn modal complete + functional

Click "+ New session" from sidebar OR "New session" in an empty pane. Modal opens with ALL four surfaces:

- **Path picker** (new UX per §2.3 below) — lets Jose select from Recent / Projects / Browse.
- **Session type dropdown** — populated from `GET /api/session-types`, showing PM / Coder / Raw options.
- **Effort dropdown** — same as current N1/N2 behavior; default per session type.
- **Submit button** — enabled when path + type are selected; click triggers `POST /api/sessions` with correct body; on success, modal closes and session appears in sidebar + assigned to the triggering pane.

Full end-to-end test: from Finder-launched `Commander.app`, spawn a PM session on `~/Desktop/Projects/jstudio-meta/` via the UI only (no terminal, no direct API calls). Session appears in sidebar, terminal renders, bootstrap injects, OSC 133 fires, session row in DB. All N1 + N2 behaviors downstream of spawn still work.

### 2.3 — ProjectPathPicker component

The path input is replaced with `ProjectPathPicker.tsx`. Three sections visible in the picker dropdown:

- **Recent** (top section, scrollable): last 10 paths from `preferences.recentProjectPaths` (JSON array of absolute paths with ISO timestamp of last use). Sorted by most-recent-first. Each row shows basename + truncated path + last-used relative timestamp ("2 hours ago", "yesterday", etc.). Empty state: "No recent projects" placeholder.
- **Projects** (middle section): filesystem scan of `~/Desktop/Projects/` one level deep, filtered to directories only. Cached in TanStack Query with 60s staleTime (rescanning every picker-open is wasteful). Each row shows directory name + detection heuristic badge if present (e.g., "React" if `package.json` has react dep, "ERP" if a specific marker file exists — N2.1 keeps detection simple, fancy badge logic is parked for later).
- **Browse...** (bottom, always visible): single row with folder icon and label "Browse...". Click opens native macOS directory picker via `tauri-plugin-dialog` (install if not present). Selected path becomes the current value + gets appended to Recent.

**Default cwd for Raw sessions:**
- Preference key `preferences.rawSession.defaultCwd` with default `~` (expands to user home).
- When Raw session type is selected in the modal, path picker pre-fills with the default cwd (still overridable via picker).
- When PM or Coder type is selected, picker shows no default — Jose must explicitly choose.

**Recent paths lifecycle:**
- On successful session spawn: sidecar appends spawn path to `preferences.recentProjectPaths`. If already present, move to top. Cap list at 10 entries; oldest falls off.
- Preference stored as JSON array of `{path: string, lastUsedAt: number}` in the `preferences` table under scope `global`.

**Visual design:**
- Dropdown opens on click of the input field (standard combobox pattern).
- Search/filter by typing: filters the Recent + Projects sections by substring match (case-insensitive).
- Keyboard navigation: ↑/↓ to navigate, Enter to select, Esc to close.
- Selected path renders in the input field as truncated absolute path with tooltip showing full path on hover.

### 2.4 — All N1 + N2 behavior preserved

N2.1 regression on any N1 or N2 §1 criterion is a release blocker. Specifically verify after §2.1 and §2.2 fixes land:

- All N2 surfaces (ContextBar shape, STATE.md drawer, split view 2-3 panes, workspace persistence, scrollback restore, .zshrc opt-in preference, durationMs tracking, WS heartbeat) still work.
- All N1 surfaces (bootstrap injection, OSC 133, pre-warm pool, single-instance, clean quit via Cmd+Q) still work.
- Bundle size ≤ 36 MB (allowing +1 MB for `tauri-plugin-dialog` + ProjectPathPicker code vs N2's 35 MB).

### 2.5 — End-to-end UI smoke scenario passes

Full smoke covering both fixes in the production build:

1. `pnpm build:app`
2. Open `Commander.app` from Finder (no terminal assist).
3. Verify sidecar auto-spawns within 3s (no error banner in Preferences).
4. Click "+ New session" — modal opens with all 4 surfaces.
5. Path picker shows empty Recent, populated Projects (from `~/Desktop/Projects/`), Browse option.
6. Click a project → path populates → select PM type → Submit → session spawns.
7. Session appears in sidebar + assigned to Pane 1 + terminal renders + bootstrap injects.
8. Close Commander (Cmd+Q).
9. Reopen `Commander.app` from Finder.
10. Click "+ New session" — Recent section now shows the path from step 6 at top.

This is the acceptance smoke. All 10 steps must pass in a single unbroken sequence.

---

## §3 — Task breakdown (5 tasks, ordered)

### Task 1 — Diagnose sidecar-unreachable on production build (HIGH effort, foundational)

Before any code changes, CODER reproduces the failure and identifies root cause.

**Diagnostic steps:**
1. Run `pnpm build:app` in `native-v1/` from a clean state. Note any warnings or errors in build output.
2. Inspect the resulting `.app` bundle contents: `ls -la Commander.app/Contents/Resources/sidecar/` — verify expected wrapper + dist + node_modules layout is present per N1 Task 10's `prepare-sidecar.sh`.
3. Verify `Commander.app/Contents/Resources/sidecar/sidecar-bin-<triple>` exists and is executable (`chmod +x` if not).
4. Launch `Commander.app` from Finder. Immediately check `ps aux | grep -E "node|sidecar"` — is a sidecar process actually spawned by Commander?
5. If sidecar did spawn: check `~/Library/Logs/Commander/` or the Tauri default log location for sidecar stderr. Paste relevant error messages into PHASE_N2.1_REPORT §5.
6. If sidecar did NOT spawn: trace Rust-side spawn attempt. Check `main.rs` `tauri_plugin_shell::Builder::sidecar()` invocation. Does the sidecar path resolution correctly locate `Contents/Resources/sidecar/sidecar-bin-<triple>`? Does the working directory at spawn time correctly contain the `dist/` + `node_modules/` tree?
7. Try spawning sidecar manually from the app bundle: `./Commander.app/Contents/Resources/sidecar/sidecar-bin-darwin-arm64` — does it succeed standalone? If yes, the Rust spawn path is broken. If no, the bundle itself is broken.

**Common root causes (from prior Tauri + native module experience):**
- Bundle layout mismatch between `prepare-sidecar.sh` output and what Rust `sidecar()` API expects — Tauri v2 expects a specific naming convention like `sidecar-bin-<triple>` as the file, with the extension handled automatically. If the wrapper script name deviates, `sidecar()` fails silently.
- Missing `externalBin` entries in `tauri.conf.json` — Tauri needs to know about sidecar binaries at build time to include them in the signed bundle.
- Working directory mismatch — sidecar spawned with cwd pointing somewhere without the `node_modules` flat tree, so `require('node-pty')` fails.
- Node binary not found — wrapper script does `exec node "$DIR/dist/index.js"` but `node` isn't in PATH when launched from Finder (Finder launches have a minimal PATH, typically `/usr/bin:/bin:/usr/sbin:/sbin`). If the wrapper depends on PATH discovery, it fails.
- Gatekeeper quarantine attribute on the wrapper script preventing execution — `xattr -l Commander.app/Contents/Resources/sidecar/sidecar-bin-*` shows `com.apple.quarantine`? If yes, bundle needs `xattr -cr` pass post-build.

**Acceptance:**
- Root cause identified with evidence (log snippets, `ps aux` output, file-path tracing).
- Root cause documented in PHASE_N2.1_REPORT §5 (Issues) before fix implementation.

**Effort:** HIGH. Diagnostic work is unbounded in principle; budget 0.5 day max for diagnosis before escalating.

### Task 2 — Fix production sidecar spawn

Fix identified in Task 1. Exact scope depends on root cause.

**Likely fix shapes (CODER picks based on Task 1 findings):**

- **If Node-in-PATH issue:** change wrapper script to use absolute-path Node resolution OR embed Node binary in the bundle OR use a compile-on-launch approach. Document choice in PHASE_N2.1_REPORT §4 (Deviations) if it requires deviating from §2.1 wrapper approach.

- **If bundle layout issue:** update `prepare-sidecar.sh` to produce the exact layout Tauri's `sidecar()` API expects. Verify against Tauri v2 docs for external binary conventions.

- **If `externalBin` config issue:** add correct entries to `tauri.conf.json`. Rebuild, re-verify.

- **If Gatekeeper quarantine:** add `xattr -cr` pass to build script or Tauri post-build hook. Document in PHASE_N2.1_REPORT §7 (Tech debt) — this is a signing-deferred consequence per N1 acceptance memo §4. May need revisiting when signing un-defers.

- **If working-directory issue:** update Rust `main.rs` spawn invocation to set explicit cwd. ≤150 LOC Rust budget still holds.

**Acceptance:**
- `pnpm build:app` → open `.app` from Finder → sidecar running within 3s (verified via `ps aux`).
- Preferences modal shows no "Sidecar unreachable" error.
- `GET /api/health` from frontend succeeds on initial page load.

**Effort:** Medium depending on root cause. Budget 0.5 day total including any iteration.

### Task 3 — Build `ProjectPathPicker.tsx` component (medium-high)

Implement the picker per §2.3 acceptance.

**File layout:**
- `apps/frontend/src/components/path-picker/ProjectPathPicker.tsx` — main component.
- `apps/frontend/src/components/path-picker/RecentProjectsSection.tsx` — Recent list.
- `apps/frontend/src/components/path-picker/ProjectsScanSection.tsx` — filesystem scan.
- `apps/frontend/src/components/path-picker/BrowseButton.tsx` — Browse... via Tauri dialog.
- `apps/frontend/src/queries/project-paths.ts` — TanStack Query hooks for recent + scan.
- `apps/sidecar/src/routes/projects.ts` — `GET /api/projects/scan?root=~/Desktop/Projects/` endpoint returning one-level-deep dir listing.
- `apps/sidecar/src/routes/preferences.ts` — extend with `GET/PUT /api/preferences/recentProjectPaths`.

**Sidecar scan implementation:**
- Read directory at `root` path (expand `~` via `os.homedir()`).
- Filter to directories only.
- For each directory: quick peek for marker files to determine project type (`package.json` → look for `react`, `next`, etc.; presence of `supabase/` → "Supabase project"; presence of `firebase.json` → "Firebase project"). Heuristic is best-effort; return `null` for type if unclear.
- Return array of `{name, path, detectedType?}`.
- Cache at TanStack Query level with 60s staleTime; fresh scan on staleTime expiry.

**Install dependencies:**
- `@tauri-apps/plugin-dialog` (if not already present from N1/N2) — native directory picker.
- Verify versions match Tauri v2 API expectations.

**Recent paths update on spawn:**
- Sidecar `POST /api/sessions` endpoint (existing): on successful session row insert, append `path` to `preferences.recentProjectPaths`. If path already in list, move to front. Cap at 10 entries.

**Acceptance per §2.3:**
- Picker opens on input click, shows Recent + Projects + Browse sections.
- Keyboard nav works (↑↓ Enter Esc).
- Filter typing works (substring match).
- Browse... opens native picker, selected path becomes value.
- Raw session type pre-fills default cwd `~`.
- Spawn updates Recent (next picker-open shows spawned path at top).
- 10-entry cap enforced.

**Effort:** Medium-high. Picker UX is finicky; keyboard nav + filter + three sections with different data sources is ~0.5-1 day focused work.

### Task 4 — Modal form wiring + fallback handling

Ensure `CreateSessionModal` renders ALL fields regardless of sidecar state.

**Concrete scope:**
- Verify modal mounts with all four fields (path picker, type dropdown, effort dropdown, submit button) visible even when `useSessionTypes()` is in loading or error state.
- Loading state: type dropdown shows "Loading..." placeholder, submit disabled.
- Error state: type dropdown shows "Failed to load session types — is sidecar running?" with retry button. Submit disabled.
- Success state: all fields enabled, submit enabled when path + type selected.

**Purpose:** the N2 screenshot showed a partial modal — likely because sidecar-unreachable cascaded into form blank-out. Task 2 fixes the sidecar issue; Task 4 ensures that even if sidecar DOES go unreachable in future, the modal gracefully communicates the failure rather than silently rendering broken.

**Acceptance:**
- Kill sidecar manually (`kill <pid>`). Open `+ New session`. Modal renders with all fields + "Failed to load session types — is sidecar running?" + retry button.
- Reconnect sidecar. Click retry. Form fills correctly.
- Never silent-half-render state.

**Effort:** Low-medium. ~0.25 day.

### Task 5 — Smoke + PHASE_N2.1_REPORT

Full smoke per §2.5 acceptance scenario. Canonical 10-section PHASE_REPORT filed at `native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md`.

**Effort:** 0.25 day.

---

## §4 — Explicit non-scope for N2.1

N2.1 is a narrow hotfix. These are NOT in scope:

- JSONL parser, cost extraction, renderer registry, ChatThread, approval modal → N3 (next full phase).
- Full native directory picker as standalone (N5) — ProjectPathPicker is a hybrid. Native dialog is one sub-section of the picker (Browse...), not a replacement for the whole path input.
- Project type detection beyond basic heuristic — full auto-detection is a v1.1+ polish item.
- Command palette integration with path picker → N4.
- Named workspaces integration with path picker → N4.
- Code signing (resolving Gatekeeper quarantine permanently) → deferred per N1 acceptance memo §4. N2.1 may apply `xattr -cr` as a workaround if diagnosis shows quarantine is the spawn issue.

If CODER finds themselves building any above, stop and flag in PHASE_N2.1_REPORT §4 (Deviations).

---

## §5 — Guardrails

Same 8 guardrails from N2 + N3 dispatches. Particularly:

- **Guardrail #2 — No silent scope expansion.** N2.1 is narrow by design. Keep it narrow.
- **Guardrail #8 — Surface better approaches with deviation report, never silently second-guess.** If CODER finds that Task 1 root cause actually requires a different fix than Task 2's shape options, report the shape and proceed with the better approach. Do not shoehorn into the options listed.

**Addition specific to N2.1 — root-cause discipline.** Task 1 must be completed before Task 2. Do NOT start implementing fixes before root cause is identified. If diagnosis takes >0.5 day without clear cause, escalate to PHASE_N2.1_REPORT §8 (Questions for PM) with observed evidence and proposed next diagnostic paths.

---

## §6 — Testing discipline

- New sidecar tests: `/api/projects/scan` endpoint (empty dir, populated dir, nonexistent root), `preferences.recentProjectPaths` append/move-to-front/cap-at-10 behavior.
- New frontend tests: `ProjectPathPicker` keyboard nav, filter match, section rendering with empty/populated/error states, modal form fallback handling when session-types query fails.
- Target: +10 sidecar tests (total 68+), +5 frontend tests (ContextBar + SessionPane test coverage still carried forward to N3 per prior ratification; N2.1 only adds path-picker-specific tests).
- `pnpm test` from monorepo root passes all suites.

---

## §7 — Commit discipline

Minimum 5 commits (one per task). Same format as prior dispatches. Scopes: `sidecar`, `shell` (if Rust changes needed for Task 2), `frontend`, `build`, `test`.

---

## §8 — PHASE_REPORT

Canonical 10-section format. Filed at `native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md`. Target length 600-1000 words.

---

## §9 — What PM does

1. Read end-to-end. Verify §1 background matches Jose's dogfood evidence (screenshots referenced).
2. Verify §3 Task 1 diagnostic steps are comprehensive (covers common Tauri + sidecar spawn failure modes).
3. Verify §3 Task 3 ProjectPathPicker scope is complete — all three sections covered, lifecycle (recent updates on spawn) specified, keyboard nav + filter behavior specified.
4. Produce paste-to-CODER prompt:
   - Full dispatch content.
   - Continuing spawn.
   - Required reading: N2 report, prior acceptance memo, ARCHITECTURE_SPEC v1.2, this dispatch.
   - Explicit "Task 1 before Task 2 — no fixes until root cause identified" reminder.
   - Explicit "narrow hotfix, keep scope tight" reminder (Guardrail #2).
5. Flag for CTO ratification if gaps found.

---

## §10 — What Jose does

1. Save to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_DISPATCH_SIDECAR_HOTFIX_AND_PATH_PICKER.md`.
2. Paste in PM: "N2.1 hotfix dispatch saved at `docs/dispatches/N2_1_DISPATCH_SIDECAR_HOTFIX_AND_PATH_PICKER.md`."
3. Wait for PM review + paste-to-CODER prompt.
4. Spawn continuing CODER. Paste prompt.
5. CODER executes. Budget 0.5-1.5 days wall-clock at continuing xhigh.
6. PHASE_N2.1_REPORT → Jose carries to PM → PM review → CTO ratification.
7. After N2.1 closes + Jose re-dogfoods → confirmed-working build → N3 fires.

---

## §11 — Estimated duration + effort

**Per-task effort:**
- Task 1 (diagnose): 0.25-0.5 day, HIGH. Effort unbounded until cause found; schedule guard at 0.5 day.
- Task 2 (fix): 0.25 day, medium-high. Depends on root cause.
- Task 3 (path picker): 0.5-1 day, medium-high. The picker is the larger piece.
- Task 4 (modal form wiring): 0.25 day, low-medium.
- Task 5 (smoke + report): 0.25 day, low.

Total nominal: 1.5-2.25 days fresh-spawn-medium baseline. Continuing xhigh compression factor 0.3-0.5x → actual wall-clock likely 0.5-1 day.

**Token budget:** $300-600 estimated. Narrow scope, efficient execution expected.

---

## §12 — Closing instructions to CODER

N2.1 is a pre-N3 hotfix. Two findings from Jose's dogfood block N3 readiness:

1. Production sidecar spawn fails (`Sidecar unreachable` error in Preferences modal on Finder-launched `pnpm build:app` artifact).
2. Session spawn modal is unusable without path picker (simple text input was N1 scope but in-practice blocks Jose from opening sessions on his actual projects).

Both must be fixed before N3 (JSONL parser + ContextBar live data + renderer registry + approval modal) fires. N3 depends on sidecar being reachable; there's no point building chat surfaces on a broken foundation.

Read in order before coding:

1. This dispatch.
2. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N1_REPORT.md` §4 D2 (wrapper + dist layout rationale).
3. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/PHASE_N2_REPORT.md` §5 Issue 2, §7 Tech debt row 1 (wrapper+dist kept in N2 after SEA escalation).
4. `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md` §4 (signing deferred — consequence: potential Gatekeeper quarantine issues).
5. `~/Desktop/Projects/jstudio-commander/docs/native-v1/ARCHITECTURE_SPEC.md` v1.2 §8 Sidecar process model (for production-spawn conventions).
6. Tauri v2 docs on sidecar/externalBin conventions — specifically the `sidecar()` API contract and bundle layout expectations.

**Do Task 1 first. Do not start Task 2 until Task 1 has identified a root cause with evidence.**

When all 5 tasks pass + §2 acceptance criteria demonstrable in single end-to-end smoke: write PHASE_N2.1_REPORT.md, file at `native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md`, notify Jose for carry to PM.

---

**End of N2.1 dispatch. Ready to fire.**
