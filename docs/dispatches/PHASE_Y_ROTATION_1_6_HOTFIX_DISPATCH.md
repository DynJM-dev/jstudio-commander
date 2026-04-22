# Phase Y Rotation 1.6 — Class 1 + Class 2 Persistence Hotfix

**From:** PM (Commander, 2026-04-21)
**To:** CODER (fresh spawn recommended; Rotation 1.5 CODER is fine to continue if still resident)
**Type:** INSTRUMENTATION-FIRST rotation per `standards/INVESTIGATION_DISCIPLINE.md` + `OS §20.LL-L11/L12`. **Two commits MAX**: (1) narrow instrumentation + capture window, (2) fix rotation contingent on capture. **NO speculative patches on Rotation 1.5 helpers without log evidence showing WHERE they break.**
**Preceded by:** Rotation 1.5 hotfix `5a1bc23` + `df5439b` (Fix A + Fix B + Fix C) shipped 2026-04-20. PM post-compact JSONL audit 2026-04-21 against 324 entries says both Fix B and Fix C are NOT effective.
**Status:** Jose-authorized. Audit evidence drives scope.

---

## §1 — Audit findings (evidence, not hypothesis)

Log: `~/.jstudio-commander/codeman-diff.jsonl` — 324 entries across 2026-04-20 16:55 → 2026-04-21 00:45 (~7h50m, single primary session `822f2882…`).

**Class counts post-Rotation-1.5:**

| Class | Count | % | Rotation 1.5 fix that should have closed it |
|---|---:|---:|---|
| **Class 1** — codeman stuck `composing`/`tool_exec` while legacy idle | **65** | 20% | Fix C (`streamingAssistantId` 3s stability timer) |
| **Class 2** — legacy label leaks via `??` when codeman null-label | **182** | 56% | Fix B (`resolveActionLabelForParallelRun`) |
| Agreement / other | 77 | 24% | — |

**Longest stuck runs (same sessionId + signature, consecutive `codemanIsWorking=true`):**

| Dur | Start | kind | Label | Legacy agreed? | Verdict |
|---:|---|---|---|---|---|
| 242.7s | 04-21 00:08 | tool_exec | "Running Agent" | 7/7 YES | TRUE long-running Task — not a bug |
| **185.4s** | 04-21 00:16 | composing | "Composing response..." | 0/4 NO | **Class 1 stuck — Fix C didn't land** |
| **161.8s** | 04-20 16:55 | composing | "Composing response..." | 0/5 NO | **Class 1 stuck — Fix C didn't land** |
| 49.9s | 04-21 00:45 | tool_exec | "Running Agent" | 2/2 YES | TRUE work |
| 46.3s | 04-21 00:36 | tool_exec | "Running command" | 3/3 YES | TRUE work |

Class 1 distributes across the entire window **including post-hotfix clusters** at 04-20 23h (20 entries) + 04-21 00h (15 entries) — well after `5a1bc23` landed.

**Jose's 150s "stuck Thinking/Composing with empty Live Terminal" direct symptom: TWO matches above (185s + 162s).** Both are `codemanIsWorking=true`, `codemanSubtype='composing'`, `label='Composing response...'`, `legacyIsWorking=false`, `sessionStatus='idle'` — exact signature. Candidate 36 display-layer hypothesis was NOT the 150s mechanism.

---

## §2 — Scope

**COMMIT 1 — Instrumentation rotation (~20 LOC, grep-strippable `[phase-y-1.6-instr]` tag, dedupe-gated).**

Captures the internal state of Rotation 1.5's Fix B + Fix C to localize WHY they fail to expire / suppress. Two decision points per fix.

### Fix C instrumentation (Class 1 mechanism probe)

**D1 — `useChat.ts` reconciler at `:274-308`.** Log on every reconciliation pass (dedupe by signature to avoid noise):
- `tail.id`
- `tail.role + tail.content.last.type`
- `hashChanged: boolean` (did the `JSON.stringify` hash differ from prev snapshot?)
- `timerArmed: boolean` (did we (re)arm the STREAMING_STABILITY_MS timer?)
- `currentStreamingAssistantId` (pre-update)
- Timestamp

Answers: does the timer KEEP re-arming because the tail hash keeps changing on poll ticks? (Server may be re-serializing text blocks with minute differences.) Or does `streamingAssistantId` flip to null correctly but something else holds composing?

**D2 — `useToolExecutionState.ts` composing branch at `:215-226`.** Log on every derivation that returns `subtype='composing'`:
- `last.id` (tail assistant id at derivation)
- `streamingAssistantId` (what the hook received)
- `match: streamingAssistantId === last.id`
- Timestamp

Answers: is the composing branch even the one producing the stuck state? Or is a different branch (tool_exec, compact) returning composing-labeled output?

### Fix B instrumentation (Class 2 mechanism probe)

**D3 — `contextBarAction.ts::resolveActionLabelForParallelRun` at `:126-133`.** Log at entry of every call where `legacyActionLabel !== null`:
- `codemanIsWorking` (the boolean the helper branches on)
- `codemanLabel`
- `legacyActionLabel`
- `returned` (what the function returned)
- Timestamp

