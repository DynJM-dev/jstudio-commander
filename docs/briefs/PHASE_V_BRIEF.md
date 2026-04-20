# PHASE_V_BRIEF — Post-compact state-tracking diagnosis

**Author:** CTO (Claude.ai)
**Date:** 2026-04-17
**Target:** PM (Commander) → coder-16
**Type:** Diagnostic + targeted fix. Not a rewrite. Bounded scope.

---

## Symptom

Jose reports multiple sessions showing stuck-state behavior **specifically after compaction**:

- `coder@ovagas` — "thinking 9500s" after /compact
- `coder@jl-family` — "composing response" after /compact
- `pm@jl-family` — "composing response 1100s"
- `coder@ovagas-test` — "thinking 920s" (may or may not be post-compact — verify)

This is observed **after** Phase U.1 shipped. The existing patches (Stop hook routing, claude_session_id binding, 90s force-idle, oscillation cooldown, ACTIVE_INDICATORS chrome fix) all work correctly on freshly-created sessions. Something about the compaction event disrupts the state-tracking that was working before compact.

## Hypothesis

When Claude Code compacts, the transcript_path rotates — a new JSONL file is created under `~/.claude/projects/<hashed-cwd>/` with a new UUID filename. The hypothesis has two plausible failure modes:

**Mode A: claude_session_id becomes stale.**

`sessions.claude_session_id` was bound (Patch 0) at spawn time or auto-learned (Phase U Fix 1) after the first hook. After compact, Claude Code may preserve the session_id OR generate a new one. If a new one is generated, hooks arrive with the new UUID that no row is bound to. resolveOwner falls through to heuristic strategies (cwd-rotation etc.) or drops the event.

**Mode B: transcript_path reference goes stale.**

`sessions.transcript_paths` is a JSON array of transcript paths associated with the row. After compact, the old path is still in the array but no longer receiving writes — the new path is the live one. If hook routing or file-watcher logic preferences the first entry in `transcript_paths` (likely the oldest), it'll route to a dead path. The row's `last_hook_at` / `last_activity_at` never update.

Both modes produce the observed symptom: row stays in `working` state, `last_activity_at` freezes at the pre-compact timestamp, Phase U's 90s force-idle should theoretically fire but may not if `force_idled_at` got updated shortly before compact (cooldown still active) or if something about the row suggests it's not truly idle.

## Scope of Phase V

**Phase V is DIAGNOSIS + TARGETED FIX.** It is NOT a rewrite of the state-tracking layer. Four tasks, in order:

### Task 1 — Reproduce and capture

Spawn a fresh Commander-managed session in any project (OvaGas ideal since it's where the bug was reported). Give it a small task. Let it work for ~10 minutes accumulating context. Then manually trigger `/compact`.

Capture the following AT EACH of these moments:

**T0 — spawn:**
- `SELECT * FROM sessions WHERE id = <row>` — row state
- Which JSONL files exist under `~/.claude/projects/<hash>/`

**T1 — 10 min in, before compact:**
- Same SELECT
- Same directory listing
- What the pane shows

**T2 — immediately after `/compact` issued:**
- Same SELECT
- Same directory listing
- What the pane shows
- Any `[hook-event]`, `[spawn-bind]`, `[poller]` log lines fired during the compact

**T3 — 2 minutes after compact, session idle:**
- Same SELECT
- Same directory listing
- What the pane shows
- What the Commander UI shows for this session

Commit the raw captures to `docs/phase-v-repro-YYYYMMDD.md`. Do not propose a fix yet. Just report what changed across T0–T3.

### Task 2 — Identify the failure mode

From the Task 1 captures, determine:

1. Did `claude_session_id` change on the row? Was a new JSONL file created? Is it the same UUID or different?
2. Did `last_hook_at` update during or immediately after compact?
3. Did `last_activity_at` update?
4. If a new JSONL file was created, did the existing file-watcher catch it? Is it in `sessions.transcript_paths`?
5. When a hook arrives for this session post-compact, which resolveOwner strategy matches? Or does it drop?

Report the findings as a clear "this is what happened" statement. Classify as Mode A, Mode B, both, or something else entirely.

### Task 3 — Propose targeted fix

Based on Task 2 findings:

**If Mode A (claude_session_id stale):**
- Add a chokidar watch on `~/.claude/projects/<hashed-cwd>/` for every active session (not just at spawn time — a persistent watch for the session's lifetime)
- When a new JSONL file appears under the watched directory for an existing session, the row's claude_session_id should be UPDATED to the new UUID, and the old path remains in `transcript_paths` as history
- This is essentially "extended Patch 0" — keep binding for the session's full lifetime, not just the first 30 seconds

**If Mode B (transcript_path stale):**
- Ensure every transcript_path rotation appends to `sessions.transcript_paths` (newest first)
- Ensure file-watcher reads the newest path, not the oldest
- Ensure hook routing preferences the newest path when multiple transcripts exist

**If both:**
- Combined fix covering both paths

**If something else:**
- Stop and report to CTO. Do not implement until the failure mode is understood.

Do NOT propose a sweeping change to the state machine. The existing architecture works correctly on non-compact paths. The fix should target the specific post-compact rotation event.

### Task 4 — Implement, test, verify

Standard JStudio discipline:

- Test-first: write red tests that reproduce the pre-fix behavior (post-compact stuck state)
- Implement the minimum change to turn tests green
- Integration test that does the full repro from Task 1 with the fix applied — confirm all four T captures now show correct behavior
- Report via PHASE_REPORT format

## Do not do in Phase V

- **Do not** rewrite `resolveOwner`. The 5-strategy cascade works; we're fixing an input, not the matcher.
- **Do not** rewrite the status-poller. Phase U.1 shipped a hardened poller; leave it.
- **Do not** touch the `ACTIVE_INDICATORS` regex. That was Phase U.1 Fix 2.
- **Do not** change the force-idle threshold or cooldown. Those are working.
- **Do not** add new hook types (PreCompact, etc.) in this phase. If the diagnosis finds we need PreCompact wiring, that's a separate phase.

## Escalation triggers

Coder-16 should escalate to PM → CTO if:

- Task 1 captures show no observable state change across T0-T3 (meaning the bug isn't what we think it is — re-diagnose)
- Task 2 identifies a failure mode outside Mode A or Mode B
- The proposed fix in Task 3 touches >3 files or introduces a new service
- Tests can't be written to reproduce the stuck state deterministically (might need a different verification approach)

## Estimated scope

- Task 1 (repro + capture): 30 minutes
- Task 2 (analyze + classify): 30 minutes
- Task 3 (propose fix): 30 minutes, waits for CTO approval if it's ambiguous
- Task 4 (implement + test + verify): 2-3 hours

Total: 4-5 hours. Well within one session. Context burn should stay under 40%.

## Open question flagged upfront

Claude Code has a `PreCompact` hook. Jose's current `~/.claude/settings.json` does NOT have it wired (per CTO_SNAPSHOT.md §6). If Task 2 determines the fix needs PreCompact wiring, flag it as a follow-up Phase W rather than expanding Phase V scope.

---

**End of brief.**

> CTO note: Phase V is intentionally scoped as diagnosis-first, implementation-second. We've
> been burned once (my initial diagnosis of Phase T was wrong — the bug had already been
> fixed). The lesson: observe reality first, prescribe second. Task 1 is non-negotiable
> before Task 3 happens.
