# Decisions — JStudio Commander

**Purpose:** Append-only record of architectural + operational decisions ratified for the Commander project. New decisions added at top. Rationale captured alongside each decision so context travels with the record.

**Canonical four-file structure:** `CLAUDE.md`, `PROJECT_DOCUMENTATION.md`, `STATE.md`, `DECISIONS.md` per OS §6. This file was created 2026-04-22 as the first decision-record entry for Native v1 N1 acceptance.

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
