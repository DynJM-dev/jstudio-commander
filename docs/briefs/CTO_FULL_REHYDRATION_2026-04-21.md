# CTO_FULL_REHYDRATION — 2026-04-21

**From:** PM (Commander)
**To:** Commander CTO (fresh Claude.ai thread, context-reset)
**Via:** Jose Bonilla (manual bridge)
**Purpose:** Complete catch-up from zero. Written to stand alone. ~15-minute read.

---

## §1 — TL;DR

- **Issue 15.3 is CLOSED** (all five typed-state classifier fixes + §12 instrumentation breakthrough + two residuals tracked as Candidates 32/33). OS §20.LL-L11 + LL-L12 + `standards/INVESTIGATION_DISCIPLINE.md` landed; every rotation since operates under these.
- **Phase T (tmux mirror pane)** shipped clean (`e4c66c5` + hotfix `9bba6ab`). **Phase Y Rotation 1** (parallel-run Codeman-pattern instrumentation) shipped at `a3a58a2`; **Rotation 1.5 hotfix** shipped at `5a1bc23` + `df5439b` addressing three JSONL-observed divergence classes. `~/.jstudio-commander/codeman-diff.jsonl` is actively accumulating (currently 261 entries).
- **M7 MVP** (live STATE.md pane) and **M8 Primary + Secondary** (effort click-to-adjust + spawn-time override) both shipped. Candidate triage batch closed (2 SHIPPED / 5 DECLINED / 1 INVESTIGATE-COMPLETE / 1 RECONCILED-as-never-shipped).
- **In flight:** Phase Y JSONL observation window. Once JSONL audit clean, Rotation 2 deletes legacy 15.3-arc guards. Candidate 36 (M8 cross-session effort leak in split view, P1) needs an investigation rotation — queued, not yet dispatched.
- **CTO weigh-in needed:** ratify Phase Y Rotation 2 fire when JSONL audit lands; confirm Phase name still "Phase Y: Transcript-Authoritative State"; adjudicate Issue 18 product decision (feature never shipped — pursue or drop).

---

## §2 — Project identity + role architecture

**Project:** `jstudio-commander` at `~/Desktop/Projects/jstudio-commander/`. Internal Command Center tool that manages Claude Code tmux sessions across JStudio projects. Stack: **Fastify 5 + SQLite (better-sqlite3) + React 19 + Vite 7 + Tailwind v4 + WebSockets**. Runs on localhost-only (loopback-bound) with PIN auth. Not a client-delivered product — it is Jose's internal dev tool for running multi-pane Claude Code sessions with heartbeat monitoring, status classification, transcript watching, token accounting, pre-compact automation, tmux-mirror diagnostics.

**Roles (manual-bridge model):**

| Role | Who | What |
|---|---|---|
| **Jose** | Jose Bonilla | Sole human. Decides, ratifies, live-smokes, relays docs between PM and CTO. |
| **PM** | Claude Code session (this one) | Project manager. Writes dispatches, reviews CODER reports, maintains STATE.md, drafts briefs for CTO. |
| **CODER** | Separate Claude Code sessions | Implementation. Executes dispatches, produces PHASE_REPORT. Spawned fresh per phase for context hygiene. |
| **CTO** | Fresh Claude.ai conversation thread (**you**) | Strategic advisor. Ratifies phase scopes, answers architectural questions, reviews dispatch drafts before fire. Resets periodically via browser context-window reset — which is why this doc exists. |

Communication: all docs produced by PM land on disk (STATE.md, dispatches/, briefs/, reports/). Jose uploads briefs to Claude.ai CTO thread, copies responses back to disk. One-round per exchange. No direct wire.

**New-CTO note:** when you last had context, you had responded to: (a) 15.3 close brief with strategic sequence + OS §20 propagation plan, (b) Phase Y scoping brief with Amendments Q1-Q6, (c) Phase Y dispatch draft with Amendments 1-5, (d) Phase T dispatch draft with Amendment 1. All those responses are on disk under `docs/briefs/`. This doc rebuilds your memory of that thread.

---

## §3 — Active standing disciplines (READ BEFORE RATIFYING ANYTHING)

Three disciplines landed 2026-04-20 and are now **mandatory** for every rotation. New CTO must honor these when advising; they are post-15.3 constitutional for this project.

### §20.LL-L11 — Instrumentation rotation when symptom doesn't move

