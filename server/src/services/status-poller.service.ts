import type { SessionStatus, SessionActivity, StatusFlip, SessionState } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { agentStatusService, applyActivityHints } from './agent-status.service.js';
import { hasPendingToolUseInTranscript } from './jsonl-parser.service.js';
import { computeSessionState } from './session-state.service.js';
import { preCompactService } from './pre-compact.service.js';
import { tmuxService } from './tmux.service.js';
import { eventBus } from '../ws/event-bus.js';
import { sessionService } from './session.service.js';

// Issue 15.3 §6.4 Delta 1 — drop from 5_000ms to 1_500ms. Jose-observed
// 5s user-visible latency between prompt send and activity indicator
// (Case 1 sleep 10) was floored by this cadence: the server could not
// re-classify between polls. 1_500ms matches the client's working-mode
// poll cadence in useChat.ts and cuts worst-case status-stale window
// by ~70%. Floor is deliberately 1.5s; going lower trades against
// per-tick pane-read CPU cost across all live sessions.
const POLL_INTERVAL = 1_500; // 1.5 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Issue 15.1-H — parse the sessions.transcript_paths JSON column and
// return the most recent entry, or null when the row has no transcripts
// bound yet. Defensive against malformed JSON and empty arrays so a
// corrupted cell can't crash the poller loop. Most-recent = last entry
// per Issue 11's append-on-bind semantics (post-rotation paths land at
// the tail of the array).
const latestTranscriptPath = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const last = parsed[parsed.length - 1];
    return typeof last === 'string' && last.length > 0 ? last : null;
  } catch {
    return null;
  }
};

// In-memory cache of last known statuses to avoid unnecessary DB writes
const lastKnownStatus = new Map<string, SessionStatus>();
// Issue 15.3 Phase 1.1 — last-emitted typed state per session. Used to
// emit subtype-only transitions (e.g. Working:ToolExec → Working:Thinking
// when coarse status stays `working`) without broadcasting noop ticks.
// Key: sessionId; value: last serialized SessionState string comparison.
const lastKnownStateKey = new Map<string, string>();
const stateKey = (s: SessionState): string => {
  // Stable key = kind + subtype + tool-name/reason/context discriminator.
  // Excluding `since` + `hintLabel` keeps the key quiet against clock
  // churn / free-form label formatting drift.
  switch (s.kind) {
    case 'Idle': return `Idle:${s.subtype}`;
    case 'Working': return `Working:${s.subtype}:${s.toolName ?? ''}`;
    case 'WaitingForInput': return `WaitingForInput:${s.subtype}`;
    case 'Stopped': return `Stopped:${s.reason}`;
    case 'Compacting': return 'Compacting';
    case 'Error': return `Error`;
  }
};
// Grace period: working → idle must be observed across 2 consecutive polls
// (≈10s) before committing. Prevents flicker to idle between tool calls
// when Claude pauses briefly. working → waiting bypasses the grace period
// because a permission prompt is urgent — don't delay surfacing it.
const idleSince = new Map<string, number>();
const IDLE_GRACE_MS = 8_000;
// Track when each session first entered 'working'. After >3min stuck in
// working we log a warning the next time classification changes — makes
// the "stuck on Thinking..." class of bug observable in server logs.
const workingSince = new Map<string, number>();
const STUCK_WORKING_WARN_MS = 3 * 60_000;
// Phase T Patch 2 revision — the poller yields to ANY hook activity
// within HOOK_YIELD_MS regardless of current row status. Rationale:
// the hook payload is the authoritative "did Claude just do something
// on this session" signal. The previous 10s/status=idle gate (Phase
// N.0 Patch 2 at `cfd1e65`) was too narrow — it only defended idle
// writes, letting a stale-working classification from the pane regex
// flip a just-stopped session back to working if the Stop hook missed
// that exact status=idle window. 60s covers 1-2 active turns of
// realistic Claude pacing; outside that window the poller resumes
// normal pane-regex classification.
export const HOOK_YIELD_MS = 60_000;
// Phase U Patch 2 — stale-activity force-idle threshold. A row that
// has been in 'working' for this long WITHOUT any bumpLastActivity
// (hook OR poller-derived flip) is treated as stuck regardless of
// what the pane regex currently says. Chosen to sit above the 60s
// hook-yield window: any real active turn refreshes last_activity_at
// on nearly every tool-use hook, so anything crossing 90s of silence
// is overwhelmingly a routing/classifier gap rather than a long turn.
export const STALE_ACTIVITY_MS = 90_000;
// Phase U.1 Fix 1 — after a stale-activity force-idle, suppress all
// pane-regex reclassification on that row for this window. Catches
// any residual classifier false-positive class where the pane briefly
// reads as "working" again 5s after we force-idled (which is exactly
// the oscillation shape observed post-Phase-U before Fix 2 shipped).
// Ordered FIRST in the poller decision tree so a recent hook or a
// fresh stale-activity fact cannot short-circuit the cooldown. Strict
// `<` cutoff: at msSinceForceIdle === 60_000 the gate is done.
export const FORCE_IDLE_COOLDOWN_MS = 60_000;

