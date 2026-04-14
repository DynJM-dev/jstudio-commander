import type { FastifyInstance } from 'fastify';
import { sessionService } from '../services/session.service.js';
import { tmuxService } from '../services/tmux.service.js';

export const sessionRoutes = async (app: FastifyInstance) => {
  // List all sessions
  app.get('/api/sessions', async () => {
    return sessionService.listSessions();
  });

  // Get single session
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = sessionService.getSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session;
  });

  // Create session
  app.post<{ Body: { name?: string; projectPath?: string; model?: string } }>(
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

      // Detect interactive prompts
      const prompts: { type: string; message: string; context?: string; options?: string[] }[] = [];

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
      if (raw.includes('trust this folder') || raw.includes('Yes, I trust')) {
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
      if (!prompts.some((p) => p.type === 'choice') && (raw.includes('Allow') && (raw.includes('Deny') || raw.includes('allow always')))) {
        const contextLine = outputLines.find((l) =>
          l.includes('Allow') && (l.includes('run:') || l.includes('to run') || l.includes('to execute'))
        );
        const actionLine = outputLines.find((l) =>
          l.includes('Allow') && !l.includes('run:') && !l.includes('to run')
        );
        const message = contextLine?.trim() ?? actionLine?.trim() ?? 'Permission requested';
        const hasAlwaysOpt = raw.includes('always') || raw.includes('Allow always');
        prompts.push({
          type: 'permission',
          message,
          context: extractToolContext(),
          options: hasAlwaysOpt ? ['Allow', 'Allow always', 'Deny'] : ['Allow', 'Deny'],
        });
      }

      // "Accept edits" prompt (⏵⏵ pattern)
      if (raw.includes('accept edits') || raw.includes('⏵⏵')) {
        const editLine = outputLines.find((l) =>
          l.includes('accept edits') || l.includes('⏵⏵')
        );
        prompts.push({
          type: 'accept_edits',
          message: editLine?.trim() ?? 'Accept pending edits?',
          context: extractToolContext(),
          options: ['Accept', 'Reject'],
        });
      }

      // Y/N prompts
      if (prompts.length === 0 && /\(y\/n\)/i.test(raw)) {
        const lastYn = outputLines.filter((l) => /\(y\/n\)/i.test(l)).pop();
        if (lastYn) {
          prompts.push({ type: 'confirm', message: lastYn.trim(), context: extractToolContext() });
        }
      }

      // Generic "Esc to cancel" / "Enter to confirm" — catch-all for unknown prompt types
      if (prompts.length === 0 && (raw.includes('Esc to cancel') || raw.includes('Enter to confirm'))) {
        prompts.push({
          type: 'confirm',
          message: 'Waiting for confirmation',
          context: extractToolContext(),
        });
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
  app.patch<{ Params: { id: string }; Body: { name?: string; model?: string } }>(
    '/api/sessions/:id',
    async (request, reply) => {
      const session = sessionService.updateSession(request.params.id, request.body ?? {});
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return session;
    },
  );
};
