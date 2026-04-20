# Phase Y Rotation 1.5 — Hotfix (completion of parallel-run wiring + Class 1 un-defer)

**From:** PM (Commander, 2026-04-20)
**To:** CODER (same Phase Y Rotation 1 session — continues with fresh Rotation 1 context)
**Type:** NARROW HOTFIX, single commit, ~60 min scope. Completes the parallel-run wiring gaps surfaced by live JSONL evidence from `a3a58a2`'s ~10-entry accumulation window.
**Preceded by:** `a3a58a2` (Rotation 1 ship) + 11 `[codeman-diff]` entries accumulated in `~/.jstudio-commander/codeman-diff.jsonl` across ~2 hours of real Jose + CODER use.
**Status:** Jose-authorized. Three divergence classes identified in the JSONL — two are legitimate evidence (rotation 2 targets), one is a Rotation 1 wiring gap that needs completion for the parallel-run to actually flow end-to-end.

---

## Evidence from the JSONL (read `~/.jstudio-commander/codeman-diff.jsonl` before writing code)

Three distinct divergence classes are active. All 11 entries break cleanly into them:

**Class 1 — new-pattern stuck-composing on settled text tail.** Entries 1-5 + entry 8. Tail ends in `assistant(text)` after a completed tool chain. New-pattern reports `composing`, legacy correctly says idle via `session.status='idle'`. This is Investigation C's explicitly-deferred edge: without a streaming-vs-settled signal, new-pattern can't distinguish "text still streaming" from "text settled, turn ended." Legacy wins on this one.

**Class 2 — legacy stuck-composing leaking through `??` fallback.** Entries 6, 7, 9, 10. New-pattern correctly flips to idle (`label=null`). Legacy stuck on "Composing response..." (or "Running command..." in entry 7/10 — same class, different stuck label). Because `const label = codemanState?.label ?? legacyActionLabel` uses nullish coalescing, `null ?? "Composing..."` leaks legacy's string to the UI. User sees stuck composing even though the authoritative derivation said idle.

**Class 3 — new-pattern correctly detects work but its verdict is suppressed by legacy's effectiveSessionStatus path.** Entry 11. New-pattern `isWorking=true, label="Composing response..."` while legacy `isWorking=false`. User reported seeing "Idle — Waiting for instructions" on screen during this render. Why: CODER's Rotation 1 wired codeman into `isWorking` and `actionLabel` via `??`, but NOT into `effectiveSessionStatus` / `effectiveStatus` — which is what `getStatusInfo(effectiveStatus, ...)` branches on to pick the status label template. Legacy's `typedIdleFreshKillSwitch` (Option 4 from 15.3) forces `effectiveSessionStatus='idle'` when `sessionState.kind='Idle' && sessionStateIsFresh`, and `getStatusInfo('idle', ...)` returns "Idle — Waiting for instructions" regardless of what `isWorking` or `actionLabel` say. Codeman's correct-working verdict is silently suppressed at the rendering layer.

Class 3 means the parallel-run isn't actually running end-to-end. Rotation 1 parallelism is present in `[codeman-diff]` but absent from what the user sees. That's a Rotation 1 implementation gap to close before we can trust the ~1-day accumulation window's evidence for rotation 2 planning.

Classes 1 and 2 are legitimate evidence that would otherwise be rotation-2 targets, but given Jose's live UX pain is acute, they get fixed in this hotfix rotation alongside Class 3.

---

## Three fixes, one commit

### Fix A — effectiveSessionStatus override (Class 3)

Codeman's `isWorking` verdict must dominate `effectiveSessionStatus` when it has a confident verdict. Add an override ABOVE the existing `typedIdleFreshKillSwitch` and `effectiveSessionStatus` derivation:

```
// At ContextBar.tsx, somewhere after codemanState destructure + before getStatusInfo call:
const codemanEffectiveStatus: 'working' | 'idle' | null =
  codemanState?.isWorking === true ? 'working'
  : codemanState?.isWorking === false ? 'idle'
  : null;

// Preserve existing waiting-status path (approval modal) — codeman doesn't model waiting, legacy's sessionStatus='waiting' must still win when approval modal is active:
const effectiveSessionStatus: 'working' | 'idle' | 'waiting' | 'stopped' | 'error' =
  sessionStatus === 'waiting' ? 'waiting'
  : codemanEffectiveStatus !== null ? codemanEffectiveStatus
  : /* existing legacy effectiveSessionStatus logic with typedIdleFreshKillSwitch etc. */;
```

The waiting-status passthrough at the top of the chain is LOAD-BEARING — Item 3 (`00f1c30`) approval-modal mount depends on `sessionStatus='waiting'` propagating. If codeman's override shadowed waiting, approval modals would break. Preserve waiting explicitly.

Everything else (stopped, error, idle/working) is codeman-primary when it has a verdict, legacy-fallback when codeman hasn't bootstrapped.

### Fix B — label fallback conditional (Class 2)

