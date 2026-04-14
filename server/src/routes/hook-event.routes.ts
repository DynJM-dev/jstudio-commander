import type { FastifyInstance } from 'fastify';
import { fileWatcherService } from '../services/file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';

interface HookEventBody {
  event: string;
  sessionId?: string;
  data?: {
    transcript_path?: string;
    cwd?: string;
    tool_name?: string;
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
      const cwd = body.data?.cwd;

      console.log(`[hook] ${event}${transcriptPath ? ` → ${transcriptPath.split('/').pop()}` : ''}`);

      // Watch the specific JSONL file for instant updates
      if (transcriptPath && transcriptPath.endsWith('.jsonl')) {
        fileWatcherService.watchSpecificFile(transcriptPath);

        // Store transcript_path on the matching Commander session
        // Match by project_path (cwd from hook) — find the active session for this project
        if (cwd) {
          const db = getDb();
          const updated = db.prepare(
            "UPDATE sessions SET transcript_path = ?, updated_at = datetime('now') WHERE project_path = ? AND status != 'stopped' AND (transcript_path IS NULL OR transcript_path != ?)"
          ).run(transcriptPath, cwd, transcriptPath);

          if (updated.changes > 0) {
            console.log(`[hook] Stored transcript_path for project ${cwd.split('/').pop()}`);
          }
        }
      }

      // Broadcast hook event for real-time UI
      eventBus.emitSystemEvent(`hook:${event}`, body);

      return { ok: true };
    },
  );
};