Answers: is the helper being called with `codemanIsWorking === undefined` on stuck ticks? (Would fall through to `codemanLabel ?? legacyActionLabel` which is legacy leak.) Or is `codemanIsWorking === true` while legacy is also stuck-true, both reporting different labels, and downstream UI still renders the legacy string via some other wire?

**D4 — ContextBar callsite at `:390-394`.** Log the `actionLabel` variable immediately AFTER the helper call — plus the `effectiveStatus` from `:453-457` — to confirm ContextBar renders the helper's return verbatim and there's no secondary fallback downstream mutating it.

All four points use `console.log('[phase-y-1.6-instr] D<n> <payload>')`, dedupe-gated by a module-level `Map<key, signature>` (follow `useCodemanDiffLogger` pattern — do NOT create a new JSONL file; console-only is sufficient, capture is Jose's DevTools).

**File boundaries (strict):**
- `client/src/hooks/useChat.ts` — D1 only
- `client/src/hooks/useToolExecutionState.ts` — D2 only
- `client/src/utils/contextBarAction.ts` — D3 only
- `client/src/components/chat/ContextBar.tsx` — D4 only

Do NOT touch: any test file, any server file, `useCodemanDiffLogger.ts` (audit primitive — independent), any Candidate 36 surface (TmuxMirror / status-poller / tmux.service), `usePreference.ts`, 15.3-arc legacy guards, M7/M8/Phase T surfaces.

### Capture protocol

1. Cold-restart `pnpm dev`.
2. Hard-reload browser.
3. Open a single session (split-view optional — the 185s + 162s runs were single-session).
4. Normal use for ~10 minutes. Goal: reproduce a stuck-composing OR a Class 2 label leak (check ContextBar label against actual pane state — if the chat-row is idle but ContextBar shows "Composing response..." for more than ~10s, capture).
5. Export DevTools console dump (all `[phase-y-1.6-instr]` lines).

### Deliverable — `docs/phase-y-rotation-1-6-diagnostic.md`

Sections:
- **§1** — Raw capture (D1-D4 lines, timestamp-aligned).
- **§2** — Class 1 mechanism: cite D1+D2 lines showing why `streamingAssistantId` didn't flip to null, OR why it did but composing still returned.
- **§3** — Class 2 mechanism: cite D3+D4 lines showing exactly which branch of `resolveActionLabelForParallelRun` fired during a leak event.
- **§4** — Fix shape (contract-level only, no code yet). One-paragraph per class.

**COMMIT 1 discipline:** one commit — `docs(phase-y-1.6): instrumentation rotation findings`. Strip instrumentation via `git checkout -- <files>` before commit. Verify `grep -rn '\[phase-y-1.6-instr\]' client/src` returns empty. `git diff --stat` shows only the diagnostic file modified.

---

**COMMIT 2 — Fix rotation (contingent on Commit 1 diagnostic).**

Only fires after §2-§3 of the diagnostic name concrete mechanisms. Scope will be known only at that point. PM will draft a follow-on 1.6.B dispatch after reading the diagnostic. **Do NOT ship Commit 2 in this rotation.**

---

## §3 — Tests

**Commit 1 (instrumentation):** zero new tests. Instrumentation is additive + stripped. Baseline test suite 411 must still pass.

**Commit 2 (fix, future):** minimum 3 cases per mechanism named in the diagnostic. Dispatched separately.

---

## §4 — Rejection triggers

(a) Any fix code in Commit 1. Instrumentation only.
(b) Files outside the D1-D4 list touched.
(c) Instrumentation not stripped before commit (`grep` must return empty; `git diff --stat` must show only the diagnostic file).
(d) Diagnostic §2/§3 claims a mechanism without cited log-line refs.
(e) Phase Y `[codeman-diff]` logger modified or its JSONL touched.
(f) Any `sessionStatus === 'waiting'` passthrough broken — Item 3 (`00f1c30`) approval-modal path must survive byte-identical.
(g) Candidate 36 surface (TmuxMirror / status-poller / tmux.service) touched. Parallel D5/D6 rotation has separate dispatch.
(h) Ship-green claim on Commit 1 without Jose capture declaration.

---

## §5 — Standing reminders

Per `feedback_understand_before_patching`: Rotation 1.5 already shipped unit-green and live smoke says Class 1 + Class 2 persist. We do NOT stack another speculative fix. Instrumentation first.

Per `feedback_self_dogfood_applies_to_status_fixes`: Jose's own Commander session is the ideal repro environment. The 185s + 162s stuck-composing runs in the audit came from his sessions.

Per `feedback_vite_stale_code`: cold-restart dev server before Jose's capture step.

Per OS §20.LL-L12: the Rotation 1.5 diagnostic + this audit are EVIDENCE, not proof. Instrumentation is the proof step.

---

## §6 — Expected duration

- CODER Commit 1 add: ~20 min.
- Jose capture: ~10 min normal-use window.
- CODER diagnostic + strip + verify + commit: ~20 min.
- PM read diagnostic + draft 1.6.B fix dispatch: separate cycle (~15 min).

Total this rotation: ~50 min + Jose's capture window.

Go.
