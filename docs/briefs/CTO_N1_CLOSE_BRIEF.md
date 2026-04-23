# CTO_BRIEF — Command-Center N1 CLOSE + N2 draft request

**From:** PM · 2026-04-23
**Status:** N1 CLOSED on 8/8 user-facing smoke PASS. PM-shipped one in-rotation fix for a zombie-window bug uncovered by Jose (scope: 2 lines in `tauri.conf.json`, well within Jose's 2026-04-23 standing small-scope authorization). Ready for N2 draft.

## §1 — Commit chain (dc8a0f6 → f595475)

Fresh monorepo scaffolded from empty directory:

- `08b66a2` feat(n1-t1): monorepo scaffold (Bun workspaces + Biome + strict TS)
- `6cfbe7f` feat(n1-t2,t3,t4): Rust shell (148 LOC) + Bun sidecar + 9-table Drizzle schema
- `263e238` feat(n1-t5,t6,t7,t9): frontend skeleton + Preferences + structural fixes
- `743952d` fix(n1-t10): smoke-readiness — rename state dir + parent-death watchdog
- `cb4473b` docs(n1): PHASE_N1_REPORT filed
- `e9a2775` docs(n1): §3.3 FAILED — bundle signature malformed, N1.1 required
- `a1cce71` fix(n1.1-t1,t2): post-tauri-sign.sh + productName→Command Center
- `e23f991` docs(n1.1): PHASE_N1.1_REPORT filed
- `f595475` fix(n1.1) + docs(n1,n1.1): window visible+center + 8/8 smoke PASSED

Rust 149/150 LOC (G5). 24/24 tests green. G12 `bun install --frozen-lockfile` clean. Bundle 65 MB. First-paint 8.0 ms (target ≤200ms — 25× under).

## §2 — Two meta-findings to fold into standards + spec

### 2.1 SMOKE_DISCIPLINE §3.4 gap — propose amendment

CODER's §3.2 smoke-readiness check used this AppleScript:
```
tell application "System Events" to get name of every application process whose background only is false
```

That measures **app-process visibility** (Launch Services registration), NOT **pixel-window presence**. When the N1 build hit a zombie-window state (process registered as visible, zero windows in AX list), CODER's check returned the app name as expected → green. The bug slipped past both N1 AND N1.1 smoke-readiness; only Jose's actual pixel observation caught it.

Same class as N2 modal + N2.1 webview-fetch failures the standard originally addressed, one layer deeper. Derivative property passed; observational ground truth failed.

**Proposed SMOKE_DISCIPLINE §3.4 amendment:**

> CODER's smoke-readiness `.app` launchability check must verify: (a) both processes (shell + sidecar) in `ps` as children of the bundle, (b) at least one window exists in the AX list of the shell process (`tell process ... to count windows` ≥ 1), and (c) that window has non-zero size + position within the bounds of at least one attached display. Process-level `visible: true, background only: false` is not sufficient — a process can register as visible while rendering zero windows. OS §20.LL-L14 (ground-truth over derivation) applies: window presence is the ground truth, process attributes are derived signals.

Worth a quick CTO pass + landing in `standards/SMOKE_DISCIPLINE.md` v1.1 before N2. Prevents N2's larger surface area (plugin + MCP + `/hooks/*` routes) from hitting the next variant of this.

### 2.2 Zombie-window class bug — propose spec §2.4 amendment

Root cause of the N1.1 smoke-2-fail: window created with `visible: false` per KB-P1.14 boot-path discipline + frontend's `invoke('show_window')` IPC call failing silently (`.catch(() => {})` in `main.tsx` swallowed whatever went wrong). Net: window hidden indefinitely, Dock icon present, no pixels. The `visible:false → React mounts → frontend calls show_window → Rust shows it` handshake is fragile — any failure in the frontend chain leaves a zombie.

Three root-cause candidates (un-investigated per dispatch §3 NOT-in-scope):
- Tauri v2 custom commands on macOS 26 Tahoe may require capability grants we didn't add (`core:window:allow-show` in capabilities/default.json grants the built-in window plugin's show(), not the custom `show_window` command in lib.rs).
- macOS 26 behavior change on hidden webviews (JS execution may be deferred until window shown, creating a chicken-and-egg).
- Silent failure mode in the frontend's `.catch(() => {})` masking whatever specific error.

**Fix PM shipped** (2-line config, already committed `f595475`):
```json
"visible": true,
"center": true
```

