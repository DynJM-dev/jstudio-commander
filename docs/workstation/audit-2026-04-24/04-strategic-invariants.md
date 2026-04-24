# Strategic Invariants — JS WorkStation Audit Slice

**Agent:** 04-strategic-invariants (compression layer)
**Audit date:** 2026-04-24
**Scope:** Cross-cutting strategic layer — constitutional invariants, named architectural principles, decisions that carry regardless of product shape, doctrine extracted from load-bearing incidents, execution disciplines worth inheriting.
**Anti-overlap:** Does NOT cover web-Commander internals (01), native-infra (02a), native-surface discipline (02b), or archived native-v1 (03). Read those for layer-specific detail.

---

## 1. Constitutional invariants (carry regardless of product shape)

These apply to JS WorkStation by virtue of being a JStudio project. Every one is load-bearing — all came from something that went wrong in a way that broke trust or work.

- **Manual-bridge invariant** — Jose is the sole routing agent between CTO, PM, and CODER; no direct PM↔CODER or PM↔CTO auto-forwarding. Source: `OPERATING_SYSTEM.md §3.4`, ratified in `MIGRATION_V2_RETROSPECTIVE.md §4.1`, carried forward via `COMMAND_CENTER_ROADMAP.md §Cross-phase constraints`. Constitutional because: persona bypass was the original Commander failure mode. Native UI reduces *friction*, not *agency* (`NATIVE_REBUILD_SCOPING_BRIEF.md §7`); the three-role UI puts text on clipboard and highlights the CODER pane, does not auto-send.
- **Ground truth over derivation** — before designing a derivation chain for a UI signal, check for an existing ground-truth signal. Source: `OS §20.LL-L14` (OPERATING_SYSTEM.md line 1417), canonicalized from the Phase Y ceiling (`phase-y-closeout.md §3`). Constitutional because: five rotations of transcript-derivation patches collapsed into ~100 LOC once Track 1 subscribed to the Phase T pane-activity ground truth already emitting on a WS channel (`CTO_BRIEF_2026-04-22_COMMANDER_FINALIZER_CLOSED.md §3 Lesson 2`).
- **Per-session isolation by construction** — every long-running data stream uses a per-session channel ID; no global bus; isolation is a structural property, not a runtime check. Source: `FEATURE_REQUIREMENTS_SPEC.md §14.5` + `COMMAND_CENTER_ROADMAP.md §Named architectural principles` (KB-P1.13) + Candidate 36 display-layer hypothesis (`candidate-36-diagnostic.md §3-4`). Constitutional because: shared-bus was BridgeSpace's #1 production perf killer (D-KB-02); the Candidate 36 leak was localized downstream of a verified-clean command path, i.e. a subscription-layer drift that is invisible to command-routing audits.
- **Item 3 approval-modal byte-identical semantics** — approval modal behavior is byte-identical across PM / Coder / Raw personas. Source: `FEATURE_REQUIREMENTS_SPEC.md §14.4` + `COMMAND_CENTER_ROADMAP.md §N5`. Constitutional because: approval is the load-bearing human-in-loop consent surface; any regression is ship-blocker (FRS §14.4 verbatim). Implemented in v1 via typed `approval:prompt` events routed to a `PermissionPrompt` component (detection mechanism improves; UI shape preserved).
- **Narrow-primitive tool surface / no raw SQL/shell/eval exposed** — MCP tools are CRUD primitives only; no `execute_sql`, no `run_migration`, no raw `shell_exec`, no `filesystem_write_raw`, regardless of caller model tier. Source: `DECISIONS.md D-KB-07` (KB-P1.7 v1.3 correction) codified as KB-P6.17 anti-pattern. Constitutional because: Opus 4.6 ran `seed` against prod DB, wiping rows (~1hr downtime). Tool surface is the primary defense; model-tier gating is insurance only.
- **Persist-before-destructive-action** — any state transition that destroys in-memory data (process termination, atomic file replace, connection close, buffer eviction) MUST flush to durable storage BEFORE the destructive step. Ordering: persist → destructive-action → state-transition → observability event. Source: `OS §20.LL-L16` (OPERATING_SYSTEM.md line 1439); two shipped patterns ratifying (N2.1 atomic config.json write; N3 pre-kill scrollback flush). Related: `SMOKE_DISCIPLINE.md v1.2 §3.4.2` state-isolation for smoke-readiness scripts, `DECISIONS.md D-KB-05` (KB-P1.16) for flow-gating state placement. Constitutional because: silent partial state is the most expensive class of bug to diagnose; explicit failures are cheaper.
- **Smoke as layer specification / CODER cannot self-certify** — every dispatch's §9 smoke scenario is specified at the outermost user-facing layer (Finder launch → pixels on screen); CODER's automated smoke is diagnostic input, Jose's user-facing smoke is the phase-close gate. Source: `OS §20.LL-L15` (OPERATING_SYSTEM.md line 1429) + `SMOKE_DISCIPLINE.md v1.2` §3.4 + §3.4.1 (window-presence triad) + §3.4.2 (state-isolation). Constitutional because: N2 + N2.1 both passed automated smoke and failed Jose dogfood on the same class of gap.
- **Token/cost governance visibility** — context degradation cliff at ~75% of window surfaced with color-coded threshold warning before auto-compact triggers; token + cost + context-window display on the primary surface; rate-limit proximity surfaced before Jose hits it. Source: `DECISIONS.md D-KB-06` (KB-P1.17) + `FEATURE_REQUIREMENTS_SPEC.md §14.6`. Constitutional because: agent quality degrades sharply approaching context limit before the runtime signals it; 5h-rolling budget visibility is "not optional" (FRS §14.6 verbatim).

