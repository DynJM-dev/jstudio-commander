import { dirname, basename } from 'node:path';
import { fileWatcherService } from './file-watcher.service.js';
import { jsonlParserService } from './jsonl-parser.service.js';
import { jsonlDiscoveryService } from './jsonl-discovery.service.js';
import { tokenTrackerService } from './token-tracker.service.js';
import { projectScannerService } from './project-scanner.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';

export const setupWatcherBridge = (): void => {
  // Wire JSONL file changes → parse new lines → emit chat messages
  fileWatcherService.onJsonlChange((filePath, newLines) => {
    const messages = jsonlParserService.parseLines(newLines);
    if (messages.length === 0) return;

    // Try to find which session this JSONL file belongs to
    // JSONL path: ~/.claude/projects/{encoded-path}/{session-uuid}.jsonl
    const jsonlFilename = basename(filePath, '.jsonl');
    const encodedProjectDir = basename(dirname(filePath));

    // Look up session by claude_session_id first
    const db = getDb();
    let session = db.prepare('SELECT id FROM sessions WHERE claude_session_id = ?')
      .get(jsonlFilename) as { id: string } | undefined;

    if (!session) {
      // Match by encoding each session's project_path and comparing to the
      // encoded directory name. This avoids the broken reverse-decoding that
      // fails for project names containing hyphens.
      const rows = db.prepare('SELECT id, project_path FROM sessions WHERE project_path IS NOT NULL AND status != \'stopped\'')
        .all() as { id: string; project_path: string }[];

      for (const row of rows) {
        const encoded = jsonlDiscoveryService.encodeProjectPath(row.project_path);
        if (encoded === encodedProjectDir) {
          session = { id: row.id };
          break;
        }
      }
    }

    if (session) {
      console.log(`[bridge] JSONL change → session ${session.id}, ${messages.length} new messages`);
      eventBus.emitChatMessages(session.id, messages);

      // Track token usage from assistant messages
      try {
        tokenTrackerService.recordUsage(session.id, null, messages);
      } catch (err) {
        console.error('[bridge] Token tracking error:', err);
      }
    } else {
      console.log(`[bridge] JSONL change at ${encodedProjectDir} — no matching session found`);
    }
  });

  // Wire STATE.md/PM_HANDOFF.md changes → re-scan project → emit update
  fileWatcherService.onProjectFileChange((filePath, type) => {
    // filePath is like ~/Desktop/Projects/foo/STATE.md
    const projectDir = dirname(filePath);
    const project = projectScannerService.getProjectByPath(projectDir);

    if (project) {
      // Re-scan just this project. Fire-and-forget async enrich for
      // recent commits (#230) — git log is cheap but we don't want to
      // block the watcher callback.
      const scanned = projectScannerService.scanDirectories([dirname(projectDir)]);
      const updated = scanned.find((p) => p.path === projectDir);
      if (updated) {
        updated.id = project.id;
        void projectScannerService.enrichWithCommits([updated]).then(() => {
          projectScannerService.syncToDb([updated]);
          const refreshed = projectScannerService.getProject(project.id);
          if (refreshed) eventBus.emitProjectUpdated(refreshed);
        });
      }
    }
  });

  console.log('[bridge] File watcher → event bus bridge connected');
};
