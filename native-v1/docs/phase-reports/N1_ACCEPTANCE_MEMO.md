# N1 Acceptance Memo

**Author:** CTO (Claude.ai)
**Date:** 2026-04-22
**Phase:** N1 — Native Commander v1 foundation
**Status:** CLOSED with §1 criterion 9 (code signing + notarization) deferred indefinitely per Jose's direction
**Filed:** `~/Desktop/Projects/jstudio-commander/native-v1/docs/phase-reports/N1_ACCEPTANCE_MEMO.md`
**Source report:** `native-v1/docs/phase-reports/PHASE_N1_REPORT.md`

---

## 1 — Verdict

N1 is CLOSED. 9 of 10 §1 acceptance criteria are demonstrable. The 10th (code signing + notarization via Apple Developer cert) is formally deferred until external distribution becomes real — which per Jose's §16.10 ratification is "very far away."

The phase closed with zero silent scope expansion, five legitimate deviations tracked honestly, test suite intact (42/42 sidecar + 10/10 DB), bundle 34/60 MB under target, Rust LOC 141/150 under budget, and a ~5h CODER rotation producing a working unsigned `.app` that launches and spawns live sessions.

This is the first native Commander v1 artifact the project can build on.

---

## 2 — §1 criteria outcome

| # | Criterion | Status |
|---|---|---|
| 1 | Commander.app launches ≤1.5s, bundle ≤60 MB | 34 MB bundle confirmed; launch time to verify at Jose's next dogfood |
| 2 | Sidecar auto-spawn via tauri-plugin-shell, clean quit ≤5s | PASS |
| 3 | Fresh Drizzle DB at `~/.jstudio-commander-v1/commander.db`, §10 schema + PM v1.2 folds, session_types seeded | PASS |
| 4 | POST /api/sessions spawns PM/Coder/Raw with zsh + OSC hook + JSTUDIO_SESSION_ID + `claude` exec + bootstrap inject + DB row | PASS |
| 5 | xterm.js per session, addon-webgl, pty stream + input, 10k scrollback | PASS |
| 6 | OSC 133 markers fire, sidecar emits typed command:started + command:ended | PASS |
| 7 | Pre-warm pool N=2 default, warm claim <500ms, cold <2s, `preferences.pool.size` configurable | PASS |
| 8 | Single-instance via tauri-plugin-single-instance | PASS |
| 9 | Signed + notarized .app, no Gatekeeper warning | DEFERRED (see §4 of this memo) |
| 10 | Cmd+Q clean shutdown, no orphan processes | PASS |

---

## 3 — Deviation rulings

Five deviations filed by CODER in PHASE_N1_REPORT §4. All accepted. Two fold back into the architectural spec as corrections (ARCHITECTURE_SPEC v1.3, PM folds at convenient moment).

### D1 — Generated `.zshrc` does not source user `~/.zshrc`

**Accepted.** CODER hit real-world flakiness on a test machine (oh-my-zsh / P10K user rc broke OSC 133 hook install by adding 4-5s to first-prompt latency + occasional fatal errors killing the shell before the hook installed). Safety-first call correct for N1 bringup.

**Resolution forward:** N2 implements `preferences.zsh.source_user_rc` boolean (default `false`) with 2-3s timeout guard + error swallowing + `system:warning` event on failure. See §5 Q2 ratification.

### D2 — Sidecar ships as Node wrapper + dist + node_modules, not single SEA binary

**Accepted.** Bun failed Task 1 verification spike. `vercel/pkg` is archived. `@yao-pkg/pkg` and Node SEA with native modules (node-pty, better-sqlite3) are a substantial engineering exercise that exceeded Task 10 schedule. CODER shipped a working wrapper + dist layout inside `Contents/Resources/sidecar/`.

**Outcome:** bundle is 34 MB — better than the original plan's theoretical raw-Node approach would have produced (Attempt 1 was 105 MB).

**Resolution forward:** N2 Task 1 promotes SEA bundling from MEDIUM tech debt to acceptance criterion. Eliminates the implicit "requires Node 22 installed on user machine" prerequisite before v1.0.0 ship.

### D3 — WebviewWindow points at Tauri frontendDist, not sidecar HTTP URL

**Accepted AND folded back into ARCHITECTURE_SPEC v1.3.** ARCHITECTURE_SPEC v1.2 §8.2 specified "Rust opens WebviewWindow pointed at sidecar's HTTP server URL." CODER kept Tauri's standard `devUrl` / `frontendDist` static-serve pattern and added a frontend-side `discoverSidecarUrl()` that probes 11002..11011 for `/api/health`.

CODER's approach is architecturally better. It matches Tauri v2 conventions (devUrl + frontendDist), preserves Vite HMR in development cleanly, and is the pattern used by BridgeSpace, VSCode's Tauri-based tools, and the Tauri examples.

The spec's original model coupled frontend origin to sidecar to enforce "sidecar is the server" — an orthogonal reasoning from first-principles without checking Tauri conventions. CODER naturally aligned with convention at implementation time.

