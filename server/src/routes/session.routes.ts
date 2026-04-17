import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';
import { tmuxService } from '../services/tmux.service.js';

export const sessionRoutes = async (app: FastifyInstance) => {
  // List all sessions (polled frequently — suppress logs)
  app.get('/api/sessions', { logLevel: 'warn' as const }, async () => {
    return sessionService.listSessions();
  });

  // Get single session (polled frequently — suppress logs)
  app.get<{ Params: { id: string } }>('/api/sessions/:id', { logLevel: 'warn' as const }, async (request, reply) => {
    const session = sessionService.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Create session
  app.post<{ Body: { name?: string; projectPath?: string; model?: string; sessionType?: 'pm' | 'raw' } }>(
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

      // Only check the last 3 non-empty lines for prompts — active prompts are always at the bottom.
      // Old prompt text scrolled up in the pane must NOT trigger detection.
      const bottomLines = outputLines.slice(-5).filter((l) => l.trim().length > 0).slice(-3);
      const bottomRaw = bottomLines.join('\n');

      // Detect interactive prompts
      const prompts: { type: string; message: string; context?: string; options?: string[] }[] = [];

      // Kill-switches — footer states that CONCLUSIVELY mean "no
      // permission/confirm prompt can be active right now". They run before
      // any detection so stray prompt-shaped characters elsewhere in the
      // pane (a `?` in a user message, a "Continue?" from chat prose)
      // don't misfire a popup the user then has to dismiss.
      //
      // 1. `⏵⏵ bypass permissions on` — Claude Code's bypass-permissions
      //    mode is active. No permission prompt can fire in this mode by
      //    design; anything that looks like one is chrome or chat content.
      // 2. `N teammate` in footer + "Waiting on input" status — this is
      //    the team-lead-waiting-on-teammate idle state, not a user-facing
      //    prompt. The team lead is paused for a teammate reply, not for
      //    a click.
      const footerTail = outputLines.slice(-15).join('\n');
      const hasBypassPermissions = /⏵⏵\s*bypass permissions on/i.test(footerTail);
      const waitingOnTeammate =
        /\b\d+\s+teammates?\b/i.test(footerTail) &&
        /Waiting on input/i.test(footerTail);
      if (hasBypassPermissions || waitingOnTeammate) {
        return {
          output: raw,
          lines: outputLines,
          alive: true,
          prompts,
        };
      }

      // Helper: extract tool call context from terminal output
      // Looks for the block between ─── separator and the prompt options
      const extractToolContext = (): string | undefined => {
        // Find the separator line (────)
        let sepIdx = -1;
        for (let k = outputLines.length - 1; k >= 0; k--) {
          if (/^─{4,}/.test((outputLines[k] ?? '').trim())) { sepIdx = k; break; }
        }
        if (sepIdx < 0) return undefined;

        // Collect lines from separator to the question/options
        const contextLines: string[] = [];
        for (let j = sepIdx + 1; j < outputLines.length; j++) {
          const line = outputLines[j]?.trim() ?? '';
          // Stop at the question line or option markers
          if (/^\s*[❯>]\s*\d+\./.test(outputLines[j] ?? '')) break;
          if (line.startsWith('Esc to cancel')) break;
          if (/^Do you want/.test(line)) break;
          if (line === '') continue;
          contextLines.push(line);
        }
        return contextLines.length > 0 ? contextLines.join('\n') : undefined;
      };

      // Trust prompt
      if (bottomRaw.includes('trust this folder') || bottomRaw.includes('Yes, I trust')) {
        prompts.push({
          type: 'trust',
          message: 'Claude Code is asking if you trust this workspace folder.',
          options: ['Yes, I trust this folder', 'No, exit'],
        });
      }

      // Numbered choice prompts — look for ❯ marker on a numbered option (Claude's interactive UI)
      // Only search the last 10 lines to avoid matching numbered content in the conversation
      const tailLines = outputLines.slice(-10);
      const markerIdx = tailLines.findIndex((l) => /^\s*❯\s*\d+\./.test(l));
      if (markerIdx >= 0) {
        // Collect all numbered options from the tail
        const options = tailLines
          .filter((l) => /^\s*[❯ ]\s*\d+\./.test(l))
          .map((l) => l.replace(/^\s*[❯ ]\s*/, '').trim());
        if (options.length > 1) {
          // Find the question text: walk backwards from the marker in the FULL output
          const fullMarkerIdx = outputLines.length - 10 + markerIdx;
          let contextMsg = 'Choose an option';
          for (let j = fullMarkerIdx - 1; j >= Math.max(0, fullMarkerIdx - 5); j--) {
            const line = outputLines[j]?.trim();
            if (line && line.length > 5 && !line.startsWith('─') && !line.startsWith('⎿') && !/^\s*[❯ ]\s*\d+\./.test(line)) {
              contextMsg = line;
              break;
            }
          }
          prompts.push({ type: 'choice', message: contextMsg, context: extractToolContext(), options });
        }
      }

      // Allow/Deny permission prompts (tool approval)
      if (!prompts.some((p) => p.type === 'choice') && (bottomRaw.includes('Allow') && (bottomRaw.includes('Deny') || bottomRaw.includes('allow always')))) {
        const contextLine = outputLines.find((l) =>
          l.includes('Allow') && (l.includes('run:') || l.includes('to run') || l.includes('to execute'))
        );
        const actionLine = outputLines.find((l) =>
          l.includes('Allow') && !l.includes('run:') && !l.includes('to run')
        );
        const message = contextLine?.trim() ?? actionLine?.trim() ?? 'Permission requested';
        const hasAlwaysOpt = bottomRaw.includes('always') || bottomRaw.includes('Allow always');
        prompts.push({
          type: 'permission',
          message,
          context: extractToolContext(),
          options: hasAlwaysOpt ? ['Allow', 'Allow always', 'Deny'] : ['Allow', 'Deny'],
        });
      }

      // NOTE: ⏵⏵ accept edits on is a persistent MODE INDICATOR, not a prompt.
      // It shows Claude Code's edit acceptance mode. NOT actionable — do not detect as prompt.

      // Y/N prompts
      if (prompts.length === 0 && /\(y\/n\)/i.test(bottomRaw)) {
        const lastYn = bottomLines.filter((l) => /\(y\/n\)/i.test(l)).pop();
        if (lastYn) {
          prompts.push({ type: 'confirm', message: lastYn.trim(), context: extractToolContext() });
        }
      }

      // Generic "Esc to cancel" / "Enter to confirm" — catch-all for unknown prompt types
      if (prompts.length === 0 && (bottomRaw.includes('Esc to cancel') || bottomRaw.includes('Enter to confirm'))) {
        prompts.push({
          type: 'confirm',
          message: 'Waiting for confirmation',
          context: extractToolContext(),
        });
      }

      // Final fallback — only when the LAST non-empty line itself looks
      // like an actionable prompt. Previously we matched `?` anywhere in
      // the last 10 lines, which regularly fired on chat content
      // containing a question mark. A real Claude Code prompt always ends
      // right above the input cursor, so the last non-empty line is the
      // right surface to probe.
      if (prompts.length === 0 && bottomLines.length > 0) {
        const lastLine = bottomLines[bottomLines.length - 1]!.trim();
        const lastLineIsQuestion =
          /\?\s*$/.test(lastLine) || /\?\s*\(/.test(lastLine);
        const lastLineIsNumberedOption = /^[❯ ]?\s*\d+\)\s+/.test(lastLine);
        if (lastLineIsQuestion || lastLineIsNumberedOption) {
          prompts.push({
            type: 'confirm',
            message: 'Waiting on input — see terminal',
            context: extractToolContext(),
          });
        }
      }

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