// Phase U.1 Fix 3 — oscillation telemetry. Observability-only: any
// session that flips status 3+ times within a 15s window logs once
// per 60s per session. Gives us an alarm when Fix 1 + Fix 2 miss a
// new false-positive class so we notice before users do.
export const OSCILLATION_WINDOW_MS = 15_000;
export const OSCILLATION_THRESHOLD = 3;
export const OSCILLATION_DEDUP_MS = 60_000;
const oscillationHistory = new Map<string, Array<{ status: string; at: number }>>();
const oscillationLastLog = new Map<string, number>();

// Return true iff THIS call emitted a warn log. Pure tracking — the
// caller is the status-poller's flip write sites (stale-activity
// force-idle branch + normal classifier flip branch). Tests pass
// `nowOverride` to walk the time axis without real timers.
export const trackOscillation = (
  sessionId: string,
  status: string,
  nowOverride?: number,
): boolean => {
  const now = nowOverride ?? Date.now();
  let arr = oscillationHistory.get(sessionId);
  if (!arr) {
    arr = [];
    oscillationHistory.set(sessionId, arr);
  }
  arr.push({ status, at: now });
  // Trim in-place to entries within the last OSCILLATION_WINDOW_MS.
  // `<=` retention semantics: an entry exactly at the window boundary
  // is kept. Matches the 15s test assertion that "three flips spread
  // over 16s" removes the t0 entry but keeps the one at t0+5s.
  while (arr.length > 0 && now - arr[0]!.at > OSCILLATION_WINDOW_MS) {
    arr.shift();
  }
  if (arr.length < OSCILLATION_THRESHOLD) return false;
  const lastLog = oscillationLastLog.get(sessionId) ?? 0;
  if (now - lastLog < OSCILLATION_DEDUP_MS) return false;
  oscillationLastLog.set(sessionId, now);
  const spanMs = now - arr[0]!.at;
  console.warn(
    `[poller] oscillation suspected: session=${sessionId.slice(0, 8)} ` +
    `flips=${arr.length} in ${Math.round(spanMs / 1000)}s`,
  );
  return true;
};

// Test-only harness for resetting + inspecting tracker state. Not
// referenced by production code paths; safe to leave exported.
export const __oscillationTestSupport = {
  reset: (): void => {
    oscillationHistory.clear();
    oscillationLastLog.clear();
  },
  getHistory: (sessionId: string): Array<{ status: string; at: number }> =>
    (oscillationHistory.get(sessionId) ?? []).slice(),
  getLastLogAt: (sessionId: string): number => oscillationLastLog.get(sessionId) ?? 0,
};

// Status-flip ring buffer per session. Phase J: debuggers hunting "why is
// this session stuck" can grep these flips with their evidence strings
// before diving into the detector source. Capped at FLIP_HISTORY_MAX per
// session; oldest entries drop first.
const statusFlipHistory = new Map<string, StatusFlip[]>();
const FLIP_HISTORY_MAX = 20;

// Latest parsed activity per session — read by the single-session / teammates
// API routes so they don't need to re-shell-out to tmux on every request.
const lastKnownActivity = new Map<string, SessionActivity | null>();

