# N2.1.3 Hotfix Dispatch — OSC 133 Path Resolution + Exhaustive Production Smoke

**Dispatch ID:** N2.1.3
**From:** CTO
**To:** PM → continuing CODER
**Depends on:** N2.1.2 CLOSED (10/16 smoke + 1 fail + 1 partial-critical), `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0, ARCHITECTURE_SPEC v1.2
**Triggered by:** Jose's N2.1.2 smoke: step 11 OSC 133 fails, step 10 Claude Code never starts, spawn broken in production `.app` due to hook path resolution.
**Duration:** 0.5-1 day continuing CODER at xhigh. Budget $300-500.

---

## §0 — Why this dispatch is slightly wider than PM proposed

PM recommended 3-4 tasks. Dispatch ships with 5 because of an accumulated-debt observation worth naming:

N2.1.3 is the **fifth hotfix in a row** between N2 close and N3 start (N2.1, N2.1.1, N2.1.2, N2.1.3). Each one narrow and justified. Collectively, we've been discovering "never exercised in production build" bugs one layer at a time — sidecar spawn, CSP, modal selection, OSC path. Each hotfix finds the next latent bug.

The single exhaustive production-build smoke we never ran at N1 close would have caught all four in one rotation. SMOKE_DISCIPLINE.md prevents this class going forward, but we're still paying accumulated debt.

**Task 4 below is explicitly that belated exhaustive smoke**: run every feature we believe ships in v1 through the production `.app` bundle once. Surface all remaining latent bugs in one rotation, not across N2.1.4 / N2.1.5 / N2.1.6.

Cost: +0.25 day. Benefit: breaks the hotfix-chain pattern.

---

## §1 — Acceptance criteria (SMOKE_DISCIPLINE.md compliant)

From Jose's Finder-launched `pnpm build:app:debug`:

**1.1 — OSC 133 hook loads correctly in production build.** Spawn any session type (PM/Coder/Raw) from Finder-launched `.app`. Zsh starts, hook sources without `no such file or directory` error, and on first shell prompt, sidecar emits typed `command:started` event (verifiable via Tauri DevTools Console tab or debug log).

**1.2 — Claude Code boots in all three session types.** PM session: Claude Code starts, pm-session-bootstrap.md is written to pty.stdin as first input, persona-acknowledgment response renders. Coder session: same with coder-session-bootstrap.md. Raw session: Claude Code starts without bootstrap, default welcome renders.

**1.3 — Full N2.1.1 §3.3 16-step smoke passes** (including steps previously blocked).

**1.4 — Exhaustive production-build smoke (Task 4) surfaces any remaining latent bugs.** If new bugs surface: report in §5 + §8, don't fix in this dispatch. Scope for potential N2.1.4 if narrow, or escalate if wider.

**1.5 — No regression on N1/N2/N2.1/N2.1.1/N2.1.2 held behaviors.**

---

## §2 — Non-scope (explicit)

- UI polish bugs Jose surfaced in N2.1.2 feedback: multi-pane layout overlaps at 3+ panes, drawer/scroll/button responsiveness, kill-session UI. **Routed to dedicated UI polish phase after N3, OR folded into N3 if N3's narrower scope makes room.** Not in N2.1.3.
- macOS TCC prompts: standard unsigned-app behavior, parked per D5.
- Any N3 scope (JSONL parser, renderer registry, ChatThread, approval modal).

---

## §3 — Tasks

### Task 1 — Diagnose OSC 133 path resolution (empty evidence commit per G10, layer-named per G11)

CODER verifies PM's hypothesis:
- `ls Commander.app/Contents/Resources/resources/osc133-hook.sh` confirms hook bundled at top-level `resources/`.
- Sidecar `__dirname`-relative path `path.join(__dirname, '../resources/osc133-hook.sh')` resolves to `Contents/Resources/sidecar/dist/../resources/osc133-hook.sh` → `Contents/Resources/sidecar/resources/osc133-hook.sh` (wrong — extra `sidecar/` segment).
- Terminal error `zshrc:source:5: no such file or directory` confirms the sourced path doesn't exist.

Diagnostic evidence committed to `native-v1/docs/diagnostics/N2.1.3-osc-path-evidence.md` before any fix. Commit message per G11: "diagnostic: OSC hook path mismatch at bundle-resource-path layer (sidecar __dirname-relative vs Tauri bundle.resources top-level)".

**Effort:** 0.1 day.

### Task 2 — Fix OSC hook path resolution

Two fix options. CODER picks based on Task 1 evidence + Tauri v2 conventions:

**Option A — Tauri-aware resource API.** Rust shell exposes `get_resource_path(name)` Tauri IPC command using `app.path_resolver().resolve_resource()`. Sidecar queries Rust at startup for hook path, caches result. Dev mode returns dev-relative path; prod returns bundle-resolved path. Works for any future bundled resource.

**Option B — Adjust `tauri.conf.json` bundle.resources.** Put hook under `sidecar/resources/osc133-hook.sh` in the bundle so sidecar's `__dirname`-relative path works unchanged. Narrower fix, but couples bundle layout to sidecar internals.

**Preference:** Option A. Resource path is a Tauri concern; Rust owns it. Future resources (icons, templates, defaults) benefit from the same API. ~20-30 Rust LOC (well within ≤150 budget).

If CODER picks Option B with rationale in §4 Deviations, acceptable.

**Acceptance per §1.1 + §1.2:** all three session types boot Claude Code + bootstrap + OSC 133 fires on first prompt from Finder-launched production build.

**Effort:** 0.15-0.25 day.

### Task 3 — Smoke-readiness verify all 3 session types

CODER launches `pnpm build:app:debug` from Finder. Spawns one session of each type (PM/Coder/Raw) on a real project. For each:
- Terminal renders.
- Zsh starts, OSC hook sources without error.
- Claude Code boots.
- Bootstrap injects (PM/Coder) or default welcome shows (Raw).
- First prompt triggers OSC 133 `command:started` event (verifiable via DevTools Console or sidecar debug log).
- User can type a prompt and get a response.

This is CODER smoke-readiness per SMOKE_DISCIPLINE §3.4, NOT user-facing smoke. Jose still runs the 16-step in Task 5.

**Effort:** 0.1 day.

### Task 4 — Exhaustive production-build cold-path smoke (NEW, accumulated-debt payoff)

CODER runs an exhaustive end-to-end sweep in `pnpm build:app:debug` covering every v1 feature that SHOULD work as of N2.1.3 close. Intent: surface all remaining "never exercised in production" latent bugs in one rotation.

**Sweep checklist** (every item is a pixel-observable pass/fail):

**Spawn paths:**
- [ ] Spawn PM session via + New session button in sidebar.
- [ ] Spawn Coder session via + New session in sidebar.
- [ ] Spawn Raw session via + New session in sidebar.
- [ ] Spawn via + New session button inside an empty pane.
- [ ] Spawn from Recent section of path picker.
- [ ] Spawn from Projects section of path picker.
- [ ] Spawn via Browse... native dialog.

**Session lifecycle:**
- [ ] Bootstrap injects at correct moment (terminal shows bootstrap content before user can type).
- [ ] OSC 133 A/B/D markers fire (verifiable via debug log).
- [ ] `command:ended.durationMs` non-zero after a real command completes.
- [ ] Running `sleep 2` shows durationMs between 1900-2100ms.
- [ ] Clicking Stop button during active output sends SIGINT, terminal shows ^C.
- [ ] Closing session from UI preserves other sessions.

**Multi-session:**
- [ ] Pane 2 spawns second session.
- [ ] Pane 3 spawns third session.
- [ ] Cmd+Opt+→/← cycles focus between panes.
- [ ] Keyboard input routes to focused pane only.
- [ ] Pre-warm pool active (second+ spawns faster than first cold spawn — verifiable via observable latency from submit to terminal-render).

**STATE.md drawer:**
- [ ] Drawer renders with 4 tabs.
- [ ] Content displays for each tab.
- [ ] External edit to STATE.md refreshes drawer within 500ms.
- [ ] Drawer width resizable via drag handle.
- [ ] Drawer collapse/expand works.
- [ ] Drawer state persists across Cmd+Q + reopen.

**Preferences:**
- [ ] Cmd+, opens Preferences modal.
- [ ] `.zshrc` opt-in toggle works; state persists.
- [ ] Toggling on and spawning new session: user rc sourced (verify by setting an alias in ~/.zshrc, verify alias works in new Commander session).
- [ ] Toggling off: hook-only session.

**Persistence:**
- [ ] Cmd+Q with 2-3 active sessions → reopen → workspace restored (sessions in correct panes, pane sizes preserved, drawer states preserved).
- [ ] Scrollback restored for each session (terminal shows same content as before quit).

**WebSocket resilience:**
- [ ] Kill sidecar manually (`kill <pid>` from terminal). Frontend detects disconnect within 20s.
- [ ] Rust respawns sidecar. Frontend reconnects. Active sessions resume receiving pty data.

**Path picker:**
- [ ] Recent section shows last 10 spawned paths at top, most recent first.
- [ ] Recent populated after any successful spawn.
- [ ] Filter-by-typing works.
- [ ] Keyboard nav (↑/↓/Enter/Esc) works.

**Every failed item goes in PHASE_N2.1.3_REPORT §4 (Deviations) + §5 (Issues) + §7 (Tech debt). CODER does NOT fix any failures in Task 4 — scope stays narrow. Fixes happen in a subsequent dispatch scoped to observed failures OR in N3 if polish-adjacent.**

This is the belated N1-close smoke we should have run four hotfixes ago. Running it now breaks the pattern.

**Effort:** 0.15-0.25 day.

### Task 5 — PHASE_REPORT + Jose user-facing 16-step smoke

CODER files PHASE_N2.1.3_REPORT with SMOKE_DISCIPLINE §5 format. §3 user-facing smoke row marked PENDING. §4-§7 populated with any findings from Task 4 sweep.

Jose runs N2.1.1 §3.3 16-step smoke as user-facing confirmation. PM appends outcome.

**Effort:** 0.05 day CODER + ~15 min Jose.

---

## §4 — Guardrails

Inherited: G1-G11 + G12 (dep hygiene). Particularly:
- **G10 — Root-cause before fix.** Task 1 empty evidence commit before Task 2.
- **G11 — Smoke layer naming in diagnostic commits.** "bundle-resource-path layer" for Task 1.
- **G12 — Dep declaration hygiene.** Any package.json changes ship in same commit as imports.

**New for this dispatch — soft guardrail:** Task 4 is a surveying task, not a fixing task. Resist temptation to fix items encountered during the sweep. Report them; scope them; defer them. Keeping Task 4 narrow is the discipline that makes the whole dispatch worthwhile.

---

## §5 — Required reading

1. This dispatch.
2. `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md` v1.0.
3. `native-v1/docs/phase-reports/PHASE_N2.1.2_REPORT.md` including §3 user-facing smoke outcome.
4. `apps/sidecar/src/pty/` (where __dirname-relative path lives).
5. Tauri v2 docs on `PathResolver::resolve_resource()` API + `bundle.resources` conventions.

---

## §6 — Jose's TODO

1. Save to `~/Desktop/Projects/jstudio-commander/docs/dispatches/N2_1_3_DISPATCH_OSC_PATH_AND_EXHAUSTIVE_SMOKE.md`.
2. Paste in PM: "N2.1.3 dispatch saved."
3. PM produces paste-to-CODER.
4. Continuing CODER executes. ~0.5-1 day.
5. Jose runs N2.1.1 §3.3 16-step user-facing smoke.
6. PM appends outcome to PHASE_N2.1.3_REPORT §3.
7. **If 16/16 pass AND Task 4 sweep surfaces ≤2 narrow new bugs:** optionally fold those into a tiny N2.1.4 if absolutely blocking, OR carry into N3 scope review as input. Then 3-5 day dogfood window per D31.
8. **If 16/16 pass AND Task 4 sweep is clean:** N2.1.3 closes. Dogfood window starts immediately.
9. **If <16/16 OR Task 4 surfaces substantial issues:** CTO reviews, scopes next move.

---

**End of dispatch.**
