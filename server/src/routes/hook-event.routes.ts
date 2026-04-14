import type { FastifyInstance } from 'fastify';
import { fileWatcherService } from '../services/file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';

interface HookEventBody {
  event: string;
  sessionId?: string;
  data?: {
    transcript_path?: string;
    [key: string]: unknown;
  };
}

export const hookEventRoutes = async (app: FastifyInstance) => {
  // Receive hook events from Claude Code
  // These bypass PIN auth (localhost only, fired by Claude Code process)
  app.post<{ Body: HookEventBody }>(
    '/api/hook-event',
    { logLevel: 'warn' as const },
    async (request) => {
      const body = request.body ?? {} as HookEventBody;
      const event = body.event ?? 'unknown';
      const transcriptPath = body.data?.transcript_path;

      console.log(`[hook] ${event}${transcriptPath ? ` → ${transcriptPath.split('/').pop()}` : ''}`);

      // Watch the specific JSONL file for instant updates
      if (transcriptPath && transcriptPath.endsWith('.jsonl')) {
        fileWatcherService.watchSpecificFile(transcriptPath);
      }

      // Broadcast hook event for real-time UI
      eventBus.emitSystemEvent(`hook:${event}`, body);

      return { ok: true };
    },
  );
};