const recordFlip = (sessionId: string, flip: StatusFlip): void => {
  let arr = statusFlipHistory.get(sessionId);
  if (!arr) {
    arr = [];
    statusFlipHistory.set(sessionId, arr);
  }
  arr.push(flip);
  if (arr.length > FLIP_HISTORY_MAX) arr.splice(0, arr.length - FLIP_HISTORY_MAX);
};

const poll = (): void => {
  const db = getDb();
  // Poll non-stopped rows PLUS any row whose tmux_session looks like a pane
  // (e.g. "%35"). The pane may have come back alive after being transiently
  // marked stopped by a prior glitch — if tmux still reports it live, we
  // must re-probe and un-stick it. jsc-* session names stay filtered by
  // status because those are Commander-created and stopping is authoritative.
  //
  // Phase T Patch 2 revision — `last_hook_at` is now the authoritative
  // hook-yield gate (epoch ms, written by every hook-event handler that
  // resolves an owner). The old Phase R M6 `ms_since_update` derived
  // from `updated_at` was dropped because append-only transcript writes
  // never touched `updated_at`, so the gate could never be tripped by
  // the PostToolUse stream that keeps coming during a turn. Keep the
  // column for other queries; the poller no longer needs it in this
  // SELECT.
  const activeSessions = db.prepare(
    `SELECT id, tmux_session, status, last_hook_at, last_activity_at, force_idled_at, transcript_paths
     FROM sessions
     WHERE status != 'stopped' OR tmux_session LIKE '\\%%' ESCAPE '\\'`,
  ).all() as Array<{
    id: string;
    tmux_session: string;
    status: string;
    last_hook_at: number;
    last_activity_at: number;
    force_idled_at: number;
    transcript_paths: string;
  }>;

  if (activeSessions.length === 0) return;

  // Teammates with no discoverable tmux target (config had an empty
  // tmuxPaneId) are stored with an "agent:" sentinel. There's nothing to
  // probe via tmux so the poller must NOT touch them — leave their status
  // to whatever hook events or explicit API calls set.
  const pollable = activeSessions.filter((s) => !s.tmux_session.startsWith('agent:'));
  if (pollable.length === 0) return;

  const tmuxNames = pollable.map((s) => s.tmux_session);
  const detailed = agentStatusService.detectStatusDetailedBatch(tmuxNames);

  for (const session of activeSessions) {
    const detectedResult = detailed[session.tmux_session];
    if (!detectedResult) continue;

    // Issue 15 M1 — additive structured-signal upgrade. The pane
    // classifier is pane-text-only; tool-execution pane states
    // (Plan UI, long tool output pushing the spinner off the
    // capture, multi-line tool_result blocks) can lack a verb and
    // fall through to idle while the session is actively writing
    // JSONL. `applyActivityHints` upgrades `idle → working` when
    // `last_activity_at` was bumped within IDLE_UPGRADE_MS (15s).
    // Stop-hook interaction is pre-gated by the 60s hook-yield
    // below: by the time the classifier runs on a Stop-idled row,
    // its `last_activity_at` is ≥60s stale.
    const hinted = applyActivityHints(
      { status: detectedResult.status, evidence: detectedResult.evidence },
      { lastActivityAt: Number(session.last_activity_at ?? 0) },
    );
    let newStatus = hinted.status;
    let evidence = hinted.evidence;
    const activity = detectedResult.activity;

    // Keep the activity cache fresh for downstream API reads regardless of
    // whether the status itself flipped — the footer updates many times
    // per second and polling every 5s is already a coarse snapshot.
    lastKnownActivity.set(session.id, activity);

    // Pane-target safety net: if a row whose tmux_session starts with '%'
    // was classified as 'stopped' (heuristic transient miss), double-check
    // the pane via hasSession. A live pane MUST NOT be reported as stopped
    // for a teammate — transitioning them to stopped removes them from the
    // split-screen and the user loses the session.
    if (newStatus === 'stopped' && session.tmux_session.startsWith('%')) {
      if (tmuxService.hasSession(session.tmux_session)) {
        newStatus = 'idle';
        evidence = 'pane live despite stopped classification';
      }
    }

    // Phase U.1 Fix 1 — FIRST-IN-TREE cooldown gate. If we force-idled
    // this row within FORCE_IDLE_COOLDOWN_MS (60s), skip every
    // reclassification path for the remainder of the window. Ordered
    // before the hook-yield so a hook arriving mid-cooldown can't
    // reset the gate to 'yield' (same suppression effect, but keeps
    // the cooldown as the single authoritative signal for "just
    // force-idled — don't touch"). Strict `<` cutoff so at
    // msSinceForceIdle === 60_000 we exit into the next branch.
    const msSinceForceIdle = Date.now() - Number(session.force_idled_at ?? 0);
    if (msSinceForceIdle < FORCE_IDLE_COOLDOWN_MS) {
      continue;
    }

    // Issue 15.1-H — structured signal is authoritative over the pane
    // for active-tool detection. Placed BEFORE the hook-yield gate
    // because the yield window is ALWAYS active during tool execution
    // (Stop hooks fire every time the LLM yields, keeping last_hook_at
    // fresh for the whole tool run). Without this position the gate
    // below would skip reclassification for the full tool duration
    // and status would stay at whatever it was pre-tool.
    //
    // Blank-pane tool cases (`sleep 10`, network calls, background
    // jobs) show `❯` idle prompt while bash is running. The pane
    // classifier returns `'idle ❯ prompt visible'` — 15.1-D's
    // allowlist correctly excludes that evidence from the timestamp-
    // upgrade path. But the SESSION is still doing work: JSONL has
    // an `assistant tool_use` block with no matching `user tool_result`
    // yet. `hasPendingToolUseInTranscript` reads a bounded tail and
    // returns true in exactly that state.
    //
    // Per §24.2 activity-event verification: structured tool-pairing
    // signal outranks pane-text pattern matching. When gate says
    // pending, force `working`. Pane-idle is wrong in that window.
    //
    // Scope:
    //   - Only upgrades `idle` → `working`. `waiting` untouched — a
    //     visible approval prompt IS the tool's user-action gate.
    //     `working` untouched (no-op). `error` / `stopped` untouched.
    //   - Sessions with no transcript path skip this check — pane +
    //     timestamp path stays authoritative until JSONL binds.
    //   - Cooldown gate above still wins: a force-idled session stays
    //     idle for FORCE_IDLE_COOLDOWN_MS regardless of transcript
    //     state, preserving 15.1-D's oscillation protection.
    // Issue 15.3 Phase 1.1 — broaden to fire from `waiting` too. Pre-
    // fix: scope was idle-only. Repro: user approves a permission
    // prompt → Claude starts executing → pane still shows residual
    // "waiting" verbiage on some frames → hinted stays 'waiting' →
    // override didn't fire → status stuck at 'waiting' for the whole
    // tool exec. Structured signal (pending tool_use) outranks the
    // pane's belief that we're still waiting. `working` untouched
    // (no-op); error/stopped untouched.
    if (hinted.status === 'idle' || hinted.status === 'waiting') {
      const transcriptPath = latestTranscriptPath(session.transcript_paths);
      if (transcriptPath && hasPendingToolUseInTranscript(transcriptPath)) {
        newStatus = 'working';
        evidence = `pending-tool-use authoritative (over "${hinted.evidence}")`;
      }
    }

    // Phase T Patch 2 revision — hook-authoritative yield. If ANY hook
    // event matched this session within HOOK_YIELD_MS (60s), trust the
    // hook cascade entirely and skip pane-regex reclassification. No
    // status predicate, no cache dance: the hook knows what the pane
    // regex can only guess at.
    //
    // Outside the window the poller resumes normal classification so
    // long-idle sessions (no hook coverage, e.g. a Claude that died
    // with no SessionEnd) still flip to stopped when tmux confirms the
    // pane is gone.
    //
    // Issue 15.1-H exception: if the override above flipped newStatus
    // to 'working' via pending-tool-use, skip the yield (we want that
    // upgrade to land even if a recent hook was fired).
    const msSinceHook = Date.now() - Number(session.last_hook_at ?? 0);
    const pendingToolOverrideFired = newStatus === 'working' && evidence.startsWith('pending-tool-use authoritative');
    if (msSinceHook < HOOK_YIELD_MS && !pendingToolOverrideFired) {
      continue;
    }

    // Phase U Patch 2 — stale-activity force-idle. Ordering: (1) hook
    // yield above wins — a recent hook is authoritative so we never
    // force-idle over a real active turn; (2) this force-idle handles
    // rows that are stuck 'working' with no proof of life; (3) pane
    // classifier below handles everything else. Narrow scope: only
    // flips 'working' → 'idle'. All other transitions fall through to
    // the classifier so a waiting prompt, a stopped session, or an
    // idle row is untouched. Prevents the "Composing response 1100s"
    // class of bug where the pane footer is frozen on a past-tense
    // verb the classifier can't distinguish from live work.
    const msSinceActivity = Date.now() - Number(session.last_activity_at ?? 0);
    if (session.status === 'working' && msSinceActivity > STALE_ACTIVITY_MS) {
      // Phase U.1 Fix 1 — stamp `force_idled_at` in the SAME UPDATE as
      // the status flip. Single atomic write so the cooldown gate on
      // the next poll tick cannot see a row whose status is 'idle'
      // while `force_idled_at` is still the old (0) value. A split
      // write would race the 5s interval.
      const forceIdledAt = Date.now();
      const result = db.prepare(
        `UPDATE sessions
           SET status = 'idle',
               force_idled_at = ?,
               updated_at = datetime('now')
         WHERE id = ? AND status = 'working'`,
      ).run(forceIdledAt, session.id);
      if (result.changes > 0) {
        const at = new Date().toISOString();
        const evidence = `stale-activity-force-idle (${Math.round(msSinceActivity / 1000)}s)`;
        console.log(
          `[status] ${session.id.slice(0, 8)} working→idle evidence="${evidence}"`,
        );
        recordFlip(session.id, { at, from: 'working', to: 'idle', evidence });
        trackOscillation(session.id, 'idle');
        lastKnownStatus.set(session.id, 'idle');
        workingSince.delete(session.id);
        idleSince.delete(session.id);
        eventBus.emitSessionStatus(session.id, 'idle', {
          from: 'working',
          to: 'idle',
          evidence,
          at,
        });
      }
      continue;
    }

    const cachedStatus = lastKnownStatus.get(session.id) ?? (session.status as SessionStatus);

    // Grace period applies ONLY to working → idle (prevents flicker
    // between tool calls). working → waiting skips the grace: a permission
    // prompt is urgent and must surface immediately.
    if (cachedStatus === 'working' && newStatus === 'idle') {
      const now = Date.now();
      if (!idleSince.has(session.id)) {
        idleSince.set(session.id, now);
        continue;
      }
      const elapsed = now - idleSince.get(session.id)!;
      if (elapsed < IDLE_GRACE_MS) continue;
      idleSince.delete(session.id);
      evidence = `${evidence} (after ${Math.round(elapsed / 1000)}s grace)`;
    } else {
      idleSince.delete(session.id);
    }

    // Issue 15.3 Phase 1.1 — compute typed state on EVERY tick (not
    // just coarse-status transitions). A subtype change with no flip
    // (e.g. Working:ToolExec → Working:Thinking, or Idle:Generic →
    // Idle:MonitoringSubagents when teammates spawn) must still reach
    // the client. Phase 1 computed state inside the transition block
    // only, so subtype-only updates never fanned out.
    const transcriptPathForState = latestTranscriptPath(session.transcript_paths);
    const pendingToolUseForState = transcriptPathForState
      ? hasPendingToolUseInTranscript(transcriptPathForState)
      : false;
    const teammateRow = db.prepare(
      "SELECT COUNT(*) as n FROM sessions WHERE parent_session_id = ? AND status != 'stopped'",
    ).get(session.id) as { n: number } | undefined;
    const activeTeammateCount = Number(teammateRow?.n ?? 0);
    const sessionState = computeSessionState({
      paneStatus: detectedResult.status,
      paneEvidence: detectedResult.evidence,
      paneActivity: activity,
      hintedStatus: hinted.status,
      hintedEvidence: hinted.evidence,
      pendingToolUse: pendingToolUseForState,
      preCompactState: preCompactService.getSessionState(session.id),
      activeTeammateCount,
    });
    const newStateKey = stateKey(sessionState);
    const cachedStateKey = lastKnownStateKey.get(session.id);
    const stateChanged = newStateKey !== cachedStateKey;

    if (newStatus !== cachedStatus) {
      // If we were stuck in 'working' for a long time and just escaped,
      // surface it in logs — helps diagnose classification lag (#222).
      if (cachedStatus === 'working') {
        const enteredAt = workingSince.get(session.id);
        if (enteredAt && Date.now() - enteredAt > STUCK_WORKING_WARN_MS) {
          const minutes = Math.round((Date.now() - enteredAt) / 60_000);
          console.warn(
            `[poller] session ${session.id.slice(0, 8)} was 'working' for ~${minutes}m before transitioning to '${newStatus}' — possible detection lag`,
          );
        }
      }
      if (newStatus === 'working') {
        workingSince.set(session.id, Date.now());
      } else {
        workingSince.delete(session.id);
      }

      const at = new Date().toISOString();
      const from = cachedStatus as SessionStatus;
      const to = newStatus;

      // Phase J — log the flip with its rationale. Single line so log-grep
      // on `[status]` reveals the entire transition history per session.
      console.log(`[status] ${session.id.slice(0, 8)} ${from}→${to} evidence="${evidence}"`);
      recordFlip(session.id, { at, from, to, evidence });
      // Phase U.1 Fix 3 — observability on classifier-driven flips.
      // Same-threshold (3 within 15s) alarm as the force-idle branch.
      trackOscillation(session.id, newStatus);

      // Update DB
      db.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newStatus, session.id);

      // Phase N.0 Patch 3 — a real poller-driven flip (not a yield
      // no-op) counts as proof of life. Skipped yields above continue
      // before reaching here, so this branch fires ONLY on genuine
      // pane-derived transitions.
      sessionService.bumpLastActivity(session.id);

      // Update cache
      lastKnownStatus.set(session.id, newStatus);
      lastKnownStateKey.set(session.id, newStateKey);

      // Emit event — richer payload on transition with the before/after
      // statuses, the parsed evidence, and the live activity snapshot.
      // The legacy `status` field stays populated to the `to` value for
      // back-compat with consumers that predate Phase J.
      eventBus.emitSessionStatus(session.id, newStatus, {
        from,
        to,
        evidence,
        activity,
        at,
        state: sessionState,
      });
    } else {
      // Cache the current status even if unchanged (first run)
      lastKnownStatus.set(session.id, newStatus);
      if (newStatus === 'working' && !workingSince.has(session.id)) {
        workingSince.set(session.id, Date.now());
      }

      // Issue 15.3 Phase 1.1 — subtype-only transition. Coarse status
      // didn't flip (both working, or both idle, etc.) but the typed
      // state did: Working:ToolExec → Working:Thinking, or Idle:Generic
      // → Idle:MonitoringSubagents, etc. Emit so the client's typed-
      // state consumers see the subtype change. No DB write — only the
      // legacy coarse `status` column persists; typed state is a
      // memoryless WS broadcast.
      if (stateChanged) {
        const at = new Date().toISOString();
        eventBus.emitSessionStatus(session.id, newStatus, {
          from: newStatus,
          to: newStatus,
          evidence: `state-subtype change: ${cachedStateKey ?? '∅'} → ${newStateKey}`,
          activity,
          at,
          state: sessionState,
        });
        lastKnownStateKey.set(session.id, newStateKey);
      }
    }
  }
};

export const statusPollerService = {
  start(): void {
    console.log(`[poller] Status poller started (every ${POLL_INTERVAL / 1000}s)`);
    // Run immediately, then on interval
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
  },

  stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    lastKnownStatus.clear();
    lastKnownStateKey.clear();
    console.log('[poller] Status poller stopped');
  },

  // Exposed so the routes layer can surface the ring buffer + cached
  // activity without a fresh tmux shell-out. History survives the life
  // of the process; it does NOT persist to disk — restart clears it.
  getFlipHistory(sessionId: string): StatusFlip[] {
    return (statusFlipHistory.get(sessionId) ?? []).slice();
  },

  getCachedActivity(sessionId: string): SessionActivity | null | undefined {
    return lastKnownActivity.get(sessionId);
  },
};
