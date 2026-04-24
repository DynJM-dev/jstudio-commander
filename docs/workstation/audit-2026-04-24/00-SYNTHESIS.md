# JS WorkStation — Audit Synthesis

**Date:** 2026-04-24
**Sources:** `01-web-commander.md`, `02a-native-infra.md`, `02b-native-surface-discipline.md`, `03-archived-native-v1.md`, `04-strategic-invariants.md` (this directory).
**Scope:** decisions-ready distillation. Not a catalog.

## TL;DR

JS WorkStation is an interactive multi-session workspace for Jose's daily coding work — the thing he opens every morning. The entire native Command Center infra layer (Rust shell, Bun sidecar, Drizzle, bearer, PTY, worktree, WS) survives the reset. The product-shape gap is one architectural contract: `xterm-container.tsx:61 disableStdin: true` + missing sidecar stdin-write route. Flip that (plus the chat UI + multi-session frame on top) and the 18 hours of infra becomes the foundation. The surrounding doctrine — ground-truth-over-derivation, per-session isolation by construction, Item 3 approval path sacred, narrow-primitive tool surface — all carries.

---

## Build this

1. **Interactive multi-session workspace.** Jose launches/manages multiple Claude Code sessions (PM / Coder / Raw + future personas) side-by-side in named workspaces. Formatted chat UI by default, raw xterm available as toggleable Mirror view.
2. **The decisive architectural flip: input-direction wiring.** `packages/ui/src/xterm-container.tsx:61` sets `disableStdin: true` and there is no `term.onData()` handler or sidecar stdin-write route. Flip `disableStdin: false` → wire `term.onData(bytes)` → `POST /api/sessions/:id/input` → `pty.stdin.write(bytes)`. One line per layer converts observer to interactive.
3. **In-app sessions bypass MCP + plugin shim.** Sidecar exposes a direct service-layer for internal use. MCP plugin stays as a secondary external-interop surface only.
4. **Ground-truth signaling.** OSC 133 shell integration + hybrid Claude-ready detection (OSC title gate + post-gate quiet period + 30s timeout + visible warning). Typed FSM for session state, not regex-over-pane-text.
5. **Typed event + renderer exhaustiveness.** Port web Commander's `packages/shared/src/types/` SessionState + 28-variant WSEvent union, make exhaustive (no generic fallback). Port the 15-variant ContentBlock renderer registry + `DROP_RECORD_TYPES` denylist + "default = render, never vanish" invariant; fill the Candidate 29/30/35/40 gaps on v1 ship.
6. **Per-session isolation by construction.** Per-session WS channels + DOM `data-pane-session-id` markers + `paneFocus.ts` cross-pane ESC guard + per-pane React hook instances. Structural, not runtime check.
7. **Drizzle schema from day one.** Clean v1 schema with proper UNIQUE / CHECK / FK constraints + retention policy + typed migrations. No ALTER-TABLE-per-rotation.

## Don't build this

1. **Multi-source state derivation when ground truth exists.** Web Commander's `resolveEffectiveStatus` composes 5 sources; `status-poller.service.ts` is 380 nested-branch lines with 8 module-level Maps. Anti-pattern — subscribe to pty + OSC 133 + typed FSM instead (OS §20.LL-L14).
2. **Pattern-matching on external render output.** Web Commander's `agent-status.service.ts` has 30+ regexes against tmux pane text. Forbidden in WorkStation.
3. **Node 22 as sidecar runtime.** 65MB stripped floor blocks ≤55MB single-binary mathematically (native-v1 archive confirmed this). Bun stays.
4. **ALTER-TABLE-per-rotation with no version tracking.** 14 idempotent-via-PRAGMA migrations in web Commander's `connection.ts:32-194` is the thing to NOT repeat.
5. **Deferred frontend RTL tests.** Six native-v1 rotations deferred RTL; Bugs H / K / E / kill-session each were one-RTL-test away from being caught. Ship RTL coverage with each feature.

## Inherit directly (file paths)

**From native-v1 archive (`dc8a0f6`):**
- `apps/sidecar/src/osc133/parser.ts` — byte-exact OSC 133 parser
- `apps/sidecar/src/pty/bootstrap.ts` — hybrid Claude-ready launcher (signal + timeout + warning)
- `apps/sidecar/src/pty/pool.ts` — pre-warm PTY pool
- `apps/sidecar/src/pty/hook-path.ts` — ZDOTDIR generator
- `resources/osc133-hook.sh` — shell integration hook
- `packages/shared/src/events.ts` — typed event union + `assertNeverEvent`
- `apps/shell/src-tauri/src/lib.rs` — 150-LOC Tauri shell template

**From native command-center (N1-N4a.1):**
- `apps/shell/src-tauri/src/lib.rs` — current 149-LOC Rust shell (G5 discipline proven)
- `apps/sidecar/src/index.ts` — Drizzle + bun:sqlite + halt-on-failure boot + parent-re-parent self-terminate
- `apps/sidecar/src/config.ts` — bearer + atomic tmp+rename persistence
- `apps/sidecar/src/agent-run/lifecycle.ts` — 5-state PTY FSM + SIGTERM→5s→SIGKILL + pre-kill scrollback flush
- `apps/sidecar/src/worktree/create.ts` — git-primary → shallow-copy → project-root fallback chain
- `apps/sidecar/src/services/projects.ts:29-34` — `resolveProjectRoot` resolver-as-only-read-path pattern (Debt 24 doctrine)
- `apps/sidecar/src/ws-bus.ts` — per-session topic bus (`pty:<id>`, `hook:<id>`)
- `apps/frontend/src/components/run-viewer.tsx:83-131` — race-free `liveStreamReceivedRef` + `scrollbackBlobRef` + empty-dep `useCallback`
- `apps/frontend/src/components/run-viewer.tsx:69-72` — dynamic `refetchInterval` halt-on-terminal
- `packages/ui/src/xterm-container.tsx` — rAF-deferred `fit()` + scrollbar-gutter CSS + explicit-dispose lifecycle (KB-P4.2 v1.2). **Flip `disableStdin: true` → wire `onData`.**

