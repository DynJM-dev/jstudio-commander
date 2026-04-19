import type { FastifyInstance } from 'fastify';
import type { SessionType } from '@commander/shared';
import { sessionService } from '../services/session.service.js';
import { tmuxService } from '../services/tmux.service.js';
import { statusPollerService } from '../services/status-poller.service.js';
import { detectPrompts } from '../services/prompt-detector.service.js';

// Issue 13 — default-list archive threshold. Stopped rows younger
// than this stay visible in `/api/sessions`; older rows surface only
// on `?includeArchived=true`. 24h matches Jose's spec so that recent
// kills are still inspectable without a toggle.
const ARCHIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const sessionRoutes = async (app: FastifyInstance) => {
  // List all sessions (polled frequently — suppress logs)
  app.get<{ Querystring: { includeArchived?: string } }>(
    '/api/sessions',
    { logLevel: 'warn' as const },
    async (request) => {
      // Phase J — attach the poller's cached activity per row. Cache lookup
      // only (no tmux shell-outs) so the cost per request is a Map lookup
      // per session, which is negligible even at hundreds of sessions.
      //
      // Issue 13 — default response excludes stopped sessions whose
      // `stopped_at` is older than ARCHIVE_THRESHOLD_HOURS. Recent (<24h)
      // stopped rows stay visible so a user who just ended a session can
      // still see it in the list without flipping any toggle. Older
      // stopped rows (archived) surface only on `?includeArchived=true`.
      // Active (non-stopped) sessions always visible regardless.
      const includeArchived =
        request.query.includeArchived === 'true' ||
        request.query.includeArchived === '1';

      const all = sessionService.listSessions();
      const filtered = includeArchived ? all : all.filter((s) => {
        if (s.status !== 'stopped') return true;
        if (!s.stoppedAt) return true; // defensive — missing timestamp keeps the row visible
        const age = Date.now() - new Date(s.stoppedAt).getTime();
        return age < ARCHIVE_THRESHOLD_MS;
      });

      return filtered.map((s) => ({
        ...s,
        activity: statusPollerService.getCachedActivity(s.id) ?? null,
      }));
    },
  );

  // Get single session (polled frequently — suppress logs)
  app.get<{ Params: { id: string } }>('/api/sessions/:id', { logLevel: 'warn' as const }, async (request, reply) => {
    const session = sessionService.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    // Phase J — decorate with the poller's cached pane-activity. Never persisted.
    const activity = statusPollerService.getCachedActivity(session.id) ?? null;
    return { ...session, activity };
  });

  // Phase J — status-flip history. Returns the poller's in-memory ring
  // buffer (last ~20 transitions) for the given session; each entry
  // carries the rationale string that drove the flip. Useful when a user
  // asks "why did this session flip to waiting" — grep the log or hit
  // this endpoint for the most recent flips without grepping the log.
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/status-history',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const session = sessionService.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return { sessionId: session.id, flips: statusPollerService.getFlipHistory(session.id) };
    },
  );

  // Create session
  app.post<{ Body: { name?: string; projectPath?: string; model?: string; sessionType?: SessionType } }>(
    '/api/sessions',
    async (request, reply) => {
      try {
        const session = sessionService.createSession(request.body ?? {});
        return reply.status(201).send(session);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create session';
        return reply.status(500).send({ error: message });
      }
    },
  );

  // Delete session
  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionService.deleteSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Soft-dismiss a teammate — ends its agent_relationships edge and marks
  // the session stopped so it drops out of the parent PM's split view.
  // Distinct from DELETE /api/sessions/:id which hard-deletes and (for
  // team-linked rows) modifies the on-disk team config. Dismiss is
  // non-destructive: the team config stays intact, the session row stays
  // in history, only its visible team membership ends.
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/dismiss',
    async (request, reply) => {
      const session = sessionService.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      sessionService.markTeammateDismissed(request.params.id);
      return { success: true };
    },
  );

  // System notice — send a user-facing "notice" into a PM's tmux pane. Used
  // by the UI when the user takes an action the PM should know about (e.g.
  // force-closing a teammate out-of-band). Single-line text; multi-line
  // notices need to be flattened by the caller because tmux send-keys
  // treats newlines inconsistently.
  app.post<{ Params: { id: string }; Body: { text: string } }>(
    '/api/sessions/:id/system-notice',
    async (request, reply) => {
      const { text } = request.body ?? {};
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return reply.status(400).send({ error: 'text is required' });
      }
      const session = sessionService.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      // sendCommand gate-checks tmux liveness + logs the event. We reuse it
      // so the notice appears as a session_event just like any other
      // command — makes post-mortems on "who force-closed what" simple.
      const result = sessionService.sendCommand(request.params.id, text.replace(/\r?\n/g, ' '));
      if (!result.success) {
        const status = result.error === 'Session not found' ? 404 : 400;
        return reply.status(status).send({ error: result.error });
      }
      return { success: true };
    },
  );

  // Send command to session
  app.post<{ Params: { id: string }; Body: { command: string } }>(
    '/api/sessions/:id/command',
    async (request, reply) => {
      const { command } = request.body ?? {};
      if (command === undefined || command === null) {
        return reply.status(400).send({ error: 'command is required' });
      }

      const result = sessionService.sendCommand(request.params.id, command);
      if (!result.success) {
        const status = result.error === 'Session not found' ? 404 : 400;
        return reply.status(status).send({ error: result.error });
      }
      return { success: true };
    },
  );

  // Send raw key to session (no Enter appended — for Escape, Enter, Tab, etc.)
  app.post<{ Params: { id: string }; Body: { key: string } }>(
    '/api/sessions/:id/key',
    async (request, reply) => {
      const { key } = request.body ?? {};
      if (!key) {
        return reply.status(400).send({ error: 'key is required' });
      }

      const session = sessionService.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.status === 'stopped') {
        return reply.status(400).send({ error: 'Session is stopped' });
      }
      if (!tmuxService.hasSession(session.tmuxSession)) {
        return reply.status(400).send({ error: 'Tmux session not found' });
      }

      // Send raw key without Enter — handles Escape, Enter, Tab, etc.
      try {
        tmuxService.sendRawKey(session.tmuxSession, key);
      } catch {
        return reply.status(500).send({ error: 'Failed to send key' });
      }
      return { success: true };
    },
  );

  // Get live session status
  app.get<{ Params: { id: string } }>('/api/sessions/:id/status', async (request, reply) => {
    const result = sessionService.getSessionStatus(request.params.id);
    if (!result) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return result;
  });

  // Get raw terminal output from tmux pane (polled frequently — suppress request logs)
  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    '/api/sessions/:id/output',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      const session = sessionService.getSession(request.params.id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const lines = parseInt(request.query.lines ?? '30', 10);

      if (!tmuxService.hasSession(session.tmuxSession)) {
        return { output: '', lines: [], alive: false };
      }

      const raw = tmuxService.capturePane(session.tmuxSession, lines);
      const outputLines = raw.split('\n');

      // Issue 9 Part 2 — prompt detection extracted to
      // prompt-detector.service.ts so the match rules are unit-testable.
      // The previous inline implementation had two broad fallbacks
      // (Esc to cancel / Enter to confirm + trailing-?/numbered-rows)
      // that false-fired on Claude Code viewer modals (`/status`,
      // `/compact` preview, etc.). The service keeps only the explicit
      // approval-token branches (trust, numbered ❯ 1., Allow/Deny,
      // y/n) and cites the PATTERN-MATCHING CONSTRAINT docblock at
      // agent-status.service.ts.
      const prompts = detectPrompts(outputLines);

      return {
        output: raw,
        lines: outputLines,
        alive: true,
        prompts,
      };
    },
  );

  // Update session (rename, change model)
  app.patch<{ Params: { id: string }; Body: { name?: string; model?: string; effortLevel?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const session = sessionService.updateSession(request.params.id, request.body ?? {});
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return session;
    },
  );

  // Manual rescan for #237 — refresh-chat button. Re-detects status,
  // re-counts JSONL messages, broadcasts session:updated on the WS bus.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/rescan', async (request, reply) => {
    const result = sessionService.rescan(request.params.id);
    if (!result) return reply.status(404).send({ error: 'Session not found' });
    return { ok: true, ...result };
  });
};
