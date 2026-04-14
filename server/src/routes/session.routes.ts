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
      const prompts: { type: string; message: string; options?: string[] }[] = [];

      if (raw.includes('trust this folder') || raw.includes('Yes, I trust')) {
        prompts.push({
          type: 'trust',
          message: 'Claude Code is asking if you trust this workspace folder.',
          options: ['Yes, I trust this folder', 'No, exit'],
        });
      }
      if (raw.includes('(y/n)') || raw.includes('(Y/n)') || raw.includes('(y/N)')) {
        const lastYn = outputLines.filter((l) => l.includes('(y/n)') || l.includes('(Y/n)') || l.includes('(y/N)')).pop();
        if (lastYn) {
          prompts.push({ type: 'confirm', message: lastYn.trim() });
        }
      }
      if (raw.includes('permission') && (raw.includes('Allow') || raw.includes('Deny'))) {
        const permLine = outputLines.filter((l) => l.includes('Allow') || l.includes('permission')).pop();
        if (permLine) {
          prompts.push({ type: 'permission', message: permLine.trim(), options: ['Allow', 'Deny'] });
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