If a fix ships unit-green and live smoke reproduces the symptom unchanged, the hypothesis was wrong — not the implementation. **Do NOT ship another speculative fix.** Fire an instrumentation rotation per `standards/INVESTIGATION_DISCIPLINE.md`: temporary runtime logging at every decision point in the implicated derivation chain, multi-case capture with working/failing control pair, diagnostic document before any new fix.

Codified from Issue 15.3 Tier A (`41c0f2c` reverted at `93b25dc` after unit-green ship failed live smoke identically to pre-fix; §12 instrumentation at `e41a3ee` broke the pattern → `dab9896` closed P0 on first live smoke).

### §20.LL-L12 — Diagnostic docs don't validate their own hypotheses

A written diagnostic with citations and fix-shape sections can still be wrong about the mechanism. Rigor in documentation is not evidence of correctness in localization. Require runtime capture (instrumentation or live trace) for any diagnostic naming a mechanism as class root cause before the fix dispatch fires.

Codified from 15.3 v5 §11.1 (named `getActionInfo` tail-block scan; §12 instrumentation later proved mechanism correct but bug was downstream in `resolveActionLabel`).

### `standards/INVESTIGATION_DISCIPLINE.md`

Landed at `~/Desktop/Projects/jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md`. Specifies:
- Trigger conditions (unit-green-live-fail OR second speculative stack)
- Protocol (dedupe-gated logging, grep-strippable tag prefix, strip verification pre-commit)
- Capture discipline (multi-case matrix with WORKING-CASE control + FAILING-CASE target, min 3 cases / 5 if asymmetry suspected)
- Deliverable (diagnostic doc with logs + case diff + named class root cause; zero fix code)
- Acceptance gate (PM-reviewed → Jose ratified → THEN fix dispatch authorized)

Every post-15.3 rotation dispatch references these. CTO drafts reviewed under this lens should reject any "let's just try a fix" rotation that can't cite either fresh runtime evidence or a standing discipline exemption.

---

## §4 — Full session arc (chronological)

### 4.1 Issue 15.3 CLOSED — `c34b278`

Full 15+ rotation arc over two sessions, closed 2026-04-20. Canonical typed SessionState classifier replaced scattered pane-regex derivation. Final ship stack:

| SHA | Role |
|---|---|
| `fee7f35` | Phase 1 — canonical SessionState union, dual-emit on `session:status` |
| `9abe598` | Phase 1.1 — emit on subtype change |
| `ec3528a` | §6.1 — invert `resolveActionLabel` Working path |
| `94e5c09` | §6.2 — OR-gate `isSessionWorking` on unmatched tool_use |
| `0aefcf1` | §6.3 — exempt heartbeat-stale gate when tool in flight |
| `d60d0f6` | §6.1.1 — thread `isWorkingOverride` from ChatPage to ContextBar |
| `cf28597` / `5d7f57c` / `2ecfa2b` | §6.4 Δ1 + Δ2 + test — POLL 5s→1.5s + cooldown exemption |
| `41c0f2c` | Tier A Item 1 — REVERTED at `93b25dc` (unit-green, live-smoke-failed) |
| `00f1c30` | Tier A Item 3 — PRESERVED. Removed `isActive` gate in usePromptDetection, idle cadence → 8s |
| `e41a3ee` | **§12 instrumentation rotation** — the inflection commit |
| `dab9896` | Fix 1 + Fix 2 — isSessionWorking OR typed-Working w/ freshness + resolveActionLabel typed:Idle fall-through |
| `f9ab17d` | Option 4 — hard-off on fresh typed-Idle |
| `7680da0` | Option 2 — turn-bounded freshness lock on unmatchedToolUse true→false |
| `4d85d02` | Activity-gap — hold userJustSent through pre-tool thinking window |
| `c34b278` | 15.3-CLOSED docs, orphan rename |

**What §12 proved:** client uses `session.status` (pane-regex server-side, 2-60s lag) as the SOLE Working/Idle gate but `sessionState.kind` (typed) as the SOLE label-source gate. These two server signals disagree for 15-20s windows. Each prior fix was a patch across those disagreement windows. Codeman-model migration (Phase Y) is the architectural answer.

**Residuals accepted:** Candidate 32 (intermittent activity-missing on multi-step tool sequences) + Candidate 33 (intermittent 60s stuck "Running command..."). Both trace to the same `session.status` unguarded OR-branch root cause Phase Y deletes.

**Non-regression surfaces locked:** typed SessionState emission, resolveActionLabel, isSessionWorking composite at `ChatPage.tsx:329-332`, usePromptDetection Item 3 gate removal.

### 4.2 OS propagation pass

