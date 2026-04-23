import type { FastifyBaseLogger } from 'fastify';
import type { CommanderDb } from '../db/client';
import { eventUuidOf, insertIfNew } from './hook-events';
import { ensureProjectByCwd } from './projects';
import {
  endSession,
  ensureSessionByClaudeId,
  sessionStatusForEvent,
  updateSessionStatus,
} from './sessions';
import type { WsBus } from './ws-bus';

type Logger = FastifyBaseLogger;

export type HookPipelineDeps = {
  db: CommanderDb;
  bus: WsBus;
  logger: Logger;
};

export interface HookContinueResponse {
  continue: true;
}

export interface HookPreToolUseResponse {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow';
    permissionDecisionReason: string;
  };
}

export type HookResponse = HookContinueResponse | HookPreToolUseResponse;

export interface HookPayloadCore {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  uuid?: string;
  event_uuid?: string;
}

/**
 * ARCHITECTURE_SPEC §7.4 canonical 6-step handler recipe (bearer check runs
 * as middleware upstream; this pipeline starts at step 2):
 *
 *   2. generate / use `event_uuid`
 *   3. de-dupe by (session_id, event_uuid) → idempotent pass-through on hit
 *   4. persist raw payload to `hook_events`
 *   5. emit typed event on `hook:<session_id>` WS topic
 *   6. update session status if the event implies a transition
 *   7. return blocking-hook response shape or `{ continue: true }`
 *
 * Plus N2-specific: on SessionStart, auto-create the `projects` + `sessions`
 * rows so downstream MCP `list_projects` / `list_sessions` can see them
 * immediately (dispatch §7 auto-creation note).
 */
export async function runHookPipeline(
  deps: HookPipelineDeps,
  eventName: string,
  rawPayload: unknown,
): Promise<HookResponse> {
  const { db, bus, logger } = deps;
  const payload = (rawPayload ?? {}) as HookPayloadCore;

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  if (!sessionId) {
    // Payload malformed (no session_id). We still want to persist for
    // forensics, but under a synthetic "unknown" row. Log loudly — Claude
    // Code's hook contract always includes session_id per KB-P3.1.
    logger.warn({ eventName }, 'hook payload missing session_id — skipping pipeline');
    return { continue: true };
  }

  // Step 2 — event_uuid.
  const eventUuid = eventUuidOf(rawPayload);

  // Step 4a (precondition) — auto-create project + session on SessionStart so
  // the FK target exists before we insert into `hook_events`.
  if (eventName === 'SessionStart') {
    const cwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : '/';
    try {
      await ensureProjectByCwd(db, cwd);
      await ensureSessionByClaudeId(db, sessionId, cwd);
    } catch (err) {
      logger.warn({ err, sessionId, cwd }, 'SessionStart auto-create failed');
    }
  } else {
    // For subsequent events, the session row may still not exist if the
    // plugin was installed mid-session. Create a minimal row with unknown cwd.
    try {
      await ensureSessionByClaudeId(db, sessionId, '/');
    } catch (err) {
      logger.warn({ err, sessionId }, 'mid-session auto-create failed');
    }
  }

  // Step 3 + 4 — de-dupe + persist.
  const row = await insertIfNew(db, {
    sessionId,
    eventName,
    eventUuid,
    payload: rawPayload,
  });

  if (!row) {
    logger.debug(
      { sessionId, eventName, eventUuid },
      'hook event deduped — skipping emit + status',
    );
    return responseFor(eventName);
  }

  // Step 5 — emit typed event on per-session WS topic.
  const envelope = {
    session_id: sessionId,
    event_name: eventName,
    event_uuid: eventUuid,
    timestamp: row.timestamp,
    payload: rawPayload,
  };
  bus.publish(`hook:${sessionId}`, envelope);

  // Step 6 — session status transition where applicable.
  const nextStatus = sessionStatusForEvent(eventName);
  if (nextStatus) {
    try {
      if (eventName === 'SessionEnd') {
        await endSession(db, sessionId);
      } else {
        await updateSessionStatus(db, sessionId, nextStatus);
      }
    } catch (err) {
      logger.warn({ err, sessionId, nextStatus }, 'session status update failed');
    }
  }

  // Step 7 — blocking-hook response.
  return responseFor(eventName);
}

/**
 * PreToolUse auto-allows in N2 (dispatch §2 T4). Real approval-modal pipeline
 * lands in N5; this returns the canonical envelope shape per KB-P3.1 so the
 * integration works end-to-end without human intervention.
 */
function responseFor(eventName: string): HookResponse {
  if (eventName === 'PreToolUse') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'auto-approved (N2 pre-approval-UI; per dispatch §2 T4)',
      },
    };
  }
  return { continue: true };
}

/**
 * Used by the "Replay last event" debug button — given a payload we already
 * have a row for, we still want to verify the pipeline de-dupes (and do NOT
 * re-emit a second WS event). Calling `runHookPipeline` with the same payload
 * is the test — `insertIfNew` returns null, and we return the `continue: true`
 * fast-path without emitting.
 */
export async function replayLastEvent(
  deps: HookPipelineDeps,
  eventName: string,
  payload: unknown,
): Promise<HookResponse> {
  return runHookPipeline(deps, eventName, payload);
}