---

## 2. Named architectural principles (protected)

Verbatim from `COMMAND_CENTER_ROADMAP.md §Named architectural principles (protected)`. Any proposal to relax these must invalidate the principle first, not locally override.

| Principle | Protection rationale | Protects WorkStation? |
|---|---|---|
| UI-process / pane-host-process split (KB-P1.12) | UI and Fastify sidecar are separate OS processes; node-pty, agent children, persistence in sidecar. Agent sessions survive UI restart/HMR/auto-update/shell-crash. | **Yes** — foundational to any multi-session workstation. |
| Per-session IPC channels, never shared bus (KB-P1.13) | Every long-running data stream uses per-session WS topics. The #1 production perf decision (BridgeSpace Day 132/133). | **Yes** — WorkStation is multi-session by scope; the principle is tighter, not looser. |
| Boot-path discipline (KB-P1.14) | Skeleton UI in 200ms; no sync work at module init; `ready-to-show` paired with window creation; route-level code splitting. | **Yes** — Matt's retrofit-pain pattern is shape-independent. |
| xterm explicit-dispose lifecycle (KB-P4.2 v1.2) | Every `new Terminal()` pairs with `dispose()` + listener unregistration + PTY ownership on unmount. | **Needs reframing** — still applies if WorkStation retains xterm.js, but if the terminal renderer changes, the principle reframes as "every pane-renderer pairs instantiation with explicit teardown + ownership handover." |
| Narrow-primitive tool surface (KB-P1.7 v1.3 + KB-P6.17) | MCP tools are CRUD primitives; raw SQL / shell-exec / filesystem-write never exposed. | **Yes** — product-shape-independent; applies to any tool surface exposed to any model. |
| Persistent state in sidecar DB (KB-P1.16) | Flow-gating state server-side; localStorage transient-only. Gate test: if this state vanishes, does the user lose work or hit a confusing redirect? | **Yes** — product-shape-independent. Gate test carries verbatim. |

All six carry to WorkStation. Only KB-P4.2 needs a rename if the terminal renderer changes; the underlying discipline (instantiation paired with teardown + ownership handover) is shape-independent.

---

## 3. Decisions to carry verbatim

From `docs/command-center/DECISIONS.md`. Filter: decisions that are product-shape-independent and bind WorkStation without modification.

| Decision | One-line content | Still binds WorkStation? | Reason |
|---|---|---|---|
| **D-KB-01** | UI-process / pane-host-process split | **Yes** | Architectural principle, not MCP-observer-specific. |
| **D-KB-02** | Per-session IPC channels, never shared bus | **Yes** | Same. |
| **D-KB-03** | Boot-path discipline (200ms skeleton, route-level splitting) | **Yes** | Shell + webview pattern carries regardless of product framing. |
| **D-KB-04** | Hidden workspace suspension (xterm render loops pause) | **Yes** | Multi-workspace is a WorkStation scope primitive. |
| **D-KB-05** | Persistent state placement (DB for flow-gating, localStorage transient-only) | **Yes** | Product-shape-independent state discipline. |
| **D-KB-06** | Context degradation cliff at ~75% (color-coded warning) | **Re-ratify** | Threshold itself is shape-independent, but the handoff-prompt action was scoped against single-agent-per-pane model. WorkStation multi-session framing may route differently (handoff to another pane in same window vs. external session). |
| **D-KB-07** | Narrow-primitive tool surface regardless of model tier | **Yes** | Constitutional. |
| **D-KB-08** | Tauri runtime choice matters *when paired* with banked fixes | **Yes** | Runtime-choice rationale is shape-independent; WorkStation inherits the banked fixes. |
| **D-KB-09** | Hook transport: command-type only (Claude Code v2.1+ `type: "command"`) | **Re-ratify** | Scoped against MCP-observer's specific plugin surface. WorkStation's integration-with-Claude-Code shape needs clarification (see §4). |
| **D-KB-10** | Hook event catalog: 9 events calibrated against CC v2.1.118 | **Re-ratify** | Same. |
| **D-KB-11** | Plugin install URI rules (no `file://`, omit manifest.hooks for standard paths) | **Re-ratify** | Same — depends whether WorkStation ships a plugin surface. |
| **D-KB-12** | MCP `.mcp.json` wrapped shape at project root | **Re-ratify** | Same. |

