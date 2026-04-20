# CTO_BRIEF — Codeman-Model Architectural Phase (scoping)

**From:** PM (Commander)
**Date:** 2026-04-20
**Type:** Phase scoping — PM requests CTO guidance on migration strategy + acceptance criteria + scope boundaries before dispatching.
**Upload target:** Claude.ai Commander CTO thread.
**Per CTO framing note (`CTO_RESPONSE_2026-04-20_15.3_close.md` §2):** This phase is its own phase with its own name and brief, NOT "15.3 residuals." Calling it 15.3 cleanup limits scope psychologically. It's an architectural migration — bigger than 15.3, with its own acceptance criteria.

---

## TL;DR

The Codeman-model phase migrates Commander's ContextBar working/idle derivation from a three-server-signal OR-chain to a `ChatMessage[]`-authoritative client-side derivation. Resolves Candidates 23 (Claude Code runtime `contextLimit`), 32 (intermittent activity-missing on multi-step tool sequences), and 33 (intermittent 60s stuck "Running command..." trailing edge) jointly. Estimated 1–2 rotations.

Substantial enough to deserve its own name, its own brief, and CTO scoping before dispatch. PM requests CTO pick: (a) migration strategy, (b) deletion policy on the legacy signals, (c) acceptance criteria shape, (d) phase name, and (e) any architectural constraints PM hasn't surfaced.

---

## Architectural problem

Commander currently derives "is the session actively working right now?" from three server signals at `client/src/pages/ChatPage.tsx:329-332`:

1. `session.status` — pane-regex-classified coarse status (idle / working / waiting). Server-side `status-poller.service.ts`. Lags 1.5s–60s based on pane text.
2. `sessionState.kind` — typed, canonical per Issue 15.3 Phase 1 (`fee7f35`). Server-side `session-state.service.ts`. Emission cadence on poll + hook events.
3. `unmatchedToolUse` — client-side tail scan of `ChatMessage[]` for `tool_use` blocks without matching `tool_result`.

These three signals disagree for 15–20 seconds at a time. The Issue 15.3 arc produced five fixes (Fix 1, Fix 2, Option 4, Option 2, Activity-gap) plus one out-of-sequence patch (`41a55e9` heartbeat-stale guard on the typed-Working OR-branch) to compose across those disagreement windows. Each fix closed one edge case; Candidates 32 and 33 remain as intermittent residuals that 15.3 could not close without a deeper refactor.

The Codeman project (`~/.codeman/app/src/transcript-watcher.ts`) uses a fundamentally different architecture:

- Watches the JSONL transcript stream directly (not pane regex, not typed-state event stream).
- Stateful `state.currentTool: string | null` + `state.toolExecuting: boolean` updated on each `tool_use` / `tool_result` parse.
- Emits `transcript:tool_start` + `transcript:tool_end` events with tool names.
- Single scalar state, single parse, single source of truth.

No three-signal OR-chain. No disagreement windows. No patches layered across composing+interleaved-text-tail+stale-typed-Idle+stale-typed-Working+heartbeat-stale failure modes.

## What the migration does

Replace the ContextBar `isSessionWorking` composite at `ChatPage.tsx:329-332` and the `resolveActionLabel` label-source chain at `contextBarAction.ts` with derivation from `ChatMessage[]` alone. The source is the same `useChat` output already flowing to ChatThread — no new subscription, no new WS channel.

Core derivation (Codeman-pattern):

```
currentTool: string | null  ← tail-scan for latest unmatched tool_use, extract .name
isWorking: boolean          ← currentTool !== null OR (assistant block streaming)
label: string               ← per-tool label from currentTool OR "Composing response..." OR null
```

Delete `session.status` as a client-consumed gate. Server-side `session.status` may remain for telemetry/logging; client-side ContextBar stops reading it. Delete Fix 1's typed-Working OR-branch and all downstream guards (Option 4 hard-off, Option 2 turn-bounded freshness, heartbeat-stale gate) — they exist to compose against the asymmetry this migration deletes.

Candidate 23 (runtime `contextLimit`) is the same architectural family: replace hardcoded `MODEL_CONTEXT_LIMITS` lookup with the same `ChatMessage[]`-authoritative pattern reading Claude Code's emitted context-limit field. Joint resolution with 32/33 because both embody the same principle: "trust client-side structured signals over server-derived values."

## Why this is a phase, not a fix rotation

The rotations in the 15.3 arc each touched 1–2 files. This migration touches:

- `ChatPage.tsx` — remove the composite, replace with Codeman-pattern hook output.
- `ContextBar.tsx` — remove local `isWorking` re-derivation (already coupled to composite via `isWorkingOverride`).
- `contextBarAction.ts` — simplify `resolveActionLabel` substantially; most guards become unnecessary.
- New hook: `useToolExecutionState(sessionId)` or equivalent, scanning `ChatMessage[]` for tool_use/result pairs.
- Possibly deletes: `useSessionStateUpdatedAt.ts`, `usePromptDetection.ts` gate logic, some of `useSessionState.ts`.
- Server-side: decision on whether to keep emitting `sessionState.kind` (telemetry value) or delete.
- Test surface: every test in the `ChatPage-15.3-fix-rotation.test.ts` + `ContextBar-6.1.1-integration.test.ts` + `contextBarAction.test.ts` families needs to be either updated to the new derivation or deleted if the guarded-for scenario no longer exists.

Substantial. PM estimates 1–2 rotations at full effort. CTO may scope to more or less.

## Open questions for CTO

**Q1 — Migration strategy.** Two options:

- **Big-bang.** One rotation: delete legacy signals, ship Codeman-pattern, fix everything that breaks. Cleaner end-state, higher risk mid-rotation if something unexpected surfaces.
- **Incremental.** Rotation 1: ship Codeman-pattern hook in parallel with existing signals; use it as the primary path; keep legacy as fallback. Rotation 2: verify primary path handles every case cleanly, then delete legacy. Safer, but leaves interim state where two derivation paths coexist.

PM lean: incremental. The 15.3 arc proved this surface is subtle; a fallback is cheap insurance. CTO judgment?

**Q2 — Deletion policy.** After the migration, what happens to:

- `session.status` coarse status: delete server-side or keep for telemetry?
- `sessionState.kind` typed-state event: delete or keep (useful for future features, but current consumer list shrinks significantly)?
- 15.3-arc guards (`useSessionStateUpdatedAt`, `lastTurnEndTs` in ChatPage, heartbeat-stale gate): delete or keep as defensive layers?

The answer affects phase scope meaningfully. Aggressive deletion = cleaner codebase; conservative keep = smaller rotation + fallback resilience.

**Q3 — Acceptance criteria.** The 15.3 arc accepted ship-with-residuals (Candidates 32, 33). This phase's goal is to CLOSE those residuals. Proposed acceptance:

- Live smoke: the 5-case matrix from 15.3 §12 (BASH-10, READ-STATE, EDIT-DIAG, SPAWN-AGENT, BASH-2) all green, no stuck labels, no 60s trailing edges.
- Plus pure-text turn test (the `41a55e9` motivation case): bar transitions to Idle within ~5s of a pure-text Claude turn ending.
- Plus intermittency resistance: running the 5-case matrix twice in succession produces identical results (no flip between runs like Case 5's clean-then-60s-stuck).

CTO — is this the right bar? Too strict? Too loose?

**Q4 — Phase name.** PM proposes "Phase X: Structured-Signal Primacy" or "Phase Y: ChatMessage-Authoritative Derivation." Picking a name that's NOT "15.3 cleanup" per CTO's framing note. CTO — which name, or an alternative?

**Q5 — Are there architectural constraints I haven't surfaced?** Examples: does Codeman handle parallel tool_use in one assistant block the way Commander needs? Does Commander's split-view + per-pane state fit cleanly into the Codeman pattern? Does the heartbeat/hook-event infrastructure need to survive in any form? Are there telemetry or debugging concerns when the server's typed-state stream goes silent?

---

## Scope boundaries PM proposes (CTO adjusts)

**In scope:**
- New `ChatMessage[]`-authoritative derivation hook.
- Migration of ContextBar `isSessionWorking` + label source.
- Deletion of legacy derivation chain (per Q2 CTO call).
- Full non-regression against the 5-case live-smoke matrix.
- Resolution declaration for Candidates 23, 32, 33.

**Out of scope (explicitly deferred):**
- Any UI behavior change beyond what the derivation migration requires. No new labels, no new icons, no new subtypes not already present.
- `usePromptDetection` rewrite — Item 3 shipped at `00f1c30`, works. Out of scope.
- ProjectStateDrawer / M7 MVP rework. Out of scope.
- Effort UI (M8) rework. Out of scope.
- Server-side session-state service redesign beyond what deletion-policy (Q2) decides.

---

## Pre-dispatch checklist (PM executes after CTO ratifies)

1. Draft phase dispatch against CTO's ratified answers to Q1–Q5.
2. Spawn fresh CODER for the phase (accumulated-context risk real after M8 + `41a55e9` + M7).
3. Fire dispatch with rejection triggers tied to CTO's chosen acceptance criteria.
4. On PHASE_REPORT return, standard PM verify → Jose live-smoke → ship or iterate.

---

## What I need from CTO

Answers to Q1–Q5. Nothing more. This is a scoping request, not a ratification request. Once CTO returns with the answers, PM drafts the dispatch against them and Jose authorizes dispatch fire.

No urgency. This brief can sit until Jose has energy to upload and CTO has cycles to scope. M7 MVP just closed — there's no production pressure forcing the next phase.

**End of brief.**