Replace the current:
```
const actionLabel = codemanState?.label ?? legacyActionLabel;
```

With:
```
const actionLabel =
  codemanState?.isWorking === false ? null
  : (codemanState?.label ?? legacyActionLabel);
```

When new-pattern says "I'm confident idle" (`isWorking === false`, `label === null`), suppress legacy's label entirely. Don't leak legacy's stuck string. Legacy still computes (audit counterparty), but its leaked label stops reaching the UI.

Fix A and Fix B are coupled — Fix A's `effectiveSessionStatus='idle'` when codeman says idle, combined with Fix B's null actionLabel, makes `getStatusInfo('idle', null)` render "Idle — Waiting for instructions" which is correct. Without Fix B, even with Fix A, legacy's label might still surface via the actionLabel parameter into getStatusInfo's idle branch fallback logic. Check contextBarAction.ts / getStatusInfo to verify the coupling is clean.

### Fix C — streamingAssistantId extension (Class 1, un-deferred from Investigation C)

`useChat` tracks whether the last assistant message's `content[]` grew between consecutive polls. If grown → streaming, expose streamingAssistantId. If stable for N consecutive polls (recommend N=2, ~3 seconds) → settled, streamingAssistantId = null.

**Contract shape in `useChat.ts`:**

```ts
// Existing return shape plus:
streamingAssistantId: string | null;
```