**Verbatim-carry set:** D-KB-01, 02, 03, 04, 05, 07, 08 — seven decisions that bind WorkStation unconditionally.

**Re-ratify set:** D-KB-06, 09, 10, 11, 12 — five decisions that were scoped against the MCP-observer / Claude-Code-plugin product shape.

---

## 4. Decisions requiring re-ratification under WorkStation framing

- **D-KB-06 (context degradation cliff).** Current phrasing binds the 75% threshold warning to the single-session run-viewer surface with a "Consider handoff" toast + external-prompt button (`COMMAND_CENTER_ROADMAP.md §N3/N4`). WorkStation framing is multi-session interactive; handoff may route to a sibling pane in the same workspace rather than to an external session. Re-examine: where does the handoff button route, and what artifact does it produce? The 75% threshold itself is load-bearing and shape-independent.
- **D-KB-09 / D-KB-10 (hook transport + event catalog).** Both are calibrated against Claude Code v2.1.118 hook surfaces assuming Commander exposes itself as a CC plugin target. If WorkStation's scope includes or excludes "be a CC plugin host," these decisions either bind verbatim or become non-applicable. Re-examine: does WorkStation ship a CC plugin surface at v1?
- **D-KB-11 (plugin install URI).** Same dependency as D-KB-09/10.
- **D-KB-12 (MCP .mcp.json wrapped shape).** Same dependency — binds only if WorkStation exposes an MCP server.
- **Write-gate rule scope (KB-P1.7 v1.3 correction, codified as D-KB-07).** Verbatim-carry under current framing, but WorkStation may surface additional destructive primitives (e.g., project-wide refactors, multi-file edits orchestrated by an agent). Re-examine: does the narrow-primitive rule extend beyond MCP tools to any UI action an agent can trigger programmatically?

All five above need the CTO brief to specify WorkStation's integration posture (CC plugin target? MCP server? something else?) before they can be ratified or retired.

---

## 5. Three specific load-bearing incidents (doctrine, not history)

### (a) Phase Y ceiling lesson

Doctrine, one paragraph: the transcript-authoritative derivation has a structural ceiling for pure-text turns — no amount of tuning in `useChat.ts` or `useToolExecutionState.ts` can fabricate a signal the JSONL pipeline doesn't emit. Phase T's tmux mirror was the correct abstraction the whole time because it read pane bytes directly. The canonical test for WorkStation (OS §20.LL-L14 application test, line 1425): before designing a derivation chain, ask — is there a ground-truth signal already emitted in the system that answers this question directly? If yes, subscribe; only derive when no ground-truth channel exists. Corollary from L14 line 1427: when a derivation ships unit-green and fails live smoke, check first whether a ground-truth signal exists that the derivation is approximating. Architectural consequence for WorkStation: real-time status comes from the pane-host layer, never from a transcript layer downstream of it (`NATIVE_REBUILD_SCOPING_BRIEF.md §2.1` names this "Phase Y architectural ceiling vanishes by construction"). Source: `phase-y-closeout.md §3`, `CTO_BRIEF_2026-04-22_COMMANDER_FINALIZER_CLOSED.md §3 Lesson 1+2`.

### (b) Candidate 36 (cross-session effort display leak)

What was ruled out: the effort-command send path — instrumented at four decision points (SessionCard click → ContextBar → `POST /sessions/:id/command` → `tmux.sendKeys`), every layer emitted the correct sessionId, and only the intended pane received `send-keys`. What remained as open hypothesis (`candidate-36-diagnostic.md §3-4`): the leak lives in the display layer — either `TmuxMirror.tsx`'s WS subscription channel derivation drifting from `props.sessionId`, OR a data-layer case where two session rows share one `tmux_session` value and the status-poller tees pane capture onto two `pane-capture:<sessionId>` channels. Doctrine: **per-session isolation must be structural, not enforced at the subscriber.** If two rows can share one pane, or if subscription-channel derivation can drift from props.sessionId, cross-session leaks surface as display artifacts even with a verified-clean command path. WorkStation treatment: the channel ID is the only routing key; two session rows cannot share a pane (uniqueness asserted at spawn/heal); the subscription effect's dependency array includes the channel string. Absorbed into `NATIVE_REBUILD_SCOPING_BRIEF.md §5` as "C36 eliminated by construction" because v1 uses a real terminal emulator per pane rather than shared-channel capture broadcasts.

