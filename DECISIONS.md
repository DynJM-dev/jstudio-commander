# Decisions — JStudio Commander

**Purpose:** Append-only record of architectural + operational decisions ratified for the Commander project. New decisions added at top. Rationale captured alongside each decision so context travels with the record.

**Canonical four-file structure:** `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`, `DECISIONS.md` per OS §6. This file was created 2026-04-22 as the first decision-record entry for Native v1 N1 acceptance.

---

## 2026-04-22 — N2.1.2 dispatched + G12 dependency hygiene codified

**Context:** CTO response to N2.1.1 PARTIAL SHIP (5/16 smoke, 2 fail steps 8+9, 8 blocked). Narrow hotfix dispatch + G12 guardrail codified in response to PM's commit-hygiene finding on N2.1.1.

### D29 — N2.1.2 hotfix scope accepted

Four-task hotfix at `docs/dispatches/N2_1_2_DISPATCH_MODAL_SELECTION_COMMITS.md` (110 lines): T1 diagnose selection commits via webview DevTools (empty evidence commit per G10, layer-named per G11); T2 fix both selection-commit bugs in `NewSessionModal.tsx`; T3 CODER smoke-readiness exercise of N2.1.1 steps 10-16 never-run-in-prod (report new latent bugs, do NOT fix — potential N2.1.3); T4 PHASE_REPORT + Jose user-facing smoke. Duration 0.25-0.5 day continuing CODER, budget $150-300. Scope stays narrow: if Task 3 surfaces bugs in spawn chain, they surface for potential N2.1.3, not absorbed.

### D30 — G12 codified: Dependency declaration hygiene

Guardrail G12 formally added to all future phase dispatches: any commit that adds `import` statements for a new package MUST also include the matching additions to `package.json` + lockfile in the same commit. Fresh-clone-and-install from any commit in the repo must produce a buildable state.

**Precedent cited in dispatch §3:** N2.1.1 Task 2 commit `d376d50` imported `@fastify/cors` without dep declarations. PM cleaned up at `61669f0`. Silent fresh-clone breakage would not surface in CODER's existing-workspace testing.

**Verification method:** CODER runs `pnpm install --frozen-lockfile` after each dep-touching commit.

**Applies:** N2.1.2 forward. Standing reminder auto-included in every paste-to-CODER prompt per `feedback_coder_commit_hygiene_dep_additions` memory.

### D31 — Post-N2.1.2 framing: dogfood window before N3

If Jose 16/16 passes N2.1.2 user-facing smoke: **3-5 day dogfood window begins for real-use observation** before CTO drafts N3 scope review. N3 fire is NOT immediate. CTO's N3 scope gets informed by Jose's dogfood observations (ContextBar UX feel, split view ergonomics, STATE.md drawer utility under real work, scrollback restore fidelity, pre-warm pool responsiveness, workspace persistence across real sessions, any latent issues surfacing under real-work pressure).

Framing benefit: N3 is the largest upcoming phase (renderer registry + JSONL parser + ContextBar live data + ChatThread + approval modal + frontend test suite). Dogfood-informed scope prevents building on unvalidated foundation.

---

## 2026-04-22 — SMOKE_DISCIPLINE.md v1.0 landed + N2.1.1 hotfix dispatched

**Context:** Jose re-dogfood on N2.1 SURFACED two failures Jose's live smoke caught but CODER's automated smoke missed. Same pattern as N2's post-ship modal gap. Two hits in two rotations confirms architectural discipline gap, not one-off. CTO authored SMOKE_DISCIPLINE.md v1.0 as structural fix + N2.1.1 hotfix dispatch.

### D25 — SMOKE_DISCIPLINE.md v1.0 landed as core operating-model standard

Location: `~/Desktop/Projects/jstudio-meta/standards/SMOKE_DISCIPLINE.md`. Committed + pushed in jstudio-meta at `70c7310` (2026-04-22). OS §23.7 v6 changelog entry documents motivation + principle + §20.LL-L15 fold queued for next retrospective.

**Core principle:** every phase dispatch's §1 acceptance criteria and §9 smoke scenario MUST be specified at the outermost user-facing layer — Finder-launched `.app` + UI interactions + pixel observations — NOT intermediate layers (curl / ps aux / API endpoints / scripted headless smoke / dev-mode). All intermediate layers are valid for CODER's diagnostic work; none substitute for outermost smoke.