Landed in single batch after 15.3 close:
- OS §20 additions: LL-L11, LL-L12 (text above).
- OS §23 changelog v3 entry for 15.3 close (references `dab9896`, `f9ab17d`, `7680da0`, `4d85d02`; residuals; post-M7 Codeman migration queued).
- New file: `~/Desktop/Projects/jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md`.
- STATE.md flipped to 15.3 CLOSED.
- Memory files: `feedback_understand_before_patching.md` at project level confirmed; global propagation via OS §20 supersedes need for per-project duplication.

### 4.3 Candidate Triage Batch — `d3c5c5a`, `848e481`, `c3c97d0`

Report: `docs/reports/CANDIDATE_TRIAGE_REPORT_2026-04-20.md` (full verdicts).

| Cand | Verdict | Notes |
|---|---|---|
| 19 | **SHIPPED** `848e481` | P1 destructive — split-view ESC cross-pane guard via new `paneFocus.ts` predicate |
| 31 | **SHIPPED** `d3c5c5a` | Hygiene — restore §6.1.1 integration test from `.disabled` |
| 24 | DECLINED | /compact input buffer — likely browser autocomplete, no Commander mechanism |
| 26 | DECLINED execution | token_usage audit inline (750 rows / 5 sessions; `INSERT OR IGNORE` is no-op due to missing UNIQUE) |
| 27 | INVESTIGATE-MORE | `recovered-jsc-*` literal not in source — archaeology needed |
| 28 | DECLINED | Empty commander.db at repo root — already handled by `.gitignore` |
| 29 | DECLINED (then REOPENED) | `task_reminder` — CODER found parser routing at `:512`; Jose observed unmapped chips in live UI → reopened |
| 30 | DECLINED | Markdown visual parity — scope too large for single-commit, needs formal per-axis gap catalog |
| Issue 18 | RECONCILED as NEVER SHIPPED | Zero commits across all branches, no DB schema support |

Test suite 310 → 326 post-batch.

### 4.4 Candidate 22 pre-M8 — `c78e238`

Plan-widget false-match fix. Removed markdown-shape numbered-list detection from `text-renderer.tsx`; preserved TaskCreate structured path. Visual verified GREEN by Jose.

### 4.5 M8 Primary — `1d33160`

Click-to-adjust effort on SessionCard. Duplicated via new pure helpers at `client/src/components/sessions/effortCard.ts` (dispatch boundary forbade touching ContextBar). Test 326 → 337.

### 4.6 Issue 15.3 heartbeat-stale guard (out-of-sequence) — `41a55e9`

Jose-authorized mid-M7-dispatch after observing ContextBar stuck on "Composing a response" for ~1150s on pure-text Claude turn. Narrow fix: added `&& !heartbeatStale` to typed-Working OR-branch at `ChatPage.tsx:329-332`. Targeted revert via `git revert 41a55e9` clean.

### 4.7 M7 MVP — `6db16d1`

Live STATE.md pane. Split-view-aware, per-pane scoped. New WS event `project:state-md-updated` on channel `project-state:<sessionId>`, `emitProjectStateMd` method, new `GET /api/sessions/:id/project-state-md` initial-fetch endpoint. Client: `useProjectStateMd(sessionId)` hook + `ProjectStateDrawer.tsx` + `Cmd+Shift+S` toggle. Reuses existing `StateViewer.tsx`. Subscription firewall source-verified. Test 340 → 348. Jose Case 2 verified directly (live update propagates).

Full-M7 (all 4 canonical files, tabs, project-type badge) deferred indefinitely per migration brief §8.

### 4.8 Phase T MVP — `e4c66c5` + hotfix `9bba6ab`

Per-session read-only tmux mirror pane. Option A (signature extension on `capturePane` with `preserveAnsi` opt). Tees via `emitSessionPaneCapture` on channel `pane-capture:<sessionId>`, client renders via `ansi_up` in scroll-pin div, 200px fixed height. Amendment 1 dedupe: `Map<sessionId, string>` gate at `status-poller.service.ts:171/268` + cleanup on deleteSession/purgeTeamSession.

**Hotfix `9bba6ab`:** smoke Case 4 (toggle hide) failed — `usePreference.ts` module-level cache Map defeated WS `preference:changed` listener's peer-instance sync. Added module-level pub-sub with self-skip via `useRef`. 6 new tests (peer sync, self-null, cleanup, re-subscribe, cross-key isolation, unknown-key no-op). Multi-instance consumer audit: only `useSessionUi` hit the bug. Test 348 → 354 post-hotfix.