Implementation: inside `mergeDelta` (useChat.ts:47-66 per CODER's Investigation C trace), compare incoming `content` length/stringified-shape against the previous snapshot for the same message. If different → `streamingAssistantId = message.id`. If same for N consecutive polls → `streamingAssistantId = null`. Track the poll-stability counter per message id.

**Hook consumption in `useToolExecutionState.ts`:**

In the `composing` detection branch (per CODER's implementation around lines 175-188), add a guard:
```
if (lastAssistantTailIsText && streamingAssistantId === lastAssistantMessage.id) {
  return { isWorking: true, subtype: 'composing', label: 'Composing response...', currentTool: null };
}
// Else: text tail that has settled — fall through to idle (or whatever other signal).
```

Requires hook signature extension: `useToolExecutionState(sessionId, messages, streamingAssistantId?)`. ChatPage passes `streamingAssistantId` from useChat return.

### Test coverage (per fix)

Minimum tests to add to `client/src/utils/__tests__/phase-y-tool-execution-state.test.ts` + new tests in `client/src/utils/__tests__/ContextBar-rotation-1-5.test.ts` (or equivalent):

- **Fix A — 3 cases.** (1) codeman `isWorking=true`, legacy typedIdleFreshKillSwitch=true, sessionStatus='idle' → effectiveSessionStatus='working', getStatusInfo takes working branch, DOM-equivalent shows codeman's label. (2) codeman `isWorking=false`, legacy legacyIsWorking=true, legacyActionLabel='Composing response...' → effectiveSessionStatus='idle', DOM reads "Idle — Waiting for instructions". (3) sessionStatus='waiting' + codeman `isWorking=false` → effectiveSessionStatus='waiting' (waiting passthrough preserved, approval modal path intact).

- **Fix B — 2 cases.** (1) codeman `isWorking=false, label=null`, legacyActionLabel='Composing response...' → actionLabel=null (leak suppressed). (2) codemanState=null (pre-bootstrap), legacyActionLabel='Composing response...' → actionLabel='Composing response...' (legacy fallback preserved when codeman hasn't loaded).

- **Fix C — 3 cases.** (1) text tail + streamingAssistantId matches last assistant id → composing (Class 1 correct for real streaming case). (2) text tail + streamingAssistantId=null (settled) → idle (Class 1 closure for post-turn-ended case). (3) text tail + streamingAssistantId points to OLDER message than current tail → idle (covers edge where user already sent next message; old streaming id stale).

Run full client suite + typecheck. Target: 381 → 381+N new, all pass.

---

## File boundaries (strict)

Touch:
- `client/src/hooks/useChat.ts` — add `streamingAssistantId` tracking + return shape extension.
- `client/src/hooks/useToolExecutionState.ts` — consume `streamingAssistantId` param, gate composing detection.
- `client/src/pages/ChatPage.tsx` — thread `streamingAssistantId` from useChat through to the hook call.
- `client/src/components/chat/ContextBar.tsx` — Fix A (effectiveSessionStatus override) + Fix B (label fallback conditional).
- `client/src/utils/contextBarAction.ts` — ONLY IF getStatusInfo / resolveActionLabel needs adjustment for Fix B coupling; default assumption not touched.
- `client/src/utils/__tests__/` — new/extended test files.

Do NOT touch:
- `client/src/hooks/useCodemanDiffLogger.ts` — logger shape unchanged; it captures the same divergence fields post-hotfix (fewer divergences as the classes resolve, which IS the acceptance proof).
- `server/src/routes/debug.routes.ts` — server logger endpoint unchanged.
- `~/.jstudio-commander/codeman-diff.jsonl` — accumulated evidence stays, continues to append post-hotfix.
- 15.3-arc legacy OR-chain (`typedIdleFreshKillSwitch`, `lastTurnEndTs`, `useSessionStateUpdatedAt`, Fix 1/2, Option 2/4, heartbeat-stale guard) — all PRESERVED as fallback and audit counterparty. Rotation 2 deletes them; this hotfix does not.
- `usePromptDetection.ts` (Item 3), ProjectStateDrawer (M7), SessionCard + effortCard (M8), TmuxMirror + usePreference + status-poller mirror tee (Phase T) — all sacred, zero diff.
- ProjectDetailPage, any server file beyond the existing debug route.

If the fix requires touching a file outside the boundary, STOP and ping PM with MINOR/MAJOR classification.

---

## Acceptance gate — Jose live smoke + JSONL audit

**Primary acceptance — post-hotfix JSONL behavior.** After hotfix ships + Jose restarts dev server + hard-reloads browser, Jose uses Commander normally for ~1 hour. During that window:

1. **Class 1 entries should disappear.** Settled-text tail no longer reports `codemanIsWorking=true, codemanLabel="Composing response..."`. If new entries with the Class 1 shape still appear, Fix C didn't land properly — investigate streamingAssistantId propagation.

2. **Class 2 entries still appear in JSONL (legacy is still stuck — expected) but DO NOT cause wrong UI label.** The JSONL captures that legacy is stuck; the UI correctly shows idle because Fix B suppresses the leak.

3. **Class 3 entries should disappear.** When codeman says working, the UI reflects working. If Jose visually sees idle while JSONL shows `codemanIsWorking=true`, Fix A didn't land properly.

**Secondary — non-regression.**

- Approval modal still mounts within ~3s on tool approval (Item 3 sacred, `sessionStatus='waiting'` passthrough preserved in Fix A).
- Phase T mirror still updates.
- M7 STATE.md drawer still toggles and live-updates.
- M8 SessionCard effort click-to-adjust still works.

**PHASE_REPORT explicitly awaits Jose live smoke + ~1 hour of fresh JSONL accumulation before declaring the hotfix ratified.**

---

## Rejection triggers

(a) Files outside boundary touched.
(b) `useCodemanDiffLogger` modified — it's the audit primitive; leave it.
(c) `~/.jstudio-commander/codeman-diff.jsonl` deleted — evidence stays.
(d) 15.3-arc legacy guards modified or deleted — they're fallback + audit counterparty until Rotation 2.
(e) Item 3 / M7 / M8 / Phase T surfaces modified.
(f) Waiting-status passthrough in Fix A missing — approval modal would break.
(g) `streamingAssistantId` extension added to `useChat` but not consumed in `useToolExecutionState` — incomplete Fix C.
(h) Ship-green claim without Jose's ~1-hour JSONL audit declaration.
(i) Speculative-fix on smoke failure — instrument via `[useprefs-instr]`-style tag (or reuse existing `[codeman-diff]` log which already has the coverage) before any new patch.

---

## Commit discipline

Single commit. Message: `fix(ui): Phase Y Rotation 1.5 hotfix — complete parallel-run wiring + streamingAssistantId extension`.

Body explains the three classes from the JSONL evidence, cites entries, describes the three fixes and their coupling, notes the waiting-passthrough preservation, confirms non-regression boundaries.

Reversible via `git revert 9bba6ab` (wait, that's Phase T hotfix; this would be a NEW SHA) — single revert restores pre-hotfix state cleanly.

---

## Sequencing after ship

1. Jose cold-restarts dev server + hard-reloads browser.
2. Jose uses Commander normally for ~1 hour.
3. PM reads fresh JSONL entries, confirms Class 1 and Class 3 are absent, Class 2 entries present (legacy still stuck — expected) but don't produce wrong UI.
4. Jose visually confirms ContextBar tracks reality (working when working, idle when idle).
5. Hotfix ratified → Rotation 2 deletion authorized per dispatch §2.0.

Alternate: if ~1 hour of post-hotfix use reveals a NEW divergence class we haven't seen, that's evidence — we continue accumulating, don't rush Rotation 2.

---

## Standing reminders

Per `feedback_understand_before_patching` + OS §20.LL-L11: this hotfix is EVIDENCE-BACKED, not speculative. 11 JSONL entries already localized the three classes at the level of `codemanIsWorking vs legacyIsWorking vs sessionStatus vs messagesTail` fields. Implementation targets the mechanism, not a guess.

Per `feedback_self_dogfood_applies_to_status_fixes`: CODER's own ContextBar + Jose's PM ContextBar are both live testbeds. Post-hotfix, both should track reality.

Per `feedback_vite_stale_code`: Jose cold-restarts dev server before smoke. Mandatory.

Per `feedback_coder_prompts_in_code_blocks`: PM hands Jose the paste-prompt in a fenced block below.

Go.