**Load-bearing clauses:**
- §3.1: acceptance criteria worded in terms of what Jose observes on screen, not what a component returns internally.
- §3.2: §9 smoke scenario structure — start from zero, proceed via UI only, observe via pixels, terminate with clean shutdown + re-launch.
- §3.4: **CODER CANNOT self-certify user-facing smoke.** CODER's smoke-readiness check (build succeeds + Finder-launch produces window) is prerequisite, not substitute. Jose-run user-facing smoke is the phase-close gate from N2.1.1 forward.
- §5: PHASE_REPORT §3 format updated — CODER reports automated suite + smoke-readiness; Jose's user-facing smoke outcome appended by PM after dogfood.

**Applies to:** all phase dispatches N2.1.1 forward. Retroactive application to N1 / N2 / N2.1 not required.

Sits alongside `INVESTIGATION_DISCIPLINE.md` as core operating-model standard. Both apply OS §20.LL-L14 (ground-truth over derivation) to different operational concerns: investigation (bug diagnosis) + smoke (acceptance verification).

### D26 — N2.1.1 hotfix dispatch ready to fire with SMOKE_DISCIPLINE compliance

Dispatch at `docs/dispatches/N2_1_1_DISPATCH_WEBVIEW_FETCH_AND_SMOKE_DISCIPLINE.md` (378 lines, 12 sections, 5 tasks, 0.5 day xhigh continuing, $200-400 budget). First dispatch authored under SMOKE_DISCIPLINE.md v1.0 — its §7 smoke section is the reference template for all future dispatch smoke sections.

**Tasks:**
- T1 re-diagnose via webview DevTools (NOT curl) + empty evidence commit per G10 + evidence filed at diagnostic artifact path.
- T2 fix webview fetch per T1 evidence — preference-ordered CSP first as lowest-scope.
- T3 picker auto-close fix.
- T4 persistent DevTools toggle (Option A env var / Option B preference / Option C separate debug build — CODER judgment).
- T5 PHASE_N2.1.1_REPORT with new §3 format + CODER smoke-readiness only + Jose 16-step UI smoke + PM appends result.

**New guardrails codified:** G9 SMOKE_DISCIPLINE compliance mandatory + G10 root-cause before fix (N2.1 G3 reiterated) + G11 smoke layer identification in diagnostic commits ("diagnostic: webview Network tab shows /api/health blocked by CSP (WKWebView layer)" NOT "diagnostic: fetch fails").

PM review verdict: 100% SMOKE_DISCIPLINE compliant, zero gaps requiring CTO ratification. Ready to fire with continuing CODER spawn.

### D27 — N2.1 "SHIP-GREEN" claim reversed

N2.1 PM review verdict "SHIP-GREEN pending Jose UI smoke" was premature — the Jose UI smoke was the actual gate and it failed. Future dispatches must NOT use "SHIP-GREEN conditional on Jose smoke" framing; use "automated acceptance PASS, awaiting Jose user-facing smoke for CLOSED status" per SMOKE_DISCIPLINE.md §5 PHASE_REPORT format. Language discipline change documented for future PM reviews.

### D28 — N3 re-parked pending N2.1.1 close

N3 dispatch remains drafted + parked. When N2.1.1 closes + Jose's 16-step smoke passes: CTO revisits N3 dispatch, validates §9 smoke section against SMOKE_DISCIPLINE.md compliance (may fold amendments), N3 fires on SMOKE_DISCIPLINE-compliant foundation. N3's larger surface area (renderer registry + ChatThread + approval modal + frontend tests) has more layers and more surface for the same class of gap — structural discipline now in place prevents recurrence.

---

## 2026-04-22 — N2.1 SHIPPED (automated acceptance PASS, pending Jose UI smoke)

**Context:** CODER M2.2 continuing spawn shipped N2.1 in ~1.5h wall-clock. 4 task commits + 1 report = 5 commits. Tests 58 → 71 (+13). Bundle 35 MB held. Rust 138/150. Zero N1/N2 regression. PHASE_N2.1_REPORT at `native-v1/docs/phase-reports/PHASE_N2.1_REPORT.md`.

### D20 — Task 1 root-cause-first discipline pattern canonicalized