Dispatches: `PHASE_T_TMUX_MIRROR_DISPATCH.md` + `PHASE_T_HOTFIX_USEPREFERENCE_SAMETAB_SYNC.md`.

### 4.9 Phase Y Rotation 1 — `a3a58a2` (parallel-run instrumentation LIVE)

8 files, +1093/-5. New hooks:
- `useToolExecutionState.ts` (+244 LOC): **Codeman-pattern** hook. Derivation order **compact → tool_exec → composing → idle**. Returns `{isWorking, currentTool: string | string[] | null, label, subtype}`. Parallel tool_use synthetic label capped at 2 distinct names. Per-session isolation via caller-scoped `messages`.
- `useCodemanDiffLogger.ts` (+163 LOC): dedupe-gated divergence logger. Console emit + `POST /api/debug/codeman-diff` fire-and-forget.
- `server/src/routes/debug.routes.ts` (+42 LOC): **TEMPORARY** (Rotation 2 deletes). Loopback-IP-gated. Appends to JSONL at `~/.jstudio-commander/codeman-diff.jsonl`.

ContextBar wires Codeman-pattern as primary via `??`, legacy path preserved byte-for-byte as audit counterparty. Test 354 → 381. Ratified investigation answers: A=candidate (b) list-or-synthetic, B=ChatMessage-tail scan window=8, C=no useChat extension initially.

Dispatch: `docs/dispatches/PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md` (v2, Amendments 1-5 folded).

### 4.10 Phase Y Rotation 1.5 HOTFIX — `5a1bc23` + `df5439b`

Two-commit hotfix (account-switch interruption split authorship). **Both commits required for coherent revert** — neither is standalone.

Three divergence classes observed in the accumulating JSONL motivated three fixes:

| Class | JSONL evidence | Fix |
|---|---|---|
| **Class 1** | Codeman stuck `composing` on settled text tail (codeman=working, legacy=idle, messagesTail shows trailing `text` block with sessionStatus=idle) | **Fix C** — streamingAssistantId extension (Investigation C un-deferred) consumed in hook composing-branch gate with 3s stability timer |
| **Class 2** | Legacy stuck-composing leaking through `??` fallback (codeman=idle/null, legacy=working with "Composing response...") | **Fix B** — `resolveActionLabelForParallelRun` returns null when `codemanIsWorking === false` |
| **Class 3** | New-pattern detects work, legacy's typedIdleFreshKillSwitch suppresses UI (codeman=working tool_exec, legacy=idle, sessionStatus=working) | **Fix A** — effectiveStatus codeman override with LOAD-BEARING `sessionStatus==='waiting'` passthrough at top of `resolveEffectiveStatus` precedence chain (Item 3 `00f1c30` approval-modal path preserved) |

Tests 381 → 397. Typecheck clean all three packages.

**JSONL current state (as of this report):** 261 entries. First 3 entries show Class 1 clearly (codeman=true/composing vs legacy=false/null on a text-block-only messagesTail). Last 3 entries show Rotation 1.5 post-hotfix behavior, including one line where `codemanLabel="Running Agent"` aligns with legacy `"Spawning agent..."` (expected divergence — different label vocabularies, both correct). This is the live audit surface for Rotation 2 fire readiness.

Dispatch: `PHASE_Y_ROTATION_1.5_HOTFIX_DISPATCH.md`.

### 4.11 M8 Secondary — `6b67cb5`

CreateSessionModal effort override at spawn. 4 files +344/-16. Server-side **zero edits** (session.service.ts already accepted `opts.effortLevel`). Test 397 → 411. Case 2 smoke surfaced Candidate 36 (cross-session effort leak — NOT caused by M8 Secondary, pre-existing in M8 Primary).

### 4.12 Candidate 27 INVESTIGATE-COMPLETE (archaeology)

PM-executed git archaeology localized the `recovered-jsc-*` construction site: `server/src/index.ts:275-303` startup orphan-tmux-adoption path (commit `d09534e`). Synthetic id `<8hex>-0000-0000-0000-000000000000` + display name `recovered-${tmuxSession.name}`. `upsertSession` doesn't pass `claude_session_id` → no reconciliation ever happens. Fix direction (future dispatch): explicit reconciliation on first hook from synthetic-id row's tmux pane, OR TTL-delete. Flip INVESTIGATE-MORE → INVESTIGATE-COMPLETE.

### 4.13 Candidate 36 instrumentation rotation (IN FLIGHT)