**From web Commander (shape-only; rebuild atop new infra):**
- Session spawn flow: tilde+realpath cwd canonicalization, PM/Coder/Raw bootstrap injection from `~/.claude/prompts/`, `/effort <level>` dispatch
- Approval-modal path: `usePromptDetection` → `PermissionPrompt` → ContextBar mount point. Preserve byte-identical (Item 3 sacred).
- `paneFocus.ts` — cross-pane ESC isolation predicate

## Hard invariants (constitutional)

1. **Manual-bridge invariant (OS §3.4).** Jose is sole routing agent; UI reduces friction, never agency. No auto-forwarding, no auto-dispatch.
2. **Ground truth over derivation (OS §20.LL-L14).** Before any derivation chain, check for an existing ground-truth signal. Subscribe to pty / OSC 133 / FSEvents; never derive from downstream artifacts.
3. **Per-session isolation by construction.** Events scoped to sessionId cannot reach a different session's subscribers. Architectural property, not runtime check.
4. **Item 3 approval-modal byte-identical.** `waiting` at top of `resolveEffectiveStatus` chain; `usePromptDetection` always polls, no `isActive` gate. Safety-critical consent surface — regression is ship-blocker.
5. **Narrow-primitive tool surface (D-KB-07, KB-P6.17).** No raw SQL / shell-exec / eval / raw-fs-write exposed via any caller-facing surface regardless of model tier.
6. **Persist-before-destructive-action (OS §20.LL-L16).** Flush to durable storage BEFORE the destructive step. Applied 4× across the N-arc (N2.1 config, N3 scrollback flush, N4a identity migration, N4a.1 ensureProjectByCwd); make it the default pattern for any state transition that destroys in-memory data.

## Execution disciplines (inherit verbatim)

- **SMOKE_DISCIPLINE.md v1.2** — §3.4.1 window-presence triad + §3.4.2 state-isolation NON-NEGOTIABLE. CODER cannot self-certify; Jose-verified pixel-level smoke is phase close gate.
- **Diagnostic-first evidence commit.** `docs/diagnostics/<bug-id>-evidence.md` (Layer / Symptom / Root-cause / Fix-shape) BEFORE any fix attempt. Caught multiple wrong PM hypotheses in native-v1 N2.1 chain.
- **PHASE_REPORT 10-section template.** §3.3 PM-owned after Jose's smoke. §4 Deviations, §5 Issues, §7 Tech Debt as standing sections.
- **Pre-dispatch reality check** (2026-04-22 CTO operating change). Every CTO dispatch cites file:line; every acceptance corresponds to exercised code; no speculative infrastructure.
- **Resolver-as-only-read-path on column-semantic flips.** Any column whose meaning may evolve gets a resolver; direct reads forbidden. Debt 24 doctrine.
- **Composite signals beat fixed timers.** Hybrid OSC-title + quiet-period + timeout + visible-warning pattern is the canonical shape for "wait for external-tool ready." Native-v1 doctrine.
- **Ship RTL coverage with each feature.** No deferral across rotations. Native-v1 anti-pattern confirmed.

## Open questions for CTO (decision-unblocking)

1. **MCP plugin surface — secondary-only or drop entirely?** 02a recommends REPHRASE to secondary (external interop); in-app sessions use direct service calls. Does v1 ship any Claude-Code-facing plugin, or drop it pending external-user demand? Affects binding of D-KB-09 / D-KB-10 / D-KB-12.
2. **Project identity — explicit registration or cwd-auto-create?** Command Center's `ensureProjectByCwd` auto-creates on first SessionStart. 02a flags this as product-shape-suspect; WorkStation may want projects as explicit user artifacts (create/register). Affects schema + UI.
3. **Three-role UI (N0 §12) — v1 or v2?** N0 called this "the biggest qualitative leap" (brief-review / dispatch-compose / report-consumption panes with source attribution). Is v1 scope single-role-per-workspace with three-role in v2, or does v1 ship three-role from day one?
4. **75% context cliff handoff target (D-KB-06 re-ratification).** Threshold is shape-independent; handoff routing target differs in multi-session framing. Where does a session-at-cliff get routed — a new session in same workspace, a specific persona, user dialog?
5. **Bundle-size target.** Web Commander <5MB served, native-v1 35MB, current command-center bundle larger. WorkStation v1 target sets runtime choices still open (Bun is locked; Tauri vs alternatives less so).

---

**For depth:** see source reports in this directory. 01 for web Commander internals + Phase Y ceiling; 02a for sidecar infra; 02b for frontend + tech-debt + disciplines; 03 for archived native-v1 lessons + salvageable modules; 04 for constitutional invariants + decisions needing re-ratification.