KB-P1.14 rule 4 (skeleton ≤200ms) preserved — the pre-React HTML skeleton in `index.html` (`Command Center / Booting…`) paints before React mounts.

**Proposed spec §2.4 amendment:**

Replace the "window created visible:false → React mount → show_window IPC → visible" handshake with one of:

- (A) Window created `visible: true` + pre-React HTML skeleton in `index.html` for the pre-React paint window (current PM fix — simplest, works).
- (B) Window created `visible: false` in Rust + Rust-side timer (≤500ms) that calls `w.show()` unilaterally regardless of IPC, so frontend failures can't produce zombies.

Either eliminates the IPC-dependent visibility path. Option A is what's shipped; CTO picks which goes in v1.1 spec or mandate both as defense-in-depth.

## §3 — Standing ratifications (already Jose-approved, need spec fold when CTO convenient)

- Q1: `~/.commander/` as permanent state dir (per-N1 §8 ratification 2026-04-23). Spec §3.1 `~/.jstudio-commander/` references should fold to `~/.commander/`. Internal codename `commander` (binaries + state dir) vs. external product name `Command Center` split confirmed.
- Q2: `bun:test` at sidecar workspace (per-N1 §8 ratification 2026-04-23). Spec §10 D-N1-07 can amend to name `bun:test` at sidecar + Vitest at frontend/shared/ui.

## §4 — DECISIONS.md state

`~/Desktop/Projects/jstudio-commander/docs/command-center/DECISIONS.md` created 2026-04-23 with 8 entries D-KB-01..08 ratifying the KB v1.2 + v1.3 fold (full KB v1.3 consolidated at `~/Desktop/Projects/jstudio-meta/research/COMMANDER_KNOWLEDGE_BASE.md`, 1294 lines).

N2 dispatch should cite:
- **D-KB-07** (KB-P1.7 v1.3 correction): MCP tool surface is CRUD primitives only — no `execute_sql`, no `run_migration`, no raw `shell_exec`. Narrow-primitive tool surface is the primary defense; `agents.capability_class` column from v1.2 stays as secondary defense but not the gate.
- **D-KB-08** (KB-P1.12 v1.3 correction): Tauri + banked fixes (per-session IPC / xterm dispose / workspace suspension / boot-path discipline) gives real perf win. Our Tauri v2 architecture with those fixes baked into N1 is validated, not just hedged.

## §5 — Tech debt carry (for N7 hardening)

All LOW severity. No blockers for N2.

From PHASE_N1_REPORT §7: Debts 1-7 (drizzle-kit migrator vs DDL string, BLOB vs TEXT scrollback, Rust RunEvent shutdown ordering, TanStack Router unused, shadcn CLI not installed, bundle 65 MB Bun runtime cost, no Windows/Linux CI).

From PHASE_N1.1_REPORT §7: Debt 8 (Tauri v2 `signingIdentity: null` doesn't auto-run bundle codesign — our `post-tauri-sign.sh` neutralizes).

New from N1.1 PM-shipped follow-on: the zombie-window class described in §2.2 above — fixed via config but the underlying Tauri v2/macOS 26/capability-grant root cause not investigated. N7 hardening candidate.

## §6 — Asks

1. **Draft N2 dispatch** (plugin + MCP dual-protocol). Scope per ROADMAP v0.3 §N2 with D-KB-07 narrow-primitive surface baked in. No `execute_sql` / `run_migration` / raw `shell_exec` tools. Bearer-authed plugin `hooks.json` + MCP `/mcp/*` routes on same Fastify instance. PHASE_REPORT format unchanged. Ratified in-advance: `~/.commander/` state dir + `bun:test` at sidecar.
2. **Ratify SMOKE_DISCIPLINE §3.4 amendment** per §2.1 above (window-count + display-bounds check in CODER smoke-readiness). Land in standards before N2 fires.
3. **Optional — spec §2.4 pattern amendment** per §2.2 (drop IPC-dependent visibility handshake). PM lean: adopt Option A (`visible: true` + HTML skeleton) in spec v1.2 since that's what's shipped + simpler.
4. **Optional — fold ratified `~/.commander/` + `bun:test` into spec §3.1 + §10 D-N1-07** when amending v1.2. Not blocking.

Once N2 dispatch lands, PM fires pre-dispatch reality check + relays to Jose for CODER rotation. Expected N2 shape: Plugin package + `/hooks/*` routes + MCP `/mcp/*` CRUD tools + bearer-auth + settings panel install-command copy. Substantially larger than N1/N1.1 but bounded (no PTY, no kanban UI, no approval modal).

**End of brief.**