Cross-session effort leak in split view. Jose observed during M8 Secondary Case 2 smoke: changing CODER session's effort to Low via SessionCard click leaked into PM session's actual Claude Code runtime (PM Live Terminal showed Low, PM ContextBar dropdown correctly showed Medium). P1 destructive UX — effective-state leak, not display artifact.

Same architectural class as Candidate 19 (ESC cross-pane). Fix pattern hypothesis: route action off pane-focus data attribute rather than shared context. Investigation dispatch drafted at `docs/dispatches/CANDIDATE_36_INSTRUMENTATION_DISPATCH.md` (2026-04-21 00:02). NOT FIRED yet — queued after Phase Y Class 1 investigation resolves, OR as pre-Rotation-2 hotfix if fix surface is small.

---

## §5 — Phase Y current state (active architectural thread)

**Definition (jargon unpack):** *Transcript-authoritative state derivation* = computing ContextBar's "is session working?" + label strictly from `ChatMessage[]` (the parsed JSONL transcript stream) instead of from three-server-signal OR-chain (pane-regex `session.status` + typed `sessionState.kind` + client-side `unmatchedToolUse`). Modeled after Codeman's `transcript-watcher.ts`.

**Where we are:** Rotation 1 + 1.5 LIVE. Codeman-pattern is primary consumer in ContextBar; legacy path still computes as audit counterparty. JSONL at `~/.jstudio-commander/codeman-diff.jsonl` accumulating divergence entries at ~1 per few seconds of use during active work.

**The three divergence classes:**

1. **Class 1** — new-pattern stuck `composing` on settled text tail. **Rotation 1.5 Fix C addresses.** Post-hotfix expectation: absent from new JSONL entries.
2. **Class 2** — legacy stuck-composing leaking through `??` fallback. **Rotation 1.5 Fix B addresses.** Post-hotfix expectation: still captured in JSONL (legacy still has bug) but non-leaking to UI — Codeman null return prevents `??` from picking up legacy's wrong label.
3. **Class 3** — new-pattern correctly detects work but legacy's typedIdleFreshKillSwitch suppresses UI. **Rotation 1.5 Fix A addresses.** Post-hotfix expectation: absent from new JSONL entries (Codeman override at top of resolveEffectiveStatus).

**streamingAssistantId mechanism (CODER added in Rotation 1.5):** useChat exposes a `streamingAssistantId: string | null` tracking the currently-streaming assistant message; useToolExecutionState consumes it in the composing-branch gate with a 3s stability timer. Rationale: Investigation C had originally been closed with "no useChat extension needed" — JSONL evidence class 1 proved that wrong. streamingAssistantId is the new signal. JSONL evidence since Rotation 1.5 suggests the mechanism shipped but may not be propagating in 100% of cases.

**Next-action list:**

1. Jose deliberately triggers low-frequency classes (/compact mid-turn + sub-agent spawn + approval modal) to capture rare divergence shapes.
2. PM audits JSONL at ~200-300 entries OR 24h, whichever first.
3. **If audit clean** (every disagreement has a documented explanation, ≤5 unexplained classes per CTO Amendment 5): fire Rotation 2 dispatch (already drafted in v2 of `PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md`, deletes legacy 15.3-arc guards aggressively per Q2).
4. **If Class 1 persists post-hotfix**: fire streamingAssistantId-specific instrumentation rotation per §20.LL-L11. Do NOT speculative-fix.
5. **If any unexplained class surfaces**: STOP, reopen architectural conversation before any deletion.