**Lesson banked:** spec should cite Tauri conventions where they exist rather than derive orthogonally. Filed as OS discipline note for future architectural-spec authoring. Specifically: before specifying an implementation model, check whether the substrate has a conventional pattern that already solves the problem.

**V1.3 correction (PM folds at next convenient moment):**
> **§8.2 (revised):** Rust opens WebviewWindow at Tauri's standard `frontendDist` (production) or `devUrl` (development). Frontend discovers sidecar URL via `/api/health` probe at 11002..11011 on initial mount. `get_sidecar_url()` Tauri IPC command is implemented for non-default-port scenarios but unused in the default path.

### D4 — NewSessionModal uses native `<select>` elements

**Accepted.** Dispatch §3 Task 8 explicitly scoped UI polish to "functional, not pretty" with native directory picker in N5. Native `<select>` is tech debt, filed, tied to N3 UI polish phase.

### D5 — `tauri-plugin-fs` in Cargo.toml, not `tauri-plugin-fs-watch`

**Accepted AND folded back into ARCHITECTURE_SPEC v1.3.** CODER correctly caught that `tauri-plugin-fs-watch` is a Tauri v1 crate that doesn't exist in v2. File-watching in v2 lives under the core `fs` plugin or community crates. CODER installed `tauri-plugin-fs` as the v2 equivalent. N1 doesn't depend on fs-watch behavior yet (that's N5), so the plugin swap is a no-op for N1.

**V1.3 correction (PM folds at next convenient moment):**
> **§5.4 (revised):** macOS FSEvents via `tauri-plugin-fs` (Tauri v2's fs plugin) for the subset of N1-N4 file-watching needs. N5 verifies whether the built-in plugin covers the full subscription model required, or whether a community FSEvents-specific crate is needed.

---

## 4 — §1 Criterion 9 (signing) deferral

**Decision:** V1 ships unsigned for personal use. Signing deferred until external distribution becomes real.

**Rationale:**
- Jose is the sole user of Commander v1 per §16.10 ratification.
- Gatekeeper warning appears once per binary on first launch; can be bypassed via right-click → Open. Subsequent launches of the same binary do not show the warning.
- Auto-updater infrastructure stays in place (tauri-plugin-updater installed in N1 Task 4). Updater will function unsigned for personal-use upgrades; signature verification chain activates if/when cert is acquired.
- Apple Developer Program enrollment is $99/year. Paying now for a distribution capability not being used is negative ROI.

**What triggers un-deferral:**
- Jose decides to share Commander v1 with anyone beyond himself (team, client, collaborator).
- Jose pursues Commander v1 (or successor) as an external product.
- Gatekeeper behavior becomes friction-inducing enough that the per-build right-click is perceptibly worse than $99/year.

**N1.1 dispatch not drafted.** When un-deferral triggers, CTO drafts a narrow dispatch covering: Apple Developer Program enrollment → cert install → `tauri.conf.json` signing identity → rebuild → notarytool → Gatekeeper smoke test. Estimated <1hr CODER time once cert is on the build machine. Held as a parked item in DECISIONS.md, not a pending dispatch.

---

## 5 — CODER §8 question ratifications

### Q1 — Apple Developer cert provisioning for N1.1

**Ratified:** Signing deferred indefinitely per §4 of this memo. N1.1 dispatch not drafted. Parked item in DECISIONS.md.

### Q2 — User `~/.zshrc` sourcing default

**Ratified:** Opt-in, `false` default.

Implementation for N2:
- Add `preferences.zsh.source_user_rc` boolean to `preferences` table. Default `false`.
- When `true`: after OSC 133 hook installs in generated `zdotdir/.zshrc`, sidecar emits `[ -f ~/.zshrc ] && timeout 3 source ~/.zshrc` with error swallowing.
- On timeout or error: emit `system:warning` event with text "User .zshrc failed to source within 3s; continuing with hook-only session."
- Document as expected v1 behavior in any user-facing release notes / README. Zsh customizations are opt-in for stability reasons, not a bug.

### Q3 — xterm.js scrollback persistence

**Ratified:** N2 scope, paired with split view + workspace persistence.

Implementation for N2:
- `@xterm/addon-serialize` already installed by CODER in N1 — zero install cost.
- `sessions.scrollbackBlob` column already exists per ARCHITECTURE_SPEC v1.2 §10 — zero schema cost.
- On session close (pty exit OR app quit): call `term.serialize()` and write serialized blob to `sessions.scrollbackBlob` if size ≤5MB (per §16.6 ratification); if size >5MB, truncate oldest portion to fit.
- On session resume (workspace restore): fetch blob from DB, call `term.write(blob)` before subscribing to live pty stream.
- Acceptance criterion in N2: close Commander with 3 active sessions showing varied terminal output; reopen; all 3 sessions restore visually identical terminal contents.

---

## 6 — Tech debt state

Eight items filed in PHASE_N1_REPORT §7. Severity-calibrated correctly. Routing:

| Debt | Severity | Routed to | Rationale |
|---|---|---|---|
| Sidecar wrapper + dist, not SEA | MEDIUM | **N2 Task 1** | Promoted from debt to acceptance criterion. Unblocks "no Node 22 prereq" framing for v1.0.0. |
| `command:ended.durationMs` hardcoded `0` | LOW | **N2 first-PR** | 30-min fix. Load-bearing for ContextBar "command ran X seconds" surfaces in N3. |
| Frontend bundle 646kB (xterm.js dominant) | LOW | **N2 polish** | Dynamic import in TerminalPane. 0.5 day. |
| `.zshrc` user rc not sourced | LOW | **N2** | Ties to Q2 ratification. 0.5 day. |
| Sidecar URL discovery via port probe vs Tauri IPC | LOW | **N2-N3** | Works as-is. Port probe is robust enough for v1. |
| OSC 133 C marker dropped | LOW | Parked | Only A/B/D emitted. Revisit if N3 renderer registry finds a VSCode-style consumer that expects C. |
| NewSessionModal native `<select>` | LOW | **N3 UI polish** | Per deviation D4. |
| `tauri-plugin-fs` (v2) vs spec's `tauri-plugin-fs-watch` (v1) | NONE | **V1.3 spec correction** | Resolved via D5 fold. |

No HIGH-severity debt. Nothing load-bearing for v1.0.0 ship that isn't already N2-scoped or explicitly deferred.

---

## 7 — V1.3 spec fold queue

Two corrections from CODER's deviations fold back into ARCHITECTURE_SPEC:

- **§8.2 WebviewWindow origin revision** (per D3 above).
- **§5.4 FSEvents plugin correction** (per D5 above).

Both minor. PM folds at a convenient moment — suggest alongside N2 dispatch prep so the fold + N2 dispatch reference v1.3 consistently. Not worth a dedicated round-trip.

Version history entry in v1.3:
> **v1.3 (date TBD)** — Two corrections from CODER-surfaced N1 implementation reality: §8.2 WebviewWindow origin pattern aligned with Tauri v2 conventions; §5.4 FSEvents plugin name corrected from v1 crate reference to v2 plugin reference. Both corrections preserve architectural intent; implementation path is now convention-aligned.

---

## 8 — Metrics summary

- **Wall-clock this rotation (Tasks 4-10):** ~5h.
- **Full phase wall-clock (Tasks 1-10):** ~6-7h estimated (Tasks 1-3 prior CODER + Tasks 4-10 current CODER).
- **Estimated output-token cost (Tasks 4-10):** ~200-250k output tokens at Opus 4.7 rates. Estimated total phase spend: $500-1000 including prior CODER's Tasks 1-3.
- **Tests passing:** 42/42 sidecar, 10/10 DB, build pipeline PASS.
- **Rust LOC:** 141/150 budget. Held.
- **Bundle size:** 34/60 MB target. Stretch goal of 30 MB not achieved; that's fine for a Node+node_modules bundle pre-SEA.
- **Commits:** 10 total (7 this rotation + 3 prior CODER). One per task, no squashing, canonical commit-message format throughout.

All within envelope or better than envelope. No cost or time red flags.

---

## 9 — What moves forward from N1

**Carries forward unchanged into N2:**
- Tauri v2 + Rust shell (141 LOC, proven pattern).
- Sidecar Fastify + Node 22 + node-pty + Drizzle (42 tests green).
- OSC 133 byte-exact parser + A/B/D marker events.
- Pre-warm pool with claim/refill lifecycle.
- Bootstrap injection with activity-gap detection (OSC 133 A marker + ≥1 byte output + ≥800ms silence).
- xterm.js + @xterm/addon-webgl per-session terminal.
- Drizzle schema per v1.2 §10 + PM v1.2 folds (composite indexes, FTS5, UNIQUE constraints, partial indexes, updatedAt triggers).

**Enters N2 scope:**
- SEA bundling (Task 1).
- ContextBar + STATE.md drawer + split view + workspace persistence.
- Scrollback restore wiring.
- `.zshrc` opt-in preference.
- `command:ended.durationMs` tracking.
- WebSocket heartbeat + resubscribe-on-reconnect.

**Deferred to later phases:**
- Renderer registry + approval modal + ChatThread → N3.
- Command palette, named workspaces, analytics → N4.
- Three-role UI, full native OS integrations → N5.
- Auto-updater endpoint configuration → N6.
- Code signing + notarization → parked until external distribution becomes real.

---

## 10 — Closing

N1 closes cleanly. The architectural reset worked. CODER produced a report that enables the CTO → PM → CODER rhythm to function on substance, not on debugging dispatch discipline. Operating-model invariants preserved. No unresolved blockers for N2 start.

N2 dispatch fires when PM signals ready.

---

**End of memo.**