CODER followed §5 + OS §20.LL-L11 literally: empty evidence commit `252cf04` BEFORE any fix. This is the canonical pattern for hotfix rotations requiring diagnosis-first. Future diagnostic-rotation dispatches should explicitly cite D20 as the pattern to follow — "file evidence commit before fix commit." Earned-lesson banked.

### D21 — Root cause A (`SIDECAR_BIN` mismatch) was a latent N1 defect

The Rust constant `SIDECAR_BIN = "jstudio-commander-sidecar"` didn't match `tauri.conf.json` externalBin basename `"sidecar-bin"`. `app.shell().sidecar()` returned ENOENT from Tauri's lookup table — the wrapper script was never invoked in production builds. **Defect sat latent through N1 + N2 because neither phase's smoke actually exercised the Rust spawn path** — both validated the wrapper standalone via direct invocation. Jose's dogfood was the load-bearing verification layer.

**Reinforces D19** — dogfood-before-next-phase pattern. Confirms the lesson is architectural discipline, not one-off observation. All future native-v1 dispatch §2 acceptance criteria must include explicit "exercise via Finder-launched `.app` with `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin` OR `open -a Commander.app` via UI only" smoke. Non-negotiable going forward.

### D22 — Wrapper Node-discovery strategy shipped

Finder-launched apps inherit `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Wrapper now walks:
1. `JSTUDIO_NODE_BIN` env var (user-overridable)
2. `$PATH` search
3. 7 standard install paths (`/usr/local/bin/node`, `/opt/homebrew/bin/node`, etc.)
4. NVM autodetect (`$HOME/.nvm/versions/node/*/bin/node`)
5. User-facing error message if all miss

Tech debt filed: discovery covers ~8 known install paths; unknown layouts (corporate installs, Apple Developer Tools node with different majors) could slip through. Expand as user reports land or ship `JSTUDIO_NODE_BIN` Preferences UI knob (LOW priority).

### D23 — §8 PM verdicts for CTO relay (pending Jose smoke + relay together)

- Q1 partial automated smoke: ACCEPTABLE for N2.1 close. Webdriver harness scoped in parallel with N3, not blocking. PM recommendation for CTO ratification.
- Q2 bundle target: Already resolved per D11 (wrapper+dist indefinitely). No change needed for N3 firing. PM reiterates prior ratification.

### D24 — PM recommendation for CTO N3 dispatch addendum

Per CODER §9 recommendation #1 + D19 reinforced by D21: CTO must include explicit Finder-launched smoke in N3 dispatch. Specifically codify one of: `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin <binary-path>` OR `open -a Commander.app` as required smoke step. Catches the latent-defect class N2.1 exposed. PM relays with smoke-verdict to CTO.

---

## 2026-04-22 — N2.1 hotfix dispatched (post-N2 dogfood findings)

**Context:** Jose ran `pnpm build:app` + Finder-launched `Commander.app` post-N2 acceptance. Two findings surfaced blocking N3: production sidecar spawn fails (Preferences modal shows "Sidecar unreachable — tried 127.0.0.1:11002..11011"); session spawn modal only shows effort selector (missing path input, type dropdown, submit button — likely cascade from sidecar-unreachable via `useSessionTypes()` failure). CTO filed narrow N2.1 hotfix dispatch.

### D15 — N2.1 hotfix scope accepted

Five-task hotfix before N3 fires: Task 1 diagnose (HIGH effort, root-cause-first discipline explicit); Task 2 fix per Task 1 findings; Task 3 ProjectPathPicker (promoted from deferred to N2.1 scope per Jose ratification); Task 4 modal form defensive wiring (loading/error/success states regardless of sidecar state); Task 5 end-to-end 10-step smoke + PHASE_N2.1_REPORT. Duration 0.5-1 day continuing xhigh, budget $300-600.

### D16 — ProjectPathPicker promoted from deferred to N2.1 scope

Per Jose's dogfood ask — typing absolute paths for every session is friction he's experiencing daily. Scope: Recent section (top 10 paths from `preferences.recentProjectPaths`, JSON array of `{path, lastUsedAt}` stored under scope `global`); Projects section (filesystem scan of `~/Desktop/Projects/` one level deep, 60s TanStack Query staleTime, optional project-type heuristic badges); Browse section (native macOS directory picker via `tauri-plugin-dialog`). Keyboard nav (↑↓ Enter Esc), substring filter, default cwd `~` for Raw sessions, spawn updates Recent (append + move-to-front + 10-entry cap).

### D17 — Root-cause-first discipline explicit in N2.1 §5

"Task 1 must be completed before Task 2. Do NOT start implementing fixes before root cause is identified. If diagnosis takes >0.5 day without clear cause, escalate to PHASE_N2.1_REPORT §8 (Questions for PM) with observed evidence." Matches OS §20.LL-L11 instrumentation-before-fix discipline + `standards/INVESTIGATION_DISCIPLINE.md`.

### D18 — N3 deferred pending N2.1 close

N3 dispatch remains valid and parked (JSONL parser + ContextBar live data + renderer registry + approval modal + ChatThread + frontend tests). May get minor §9 smoke-scenario addendum: "exercise via UI only, not direct API calls" — belt-and-suspenders against the "CODER tested HTTP path but not UI flow" pattern N2 exposed. No rewrite needed.

### D19 — Dogfood-before-next-phase pattern earned

N2's 42/42 sidecar tests passing + PHASE_REPORT acceptance checks did NOT surface the production Finder-launch failure because CODER tested via `pnpm tauri:dev` + direct HTTP + sidecar tests, not via `pnpm build:app` + Finder-launch + UI click-through. Jose's dogfood was the load-bearing verification layer that unit-green missed. **Going forward**: dispatch §2 acceptance criteria must include "exercise via Finder-launched `.app` via UI only" explicit smoke — not HTTP or dev-mode. Banked as dispatch-writing discipline for all future native-v1 phases.

---

## 2026-04-22 — N2 CLOSED + CTO §8 ratifications + v1.4 spec fold queue

**Context:** CTO ratified PHASE_N2_REPORT 2026-04-22. All 6 §4 deviations ACCEPTED as §5-authorized. All 3 §8 PM recommendations ratified verbatim. v1.4 spec fold queue staged (3 minor corrections, batch-fold at PM convenience, NOT blocking N3). Jose answering one sequencing question on CTO side.

### D11 — §8 Q1/Q2/Q3 CTO ratifications (verbatim PM recommendations)

**Q1 — Bundle size target revision.** RATIFIED: accept wrapper+dist indefinitely for personal-use v1.0. Ties to D5 signing-deferred philosophy. External-distribution trigger un-defers alongside signing. §16.5 target language revised in v1.4 fold queue.

**Q2 — ContextBar data hydration path.** RATIFIED: N3 dispatch §2 architectural contract specifies event-shape → cost_entries mapping up front. ContextBar placeholders become live data via one-line useQuery addition per CODER §9 recommendation. No architectural rework mid-N3.

**Q3 — Frontend test coverage carry-over.** RATIFIED: fold into N3, NOT dedicated N2.5 phase. N3 target: 70%+ frontend coverage. Explicit RTL requirements in N3 §6 for ContextBar + SessionPane + WorkspaceLayout (N2 carry-over debt) + renderer registry + approval modal + ChatThread (N3 scope).

### D12 — v1.4 spec fold queue (PM batch-folds at convenient moment)

Three minor corrections accumulated across N1 + N2 deviations. CTO notes these are NOT blocking N3; PM folds as one batch.

- **§8.2 WebviewWindow origin** (from N1 D3) — already folded in v1.3 2026-04-22. Re-listed by CTO for batch context; no action needed in v1.4 if v1.3 already has it.
- **§5.4 FSEvents via `tauri-plugin-fs` OR sidecar Node fs.watch** (from N1 D5 + N2 D4) — v1.3 folded the plugin-name correction. v1.4 EXTENSION: adds explicit preference for sidecar fs.watch when sidecar owns file I/O domain (matches N2's STATE.md drawer implementation). New content vs v1.3.
- **§16.5 Bundle target revised** (from N2 D1 SEA escalation) — wrapper+dist layout inside `.app` with single-binary SEA deferred pending Node runtime shrink or external distribution trigger. New content.

### D13 — Calibration datum banked for future dispatch sizing

CTO banked: 2.5h wall-clock N2 vs 6-8 day estimate = ~0.15-0.25× estimate when continuing spawn + xhigh effort + additive UI scope. Factor to apply in future dispatch duration estimates matching those conditions. N3 at estimated 7-10 days with CONTINUING spawn + substantial new scope (renderer registry + ChatThread + approval modal + frontend tests) may come in at 2-3× faster if pattern holds — worth tracking.

### D14 — N3 sequencing question pending Jose answer

Three options Jose evaluates on CTO side:
- (A) Draft N3 now in parallel with Jose dogfood. Lower latency. Risks CTO tokens on scope dogfood may invalidate.
- (B) Pause-to-dogfood first, then CTO drafts N3 with dogfood feedback incorporated. PM recommendation — cleanest data flow.
- (C) N3a+N3b split. CTO returns with split definition if Jose picks this.

**PM lean (B)** per `feedback_understand_before_patching` + investigation-first discipline: N3 scope depends on dogfood outcomes (ContextBar shape validation, split view UX feedback, STATE.md drawer behavior). Better to have that input before N3 draft than to amend after.

---

## 2026-04-22 — Native v1 N2 SHIPPED + §8 PM recommendations ready for CTO relay

**Context:** CODER M2.2 (continuing spawn) shipped N2 in ~2.5h wall-clock, 9 commits, 58/58 sidecar + 10/10 shared + 10/10 db tests passing, bundle 35 MB (+1 MB for all N2 features). 8 of 10 §1 criteria fully demonstrable; §1.1 SEA ESCALATED per dispatch §3 Task 1 explicit fallback; §1.2 ContextBar PARTIAL (shape final, live metrics pending N3). §1.10 N1 regression guard HELD.

### D8 — N2 acceptance posture pre-CTO-ratification

PM review of PHASE_N2_REPORT complete. All 6 §4 deviations §5-authorized (dispatch §5 "surface better approaches" clause applied cleanly — D3 lesson codified in CODER behavior). No silent scope expansion. Report ready for CTO ratification.

### D9 — SEA escalation outcome posture (pending CTO ratification)

Task 1 SEA bundling is **mathematically incompatible with §16.5 target** (Node 22 stripped binary = 65 MB alone; ≤55 MB bundle impossible). Three options surfaced by CODER + PM recommendation:
- (a) Revise §16.5 target to ≤80 MB so SEA becomes achievable.
- **(b) Accept wrapper+dist indefinitely for personal-use v1.0** (PM recommendation).
- (c) Commit to Rust-sidecar rewrite in dedicated migration phase (N6+).

**PM recommendation (b):** Node 22 is already on every dev machine (zero real user friction); revising target forces SEA work for marginal UX improvement; (c) is a full re-architecture not justified for personal app. Revisit when D5 un-defer triggers fire (external distribution). CTO ratification pending.

### D10 — N3 dispatch scoping pre-draft (PM recommendations for CTO)

Three items for CTO to bake into N3 dispatch:
- **ContextBar data hydration** (Q2): specify event-shape → cost_entries mapping up front in N3 §2 architectural contract. Prevents mid-flight reframes. Low-cost addition.
- **Frontend test coverage** (Q3): fold RTL suite into N3 scope (NOT dedicated N2.5 phase). N3 already adds renderer registry + ChatThread + approval modal UI surface requiring tests. N3 likely 7-10 days vs N2's 2.5h.
- **N3 JSONL parser placement** (CODER §9 recommendation): emit events onto existing WS bus, not separate pipeline. Existing `session:state` + `tool:use` / `tool:result` / `approval:prompt` event shapes in packages/shared/src/events.ts already anticipate this. Land parser as new module alongside orchestrator, not rewrite.

### Tech debt trail from N2 (7 items filed, severity calibrated)

All documented in PHASE_N2_REPORT §7 at OS §24.3 match-site level:
- SEA/single-binary sidecar (MEDIUM → externalized per D9)
- ContextBar placeholders (LOW — selector-swap when N3 data lands)
- fs.watch ENOENT re-arm edge (LOW ~2hr)
- Frontend test coverage = 0 (MEDIUM — ~1 day RTL suite, folds into N3 per D10)
- Frontend bundle 848 KB / 235 KB gzip (LOW — dynamic imports ~4hr)
- `.zshrc` timeout-guard simplified (LOW — re-evaluate if user reports land)
- No beforeunload-serialize on Tauri Cmd+Q (LOW ~2hr Tauri IPC flush)

No HIGH-severity debt introduced. Nothing load-bearing for v1.0.0 that isn't N3-scoped or explicitly externalized.

---

## 2026-04-22 — N1 ACCEPTANCE MEMO + ARCHITECTURE_SPEC v1.3 + N2 DISPATCH READY

**Context:** CTO filed `N1_ACCEPTANCE_MEMO.md` + `N2_DISPATCH_UI_SURFACES.md`. Signing decision crystallized (deferred indefinitely, not N1.1). v1.3 spec corrections folded by PM. N2 ready to fire.

### D5 — Signing DEFERRED INDEFINITELY (supersedes earlier D2 "dedicated N1.1")

Code signing + notarization deferred until external distribution becomes real. **No N1.1 dispatch drafted.** Signing is a parked item, not a pending dispatch. Jose is sole user per §16.10 ratification; Gatekeeper right-click on first launch of each new build is acceptable personal-use friction vs $99/year Apple Developer Program enrollment for unused distribution capability.

**Un-defer triggers** (any one):
- Jose shares Commander v1 with anyone beyond himself (team, client, collaborator).
- Jose pursues Commander v1 (or successor) as an external product.
- Gatekeeper per-build friction exceeds perceived $99/year cost.

When un-deferral triggers, CTO drafts a narrow dispatch: Apple Developer Program enrollment → cert install → `tauri.conf.json` signingIdentity → rebuild → notarytool → Gatekeeper smoke. Estimated <1hr CODER time once cert on build machine.

### D6 — ARCHITECTURE_SPEC.md folded to v1.3 by PM at 2026-04-22

Two CODER-surfaced N1 deviations fold back into the canonical spec per N1_ACCEPTANCE_MEMO §7:

- **§5.4 FSEvents plugin correction** — `tauri-plugin-fs-watch` (v1-only crate, doesn't exist in v2) → `tauri-plugin-fs` (Tauri v2's unified fs plugin). Matches DEV5.
- **§8.2 WebviewWindow origin revision** — previous draft specified sidecar HTTP URL; corrected to Tauri's standard `frontendDist` / `devUrl` pattern with `/api/health` probe at 11002..11011 for sidecar URL discovery. `get_sidecar_url()` Tauri IPC command implemented but unused in default path. Matches DEV3.

**Lesson banked:** spec should cite substrate conventions where they exist rather than derive orthogonally. Before specifying an implementation model, check whether the substrate has a conventional pattern that already solves the problem.

### D7 — N2 dispatch ratified, ready to fire

`N2_DISPATCH_UI_SURFACES.md` reviewed against v1.3 + N1_ACCEPTANCE_MEMO:
- §1 10 acceptance criteria map cleanly to v1.2/v1.3 §9 primitives.
- §3 Task 1 (SEA bundling) correctly HIGH-effort with Option A (Node SEA) / Option B (@yao-pkg/pkg) escalation path.
- §3 Task 4 (split view) acceptance exhaustive against §1.4 observable behaviors.
- §4 non-scope complete (nothing misplaced or missing).
- §5 guardrails carry N1 lessons + new addition: "surface better approaches with deviation report, never silently second-guess" — codifies DEV3 discipline.
- §8 PHASE_REPORT template reference correct per `feedback_dispatch_references_phase_report_template`.

**Fires with continuing CODER spawn**, not architectural reset — N1 foundation stands, N2 builds on it. Fresh spawn not needed; CODER's N1 context is directly applicable.

---

## 2026-04-22 — Native v1 N1 acceptance + CTO §8 ratifications

**Context:** CTO ratified PHASE_N1_REPORT for Native Commander v1 Phase N1 (foundation). 9 of 10 §1 acceptance criteria ship-green; criterion 9 (signing + notarization) formally deferred to dedicated N1.1 dispatch pending Apple Developer cert acquisition.

### Decisions ratified

**D1 — N1 closed with criterion 9 deferred.** §1 criterion 9 (signed + notarized .app) is BLOCKED on external dependency (Apple Developer cert on build machine). Dedicated N1.1 dispatch per D2; not a fold into N2.

**D2 — N1.1 signing dispatch will be dedicated, not folded into N2.** Narrow scope (<1hr CODER time once cert on machine), decouples N2 UI work from cert-acquisition latency, clean v1.0.0 release audit trail. N1.1 fires when Jose confirms Apple cert acquired; can run in parallel with N2 execution.

**D3 — User `~/.zshrc` sourcing default: opt-in false.** `preferences.zsh.source_user_rc` boolean, default `false`. When `true`: source with 2-3s timeout guard + error swallowing + `system:warning` event on failure. Safety-first for bringup; Jose flips via dogfood feedback if needed. Documented as expected v1 behavior, not a bug.

**D4 — xterm.js scrollback persistence: N2, paired with split view.** `@xterm/addon-serialize` already installed in N1. `sessions.scrollbackBlob` column already exists in Drizzle schema. N2 wires serialization on session close + restoration on workspace resume. 5MB cap per ARCHITECTURE_SPEC §16.6.

### Deviations from N1 dispatch ACCEPTED by CTO

**DEV1 — Generated `.zshrc` does NOT source user `~/.zshrc`.** Accepted; ties to D3. Tracked as §7 tech debt in PHASE_N1_REPORT. N2 adds opt-in flag.

**DEV2 — Sidecar ships as shell wrapper + dist + flat node_modules, NOT single SEA/pkg binary.** Accepted AND PROMOTED to N2 Task 1 scope (SEA/pkg migration becomes N2 acceptance criterion, not tech debt). Rationale: Bun failed Task 1 verification spike; SEA native-module bundling risked Task 10 schedule. N1 bundle came out at 34 MB (better than Attempt 1's 105 MB).

**DEV3 — WebviewWindow points at Tauri `frontendDist`, NOT sidecar HTTP URL.** Accepted. CTO verdict: "CODER's approach is architecturally better than my spec." Folds back into ARCHITECTURE_SPEC.md v1.3 alongside N2 dispatch prep. Preserves Vite HMR in dev. `get_sidecar_url` Tauri command stubbed for N6 consumption.

**DEV4 — NewSessionModal uses native `<select>` elements.** Accepted; OS §15 deviation scoped to N3 UI polish per dispatch §3 Task 8.

**DEV5 — `tauri-plugin-fs` v2 used instead of dispatch's `tauri-plugin-fs-watch` (a v1-only crate).** Accepted AND CTO correction folds into ARCHITECTURE_SPEC.md v1.3. No-op for N1 (fs-watch not used until N5).

### ARCHITECTURE_SPEC.md v1.3 folds (PM-managed, executed alongside N2 dispatch prep)

1. Correct §8.2 "WebviewWindow at sidecar HTTP URL" → Tauri `frontendDist` + `get_sidecar_url` Tauri command for N6. Rationale: preserves Vite HMR, matches Tauri convention, functional equivalence via HTTP/WS traffic.
2. Correct §5.4 / §7.2 `tauri-plugin-fs-watch` references → `tauri-plugin-fs` (v2 plugin name). v1 crate no longer exists; v2 provides equivalent functionality under the unified fs plugin.

### Standing posture

- **Native v1 N1 CLOSED.** PHASE_N1_REPORT archived at `native-v1/docs/phase-reports/PHASE_N1_REPORT.md`.
- **N0 discipline continues** — safety-critical web Commander fixes only — until N2 dispatch lands.
- **Web Commander sunset** per MIGRATION_V2_RETROSPECTIVE.md §10.3 — stays alive through N4, sunsets after N5 + 1-2 weeks dogfood per ARCHITECTURE_SPEC §14.2.
- **Apple Developer cert acquisition** is the only external gating item for N1.1.

### References

- `docs/dispatches/N1_DISPATCH_NATIVE_V1_FOUNDATION.md` — N1 dispatch CTO authored.
- `native-v1/docs/phase-reports/PHASE_N1_REPORT.md` — CODER's PHASE_N1_REPORT (148 lines, 10-section canonical).
- `docs/native-v1/ARCHITECTURE_SPEC.md` — v1.2 canonical contract (v1.3 pending D-folds).
- `docs/native-v1/FEATURE_REQUIREMENTS_SPEC.md` — v1 user-facing acceptance.
- `docs/migration-v2/MIGRATION_V2_RETROSPECTIVE.md` — migration v2 closure + v1 continuity.

---

**End of DECISIONS.md. New decisions append at top.**