**Rotation 2 rollback gate (per CTO Q6):** if final live smoke fails any of 6 acceptance criteria → `git revert` the deletion commits (NOT Rotation 1's Codeman-pattern addition). Parallel-run remains live. Re-diagnose. Same if residual surfaces within 72h of real-use.

---

## §6 — Candidate queue snapshot

| # | Status | Summary | Priority |
|---|---|---|---|
| 19 | SHIPPED `848e481` | Split-view ESC cross-pane interrupt guard | P1 (closed) |
| 20/21 | RESOLVED by 15.3 Phase 1 | — | — |
| 22 | SHIPPED `c78e258` | Plan-widget numbered-list false match | — |
| **23** | **NEW / queued** | Claude Code runtime `contextLimit` investigation | Resolved jointly by Phase Y Codeman-model family |
| 24 | DECLINED | /compact input buffer — browser autocomplete suspected | — |
| 26 | DECLINED execution | `token_usage` audit inline; retention + UNIQUE migration future dispatch | — |
| 27 | INVESTIGATE-COMPLETE | `recovered-jsc-*` archaeology — `index.ts:275-303` + `d09534e` | — |
| 28 | DECLINED | Empty commander.db at repo root | — |
| 29 | REOPENED | `task_reminder` renderer gap — Jose live-observed unmapped chips contradicting CODER triage | P2 |
| 30 | DECLINED | Markdown visual parity with VSCode Claude — needs gap catalog | P2 |
| 31 | SHIPPED `d3c5c5a` | §6.1.1 test orphan restore | P3 (closed) |
| **32** | **Queued** | Case 3 intermittent activity-missing (multi-step tool sequences) | P2, Phase Y family |
| **33** | **Queued** | Case 5 intermittent 60s stuck "Running command..." | P2, Phase Y family |
| 34 | NEW | Permission-mode selector (Ask/Edit/Plan) mirroring M8 effort pattern | P2 |
| 35 | NEW | Renderer registry audit for Claude Code ambient UI; overlaps 29 | P2 |
| **36** | **IN FLIGHT (investigation dispatch drafted)** | M8 Primary cross-session effort leak in split view | **P1 destructive UX** |

**Architecture family to be resolved by Phase Y:** 23, 32, 33. All three embody the "trust client-side structured signals over server-derived values" pattern. Phase Y Rotation 2 closes the family jointly (STATE.md §4.1 residuals retire automatically).

**Architecture family to be resolved by Candidate 36 rotation:** 19 + 36. Same cross-pane routing class; 19's `paneFocus.ts` predicate may become the canonical pattern.

---

## §7 — Non-candidate work queue

- **Issue 13.1 — Schema cascade migration.** Four FK gaps (session_ticks no FK; cost_entries / skill_usage / notifications SET NULL) need CASCADE conversion + one FK add. Dedicated rotation: migration design, rollback path, smoke-test plan. DECLINED as part of triage batch; queued for own dispatch.
- **Issue 17 — Polish batch.** DECLINED as a batch. Sub-items (`scheduled_task_fire`, `task_reminder`, Archived Sessions view, retention 30→20) may each be candidate-worthy after per-item triage. `task_reminder` = Candidate 29 (reopened).
- **Issue 18 — Delete Archived Sessions.** **RECONCILED as never shipped.** Zero commits across all branches, no DB schema support (no `archived`/`is_archived` column). **CTO judgment needed** on whether the feature is still desired; if yes, a scoping brief.
- **15.1-F — Pre-restart subscription reinit gap.** DECLINED — narrow, workaround-ed.
- **15.4 — Idle-label semantics.** DECLINED — Phase-4 polish; bundles with post-Phase-Y renderer-registry family.

---

## §8 — Open questions for CTO

1. **Phase Y Rotation 2 fire.** Dispatch drafted at `docs/dispatches/PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md` v2 with Amendments 1-5 folded. Fire readiness depends on JSONL audit: when JSONL shows ≥200 entries OR 24h elapsed with audit clean (Class 1 + Class 3 absent post-hotfix, Class 2 non-leaking, ≤5 unexplained classes), PM returns audit summary and asks CTO for final fire ratification. **CTO does NOT need to re-review the dispatch — only ratify fire once audit lands.**

2. **Phase name confirmation.** Locked earlier as **"Phase Y: Transcript-Authoritative State"** (rejecting "Structured-Signal Primacy" as abstract and "ChatMessage-Authoritative Derivation" as mouthy). If fresh CTO has no strong opinion, the name stays locked.

3. **Issue 18 product decision.** Was it in the scoped feature set originally? Is "Delete Archived Sessions" still desired, or drop the concept? This is a Jose-facing product call more than an architectural one but CTO weigh-in sets queue priority.

4. **Candidate 36 investigation rotation sequencing.** Dispatch drafted and queued. Fire before OR after Phase Y Rotation 2? P1 destructive but small surface. PM lean: after Phase Y Rotation 2 ships clean (dedicate full attention to Phase Y first). CTO lean?

5. **Candidate 29 + 35 merger.** Both target renderer registry. Merge into single audit-and-extend dispatch when dispatched? PM lean: yes, merge. One rotation catalogs event-type gaps and extends registry.

---

## §9 — What NOT to relitigate (ratified decisions)

Fresh CTO should honor these without re-opening:

- **Phase Y scope** — Q1 incremental with parallel-run diff; Q2 deletion policy (session.status server-side stays / client consumption deletes / sessionState.kind emission stays / 15.3-arc guards delete aggressively in Rotation 2 / Item 3 untouched); Q3 six acceptance criteria (5-case matrix + pure-text turn + intermittency + parallel-diff clean + split-view + sub-agent); Q4 phase name **Phase Y: Transcript-Authoritative State**; Q5 six architectural constraints (parallel tool_use, split-view per-pane, sub-agent, /compact, approval-modal non-regression, poll lifecycle); Q6 rollback gate (ship-clean-and-survives-72h-dogfood).
- **Phase Y Amendments 1-5** — log storage server-side via `/api/debug/codeman-diff` + JSONL; Investigation C (useChat streaming cadence); Test 8b structural React-tree isolation; sub-agent test procedure spelled out; audit volume thresholds (>5 unexplained classes blocks Rotation 2; >10k with ≤5 explained triggers summary aggregation).
- **Phase T scope + Amendment 1** — tmux mirror pane Option A; server-side emit dedupe via `Map<sessionId, string>`.
- **OS §20.LL-L11 + LL-L12 language** — already landed. Do not re-edit.
- **Instrumentation-rotation discipline as the standard pattern** — per `standards/INVESTIGATION_DISCIPLINE.md`.
- **Investigation-first on any "symptom doesn't move" case** — NO speculative-fix stacking. Second stack without runtime evidence = §20.LL-L11 violation.
- **Post-M7 Codeman-model migration as a distinct named phase** — NOT "15.3 residuals." It is bigger than 15.3; it deletes the derivation chain 15.3 patched.
- **Ship-with-residual for 15.3** — Candidates 32/33 accepted as honestly-scoped debt, retired by Phase Y.
- **M7 Full deferred indefinitely** per migration brief §8.
- **15.3 heartbeat-stale guard `41a55e9`** is out-of-sequence but ratified — do not revert unless part of Phase Y Rotation 2 aggressive-delete pass.

---

## §10 — Critical file references (appendix)

**Master state:**
- `/Users/josemiguelbonilla/Desktop/Projects/jstudio-commander/STATE.md` — the live log.

**Standards / OS:**
- `/Users/josemiguelbonilla/Desktop/Projects/jstudio-meta/OPERATING_SYSTEM.md` — §20 (lessons), §23 (changelog).
- `/Users/josemiguelbonilla/Desktop/Projects/jstudio-meta/standards/INVESTIGATION_DISCIPLINE.md` — instrumentation-rotation protocol.

**CTO briefs + responses (chronological, 2026-04-20):**
- `docs/briefs/CTO_BRIEF_15.3_close.md`
- `docs/briefs/CTO_RESPONSE_2026-04-20_15.3_close.md`
- `docs/briefs/CTO_BRIEF_codeman_model_phase.md`
- `docs/briefs/CTO_RESPONSE_2026-04-20_codeman_phase.md`
- `docs/briefs/CTO_RESPONSE_2026-04-20_phase_Y_draft_review.md`
- `docs/briefs/CTO_BRIEF_2026-04-20_phase_T_tmux_mirror.md`
- `docs/briefs/CTO_RESPONSE_2026-04-20_phase_T_draft_review.md`
- `docs/briefs/M7_M8_MIGRATION_BRIEF.md`
- `docs/briefs/PHASE_Z_NATIVE_APP_PLAN.md` — exploratory post-Phase-Y native app plan (not yet ratified)

**Dispatches (2026-04-20):**
- `docs/dispatches/15.3_v5_INVESTIGATION_DISPATCH.md`
- `docs/dispatches/15.3_TIER_A_CODE_DISPATCH.md`
- `docs/dispatches/15.3_INSTRUMENTATION_DISPATCH.md` (the §12 rotation)
- `docs/dispatches/15.3_FIX_ROTATION_DISPATCH.md`
- `docs/dispatches/CANDIDATE_22_DISPATCH.md`
- `docs/dispatches/CANDIDATE_TRIAGE_BATCH_DISPATCH.md`
- `docs/dispatches/M7_MVP_STATE_MD_PANE_DISPATCH.md`
- `docs/dispatches/M8_EFFORT_UI_DISPATCH.md`
- `docs/dispatches/M8_SECONDARY_CREATESESSIONMODAL_EFFORT_DISPATCH.md`
- `docs/dispatches/PHASE_T_TMUX_MIRROR_DISPATCH.md`
- `docs/dispatches/PHASE_T_HOTFIX_USEPREFERENCE_SAMETAB_SYNC.md`
- `docs/dispatches/PHASE_Y_TRANSCRIPT_AUTHORITATIVE_STATE_DISPATCH.md` **(v2 — Rotation 2 dispatch, awaiting JSONL audit to fire)**
- `docs/dispatches/PHASE_Y_ROTATION_1.5_HOTFIX_DISPATCH.md`
- `docs/dispatches/CANDIDATE_36_INSTRUMENTATION_DISPATCH.md` **(drafted, not fired)**

**Reports:**
- `docs/reports/CANDIDATE_TRIAGE_REPORT_2026-04-20.md`

**Diagnostics:**
- `docs/15.3-diagnostic.md` — §12 specifically (instrumentation-rotation findings, named class root cause).

**JSONL audit surface:**
- `/Users/josemiguelbonilla/.jstudio-commander/codeman-diff.jsonl` — 261 entries at time of writing. Schema: `{ts, sessionId, codemanIsWorking, codemanLabel, codemanSubtype, legacyIsWorking, legacyLabel, sessionStatus, sessionStateKind, messagesTail[]}`. Grep-queryable.

---

## §11 — Recent commit SHAs (appendix)

Chronological, newest first, per `git log --oneline -30`:

```
6b67cb5 feat(ui): M8 Secondary — CreateSessionModal effort override at spawn
787f34a docs: add Phase Z native app plan (post-Phase-Y exploratory)
df5439b fix(ui): Phase Y Rotation 1.5 hotfix — complete parallel-run wiring + streamingAssistantId extension
5a1bc23 docs: commit in-flight docs before account switch  [actually carries Rotation 1.5 hook-logic half]
c129e46 chore: full handoff docs committed before account switch
a3a58a2 feat(ui): Phase Y Rotation 1 — useToolExecutionState hook + parallel-run diff instrumentation
9bba6ab fix(ui): usePreference same-tab multi-instance sync (Phase T toggle hotfix)
e4c66c5 feat(ui): Phase T MVP — tmux mirror pane (read-only, per-session, ANSI color)
6db16d1 feat(ui): M7 MVP — live STATE.md pane (split-view-aware, per-pane scoped)
41a55e9 fix(ui): Issue 15.3 — heartbeat-stale guard on typed-Working OR-branch (close pure-text trailing edge)
1d33160 feat(ui): M8 — click-to-adjust effort on SessionCard
c3c97d0 docs(triage): Candidate Triage Batch Report 2026-04-20
848e481 fix(ui): Candidate 19 — split-view cross-pane interrupt guard on ESC handler
d3c5c5a fix(hygiene): Candidate 31 — restore §6.1.1 integration test from .disabled
c34b278 docs(15.3): close phase — state, CTO brief, session dispatches, orphan rename
4d85d02 fix(ui): Issue 15.3 — hold userJustSent through pre-tool thinking window (close visible Idle gap on send)
7680da0 fix(ui): Issue 15.3 — Option 2 turn-bounded freshness lock (close Case 3 60s Running command trailing edge)
f9ab17d fix(ui): Issue 15.3 — Option 4 hard-off on fresh typed-Idle (close post-reply trailing edge)
dab9896 fix(ui): Issue 15.3 — Fix 1 + Fix 2 close session-status/typed-state signal asymmetry
e41a3ee docs(15.3): §12 instrumentation rotation findings
c78e238 fix(ui): Candidate 22 — remove markdown-shape Plan detection, preserve TaskCreate structured path
93b25dc Revert "fix(ui): Issue 15.3 Tier A — Item 1 reverse-scan last-assistant-run for tool_use"
00f1c30 fix(ui): Issue 15.3 Tier A — Item 3 remove isActive gate + scale idle cadence
41c0f2c fix(ui): Issue 15.3 Tier A — Item 1 reverse-scan last-assistant-run for tool_use  [REVERTED at 93b25dc]
2ecfa2b test(commander): §6.4 Delta 2 cooldown-exemption coverage
5d7f57c fix(commander): Issue 15.3 §6.4 Delta 2 — exempt force-idle cooldown when pending tool_use in transcript
cf28597 fix(commander): Issue 15.3 §6.4 Delta 1 — drop POLL_INTERVAL 5_000 → 1_500ms
d60d0f6 fix(commander): Issue 15.3 §6.1.1 — thread isWorkingOverride composite from ChatPage to ContextBar
ad4a52f docs(15.3): v4 addendum — ContextBar wire-through trace + §6.4 re-tune proposal
0aefcf1 fix(commander): Issue 15.3 §6.3 — exempt heartbeat-stale gate when a tool is in flight
```

---

**End of rehydration document.**