### (c) N2.1 fresh-bearer-mint false-positive (third incident, SMOKE_DISCIPLINE v1.2 motivation)

CODER's N2 T11 smoke-readiness script included `rm -rf ~/.commander/config.json` as a "clean slate" before launching the app. That `rm -rf` wiped Jose's real bearer token (same directory; derived assumption that `~/.commander/` was CODER-only state). Next launch correctly minted a fresh bearer — production code was doing exactly the right thing. PM + CTO hypothesized a preservation-path bug; one hotfix rotation of investigation later, the "bug" didn't exist. Doctrine: **smoke-readiness scripts own no user state; mutations outside the script's own temp scratch paths are prohibited across the board** (temp HOME via `mkdtemp`, or backup-restore with `trap`-guarded restore). Same L14 root as the Phase Y ceiling: a derivative assumption ("this directory is mine") passed while ground truth ("Jose depends on this directory") was false. The OS §20.LL-L15 corollary (line 1437) makes this explicit: every new SMOKE_DISCIPLINE amendment layer is the same derivative-green / ground-truth-false shape applied at a different operational concern. Source: `SMOKE_DISCIPLINE.md v1.2 §3.4.2`; also referenced in L16 rationale (OS line 1452) as "2 hours of tracing a phantom rotation before discovering the actual trigger was a separate unrelated `rm -rf` in CODER's smoke script."

---

## 6. Execution disciplines worth inheriting

- **SMOKE_DISCIPLINE v1.2** (`standards/SMOKE_DISCIPLINE.md`, state-isolation §3.4.2 non-negotiable). User-facing smoke specified at the outermost layer; CODER cannot self-certify (§3.4); destructive actions against real user-state directories prohibited (§3.4.2). Prevents: "shipped green, failed user-dogfood" + "investigation cycles on bugs that don't exist."
- **INVESTIGATION_DISCIPLINE** (`standards/INVESTIGATION_DISCIPLINE.md`; fires when fix ships unit-green + symptom unchanged, or before stacking a second speculative fix on unverified mechanism). Instrumentation-only rotation, grep-strippable tag, multi-case matrix with working+failing control pair, diagnostic document before any new fix, zero fix code. Carried forward per `MIGRATION_V2_RETROSPECTIVE.md §4.4`. Prevents: speculative-fix rotation spirals (Phase Y's five-rotation stack before the reframe).
- **PHASE_REPORT §3.3 PM-owned after smoke** (`SMOKE_DISCIPLINE.md §5`). CODER fills §3.1–§3.2 (automated suite + smoke-readiness check); PM appends Jose's user-facing smoke outcome post-dogfood. Prevents: CODER self-certifying a phase Jose hasn't actually exercised.
- **Pre-dispatch reality check** (2026-04-22 CTO operating change, recorded in memory `project_cto_operating_changes_2026_04_22`). PM runs the current build and verifies CTO's assumptions before CTO drafts. Prevents: dispatches authored against outdated reality (CTO operating in offline context has no live build access).
- **Diagnostic-first evidence commit before fix attempts** (G10/G11/G12 pattern, memory `feedback_diagnostic_empty_commit_then_fix`). File evidence at `docs/diagnostics/`, empty commit BEFORE the fix commit, layer-named commit message, dependency-hygiene in the same commit. Prevents: fixes applied against wrong-layer evidence; preserves traceability when a "fix" is later reverted.

All five exist precisely because of things that went wrong. None are optional for WorkStation — each closes a specific failure class that would otherwise recur under any product shape.

---

**End of report.** Compressed from ~11 source docs (DECISIONS.md, COMMAND_CENTER_ROADMAP.md, NATIVE_REBUILD_SCOPING_BRIEF.md, CTO_BRIEF_2026-04-22_COMMANDER_FINALIZER_CLOSED.md, phase-y-closeout.md, candidate-36-diagnostic.md, SMOKE_DISCIPLINE.md v1.2, OS §20.LL, PHASE_Z_NATIVE_APP_PLAN.md, MIGRATION_PLAN.md, MIGRATION_V2_RETROSPECTIVE.md, INVESTIGATION_DISCIPLINE.md). Full text of cited sections in source docs.
